import { Queue } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
};

// Queue for sending emails (Dispatch schedules, invoices, etc.)
export const emailQueue = new Queue('EmailQueue', { connection: redisConnection });

// Queue for generating heavy PDFs via Puppeteer/wkhtmltopdf
export const pdfQueue = new Queue('PdfQueue', { connection: redisConnection });

// Queue for WhatsApp/Push notifications
export const notificationQueue = new Queue('NotificationQueue', { connection: redisConnection });
