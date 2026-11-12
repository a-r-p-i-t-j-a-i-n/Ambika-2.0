/**
 * Company PDF assets — the fixed authorised signature and company stamp printed
 * in the "Authorized Signatory" block of every Purchase Order PDF.
 *
 * These are company-wide images uploaded once by a settings.edit admin. They are
 * deliberately separate from the per-document MD signature that the Digital
 * Approval engine (modules/approvals) captures for vouchers / GRNs / PIs — POs
 * are not routed through that engine.
 *
 * Storage: the bytes sit on the CompanySettings singleton (`select: false`),
 * not under the public `/uploads` static route or the unauthenticated S3 proxy,
 * so neither image is reachable by URL. Only the PO PDF builder and the
 * settings.edit preview endpoint ever read them.
 */
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import CompanySettings from './company-settings.model.js';
import AuditLog from '../audit-logs/audit-log.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan, registerRestoreHook } from '../recycle-bin/recycleBin.restore.js';
import { PO_TERMS_SETTING_FIELDS, defaultPoTerms } from '../procurement/purchase-order/poTerms.js';

// URL kind → CompanySettings field.
export const PDF_ASSET_FIELDS = { signature: 'authorisedSignature', stamp: 'companyStamp' };
const LABELS = { signature: 'Authorised signature', stamp: 'Company stamp' };

export const PDF_ASSET_MAX_BYTES = 1024 * 1024; // 1 MB — a signature/stamp scan is a few hundred KB at most
const MIN_PX = 32;
const MAX_PX = 3000; // also bounds the decoded pixel buffer (≤ 3000² × 8 bytes)
const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

/** Content sniffing — the declared mimetype / extension is never trusted on its own. */
export const sniffImageType = (buf) => {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
};

// PNG colour type → channels per pixel.
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/**
 * Walk the PNG chunks and inflate the pixel data synchronously. PDFKit decodes
 * PNG pixels (alpha / palette images) inside an async zlib callback that
 * THROWS on bad data — an uncaught exception that takes the whole server down
 * — so a PNG must be proven decodable here before PDFKit ever sees it.
 * Inflation is capped at the size the header promises (no decompression bombs).
 */
const assertPngDecodable = (buf) => {
  let off = 8; let ihdr = null; let ended = false;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error('truncated chunk');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (!ihdr && type !== 'IHDR') throw new Error('IHDR is not the first chunk');
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('bad IHDR');
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { ended = true; break; }
    off += 12 + len;
  }
  if (!ihdr || !idat.length || !ended) throw new Error('incomplete PNG');
  const { width, height, depth, colorType, interlace } = ihdr;
  const channels = PNG_CHANNELS[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('unsupported PNG format');
  if (width > MAX_PX || height > MAX_PX) throw Object.assign(new Error('too large'), { tooLarge: true, width, height });
  if (width < 1 || height < 1) throw new Error('bad PNG dimensions');

  const rowBytes = (w) => Math.ceil((w * channels * depth) / 8);
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  const expected = passes.reduce((sum, [xs, ys, dx, dy]) => {
    const pw = Math.ceil((width - xs) / dx); const ph = Math.ceil((height - ys) / dy);
    return pw > 0 && ph > 0 ? sum + ph * (1 + rowBytes(pw)) : sum;
  }, 0);
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1024 });
  if (raw.length < expected) throw new Error('PNG pixel data is incomplete');
};

/** True when PDFKit can embed this image without failing (sync, never throws). */
export const isRenderablePdfImage = (buf) => {
  try {
    const type = sniffImageType(buf);
    if (!type) return false;
    if (type === 'image/png') assertPngDecodable(buf);
    new PDFDocument({ autoFirstPage: false }).openImage(buf);
    return true;
  } catch { return false; }
};

/** Render the image into a throwaway PDF, exactly as the PO builder will. */
const renderProbe = (buffer) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4' });
    doc.on('error', reject);
    doc.on('data', () => {});
    doc.on('end', resolve);
    doc.image(buffer, 40, 40, { fit: [120, 60] });
    doc.end();
  } catch (err) { reject(err); }
});

/**
 * Validate an uploaded signature/stamp: PNG or JPEG by content, ≤ 1 MB, sane
 * pixel dimensions, and actually renderable by PDFKit — so an image that is
 * accepted here can never break PO PDF generation later.
 */
