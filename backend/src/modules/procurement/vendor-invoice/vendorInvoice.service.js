import VendorInvoice, { INVOICE_STATUS, INVOICE_VARIANCE_STATUS, normalizeInvoiceNumber, invoiceNumberChanged } from './vendorInvoice.model.js';
import { getAdvancePosition, withPiAdvanceLock } from './piAdvance.js';
import { assertInvoiceNumberProtection } from './invoiceNumberIndexGuard.js';
import IncomingQC, { QC_STATUS } from '../incoming-qc/incomingQc.model.js';
import GoodsReceiptNote from '../grn/grn.model.js';
import VendorPurchaseOrder from '../purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';
export { getAdvancePosition }; // re-exported for the controller / existing imports
// Pure line builders — exported for the unit tests (no DB needed).
export { buildInvoiceItems, resolveInvoicedByLine };

const QC_LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Run `work` holding a short-lived advisory lock on every selected QC, so two
 * concurrent Vendor Invoice creates can never both invoice the same QC/GRN.
 * Mirrors withPiAdvanceLock's TTL-claim pattern (piAdvance.js), but keyed on
 * the QCs themselves rather than a PI — this also covers the case where the
 * PO/QC has no PI at all, where withPiAdvanceLock is a no-op.
 */
const withQcInvoiceLock = async (qcIds, work) => {
  const ids = [...new Set(qcIds.map(String))];
  if (!ids.length) return work();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - QC_LOCK_TTL_MS);
  const res = await IncomingQC.updateMany(
    { _id: { $in: ids }, $or: [{ invoiceLockAt: null }, { invoiceLockAt: { $lt: staleBefore } }] },
    { $set: { invoiceLockAt: now } },
  );
  if (res.modifiedCount !== ids.length) {
    await IncomingQC.updateMany({ _id: { $in: ids }, invoiceLockAt: now }, { $set: { invoiceLockAt: null } }).catch(() => {});
    throw new AppError('One or more selected GRNs/QCs are being invoiced by another request right now. Please try again in a moment.', 409);
  }
  try {
    return await work();
  } finally {
    await IncomingQC.updateMany({ _id: { $in: ids }, invoiceLockAt: now }, { $set: { invoiceLockAt: null } })
      .catch((err) => logger.error(`[vendor-invoice] failed to release QC invoice lock: ${err.message}`));
  }
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const sameSku = (a, b) => a && b && String(a).toUpperCase() === String(b).toUpperCase();
const sameItem = (a, b) => sameSku(a.skuCode, b.skuCode) || (a.itemName && b.itemName && a.itemName === b.itemName);
const itemKey = (qcId, skuCode, itemName) => `${String(qcId)}|${String(skuCode || itemName || '').toUpperCase()}`;
const lineKey = (qcId, qcItemId) => `${String(qcId)}#${String(qcItemId)}`;

/**
 * Already-invoiced qty across existing non-rejected invoices touching these QCs.
 *   byLine — per exact QC line (qcId + qcItemId), for invoice lines that record it
 *   bySku  — per qcId + SKU, for invoice lines created before line-level refs
 * Considers both the per-item source qcId (multi-GRN) and the legacy header qcId.
 * Optionally excludes one invoice (when recomputing during an edit).
 */
const invoicedQtyMap = async (qcIds, excludeInvoiceId) => {
  const filter = {
    isDeleted: { $ne: true },
    invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
    $or: [{ qcId: { $in: qcIds } }, { qcIds: { $in: qcIds } }, { 'items.qcId': { $in: qcIds } }],
  };
  if (excludeInvoiceId) filter._id = { $ne: excludeInvoiceId };
  const invoices = await VendorInvoice.find(filter).select('qcId items').lean();
  const byLine = {};
  const bySku = {};
  for (const inv of invoices) {
    for (const it of inv.items || []) {
      const qid = it.qcId || inv.qcId; // per-item source, else legacy header
      if (!qid) continue;
      const qty = Number(it.invoiceQty) || 0;
      if (it.qcItemId) {
        const k = lineKey(qid, it.qcItemId);
        byLine[k] = round2((byLine[k] || 0) + qty);
      } else {
        const k = itemKey(qid, it.skuCode, it.itemName);
        bySku[k] = round2((bySku[k] || 0) + qty);
      }
    }
  }
  return { byLine, bySku };
};

