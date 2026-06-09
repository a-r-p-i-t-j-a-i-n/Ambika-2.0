import { Router } from 'express';
import { orderDocUpload, uploadOrderDocument, makeUploader, handleUpload, getFile } from './upload.controller.js';

const router = Router();

// Signed-download proxy (S3 mode): GET /api/v1/uploads/file?key=...
router.get('/file', getFile);

// Order documents (existing): POST /api/v1/uploads/order-document  (field "file")
router.post('/order-document', orderDocUpload, uploadOrderDocument);

// Generic, reusable for ANY module/feature now & future:
//   POST /api/v1/uploads?folder=challans   (multipart/form-data, field "file")
// Folder is whitelisted to keep the bucket tidy and prevent arbitrary paths.
const ALLOWED_FOLDERS = new Set([
  'order-documents', 'challans', 'invoices', 'dispatch-schedules',
  'o2d-fms', 'order-intake', 'pricing', 'misc',
]);

router.post('/', (req, res, next) => {
  const folder = ALLOWED_FOLDERS.has(req.query.folder) ? req.query.folder : 'misc';
  req.uploadFolder = folder;
  return makeUploader(folder)(req, res, next);
}, (req, res, next) => handleUpload(req.uploadFolder || 'misc')(req, res, next));

export default router;
