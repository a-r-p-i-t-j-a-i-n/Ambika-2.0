import asyncHandler from '../../../middleware/asyncHandler.js';
import { indentService } from './indent.service.js';
import { attachStepTiming } from '../stepTiming.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const indentController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs: rows, pagination } = await indentService.getAll(req.query);
    // The Step 1.2 / 1.3 lists show that step's own timing on every row.
    const timingKey = req.query.fmsStep ? `INDENT_${req.query.fmsStep}` : 'INDENT';
    const docs = await attachStepTiming(timingKey, rows);
    res.json(ApiResponse.ok('Indents retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await indentService.getStats();
    res.json(ApiResponse.ok('Indent stats', stats));
  }),

  getById: asyncHandler(async (req, res) => {
    const indent = await indentService.getById(req.params.id);
    res.json(ApiResponse.ok('Indent retrieved', indent));
  }),

  create: asyncHandler(async (req, res) => {
    const indent = await indentService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Indent created', indent));
  }),

  update: asyncHandler(async (req, res) => {
    const indent = await indentService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Indent updated', indent));
  }),

  remove: asyncHandler(async (req, res) => {
    const indent = await indentService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('Indent deleted', indent));
  }),

  submit: asyncHandler(async (req, res) => {
    const indent = await indentService.submit(req.params.id, req.user);
    res.json(ApiResponse.ok('Indent submitted for approval', indent));
  }),

  approve: asyncHandler(async (req, res) => {
    const indent = await indentService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Indent approved', indent));
  }),

  reject: asyncHandler(async (req, res) => {
    const indent = await indentService.reject(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Indent rejected', indent));
  }),

  bulkApprove: asyncHandler(async (req, res) => {
    const result = await indentService.bulkApprove(req.body, req.user);
    res.json(ApiResponse.ok(`${result.approvedCount} indent(s) approved`, result));
  }),

  bulkReject: asyncHandler(async (req, res) => {
    const result = await indentService.bulkReject(req.body, req.user);
    res.json(ApiResponse.ok(`${result.rejectedCount} indent(s) rejected`, result));
  }),

  receiveQuote: asyncHandler(async (req, res) => {
    const indent = await indentService.receiveQuote(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Quote recorded', indent));
  }),

  quoteComparative: asyncHandler(async (req, res) => {
    const indent = await indentService.quoteComparative(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Quote & comparative recorded', indent));
  }),

  approveQuotation: asyncHandler(async (req, res) => {
    const indent = await indentService.approveQuotation(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Quotation approved', indent));
  }),
};
