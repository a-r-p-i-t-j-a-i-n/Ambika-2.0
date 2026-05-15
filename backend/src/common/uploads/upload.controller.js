import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse, AppError } from '../../utils/apiResponse.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const ORDER_DOCS_DIR = path.join(UPLOAD_ROOT, 'order-documents');

if (!fs.existsSync(ORDER_DOCS_DIR)) {
  fs.mkdirSync(ORDER_DOCS_DIR, { recursive: true });
}

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ORDER_DOCS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
    const stem = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${stem}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return cb(new AppError(`Unsupported file type: ${file.mimetype}. Allowed: PDF, PNG, JPG, XLSX.`, 415));
  }
  cb(null, true);
};

export const orderDocUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
}).single('file');

export const uploadOrderDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file received. Field name must be "file".', 400);

  // Build a stable public URL. We mount the uploads folder as static below.
  const url = `/uploads/order-documents/${req.file.filename}`;

  res.status(201).json(ApiResponse.created('Order document uploaded', {
    url,
    fileName: req.file.originalname,
    storedName: req.file.filename,
    sizeBytes: req.file.size,
    mimeType: req.file.mimetype,
  }));
});

export { UPLOAD_ROOT };
