import PurchaseIndent, {
  INDENT_APPROVAL_STATUS,
  INDENT_OVERALL_STATUS,
  INDENT_REQUEST_TYPE,
  QUOTE_STEP_STATUS,
  QUOTATION_APPROVAL_STATUS,
  VENDOR_QUOTE_STATUS,
  ITEM_APPROVAL_STATUS,
  buildItemDisplayNumber,
  isItemApprovalEffective,
} from './indent.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateIndentNumber } from '../../../utils/docNumberGenerator.js';
import { assertPurchasable } from '../purchase-item-guard.js';

// Human-readable delay between a planned and actual date.
const computeDelay = (plannedAt, actualAt) => {
  if (!plannedAt || !actualAt) return '';
  const ms = new Date(actualAt).getTime() - new Date(plannedAt).getTime();
  const days = Math.round(ms / 86400000);
  if (days === 0) return 'On time';
  return days > 0 ? `${days} day(s) late` : `${Math.abs(days)} day(s) early`;
};

const findOrThrow = async (id) => {
  const indent = await PurchaseIndent.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!indent) throw new AppError('Indent not found', 404);
  return indent;
};

/**
 * Persist an approve/reject decision only if the indent is STILL awaiting
 * approval in the database — of two concurrent approve/reject calls on the same
 * indent, the second gets a clean 409 instead of silently overwriting the first.
 */
const saveAwaitingApproval = async (indent) => {
  indent.$where = { approvalStatus: { $in: [INDENT_APPROVAL_STATUS.DRAFT, INDENT_APPROVAL_STATUS.PENDING_APPROVAL] } };
  try {
    return await indent.save();
  } catch (err) {
    if (['DocumentNotFoundError', 'VersionError', 'ParallelSaveError'].includes(err?.name)) {
      throw new AppError(`Indent ${indent.indentNumber || ''} was just approved or rejected by someone else`.replace('  ', ' '), 409);
    }
    throw err;
  }
};

/**
 * Pre-items legacy indents store one product on the header (productNameRevised /
 * skuCode / quantity / unit) and have no items[]. Before an approval decision,
 * rebuild that single item row from the header so the decision has something to
 * act on. A header that only carries an aggregate label ("X +2 more") or no
 * quantity cannot be reconstructed safely — the approval is refused instead.
 */
const ensureLegacyItemRow = (indent) => {
  if (indent.items?.length) return;
  const name = String(indent.productNameRevised || '').trim();
  if (!name || /\s\+\d+ more$/.test(name) || !(num(indent.quantity) > 0)) {
    throw new AppError(
      `Indent ${indent.indentNumber || ''} is an old record without item details — edit it to add its item(s) before approving`,
      400,
    );
  }
  indent.items = buildItems({
    productNameRevised: name, skuCode: indent.skuCode, skuId: indent.skuId,
    quantity: indent.quantity, unit: indent.unit, remarks: '',
  });
  indent.activityTimeline.push({ action: 'LEGACY_ITEM_RESTORED', description: `Item row rebuilt from legacy fields (${name}, qty ${num(indent.quantity)})` });
};

/** Resolve an approval row to its indent item — never guess by position when an id was sent. */
const resolveDecisionItem = (indent, key, i) => {
  if (key) {
    const target = indent.items.id?.(key);
    if (!target) throw new AppError(`An item on indent ${indent.indentNumber || ''} has changed since it was loaded — refresh and try again`, 409);
    return target;
  }
  return indent.items[i];
};

