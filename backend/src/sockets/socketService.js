import { logger } from '../utils/logger.js';

export const initSocket = (io) => {
  logger.info('🔌 Socket.IO initialized');

  io.on('connection', (socket) => {
    logger.info(`👤 Client connected: ${socket.id}`);

    // Join a global room for broadcast updates
    socket.join('dpes-updates');

    socket.on('disconnect', (reason) => {
      logger.info(`👤 Client disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err) => {
      logger.error(`❌ Socket error for ${socket.id}: ${err.message}`);
    });
  });

  return io;
};

/**
 * Utility to emit events to all connected clients in the updates room
 */
export const notifyClients = (io, event, data) => {
  if (io) {
    io.to('dpes-updates').emit(event, data);
  }
};
