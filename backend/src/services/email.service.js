import nodemailer from 'nodemailer';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

export const emailService = {
  async sendEmail({ to, subject, text, html, attachments = [] }) {
    try {
      const info = await transporter.sendMail({
        from: `"${env.COMPANY_NAME}" <${env.SMTP_USER}>`,
        to,
        subject,
        text,
        html,
        attachments,
      });
      logger.info(`📧 Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (error) {
      logger.error(`❌ Email failed to ${to}: ${error.message}`);
      throw error;
    }
  },

  async sendDispatchSchedule(to, partyName, soNumber, pdfPath) {
    const subject = `Dispatch Schedule - ${soNumber} - ${partyName}`;
    const text = `Dear ${partyName},\n\nPlease find attached the dispatch schedule for your order ${soNumber}.\n\nRegards,\n${env.COMPANY_NAME}`;
    const html = `<p>Dear ${partyName},</p><p>Please find attached the dispatch schedule for your order <b>${soNumber}</b>.</p><p>Regards,<br>${env.COMPANY_NAME}</p>`;

    return this.sendEmail({
      to,
      subject,
      text,
      html,
      attachments: [{ filename: `Schedule_${soNumber}.pdf`, path: pdfPath }],
    });
  },

  async sendInvoice(to, partyName, invoiceNo, pdfPath, ewayBillPath) {
    const subject = `Invoice - ${invoiceNo} - ${partyName}`;
    const text = `Dear ${partyName},\n\nPlease find attached the invoice ${invoiceNo} and E-way bill for your recent dispatch.\n\nRegards,\n${env.COMPANY_NAME}`;
    const html = `<p>Dear ${partyName},</p><p>Please find attached the invoice <b>${invoiceNo}</b> and E-way bill for your recent dispatch.</p><p>Regards,<br>${env.COMPANY_NAME}</p>`;

    const attachments = [{ filename: `Invoice_${invoiceNo}.pdf`, path: pdfPath }];
    if (ewayBillPath) {
      attachments.push({ filename: `EWayBill_${invoiceNo}.pdf`, path: ewayBillPath });
    }

    return this.sendEmail({ to, subject, text, html, attachments });
  },
};
