import asyncHandler from '../../../middleware/asyncHandler.js';
import { grnService } from './grn.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const grnController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await grnService.getAll(req.query);
    res.json(ApiResponse.ok('GRNs retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await grnService.getStats();
    res.json(ApiResponse.ok('GRN stats', stats));
  }),

  getByPo: asyncHandler(async (req, res) => {
    const grns = await grnService.getByPo(req.params.poId);
    res.json(ApiResponse.ok('GRNs for PO', grns));
  }),

  getById: asyncHandler(async (req, res) => {
    const grn = await grnService.getById(req.params.id);
    res.json(ApiResponse.ok('GRN retrieved', grn));
  }),

  create: asyncHandler(async (req, res) => {
    const grn = await grnService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('GRN created', grn));
  }),

  // Preview the GRN PDF from current (unsaved) form data — streams the PDF, persists nothing.
  previewPdf: asyncHandler(async (req, res) => {
    const buffer = await grnService.previewPdf(req.body, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="grn-preview.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }),

  update: asyncHandler(async (req, res) => {
    const grn = await grnService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('GRN updated', grn));
  }),

  remove: asyncHandler(async (req, res) => {
    const grn = await grnService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('GRN deleted', grn));
  }),

  complete: asyncHandler(async (req, res) => {
    const grn = await grnService.complete(req.params.id, req.body, req.user);
    // What actually happened to the RM lines, counted by the service rather
    // than inferred by the screen - so the dialog can never report "RM stock
    // updated" for a GRN that had no RM line on it, or that was not opted in.
    const rm = grn.$locals?.rmSummary || null;
    const message = rm?.rmPostedCount
      ? `GRN completed — stock posted; ${rm.rmPostedCount} RM line(s) added to RM stock at ${rm.rmReceivedAtLocation}`
      : 'GRN completed — stock posted';
    res.json(ApiResponse.ok(message, { ...grn.toObject(), rmSummary: rm }));
  }),

  cancel: asyncHandler(async (req, res) => {
    const grn = await grnService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('GRN cancelled', grn));
  }),
};