/**
 * Already-invoiced qty for each line of one QC (array aligned with qc.items).
 * Line-tagged qty lands on its own line. SKU-only qty (older invoices) is spread
 * over the QC's lines of that SKU in QC order, filling each line's remaining
 * accepted qty first — any excess stays on the last such line, so it still
 * shows as fully invoiced instead of being silently lost.
 */
const resolveInvoicedByLine = (qc, { byLine = {}, bySku = {} } = {}) => {
  const lines = qc.items || [];
  const out = lines.map((qi) => round2(byLine[lineKey(qc._id, qi._id)] || 0));
  const left = {};
  lines.forEach((qi, idx) => {
    const k = itemKey(qc._id, qi.skuCode, qi.itemName);
    if (!(k in left)) left[k] = round2(bySku[k] || 0);
    if (left[k] <= 0) return;
    const isLast = !lines.slice(idx + 1).some((n) => itemKey(qc._id, n.skuCode, n.itemName) === k);
    const room = Math.max(0, round2(round2(qi.acceptedQty) - out[idx]));
    const take = isLast ? left[k] : Math.min(room, left[k]);
    out[idx] = round2(out[idx] + take);
    left[k] = round2(left[k] - take);
  });
  return out;
};

/**
 * PO line a QC line is priced from: the GRN line's own poItemId when known (a PO
 * can list one SKU twice at different rates), else the first PO line of that SKU.
 */
const matchPoLine = (poItems, qi, poItemIdByGrnItem = {}) => {
  const poItemId = qi.grnItemId && poItemIdByGrnItem[String(qi.grnItemId)];
  return (poItemId && poItems.find((p) => String(p._id) === String(poItemId)))
    || poItems.find((p) => sameItem(p, qi)) || {};
};

/** grnItemId → poItemId (and grnId → grnDate) for the GRNs behind these QCs. */
const loadGrnLineRefs = async (qcs) => {
  const grnIds = uniq(qcs.map((q) => q.grnId));
  const grns = grnIds.length
    ? await GoodsReceiptNote.find({ _id: { $in: grnIds } }).select('grnDate items._id items.poItemId').lean()
    : [];
  const poItemIdByGrnItem = {};
  const grnDateById = {};
  for (const g of grns) {
    grnDateById[String(g._id)] = g.grnDate || null;
    for (const it of g.items || []) if (it.poItemId) poItemIdByGrnItem[String(it._id)] = it.poItemId;
  }
  return { poItemIdByGrnItem, grnDateById };
};

/**
 * Build authoritative invoice items across one or more QCs (received/accepted from
 * the QC, rate/GST from the PO), merging user-editable fields from submitted rows.
 * One invoice line per QC line — never merged by SKU, so the same SKU on several
 * lines of one GRN (or across GRNs) keeps its own qty. A submitted row is matched
 * to its QC line by qcItemId; rows without one (older clients / invoices) match
 * by source qcId + SKU in order, each row used once.
 */
