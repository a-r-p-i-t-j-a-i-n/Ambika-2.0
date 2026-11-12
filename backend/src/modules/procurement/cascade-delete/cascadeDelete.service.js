/**
 * Purchase FMS cascade delete — delete a step and everything that rests on it.
 *
 *   preview(type, id)   what would go, what blocks it, what stays (read-only)
 *   execute(type, id)   the same plan, re-built and re-checked, then carried out
 *
 * The dependency map and the rules are in cascadeDelete.graph.js. How a
 * deletion runs:
 *
 *   1. The plan is built again from the database and must be exactly the one
 *      the user confirmed (planToken: every record, its status and its last
 *      change), with no blocker, every needed delete permission and the
 *      acknowledgement — so the confirmation cannot be skipped and nothing
 *      that changed since the preview is deleted unseen.
 *   2. A RUNNING audit row locks every record in the plan (unique lockKeys),
 *      so a double click or a second user cannot run the same deletion twice.
 *   3. Every DOWNSTREAM record is soft-deleted in one MongoDB transaction,
 *      each conditional on being exactly as planned. They leave together with
 *      the record they rest on, so nothing has to be undone on them.
 *   4. The selected record goes through its step's own delete (the same code
 *      as a single delete), which undoes what it set on the earlier records
 *      that stay (indent items freed, PO back to "no PI", received qty off the
 *      PO, voucher balance restored, …) — that logic is never duplicated here.
 *      If that refuses, step 3 is put back exactly as it was from snapshots.
 *      (Soft-deleted records are invisible to every other request, so putting
 *      them back cannot overwrite anyone's work.)
 *   5. Pending rate-change requests of deleted POs are withdrawn, the people
 *      who created the deleted records are notified, the audit row is closed.
 *      Open FMS tasks on deleted records close on the next task sync (the
 *      route is under /api/v1/procurement).
 *
 * Without a replica set (standalone mongod) step 3 runs without a
 * transaction; a failure part-way is put back from the same snapshots
 * (atomicMode COMPENSATED on the audit row).
 */
import crypto from 'node:crypto';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';
import { ROOT_PERMISSION } from '../../../common/permissions/registry.js';
import { runAtomically, inventoryService } from '../../inventory/inventory.service.js';
import notificationsService from '../../notifications/notification.service.js';
import { FmsTask } from '../../fms-doers/fmsDoer.model.js';
import DocumentApproval from '../../approvals/approval.model.js';

import PurchaseIndent from '../indent/indent.model.js';
import VendorPurchaseOrder from '../purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from '../follow-up/followUp.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../advance-payment/advancePayment.model.js';
import GoodsReceiptNote from '../grn/grn.model.js';
import ServiceCompletion from '../service-completion/serviceCompletion.model.js';
import IncomingQC from '../incoming-qc/incomingQc.model.js';
import VendorInvoice from '../vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../voucher/voucher.model.js';
import PurchaseTallyEntry from '../tally-entry/tallyEntry.model.js';
import VendorFinalPayment from '../final-payment/finalPayment.model.js';
import RateChangeRequest from '../rate-change/rateChange.model.js';

import { indentService } from '../indent/indent.service.js';
import { purchaseOrderService } from '../purchase-order/purchaseOrder.service.js';
import { followUpService } from '../follow-up/followUp.service.js';
import { proformaInvoiceService } from '../proforma-invoice/proformaInvoice.service.js';
import { advancePaymentService } from '../advance-payment/advancePayment.service.js';
import { grnService } from '../grn/grn.service.js';
import { incomingQcService } from '../incoming-qc/incomingQc.service.js';
import { vendorInvoiceService } from '../vendor-invoice/vendorInvoice.service.js';
import { voucherService } from '../voucher/voucher.service.js';
import { tallyEntryService } from '../tally-entry/tallyEntry.service.js';
import { finalPaymentService } from '../final-payment/finalPayment.service.js';
import { rateChangeService } from '../rate-change/rateChange.service.js';
import { invoicesHoldingAdvance } from '../vendor-invoice/piAdvance.js';
import { quotationStepDone } from '../indent/quotationSteps.js';

import {
  STEP_TYPES, STEP_ORDER, INDENT_STEP_TYPES, isRootType, blockOf, warningsOf, foreignRefs, reasonRequired, rootEffects,
} from './cascadeDelete.graph.js';
import PurchaseCascadeDeletion, { CASCADE_STATUS } from './cascadeDelete.model.js';
import { RecycleBinItem } from '../../recycle-bin/recycleBin.model.js';
import { binPlan } from '../../recycle-bin/recycleBin.restore.js';

