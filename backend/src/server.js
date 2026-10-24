import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import connectDB from './config/db.js';
import env from './config/env.js';
import { logger } from './utils/logger.js';
import { initSocket } from './sockets/socketService.js';
import { seedAccessControl } from './modules/access-control/role.seed.js';
import { seedPricing } from './modules/pricing/pricing.seed.js';
import { startO2DEscalationJob } from './jobs/o2d-fms.escalation.job.js';
import { startFmsDoerSyncJob } from './jobs/fms-doer.sync.job.js';
import { verifyInvoiceNumberIndex } from './modules/procurement/vendor-invoice/invoiceNumberIndexGuard.js';

const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  // Seed roles + backfill user role assignments. Idempotent.
  await seedAccessControl();
  // Seed pricing baseline + CompanySettings singleton. Idempotent.
  await seedPricing();

  // Vendor invoice numbering safeguard: confirm the unique index from the
  // database itself (read-only — never creates or syncs indexes). Never throws;
  // a missing / incorrect index is logged loudly, shown on
  // /api/health/invoice-numbering, and blocks only invoice creates and number
  // changes (503) — the rest of the ERP keeps running.
  await verifyInvoiceNumberIndex();

  const server = http.createServer(app);
  
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  initSocket(io);

  // O2D FMS — recurring SLA-breach escalation (email to owner + MD).
  if (process.env.O2D_FMS_ESCALATION !== 'off') {
    startO2DEscalationJob();
  }

  // FMS doer tasks — startup backfill + periodic reconcile.
  if (process.env.FMS_DOER_SYNC !== 'off') {
    startFmsDoerSyncJob();
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use — another instance of this server is likely already running. Exiting.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(env.PORT, () => {
    logger.info(`🚀 DPES Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    logger.info(`📡 API Base: http://localhost:${env.PORT}/api/v1`);
    logger.info(`❤️  Health:   http://localhost:${env.PORT}/api/health`);
  });

  // ── Graceful Shutdown ───────────────────────────────────
  const shutdown = (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // ── Unhandled Errors ────────────────────────────────────
  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`, { stack: err.stack });
    shutdown('UNHANDLED_REJECTION');
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
    shutdown('UNCAUGHT_EXCEPTION');
  });
};

startServer();
