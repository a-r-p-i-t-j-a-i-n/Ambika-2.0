import ServiceCompletion, { SERVICE_COMPLETION_STATUS } from './serviceCompletion.model.js';
import PurchaseIndent, { INDENT_OVERALL_STATUS, INDENT_REQUEST_TYPE } from '../indent/indent.model.js';
import Party from '../../clients/party.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateServiceCompletionNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';

const cleanFile = (f = {}) => (f && f.fileUrl
  ? { fileName: f.fileName || '', fileUrl: f.fileUrl, fileType: f.fileType || '', uploadedAt: f.uploadedAt ? new Date(f.uploadedAt) : new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const findOrThrow = async (id) => {
  const sc = await ServiceCompletion.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!sc) throw new AppError('Service completion not found', 404);
  return sc;
};

// Move the indent to SERVICE_COMPLETED once the service is recorded done. Non-fatal.
const markIndentCompleted = async (indentId, sc, user) => {
  try {
    await PurchaseIndent.updateOne(
      { _id: indentId },
      {
        $set: { overallStatus: INDENT_OVERALL_STATUS.SERVICE_COMPLETED },
        $push: { activityTimeline: { action: 'SERVICE_COMPLETED', description: `Service completed (${sc.scNumber})`, actorId: user?._id, timestamp: new Date() } },
      },
    );
  } catch (err) { logger.error(`[service-completion] indent status update failed: ${err.message}`); }
};

export const serviceCompletionService = {
  async create(data, user) {
    const indent = await PurchaseIndent.findOne({ _id: data.indentId, isDeleted: { $ne: true } });
    if (!indent) throw new AppError('Indent not found', 404);
    if (indent.requestType !== INDENT_REQUEST_TYPE.INTERNAL_SERVICE) {
      throw new AppError('Service completion is only for internal-service indents', 400);
    }
    // Quotation must be approved first (SERVICE_PENDING), unless re-recording after cancel.
    if (![INDENT_OVERALL_STATUS.SERVICE_PENDING, INDENT_OVERALL_STATUS.SERVICE_COMPLETED].includes(indent.overallStatus)) {
      throw new AppError('Approve the quotation before recording service completion', 400);
    }
    // One active service completion per indent.
    const existing = await ServiceCompletion.findOne({
      indentId: indent._id, isDeleted: { $ne: true },
      status: { $ne: SERVICE_COMPLETION_STATUS.CANCELLED },
    }).select('scNumber status').lean();
    if (existing) {
      throw new AppError(`Indent ${indent.indentNumber} already has a service completion (${existing.scNumber})`, 400);
    }

    let vendorName = data.vendorName || indent.vendorName || '';
    if (data.vendorId) {
      const party = await Party.findOne({ _id: data.vendorId, isDeleted: { $ne: true } }).select('name').lean();
      vendorName = data.vendorName || party?.name || vendorName;
    }

    const status = data.status === SERVICE_COMPLETION_STATUS.PENDING
      ? SERVICE_COMPLETION_STATUS.PENDING
      : SERVICE_COMPLETION_STATUS.COMPLETED;
    const completed = status === SERVICE_COMPLETION_STATUS.COMPLETED;

    const scNumber = await generateServiceCompletionNumber();
    const sc = new ServiceCompletion({
      scNumber,
      indentId: indent._id,
      indentNumber: indent.indentNumber,
      department: indent.department || '',
      vendorId: data.vendorId || indent.vendorId || undefined,
      vendorName,
      serviceCompletionDate: data.serviceCompletionDate ? new Date(data.serviceCompletionDate) : (completed ? new Date() : null),
      completionRemarks: data.completionRemarks || '',
      completionDocuments: (data.completionDocuments || []).filter((d) => d?.fileUrl).map(cleanFile),
      serviceReportDocument: cleanFile(data.serviceReportDocument),
      invoiceDocument: cleanFile(data.invoiceDocument),
      status,
      completedAt: completed ? new Date() : null,
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Service completion ${completed ? 'recorded (completed)' : 'drafted'}`, actorId: user?._id }],
    });
    await sc.save();

    if (completed) await markIndentCompleted(indent._id, sc, user);
    return sc;
  },

  async getAll(query) {
    const features = new ApiFeatures(
      ServiceCompletion.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['scNumber', 'indentNumber', 'vendorName'])
      .sort()
      .select()
      .paginate()
      .populateRefs([{ path: 'createdBy', select: 'name' }]);
    return features.exec();
  },

  async getById(id) {
    const sc = await ServiceCompletion.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name')
      .populate('vendorId', 'name code')
      .lean();
    if (!sc) throw new AppError('Service completion not found', 404);
    return sc;
  },

  async getStats() {
    const rows = await ServiceCompletion.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:     { $sum: 1 },
          pending:   { $sum: { $cond: [{ $eq: ['$status', SERVICE_COMPLETION_STATUS.PENDING] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', SERVICE_COMPLETION_STATUS.COMPLETED] }, 1, 0] } },
          qcPending: { $sum: { $cond: [{ $and: [{ $eq: ['$status', SERVICE_COMPLETION_STATUS.COMPLETED] }, { $eq: ['$qcStatus', 'PENDING'] }] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, pending: 0, completed: 0, qcPending: 0 };
  },

  async update(id, data, user) {
    const sc = await findOrThrow(id);
    if (sc.status !== SERVICE_COMPLETION_STATUS.PENDING) {
      throw new AppError('Only pending service completions can be edited', 400);
    }
    if (data.vendorId !== undefined) sc.vendorId = data.vendorId || undefined;
    if (data.vendorName !== undefined) sc.vendorName = data.vendorName;
    if (data.serviceCompletionDate !== undefined) sc.serviceCompletionDate = data.serviceCompletionDate ? new Date(data.serviceCompletionDate) : null;
    if (data.completionRemarks !== undefined) sc.completionRemarks = data.completionRemarks;
    if (Array.isArray(data.completionDocuments)) sc.completionDocuments = data.completionDocuments.filter((d) => d?.fileUrl).map(cleanFile);
    if (data.serviceReportDocument !== undefined) sc.serviceReportDocument = cleanFile(data.serviceReportDocument);
    if (data.invoiceDocument !== undefined) sc.invoiceDocument = cleanFile(data.invoiceDocument);
    sc.updatedBy = user?._id;
    sc.activityTimeline.push({ action: 'UPDATE', description: 'Service completion updated', actorId: user?._id });
    return sc.save();
  },

  async complete(id, data, user) {
    const sc = await findOrThrow(id);
    if (sc.status === SERVICE_COMPLETION_STATUS.COMPLETED) throw new AppError('Service is already completed', 400);
    if (sc.status === SERVICE_COMPLETION_STATUS.CANCELLED) throw new AppError('Cannot complete a cancelled service', 400);

    sc.status = SERVICE_COMPLETION_STATUS.COMPLETED;
    sc.completedAt = new Date();
    sc.serviceCompletionDate = data.serviceCompletionDate ? new Date(data.serviceCompletionDate) : (sc.serviceCompletionDate || new Date());
    if (data.completionRemarks) sc.completionRemarks = data.completionRemarks;
    if (data.serviceReportDocument?.fileUrl) sc.serviceReportDocument = cleanFile(data.serviceReportDocument);
    if (data.invoiceDocument?.fileUrl) sc.invoiceDocument = cleanFile(data.invoiceDocument);
    sc.updatedBy = user?._id;
    sc.activityTimeline.push({ action: 'COMPLETE', description: 'Service marked completed', actorId: user?._id });
    await sc.save();

    await markIndentCompleted(sc.indentId, sc, user);
    return sc;
  },

  async cancel(id, data, user) {
    const sc = await findOrThrow(id);
    if (sc.qcId) throw new AppError('Cannot cancel — a QC already exists for this service', 400);
    sc.status = SERVICE_COMPLETION_STATUS.CANCELLED;
    if (data.remarks) sc.completionRemarks = data.remarks;
    sc.updatedBy = user?._id;
    sc.activityTimeline.push({ action: 'CANCEL', description: 'Service completion cancelled', actorId: user?._id });
    return sc.save();
  },
};
