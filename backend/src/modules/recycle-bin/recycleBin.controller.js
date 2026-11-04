import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse, AppError } from '../../utils/apiResponse.js';
import { ROOT_PERMISSION } from '../../common/permissions/registry.js';
import { recycleBinService } from './recycleBin.service.js';

/**
 * What this person may do in the bin. MD (root) can do everything; anyone
 * else needs the switches MD turns on in the Suite (Employees → lock icon →
 * Recycle Bin), which arrive as this session's grants.
 */
export const binAccessOf = (req) => {
  const perms = req.userPermissions || new Set();
  const has = (slug) => perms.has(ROOT_PERMISSION) || perms.has(slug);
  return {
    view: has('recycleBin.view'),
    restore: has('recycleBin.restore'),
    purge: has('recycleBin.purge'),
    all: has('recycleBin.viewAll'),
    settings: has('recycleBin.settings'),
  };
};

const need = (req, what, message) => {
  const access = binAccessOf(req);
  if (!access.view || !access[what]) throw new AppError(message, 403);
  return access;
};

export const recycleBinController = {
  list: asyncHandler(async (req, res) => {
    const access = need(req, 'view', 'The Recycle Bin is switched off for you.');
    const { items, nextCursor } = await recycleBinService.list(req.query, access, req.user._id);
    res.json(ApiResponse.ok('Recycle Bin', items, { nextCursor }));
  }),

  summary: asyncHandler(async (req, res) => {
    const access = binAccessOf(req);
    if (!access.view) {
      res.json(ApiResponse.ok('Recycle Bin', { access, counts: { pending: 0, restoring: 0, restored: 0 }, types: [], people: [] }));
      return;
    }
    const summary = await recycleBinService.summary(access, req.user._id);
    res.json(ApiResponse.ok('Recycle Bin', { access, ...summary }));
  }),

  restore: asyncHandler(async (req, res) => {
    const access = need(req, 'restore', 'Restoring is switched off for you.');
    const results = await recycleBinService.restore(req.body.ids, access, req.user);
    const done = results.filter((r) => r.ok).length;
    const message = done === results.length
      ? `${done} restored`
      : `${done} restored · ${results.length - done} couldn't be restored`;
    res.json(ApiResponse.ok(message, results));
  }),

  purge: asyncHandler(async (req, res) => {
    const access = need(req, 'purge', 'Delete forever is switched off for you.');
    const { removed } = await recycleBinService.purge(req.body.ids, access, req.user);
    res.json(ApiResponse.ok(`${removed} deleted forever`, { removed }));
  }),

  setSettings: asyncHandler(async (req, res) => {
    need(req, 'settings', 'Only MD can change how long items stay in the bin.');
    const retentionDays = await recycleBinService.setRetentionDays(req.body.retentionDays, req.user);
    res.json(ApiResponse.ok(`Items now stay ${retentionDays} days`, { retentionDays }));
  }),
};
