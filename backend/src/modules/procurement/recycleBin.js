/**
 * Purchase FMS → Recycle Bin.
 *
 * Every step's delete hides its record (isDeleted) and undoes what that record
 * had set on earlier records. `binDeleted` puts the record in the bin; its
 * restore unhides it and — through hooks each step's service registers — puts
 * back what the delete undid, but only while that is still exactly right.
 * When the records around it have moved on since (a newer PI, another payment,
 * the advance used elsewhere …) the restore is refused with the reason.
 *
 * The pure rules below are what those hooks decide with; they are tested
 * without a database (__tests__/recycleBin.test.js).
 */
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan, registerRestoreHook } from '../recycle-bin/recycleBin.restore.js';
import { AppError } from '../../utils/apiResponse.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idStr = (v) => (v == null ? '' : String(v));

export const inr = (n) => `₹${round2(n).toLocaleString('en-IN')}`;

/** The restoring person as the services' `user` (they read user._id / user.name). */
export const asUser = (actor) => ({ _id: actor?.id || null, name: actor?.name || '' });

/** Refuse a restore (409) — the message is shown in the bin as is. */
export const refuse = (message) => { throw new AppError(message, 409); };

/**
 * Put a soft-deleted Purchase FMS record in the Recycle Bin. Never fails the
 * delete. `set` = fields the unhide puts back; `before` / `after` = hooks.
 */
export const binDeleted = (type, Model, doc, { title, subtitle, keywords, reason, user, set = {}, before = [], after = [] } = {}) =>
  recycleBinService.record(type, {
    recordId: doc._id,
    title,
    subtitle,
    keywords,
    reason,
    actor: user,
    plan: {
      before,
      steps: [binPlan.unhide(Model.modelName, doc._id, set, { timeline: true })],
      after,
      afterCommit: [binPlan.hook('procurement.fmsResync')],
    },
  });

// A restored record gets its FMS doer task back (as after any Purchase FMS write).
registerRestoreHook('procurement.fmsResync', async (_args, { actor }) => {
  const { fmsDoerService } = await import('../fms-doers/fmsDoer.service.js');
  fmsDoerService.enqueueSync({ actor: asUser(actor), notify: true, openedVia: 'WORKFLOW' });
});