export const inspectPdfAssetImage = async (buffer) => {
  if (!buffer?.length) throw new AppError('The uploaded file is empty.', 400);
  if (buffer.length > PDF_ASSET_MAX_BYTES) throw new AppError('Image is larger than 1 MB. Please upload a smaller PNG or JPEG.', 413);
  const mimeType = sniffImageType(buffer);
  if (!mimeType) throw new AppError('Only PNG or JPEG images are accepted.', 415);

  let width; let height;
  try {
    if (mimeType === 'image/png') assertPngDecodable(buffer); // must run before PDFKit touches it
    const probe = new PDFDocument({ autoFirstPage: false });
    ({ width, height } = probe.openImage(buffer));
    if (width > MAX_PX || height > MAX_PX) throw Object.assign(new Error('too large'), { tooLarge: true, width, height });
    await renderProbe(buffer);
  } catch (err) {
    if (err.tooLarge) throw new AppError(`Image is too large (${err.width}×${err.height}px). Keep each side under ${MAX_PX}px.`, 422);
    throw new AppError('The image could not be read. Please re-save it as a standard PNG or JPEG and try again.', 422);
  }
  if (!(width >= MIN_PX && height >= MIN_PX)) throw new AppError(`Image is too small (${width}×${height}px). Use at least ${MIN_PX}px on each side.`, 422);

  return {
    mimeType, width, height, sizeBytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
};

/** Multipart parser for the upload route: memory only (never written to /uploads), 1 file, 1 MB. */
export const pdfAssetUpload = (req, res, next) => {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PDF_ASSET_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => (ALLOWED_MIMES.has(file.mimetype)
      ? cb(null, true)
      : cb(new AppError('Only PNG or JPEG images are accepted.', 415))),
  }).single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(err.code === 'LIMIT_FILE_SIZE'
        ? new AppError('Image is larger than 1 MB. Please upload a smaller PNG or JPEG.', 413)
        : new AppError(`Upload rejected: ${err.message}. Send one file in the "file" field.`, 400));
    }
    return next(err);
  });
};

const fieldFor = (kind) => {
  const field = PDF_ASSET_FIELDS[kind];
  if (!field) throw new AppError('Unknown asset — use "signature" or "stamp".', 400);
  return field;
};

const cleanFileName = (name) => path.basename(String(name || 'image'))
  .replace(/[^\w .()-]/g, '_').slice(0, 120);

/** Metadata only — what the settings API returns (never the bytes). */
const metaOf = (a) => (a?.sha256 ? {
  mimeType: a.mimeType, fileName: a.fileName, sizeBytes: a.sizeBytes, width: a.width, height: a.height,
  sha256: a.sha256, uploadedBy: a.uploadedBy, uploadedByName: a.uploadedByName, uploadedAt: a.uploadedAt,
} : null);

const audit = async (settingsId, kind, oldAsset, newAsset, req) => {
  try {
    await AuditLog.create({
      entityName: 'CompanySettings',
      entityId: settingsId,
      action: 'UPDATE',
      oldValue: { [PDF_ASSET_FIELDS[kind]]: metaOf(oldAsset) },
      newValue: { [PDF_ASSET_FIELDS[kind]]: metaOf(newAsset) },
      updatedBy: req.user?._id,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent'),
      module: 'settings',
    });
  } catch (err) { logger.error(`[settings] audit log for ${kind} failed: ${err.message}`); }
};

