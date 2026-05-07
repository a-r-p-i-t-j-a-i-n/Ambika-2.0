import app from './app.js';
import connectDB from './config/db.js';
import env from './config/env.js';
import { logger } from './utils/logger.js';

const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  const server = app.listen(env.PORT, () => {
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
