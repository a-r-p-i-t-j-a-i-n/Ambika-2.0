import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse, AppError } from '../../utils/apiResponse.js';
import { s3Enabled, buildKey, uploadBuffer, getSignedDownloadUrl } from './s3.service.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/csv',
  // Voice notes / audio + short video proof
  'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac',
  'video/webm', 'video/mp4', 'video/quicktime',
]);

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return cb(new AppError(`Unsupported file type: ${file.mimetype}. Allowed: PDF, image, Excel, Word.`, 415));
  }
  cb(null, true);
};

// In S3 mode we keep the file in memory (to stream the buffer up); otherwise we
// write to local disk exactly as before.
const makeStorage = (folder) => {
  if (s3Enabled) return multer.memoryStorage();
  const dir = path.join(UPLOAD_ROOT, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  });
};

/**
 * Reusable upload middleware factory — any module can mount its own endpoint:
 *   router.post('/x', makeUploader('challans'), handleUpload('challans'))
 */
export const makeUploader = (folder = 'misc', { field = 'file', maxMb = 15 } = {}) =>
  multer({ storage: makeStorage(folder), fileFilter, limits: { fileSize: maxMb * 1024 * 1024 } }).single(field);

// Prefer the configured public base (deployed) over the request host, so the
// stored URL never bakes in "localhost" or an internal proxy hostname.
const absolute = (req, pathPart) => {
  const base = (process.env.SERVER_URL || process.env.SERVER_BASE || '').replace(/\/+$/, '');
  return base ? `${base}${pathPart}` : `${req.protocol}://${req.get('host')}${pathPart}`;
};

/** Reusable upload handler — returns an ABSOLUTE, stable URL the whole app can store/open. */
export const handleUpload = (folder = 'misc') => asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file received. Field name must be "file".', 400);

  let url;
  let key = null;
  if (s3Enabled) {
    key = buildKey(folder, req.file.originalname);
    await uploadBuffer({ buffer: req.file.buffer, key, contentType: req.file.mimetype });
    // Served via our signing proxy so the link is permanent & the object stays private.
    url = absolute(req, `/api/v1/uploads/file?key=${encodeURIComponent(key)}`);
  } else {
    url = absolute(req, `/uploads/${folder}/${req.file.filename}`);
  }

  res.status(201).json(ApiResponse.created('File uploaded', {
    url,
    key,
    fileName: req.file.originalname,
    storedName: req.file.filename || key,
    sizeBytes: req.file.size,
    mimeType: req.file.mimetype,
  }));
});

/** GET /api/v1/uploads/file?key=…  → 302 redirect to a fresh signed S3 URL. */
export const getFile = asyncHandler(async (req, res) => {
  const { key } = req.query;
  if (!key) throw new AppError('Missing file key', 400);
  if (!s3Enabled) throw new AppError('S3 is not configured', 404);
  const signed = await getSignedDownloadUrl(String(key), 3600);
  res.redirect(302, signed);
});

// ── Backward-compatible exports (order documents) ───────────────────────────
export const orderDocUpload = makeUploader('order-documents');
export const uploadOrderDocument = handleUpload('order-documents');

export { UPLOAD_ROOT };
