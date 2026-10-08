import asyncHandler from '../../middleware/asyncHandler.js';
import { vendorService } from './vendor.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const vendorController = {
  create: asyncHandler(async (req, res) => {
    const vendor = await vendorService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Vendor created', vendor));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await vendorService.getAll(req.query);
    res.json(ApiResponse.ok('Vendors retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    const vendor = await vendorService.getById(req.params.id);
    res.json(ApiResponse.ok('Vendor retrieved', vendor));
  }),

  update: asyncHandler(async (req, res) => {
    const vendor = await vendorService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Vendor updated', vendor));
  }),

  remove: asyncHandler(async (req, res) => {
    await vendorService.remove(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Vendor deleted'));
  }),

  getPricingHistory: asyncHandler(async (req, res) => {
    const history = await vendorService.getPricingHistory(req.params.id, req.query);
    res.json(ApiResponse.ok('Pricing history retrieved', history));
  }),

  addPricingHistory: asyncHandler(async (req, res) => {
    const entry = await vendorService.addPricingHistory(req.params.id, req.body, req.user);
    res.status(201).json(ApiResponse.created('Pricing history recorded', entry));
  }),

  addProduct: asyncHandler(async (req, res) => {
    const vendor = await vendorService.addProduct(req.params.id, req.body, req.user);
    res.status(201).json(ApiResponse.created('Vendor product saved', vendor));
  }),
};
