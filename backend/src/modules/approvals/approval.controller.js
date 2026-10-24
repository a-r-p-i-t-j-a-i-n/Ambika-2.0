import asyncHandler from '../../middleware/asyncHandler.js';
import { approvalService } from './approval.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const approvalController = {
  list: asyncHandler(async (req, res) => {
    const { docs, pagination, summary, vendors } = await approvalService.list(req.query);
    res.json(ApiResponse.ok('Approvals retrieved', { rows: docs, summary, vendors }, pagination));
  }),

  getByDocument: asyncHandler(async (req, res) => {
    const { documentType, documentId } = req.params;
    const row = await approvalService.getByDocument(documentType, documentId);
    res.json(ApiResponse.ok(row ? 'Approval retrieved' : 'No approval record yet', row || null));
  }),

  sign: asyncHandler(async (req, res) => {
    const { documentType, documentId } = req.params;
    const row = await approvalService.sign({ documentType, documentId, ...req.body }, req.user);
    res.json(ApiResponse.ok('Document signed — MD Approved', row));
  }),

  replaceSignature: asyncHandler(async (req, res) => {
    const { documentType, documentId } = req.params;
    const row = await approvalService.replaceSignature({ documentType, documentId, ...req.body }, req.user);
    res.json(ApiResponse.ok('Signature replaced', row));
  }),

  removeSignature: asyncHandler(async (req, res) => {
    const { documentType, documentId } = req.params;
    const row = await approvalService.removeSignature({ documentType, documentId, ...req.body }, req.user);
    res.json(ApiResponse.ok('Signature removed', row));
  }),
};
