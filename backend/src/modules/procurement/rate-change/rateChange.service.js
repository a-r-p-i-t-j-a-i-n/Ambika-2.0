/**
 * PO Rate Change Approvals (Purchase FMS).
 *
 * The vendor's rate lives in the Vendor Master (Vendor.products[]). When a PO
 * line is saved at a different rate, the save raises a RateChangeRequest
 * instead of touching that rate:
 *   - the draft PO keeps the proposed rate, but cannot be approved until every
 *     changed line has an APPROVED request at exactly that rate;
 *   - approving updates the vendor's rate AND the PO line together, only if the
 *     PO is still a draft with the line at the requested rate and the vendor's
 *     rate is still the one the request saw (or the approver confirmed the new
 *     one) — otherwise nothing changes on either side;
 *   - rejecting leaves the vendor's rate alone and puts the draft line back on it.
 * Every request and decision is appended to RateChangeHistory; an approval also
 * appends a PricingHistory row, so the vendor's own history shows from when the
 * new rate applies.
 */
import mongoose from 'mongoose';
import RateChangeRequest, { RATE_CHANGE_STATUS } from './rateChange.model.js';
import RateChangeHistory, { RATE_CHANGE_EVENT } from './rateChangeHistory.model.js';
import {
  LINE_RATE, evaluateLineRate, unsendableReason, matchVendorRate, sameRate, rateDiff,
  selfApprovalBlock, isSelfApproval, otherLineAmounts, poTotals, inr,
} from './rateChange.rules.js';
import VendorPurchaseOrder, { PO_APPROVAL_STATUS, PO_STATUS } from '../purchase-order/purchaseOrder.model.js';
import PurchaseIndent from '../indent/indent.model.js';
import { itemVendorState } from '../indent/itemVendor.js';
import Vendor from '../../vendors/vendor.model.js';
import PricingHistory, { PRICING_SOURCE } from '../../vendors/pricingHistory.model.js';
import User from '../../auth/auth.model.js';
import Role from '../../access-control/role.model.js';
import { notificationsService } from '../../notifications/notification.service.js';
import { inventoryService } from '../../inventory/inventory.service.js';
import { generateRateChangeNumber } from '../../../utils/docNumberGenerator.js';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';

const { ObjectId } = mongoose.Types;
const S = RATE_CHANGE_STATUS;
const E = RATE_CHANGE_EVENT;

/** Who may approve / reject (OR) — the MD (root) always may. Same pattern as PI Not Required. */
export const RATE_APPROVER_PERMISSIONS = ['procurement.approveRateChange', 'procurement.approve'];
export const RATE_CHANGE_LINK = '/purchase-fms/rate-change-approvals';

const idStr = (v) => (v ? String(v._id || v) : '');
const upper = (s) => String(s || '').trim().toUpperCase();
const poRefOf = (po) => po?.poNumber || po?.draftNumber || '';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const opt = (session) => (session ? { session } : {});

/** A refused approval that changed nothing — the request stays pending. */
export class RateConflictError extends AppError {
  constructor(message, currentVendorRate = null) {
    super(message, 409);
    this.data = { code: 'STALE_VENDOR_RATE', currentVendorRate };
  }
}
/** The PO can no longer take the rate — nothing changed; the request is closed. */
class PoIneligibleError extends AppError {
  constructor(message) {
    super(message, 409);
    this.data = { code: 'PO_NOT_ELIGIBLE' };
  }
}

const sourceSnap = (product, overrides = {}) => (product ? {
  vendorProductId: product._id || null,
  rate: product.rate ?? null,
  unit: product.unit || '',
  lastUpdatedAt: product.lastUpdatedAt || null,
  ...overrides,
} : null);

// The request fields every history row repeats (so a row reads on its own).
const historyBase = (r) => ({
  requestId: r._id, requestNumber: r.requestNumber,
  vendorId: r.vendorId, vendorName: r.vendorName,
  skuId: r.skuId || null, skuCode: r.skuCode, itemName: r.itemName, unit: r.unit, currency: r.currency || 'INR',
  requestedRate: r.requestedRate, originalPoRate: r.originalPoRate,
  poId: r.poId, poRef: r.poRef, indentId: r.indentId || null, indentNumber: r.indentNumber,
  indentItemDisplayNumber: r.indentItemDisplayNumber, quotationPath: r.quotationPath,
  requestedBy: r.requestedBy || null, requestedByName: r.requestedByName, reason: r.reason,
});
const writeHistory = (rows, session) => RateChangeHistory.insertMany(rows, opt(session));

const loadVendor = (vendorId, session = null) => (vendorId
  ? Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).session(session).lean()
  : null);

// The rate approved for this vendor + item at Step 1.3 (multi-vendor indents).
const quotationRateOf = (indent, vendorId, line) => {
  const av = (indent?.quotationApprovalStep?.approvedVendors || []).find((v) => idStr(v.vendorId) === idStr(vendorId));
  if (!av) return null;
  const it = (av.items || []).find((x) => (line.skuCode && upper(x.skuCode) === upper(line.skuCode))
    || (line.skuId && x.skuId && idStr(x.skuId) === idStr(line.skuId)));
  return it && it.approvedRate != null ? Number(it.approvedRate) : null;
};

// A PO line names the same SKU as its indent item (codes when both have one, else ids).
const sameSku = (src, line) => {
  if (src.skuCode && line.skuCode) return upper(src.skuCode) === upper(line.skuCode);
  if (src.skuId && line.skuId) return idStr(src.skuId) === idStr(line.skuId);
  return true;
};