const MODELS = {
  INDENT: PurchaseIndent,
  PO: VendorPurchaseOrder,
  FOLLOW_UP: PurchaseFollowUp,
  PI: ProformaInvoice,
  ADVANCE_PAYMENT: AdvancePayment,
  GRN: GoodsReceiptNote,
  SERVICE_COMPLETION: ServiceCompletion,
  INCOMING_QC: IncomingQC,
  VENDOR_INVOICE: VendorInvoice,
  VOUCHER: VendorVoucher,
  TALLY_ENTRY: PurchaseTallyEntry,
  FINAL_PAYMENT: VendorFinalPayment,
};
/** The record type a step lives on (Step 1.2 / 1.3 live on the indent). */
const docType = (type) => (INDENT_STEP_TYPES.includes(type) ? 'INDENT' : type);

const live = { isDeleted: { $ne: true } };
const STALE_LOCK_MS = 10 * 60 * 1000;
const keyOf = (type, id) => `${type}:${id}`;
const numberOf = (type, d) => STEP_TYPES[type]?.numberOf(d) || '';
const statusOf = (d) => d.overallStatus || d.poStatus || d.followUpStatus || d.piStatus || d.paymentStatus || d.grnStatus
  || d.qcStatus || d.invoiceStatus || d.voucherStatus || d.tallyEntryStatus || d.status || '';
const record = (type, d) => ({
  type, stepCode: STEP_TYPES[type].code, stepLabel: STEP_TYPES[type].label, id: d._id, number: numberOf(type, d), status: statusOf(d),
});

/** Records that rest directly on a set of records of one type. Cancelled / rejected ones included — they would be orphans. */
const CHILDREN = {
  INDENT: (ids) => [
    { type: 'PO', filter: { $or: [{ indentId: { $in: ids } }, { indentIds: { $in: ids } }, { 'items.indentId': { $in: ids } }] } },
    { type: 'INCOMING_QC', filter: { indentId: { $in: ids }, sourceType: 'SERVICE' } },
    { type: 'SERVICE_COMPLETION', filter: { indentId: { $in: ids } } },
  ],
  PO: (ids) => [
    { type: 'FOLLOW_UP', filter: { poId: { $in: ids } } },
    { type: 'PI', filter: { poId: { $in: ids } } },
    { type: 'ADVANCE_PAYMENT', filter: { poId: { $in: ids } } },
    { type: 'GRN', filter: { $or: [{ poId: { $in: ids } }, { poIds: { $in: ids } }] } },
    { type: 'INCOMING_QC', filter: { poId: { $in: ids } } },
    { type: 'VENDOR_INVOICE', filter: { poId: { $in: ids } } },
    { type: 'VOUCHER', filter: { poId: { $in: ids } } }, // incl. expense vouchers Against PO
  ],
  PI: (ids) => [{ type: 'ADVANCE_PAYMENT', filter: { piId: { $in: ids } } }],
  GRN: (ids) => [
    { type: 'INCOMING_QC', filter: { grnId: { $in: ids } } },
    { type: 'VENDOR_INVOICE', filter: { $or: [{ grnId: { $in: ids } }, { grnIds: { $in: ids } }, { 'items.grnId': { $in: ids } }] } },
    { type: 'VOUCHER', filter: { $or: [{ grnId: { $in: ids } }, { grnIds: { $in: ids } }] } }, // incl. expense vouchers Against GRN
  ],
  INCOMING_QC: (ids) => [
    { type: 'VENDOR_INVOICE', filter: { $or: [{ qcId: { $in: ids } }, { qcIds: { $in: ids } }, { 'items.qcId': { $in: ids } }] } },
  ],
  VENDOR_INVOICE: (ids) => [{ type: 'VOUCHER', filter: { invoiceId: { $in: ids } } }],
  VOUCHER: (ids) => [
    { type: 'TALLY_ENTRY', filter: { voucherId: { $in: ids } } },
    { type: 'FINAL_PAYMENT', filter: { voucherId: { $in: ids } } },
  ],
};

/** Every live record downstream of the root, breadth-first, each once. */
const collectDownstream = async (rootType, root) => {
  const rootKey = keyOf(docType(rootType), root._id);
  const found = new Map();
  let frontier = [{ type: docType(rootType), ids: [root._id] }];
  // A follow-up, a payment and a plain Tally entry have nothing resting on them;
  // a COMPLETED Tally entry carries the voucher's final payments (they need it).
  if (['FOLLOW_UP', 'ADVANCE_PAYMENT', 'FINAL_PAYMENT'].includes(rootType)) frontier = [];
  if (rootType === 'TALLY_ENTRY') {
    frontier = [];
    if (root.tallyEntryStatus === 'COMPLETED') {
      const fps = await VendorFinalPayment.find({ voucherId: root.voucherId, ...live }).lean();
      fps.forEach((d) => found.set(keyOf('FINAL_PAYMENT', d._id), { type: 'FINAL_PAYMENT', doc: d }));
    }
  }
  while (frontier.length) {
    const next = new Map();
    for (const { type, ids } of frontier) {
      for (const { type: t, filter } of CHILDREN[type]?.(ids) || []) {
        const docs = await MODELS[t].find({ ...filter, ...live }).lean();
        for (const d of docs) {
          const k = keyOf(t, d._id);
          if (k === rootKey || found.has(k)) continue;
          found.set(k, { type: t, doc: d });
          if (!next.has(t)) next.set(t, []);
          next.get(t).push(d._id);
        }
      }
    }
    frontier = [...next].map(([type, ids]) => ({ type, ids }));
  }
  return [...found.values()].sort((a, b) => STEP_ORDER.indexOf(a.type) - STEP_ORDER.indexOf(b.type)
    || String(numberOf(a.type, a.doc)).localeCompare(String(numberOf(b.type, b.doc)), 'en', { numeric: true }));
};

