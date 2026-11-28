import Notification from './notification.model.js';
import { logger } from '../../utils/logger.js';

export const notificationsService = {
  /** Create a notification for a user. Non-fatal — never throws to callers. */
  async notify(userId, { type = 'INFO', title, body = '', link = null, refKey = null }) {
    if (!userId || !title) return null;
    try {
      return await Notification.create({ userId, type, title, body, link, refKey });
    } catch (err) {
      logger.error(`[notifications] create failed: ${err.message}`);
      return null;
    }
  },

  /**
   * Like notify(), but a user who already has this refKey UNREAD is not told
   * twice (a PO saved again before anyone looked at it).
   */
  async notifyOnce(userId, payload) {
    if (!userId || !payload?.refKey) return this.notify(userId, payload);
    try {
      if (await Notification.exists({ userId, refKey: payload.refKey, read: false })) return null;
    } catch (err) {
      logger.error(`[notifications] dedupe check failed: ${err.message}`);
    }
    return this.notify(userId, payload);
  },

  /**
   * A request was decided: its notification is no longer news for anyone, so
   * every still-unread copy (the approvers' bells) is marked read at once.
   * Non-fatal — never throws to callers.
   */
  async settleByRef(refKey) {
    if (!refKey) return 0;
    try {
      const res = await Notification.updateMany({ refKey, read: false }, { $set: { read: true, readAt: new Date() } });
      return res.modifiedCount || 0;
    } catch (err) {
      logger.error(`[notifications] settle ${refKey} failed: ${err.message}`);
      return 0;
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