// The catalog row a request targets: its own row, else the row that now prices the item.
const productFor = (vendor, r) => {
  const own = r.vendorProductId && (vendor?.products || []).find((p) => idStr(p._id) === idStr(r.vendorProductId));
  if (own) return own;
  return matchVendorRate(vendor?.products || [], { skuId: r.skuId, skuCode: r.skuCode, itemName: r.itemName, unit: r.unit }).product;
};

// Why the request's PO can no longer take the rate ('' = it can).
const poIneligibleReason = (po, r) => {
  if (!po || po.isDeleted) return 'The PO was deleted';
  if (po.poStatus === PO_STATUS.CANCELLED) return `PO ${poRefOf(po)} was cancelled`;
  if (po.approvalStatus === PO_APPROVAL_STATUS.REJECTED) return `PO ${poRefOf(po)} was rejected`;
  if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) return `PO ${poRefOf(po)} is already ${String(po.approvalStatus).toLowerCase()} — its rates cannot change any more`;
  if (idStr(po.vendorId) !== idStr(r.vendorId)) return `PO ${poRefOf(po)} is now on another vendor`;
  const line = (po.items || []).find((l) => idStr(l._id) === idStr(r.poLineId));
  if (!line) return `The line was removed from PO ${poRefOf(po)}`;
  if (!sameRate(line.rate, r.requestedRate)) return `The line's rate on PO ${poRefOf(po)} is now ${inr(line.rate)}, not the requested ${inr(r.requestedRate)}`;
  return '';
};

// Users who may decide a rate change (MD / root, the permissions via a role or a grant).
const approverIds = async () => {
  const roles = await Role.find({
    isDeleted: { $ne: true },
    $or: [{ isRoot: true }, { permissions: { $in: RATE_APPROVER_PERMISSIONS } }],
  }).select('key').lean();
  const users = await User.find({
    isActive: { $ne: false },
    $or: [
      { roles: { $in: roles.map((r) => r.key) } },
      { permissionGrants: { $in: RATE_APPROVER_PERMISSIONS } },
      { role: 'MD', roles: { $size: 0 } },
    ],
  }).select('_id permissionDenies roles').lean();
  const rootKeys = new Set((await Role.find({ isRoot: true }).select('key').lean()).map((r) => r.key));
  return users
    .filter((u) => (u.roles || []).some((k) => rootKeys.has(k))
      || !RATE_APPROVER_PERMISSIONS.every((s) => (u.permissionDenies || []).includes(s)))
    .map((u) => u._id);
};

const notifyApprovers = async (requests, user) => {
  if (!requests?.length) return;
  try {
    const ids = await approverIds();
    const one = requests.length === 1 ? requests[0] : null;
    const title = one ? `Rate change ${one.requestNumber} awaits approval` : `${requests.length} rate changes await approval`;
    const body = requests.map((r) => `${r.vendorName} · ${r.itemName || r.skuCode}: ${inr(r.existingVendorRate)} → ${inr(r.requestedRate)} on ${r.poRef} (by ${r.requestedByName || 'someone'})`).join('\n');
    for (const uid of ids) {
      if (idStr(uid) === idStr(user?._id)) continue;
      await notificationsService.notify(uid, { type: 'APPROVAL_REQUIRED', title, body, link: RATE_CHANGE_LINK });
    }
  } catch (err) {
    logger.error(`[rate-change] approver notification failed: ${err.message}`);
  }
};

const notifyRequester = (r, title, body) => {
  if (!r?.requestedBy) return null;
  return notificationsService.notify(r.requestedBy, { type: 'INFO', title, body, link: RATE_CHANGE_LINK });
};

const withDiff = (r, currentVendorRate) => {
  const base = r.existingVendorRate;
  const d = rateDiff(base, r.requestedRate);
  return {
    ...r,
    diffAmount: d.amount,
    diffPercent: d.percent,
    lineImpact: d.amount == null ? null : Math.round(d.amount * (Number(r.quantity) || 0) * 100) / 100,
    currentVendorRate: currentVendorRate === undefined ? null : currentVendorRate,
    stale: r.status === S.PENDING && currentVendorRate !== undefined && !sameRate(currentVendorRate, r.existingVendorRate),
  };
};

