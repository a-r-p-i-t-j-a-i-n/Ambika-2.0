import { Worker } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
};

export const emailWorker = new Worker('EmailQueue', async (job) => {
  console.log(`[EmailWorker] Processing job ${job.id} - ${job.name}`);
  // TODO: Integrate Email Service (AWS SES / Nodemailer)
  // e.g., await emailService.sendTemplate(job.data.to, job.data.template, job.data.context);
  return { success: true, deliveredAt: new Date() };
}, { 
  connection: redisConnection,
  concurrency: 5 // Process up to 5 emails concurrently
});

emailWorker.on('completed', (job) => {
  console.log(`[EmailWorker] Job ${job.id} completed successfully.`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[EmailWorker] Job ${job.id} failed:`, err.message);
});
