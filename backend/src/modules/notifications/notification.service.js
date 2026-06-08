import Notification from './notification.model.js';
import { logger } from '../../utils/logger.js';

export const notificationsService = {
  /** Create a notification for a user. Non-fatal — never throws to callers. */
  async notify(userId, { type = 'INFO', title, body = '', link = null }) {
    if (!userId || !title) return null;
    try {
      return await Notification.create({ userId, type, title, body, link });
    } catch (err) {
      logger.error(`[notifications] create failed: ${err.message}`);
      return null;
    }
  },

  async listMine(userId, { limit = 30 } = {}) {
    return Notification.find({ userId }).sort({ createdAt: -1 }).limit(Number(limit)).lean();
  },

  async unreadCount(userId) {
    return Notification.countDocuments({ userId, read: false });
  },

  async markRead(userId, id) {
    await Notification.updateOne({ _id: id, userId }, { $set: { read: true, readAt: new Date() } });
    return { id };
  },

  async markAllRead(userId) {
    await Notification.updateMany({ userId, read: false }, { $set: { read: true, readAt: new Date() } });
    return { ok: true };
  },
};

export default notificationsService;