export const rateChangeService = {
  // ── PO save: plan → stamp → commit ─────────────────────────────────────

  /**
   * Decide, per PO line, what saving it does about its rate. Runs before
   * anything is written, so a refusal saves nothing. `lines` = computed lines
   * (with `_id` when they are already on the PO), `items` = the request's raw
   * lines in the same order (the doer's `rateChangeReason`).
   *   NONE  the line uses the vendor rate / its approved quotation rate, or the
   *         vendor has no rate for it yet (nothing was fetched)
   *   KEEP  an open (or approved) request already covers this line at this rate
   *   NEW   a changed rate → a new PENDING request (needs a reason)
   */
  async planPoRates({ vendorId, poFormatType, lines = [], items = [], indents = [], poId = null, session = null }) {
    const open = poId
      ? await RateChangeRequest.find({ poId, status: { $in: [S.PENDING, S.APPROVED] } }).session(session).lean()
      : [];
    // JSL lines carry a computed final price, not a catalog rate; a legacy Party
    // vendor has no Vendor Master rate. Neither raises requests (as before).
    const vendor = poFormatType === 'JSL' ? null : await loadVendor(vendorId, session);
    if (!vendor) return { applicable: false, vendor: null, entries: [], open };

    const indentById = new Map(indents.map((i) => [idStr(i), i]));
    const entries = [];
    const problems = [];
    lines.forEach((line, idx) => {
      const indent = indentById.get(idStr(line.indentId));
      const ev = evaluateLineRate({ line, products: vendor.products, quotationRate: quotationRateOf(indent, vendor._id, line) });
      const base = { idx, ev, fetchedRate: ev.vendorRate ?? null, vendorProduct: ev.product, indent };
      if ([LINE_RATE.NO_SOURCE, LINE_RATE.MATCHES, LINE_RATE.QUOTATION].includes(ev.state)) {
        entries.push({ ...base, action: 'NONE' });
        return;
      }
      const lineId = idStr(line._id);
      const standing = lineId && open.find((r) => idStr(r.poLineId) === lineId && sameRate(r.requestedRate, line.rate));
      if (standing) {
        entries.push({ ...base, action: 'KEEP', request: standing });
        return;
      }
      const item = line.itemName || line.skuCode || 'an item';
      const blocked = unsendableReason(ev, line, vendor.name);
      if (blocked) { problems.push(blocked); return; }
      if (line.indentItemId && indent) {
        const src = (indent.items || []).find((it) => idStr(it._id) === idStr(line.indentItemId));
        if (src && !sameSku(src, line)) {
          problems.push(`"${item}" (${line.skuCode || 'no SKU'}) is not the item of ${line.indentItemDisplayNumber || indent.indentNumber} (${src.skuCode || src.itemName}) — a rate can only be changed for the PO line's own item`);
          return;
        }
      }
      const reason = String(items[idx]?.rateChangeReason || '').trim();
      if (!reason) {
        problems.push(`Give a reason for changing the rate of "${item}" (${vendor.name}'s rate ${inr(ev.vendorRate)} → ${inr(line.rate)}) — a changed rate goes to Rate Change Approvals`);
        return;
      }
      entries.push({ ...base, action: 'NEW', reason });
    });
    if (problems.length) throw new AppError(problems.join(' · '), 400);
    return { applicable: true, vendor, entries, open };
  },

  /**
   * Stamp the plan onto the lines (fetchedRate + request fields) and build the
   * writes (new requests, withdrawals). Lines get their `_id` here when new, so
   * the requests can point at them before the PO is inserted. `previousLines`
   * = the PO's lines as last saved (draft edit).
   */
  async preparePoRates(plan, { lines, poId, poRef, user, previousLines = [] }) {
    const writes = { requests: [], history: [], withdraw: [] };
    const prevById = new Map(previousLines.filter((l) => l._id).map((l) => [idStr(l._id), l]));
    for (const e of plan.entries) {
      const line = lines[e.idx];
      if (!line._id) line._id = new ObjectId();
      line.fetchedRate = e.fetchedRate;
      const prev = prevById.get(idStr(line._id));
      if (e.action === 'KEEP') {
        Object.assign(line, { rateChangeRequestId: e.request._id, rateChangeRequestNumber: e.request.requestNumber, rateChangeStatus: e.request.status });
        continue;
      }
      if (e.action === 'NONE') {
        // A decided request stays noted on the line while the rate is unchanged.
        const note = prev && ['APPROVED', 'REJECTED'].includes(prev.rateChangeStatus) && sameRate(prev.rate, line.rate);
        Object.assign(line, note
          ? { rateChangeRequestId: prev.rateChangeRequestId, rateChangeRequestNumber: prev.rateChangeRequestNumber, rateChangeStatus: prev.rateChangeStatus }
          : { rateChangeRequestId: null, rateChangeRequestNumber: '', rateChangeStatus: '' });
        continue;
      }
      const src = e.indent && line.indentItemId
        ? (e.indent.items || []).find((it) => idStr(it._id) === idStr(line.indentItemId)) : null;
      const now = new Date();
      const doc = {
        _id: new ObjectId(),
        requestNumber: await generateRateChangeNumber(now),
        status: S.PENDING,
        vendorId: plan.vendor._id,
        vendorName: plan.vendor.name || '',
        vendorProductId: e.vendorProduct?._id || null,
        skuId: line.skuId || e.vendorProduct?.skuId || null,
        skuCode: line.skuCode || e.vendorProduct?.skuCode || '',
        itemName: line.itemName || '',
        unit: line.unit || '',
        currency: 'INR',
        existingVendorRate: e.fetchedRate,
        originalPoRate: prev ? Number(prev.rate) : e.fetchedRate,
        requestedRate: Number(line.rate),
        gstRate: Number(line.gstRate) || 0,
        quantity: Number(line.quantity) || 0,
        poId,
        poRef,
        poLineId: line._id,
        indentId: line.indentId || null,
        indentNumber: line.indentNumber || e.indent?.indentNumber || '',
        indentItemId: line.indentItemId || null,
        indentItemDisplayNumber: line.indentItemDisplayNumber || '',
        quotationPath: src ? itemVendorState(e.indent, src).path : '',
        reason: e.reason,
        requestedBy: user?._id || null,
        requestedByName: user?.name || '',
        requestedAt: now,
        vendorSourceBefore: sourceSnap(e.vendorProduct),
      };
      writes.requests.push(doc);
      writes.history.push({
        ...historyBase(doc), event: E.REQUESTED, status: S.PENDING,
        previousRate: doc.existingVendorRate, newRate: doc.requestedRate,
        actorId: user?._id || null, actorName: user?.name || '', at: now,
        vendorSourceBefore: doc.vendorSourceBefore,
      });
      Object.assign(line, { rateChangeRequestId: doc._id, rateChangeRequestNumber: doc.requestNumber, rateChangeStatus: S.PENDING });
    }
    // Every open request the save no longer stands behind is withdrawn.
    const kept = new Set(plan.entries.filter((e) => e.action === 'KEEP').map((e) => idStr(e.request._id)));
    const lineById = new Map(lines.filter((l) => l._id).map((l) => [idStr(l._id), l]));
    for (const r of plan.open || []) {
      if (r.status !== S.PENDING || kept.has(idStr(r._id))) continue;
      const line = lineById.get(idStr(r.poLineId));
      let message;
      if (!plan.applicable) message = 'The PO no longer uses a Vendor Master rate for this line (vendor or PO format changed)';
      else if (!line) message = 'The line was removed from the PO';
      else if (sameRate(line.rate, line.fetchedRate)) message = `The line's rate was set back to the vendor rate ${inr(line.fetchedRate)}`;
      else message = `Replaced — the line's rate was changed to ${inr(line.rate)} before a decision`;
      writes.withdraw.push({ request: r, message });
    }
    return writes;
  },

  /** Write the prepared requests / withdrawals (inside the caller's transaction when given). */
  async commitPoRates(writes, { user, session = null } = {}) {
    for (const w of writes.withdraw) await this.withdrawOne(w.request, w.message, user, session);
    if (writes.requests.length) {
      await RateChangeRequest.insertMany(writes.requests, opt(session));
      await writeHistory(writes.history, session);
    }
  },

  /** After the save committed: tell the approvers (non-fatal). */
  async afterPoSave(writes, user) {
    await notifyApprovers(writes?.requests || [], user);
  },

  async withdrawOne(r, message, user, session = null) {
    const now = new Date();
    const res = await RateChangeRequest.updateOne(
      { _id: r._id, status: S.PENDING },
      { $set: { status: S.WITHDRAWN, withdrawnReason: message, decidedAt: now, decidedBy: user?._id || null, decidedByName: user?.name || 'System' } },
      opt(session),
    );
    if (!res.modifiedCount) return false;
    await writeHistory([{
      ...historyBase(r), event: E.WITHDRAWN, status: S.WITHDRAWN,
      previousRate: r.existingVendorRate, newRate: r.requestedRate,
      actorId: user?._id || null, actorName: user?.name || 'System', at: now, message,
    }], session);
    return true;
  },

  /** The PO was deleted / cancelled / rejected: close its open requests (non-fatal for the caller). */
  async withdrawForPo(poId, message, user) {
    try {
      const open = await RateChangeRequest.find({ poId, status: S.PENDING }).lean();
      for (const r of open) await this.withdrawOne(r, message, user);
      if (open.length) {
        await VendorPurchaseOrder.updateOne(
          { _id: poId },
          { $set: { 'items.$[l].rateChangeStatus': S.WITHDRAWN } },
          { arrayFilters: [{ 'l.rateChangeRequestId': { $in: open.map((r) => r._id) } }] },
        );
      }
    } catch (err) {
      logger.error(`[rate-change] withdraw for PO ${poId} failed: ${err.message}`);
    }
  },

  // ── PO approval gate ──────────────────────────────────────────────────

  /**
   * Refuse to approve a PO while any line's rate differs from its vendor's
   * rate without an APPROVED rate change at exactly that rate. Checked against
   * the live Vendor Master and requests, never against flags on the PO.
   */
  async assertPoRatesApproved(po) {
    if (!po || po.poFormatType === 'JSL') return;
    const vendor = await loadVendor(po.vendorId);
    if (!vendor) return;
    const indentIds = [...new Set((po.items || []).map((l) => idStr(l.indentId)).filter(Boolean))];
    const indents = indentIds.length ? await PurchaseIndent.find({ _id: { $in: indentIds } }).select('indentNumber quotationApprovalStep').lean() : [];
    const indentById = new Map(indents.map((i) => [idStr(i), i]));
    const requests = await RateChangeRequest.find({ poId: po._id, status: { $in: [S.PENDING, S.APPROVED] } }).lean();
    const problems = [];
    for (const line of po.items || []) {
      const ev = evaluateLineRate({ line, products: vendor.products, quotationRate: quotationRateOf(indentById.get(idStr(line.indentId)), vendor._id, line) });
      if ([LINE_RATE.NO_SOURCE, LINE_RATE.MATCHES, LINE_RATE.QUOTATION].includes(ev.state)) continue;
      const mine = requests.filter((r) => idStr(r.poLineId) === idStr(line._id) && sameRate(r.requestedRate, line.rate));
      if (mine.some((r) => r.status === S.APPROVED)) continue;
      const item = line.itemName || line.skuCode;
      const pending = mine.find((r) => r.status === S.PENDING);
      if (pending) {
        problems.push(`"${item}": rate change ${pending.requestNumber} (${inr(pending.existingVendorRate)} → ${inr(pending.requestedRate)}) is awaiting approval in Rate Change Approvals`);
      } else if (ev.vendorRate != null && line.fetchedRate != null && sameRate(line.fetchedRate, line.rate)) {
        problems.push(`"${item}": ${vendor.name}'s rate changed from ${inr(line.fetchedRate)} to ${inr(ev.vendorRate)} after this draft was saved — edit the PO to use ${inr(ev.vendorRate)}, or keep ${inr(line.rate)} with a reason to send it for approval`);
      } else {
        problems.push(`"${item}": rate ${inr(line.rate)} differs from ${vendor.name}'s rate ${ev.vendorRate != null ? inr(ev.vendorRate) : 'in the Vendor Master'} and has no approved rate change — edit the PO and give a reason to send it for approval`);
      }
    }
    if (problems.length) {
      throw new AppError(`PO ${poRefOf(po)} cannot be approved yet — ${problems.join(' · ')}`, 400);
    }
  },

  /** "Save PO Directly": the MD approves their own rate changes on the PO in the same step. */
  async approveOwnForDirectSave(poId, user) {
    const own = await RateChangeRequest.find({ poId, status: S.PENDING, requestedBy: user?._id }).select('_id').lean();
    for (const r of own) {
      await this.approve(r._id, { remarks: 'Approved with Save PO Directly' }, user);
    }
  },

  // ── Decisions ─────────────────────────────────────────────────────────

  /**
   * Approve: vendor rate + PO line together, or neither.
   * body: { remarks?, expectedVendorRate?, acknowledgeRateChange? } — when the
   * vendor's rate moved since the request, the approver must confirm the rate
   * they saw (acknowledgeRateChange + expectedVendorRate = the current rate).
   */
  async approve(id, body = {}, user) {
    const r0 = await RateChangeRequest.findById(id).lean();
    if (!r0) throw new AppError('Rate change request not found', 404);
    if (r0.status !== S.PENDING) throw new AppError(`${r0.requestNumber} is already ${r0.status.toLowerCase()} — nothing was changed`, 409);
    const block = selfApprovalBlock(user, r0);
    if (block) throw new AppError(block, 403);

    let approved;
    try {
      approved = await inventoryService.runAtomically((session) => this.applyApproval(id, body, user, session));
    } catch (err) {
      if (err instanceof RateConflictError) {
        await this.recordConflict(r0, err.message, err.data.currentVendorRate, user);
      } else if (err instanceof PoIneligibleError) {
        await this.recordConflict(r0, err.message, null, user);
        await this.withdrawOne(r0, `${err.message} — the rate was not applied to the PO or the vendor`, user);
      }
      throw err;
    }
    await notifyRequester(approved, `Rate change ${approved.requestNumber} approved`,
      `${approved.vendorName} · ${approved.itemName}: ${inr(approved.requestedRate)} is now the vendor rate and applies on ${approved.poRef} (approved by ${approved.decidedByName}).`);
    return approved;
  },

  async applyApproval(id, body, user, session) {
    const r = await RateChangeRequest.findById(id).session(session).lean();
    if (!r || r.status !== S.PENDING) throw new AppError(`${r?.requestNumber || 'This request'} was just decided by someone else — nothing was changed`, 409);

    const po = await VendorPurchaseOrder.findOne({ _id: r.poId }).session(session).lean();
    const why = poIneligibleReason(po, r);
    if (why) throw new PoIneligibleError(why);

    const vendor = await loadVendor(r.vendorId, session);
    if (!vendor) throw new PoIneligibleError(`Vendor ${r.vendorName} is no longer in the Vendor Master`);
    const product = productFor(vendor, r);
    if (!product) throw new RateConflictError(`${vendor.name} no longer has a rate for "${r.itemName}" in ${r.unit} in the Vendor Master — reject this request and ask for a new one`, null);
    const current = Number(product.rate);
    if (!sameRate(current, r.existingVendorRate)) {
      if (!body.acknowledgeRateChange || !sameRate(body.expectedVendorRate, current)) {
        throw new RateConflictError(`${vendor.name}'s rate for "${r.itemName}" changed from ${inr(r.existingVendorRate)} to ${inr(current)} after this request was raised — review the current rate and confirm it to approve`, current);
      }
    } else if (body.expectedVendorRate != null && body.expectedVendorRate !== '' && !sameRate(body.expectedVendorRate, current)) {
      throw new RateConflictError(`${vendor.name}'s rate for "${r.itemName}" is ${inr(current)}, not the ${inr(body.expectedVendorRate)} you reviewed — refresh and review again`, current);
    }

    const now = new Date();
    const before = sourceSnap(product);
    const after = sourceSnap(product, { rate: r.requestedRate, lastUpdatedAt: now });
    const undo = []; // standalone mongod only — undone in reverse if a later write fails
    try {
      // 1) Claim the request: a second approver or a replayed request finds it decided.
      const claimed = await RateChangeRequest.findOneAndUpdate(
        { _id: r._id, status: S.PENDING },
        { $set: {
          status: S.APPROVED, decidedBy: user?._id || null, decidedByName: user?.name || '', decidedAt: now,
          decisionRemarks: String(body.remarks || '').trim(), selfApproved: isSelfApproval(user, r),
          vendorSourceBefore: before, vendorSourceAfter: after,
        } },
        { new: true, ...opt(session) },
      ).lean();
      if (!claimed) throw new AppError(`${r.requestNumber} was just decided by someone else — nothing was changed`, 409);
      undo.push(() => RateChangeRequest.updateOne(
        { _id: r._id, status: S.APPROVED, decidedAt: now },
        { $set: { status: S.PENDING, decidedBy: null, decidedByName: '', decidedAt: null, decisionRemarks: '', selfApproved: false, vendorSourceBefore: r.vendorSourceBefore || null, vendorSourceAfter: null } },
      ));

      // 2) Vendor rate — only while it is still the rate checked above.
      const vres = await Vendor.updateOne(
        { _id: vendor._id, products: { $elemMatch: { _id: product._id, rate: product.rate } } },
        { $set: {
          'products.$.rate': r.requestedRate, 'products.$.lastUpdatedAt': now,
          'products.$.lastUpdatedBy': user?._id || null, updatedBy: user?._id || null,
        } },
        opt(session),
      );
      if (!vres.matchedCount) throw new RateConflictError(`${vendor.name}'s rate for "${r.itemName}" was changed by someone else just now — review it again`, null);
      undo.push(() => Vendor.updateOne(
        { _id: vendor._id, products: { $elemMatch: { _id: product._id, rate: r.requestedRate } } },
        { $set: { 'products.$.rate': product.rate, 'products.$.lastUpdatedAt': product.lastUpdatedAt || null, 'products.$.lastUpdatedBy': product.lastUpdatedBy || null } },
      ));

      // 3) PO line + totals — only while the PO is the draft checked above.
      const line = po.items.find((l) => idStr(l._id) === idStr(r.poLineId));
      const amounts = otherLineAmounts({ ...line, rate: r.requestedRate });
      const items = po.items.map((l) => (idStr(l._id) === idStr(line._id) ? { ...l, ...amounts } : l));
      const pres = await VendorPurchaseOrder.updateOne(
        {
          _id: po._id, isDeleted: { $ne: true }, approvalStatus: PO_APPROVAL_STATUS.DRAFT, poStatus: { $ne: PO_STATUS.CANCELLED },
          vendorId: po.vendorId, items: { $elemMatch: { _id: line._id, rate: line.rate } },
        },
        {
          $set: {
            'items.$[l].rate': r.requestedRate,
            'items.$[l].taxableAmount': amounts.taxableAmount,
            'items.$[l].taxAmount': amounts.taxAmount,
            'items.$[l].totalAmount': amounts.totalAmount,
            'items.$[l].fetchedRate': r.requestedRate,
            'items.$[l].rateSource': 'MANUAL',
            'items.$[l].rateChangeRequestId': r._id,
            'items.$[l].rateChangeRequestNumber': r.requestNumber,
            'items.$[l].rateChangeStatus': S.APPROVED,
            ...poTotals(items),
            poPdfUrl: '', poPdfFileName: '',
            updatedBy: user?._id || null,
          },
          $push: { activityTimeline: {
            action: 'RATE_CHANGE_APPROVED',
            description: `Rate change ${r.requestNumber} approved — ${r.itemName}: ${inr(r.requestedRate)} (vendor rate was ${inr(product.rate)})`,
            actorId: user?._id, timestamp: now,
          } },
        },
        { arrayFilters: [{ 'l._id': line._id }], ...opt(session) },
      );
      if (!pres.matchedCount) throw new PoIneligibleError(`PO ${poRefOf(po)} changed while the rate was being approved`);
      const poSnapshot = { items: po.items, totals: { totalTaxableValue: po.totalTaxableValue, totalGSTAmount: po.totalGSTAmount, grandTotal: po.grandTotal } };
      undo.push(() => VendorPurchaseOrder.updateOne(
        { _id: po._id },
        { $set: { items: poSnapshot.items, ...poSnapshot.totals } },
      ));

      // 4) Audit — the vendor's pricing history and the rate change history.
      const [ph] = await PricingHistory.create([{
        vendorId: vendor._id, vendorName: vendor.name || '',
        skuId: product.skuId || r.skuId || null, skuCode: upper(product.skuCode || r.skuCode), itemName: product.productName || r.itemName,
        oldRate: Number(product.rate) || 0, newRate: r.requestedRate,
        oldGstRate: Number(product.gstRate) || 0, newGstRate: Number(product.gstRate) || 0,
        hsn: product.hsn || '', unit: product.unit || r.unit || '',
        effectiveDate: now,
        source: PRICING_SOURCE.RATE_CHANGE_APPROVAL, referenceType: PRICING_SOURCE.RATE_CHANGE_APPROVAL,
        referenceId: po._id, referenceNumber: poRefOf(po),
        updatedBy: user?._id || null, updatedByName: user?.name || '',
        remarks: `Rate change ${r.requestNumber} approved — requested by ${r.requestedByName || 'unknown'}: ${r.reason}`.slice(0, 1000),
      }], opt(session));
      undo.push(() => PricingHistory.deleteOne({ _id: ph._id }));
      await writeHistory([{
        ...historyBase(claimed), event: E.APPROVED, status: S.APPROVED,
        previousRate: Number(product.rate), newRate: r.requestedRate,
        actorId: user?._id || null, actorName: user?.name || '', at: now,
        message: [claimed.selfApproved ? 'Approved by the MD on their own request' : '',
          !sameRate(product.rate, r.existingVendorRate) ? `Vendor rate had changed to ${inr(product.rate)} since the request — confirmed by the approver` : '',
          claimed.decisionRemarks].filter(Boolean).join(' · '),
        vendorSourceBefore: before, vendorSourceAfter: after,
      }], session);
      return claimed;
    } catch (err) {
      if (!session) {
        for (const fn of undo.reverse()) {
          try { await fn(); } catch (e) { logger.error(`[rate-change] ${r.requestNumber} rollback step failed: ${e.message}`); }
        }
      }
      throw err;
    }
  },

  /** Record a refused approval (append-only) and show it on the request. */
  async recordConflict(r, message, currentVendorRate, user) {
    const now = new Date();
    try {
      await writeHistory([{
        ...historyBase(r), event: E.APPROVAL_CONFLICT, status: r.status, outcome: 'CONFLICT',
        previousRate: r.existingVendorRate, newRate: r.requestedRate,
        actorId: user?._id || null, actorName: user?.name || '', at: now,
        message: `Approval refused, nothing changed: ${message}`,
      }]);
      await RateChangeRequest.updateOne(
        { _id: r._id, status: S.PENDING },
        { $set: { lastConflict: { at: now, message, currentVendorRate } } },
      );
    } catch (err) {
      logger.error(`[rate-change] conflict record failed for ${r.requestNumber}: ${err.message}`);
    }
  },

  /** Reject (reason mandatory): vendor rate untouched; a draft line still at the rejected rate goes back to the vendor rate. */
  async reject(id, { reason } = {}, user) {
    const why = String(reason || '').trim();
    if (why.length < 3) throw new AppError('Give a reason for rejecting the rate change', 400);
    const r0 = await RateChangeRequest.findById(id).lean();
    if (!r0) throw new AppError('Rate change request not found', 404);
    if (r0.status !== S.PENDING) throw new AppError(`${r0.requestNumber} is already ${r0.status.toLowerCase()} — nothing was changed`, 409);

    const result = await inventoryService.runAtomically(async (session) => {
      const now = new Date();
      const claimed = await RateChangeRequest.findOneAndUpdate(
        { _id: r0._id, status: S.PENDING },
        { $set: { status: S.REJECTED, rejectionReason: why, decidedBy: user?._id || null, decidedByName: user?.name || '', decidedAt: now } },
        { new: true, ...opt(session) },
      ).lean();
      if (!claimed) throw new AppError(`${r0.requestNumber} was just decided by someone else — nothing was changed`, 409);

      let reverted = null;
      const po = await VendorPurchaseOrder.findOne({ _id: claimed.poId }).session(session).lean();
      if (!poIneligibleReason(po, claimed)) {
        const vendor = await loadVendor(claimed.vendorId, session);
        const product = productFor(vendor, claimed);
        const back = product ? Number(product.rate) : claimed.existingVendorRate;
        if (back != null) {
          const line = po.items.find((l) => idStr(l._id) === idStr(claimed.poLineId));
          const amounts = otherLineAmounts({ ...line, rate: back });
          const items = po.items.map((l) => (idStr(l._id) === idStr(line._id) ? { ...l, ...amounts } : l));
          const res = await VendorPurchaseOrder.updateOne(
            { _id: po._id, approvalStatus: PO_APPROVAL_STATUS.DRAFT, isDeleted: { $ne: true }, items: { $elemMatch: { _id: line._id, rate: line.rate } } },
            {
              $set: {
                'items.$[l].rate': back,
                'items.$[l].taxableAmount': amounts.taxableAmount,
                'items.$[l].taxAmount': amounts.taxAmount,
                'items.$[l].totalAmount': amounts.totalAmount,
                'items.$[l].fetchedRate': back,
                'items.$[l].rateSource': 'VENDOR_MASTER',
                'items.$[l].rateChangeStatus': S.REJECTED,
                ...poTotals(items),
                poPdfUrl: '', poPdfFileName: '',
                updatedBy: user?._id || null,
              },
              $push: { activityTimeline: {
                action: 'RATE_CHANGE_REJECTED',
                description: `Rate change ${claimed.requestNumber} rejected (${why}) — ${claimed.itemName} set back to the vendor rate ${inr(back)}`,
                actorId: user?._id, timestamp: now,
              } },
            },
            { arrayFilters: [{ 'l._id': line._id }], ...opt(session) },
          );
          if (res.matchedCount) reverted = back;
        }
      }
      await writeHistory([{
        ...historyBase(claimed), event: E.REJECTED, status: S.REJECTED,
        previousRate: claimed.existingVendorRate, newRate: claimed.requestedRate,
        actorId: user?._id || null, actorName: user?.name || '', at: now, rejectionReason: why,
        message: reverted != null
          ? `Vendor rate unchanged; PO ${claimed.poRef} line set back to the vendor rate ${inr(reverted)}`
          : `Vendor rate unchanged; PO ${claimed.poRef} was not changed (no longer a draft at the requested rate)`,
      }], session);
      return { ...claimed, revertedTo: reverted };
    });
    await notifyRequester(result, `Rate change ${result.requestNumber} rejected`,
      `${result.vendorName} · ${result.itemName}: ${inr(result.requestedRate)} was rejected by ${result.decidedByName} — ${why}.`
      + (result.revertedTo != null ? ` The PO line is back at ${inr(result.revertedTo)}; change it again with a new reason to resubmit.` : ''));
    return result;
  },

  // ── Reads ─────────────────────────────────────────────────────────────

  async list(query = {}) {
    const filter = {};
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.skuCode) filter.skuCode = upper(query.skuCode);
    if (query.requestedBy) filter.requestedBy = query.requestedBy;
    if (query.poId) filter.poId = query.poId;
    if (query.from || query.to) {
      filter.requestedAt = {};
      if (query.from) filter.requestedAt.$gte = new Date(query.from);
      if (query.to) filter.requestedAt.$lte = new Date(query.to);
    }
    if (query.search) {
      const re = new RegExp(escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ requestNumber: re }, { poRef: re }, { vendorName: re }, { itemName: re }, { skuCode: re }, { indentNumber: re }, { requestedByName: re }];
    }
    const counts = await RateChangeRequest.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const summary = { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0 };
    counts.forEach((c) => { summary[c._id] = c.n; summary.total += c.n; });
    const listFilter = query.status ? { ...filter, status: query.status } : filter;

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
    const [rows, total] = await Promise.all([
      RateChangeRequest.find(listFilter).sort({ requestedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      RateChangeRequest.countDocuments(listFilter),
    ]);
    // Live vendor rate for the pending rows (stale flag).
    const vendorIds = [...new Set(rows.filter((r) => r.status === S.PENDING).map((r) => idStr(r.vendorId)))];
    const vendors = vendorIds.length ? await Vendor.find({ _id: { $in: vendorIds } }).select('name products isDeleted').lean() : [];
    const vById = new Map(vendors.map((v) => [idStr(v), v]));
    const out = rows.map((r) => {
      if (r.status !== S.PENDING) return withDiff(r);
      const v = vById.get(idStr(r.vendorId));
      const p = v && !v.isDeleted ? productFor(v, r) : null;
      return withDiff(r, p ? Number(p.rate) : null);
    });
    const [vendorOpts, requesterOpts] = await Promise.all([
      RateChangeRequest.aggregate([{ $group: { _id: '$vendorId', name: { $first: '$vendorName' } } }, { $sort: { name: 1 } }]),
      RateChangeRequest.aggregate([{ $match: { requestedBy: { $ne: null } } }, { $group: { _id: '$requestedBy', name: { $first: '$requestedByName' } } }, { $sort: { name: 1 } }]),
    ]);
    return {
      rows: out,
      summary,
      vendors: vendorOpts.map((v) => ({ _id: v._id, name: v.name })),
      requesters: requesterOpts.map((u) => ({ _id: u._id, name: u.name })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  },

  async getById(id) {
    const r = await RateChangeRequest.findById(id).lean();
    if (!r) throw new AppError('Rate change request not found', 404);
    const [vendor, po, events] = await Promise.all([
      Vendor.findOne({ _id: r.vendorId }).select('name products isDeleted isActive').lean(),
      VendorPurchaseOrder.findOne({ _id: r.poId })
        .select('poNumber draftNumber approvalStatus poStatus releaseStatus isDeleted vendorId vendorName items poDate grandTotal totalTaxableValue totalGSTAmount')
        .lean(),
      RateChangeHistory.find({ requestId: r._id }).sort({ at: 1, _id: 1 }).lean(),
    ]);
    const product = vendor && !vendor.isDeleted ? productFor(vendor, r) : null;
    const currentVendorRate = product ? Number(product.rate) : null;
    const line = po ? (po.items || []).find((l) => idStr(l._id) === idStr(r.poLineId)) : null;
    // The same item at the other vendors (context: one SKU, many vendor rates).
    const others = r.skuCode
      ? await Vendor.find({ _id: { $ne: r.vendorId }, isDeleted: { $ne: true }, 'products.skuCode': r.skuCode }).select('name products').limit(20).lean()
      : [];
    // POs raised on this vendor + item at the approved rate since the approval.
    const laterPos = r.status === S.APPROVED && r.decidedAt
      ? await VendorPurchaseOrder.find({
        vendorId: r.vendorId, isDeleted: { $ne: true }, createdAt: { $gte: r.decidedAt }, _id: { $ne: r.poId },
        items: { $elemMatch: { skuCode: r.skuCode, rate: r.requestedRate } },
      }).select('poNumber draftNumber approvalStatus poStatus createdAt').sort({ createdAt: 1 }).limit(20).lean()
      : [];
    return {
      ...withDiff(r, r.status === S.PENDING ? currentVendorRate : undefined),
      currentVendorRate,
      vendorSourceNow: sourceSnap(product),
      po: po ? {
        _id: po._id, poRef: poRefOf(po), approvalStatus: po.approvalStatus, poStatus: po.poStatus, releaseStatus: po.releaseStatus,
        isDeleted: !!po.isDeleted, vendorName: po.vendorName, poDate: po.poDate,
        grandTotal: po.grandTotal, totalTaxableValue: po.totalTaxableValue, totalGSTAmount: po.totalGSTAmount,
        line: line ? { _id: line._id, itemName: line.itemName, skuCode: line.skuCode, quantity: line.quantity, unit: line.unit, rate: line.rate, gstRate: line.gstRate, taxableAmount: line.taxableAmount, taxAmount: line.taxAmount, totalAmount: line.totalAmount } : null,
      } : null,
      poIneligible: r.status === S.PENDING ? poIneligibleReason(po, r) : '',
      events,
      otherVendors: others.flatMap((v) => (v.products || [])
        .filter((p) => upper(p.skuCode) === upper(r.skuCode))
        .map((p) => ({ vendorId: v._id, vendorName: v.name, rate: p.rate, unit: p.unit }))),
      laterPos: laterPos.map((p) => ({ _id: p._id, poRef: poRefOf(p), approvalStatus: p.approvalStatus, poStatus: p.poStatus, createdAt: p.createdAt })),
    };
  },

  /** Rate Change History — every event, chronological by default. */
  async history(query = {}) {
    const filter = {};
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.skuCode) filter.skuCode = upper(query.skuCode);
    if (query.event) filter.event = query.event;
    if (query.status) filter.status = query.status;
    if (query.requestedBy) filter.requestedBy = query.requestedBy;
    if (query.requestId) filter.requestId = query.requestId;
    if (query.from || query.to) {
      filter.at = {};
      if (query.from) filter.at.$gte = new Date(query.from);
      if (query.to) filter.at.$lte = new Date(query.to);
    }
    if (query.search) {
      const re = new RegExp(escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ requestNumber: re }, { poRef: re }, { vendorName: re }, { itemName: re }, { skuCode: re }, { actorName: re }, { requestedByName: re }];
    }
    const dir = query.order === 'desc' ? -1 : 1;
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 50));
    const [rows, total] = await Promise.all([
      RateChangeHistory.find(filter).sort({ at: dir, _id: dir }).skip((page - 1) * limit).limit(limit).lean(),
      RateChangeHistory.countDocuments(filter),
    ]);
    return { rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
  },

  /** The authoritative vendor rate for a vendor + item (+ unit) — what a new PO line fetches. */
  async vendorRate({ vendorId, skuId, skuCode, itemName, unit }) {
    const vendor = await loadVendor(vendorId);
    if (!vendor) throw new AppError('Vendor not found in the Vendor Master', 404);
    const m = matchVendorRate(vendor.products, { skuId, skuCode, itemName, unit: unit || '' });
    const unitAgnostic = !unit ? matchVendorRate(vendor.products, { skuId, skuCode, itemName, unit: '' }) : null;
    const product = m.product || (unitAgnostic?.candidates?.length === 1 ? unitAgnostic.candidates[0] : null);
    return {
      vendorId: vendor._id, vendorName: vendor.name,
      found: !!product, problem: product ? null : m.problem,
      vendorProductId: product?._id || null,
      rate: product ? Number(product.rate) : null,
      unit: product?.unit || '', gstRate: product?.gstRate ?? null, hsn: product?.hsn || '',
      lastUpdatedAt: product?.lastUpdatedAt || null,
      candidates: (m.candidates || []).map((p) => ({ vendorProductId: p._id, rate: p.rate, unit: p.unit })),
    };
  },
};
