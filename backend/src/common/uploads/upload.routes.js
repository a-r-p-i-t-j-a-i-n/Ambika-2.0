import { Router } from 'express';
import { orderDocUpload, uploadOrderDocument } from './upload.controller.js';

const router = Router();

// POST /api/v1/uploads/order-document  (multipart/form-data, field "file")
router.post('/order-document', orderDocUpload, uploadOrderDocument);

export default router;