/** The records one step up from a record (what it rests on). */
const parentsOf = (type, d) => {
  const ids = (...v) => v.flat().filter(Boolean);
  switch (type) {
    case 'PO': return [{ type: 'INDENT', ids: ids(d.indentId, d.indentIds || [], (d.items || []).map((l) => l.indentId)) }];
    case 'FOLLOW_UP':
    case 'PI': return [{ type: 'PO', ids: ids(d.poId) }];
    case 'ADVANCE_PAYMENT': return [{ type: 'PI', ids: ids(d.piId) }];
    case 'GRN': return d.isWithoutPo ? [] : [{ type: 'PO', ids: ids(d.poId, d.poIds || []) }];
    case 'INCOMING_QC': return d.sourceType === 'SERVICE' ? [{ type: 'INDENT', ids: ids(d.indentId) }] : [{ type: 'GRN', ids: ids(d.grnId) }];
    case 'VENDOR_INVOICE': return [{ type: 'INCOMING_QC', ids: ids(d.qcId, d.qcIds || [], (d.items || []).map((l) => l.qcId)) }];
    case 'VOUCHER':
      if (d.invoiceId) return [{ type: 'VENDOR_INVOICE', ids: ids(d.invoiceId) }];
      return [{ type: 'GRN', ids: ids(d.grnId, d.grnIds || []) }, { type: 'PO', ids: ids(d.poId) }];
    case 'TALLY_ENTRY':
    case 'FINAL_PAYMENT': return [{ type: 'VOUCHER', ids: ids(d.voucherId) }];
    default: return [];
  }
};

/** Every earlier step the root rests on — left exactly as it is. */
const collectUpstream = async (rootType, root) => {
  const seen = new Map();
  const add = (type, d) => {
    const k = keyOf(type, d._id);
    if (!seen.has(k)) seen.set(k, { type, doc: d });
  };
  let frontier = INDENT_STEP_TYPES.includes(rootType) ? [] : parentsOf(rootType, root);
  if (INDENT_STEP_TYPES.includes(rootType)) add('INDENT', root);
  // A final payment also needs its voucher's completed Tally entry.
  if (rootType === 'FINAL_PAYMENT') {
    (await PurchaseTallyEntry.find({ voucherId: root.voucherId, ...live, tallyEntryStatus: 'COMPLETED' }).lean()).forEach((d) => add('TALLY_ENTRY', d));
  }
  for (let depth = 0; frontier.length && depth < 10; depth += 1) {
    const next = [];
    for (const { type, ids } of frontier) {
      const todo = [...new Set(ids.map(String))].filter((id) => !seen.has(keyOf(type, id)));
      if (!todo.length) continue;
      const docs = await MODELS[type].find({ _id: { $in: todo }, ...live }).lean();
      docs.forEach((d) => { add(type, d); next.push(...parentsOf(type, d)); });
    }
    frontier = next;
  }
  const groups = new Map();
  const push = (type, d) => {
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({ id: d._id, number: numberOf(type, d), status: statusOf(d) });
  };
  for (const { type, doc } of seen.values()) {
    push(type, doc);
    if (type === 'INDENT') {
      // The quotation steps done on a kept indent stay too — except the one being deleted.
      ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL'].forEach((step) => {
        const isDeleted = step === rootType || (rootType === 'QUOTE_COMPARATIVE' && step === 'QUOTATION_APPROVAL');
        if (!isDeleted && quotationStepDone(doc, step)) push(step, doc);
      });
    }
  }
  return STEP_ORDER.filter((t) => groups.has(t)).map((t) => ({
    type: t, stepCode: STEP_TYPES[t].code, stepLabel: STEP_TYPES[t].label, records: groups.get(t),
  }));
};

