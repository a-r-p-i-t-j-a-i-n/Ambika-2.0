import PurchaseIndent, {
  INDENT_APPROVAL_STATUS,
  INDENT_OVERALL_STATUS,
  QUOTE_STEP_STATUS,
  QUOTATION_APPROVAL_STATUS,
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

const num = (n) => Number(n) || 0;

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
  return src.map((it) => ({
    skuId: it.skuId || undefined,
    skuCode: (it.skuCode || '').trim().toUpperCase(),
    itemName: (it.itemName || '').trim(),
    quantity: num(it.quantity),
    unit: (it.unit || '').trim() || 'Pcs',
    revisedQuantity: num(it.revisedQuantity),
    approvedQuantity: num(it.approvedQuantity),
    remarks: (it.remarks || '').trim(),
  }));
};

// Keep the legacy single-product fields + aggregates in sync with items[] so
// search, the PO option label and any older reads stay consistent.
const mirrorLegacy = (indent) => {
  const items = indent.items || [];
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
    return features.exec();
  },

  async getById(id) {
    const indent = await PurchaseIndent.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!indent) throw new AppError('Indent not found', 404);
    return indent;
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
    if (data.remarks !== undefined) indent.remarks = data.remarks;
    if (data.timestamp) indent.timestamp = data.timestamp;

    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'UPDATE', description: 'Draft indent updated', actorId: user?._id });
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
    // Apply per-item approved/revised quantities.
    if (Array.isArray(data.items) && data.items.length) {
      data.items.forEach((row, i) => {
        const target = (row._id && indent.items.id?.(row._id)) || indent.items[i];
        if (target) {
          target.revisedQuantity = num(row.revisedQuantity);
          target.approvedQuantity = num(row.approvedQuantity);
        }
      });
    } else if (data.approvedQuantity != null && indent.items[0]) {
      // Legacy single-product approval.
      indent.items[0].revisedQuantity = num(data.revisedQuantity);
      indent.items[0].approvedQuantity = num(data.approvedQuantity);
    }
    mirrorLegacy(indent); // refresh aggregate approved/revised quantities

    indent.approvalStatus = INDENT_APPROVAL_STATUS.APPROVED;
    indent.approval = {
      approvedBy: data.approvedBy || user?.name || '',
      approvedById: user?._id,
      approvedAt: new Date(),
      remarks: data.remarks || '',
    };
    // Advance the workflow: approved → quote pending.
    indent.overallStatus = INDENT_OVERALL_STATUS.QUOTE_PENDING;
    indent.quoteStep = {
      ...(indent.quoteStep?.toObject?.() || indent.quoteStep || {}),
      status: QUOTE_STEP_STATUS.PENDING,
      plannedAt: indent.quoteStep?.plannedAt || new Date(),
    };
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'APPROVE', description: `Indent approved (total qty ${indent.approvedQuantity})`, actorId: user?._id });
    return indent.save();
  },

  async reject(id, data, user) {
    const indent = await findOrThrow(id);
    if (![INDENT_APPROVAL_STATUS.PENDING_APPROVAL, INDENT_APPROVAL_STATUS.DRAFT].includes(indent.approvalStatus)) {
      throw new AppError('Indent is not awaiting approval', 400);
    }
    indent.approvalStatus = INDENT_APPROVAL_STATUS.REJECTED;
    indent.overallStatus = INDENT_OVERALL_STATUS.CLOSED;
    indent.approval = {
      approvedBy: data.approvedBy || user?.name || '',
      approvedById: user?._id,
      approvedAt: new Date(),
      remarks: data.remarks || '',
    };
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'REJECT', description: 'Indent rejected', actorId: user?._id });
    return indent.save();
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

  // Step 1.2 — Receive Quote & Make Comparative (with quotation upload).
  async quoteComparative(id, data, user) {
    const indent = await findOrThrow(id);
    if (indent.approvalStatus !== INDENT_APPROVAL_STATUS.APPROVED) {
      throw new AppError('Quote can only be recorded for an approved indent', 400);
    }
    const upload = data.quotationUploaded || {};
    if (data.statusDone === 'YES' && !upload.fileUrl) {
      throw new AppError('Quotation upload is required when status is Yes', 400);
    }
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();

    indent.quoteComparativeStep = {
      stepNo: 'Step 1.2',
      stepName: 'Receive Quote & Make Comparative 1.02',
      statusDone: data.statusDone,
      quotationUploaded: upload.fileUrl
        ? { fileName: upload.fileName || '', fileUrl: upload.fileUrl, fileType: upload.fileType || '', uploadedAt: new Date() }
        : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null },
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
      quotationUploaded: !!upload.fileUrl,
      formLink: upload.fileUrl || indent.quoteStep?.formLink || '',
      timeDelay: computeDelay(indent.quoteStep?.plannedAt, actualAt),
      remarks: data.remarks || indent.quoteStep?.remarks || '',
    };

    indent.overallStatus = data.statusDone === 'YES'
      ? INDENT_OVERALL_STATUS.QUOTE_RECEIVED
      : INDENT_OVERALL_STATUS.QUOTE_NOT_REQUIRED;
    indent.updatedBy = user?._id;
    indent.activityTimeline.push({ action: 'QUOTE_COMPARATIVE', description: `Step 1.2 — ${data.statusDone}`, actorId: user?._id });
    return indent.save();
  },

  // Step 1.3 — Approved Quotation 1.03 (with approved-quotation upload).
  async approveQuotation(id, data, user) {
    const indent = await findOrThrow(id);

    // Step 1.2 must be completed first.
    const step12Done = ['YES', 'QUOTE_NOT_REQUIRED'].includes(indent.quoteComparativeStep?.statusDone)
      || [QUOTE_STEP_STATUS.RECEIVED, QUOTE_STEP_STATUS.NOT_REQUIRED].includes(indent.quoteStep?.status);
    if (!step12Done) {
      throw new AppError('Complete Step 1.2 (Receive Quote) before approving the quotation', 400);
    }

    const upload = data.approvedQuotation || {};
    if (data.statusDone === QUOTATION_APPROVAL_STATUS.YES && !upload.fileUrl) {
      throw new AppError('Approved quotation upload is required when status is Yes', 400);
    }
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();

    const quotationApprovalStep = {
      stepNo: 'Step 1.3',
      stepName: 'Approved Quotation 1.03',
      statusDone: data.statusDone,
      approvedQuotation: upload.fileUrl
        ? { fileName: upload.fileName || '', fileUrl: upload.fileUrl, fileType: upload.fileType || '', uploadedAt: new Date() }
        : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null },
      actualAt,
      updatedBy: user?._id,
      remarks: data.remarks || '',
    };
    const overallStatus = data.statusDone === QUOTATION_APPROVAL_STATUS.YES
      ? INDENT_OVERALL_STATUS.QUOTATION_APPROVED
      : INDENT_OVERALL_STATUS.QUOTATION_NOT_APPROVED;

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
            description: `Step 1.3 — ${data.statusDone}`,
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
