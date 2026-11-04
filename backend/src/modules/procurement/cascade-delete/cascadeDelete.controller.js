import asyncHandler from '../../../middleware/asyncHandler.js';
import { ApiResponse } from '../../../utils/apiResponse.js';
import { cascadeDeleteService } from './cascadeDelete.service.js';

// A refusal that carries data (PLAN_CHANGED, the blockers) — the global error
// handler would drop it.
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

export const cascadeDeleteController = {
  preview: asyncHandler(async (req, res) => {
    const plan = await cascadeDeleteService.preview(req.params.type, req.params.id, req.userPermissions);
    res.json(ApiResponse.ok('Cascade delete preview', plan));
  }),

  execute: withConflictData(async (req, res) => {
    const result = await cascadeDeleteService.execute(req.params.type, req.params.id, req.body, req.user, {
      perms: req.userPermissions, ip: req.ip, userAgent: req.get('User-Agent'),
    });
    res.json(ApiResponse.ok(`${result.root.stepLabel} ${result.root.number} deleted with ${result.downstreamCount} downstream record(s)`.replace(/\s+/g, ' '), result));
  }),

  history: asyncHandler(async (req, res) => {
    const rows = await cascadeDeleteService.history(req.query);
    res.json(ApiResponse.ok('Cascade deletions', rows));
  }),
};
