import VendorVoucher, { VOUCHER_STATUS, VOUCHER_TYPE, EXPENSE_TYPE } from './voucher.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_APPROVAL_STATUS } from '../purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../grn/grn.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { AppError } from '../../../utils/apiResponse.js';

/**
 * Expense voucher linkage — what an EXPENSE voucher is raised against.
 *
 *  • DIRECT      — no PO, no GRN (the original Direct Bill Passing voucher).
 *  • AGAINST_PO  — an approved PO that is paid as an expense instead of through
 *                  GRN → Incoming QC → Vendor Invoice → Purchase Voucher. ONE
 *                  payment path per PO: allowed only while the PO has no live
 *                  GRN and no live vendor invoice, and while a live expense
 *                  voucher holds the PO, new GRNs / vendor invoices on it are
 *                  refused (assertNoLiveExpenseOnPos). Expense vouchers on one
 *                  PO together stay within the PO value.
 *  • AGAINST_GRN — a completed GRN raised WITHOUT a PO. Vendor Invoice refuses
 *                  those GRNs (no PO rate to price against), so this is their
 *                  only payment path. One live expense voucher per GRN.
 *
 * The vendor always comes from the linked document; a client-sent vendorId
 * that differs is refused rather than silently replaced. "Live" = not deleted
 * and not CANCELLED (GRN) / REJECTED (invoice) / CANCELLED (voucher).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.005;
const live = { isDeleted: { $ne: true } };

// PO states an expense may be raised against (poStatus APPROVED or later is set
// only by approval; older POs may lack approvalStatus, so only REJECTED is
// checked there). Received POs always have a GRN.
export const EXPENSE_PO_STATUSES = [PO_STATUS.APPROVED, PO_STATUS.RELEASED_TO_VENDOR, PO_STATUS.CLOSED];
// GRN states that mean the material was actually received.
export const EXPENSE_GRN_STATUSES = [GRN_STATUS.RECEIVED, GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED];

export const EMPTY_EXPENSE_LINK = { poId: null, poNumber: '', grnId: null, grnIds: [], grnNumbers: [] };

const liveExpenseVouchers = (extra = {}, excludeId = null) => ({
  ...live,
  voucherType: VOUCHER_TYPE.EXPENSE,
  voucherStatus: { $ne: VOUCHER_STATUS.CANCELLED },
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  ...extra,
});

const liveGrnsOnPo = (poId) => ({ ...live, grnStatus: { $ne: GRN_STATUS.CANCELLED }, $or: [{ poId }, { poIds: poId }] });
const liveInvoicesOnPo = (poId) => ({ ...live, invoiceStatus: { $ne: INVOICE_STATUS.REJECTED }, poId });

/** Bill value before TDS / advance deductions — what is compared with the PO value. */
export const grossBillAmount = (d = {}) => round2(
  round2(d.basicValue) + round2(d.freightCharges) + round2(d.packingForwardingCharges)
  + round2(d.otherCharges) + round2(d.taxAmount) + round2(d.tcsAmount),
);

const sumGross = (vouchers) => round2(vouchers.reduce((s, v) => s + grossBillAmount(v), 0));
const AMOUNT_FIELDS = 'basicValue freightCharges packingForwardingCharges otherCharges taxAmount tcsAmount';
const inr = (n) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const assertSameVendor = (requestedVendorId, doc, noun) => {
  if (!requestedVendorId) return;
  if (String(requestedVendorId) !== String(doc.vendorId || '')) {
    throw new AppError(`The vendor does not match the selected ${noun}'s vendor (${doc.vendorName || '—'}) — an expense against a ${noun} is always billed to its vendor`, 400);
  }
};

/** The GRN or vendor invoice that already pays this PO the normal way, if any. */
const poPaymentPathConflict = async (po) => {
  const grn = await GoodsReceiptNote.findOne(liveGrnsOnPo(po._id)).select('grnNumber').lean();
  if (grn) return `PO ${po.poNumber} already has GRN ${grn.grnNumber || '(draft)'} — it is paid through GRN → Vendor Invoice → Purchase Voucher, not as an expense`;
  const inv = await VendorInvoice.findOne(liveInvoicesOnPo(po._id)).select('invoiceNumber').lean();
  if (inv) return `PO ${po.poNumber} already has vendor invoice ${inv.invoiceNumber} — it is paid through its Purchase Voucher, not as an expense`;
  return null;
};

const poValueConflict = async (po, gross, excludeId) => {
  const cap = round2(po.grandTotal);
  if (!(cap > 0)) return null; // no PO value to measure against
  const others = await VendorVoucher.find(liveExpenseVouchers({ poId: po._id }, excludeId)).select(AMOUNT_FIELDS).lean();
  const already = sumGross(others);
  if (already + round2(gross) > cap + EPS) {
    return `Expense vouchers against PO ${po.poNumber} would total ${inr(already + gross)}, above the PO value ${inr(cap)}`
      + (already > 0 ? ` (already raised: ${inr(already)})` : '');
  }
  return null;
};

