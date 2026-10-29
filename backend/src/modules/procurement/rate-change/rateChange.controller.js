import asyncHandler from '../../../middleware/asyncHandler.js';
import { userHasPermission } from '../../../middleware/permission.middleware.js';
import { ApiResponse } from '../../../utils/apiResponse.js';
import { rateChangeService, RATE_APPROVER_PERMISSIONS } from './rateChange.service.js';
import { selfApprovalBlock } from './rateChange.rules.js';

const canApprove = (req) => RATE_APPROVER_PERMISSIONS.some((s) => userHasPermission(req, s));

// A refused decision that carries data (e.g. the current vendor rate after a
// stale-rate conflict) — the global error handler would drop it.
const withConflictData = (fn) => asyncHandler(async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (err?.data && err.statusCode) {
      res.status(err.statusCode).json({ ...ApiResponse.fail(err.message), data: err.data });
      return;
    }
    throw err;
  }
});

export const rateChangeController = {
  list: asyncHandler(async (req, res) => {
    const data = await rateChangeService.list(req.query);
    res.json(ApiResponse.ok('Rate change requests', { ...data, canApprove: canApprove(req) }));
  }),

  getById: asyncHandler(async (req, res) => {
    const data = await rateChangeService.getById(req.params.id);
    const approver = canApprove(req);
    res.json(ApiResponse.ok('Rate change request', {
      ...data,
      canApprove: approver,
      // Why this user can't approve this one ('' = they can, when it is pending).
      approveBlock: approver ? selfApprovalBlock(req.user, data) : 'You do not have permission to approve rate changes',
    }));
  }),

  history: asyncHandler(async (req, res) => {
    const data = await rateChangeService.history(req.query);
    res.json(ApiResponse.ok('Rate change history', data));
  }),

  vendorRate: asyncHandler(async (req, res) => {
    const data = await rateChangeService.vendorRate(req.query);
    res.json(ApiResponse.ok('Vendor rate', data));
  }),

  approve: withConflictData(async (req, res) => {
    const data = await rateChangeService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok(`Rate change ${data.requestNumber} approved — vendor rate and PO updated`, data));
  }),

  reject: withConflictData(async (req, res) => {
    const data = await rateChangeService.reject(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok(`Rate change ${data.requestNumber} rejected`, data));
  }),
};
