import fs from 'fs';
import path from 'path';
import DocumentApproval, { APPROVAL_STATUS, APPROVAL_HISTORY_ACTION } from './approval.model.js';
import { getApprovalDocument } from './approval.registry.js';
import Role from '../access-control/role.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../common/uploads/s3.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Generic Digital Approval & Signature engine — see approval.model.js for the
 * schema and approval.registry.js for the adapter pattern that keeps this file
 * free of any document-specific (GRN/Voucher/…) logic. Mirrors the shape of
 * `inventoryService` (one service, many callers, ledger + denormalized mirror
 * written together in the same call).
 */

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

/** Store a buffer via the same S3/local-disk pattern used across this codebase. */
const storeBuffer = async (buffer, folder, fileName, contentType) => {
  if (s3Enabled) {
    const key = buildKey(folder, fileName);
    await uploadBuffer({ buffer, key, contentType });
    return `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
  }
  const dir = path.resolve(process.cwd(), 'uploads', folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${Date.now()}-${fileName}`);
  fs.writeFileSync(fp, buffer);
  return `${SERVER_BASE}/uploads/${folder}/${path.basename(fp)}`;
};

/** Accepts either a raw base64 string or a `data:image/png;base64,...` URL. */
const decodeBase64Png = (dataUrlOrBase64) => {
  if (!dataUrlOrBase64) throw new AppError('Signature image is required', 400);
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrlOrBase64);
  const raw = match ? match[1] : dataUrlOrBase64;
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new AppError('Signature image is invalid', 400);
  return buffer;
};

const safeFileToken = (v) => String(v || '').replace(/[^\w.-]/g, '_');

/** Resolve a role key to its display name (e.g. 'MD' -> 'Managing Director'). */
const resolveDesignation = async (roleKey) => {
  const role = await Role.findOne({ key: roleKey, isDeleted: { $ne: true } }).select('name').lean();
  return role?.name || roleKey;
};

const findOrThrow = async (documentType, documentId) => {
  const row = await DocumentApproval.findOne({ documentType, documentId });
  if (!row) throw new AppError('No approval record found for this document — it may not be ready yet', 404);
  return row;
};

const currentLevel = (row) => row.levels.find((l) => l.order === row.currentLevelOrder) || row.levels[0];

/** Non-fatal — the approval ledger is the source of truth; this is a read-model courtesy. */
const updateMirror = async (adapter, documentId, fields) => {
  try {
    await adapter.model.updateOne({ _id: documentId }, { $set: fields });
  } catch (err) {
    logger.error(`[approvals] mirror update failed for ${documentId}: ${err.message}`);
  }
};