const grnTakenConflict = async (grn, excludeId) => {
  const other = await VendorVoucher.findOne(liveExpenseVouchers({ grnId: grn._id }, excludeId)).select('voucherNumber').lean();
  return other ? `GRN ${grn.grnNumber} is already billed on expense voucher ${other.voucherNumber}` : null;
};

/**
 * Validate the PO / GRN an expense voucher is raised against and return the
 * linkage + vendor to store. `data` is the full (merged) voucher data.
 * Throws AppError (400/404) on any rule; DIRECT returns empty links.
 */
export const resolveExpenseLink = async (data, { excludeId = null, gross = 0, requestedVendorId } = {}) => {
  const expenseType = data.expenseType || EXPENSE_TYPE.DIRECT;

  if (expenseType === EXPENSE_TYPE.AGAINST_PO) {
    if (!data.poId) throw new AppError('Select the Purchase Order this expense is against', 400);
    const po = await VendorPurchaseOrder.findOne({ _id: data.poId, ...live })
      .select('poNumber vendorId vendorName approvalStatus poStatus grandTotal').lean();
    if (!po) throw new AppError('Purchase Order not found', 404);
    const statusError = new AppError(`PO ${po.poNumber || po._id} is ${po.approvalStatus === PO_APPROVAL_STATUS.REJECTED ? 'REJECTED' : po.poStatus} — an expense can only be raised against an approved PO that has not been received or cancelled`, 400);
    if (po.approvalStatus === PO_APPROVAL_STATUS.REJECTED || [PO_STATUS.DRAFT, PO_STATUS.CANCELLED].includes(po.poStatus) || !po.poNumber) throw statusError;
    // A received PO is refused for its GRN — the clearer reason.
    const pathConflict = await poPaymentPathConflict(po);
    if (pathConflict) throw new AppError(pathConflict, 400);
    if (!EXPENSE_PO_STATUSES.includes(po.poStatus)) throw statusError;
    assertSameVendor(requestedVendorId, po, 'PO');
    const valueConflict = await poValueConflict(po, gross, excludeId);
    if (valueConflict) throw new AppError(valueConflict, 400);
    return {
      expenseType,
      link: { ...EMPTY_EXPENSE_LINK, poId: po._id, poNumber: po.poNumber },
      vendor: { vendorId: po.vendorId, vendorName: po.vendorName || '' },
      label: `PO ${po.poNumber}`,
    };
  }

  if (expenseType === EXPENSE_TYPE.AGAINST_GRN) {
    if (!data.grnId) throw new AppError('Select the GRN this expense is against', 400);
    const grn = await GoodsReceiptNote.findOne({ _id: data.grnId, ...live })
      .select('grnNumber isWithoutPo poNumber poNumbers grnStatus vendorId vendorName').lean();
    if (!grn) throw new AppError('GRN not found', 404);
    if (!grn.isWithoutPo) {
      const pos = (grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ');
      throw new AppError(`GRN ${grn.grnNumber} was raised against PO ${pos || '—'} — it is paid through Incoming QC → Vendor Invoice → Purchase Voucher. Expense Against GRN is only for GRNs raised without a PO`, 400);
    }
    if (!EXPENSE_GRN_STATUSES.includes(grn.grnStatus)) {
      throw new AppError(`GRN ${grn.grnNumber} is ${grn.grnStatus} — complete the GRN before billing it`, 400);
    }
    assertSameVendor(requestedVendorId, grn, 'GRN');
    const conflict = await grnTakenConflict(grn, excludeId);
    if (conflict) throw new AppError(conflict, 400);
    return {
      expenseType,
      link: { ...EMPTY_EXPENSE_LINK, grnId: grn._id, grnIds: [grn._id], grnNumbers: [grn.grnNumber] },
      vendor: { vendorId: grn.vendorId, vendorName: grn.vendorName || '' },
      label: `GRN ${grn.grnNumber}`,
    };
  }

  return { expenseType: EXPENSE_TYPE.DIRECT, link: { ...EMPTY_EXPENSE_LINK }, vendor: null, label: '' };
};

/**
 * Re-check, AFTER a linked expense voucher was written, the rules a concurrent
 * request could have broken in between (a GRN / invoice raised on the PO, two
 * vouchers on one GRN, vouchers together above the PO value). Every voucher
 * write runs this after itself, so two conflicting vouchers may both be refused
 * but are never both kept. A GRN draft that slips in beside a voucher is
 * stopped at GRN completion (grn.service complete → assertNoLiveExpenseOnPos).
 * Returns the conflict message, or null.
 */
export const expenseLinkConflictAfterWrite = async (v) => {
  if (v.voucherType !== VOUCHER_TYPE.EXPENSE || v.isDeleted || v.voucherStatus === VOUCHER_STATUS.CANCELLED) return null;
  if (v.expenseType === EXPENSE_TYPE.AGAINST_PO && v.poId) {
    const po = await VendorPurchaseOrder.findById(v.poId).select('poNumber grandTotal').lean();
    if (!po) return 'Purchase Order not found';
    return await poPaymentPathConflict(po) || await poValueConflict(po, grossBillAmount(v), v._id);
  }
  if (v.expenseType === EXPENSE_TYPE.AGAINST_GRN && v.grnId) {
    return grnTakenConflict({ _id: v.grnId, grnNumber: v.grnNumbers?.[0] || '' }, v._id);
  }
  return null;
};

/**
 * Refuse a GRN / vendor invoice on a PO that a live expense voucher is paying
 * (the other half of "one payment path per PO"). `pos` = [{ _id, poNumber }];
 * `action` completes the sentence, e.g. 'a GRN cannot be raised on it'.
 */
export const assertNoLiveExpenseOnPos = async (pos, action) => {
  const ids = (pos || []).map((p) => p?._id).filter(Boolean);
  if (!ids.length) return;
  const v = await VendorVoucher.findOne(liveExpenseVouchers({ expenseType: EXPENSE_TYPE.AGAINST_PO, poId: { $in: ids } }))
    .select('voucherNumber poId poNumber voucherStatus').lean();
  if (!v) return;
  const poNumber = v.poNumber || pos.find((p) => String(p._id) === String(v.poId))?.poNumber || '';
  throw new AppError(
    `PO ${poNumber} is being paid as an expense (voucher ${v.voucherNumber}, Expense Against PO), so ${action}.`
    + (v.voucherStatus === VOUCHER_STATUS.DRAFT ? ' Cancel that draft voucher first if the PO should go through GRN instead.' : ''),
    400,
  );
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Picker options for the voucher form: only the POs / GRNs an expense can be
 * raised against right now (same rules as resolveExpenseLink). `excludeVoucherId`
 * keeps the voucher being edited from blocking its own document.
 */
export const listExpenseLinkOptions = async ({ type, search, excludeVoucherId } = {}) => {
  const rx = search ? new RegExp(escapeRegex(search.trim()), 'i') : null;

  if (type === 'GRN') {
    const grns = await GoodsReceiptNote.find({
      ...live, isWithoutPo: true, grnStatus: { $in: EXPENSE_GRN_STATUSES },
      ...(rx ? { $or: [{ grnNumber: rx }, { vendorName: rx }, { invoiceNumber: rx }] } : {}),
    }).sort('-grnDate -createdAt').limit(200)
      .select('grnNumber grnDate vendorId vendorName grnStatus qcStatus totalValue invoiceNumber invoiceDate').lean();
    const taken = new Set((await VendorVoucher.find(liveExpenseVouchers({ grnId: { $in: grns.map((g) => g._id) } }, excludeVoucherId))
      .distinct('grnId')).map(String));
    return grns.filter((g) => !taken.has(String(g._id)));
  }

  const pos = await VendorPurchaseOrder.find({
    ...live, approvalStatus: { $ne: PO_APPROVAL_STATUS.REJECTED }, poStatus: { $in: EXPENSE_PO_STATUSES }, poNumber: { $nin: [null, ''] },
    ...(rx ? { $or: [{ poNumber: rx }, { vendorName: rx }] } : {}),
  }).sort('-poDate -createdAt').limit(200)
    .select('poNumber poDate vendorId vendorName poStatus grandTotal paymentTerms').lean();
  if (!pos.length) return [];
  const ids = pos.map((p) => p._id);
  const [grnRows, invPoIds, vouchers] = await Promise.all([
    GoodsReceiptNote.find({ ...live, grnStatus: { $ne: GRN_STATUS.CANCELLED }, $or: [{ poId: { $in: ids } }, { poIds: { $in: ids } }] })
      .select('poId poIds').lean(),
    VendorInvoice.find({ ...live, invoiceStatus: { $ne: INVOICE_STATUS.REJECTED }, poId: { $in: ids } }).distinct('poId'),
    VendorVoucher.find(liveExpenseVouchers({ poId: { $in: ids } }, excludeVoucherId)).select(`poId ${AMOUNT_FIELDS}`).lean(),
  ]);
  const blocked = new Set(invPoIds.map(String));
  for (const g of grnRows) [g.poId, ...(g.poIds || [])].filter(Boolean).forEach((id) => blocked.add(String(id)));
  return pos
    .filter((p) => !blocked.has(String(p._id)))
    .map((p) => {
      const expensedAmount = sumGross(vouchers.filter((v) => String(v.poId) === String(p._id)));
      const cap = round2(p.grandTotal);
      return { ...p, expensedAmount, remainingAmount: cap > 0 ? round2(Math.max(0, cap - expensedAmount)) : null };
    })
    .filter((p) => p.remainingAmount === null || p.remainingAmount > EPS);
};