/** Numbers of the records a set of { type, id } refs points at (for messages). */
const numbersFor = async (refs) => {
  const out = new Map();
  const byType = new Map();
  refs.forEach((r) => { if (!byType.has(r.type)) byType.set(r.type, new Set()); byType.get(r.type).add(String(r.id)); });
  for (const [type, ids] of byType) {
    const docs = await MODELS[type].find({ _id: { $in: [...ids] } }).lean();
    docs.forEach((d) => out.set(keyOf(type, d._id), numberOf(type, d)));
  }
  return out;
};

/** Refusals of the selected record's OWN step delete, found up front so the preview can say so. */
const rootCheck = async (rootType, root) => {
  const blockers = [];
  const block = (reason, action, of = { type: rootType, doc: root }) => blockers.push({
    ...record(of.type, of.doc), reason, action,
  });
  switch (rootType) {
    case 'INCOMING_QC':
      if (!['DRAFT', 'IN_PROGRESS', 'CANCELLED'].includes(root.qcStatus)) {
        block(`QC completed (${root.qcStatus}) — its accepted quantity is already in stock.`,
          'A completed Incoming QC cannot be deleted from Purchase FMS. Correct the stock with an inventory adjustment if needed.');
      }
      break;
    case 'ADVANCE_PAYMENT': {
      if (root.paymentStatus !== 'CANCELLED') {
        const holding = await invoicesHoldingAdvance(root.piId);
        holding.forEach((inv) => block(`Vendor invoice ${inv.invoiceNumber} has already adjusted ₹${inv.advancePaid} of this advance.`,
          'Delete or reject that invoice first, then this payment.', { type: 'VENDOR_INVOICE', doc: inv }));
      }
      const latest = await AdvancePayment.findOne({ piId: root.piId, ...live }).sort('-createdAt').select('paymentNumber').lean();
      if (latest && String(latest._id) !== String(root._id)) {
        block(`A later payment (${latest.paymentNumber}) was recorded on the same PI.`, `Delete ${latest.paymentNumber} first — payments on a PI go latest first.`);
      }
      break;
    }
    case 'PI': {
      // An invoice belongs to the goods side (GRN → QC); deleting the PI never deletes it.
      const invs = await VendorInvoice.find({ piId: root._id, ...live, invoiceStatus: { $ne: 'REJECTED' } }).lean();
      invs.forEach((inv) => block('Adjusts this PI\'s advance. It belongs to the goods-receipt side (GRN → QC) and is not deleted with a PI.',
        'Delete it from Vendor Invoices first (or delete the PO, which removes both sides).', { type: 'VENDOR_INVOICE', doc: inv }));
      break;
    }
    case 'FOLLOW_UP': {
      // A follow-up never takes a GRN with it. While it is the one that made the
      // PO ready for GRN, the GRNs received since are named instead.
      if (['PENDING', 'RESCHEDULED'].includes(root.followUpStatus)) break;
      const otherReady = await PurchaseFollowUp.exists({ poId: root.poId, _id: { $ne: root._id }, ...live, followUpStatus: 'READY_FOR_GRN' });
      if (otherReady) break;
      const grns = await GoodsReceiptNote.find({ $or: [{ poId: root.poId }, { poIds: root.poId }], ...live, grnStatus: { $ne: 'CANCELLED' } }).lean();
      grns.forEach((g) => block('Received after this follow-up made the PO ready for GRN. A follow-up never deletes a goods receipt.',
        'Delete the GRN on its own first if it was wrong, then this follow-up.', { type: 'GRN', doc: g }));
      break;
    }
    case 'GRN':
      // Same refusal as the GRN's own delete: posted stock is never taken back here.
      if (root.stockPosted || (await inventoryService.getMovementsByRef('GRN', root._id)).length
        || (root.items || []).some((l) => l.stockStatus === 'POSTED' || l.movementId)) {
        block('Stock was already posted from this GRN.', 'Stock cannot be reversed from Purchase FMS. Correct it with an inventory adjustment; the GRN stays.');
      }
      break;
    default:
      break;
  }
  return blockers;
};

const hasPermission = (perms, slug) => !perms || perms.has(ROOT_PERMISSION) || perms.has(slug);

const loadRoot = async (rootType, id) => {
  if (!isRootType(rootType)) throw new AppError(`Unknown Purchase FMS step: ${rootType}`, 400);
  const root = await MODELS[docType(rootType)].findOne({ _id: id, ...live }).lean();
  if (!root) throw new AppError(`${STEP_TYPES[rootType].label} not found — it may have been deleted already`, 404);
  if (INDENT_STEP_TYPES.includes(rootType) && !quotationStepDone(root, rootType)) {
    throw new AppError(`${STEP_TYPES[rootType].label} (Step ${STEP_TYPES[rootType].code}) has not been done on indent ${root.indentNumber || ''} — there is nothing to delete`.replace('  ', ' '), 400);
  }
  return root;
};

