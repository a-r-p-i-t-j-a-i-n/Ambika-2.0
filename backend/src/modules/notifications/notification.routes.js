import { Router } from 'express';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { protect } from '../../middleware/auth.middleware.js';
import { notificationsService } from './notification.service.js';

const router = Router();
router.use(protect);

router.get('/', asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('Notifications', await notificationsService.listMine(req.user._id, req.query)));
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('Unread count', { count: await notificationsService.unreadCount(req.user._id) }));
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('Marked read', await notificationsService.markRead(req.user._id, req.params.id)));
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  res.json(ApiResponse.ok('All marked read', await notificationsService.markAllRead(req.user._id)));
}));

export default router;
