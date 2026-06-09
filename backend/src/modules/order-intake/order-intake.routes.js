import { Router } from 'express';
import Joi from 'joi';
import asyncHandler from '../../middleware/asyncHandler.js';
import validate from '../../middleware/validate.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';
import { orderIntakeService } from './order-intake.service.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid id');
const attachmentJoi = Joi.object({
  fileName: Joi.string().required(), fileUrl: Joi.string().required(),
  fileKey: Joi.string().allow('', null), fileType: Joi.string().allow('', null),
  sizeBytes: Joi.number().min(0), kind: Joi.string(), uploadedByName: Joi.string().allow('', null),
});

const createSchema = Joi.object({
  partyId:  objectId.required(),
  partyName: Joi.string().allow('', null),
  channel:  Joi.string().valid('PHONE', 'EMAIL', 'WHATSAPP', 'MEETING', 'OTHER').required(),
  contactName: Joi.string().allow('', null),
  items: Joi.array().items(Joi.object({
    skuName: Joi.string().required(), skuCode: Joi.string().allow('', null), qty: Joi.number().min(0).default(0),
  })).default([]),
  notes: Joi.string().allow('', null),
  attachments: Joi.array().items(attachmentJoi).default([]),
  receivedAt: Joi.date(),
});

const convertSchema = Joi.object({
  poNumber: Joi.string().allow('', null),
  orderDate: Joi.date(),
  items: Joi.array().items(Joi.object({
    skuName: Joi.string().required(), skuCode: Joi.string().allow('', null), qty: Joi.number().min(0),
  })),
});

const idParam = Joi.object({ id: objectId.required() });

const router = Router();
router.use(protect, attachUserPermissions);

router.get('/', requirePermission('orders.view'), asyncHandler(async (req, res) => {
  const { docs, pagination } = await orderIntakeService.list(req.query);
  res.json(ApiResponse.ok('Order intakes retrieved', docs, pagination));
}));

router.post('/', requirePermission('orders.intake', 'orders.create'),
  validate(createSchema), asyncHandler(async (req, res) => {
    const intake = await orderIntakeService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Order logged — FMS started', intake));
  }));

router.get('/:id', requirePermission('orders.view'),
  validate(idParam, 'params'), asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Order intake retrieved', await orderIntakeService.getById(req.params.id)));
  }));

router.post('/:id/convert', requirePermission('orders.create'),
  validate(idParam, 'params'), validate(convertSchema), asyncHandler(async (req, res) => {
    const result = await orderIntakeService.convertToOrder(req.params.id, req.body, req.user);
    res.status(201).json(ApiResponse.created('Converted to Sales Order', result));
  }));

router.patch('/:id/cancel', requirePermission('orders.intake', 'orders.create'),
  validate(idParam, 'params'), asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Order intake cancelled', await orderIntakeService.cancel(req.params.id, req.user)));
  }));

export default router;
