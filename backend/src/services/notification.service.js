import { emailService } from './email.service.js';
import { whatsappService } from './whatsapp.service.js';
import { logger } from '../utils/logger.js';

export const notificationService = {
  async notifyDispatch(party, dc) {
    try {
      // 1. Send Email if email exists
      if (party.email) {
        await emailService.sendEmail({
          to: party.email,
          subject: `Dispatch Notification - ${dc.dcNumber}`,
          text: `Dear ${party.name}, your dispatch for DC ${dc.dcNumber} has been processed.`,
          html: `<p>Dear ${party.name},</p><p>Your dispatch for DC <b>${dc.dcNumber}</b> has been processed.</p>`,
        });
      }

      // 2. Send WhatsApp if phone exists
      if (party.phone) {
        await whatsappService.sendDispatchAlert(party.phone, party.name, dc.dcNumber, dc.vehicleNo);
      }
    } catch (error) {
      logger.error(`Failed to send dispatch notifications: ${error.message}`);
    }
  },

  async notifyPaymentReminder(party, invoice) {
    try {
      if (party.email) {
        await emailService.sendEmail({
          to: party.email,
          subject: `Payment Reminder - ${invoice.invoiceNo}`,
          text: `Dear ${party.name}, this is a reminder for payment of invoice ${invoice.invoiceNo}.`,
        });
      }
    } catch (error) {
       logger.error(`Failed to send payment reminder: ${error.message}`);
    }
  }
};