const num = (n) => Number(n) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const cleanFile = (f = {}) => (f && f.fileUrl
  ? { fileName: f.fileName || '', fileUrl: f.fileUrl, fileType: f.fileType || '', uploadedAt: f.uploadedAt ? new Date(f.uploadedAt) : new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

// Step 1.2 — normalise incoming vendor quotes, computing item + vendor totals
// server-side so the comparative figures are authoritative.
const buildVendorQuotes = (vendors = []) => vendors.map((v) => {
  const items = (v.items || []).map((it) => {
    const requestedQty = num(it.requestedQty);
    const quotedRate = num(it.quotedRate);
    const gstRate = num(it.gstRate);
    const taxable = round2(requestedQty * quotedRate);
    return {
      skuId: it.skuId || undefined,
      skuCode: (it.skuCode || '').trim().toUpperCase(),
      itemName: (it.itemName || '').trim(),
      unit: (it.unit || '').trim() || 'Pcs',
      requestedQty,
      quotedRate,
      gstRate,
      deliveryDays: num(it.deliveryDays),
      paymentTerms: (it.paymentTerms || '').trim(),
      remarks: (it.remarks || '').trim(),
      totalAmount: round2(taxable + (taxable * gstRate) / 100),
    };
  });
  return {
    vendorId: v.vendorId,
    vendorName: (v.vendorName || '').trim(),
    vendorEmail: (v.vendorEmail || '').trim().toLowerCase(),
    vendorPhone: (v.vendorPhone || '').trim(),
    quotationStatus: v.quotationStatus || VENDOR_QUOTE_STATUS.PENDING,
    quotationDocument: cleanFile(v.quotationDocument),
    items,
    totalQuotationValue: round2(items.reduce((s, it) => s + it.totalAmount, 0)),
    remarks: (v.remarks || '').trim(),
  };
});

// Step 1.3 — normalise approved-vendor selection (one vendor for all items or
// item-wise splits), computing line + roll-up totals.
const buildApprovedVendors = (vendors = []) => vendors.map((v) => {
  const items = (v.items || []).map((it) => {
    const approvedQty = num(it.approvedQty);
    const approvedRate = num(it.approvedRate);
    const gstRate = num(it.gstRate);
    const taxable = round2(approvedQty * approvedRate);
    return {
      skuId: it.skuId || undefined,
      skuCode: (it.skuCode || '').trim().toUpperCase(),
      itemName: (it.itemName || '').trim(),
      unit: (it.unit || '').trim() || 'Pcs',
      approvedQty,
      approvedRate,
      gstRate,
      totalAmount: round2(taxable + (taxable * gstRate) / 100),
    };
  });
  return {
    vendorId: v.vendorId,
    vendorName: (v.vendorName || '').trim(),
    items,
    approvedQuotationDocument: cleanFile(v.approvedQuotationDocument),
    approvalRemarks: (v.approvalRemarks || '').trim(),
    poId: null,
    poNumber: '',
  };
});

// Step 1.2 — normalise item-wise quotation uploads (one entry per indent line
// item, each with its own document list, strictly keyed by itemId/skuCode/
// itemName as submitted — no cross-item merging happens here).
const buildItemQuotations = (items = []) => items.map((it) => {
  const statusDone = it.statusDone === 'QUOTE_NOT_REQUIRED' ? 'QUOTE_NOT_REQUIRED' : 'YES';
  return {
    itemId: it.itemId || undefined,
    skuId: it.skuId || undefined,
    skuCode: (it.skuCode || '').trim().toUpperCase(),
    itemName: (it.itemName || '').trim(),
    statusDone,
    // Quote Not Required items never carry quotation files — enforced here even
    // if the client sent stale/mis-hydrated files for this row.
    quotationDocuments: statusDone === 'QUOTE_NOT_REQUIRED'
      ? []
      : (Array.isArray(it.quotationDocuments) ? it.quotationDocuments : [])
        .filter((d) => d?.fileUrl)
        .map(cleanFile),
    actualAt: it.actualAt ? new Date(it.actualAt) : null,
    remarks: (it.remarks || '').trim(),
  };
});

// Step 1.3 — normalise item-wise approved quotation uploads (one entry per
// indent line item, each with its own approved-document list, strictly keyed
// by itemId/skuCode/itemName as submitted — no cross-item merging happens here).
const buildItemApprovedQuotations = (items = []) => items.map((it) => {
  // Carried from Step 1.2: YES needs a file; QUOTATION_NOT_APPROVED / QUOTE_NOT_REQUIRED don't.
  const statusDone = ['QUOTATION_NOT_APPROVED', 'QUOTE_NOT_REQUIRED'].includes(it.statusDone) ? it.statusDone : 'YES';
  return {
    itemId: it.itemId || undefined,
    skuId: it.skuId || undefined,
    skuCode: (it.skuCode || '').trim().toUpperCase(),
    itemName: (it.itemName || '').trim(),
    statusDone,
    // Quote Not Required items never carry approved files — same defense-in-depth as Step 1.2.
    approvedQuotationDocuments: statusDone === 'QUOTE_NOT_REQUIRED'
      ? []
      : (Array.isArray(it.approvedQuotationDocuments) ? it.approvedQuotationDocuments : [])
        .filter((d) => d?.fileUrl)
        .map(cleanFile),
    actualAt: it.actualAt ? new Date(it.actualAt) : null,
    remarks: (it.remarks || '').trim(),
  };
});

// Normalise an incoming payload into the canonical items[] shape. Falls back to
// the legacy single-product fields so older clients keep working.
const buildItems = (data = {}) => {
  const src = Array.isArray(data.items) && data.items.length
    ? data.items
    : (data.productNameRevised
      ? [{
        itemName: data.productNameRevised, skuCode: data.skuCode, skuId: data.skuId,
        quantity: data.quantity, unit: data.unit, remarks: data.remarks,
      }]
      : []);
  return src.map((it, i) => ({
    skuId: it.skuId || undefined,
    skuCode: (it.skuCode || '').trim().toUpperCase(),
    itemName: (it.itemName || '').trim(),
    quantity: num(it.quantity),
    unit: (it.unit || '').trim() || 'Pcs',
    revisedQuantity: num(it.revisedQuantity),
    approvedQuantity: num(it.approvedQuantity),
    remarks: (it.remarks || '').trim(),
    // Stable 1-based line number — preserve a provided value, else use order.
    itemLineNo: num(it.itemLineNo) || (i + 1),
  }));
};

// Decorate a lean indent with display-only item references (itemDisplayNumber),
// derived from the indentNumber + each item's stable itemLineNo (falling back to
// position for older records). Also stamps the matching reference onto the Step
// 1.2 / 1.3 item-wise quotation rows so every item-level view shares one number.
const decorateItemDisplayNumbers = (indent) => {
  if (!indent) return indent;
  const items = indent.items || [];
  // itemId(string) → display reference, for the step quotation rows.
  const refById = new Map();
  items.forEach((it, i) => {
    const lineNo = num(it.itemLineNo) || (i + 1);
    it.itemDisplayNumber = buildItemDisplayNumber(indent.indentNumber, lineNo);
    if (it._id) refById.set(String(it._id), it.itemDisplayNumber);
  });
  const stampRows = (rows = []) => rows.forEach((r) => {
    if (r && r.itemId && refById.has(String(r.itemId))) {
      r.itemDisplayNumber = refById.get(String(r.itemId));
    }
  });
  stampRows(indent.quoteComparativeStep?.itemQuotations);
  stampRows(indent.quotationApprovalStep?.itemApprovedQuotations);
  return indent;
};

// Approval qty rule: Approved Qty always mirrors Revised Qty — the server is
// authoritative here, so any `approvedQuantity` sent by the client is ignored
// (prevents a frontend bypass). If Revised Qty is blank/0, default to the
// requested quantity. Revised Qty must be > 0; it may be lower than, equal
// to, or greater than the requested quantity (over-approval is allowed).
const resolveApprovedQty = (revisedInput, requestedQty, itemLabel) => {
  const requested = num(requestedQty);
  const revised = num(revisedInput) > 0 ? num(revisedInput) : requested;
  const label = itemLabel ? ` for "${itemLabel}"` : '';
  if (revised <= 0) {
    throw new AppError(`Revised quantity must be greater than 0${label}`, 400);
  }
  return revised;
};

// Keep the legacy single-product fields + aggregates in sync with items[] so
// search, the PO option label and any older reads stay consistent.
const mirrorLegacy = (indent) => {
  const items = indent.items || [];
  // A legacy record with no item rows keeps its own product fields — never
  // overwrite them with blanks derived from an empty items[].
  if (!items.length) return;
  const first = items[0] || {};
  indent.productNameRevised = items.length > 1
    ? `${first.itemName || ''} +${items.length - 1} more`
    : (first.itemName || '');
  indent.skuCode = first.skuCode || '';
  indent.skuId = first.skuId || undefined;
  indent.unit = first.unit || 'Pcs';
  indent.quantity = items.reduce((s, it) => s + num(it.quantity), 0);
  indent.revisedQuantity = items.reduce((s, it) => s + num(it.revisedQuantity), 0);
  indent.approvedQuantity = items.reduce((s, it) => s + num(it.approvedQuantity), 0);
};

export const indentService = {
  async create(data, user) {
    const items = buildItems(data);
    if (!items.length) throw new AppError('Add at least one item to the indent', 400);
    if (items.some((it) => !it.itemName)) throw new AppError('Every item needs a product name', 400);
    // Finished Goods are sell-side only — never indentable.
    await assertPurchasable(items.map((it) => ({ skuId: it.skuId, skuCode: it.skuCode })));

    const indentNumber = await generateIndentNumber();
    const indent = new PurchaseIndent({
      indentNumber,
      timestamp: data.timestamp || new Date(),
      requestType: data.requestType === INDENT_REQUEST_TYPE.INTERNAL_SERVICE
        ? INDENT_REQUEST_TYPE.INTERNAL_SERVICE
        : INDENT_REQUEST_TYPE.MATERIAL_PURCHASE,
      items,
      raisedBy: data.raisedBy || user?.name || '',
      raisedById: user?._id,
      department: data.department || '',
      remarks: data.remarks || '',
      approvalStatus: INDENT_APPROVAL_STATUS.DRAFT,
      overallStatus: INDENT_OVERALL_STATUS.INDENT_GENERATED,
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Indent created (draft) — ${items.length} item(s)`, actorId: user?._id }],
    });
    mirrorLegacy(indent);
    return indent.save();
  },

  async getAll(query) {
    const features = new ApiFeatures(
      PurchaseIndent.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['indentNumber', 'productNameRevised', 'skuCode', 'raisedBy', 'department', 'items.itemName', 'items.skuCode'])
      .sort()
      .select()
      .paginate();
    const result = await features.exec();
    // Decorate list rows too (not just detail) so the Products/Items column can
    // render item-level references (Ind-52.1/26-27) without a per-row fetch.
    (result.docs || []).forEach(decorateItemDisplayNumbers);
    return result;
  },

  async getById(id) {
    const indent = await PurchaseIndent.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!indent) throw new AppError('Indent not found', 404);
    return decorateItemDisplayNumbers(indent);
  },

  // Stats for the KPI cards.
  async getStats() {
    const rows = await PurchaseIndent.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:             { $sum: 1 },
          pendingApproval:   { $sum: { $cond: [{ $eq: ['$approvalStatus', INDENT_APPROVAL_STATUS.PENDING_APPROVAL] }, 1, 0] } },
          approved:          { $sum: { $cond: [{ $eq: ['$approvalStatus', INDENT_APPROVAL_STATUS.APPROVED] }, 1, 0] } },
          quotePending:      { $sum: { $cond: [{ $eq: ['$overallStatus', INDENT_OVERALL_STATUS.QUOTE_PENDING] }, 1, 0] } },
          quotationApproved: { $sum: { $cond: [{ $eq: ['$overallStatus', INDENT_OVERALL_STATUS.QUOTATION_APPROVED] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, pendingApproval: 0, approved: 0, quotePending: 0, quotationApproved: 0 };
  },

  async update(id, data, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft indents can be edited', 400);
    }

    // Items (replace wholesale when provided in either shape).
    if (Array.isArray(data.items) || data.productNameRevised !== undefined) {
      const items = buildItems(data);
      if (!items.length) throw new AppError('Add at least one item to the indent', 400);
      if (items.some((it) => !it.itemName)) throw new AppError('Every item needs a product name', 400);
      await assertPurchasable(items.map((it) => ({ skuId: it.skuId, skuCode: it.skuCode })));
      indent.items = items;
      mirrorLegacy(indent);
    }

    // Header fields.
    if (data.raisedBy !== undefined) indent.raisedBy = data.raisedBy;
    if (data.department !== undefined) indent.department = data.department;
    if (data.requestType !== undefined) indent.requestType = data.requestType;
    if (data.remarks !== undefined) indent.remarks = data.remarks;
    if (data.timestamp) indent.timestamp = data.timestamp;

    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'UPDATE', description: 'Draft indent updated', actorId: user?._id });
    return indent.save();
  },

  async remove(id, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft indents can be deleted', 400);
    }
    indent.isDeleted = true;
    indent.deletedAt = new Date();
    indent.deletedBy = user?._id;
    indent.activityTimeline.push({ action: 'DELETE', description: 'Indent deleted', actorId: user?._id });
    return indent.save();
  },

  async submit(id, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft indents can be submitted', 400);
    }
    indent.approvalStatus = INDENT_APPROVAL_STATUS.PENDING_APPROVAL;
    indent.overallStatus = INDENT_OVERALL_STATUS.INDENT_GENERATED;
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'SUBMIT', description: 'Submitted for approval', actorId: user?._id });
    return indent.save();
  },

  async approve(id, data, user) {
    const indent = await findOrThrow(id);
    if (![INDENT_APPROVAL_STATUS.PENDING_APPROVAL, INDENT_APPROVAL_STATUS.DRAFT].includes(indent.approvalStatus)) {
      throw new AppError('Indent is not awaiting approval', 400);
    }
    ensureLegacyItemRow(indent); // pre-items record → rebuild its single item row (or refuse)
    const now = new Date();
    let approvedCount = 0;
    let rejectedCount = 0;
    // Apply per-item decisions — Approved Qty always mirrors Revised Qty
    // (resolveApprovedQty), so any approvedQuantity in the payload is ignored.
    // Items not mentioned in the payload default to APPROVED (unchanged from
    // the prior all-or-nothing behavior).
    if (Array.isArray(data.items) && data.items.length) {
      data.items.forEach((row, i) => {
        const target = resolveDecisionItem(indent, row._id, i);
        if (!target) return;
        if (row.approvalStatus === ITEM_APPROVAL_STATUS.REJECTED) {
          if (!row.rejectionReason?.trim()) {
            throw new AppError(`Rejection reason is required for "${target.itemName}"`, 400);
          }
          target.approvalStatus = ITEM_APPROVAL_STATUS.REJECTED;
          target.rejectionReason = row.rejectionReason.trim();
          target.revisedQuantity = 0;
          target.approvedQuantity = 0;
          rejectedCount += 1;
        } else {
          const approvedQty = resolveApprovedQty(row.revisedQuantity, target.quantity, target.itemName);
          target.revisedQuantity = approvedQty;
          target.approvedQuantity = approvedQty;
          target.approvalStatus = ITEM_APPROVAL_STATUS.APPROVED;
          target.rejectionReason = '';
          approvedCount += 1;
        }
        target.approvedAt = now;
        target.approvedBy = user?.name || '';
      });
    } else if (indent.items[0]) {
      // Legacy single-product approval — no per-item rejection UI for this shape.
      const approvedQty = resolveApprovedQty(data.revisedQuantity, indent.items[0].quantity, indent.items[0].itemName);
      indent.items[0].revisedQuantity = approvedQty;
      indent.items[0].approvedQuantity = approvedQty;
      indent.items[0].approvalStatus = ITEM_APPROVAL_STATUS.APPROVED;
      indent.items[0].rejectionReason = '';
      indent.items[0].approvedAt = now;
      indent.items[0].approvedBy = user?.name || '';
      approvedCount += 1;
    }
    mirrorLegacy(indent); // refresh aggregate approved/revised quantities

    indent.approval = {
      approvedBy: data.approvedBy || user?.name || '',
      approvedById: user?._id,
      approvedAt: now,
      remarks: data.remarks || '',
    };
    if (approvedCount > 0) {
      // At least one item approved — advance the workflow: approved → quote pending.
      indent.approvalStatus = INDENT_APPROVAL_STATUS.APPROVED;
      indent.overallStatus = INDENT_OVERALL_STATUS.QUOTE_PENDING;
      indent.quoteStep = {
        ...(indent.quoteStep?.toObject?.() || indent.quoteStep || {}),
        status: QUOTE_STEP_STATUS.PENDING,
        plannedAt: indent.quoteStep?.plannedAt || now,
      };
    } else {
      // Every item was rejected — the indent itself is rejected and closed.
      indent.approvalStatus = INDENT_APPROVAL_STATUS.REJECTED;
      indent.overallStatus = INDENT_OVERALL_STATUS.CLOSED;
    }
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({
      action: approvedCount > 0 ? 'APPROVE' : 'REJECT',
      description: rejectedCount > 0
        ? `Indent approved (${approvedCount} approved, ${rejectedCount} rejected)`
        : `Indent approved (total qty ${indent.approvedQuantity})`,
      actorId: user?._id,
    });
    return saveAwaitingApproval(indent);
  },

  async reject(id, data, user) {
    const indent = await findOrThrow(id);
    if (![INDENT_APPROVAL_STATUS.PENDING_APPROVAL, INDENT_APPROVAL_STATUS.DRAFT].includes(indent.approvalStatus)) {
      throw new AppError('Indent is not awaiting approval', 400);
    }
    const now = new Date();
    (indent.items || []).forEach((it) => {
      it.approvalStatus = ITEM_APPROVAL_STATUS.REJECTED;
      it.rejectionReason = data.remarks?.trim() || 'Indent rejected';
      it.revisedQuantity = 0;
      it.approvedQuantity = 0;
      it.approvedAt = now;
      it.approvedBy = user?.name || '';
    });
    mirrorLegacy(indent);
    indent.approvalStatus = INDENT_APPROVAL_STATUS.REJECTED;
    indent.overallStatus = INDENT_OVERALL_STATUS.CLOSED;
    indent.approval = {
      approvedBy: data.approvedBy || user?.name || '',
      approvedById: user?._id,
      approvedAt: now,
      remarks: data.remarks || '',
    };
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'REJECT', description: 'Indent rejected', actorId: user?._id });
    return saveAwaitingApproval(indent);
  },

  // Bulk approve multiple pending indents (item-wise quantities). Each indent is
  // processed independently so one bad indent doesn't fail the whole batch.
  async bulkApprove(data, user) {
    const result = { approvedCount: 0, approved: [], failed: [] };
    for (const row of data.indents || []) {
      try {
        const indent = await PurchaseIndent.findOne({ _id: row.indentId, isDeleted: { $ne: true } });
        if (!indent) throw new AppError('Indent not found', 404);
        // Mirror the single-approve flow: DRAFT or PENDING_APPROVAL are approvable.
        if (![INDENT_APPROVAL_STATUS.PENDING_APPROVAL, INDENT_APPROVAL_STATUS.DRAFT].includes(indent.approvalStatus)) {
          throw new AppError('Only indents awaiting approval can be approved', 400);
        }
        ensureLegacyItemRow(indent); // pre-items record → rebuild its single item row (or refuse)

        // Apply per-item decisions (match by item _id, else index) — Approved
        // Qty always mirrors Revised Qty, ignoring any approvedQuantity the
        // client sent. Items not mentioned default to APPROVED.
        const now = new Date();
        let approvedCount = 0;
        let rejectedCount = 0;
        if (Array.isArray(row.items) && row.items.length) {
          row.items.forEach((r, i) => {
            const key = r.itemId || r._id;
            const target = resolveDecisionItem(indent, key, i);
            if (!target) return;
            if (r.approvalStatus === ITEM_APPROVAL_STATUS.REJECTED) {
              if (!r.rejectionReason?.trim()) {
                throw new AppError(`Rejection reason is required for "${target.itemName}"`, 400);
              }
              target.approvalStatus = ITEM_APPROVAL_STATUS.REJECTED;
              target.rejectionReason = r.rejectionReason.trim();
              target.revisedQuantity = 0;
              target.approvedQuantity = 0;
              rejectedCount += 1;
            } else {
              const approvedQty = resolveApprovedQty(r.revisedQuantity, target.quantity, target.itemName);
              target.revisedQuantity = approvedQty;
              target.approvedQuantity = approvedQty;
              target.approvalStatus = ITEM_APPROVAL_STATUS.APPROVED;
              target.rejectionReason = '';
              approvedCount += 1;
            }
            target.approvedAt = now;
            target.approvedBy = user?.name || '';
          });
        } else {
          // No item-wise payload — approve every item exactly as single approve
          // does (approved qty = requested qty, any stale reason cleared).
          (indent.items || []).forEach((it) => {
            const approvedQty = resolveApprovedQty(undefined, it.quantity, it.itemName);
            it.revisedQuantity = approvedQty;
            it.approvedQuantity = approvedQty;
            it.rejectionReason = '';
            it.approvalStatus = ITEM_APPROVAL_STATUS.APPROVED;
            it.approvedAt = now;
            it.approvedBy = user?.name || '';
          });
          approvedCount = (indent.items || []).length;
        }
        mirrorLegacy(indent); // refresh aggregate approved/revised quantities

        indent.approval = {
          approvedBy: row.approvedBy || user?.name || '',
          approvedById: user?._id,
          approvedAt: now,
          remarks: row.remarks || '',
        };
        if (approvedCount > 0) {
          indent.approvalStatus = INDENT_APPROVAL_STATUS.APPROVED;
          indent.overallStatus = INDENT_OVERALL_STATUS.QUOTE_PENDING;
          indent.quoteStep = {
            ...(indent.quoteStep?.toObject?.() || indent.quoteStep || {}),
            status: QUOTE_STEP_STATUS.PENDING,
            plannedAt: indent.quoteStep?.plannedAt || now,
          };
        } else {
          indent.approvalStatus = INDENT_APPROVAL_STATUS.REJECTED;
          indent.overallStatus = INDENT_OVERALL_STATUS.CLOSED;
        }
        indent.updatedBy = user?._id;
        indent.activityTimeline.push({
          action: approvedCount > 0 ? 'APPROVE' : 'REJECT',
          description: rejectedCount > 0
            ? `Bulk approval (${approvedCount} approved, ${rejectedCount} rejected)`
            : 'Approved via bulk approval',
          actorId: user?._id,
        });
        await saveAwaitingApproval(indent);

        const items = indent.items || [];
        const productsSummary = items.length
          ? (items.length > 1 ? `${items[0].itemName} +${items.length - 1} more` : items[0].itemName)
          : (indent.productNameRevised || '—');

        if (approvedCount > 0) result.approvedCount += 1; // fully-rejected indents are not "approved"
        result.approved.push({
          _id: indent._id,
          indentNumber: indent.indentNumber,
          productsSummary,
          itemsCount: items.length || (indent.productNameRevised ? 1 : 0),
          department: indent.department || '',
          approvedQty: num(indent.approvedQuantity),
          approvalStatus: indent.approvalStatus,
          overallStatus: indent.overallStatus,
          approvedItemCount: approvedCount,
          rejectedItemCount: rejectedCount,
        });
      } catch (err) {
        result.failed.push({ indentId: row.indentId, message: err.message });
      }
    }
    return result;
  },

  // Bulk reject multiple pending indents.
  async bulkReject(data, user) {
    const result = { rejectedCount: 0, rejected: [], failed: [] };
    for (const id of data.indentIds || []) {
      try {
        const indent = await PurchaseIndent.findOne({ _id: id, isDeleted: { $ne: true } });
        if (!indent) throw new AppError('Indent not found', 404);
        // Mirror the single-reject flow: DRAFT or PENDING_APPROVAL are rejectable.
        if (![INDENT_APPROVAL_STATUS.PENDING_APPROVAL, INDENT_APPROVAL_STATUS.DRAFT].includes(indent.approvalStatus)) {
          throw new AppError('Only indents awaiting approval can be rejected', 400);
        }
        const now = new Date();
        (indent.items || []).forEach((it) => {
          it.approvalStatus = ITEM_APPROVAL_STATUS.REJECTED;
          it.rejectionReason = data.remarks?.trim() || 'Rejected via bulk reject';
          it.revisedQuantity = 0;
          it.approvedQuantity = 0;
          it.approvedAt = now;
          it.approvedBy = user?.name || '';
        });
        mirrorLegacy(indent);
        indent.approvalStatus = INDENT_APPROVAL_STATUS.REJECTED;
        indent.overallStatus = INDENT_OVERALL_STATUS.CLOSED;
        indent.approval = {
          approvedBy: data.approvedBy || user?.name || '',
          approvedById: user?._id,
          approvedAt: now,
          remarks: data.remarks || '',
        };
        indent.updatedBy = user?._id;
        indent.activityTimeline.push({ action: 'REJECT', description: 'Rejected via bulk reject', actorId: user?._id });
        await saveAwaitingApproval(indent);

        result.rejectedCount += 1;
        result.rejected.push({ indentId: indent._id, indentNumber: indent.indentNumber });
      } catch (err) {
        result.failed.push({ indentId: id, message: err.message });
      }
    }
    return result;
  },

  async receiveQuote(id, data, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.APPROVED) {
      throw new AppError('Quote can only be recorded for an approved indent', 400);
    }
    const status = data.status || QUOTE_STEP_STATUS.RECEIVED;
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();
    const plannedAt = indent.quoteStep?.plannedAt || null;

    indent.quoteStep = {
      plannedAt,
      actualAt,
      status,
      quotationUploaded: !!data.quotationUploaded,
      formLink: data.formLink || '',
      timeDelay: computeDelay(plannedAt, actualAt),
      remarks: data.remarks || '',
    };
    if (data.vendorId) indent.vendorId = data.vendorId;
    if (data.vendorName) indent.vendorName = data.vendorName;

    // Move overall status + open the quotation-approval step.
    indent.overallStatus = status === QUOTE_STEP_STATUS.NOT_REQUIRED
      ? INDENT_OVERALL_STATUS.QUOTE_NOT_REQUIRED
      : INDENT_OVERALL_STATUS.QUOTE_RECEIVED;
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'RECEIVE_QUOTE', description: `Quote ${status}`, actorId: user?._id });
    return indent.save();
  },

  // Step 1.2 — Receive Quote & Make Comparative (multi-vendor + legacy upload).
  async quoteComparative(id, data, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.APPROVED) {
      throw new AppError('Quote can only be recorded for an approved indent', 400);
    }

    // Step 1.3 (Approved Quotation) already done? Then Step 1.2 edits must not
    // move the workflow backwards or discard that approval.
    const step13Approved = indent.quotationApprovalStep?.statusDone === QUOTATION_APPROVAL_STATUS.YES
      && !indent.quotationApprovalStep?.skipped;
    if (step13Approved && data.statusDone !== 'YES') {
      throw new AppError('The quotation has already been approved (Step 1.3) — Step 1.2 cannot be changed to "Quote Not Required"', 400);
    }

    const vendors = Array.isArray(data.vendors) && data.vendors.length
      ? buildVendorQuotes(data.vendors)
      : [];
    const multiVendor = vendors.length > 0;
    const upload = data.quotationUploaded || {};

    // Item-wise quotation uploads — one entry per indent line item. Rejected
    // items (Step 1.1) are dropped even if a stale client submits one — they
    // must never reach Step 1.2/1.3/PO.
    const eligibleItemIds = new Set(
      (indent.items || []).filter((it) => isItemApprovalEffective(indent, it)).map((it) => String(it._id)),
    );
    const incomingItemQuotations = Array.isArray(data.itemQuotations)
      ? data.itemQuotations.filter((q) => !q.itemId || eligibleItemIds.has(String(q.itemId)))
      : [];
    const itemQuotations = incomingItemQuotations.length
      ? buildItemQuotations(incomingItemQuotations)
      : [];
    const hasItemQuotations = itemQuotations.length > 0;
    // Aggregate all item-wise files so the legacy quotationDocuments[] field
    // stays populated for older screens.
    const itemDocs = itemQuotations.flatMap((iq) => iq.quotationDocuments);

    // Simple multi-file upload: collect all valid documents (fall back to the
    // single legacy upload if only that was sent).
    const documents = (Array.isArray(data.quotationDocuments) ? data.quotationDocuments : [])
      .filter((d) => d?.fileUrl)
      .map(cleanFile);
    if (!documents.length && upload.fileUrl) documents.push(cleanFile(upload));

    // Legacy flat files (saved before item-wise uploads existed) that no item now
    // carries are retained at quotation level — never dropped, never guessed onto
    // an item. Carried forward across later saves.
    let retainedLegacyDocs = [];
    if (hasItemQuotations) {
      const prev = indent.quoteComparativeStep?.toObject?.() || indent.quoteComparativeStep || {};
      const prevHadItemFiles = (prev.itemQuotations || []).some((iq) => iq.quotationDocuments?.length);
      const prevFlat = prev.quotationDocuments?.length
        ? prev.quotationDocuments
        : (prev.quotationUploaded?.fileUrl ? [prev.quotationUploaded] : []);
      const pool = [...(prev.legacyQuotationDocuments || []), ...(prevHadItemFiles ? [] : prevFlat)];
      const used = new Set(itemDocs.map((d) => d.fileUrl));
      const seen = new Set();
      retainedLegacyDocs = pool.filter((d) => {
        if (!d?.fileUrl || used.has(d.fileUrl) || seen.has(d.fileUrl)) return false;
        seen.add(d.fileUrl);
        return true;
      }).map(cleanFile);
    }

    // The document set mirrored into legacy fields: item-wise files take
    // precedence, else the flat multi-file upload.
    const legacyDocuments = hasItemQuotations ? [...itemDocs, ...retainedLegacyDocs] : documents;

    // Step 1.2 is complete when statusDone = YES with proof of a received quote,
    // or QUOTE_NOT_REQUIRED. Proof = ≥1 file per item (item-wise) OR ≥1 uploaded
    // document (flat) OR ≥1 vendor RECEIVED (multi-vendor).
    const hasReceivedVendor = vendors.some((v) => v.quotationStatus === VENDOR_QUOTE_STATUS.RECEIVED);
    if (data.statusDone === 'YES') {
      if (multiVendor) {
        if (!hasReceivedVendor) {
          throw new AppError('At least one vendor quotation must be marked RECEIVED when status is Yes', 400);
        }
      } else if (hasItemQuotations) {
        // Only items marked YES need a file; QUOTE_NOT_REQUIRED items are optional.
        const missing = itemQuotations.find((iq) => iq.statusDone === 'YES' && !iq.quotationDocuments.length);
        if (missing) {
          throw new AppError(`At least one quotation file is required for each item marked Yes (missing for "${missing.itemName || 'item'}")`, 400);
        }
      } else if (!documents.length) {
        throw new AppError('At least one quotation document is required when status is Yes', 400);
      }
    }
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();

    // Mirror the first document into the legacy single-upload field so older
    // views keep rendering a quotation. In multi-vendor mode, mirror the first
    // received vendor's document instead.
    const mirrorDoc = multiVendor
      ? (vendors.find((v) => v.quotationStatus === VENDOR_QUOTE_STATUS.RECEIVED && v.quotationDocument?.fileUrl)?.quotationDocument || cleanFile())
      : (legacyDocuments[0] || cleanFile());

    indent.quoteComparativeStep = {
      stepNo: 'Step 1.2',
      stepName: 'Receive Quote & Make Comparative 1.02',
      statusDone: data.statusDone,
      quotationUploaded: mirrorDoc,
      quotationDocuments: multiVendor ? [] : legacyDocuments,
      itemQuotations,
      legacyQuotationDocuments: retainedLegacyDocs,
      vendors,
      actualAt,
      updatedBy: user?._id,
      remarks: data.remarks || '',
    };

    // Keep the legacy quoteStep in sync so the quotation-approval guard and
    // existing views stay consistent.
    const quoteStatus = data.statusDone === 'YES' ? QUOTE_STEP_STATUS.RECEIVED : QUOTE_STEP_STATUS.NOT_REQUIRED;
    indent.quoteStep = {
      ...(indent.quoteStep?.toObject?.() || indent.quoteStep || {}),
      status: quoteStatus,
      actualAt,
      quotationUploaded: !!mirrorDoc.fileUrl,
      formLink: mirrorDoc.fileUrl || indent.quoteStep?.formLink || '',
      timeDelay: computeDelay(indent.quoteStep?.plannedAt, actualAt),
      remarks: data.remarks || indent.quoteStep?.remarks || '',
    };

    indent.updatedBy = user?._id;
    indent.activityTimeline.push({
      action: 'QUOTE_COMPARATIVE',
      description: `Step 1.2 — ${data.statusDone}${multiVendor ? ` (${vendors.length} vendor quote(s))` : ''}`,
      actorId: user?._id,
    });

    if (data.statusDone === 'YES' && step13Approved) {
      // Correction to Step 1.2 after the quotation was approved: keep the
      // downstream workflow status and the Step 1.3 approval exactly as they are.
      indent.activityTimeline.push({
        action: 'QUOTE_COMPARATIVE',
        description: `Step 1.2 updated after quotation approval — workflow status kept at ${indent.overallStatus}`,
        actorId: user?._id,
      });
    } else if (data.statusDone === 'YES') {
      indent.overallStatus = INDENT_OVERALL_STATUS.QUOTE_RECEIVED;
      // If Step 1.3 was previously skipped (Step 1.2 had been "Quote Not Required"),
      // a quote is now required again — reopen the Approved Quotation step. Clearing
      // the skip + statusDone drops PO eligibility until the approval is completed.
      if (indent.quotationApprovalStep?.skipped) {
        indent.quotationApprovalStep = {
          stepNo: 'Step 1.3',
          stepName: 'Approved Quotation 1.03',
          statusDone: null,
          skipped: false,
          skippedReason: '',
          updatedBy: user?._id,
        };
        indent.activityTimeline.push({
          action: 'APPROVE_QUOTATION',
          description: 'Quote required again — Approved Quotation step reopened',
          actorId: user?._id,
        });
      }
    } else {
      // QUOTE_NOT_REQUIRED — skip Step 1.3 (Approved Quotation) entirely and move
      // straight to PO eligibility (or service-pending for internal-service indents).
      // No approveQuotation call is needed for this flow.
      const isService = indent.requestType === INDENT_REQUEST_TYPE.INTERNAL_SERVICE;
      indent.quotationApprovalStep = {
        stepNo: 'Step 1.3',
        stepName: 'Approved Quotation 1.03',
        statusDone: null,
        skipped: true,
        skippedReason: 'Quotation Not Required',
        actualAt,
        updatedBy: user?._id,
        remarks: 'Quotation not required — Approved Quotation step skipped',
      };
      indent.overallStatus = isService
        ? INDENT_OVERALL_STATUS.SERVICE_PENDING
        : INDENT_OVERALL_STATUS.QUOTATION_APPROVED;
      indent.activityTimeline.push({
        action: 'APPROVE_QUOTATION',
        description: isService
          ? 'Quotation marked as Not Required. Approved Quotation step skipped. Ready for service.'
          : 'Quotation marked as Not Required. Approved Quotation step skipped. Ready for Purchase Order.',
        actorId: user?._id,
      });
    }
    return indent.save();
  },

  // Step 1.3 — Approved Quotation 1.03 (with approved-quotation upload).
  async approveQuotation(id, data, user) {
    const indent = await findOrThrow(id);

    // Step 1.3 does not exist when Step 1.2 was "Quote Not Required" — it was
    // auto-skipped and the indent went straight to PO eligibility. Reject any
    // approval / upload here until Step 1.2 is changed back to "Quote Received".
    if (indent.quotationApprovalStep?.skipped
      || indent.quoteComparativeStep?.statusDone === 'QUOTE_NOT_REQUIRED') {
      throw new AppError('Approved Quotation (Step 1.3) was skipped because the quotation is not required. Change Step 1.2 back to "Quote Received" to approve a quotation.', 400);
    }

    // Step 1.2 must be completed first.
    const step12Done = ['YES', 'QUOTE_NOT_REQUIRED'].includes(indent.quoteComparativeStep?.statusDone)
      || [QUOTE_STEP_STATUS.RECEIVED, QUOTE_STEP_STATUS.NOT_REQUIRED].includes(indent.quoteStep?.status);
    if (!step12Done) {
      throw new AppError('Complete Step 1.2 (Receive Quote) before approving the quotation', 400);
    }

    // Step 1.3 carries its status from Step 1.2 — the user is not asked to pick it
    // again. The skip case (Step 1.2 = "Quote Not Required") is already rejected
    // above, so reaching here means Step 1.2 was YES → Step 1.3 is YES. (The
    // frontend no longer sends statusDone; this is derived, not trusted.)
    const statusDone = QUOTATION_APPROVAL_STATUS.YES;

    const upload = data.approvedQuotation || {};
    const approvedVendors = Array.isArray(data.approvedVendors) && data.approvedVendors.length
      ? buildApprovedVendors(data.approvedVendors)
      : [];
    const multiVendor = approvedVendors.length > 0;

    // Item-wise approved quotation uploads — one entry per indent line item.
    const itemApprovedQuotations = Array.isArray(data.itemApprovedQuotations) && data.itemApprovedQuotations.length
      ? buildItemApprovedQuotations(data.itemApprovedQuotations)
      : [];
    const hasItemQuotations = itemApprovedQuotations.length > 0;
    // Aggregate all item-wise files so the legacy approvedQuotationDocuments[]
    // field stays populated for older screens / the PO flow.
    const itemDocs = itemApprovedQuotations.flatMap((iq) => iq.approvedQuotationDocuments);

    // Simple multi-file upload: collect all valid documents (fall back to the
    // single legacy upload if only that was sent).
    const documents = (Array.isArray(data.approvedQuotationDocuments) ? data.approvedQuotationDocuments : [])
      .filter((d) => d?.fileUrl)
      .map(cleanFile);
    if (!documents.length && upload.fileUrl) documents.push(cleanFile(upload));

    // The document set mirrored into legacy fields: item-wise files take
    // precedence, else the flat multi-file upload.
    const legacyDocuments = hasItemQuotations ? itemDocs : documents;

    if (statusDone === QUOTATION_APPROVAL_STATUS.YES) {
      if (multiVendor) {
        if (approvedVendors.some((v) => !v.items.length)) {
          throw new AppError('Each approved vendor must have at least one item', 400);
        }
      } else if (hasItemQuotations) {
        // Only items carried YES need a file; QUOTATION_NOT_APPROVED / QUOTE_NOT_REQUIRED optional.
        const missing = itemApprovedQuotations.find((iq) => iq.statusDone === 'YES' && !iq.approvedQuotationDocuments.length);
        if (missing) {
          throw new AppError(`At least one approved quotation file is required for each item marked Yes (missing for "${missing.itemName || 'item'}")`, 400);
        }
      } else if (!documents.length) {
        throw new AppError('At least one approved quotation document is required when status is Yes', 400);
      }
    }
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();

    // Mirror the first document into the legacy single field so older PO/views
    // keep working. In multi-vendor mode, mirror the first vendor's document.
    const mirrorDoc = multiVendor
      ? (approvedVendors.find((v) => v.approvedQuotationDocument?.fileUrl)?.approvedQuotationDocument || cleanFile())
      : (legacyDocuments[0] || cleanFile());

    const quotationApprovalStep = {
      stepNo: 'Step 1.3',
      stepName: 'Approved Quotation 1.03',
      statusDone,
      approvedQuotation: mirrorDoc,
      approvedQuotationDocuments: multiVendor ? [] : legacyDocuments,
      itemApprovedQuotations,
      approvedVendors,
      actualAt,
      updatedBy: user?._id,
      remarks: data.remarks || '',
    };
    // Internal-service indents skip the PO/PI/GRN chain — an approved quotation
    // goes straight to SERVICE_PENDING (awaiting Step 1.8A Service Completion).
    const isService = indent.requestType === INDENT_REQUEST_TYPE.INTERNAL_SERVICE;
    const overallStatus = statusDone === QUOTATION_APPROVAL_STATUS.YES
      ? (isService ? INDENT_OVERALL_STATUS.SERVICE_PENDING : INDENT_OVERALL_STATUS.QUOTATION_APPROVED)
      : INDENT_OVERALL_STATUS.QUOTATION_NOT_APPROVED;

    // Timeline: how many Step 1.2 quotations were kept (approved) vs removed
    // (rejected). Step 1.3 reuses Step 1.2's files, so the difference is the
    // rejected count.
    const step12 = indent.quoteComparativeStep;
    const step12DocCount = (step12?.itemQuotations || []).reduce((n, iq) => n + (iq.quotationDocuments?.length || 0), 0)
      || (step12?.quotationDocuments?.length || 0);
    const approvedDocCount = multiVendor
      ? approvedVendors.filter((v) => v.approvedQuotationDocument?.fileUrl).length
      : legacyDocuments.length;
    const rejectedDocCount = Math.max(0, step12DocCount - approvedDocCount);
    const timelineDesc = multiVendor
      ? `Step 1.3 — ${approvedVendors.length} approved vendor(s)`
      : `Step 1.3 — ${approvedDocCount} quotation(s) approved (reused from Step 1.2)${rejectedDocCount ? `, ${rejectedDocCount} rejected` : ''}`;

    // Use $set so the whole sub-document is replaced at the DB level. This
    // overwrites any legacy shape (older docs stored `approvedQuotation` as a
    // String) instead of merging onto it, which would throw a cast error.
    const updated = await PurchaseIndent.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      {
        $set: { quotationApprovalStep, overallStatus, updatedBy: user?._id },
        $push: {
          activityTimeline: {
            action: 'APPROVE_QUOTATION',
            description: timelineDesc,
            actorId: user?._id,
            timestamp: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw new AppError('Indent not found', 404);
    return updated;
  },
};