const buildInvoiceItems = (qcs = [], poItems = [], submitted = [], invoiced = {}, poItemIdByGrnItem = {}) => {
  const used = new Set();
  const takeSub = (qcId, qi) => {
    let i = submitted.findIndex((s, j) => !used.has(j) && s.qcItemId && String(s.qcItemId) === String(qi._id));
    if (i < 0) {
      i = submitted.findIndex((s, j) => !used.has(j) && !s.qcItemId
        && String(s.qcId || s.sourceQcId || '') === String(qcId) && sameItem(s, qi));
    }
    if (i < 0) return {};
    used.add(i);
    return submitted[i];
  };

  const items = [];
  for (const qc of qcs) {
    const invoicedByLine = resolveInvoicedByLine(qc, invoiced);
    (qc.items || []).forEach((qi, idx) => {
      const s = takeSub(qc._id, qi);
      const po = matchPoLine(poItems, qi, poItemIdByGrnItem);
      const acceptedQty = round2(qi.acceptedQty);
      const alreadyInvoicedQty = invoicedByLine[idx];
      const pendingInvoiceQty = Math.max(0, round2(acceptedQty - alreadyInvoicedQty));
      let invoiceQty = s.invoiceQty != null ? round2(s.invoiceQty) : pendingInvoiceQty;
      invoiceQty = Math.max(0, invoiceQty);
      const rate = round2(s.rate != null ? s.rate : po.rate);
      const gstRate = round2(s.gstRate != null ? s.gstRate : po.gstRate);
      const taxableAmount = round2(invoiceQty * rate);
      const gstAmount = round2(taxableAmount * gstRate / 100);
      const varianceQty = round2(invoiceQty - acceptedQty);
      const varianceStatus = varianceQty === 0
        ? INVOICE_VARIANCE_STATUS.MATCHED
        : (varianceQty < 0 ? INVOICE_VARIANCE_STATUS.SHORT : INVOICE_VARIANCE_STATUS.EXCESS);
      items.push({
        grnId: qc.grnId || undefined, grnNumber: qc.grnNumber || '',
        qcId: qc._id, qcNumber: qc.qcNumber || '',
        qcItemId: qi._id, grnItemId: qi.grnItemId || null, batchNo: qi.batchNo || '',
        skuId: qi.skuId || undefined, skuCode: qi.skuCode || '', itemName: qi.itemName || '', unit: qi.unit || 'Pcs',
        orderedQty: round2(po.quantity), grnReceivedQty: round2(qi.receivedQty),
        receivedQty: round2(qi.receivedQty), acceptedQty, rejectedQty: round2(qi.rejectedQty),
        alreadyInvoicedQty, pendingInvoiceQty,
        invoiceQty, varianceQty, varianceStatus,
        rate, gstRate, taxableAmount, gstAmount,
        totalAmount: round2(taxableAmount + gstAmount),
        remarks: (s.remarks || '').trim(),
      });
    });
  }
  return {
    items,
    totals: {
      taxableAmount: round2(items.reduce((a, i) => a + i.taxableAmount, 0)),
      gstAmount:     round2(items.reduce((a, i) => a + i.gstAmount, 0)),
      invoiceAmount: round2(items.reduce((a, i) => a + i.totalAmount, 0)),
    },
  };
};

// Block invoicing more than the remaining (pending) accepted qty unless overridden
// or each excess line is justified with remarks.
const assertWithinPending = (items, allowExcess) => {
  if (allowExcess) return;
  const offenders = items.filter((i) => round2(i.invoiceQty) > round2(i.pendingInvoiceQty) && !i.remarks);
  if (offenders.length) {
    throw new AppError(
      `Invoice qty exceeds remaining accepted (pending) qty for: ${offenders.map((o) => o.itemName).join(', ')}. Reduce the qty, add remarks, or use override permission.`,
      400,
    );
  }
};

// Invoice can only be raised once QC has passed (fully or partially).
const QC_INVOICEABLE = [QC_STATUS.PASSED, QC_STATUS.PARTIAL];

