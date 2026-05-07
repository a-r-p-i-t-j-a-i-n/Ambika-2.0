import { logger } from '../utils/logger.js';

export const whatsappService = {
  /**
   * Placeholder for WhatsApp Business API integration.
   * You can integrate Meta's Cloud API or a provider like Twilio/Wati here.
   */
  async sendMessage(to, message) {
    logger.info(`📱 [WHATSAPP SIMULATION] To: ${to} | Message: ${message}`);
    // Simulate API delay
    return new Promise((resolve) => setTimeout(resolve, 500));
  },

  async sendDispatchAlert(to, partyName, dcNumber, vehicleNo) {
    const message = `*Dispatch Alert - AGL*\n\nDear ${partyName},\nYour order has been dispatched via DC: *${dcNumber}*.\nVehicle No: *${vehicleNo}*.\n\nThank you,\nAmbika Global`;
    return this.sendMessage(to, message);
  }
};