const fingerprint = (rootType, root, downstream, blockers) => {
  const line = (type, d) => `${type}:${d._id}:${statusOf(d)}:${d.updatedAt ? new Date(d.updatedAt).getTime() : ''}`;
  const parts = [
    line(rootType, root),
    ...downstream.map(({ type, doc }) => line(type, doc)).sort(),
    ...blockers.map((b) => `B:${b.type}:${b.id}`).sort(),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
};

/** The whole plan for deleting `rootType` record `id`. `perms` = the caller's permission Set. */
const buildPlan = async (rootType, id, perms) => {
  const root = await loadRoot(rootType, id);
  const downstream = await collectDownstream(rootType, root);
  const rootIndentId = docType(rootType) === 'INDENT' ? root._id : null;
  const deleting = new Set([keyOf(docType(rootType), root._id), ...downstream.map(({ type, doc }) => keyOf(type, doc._id))]);

  const blockers = [...await rootCheck(rootType, root)];
  const foreign = [];
  for (const { type, doc } of downstream) {
    const stockMovements = type === 'GRN' ? (await inventoryService.getMovementsByRef('GRN', doc._id)).length : 0;
    const b = blockOf(type, { ...doc, stockMovements });
    if (b) blockers.push({ ...record(type, doc), ...b });
    foreignRefs(type, doc, { rootType, deleting, rootIndentId }).forEach((ref) => foreign.push({ type, doc, ref }));
  }
  if (foreign.length) {
    const numbers = await numbersFor(foreign.map((f) => f.ref));
    foreign.forEach(({ type, doc, ref }) => {
      const other = `${STEP_TYPES[ref.type].label} ${numbers.get(keyOf(ref.type, ref.id)) || ''}`.trim();
      blockers.push({
        ...record(type, doc),
        reason: `Also belongs to ${other}, which is not being deleted.`,
        action: `It is shared with another workflow and is never deleted with this one. Separate it first, or delete ${other} on its own.`,
      });
    });
  }

  // Grouped by step, in workflow order; the selected step first.
  const groups = new Map();
  for (const { type, doc } of downstream) {
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({ ...record(type, doc), warnings: warningsOf(type, doc) });
  }
  const rootRecord = { ...record(rootType, root), warnings: INDENT_STEP_TYPES.includes(rootType) ? [] : warningsOf(rootType, root) };
  // Deleting Step 1.2 also takes back Step 1.3 when it was approved (same indent document).
  const sameDocSteps = rootType === 'QUOTE_COMPARATIVE' && quotationStepDone(root, 'QUOTATION_APPROVAL')
    ? [{ type: 'QUOTATION_APPROVAL', stepCode: '1.3', stepLabel: STEP_TYPES.QUOTATION_APPROVAL.label, count: 1, records: [{ ...record('QUOTATION_APPROVAL', root), warnings: [] }] }]
    : [];
  const affected = [
    { type: rootType, stepCode: STEP_TYPES[rootType].code, stepLabel: STEP_TYPES[rootType].label, count: 1, selected: true, records: [rootRecord] },
    ...sameDocSteps,
    ...STEP_ORDER.filter((t) => groups.has(t)).map((t) => ({
      type: t, stepCode: STEP_TYPES[t].code, stepLabel: STEP_TYPES[t].label, count: groups.get(t).length, records: groups.get(t),
    })),
  ];

  // What changes on records that stay, and what is kept for audit.
  const upstream = await collectUpstream(rootType, root);
  const firstOf = (type) => upstream.find((g) => g.type === type)?.records[0]?.number || '';
  const effects = rootEffects(rootType, root, {
    number: numberOf(docType(rootType), root),
    poNumber: firstOf('PO'),
    piNumber: firstOf('PI'),
    voucherNumber: firstOf('VOUCHER'),
    invoiceNumber: firstOf('VENDOR_INVOICE'),
  });
  const poIds = [...(rootType === 'PO' ? [root._id] : []), ...downstream.filter((x) => x.type === 'PO').map((x) => x.doc._id)];
  const deletedIds = [...(INDENT_STEP_TYPES.includes(rootType) ? [] : [root._id]), ...downstream.map((x) => x.doc._id)];
  const [pendingRateChanges, openTasks, approvals] = await Promise.all([
    poIds.length ? RateChangeRequest.countDocuments({ poId: { $in: poIds }, status: 'PENDING' }) : 0,
    deletedIds.length ? FmsTask.countDocuments({ entityId: { $in: deletedIds }, status: 'OPEN' }) : 0,
    deletedIds.length ? DocumentApproval.countDocuments({ documentId: { $in: deletedIds }, isDeleted: { $ne: true } }) : 0,
  ]);
  if (pendingRateChanges) effects.push(`${pendingRateChanges} pending rate change request(s) on the deleted PO(s) are withdrawn (their history is kept).`);
  if (openTasks) effects.push(`${openTasks} open FMS task(s) on the deleted records are closed.`);
  if (approvals) effects.push(`The MD approval / signature history of ${approvals} deleted record(s) is kept for audit.`);
  if (deletedIds.length) effects.push('Deleted records are kept as deleted (with their documents and history) for audit; they disappear from every list.');

  const missingPermissions = [...new Set([rootType, ...downstream.map((x) => x.type)].map((t) => STEP_TYPES[t].permission))]
    .filter((slug) => !hasPermission(perms, slug));

  return {
    root: rootRecord,
    rootDoc: root,
    downstream,
    affected,
    blockers,
    preserved: upstream,
    effects,
    missingPermissions,
    downstreamCount: downstream.length + sameDocSteps.length,
    totalRecords: 1 + downstream.length + sameDocSteps.length,
    reasonRequired: reasonRequired(rootType, root, downstream.length + sameDocSteps.length),
    canDelete: !blockers.length && !missingPermissions.length,
    planToken: fingerprint(rootType, root, downstream, blockers),
  };
};

/** The plan as the client sees it (no raw documents). */
const publicPlan = (plan) => {
  const { rootDoc, downstream, ...rest } = plan;
  return rest;
};

/** The selected record's own step delete — the same code a single delete runs. */
const removeRoot = (rootType, id, user, reason) => {
  switch (rootType) {
    case 'INDENT': return indentService.remove(id, user, { reason });
    case 'QUOTE_COMPARATIVE':
    case 'QUOTATION_APPROVAL': return indentService.resetQuotationStep(id, rootType, user, { reason });
    case 'PO': return purchaseOrderService.remove(id, user, { reason });
    case 'FOLLOW_UP': return followUpService.remove(id, user, { reason });
    case 'PI': return proformaInvoiceService.remove(id, user, { reason });
    case 'ADVANCE_PAYMENT': return advancePaymentService.remove(id, user);
    case 'GRN': return grnService.remove(id, user, { reason });
    case 'INCOMING_QC': return incomingQcService.remove(id, user);
    case 'VENDOR_INVOICE': return vendorInvoiceService.remove(id, user, { reason });
    case 'VOUCHER': return voucherService.remove(id, user, { reason });
    case 'TALLY_ENTRY': return tallyEntryService.remove(id, user, { reason });
    case 'FINAL_PAYMENT': return finalPaymentService.remove(id, user);
    default: throw new AppError(`Unknown Purchase FMS step: ${rootType}`, 400);
  }
};

const planChanged = () => Object.assign(
  new AppError('These records changed after the confirmation was shown. Review the updated list and confirm again.', 409),
  { data: { code: 'PLAN_CHANGED' } },
);

/** Step 3: every downstream record soft-deleted, each only if still exactly as planned. */
const softDeleteDownstream = async (downstream, { user, stamp, description }) => {
  const byType = new Map();
  downstream.forEach((x) => { if (!byType.has(x.type)) byType.set(x.type, []); byType.get(x.type).push(x.doc); });
  let atomicMode = 'COMPENSATED';
  await runAtomically(async (session) => {
    atomicMode = session ? 'TRANSACTION' : 'COMPENSATED';
    for (const [type, docs] of byType) {
      const ops = docs.map((d) => ({
        updateOne: {
          filter: { _id: d._id, ...live, updatedAt: d.updatedAt ?? null },
          update: {
            $set: {
              isDeleted: true, deletedAt: stamp, deletedBy: user?._id, updatedBy: user?._id,
              // A soft-deleted active follow-up would still hold the partial unique index.
              ...(type === 'FOLLOW_UP' ? { isActiveFollowUp: false } : {}),
            },
            // A stale copy saved by another request now fails its version check instead of un-deleting it.
            $inc: { __v: 1 },
            $push: { activityTimeline: { action: 'DELETE', description: description(type, d), actorId: user?._id, timestamp: stamp } },
          },
        },
      }));
      const res = await MODELS[type].bulkWrite(ops, { ordered: true, ...(session ? { session } : {}) });
      if (res.matchedCount !== docs.length) throw planChanged();
    }
  });
  return atomicMode;
};

/** Put step 3 back exactly as it was (only rows this deletion stamped). */
const restoreDownstream = async (downstream, stamp) => {
  for (const { type, doc } of downstream) {
    try {
      await MODELS[type].collection.replaceOne({ _id: doc._id, isDeleted: true, deletedAt: stamp }, doc);
    } catch (err) {
      logger.error(`[cascade-delete] could not restore ${type} ${doc._id}: ${err.message}`);
    }
  }
};

/**
 * Recycle Bin: the selected record's own delete (step 4) made its bin row; the
 * downstream records deleted with it are added to that row, so one Restore
 * brings back the whole set. Never fails the deletion.
 */
const addDownstreamToBin = async (plan, stamp) => {
  if (!plan.downstream.length) return;
  const row = await RecycleBinItem.findOne({ recordId: plan.rootDoc._id, status: 'pending', deletedAt: { $gte: stamp } })
    .sort({ deletedAt: -1 }).select('subtitle keywords').lean();
  if (!row) return;
  const groups = new Map();
  for (const { type, doc } of plan.downstream) {
    // A deleted follow-up was taken off "active"; it gets back what it had.
    const set = type === 'FOLLOW_UP' ? { isActiveFollowUp: doc.isActiveFollowUp === true } : {};
    const key = `${type}|${JSON.stringify(set)}`;
    if (!groups.has(key)) groups.set(key, { model: MODELS[type].modelName, set, ids: [] });
    groups.get(key).ids.push(doc._id);
  }
  const numbers = plan.downstream.map(({ type, doc }) => numberOf(type, doc)).filter(Boolean);
  const shown = numbers.slice(0, 5).join(', ') + (numbers.length > 5 ? '…' : '');
  await RecycleBinItem.updateOne({ _id: row._id }, {
    $push: { 'plan.steps': { $each: [...groups.values()].map((g) => binPlan.unhide(g.model, g.ids, g.set, { timeline: true })) } },
    $set: {
      subtitle: [row.subtitle, `+ ${plan.downstream.length} linked record(s) deleted with it${shown ? `: ${shown}` : ''}`].filter(Boolean).join(' · '),
      keywords: [row.keywords, ...numbers].filter(Boolean).join(' ').toLowerCase(),
    },
  });
};

let indexesReady = null;
const ensureIndexes = () => {
  // The lock is the unique index — make sure it exists before relying on it.
  indexesReady ||= PurchaseCascadeDeletion.createIndexes().catch((err) => { indexesReady = null; throw err; });
  return indexesReady;
};

const takeLock = async (plan, rootType, user, { reason, ip, userAgent }) => {
  await ensureIndexes();
  await PurchaseCascadeDeletion.updateMany(
    { status: CASCADE_STATUS.RUNNING, startedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } },
    { $set: { status: CASCADE_STATUS.FAILED, error: 'Abandoned — the server stopped while this deletion was running', finishedAt: new Date() } },
  );
  const deleted = [plan.root, ...plan.downstream.map(({ type, doc }) => record(type, doc))]
    .map(({ type, stepCode, stepLabel, id, number, status }) => ({ type, stepCode, stepLabel, id, number, status }));
  const counts = Object.fromEntries(plan.affected.map((g) => [g.type, g.count]));
  try {
    return await PurchaseCascadeDeletion.create({
      rootType,
      rootId: plan.rootDoc._id,
      rootNumber: plan.root.number,
      rootStepLabel: plan.root.stepLabel,
      reason,
      status: CASCADE_STATUS.RUNNING,
      lockKeys: [keyOf(docType(rootType), plan.rootDoc._id), ...plan.downstream.map(({ type, doc }) => keyOf(type, doc._id))],
      deleted,
      preserved: plan.preserved.flatMap((g) => g.records.map((r) => ({ type: g.type, stepCode: g.stepCode, stepLabel: g.stepLabel, ...r }))),
      effects: plan.effects,
      counts,
      rootSnapshot: INDENT_STEP_TYPES.includes(rootType)
        ? { quoteStep: plan.rootDoc.quoteStep, quoteComparativeStep: plan.rootDoc.quoteComparativeStep, quotationApprovalStep: plan.rootDoc.quotationApprovalStep, items: plan.rootDoc.items }
        : null,
      initiatedBy: user?._id,
      initiatedByName: user?.name || '',
      ipAddress: ip || '',
      userAgent: String(userAgent || '').slice(0, 300),
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError('These records are already being deleted (the same deletion is running right now). Wait a moment and refresh.', 409);
    }
    throw err;
  }
};

/** Step 5 — never fails the deletion. */
const afterDelete = async (plan, rootType, user, reason) => {
  const rootLabel = `${plan.root.stepLabel} ${plan.root.number}`.trim();
  for (const { doc } of plan.downstream.filter((x) => x.type === 'PO')) {
    await rateChangeService.withdrawForPo(doc._id, `PO ${numberOf('PO', doc)} was deleted with ${rootLabel}`, user);
  }
  if (!INDENT_STEP_TYPES.includes(rootType) && (plan.downstreamCount || reason)) {
    await MODELS[rootType].updateOne({ _id: plan.rootDoc._id }, {
      $push: {
        activityTimeline: {
          action: 'CASCADE_DELETE',
          description: `Deleted with ${plan.downstreamCount} downstream record(s).${reason ? ` Reason: ${reason}` : ''}`,
          actorId: user?._id,
          timestamp: new Date(),
        },
      },
    }).catch((err) => logger.error(`[cascade-delete] root timeline note failed: ${err.message}`));
  }
  const owners = new Set([plan.rootDoc, ...plan.downstream.map((x) => x.doc)]
    .map((d) => d.createdBy && String(d.createdBy)).filter((u) => u && u !== String(user?._id)));
  const list = plan.affected.map((g) => `${g.stepLabel} (${g.count})`).join(', ');
  for (const userId of owners) {
    await notificationsService.notify(userId, {
      type: 'PURCHASE_DELETED',
      title: `Purchase FMS: ${rootLabel} deleted`,
      body: `${user?.name || 'A user'} deleted ${rootLabel}${plan.downstreamCount ? ` and ${plan.downstreamCount} downstream record(s)` : ''}: ${list}.${reason ? ` Reason: ${reason}` : ''}`,
      link: null,
    });
  }
};

export const cascadeDeleteService = {
  async preview(rootType, id, perms) {
    return publicPlan(await buildPlan(rootType, id, perms));
  },

  async execute(rootType, id, { reason = '', acknowledged = false, planToken = '' } = {}, user, { perms, ip, userAgent } = {}) {
    if (acknowledged !== true) {
      throw new AppError('Tick "I have read and understood…" to confirm the deletion of every record listed', 400);
    }
    const plan = await buildPlan(rootType, id, perms);
    if (!planToken || planToken !== plan.planToken) throw planChanged();
    if (plan.missingPermissions.length) {
      throw new AppError(`You do not have permission to delete every record listed (missing: ${plan.missingPermissions.join(', ')})`, 403);
    }
    if (plan.blockers.length) {
      throw Object.assign(
        new AppError(`This deletion is blocked: ${plan.blockers.map((b) => `${b.stepLabel} ${b.number} — ${b.reason}`).join(' ')}`, 409),
        { data: { code: 'BLOCKED', blockers: plan.blockers } },
      );
    }
    const why = String(reason || '').trim().slice(0, 500);
    if (plan.reasonRequired && why.length < 3) throw new AppError('Give the reason for this deletion (at least 3 characters)', 400);

    const audit = await takeLock(plan, rootType, user, { reason: why, ip, userAgent });
    const stamp = new Date();
    const rootLabel = `${plan.root.stepLabel} ${plan.root.number}`.trim();
    let atomicMode = '';
    let rolledBack = false;
    try {
      if (plan.downstream.length) {
        try {
          atomicMode = await softDeleteDownstream(plan.downstream, {
            user,
            stamp,
            description: (type) => `${STEP_TYPES[type].label} deleted with ${rootLabel} (cascade ${audit._id}).${why ? ` Reason: ${why}` : ''}`,
          });
        } catch (err) {
          // Inside a transaction nothing was written; without one, put back what was.
          await restoreDownstream(plan.downstream, stamp);
          rolledBack = true;
          throw err;
        }
      }
      try {
        await removeRoot(rootType, plan.rootDoc._id, user, why);
        await addDownstreamToBin(plan, stamp)
          .catch((err) => logger.error(`[cascade-delete] Recycle Bin row for ${rootLabel} not extended: ${err.message}`));
      } catch (err) {
        if (plan.downstream.length) {
          await restoreDownstream(plan.downstream, stamp);
          rolledBack = true;
        }
        throw err;
      }
      try {
        await afterDelete(plan, rootType, user, why);
      } catch (err) {
        logger.error(`[cascade-delete] follow-up work after ${rootLabel} failed: ${err.message}`);
      }
      await PurchaseCascadeDeletion.updateOne({ _id: audit._id }, {
        $set: { status: CASCADE_STATUS.COMPLETED, atomicMode, finishedAt: new Date() },
      });
      return {
        auditId: audit._id,
        root: plan.root,
        deletedCount: plan.totalRecords,
        downstreamCount: plan.downstreamCount,
        affected: plan.affected.map(({ type, stepCode, stepLabel, count }) => ({ type, stepCode, stepLabel, count })),
        preserved: plan.preserved,
        atomicMode,
      };
    } catch (err) {
      await PurchaseCascadeDeletion.updateOne({ _id: audit._id }, {
        $set: { status: CASCADE_STATUS.FAILED, atomicMode, rolledBack, error: String(err?.message || err).slice(0, 1000), finishedAt: new Date() },
      }).catch((e) => logger.error(`[cascade-delete] audit close failed: ${e.message}`));
      throw err;
    }
  },

  /** Cascade deletions that removed this record (as the selected step or downstream), newest first. */
  async history({ recordId, limit = 20 } = {}) {
    const filter = recordId ? { $or: [{ rootId: recordId }, { 'deleted.id': recordId }] } : {};
    return PurchaseCascadeDeletion.find(filter).select('-lockKeys -rootSnapshot').sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 20, 100)).lean();
  },
};

export default cascadeDeleteService;