export const companyPdfAssetsService = {
  async save(kind, file, req) {
    const field = fieldFor(kind);
    if (!file?.buffer) throw new AppError('No file received. Field name must be "file".', 400);
    const meta = await inspectPdfAssetImage(file.buffer);
    const s = await CompanySettings.getSingleton();
    const previous = s[field];
    const asset = {
      ...meta,
      data: file.buffer,
      fileName: cleanFileName(file.originalname),
      uploadedBy: req.user?._id,
      uploadedByName: req.user?.name || '',
      uploadedAt: new Date(),
    };
    await CompanySettings.updateOne({ _id: s._id }, { $set: { [field]: asset, updatedBy: req.user?._id } });
    await audit(s._id, kind, previous, asset, req);
    logger.info(`[settings] ${LABELS[kind]} ${previous?.sha256 ? 'replaced' : 'uploaded'} by ${req.user?.name || req.user?._id}`);
    return { kind, asset: metaOf(asset) };
  },

  async remove(kind, req) {
    const field = fieldFor(kind);
    const s = await CompanySettings.getSingleton();
    const previous = s[field];
    if (!previous?.sha256) throw new AppError(`${LABELS[kind]} is not configured.`, 404);
    // The image bytes live only here, so the Recycle Bin keeps a full copy first.
    const stored = await CompanySettings.findById(s._id).select(`+${field}.data`).lean();
    const asset = { ...stored[field], data: toBuffer(stored[field]?.data) };
    await recycleBinService.capture('pdfAsset', {
      title: LABELS[kind],
      subtitle: [asset.fileName, asset.uploadedByName && `uploaded by ${asset.uploadedByName}`].filter(Boolean).join(' · '),
      keywords: [kind, 'signature', 'stamp'],
      actor: req.user,
      plan: {
        steps: [binPlan.set(CompanySettings.modelName, s._id, {}, { optional: true })],
        after: [binPlan.hook('settings.restorePdfAsset', { settingsId: s._id, kind, field, asset })],
      },
    }, () => CompanySettings.updateOne({ _id: s._id }, { $unset: { [field]: 1 }, $set: { updatedBy: req.user?._id } }));
    await audit(s._id, kind, previous, null, req);
    logger.info(`[settings] ${LABELS[kind]} removed by ${req.user?.name || req.user?._id}`);
    return { kind, asset: null };
  },

  /** The stored bytes, for the settings.edit-only preview. */
  async getImage(kind) {
    const field = fieldFor(kind);
    const s = await CompanySettings.findOne().select(`+${field}.data`).lean();
    const data = toBuffer(s?.[field]?.data);
    if (!data) throw new AppError(`${LABELS[kind]} is not configured.`, 404);
    return { data, mimeType: sniffImageType(data) || 'application/octet-stream' };
  },
};

// Recycle Bin → put a removed signature / stamp back, only while the slot is
// still empty (a newer upload is never overwritten).
registerRestoreHook('settings.restorePdfAsset', async ({ settingsId, kind, field, asset }, { session, actor }) => {
  if (!Object.values(PDF_ASSET_FIELDS).includes(field)) throw new AppError("Can't restore — unknown company image.", 409);
  const data = toBuffer(asset?.data);
  if (!data) throw new AppError("Can't restore — the saved image is empty.", 409);
  const res = await CompanySettings.collection.updateOne(
    { _id: settingsId, [field]: { $in: [null] } },
    { $set: { [field]: { ...asset, data }, updatedBy: actor?.id || null, updatedAt: new Date() } },
    session ? { session } : {},
  );
  if (!res.matchedCount) {
    throw new AppError(`Can't restore — a new ${String(LABELS[kind] || 'image').toLowerCase()} was uploaded since. Remove it first if you want the old one back.`, 409);
  }
});

// lean() hands Buffers back as BSON Binary.
const toBuffer = (v) => {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v.length ? v : null;
  const b = v.buffer ? Buffer.from(v.buffer) : null;
  return b?.length ? b : null;
};

/**
 * Company header + signatory images for PO PDFs. Never throws: any failure
 * falls back to env defaults in the builder and a PDF without images.
 */
export const loadPdfCompany = async () => {
  try {
    const s = await CompanySettings.findOne()
      .select('+authorisedSignature.data +companyStamp.data').lean();
    if (!s) return {};
    // Re-checked on every load (cheap for ≤ 1 MB): an image PDFKit can't embed
    // is dropped with a log line instead of failing — or crashing — PO PDFs.
    const usable = (asset, label) => {
      const buf = toBuffer(asset?.data);
      if (!buf) return null;
      if (isRenderablePdfImage(buf)) return buf;
      logger.error(`[settings] stored ${label} is not a usable image — PO PDFs are printed without it`);
      return null;
    };
    return {
      name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail,
      signatureImage: usable(s.authorisedSignature, 'authorised signature'),
      stampImage: usable(s.companyStamp, 'company stamp'),
      poTerms: poTermsOf(s),
    };
  } catch (err) {
    logger.error(`[settings] could not load company details for a PDF: ${err.message}`);
    return {};
  }
};

// lean() skips schema defaults, so a settings row saved before these fields
// existed falls back to the built-in text here.
const poTermsOf = (s) => ({
  JSL: defaultPoTerms('JSL', { JSL: s?.[PO_TERMS_SETTING_FIELDS.JSL] }),
  OTHER: defaultPoTerms('OTHER', { OTHER: s?.[PO_TERMS_SETTING_FIELDS.OTHER] }),
});

/** Default PO Terms & Conditions per format ({ JSL, OTHER }) from Company Settings. */
export const loadPoTermsDefaults = async () => poTermsOf(
  await CompanySettings.findOne().select(Object.values(PO_TERMS_SETTING_FIELDS).join(' ')).lean(),
);
