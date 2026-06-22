import asyncHandler from '../../middleware/asyncHandler.js';
import { transporterService } from './transporter.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const transporterController = {
  create: asyncHandler(async (req, res) => {
    const t = await transporterService.create(req.body, req.user?._id);
    res.status(201).json(ApiResponse.created('Transporter created', t));
  }),
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await transporterService.getAll(req.query);
    res.json(ApiResponse.ok('Transporters retrieved', docs, pagination));
  }),
  getById: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Transporter retrieved', await transporterService.getById(req.params.id)));
  }),
  update: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Transporter updated', await transporterService.update(req.params.id, req.body, req.user?._id)));
  }),
  remove: asyncHandler(async (req, res) => {
    await transporterService.remove(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Transporter deleted'));
  }),
};