export const approvalService = {
  /**
   * Idempotent: called by a document module the moment it becomes finalized
   * (GRN completed, Voucher posted, …). Creates the approval row if missing,
   * lazily generates the unsigned PDF snapshot if one doesn't exist yet, and
   * flips the parent document's mirror to READY_FOR_MD_APPROVAL. Never
   * regresses an already-signed document.
   */
  async ensureReady({ documentType, documentId, documentNumber }, user) {
    const adapter = getApprovalDocument(documentType);
    let row = await DocumentApproval.findOne({ documentType, documentId });
    if (row && row.status === APPROVAL_STATUS.APPROVED) return row;

    const doc = await adapter.model.findOne({ _id: documentId, isDeleted: { $ne: true } }).lean();
    if (!doc) throw new AppError('Source document not found', 404);

    if (!row) {
      row = new DocumentApproval({
        documentType,
        documentId,
        documentNumber: documentNumber || doc[adapter.numberField] || '',
        createdBy: user?._id,
      });
    }

    if (!row.unsignedPdfUrl) {
      const buffer = await adapter.buildPdfBuffer(doc, { signature: null });
      const fileName = `${safeFileToken(row.documentNumber || documentType)}-unsigned.pdf`;
      row.unsignedPdfUrl = await storeBuffer(buffer, adapter.uploadFolder, fileName, 'application/pdf');
      row.unsignedPdfFileName = fileName;
    }
    row.status = APPROVAL_STATUS.READY_FOR_APPROVAL;
    row.updatedBy = user?._id;
    await row.save();

    await updateMirror(adapter, documentId, { [adapter.mirrorStatusField]: 'READY_FOR_MD_APPROVAL' });
    return row;
  },

  async getByDocument(documentType, documentId) {
    return DocumentApproval.findOne({ documentType, documentId }).lean();
  },

  /** MD signs the document for the first time. */
  async sign({ documentType, documentId, signatureImageBase64, signatureType, remarks }, user) {
    const adapter = getApprovalDocument(documentType);
    const row = await findOrThrow(documentType, documentId);
    if (row.status === APPROVAL_STATUS.APPROVED) throw new AppError('This document is already MD Approved', 400);

    const level = currentLevel(row);
    const signatureBuffer = decodeBase64Png(signatureImageBase64);
    const nextVersion = row.signatureVersion + 1;
    const signatureFileName = `${safeFileToken(row.documentNumber || documentType)}-sig-v${nextVersion}.png`;
    const signatureImageUrl = await storeBuffer(signatureBuffer, 'signatures', signatureFileName, 'image/png');

    const signedByName = user?.name || '';
    const designation = await resolveDesignation(level.roleKey);
    const signedAt = new Date();

    const doc = await adapter.model.findOne({ _id: documentId, isDeleted: { $ne: true } }).lean();
    const pdfBuffer = await adapter.buildPdfBuffer(doc, { signature: { imageBuffer: signatureBuffer, signedByName, designation, signedAt } });
    const pdfFileName = `${safeFileToken(row.documentNumber || documentType)}-signed.pdf`;
    const signedPdfUrl = await storeBuffer(pdfBuffer, adapter.uploadFolder, pdfFileName, 'application/pdf');

    row.status = APPROVAL_STATUS.APPROVED;
    row.signedByUserId = user?._id;
    row.signedByName = signedByName;
    row.designation = designation;
    row.signatureImageUrl = signatureImageUrl;
    row.signatureType = signatureType;
    row.signatureVersion = nextVersion;
    row.signedAt = signedAt;
    row.signedPdfUrl = signedPdfUrl;
    row.signedPdfFileName = pdfFileName;
    row.updatedBy = user?._id;
    row.history.push({
      action: APPROVAL_HISTORY_ACTION.SIGNED, levelOrder: level.order, roleKey: level.roleKey,
      actorId: user?._id, actorName: signedByName, designation,
      signatureImageUrl, signatureType, signatureVersion: nextVersion, pdfSnapshotUrl: signedPdfUrl,
      reason: remarks || '', timestamp: signedAt,
    });
    await row.save();

    await updateMirror(adapter, documentId, {
      [adapter.mirrorStatusField]: 'MD_APPROVED',
      [adapter.pdfUrlField]: signedPdfUrl,
      [adapter.pdfFileNameField]: pdfFileName,
    });
    return row;
  },

  /** MD replaces an existing signature — requires a reason, keeps full history. */
  async replaceSignature({ documentType, documentId, signatureImageBase64, signatureType, reason }, user) {
    if (!reason?.trim()) throw new AppError('A reason is required to replace a signature', 400);
    const adapter = getApprovalDocument(documentType);
    const row = await findOrThrow(documentType, documentId);
    if (row.status !== APPROVAL_STATUS.APPROVED) throw new AppError('Only a signed document can have its signature replaced', 400);

    const level = currentLevel(row);
    const signatureBuffer = decodeBase64Png(signatureImageBase64);
    const nextVersion = row.signatureVersion + 1;
    const signatureFileName = `${safeFileToken(row.documentNumber || documentType)}-sig-v${nextVersion}.png`;
    const signatureImageUrl = await storeBuffer(signatureBuffer, 'signatures', signatureFileName, 'image/png');

    const signedByName = user?.name || '';
    const designation = await resolveDesignation(level.roleKey);
    const signedAt = new Date();
    const previousPdfUrl = row.signedPdfUrl;

    const doc = await adapter.model.findOne({ _id: documentId, isDeleted: { $ne: true } }).lean();
    const pdfBuffer = await adapter.buildPdfBuffer(doc, { signature: { imageBuffer: signatureBuffer, signedByName, designation, signedAt } });
    const pdfFileName = `${safeFileToken(row.documentNumber || documentType)}-signed.pdf`;
    const signedPdfUrl = await storeBuffer(pdfBuffer, adapter.uploadFolder, pdfFileName, 'application/pdf');

    row.signedByUserId = user?._id;
    row.signedByName = signedByName;
    row.designation = designation;
    row.signatureImageUrl = signatureImageUrl;
    row.signatureType = signatureType;
    row.signatureVersion = nextVersion;
    row.signedAt = signedAt;
    row.signedPdfUrl = signedPdfUrl;
    row.signedPdfFileName = pdfFileName;
    row.updatedBy = user?._id;
    row.history.push({
      action: APPROVAL_HISTORY_ACTION.SIGNATURE_REPLACED, levelOrder: level.order, roleKey: level.roleKey,
      actorId: user?._id, actorName: signedByName, designation,
      signatureImageUrl, signatureType, signatureVersion: nextVersion, pdfSnapshotUrl: signedPdfUrl,
      previousPdfUrl, reason, timestamp: signedAt,
    });
    await row.save();

    await updateMirror(adapter, documentId, {
      [adapter.pdfUrlField]: signedPdfUrl,
      [adapter.pdfFileNameField]: pdfFileName,
    });
    return row;
  },

  /** MD removes a signature — requires a reason, reopens the document for signing. */
  async removeSignature({ documentType, documentId, reason }, user) {
    if (!reason?.trim()) throw new AppError('A reason is required to remove a signature', 400);
    const adapter = getApprovalDocument(documentType);
    const row = await findOrThrow(documentType, documentId);
    if (row.status !== APPROVAL_STATUS.APPROVED) throw new AppError('This document is not currently signed', 400);

    const level = currentLevel(row);
    const previousPdfUrl = row.signedPdfUrl;
    const priorDesignation = row.designation;

    row.status = APPROVAL_STATUS.READY_FOR_APPROVAL;
    row.signedByUserId = undefined;
    row.signedByName = '';
    row.designation = '';
    row.signatureImageUrl = '';
    row.signatureType = undefined;
    row.signedAt = null;
    row.signedPdfUrl = '';
    row.signedPdfFileName = '';
    row.updatedBy = user?._id;
    row.history.push({
      action: APPROVAL_HISTORY_ACTION.SIGNATURE_REMOVED, levelOrder: level.order, roleKey: level.roleKey,
      actorId: user?._id, actorName: user?.name || '', designation: priorDesignation,
      previousPdfUrl, reason, timestamp: new Date(),
    });
    await row.save();

    await updateMirror(adapter, documentId, {
      [adapter.mirrorStatusField]: 'READY_FOR_MD_APPROVAL',
      [adapter.pdfUrlField]: row.unsignedPdfUrl,
      [adapter.pdfFileNameField]: row.unsignedPdfFileName,
    });
    return row;
  },
};