/** Do these fields still hold exactly the values saved at delete time? */
export const sameFields = (current, saved, keys) => keys.every((k) => {
  const a = current?.[k];
  const b = saved?.[k];
  if (a instanceof Date || b instanceof Date) return (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  if (typeof a === 'number' || typeof b === 'number') return round2(a) === round2(b);
  return idStr(a ?? '') === idStr(b ?? '');
});

/** Just the named fields (a snapshot to compare / put back). */
export const pick = (doc, keys) => Object.fromEntries(keys.map((k) => [k, doc?.[k] ?? null]));

// ── Purchase Order ↔ its indent(s) ─────────────────────────────────────────

/**
 * The indent slots a PO holds: approved vendors (multi-vendor indents) or
 * items (item-level indents) pointing at it. Saved at delete time, before the
 * delete releases them.
 */
export const indentLinksOf = (indent, poId) => {
  const avs = indent?.quotationApprovalStep?.approvedVendors || [];
  if (avs.length) {
    return { indentId: indent._id, vendors: avs.filter((av) => idStr(av.poId) === idStr(poId)).map((av) => idStr(av._id)), items: [] };
  }
  return { indentId: indent._id, vendors: [], items: (indent?.items || []).filter((it) => idStr(it.poId) === idStr(poId)).map((it) => idStr(it._id)) };
};

/**
 * Give the PO its indent slots back (mutates `indent`). Returns the refusal
 * message when a slot is gone or another PO has taken it since, else null.
 * The caller then rolls the indent status up as PO creation does.
 */
export const relinkIndentToPo = (indent, po, links, statuses) => {
  const ref = po.poNumber || po.draftNumber || '';
  const avs = indent.quotationApprovalStep?.approvedVendors || [];
  for (const id of links.vendors || []) {
    const av = avs.find((a) => idStr(a._id) === id);
    if (!av) return `Indent ${indent.indentNumber}: the approved vendor this PO was for is no longer on it.`;
    if (av.poId && idStr(av.poId) !== idStr(po._id)) return `Indent ${indent.indentNumber}: that vendor now has PO ${av.poNumber || ''} — the old PO can't take it back.`.replace('  ', ' ');
  }
  for (const id of links.items || []) {
    const it = (indent.items || []).find((i) => idStr(i._id) === id);
    if (!it) return `Indent ${indent.indentNumber}: an item this PO was for is no longer on it.`;
    if (it.poId && idStr(it.poId) !== idStr(po._id)) return `Indent ${indent.indentNumber}: "${it.itemName}" is now on PO ${it.poNumber || ''} — the old PO can't take it back.`.replace('  ', ' ');
  }
  (links.vendors || []).forEach((id) => {
    const av = avs.find((a) => idStr(a._id) === id);
    av.poId = po._id;
    av.poNumber = ref;
  });
  (links.items || []).forEach((id) => {
    const it = indent.items.find((i) => idStr(i._id) === id);
    it.poId = po._id;
    it.poNumber = ref;
    it.procurementStatus = statuses.PO_CREATED;
  });
  return null;
};

// ── Follow-up → the PO's follow-up mirror ──────────────────────────────────

/**
 * The PO's follow-up mirror once a follow-up is back (null = leave it). A
 * restored "ready for GRN" follow-up makes the PO ready again (with the date
 * it had, when the PO still shows the state the delete left); any other one
 * means a follow-up is running. A ready or closed PO is never moved back.
 */
export const followUpMirrorAfterRestore = (po, fu, savedMirror, S, PS) => {
  if ([PS.READY_FOR_GRN, PS.CLOSED].includes(po.followUpStatus)) return null;
  if (fu.followUpStatus === S.READY_FOR_GRN) {
    const was = savedMirror?.followUpStatus === PS.READY_FOR_GRN;
    return {
      followUpStatus: PS.READY_FOR_GRN,
      readyForGrnAt: (was && savedMirror.readyForGrnAt) || new Date(),
      finalMaterialDate: fu.finalMaterialDate || (was ? savedMirror.finalMaterialDate : null) || null,
    };
  }
  return po.followUpStatus === PS.IN_PROGRESS ? null : { followUpStatus: PS.IN_PROGRESS };
};

// ── Advance payment → its PI ───────────────────────────────────────────────

/**
 * Why a deleted advance payment can't be posted back onto its PI, or null.
 * Payments are reversed newest-first from a balance snapshot, so it can only
 * come back while it would again be the newest and the PI stands exactly
 * where its delete left it.
 */
export const advanceRestoreBlock = (pi, payment, { newer = [], piStatus }) => {
  if (!pi) return `PI ${payment.piNumber || ''} is deleted — restore the PI first.`.replace('  ', ' ');
  if (newer.length) return `A newer payment (${newer.map((p) => p.paymentNumber).join(', ')}) was made on PI ${pi.piNumber} since — this one can't go back before it.`;
  if (pi.piStatus !== piStatus.READY_FOR_ADVANCE_PAYMENT) return `PI ${pi.piNumber} is ${String(pi.piStatus || '').replace(/_/g, ' ').toLowerCase()} now, so the payment can't be posted back.`;
  if (round2(pi.balanceAmount) !== round2(payment.previousBalance)) {
    return `PI ${pi.piNumber}'s balance is ${inr(pi.balanceAmount)} now (it was ${inr(payment.previousBalance)} when this payment was made) — it can't be posted back exactly.`;
  }
  if (round2(pi.totalValue - (pi.paidAmount || 0) - payment.paidAmount) !== round2(payment.balanceAmount)) {
    return `PI ${pi.piNumber}'s paid amount has changed since — the payment can't be posted back exactly.`;
  }
  return null;
};

/** What posting the payment back sets on the PI — the same rules as recording it. */
export const advanceRestorePatch = (pi, payment, { piStatus, paymentStatus }) => {
  const paidAmount = round2((pi.paidAmount || 0) + payment.paidAmount);
  const balanceAmount = round2(pi.totalValue - paidAmount);
  const closes = balanceAmount === 0 || payment.paymentStatus === paymentStatus.SHORT_PAYMENT_COMPLETED;
  return { paidAmount, balanceAmount, closes, piStatus: closes ? piStatus.PAYMENT_COMPLETED : pi.piStatus };
};

// ── Final payment → voucher + invoice ──────────────────────────────────────

/** Voucher fields a final payment (and its cancel / delete) moves. */
export const VOUCHER_MONEY_FIELDS = ['paidAmount', 'balanceAmount', 'voucherStatus', 'finalPaymentStatus'];

// ── Vendor invoice → the QC quantities it billed ───────────────────────────

/** invoicedQtyMap's { byLine, bySku } as plain [key, qty] pairs (safe to store). */
export const billingPairs = ({ byLine = {}, bySku = {} } = {}) => [
  ...Object.entries(byLine).map(([k, v]) => [`L:${k}`, round2(v)]),
  ...Object.entries(bySku).map(([k, v]) => [`S:${k}`, round2(v)]),
].sort(([a], [b]) => a.localeCompare(b));

/**
 * Has anything more been billed on these QC lines since the invoice was
 * deleted? (Less is fine — e.g. another invoice was rejected meanwhile.)
 */
export const billedMoreSince = (nowPairs, savedPairs) => {
  const saved = new Map(savedPairs || []);
  return (nowPairs || []).some(([k, v]) => round2(v) > round2(saved.get(k) || 0));
};