const normalizeDoc = (d) => (d?.fileUrl
  ? { fileName: d.fileName || '', fileUrl: d.fileUrl, fileType: d.fileType || '', uploadedAt: new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const computeNetPayable = (inv) =>
  round2((inv.invoiceAmount || 0) - (inv.debitNoteAmount || 0) - (inv.advancePaid || 0));

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

/** Allocate what is available, but never more than the invoice's payable basis. */
const allocateAdvance = (available, invoiceAmount, debitNoteAmount) =>
  Math.max(0, Math.min(round2(available), round2((invoiceAmount || 0) - (debitNoteAmount || 0))));

// Validate a set of QCs can be invoiced together (same vendor, same PO, QC passed).
const loadAndValidateQcs = async (qcIdList) => {
  const qcs = await IncomingQC.find({ _id: { $in: qcIdList }, isDeleted: { $ne: true } }).lean();
  if (qcs.length !== qcIdList.length) throw new AppError('One or more selected QCs were not found', 404);
  for (const qc of qcs) {
    if (!QC_INVOICEABLE.includes(qc.qcStatus)) {
      throw new AppError(`QC ${qc.qcNumber} is not invoiceable — Incoming QC must be PASSED or PARTIAL`, 400);
    }
    // A GRN raised without a PO (W/O PO) has no PO rate/GST for an invoice line
    // to be priced against — explicitly refused rather than silently invoicing
    // at ₹0. uniq() below drops falsy poIds, so this would otherwise slip past
    // the "same PO" check entirely instead of being caught.
    if (qc.grnId && !qc.poId) {
      throw new AppError(`QC ${qc.qcNumber} was raised from a GRN with no Purchase Order (W/O PO) — Vendor Invoice is not yet supported for GRNs without a PO`, 400);
    }
  }
  const vendorIds = uniq(qcs.map((q) => q.vendorId));
  if (vendorIds.length > 1) throw new AppError('All selected GRNs/QCs must belong to the same vendor', 400);
  const poIds = uniq(qcs.map((q) => q.poId));
  if (poIds.length > 1) throw new AppError('All selected GRNs/QCs must belong to the same PO', 400);
  return inSelectionOrder(qcs, qcIdList);
};

// $in returns documents in storage order; keep the user's pick order so the
// legacy single refs (= first selected GRN/QC) and the line order are stable.
const inSelectionOrder = (qcs, qcIdList) => qcIdList
  .map((id) => qcs.find((q) => String(q._id) === String(id)))
  .filter(Boolean);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const duplicateNumberError = (existing) => {
  const grns = (existing?.grnNumbers?.length ? existing.grnNumbers : [existing?.grnNumber]).filter(Boolean).join(', ');
  return new AppError(
    `Vendor invoice ${existing?.invoiceNumber || ''} is already recorded for this vendor${grns ? ` (GRN ${grns})` : ''}. One invoice covering several GRNs must be entered once with all its GRNs selected.`,
    400,
  );
};

/**
 * One vendor invoice number is recorded once per vendor (case-insensitive) —
 * an invoice covering several GRNs is ONE invoice with all of them selected, not
 * the same number entered per GRN. Rejected / deleted invoices don't count.
 * Same rule the expense voucher applies to its bill number (assertNoDuplicateBill).
 *
 * This read is the friendly pre-check (and the only check against invoices
 * recorded before invoiceNumberKey existed). It cannot stop two concurrent
 * requests that both pass it — the partial unique index on
 * { vendorId, invoiceNumberKey } does that; see saveUniqueNumber.
 */
const assertUniqueInvoiceNumber = async (vendorId, invoiceNumber, excludeInvoiceId = null) => {
  const no = String(invoiceNumber || '').trim();
  if (!vendorId || !no) return;
  const filter = {
    vendorId,
    invoiceNumber: new RegExp(`^${escapeRegex(no)}$`, 'i'),
    isDeleted: { $ne: true },
    invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
  };
  if (excludeInvoiceId) filter._id = { $ne: excludeInvoiceId };
  const existing = await VendorInvoice.findOne(filter).select('invoiceNumber grnNumber grnNumbers').lean();
  if (existing) throw duplicateNumberError(existing);
};

/**
 * Run an invoice write (create / save). If MongoDB rejects it on the live
 * invoice-number index — another request recorded the same vendor + number
 * between our pre-check and this write — answer with the same validation
 * message as the pre-check instead of a raw duplicate-key error. Nothing else
 * was written by then: the invoice (and its PI advance share) is this one write.
 */
const saveUniqueNumber = async (write, vendorId, invoiceNumber) => {
  try {
    return await write();
  } catch (err) {
    if (err?.code !== 11000 || !err?.keyPattern?.invoiceNumberKey) throw err;
    const winner = await VendorInvoice.findOne({ vendorId, invoiceNumberKey: normalizeInvoiceNumber(invoiceNumber) })
      .select('invoiceNumber grnNumber grnNumbers').lean();
    throw duplicateNumberError(winner || { invoiceNumber });
  }
};

/** Every QC an invoice was raised from (multi-GRN list, else the legacy single ref). */
const invoiceQcIds = (inv) => uniq(inv.qcIds?.length ? inv.qcIds : (inv.qcId ? [inv.qcId] : []));

const findOrThrow = async (id) => {
  const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!inv) throw new AppError('Vendor invoice not found', 404);
  return inv;
};

export const vendorInvoiceService = {
  async create(data, user, opts = {}) {
    // No new invoice number is taken until the unique index is confirmed in the DB.
    await assertInvoiceNumberProtection();
    // Accept one QC (legacy) or many (multi-GRN). All must share vendor + PO.
    const rawIds = data.qcIds?.length ? data.qcIds : (data.qcId ? [data.qcId] : []);
    if (!rawIds.length) throw new AppError('Select at least one QC / GRN', 400);
    const qcIdList = uniq(rawIds);
    if (qcIdList.length !== rawIds.length) throw new AppError('The same GRN/QC was selected more than once', 400);
    // Lock every selected QC first (prevents two requests double-invoicing the
    // same QC/GRN even when there's no PI to serialize on), then the PI's
    // advance — read what is still unallocated, take this invoice's share, and
    // persist it before releasing.
    return withQcInvoiceLock(qcIdList, async () => {
      const qcs = await loadAndValidateQcs(qcIdList);
      const first = qcs[0];
      return withPiAdvanceLock(first.piId, () => this._createLocked(data, user, opts, qcs));
    });
  },

  async _createLocked(data, user, opts, qcs) {
    const first = qcs[0];
    await assertUniqueInvoiceNumber(first.vendorId, data.invoiceNumber);

    // Recompute items + totals authoritatively from QC quantities + PO rates,
    // accounting for what's already been invoiced on prior invoices.
    const po = first.poId ? await VendorPurchaseOrder.findById(first.poId).select('items').lean() : null;
    const invoicedMap = await invoicedQtyMap(qcs.map((q) => q._id));
    const { poItemIdByGrnItem } = await loadGrnLineRefs(qcs);
    const { items, totals: itemTotals } = buildInvoiceItems(qcs, po?.items || [], data.items || [], invoicedMap, poItemIdByGrnItem);
    if (!items.length) throw new AppError('Selected QCs have no items to invoice', 400);
    if (!items.some((it) => it.invoiceQty > 0)) throw new AppError('Enter an invoice quantity on at least one item', 400);
    assertWithinPending(items, opts.allowExcess);

    const grnIds = uniq(qcs.map((q) => q.grnId));
    const grnNumbers = uniq(qcs.map((q) => q.grnNumber));

    const doc = normalizeDoc(data.invoiceDocument);
    const debitDoc = normalizeDoc(data.debitNoteDocument);
    // Rule 2 & 6: deduct only the PI advance not yet allocated to other invoices.
    const invoiceAmount = itemTotals.invoiceAmount;
    const debitNoteAmount = data.debitNoteRequired ? round2(data.debitNoteAmount) : 0;
    const { advanceAvailable } = await getAdvancePosition(first.piId);
    const advancePaid = allocateAdvance(advanceAvailable, invoiceAmount, debitNoteAmount);
    const base = { invoiceAmount, debitNoteAmount, advancePaid };
    const netPayableAmount = computeNetPayable(base);

    const inv = await saveUniqueNumber(() => VendorInvoice.create({
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate || null,
      invoiceReceivedDate: data.invoiceReceivedDate || new Date(),
      // Legacy single refs = first selected QC/GRN (back-compat).
      qcId: first._id, qcNumber: first.qcNumber,
      grnId: first.grnId, grnNumber: first.grnNumber,
      // Multi-GRN arrays.
      qcIds: qcs.map((q) => q._id), qcNumbers: uniq(qcs.map((q) => q.qcNumber)),
      grnIds, grnNumbers,
      poId: first.poId, poNumber: first.poNumber,
      piId: first.piId, piNumber: first.piNumber,
      vendorId: first.vendorId, vendorName: first.vendorName,
      items,
      invoiceAmount: base.invoiceAmount,
      taxableAmount: itemTotals.taxableAmount,
      gstAmount: itemTotals.gstAmount,
      tdsAmount: round2(data.tdsAmount),
      otherCharges: round2(data.otherCharges),
      advancePaid,
      netPayableAmount,
      invoiceDocument: doc,
      debitNoteRequired: !!data.debitNoteRequired,
      debitNoteNumber: data.debitNoteNumber || '',
      debitNoteAmount: base.debitNoteAmount,
      debitNoteReason: data.debitNoteReason || '',
      debitNoteDocument: debitDoc,
      invoiceStatus: doc.fileUrl ? INVOICE_STATUS.RECEIVED : INVOICE_STATUS.DRAFT,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Invoice created from ${uniq(qcs.map((q) => q.qcNumber)).join(', ')}`, actorId: user?._id }],
    }), first.vendorId, data.invoiceNumber);
    return inv;
  },

  async getAll(query) {
    const features = new ApiFeatures(VendorInvoice.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['invoiceNumber', 'poNumber', 'grnNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!inv) throw new AppError('Vendor invoice not found', 404);
    return inv;
  },

  async getByQc(qcId) {
    return VendorInvoice.find({ $or: [{ qcId }, { qcIds: qcId }], isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  /**
   * QCs that can still be invoiced — PASSED/PARTIAL material QCs with remaining
   * (uninvoiced) accepted qty. Optional vendorId/poId filters for multi-GRN
   * selection (one invoice = same vendor + same PO).
   */
  async getInvoiceableQcs(query = {}) {
    const filter = {
      isDeleted: { $ne: true },
      qcStatus: { $in: QC_INVOICEABLE },
      grnId: { $ne: null }, // material QCs only (service QCs have no GRN/PO)
      // Excludes QCs sourced from a W/O PO GRN — see loadAndValidateQcs for why
      // Vendor Invoice does not yet support a GRN with no PO.
      poId: { $ne: null },
    };
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.poId) filter.poId = query.poId;
    const qcs = await IncomingQC.find(filter).sort('-createdAt').limit(300).lean();
    const invoicedMap = await invoicedQtyMap(qcs.map((q) => q._id));

    // Batch-load PO items (rate/GST/ordered qty) for the distinct POs.
    const poIds = uniq(qcs.map((q) => q.poId));
    const pos = poIds.length ? await VendorPurchaseOrder.find({ _id: { $in: poIds } }).select('items').lean() : [];
    const poItemsById = Object.fromEntries(pos.map((p) => [String(p._id), p.items || []]));
    const { poItemIdByGrnItem, grnDateById } = await loadGrnLineRefs(qcs);

    return qcs.map((qc) => {
      const poItems = poItemsById[String(qc.poId)] || [];
      const invoicedByLine = resolveInvoicedByLine(qc, invoicedMap);
      let totalAccepted = 0; let totalPending = 0;
      const items = (qc.items || []).map((it, idx) => {
        const po = matchPoLine(poItems, it, poItemIdByGrnItem);
        const accepted = round2(it.acceptedQty);
        const already = invoicedByLine[idx];
        const pending = Math.max(0, round2(accepted - already));
        totalAccepted += accepted; totalPending += pending;
        return {
          qcItemId: it._id, grnItemId: it.grnItemId || null, batchNo: it.batchNo || '',
          skuId: it.skuId, skuCode: it.skuCode || '', itemName: it.itemName || '', unit: it.unit || 'Pcs',
          orderedQty: round2(po.quantity), grnReceivedQty: round2(it.receivedQty), receivedQty: round2(it.receivedQty),
          acceptedQty: accepted, rejectedQty: round2(it.rejectedQty),
          alreadyInvoicedQty: already, pendingInvoiceQty: pending,
          rate: round2(po.rate), gstRate: round2(po.gstRate),
        };
      });
      return {
        _id: qc._id, qcNumber: qc.qcNumber, grnId: qc.grnId, grnNumber: qc.grnNumber,
        grnDate: grnDateById[String(qc.grnId)] || null, qcDate: qc.qcDate || null,
        poId: qc.poId, poNumber: qc.poNumber, piId: qc.piId, piNumber: qc.piNumber,
        vendorId: qc.vendorId, vendorName: qc.vendorName, qcStatus: qc.qcStatus, overallResult: qc.overallResult,
        totalAccepted: round2(totalAccepted), totalPendingInvoiceQty: round2(totalPending),
        items,
      };
    }).filter((q) => q.totalPendingInvoiceQty > 0); // hide fully-invoiced
  },

  /**
   * GRNs that can still be invoiced — a GRN-centric view of getInvoiceableQcs.
   * Users identify documents by GRN, not QC, so the invoice form selects GRNs and
   * the system auto-links each GRN's QC. Each entry keeps `_id` = the linked qcId
   * so the existing selection / create machinery (which submits qcIds[]) is
   * unchanged. Only GRNs whose QC is PASSED/PARTIAL with remaining pending qty
   * appear (fully-invoiced GRNs are already filtered out upstream).
   */
  async getInvoiceableGrns(query = {}) {
    const qcs = await this.getInvoiceableQcs(query);
    return qcs
      .filter((q) => q.grnId) // GRN-backed material QCs only
      .map((q) => ({
        _id: q._id, // = qcId — keeps the qcIds[] create payload working unchanged
        grnId: q.grnId, grnNumber: q.grnNumber, grnDate: q.grnDate,
        qcId: q._id, qcNumber: q.qcNumber, qcDate: q.qcDate,
        poId: q.poId, poNumber: q.poNumber,
        piId: q.piId, piNumber: q.piNumber,
        vendorId: q.vendorId, vendorName: q.vendorName,
        qcStatus: q.qcStatus, overallResult: q.overallResult,
        totalAccepted: q.totalAccepted,
        pendingInvoiceQty: q.totalPendingInvoiceQty,
        totalPendingInvoiceQty: q.totalPendingInvoiceQty, // alias for shared rows builder
        items: q.items,
      }));
  },

  async getStats() {
    const rows = await VendorInvoice.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:            { $sum: 1 },
          pendingApproval:  { $sum: { $cond: [{ $in: ['$invoiceStatus', [INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED]] }, 1, 0] } },
          approved:         { $sum: { $cond: [{ $in: ['$invoiceStatus', [INVOICE_STATUS.APPROVED, INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED]] }, 1, 0] } },
          paymentPending:   { $sum: { $cond: [{ $eq: ['$invoiceStatus', INVOICE_STATUS.PAYMENT_PENDING] }, 1, 0] } },
          paymentCompleted: { $sum: { $cond: [{ $eq: ['$invoiceStatus', INVOICE_STATUS.PAYMENT_COMPLETED] }, 1, 0] } },
          netPayable:       { $sum: '$netPayableAmount' },
        },
      },
    ]);
    return rows[0] || { total: 0, pendingApproval: 0, approved: 0, paymentPending: 0, paymentCompleted: 0, netPayable: 0 };
  },

  async update(id, data, user, opts = {}) {
    const existing = await findOrThrow(id);
    // A number change takes a (new) number — only once the unique index is
    // confirmed. Edits that keep the number can't create a duplicate and go on.
    if (invoiceNumberChanged(existing.invoiceNumber, data.invoiceNumber)) await assertInvoiceNumberProtection();
    // Re-deriving quantities competes with a concurrent create on the same QCs,
    // so take the same QC lock create does (QC lock first, then the PI's).
    const qcIdList = Array.isArray(data.items) ? invoiceQcIds(existing) : [];
    return withQcInvoiceLock(qcIdList, () =>
      withPiAdvanceLock(existing.piId, () => this._updateLocked(id, data, user, opts)));
  },

  async _updateLocked(id, data, user, opts) {
    const inv = await findOrThrow(id); // re-read under the PI lock
    const EDITABLE_STATUSES = [INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED, INVOICE_STATUS.APPROVED, INVOICE_STATUS.PAYMENT_PENDING];
    if (!EDITABLE_STATUSES.includes(inv.invoiceStatus)) {
      throw new AppError('Invoice cannot be edited after payment is completed or when rejected', 400);
    }
    // Only a CHANGED number is checked, so an invoice already sharing its number
    // with another (recorded before this rule) can still be edited. A case-only
    // change counts too: it re-keys the invoice, and the index alone can't see an
    // older unkeyed twin — this lookup (case-insensitive, self excluded) can.
    if (invoiceNumberChanged(inv.invoiceNumber, data.invoiceNumber)) {
      await assertUniqueInvoiceNumber(inv.vendorId, data.invoiceNumber, inv._id);
    }
    const { invoiceDocument, debitNoteDocument, items: submittedItems, ...rest } = data;
    Object.assign(inv, rest);

    // When items are supplied, re-derive items + amounts from the invoice's QCs +
    // PO (authoritative), excluding THIS invoice from the already-invoiced tally.
    if (Array.isArray(submittedItems)) {
      const qcIdList = invoiceQcIds(inv);
      const found = await IncomingQC.find({ _id: { $in: qcIdList }, isDeleted: { $ne: true } }).lean();
      const qcs = inSelectionOrder(found, qcIdList);
      if (qcs.some((q) => q.items?.length)) {
        const po = inv.poId ? await VendorPurchaseOrder.findById(inv.poId).select('items').lean() : null;
        const invoicedMap = await invoicedQtyMap(qcIdList, inv._id);
        const { poItemIdByGrnItem } = await loadGrnLineRefs(qcs);
        const r = buildInvoiceItems(qcs, po?.items || [], submittedItems, invoicedMap, poItemIdByGrnItem);
        assertWithinPending(r.items, opts.allowExcess);
        inv.items = r.items;
        inv.invoiceAmount = r.totals.invoiceAmount;
        inv.taxableAmount = r.totals.taxableAmount;
        inv.gstAmount = r.totals.gstAmount;
      }
    }

    if (invoiceDocument) inv.invoiceDocument = normalizeDoc(invoiceDocument);
    if (debitNoteDocument) inv.debitNoteDocument = normalizeDoc(debitNoteDocument);
    if (!inv.debitNoteRequired) inv.debitNoteAmount = 0;
    // Re-allocate this invoice's advance share: what other live invoices on the
    // PI hold is excluded from "available", so its own previous share is never
    // counted twice.
    // Once a voucher has been raised it carries its own copy of the advance, so
    // the share is frozen (capped only so it never exceeds the payable basis).
    if (inv.voucherId) {
      inv.advancePaid = Math.min(round2(inv.advancePaid), Math.max(0, round2(inv.invoiceAmount - inv.debitNoteAmount)));
    } else {
      const { advanceAvailable } = await getAdvancePosition(inv.piId, inv._id);
      inv.advancePaid = allocateAdvance(advanceAvailable, inv.invoiceAmount, inv.debitNoteAmount);
    }
    inv.netPayableAmount = computeNetPayable(inv);
    if (inv.invoiceDocument?.fileUrl && inv.invoiceStatus === INVOICE_STATUS.DRAFT) inv.invoiceStatus = INVOICE_STATUS.RECEIVED;
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'UPDATE', description: 'Invoice updated', actorId: user?._id });
    // A renamed invoice gets a new number key on save (vendorInvoice.model.js),
    // so a concurrent create / rename to the same number loses here, cleanly.
    return saveUniqueNumber(() => inv.save(), inv.vendorId, inv.invoiceNumber);
  },

  async remove(id, user) {
    const inv = await findOrThrow(id);
    if (inv.invoiceStatus !== INVOICE_STATUS.DRAFT) {
      throw new AppError('Only draft vendor invoices can be deleted', 400);
    }
    inv.isDeleted = true;
    inv.deletedAt = new Date();
    inv.deletedBy = user?._id;
    inv.activityTimeline.push({ action: 'DELETE', description: 'Vendor invoice deleted', actorId: user?._id });
    return inv.save();
  },

  // Rule 3 & 6 & 7: document mandatory; approval → PAYMENT_PENDING.
  async approve(id, data, user) {
    const inv = await findOrThrow(id);
    if ([INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED, INVOICE_STATUS.APPROVED].includes(inv.invoiceStatus)) {
      throw new AppError('Invoice is already approved', 400);
    }
    if (inv.invoiceStatus === INVOICE_STATUS.REJECTED) throw new AppError('Cannot approve a rejected invoice', 400);
    if (!inv.invoiceDocument?.fileUrl) throw new AppError('Upload the invoice document before approving', 400);

    inv.invoiceStatus = INVOICE_STATUS.PAYMENT_PENDING;
    inv.approvedBy = user?.name || '';
    inv.approvedById = user?._id;
    inv.approvedAt = new Date();
    inv.approvalRemarks = data.remarks || '';
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'APPROVE', description: 'Invoice approved — payment pending', actorId: user?._id });
    return inv.save();
  },

  async reject(id, data, user) {
    const inv = await findOrThrow(id);
    if ([INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED].includes(inv.invoiceStatus)) {
      throw new AppError('Cannot reject an approved invoice', 400);
    }
    inv.invoiceStatus = INVOICE_STATUS.REJECTED;
    inv.rejectedBy = user?.name || '';
    inv.rejectedAt = new Date();
    inv.rejectionRemarks = data.remarks || '';
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'REJECT', description: 'Invoice rejected', actorId: user?._id });
    return inv.save();
  },
};
