import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import env from './config/env.js';
import errorHandler from './middleware/errorHandler.js';
import { AppError } from './utils/apiResponse.js';

// ── Route Imports ───────────────────────────────────────────
import authRoutes    from './modules/auth/auth.routes.js';
import clientRoutes  from './modules/clients/client.routes.js';
import skuRoutes     from './modules/skus/sku.routes.js';
import poRoutes      from './modules/purchase-orders/purchase-order.routes.js';
// Unified Order Management (O2D)
import orderRoutes    from './modules/order/order.routes.js';
import partyRoutes    from './modules/clients/party.routes.js';
import scheduleRoutes from './modules/schedule/schedule.routes.js';
import challanRoutes  from './modules/challan/challan.routes.js';
import fmsRoutes      from './modules/fms/fms.routes.js';
import ppcRoutes      from './modules/ppc/ppc.routes.js';
import dispatchControlRoutes from './modules/dispatch-control/dispatch-control.routes.js';
import uploadRoutes from './common/uploads/upload.routes.js';
import accessControlRoutes from './modules/access-control/access-control.routes.js';
import pricingRoutes from './modules/pricing/pricing.routes.js';
import quoteRoutes from './modules/quotes/quote.routes.js';
import o2dFmsRoutes from './modules/o2d-fms/o2d-fms.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';


const app = express();

// ── Security Middleware ─────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(mongoSanitize());
app.use(hpp());

// ── Rate Limiting ───────────────────────────────────────────
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// ── Body Parsing & Compression ──────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ── Logging ─────────────────────────────────────────────────
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ── Health Check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'DPES API is running',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────
app.use('/api/v1/auth',            authRoutes);
app.use('/api/v1/clients',         clientRoutes);
app.use('/api/v1/skus',            skuRoutes);
app.use('/api/v1/purchase-orders', poRoutes);
app.use('/api/v1/sales-orders',    orderRoutes); // Unified
app.use('/api/v1/orders',          orderRoutes); // Unified

// Legacy mount points
app.use('/api/v1/parties',   partyRoutes);
app.use('/api/v1/schedules', scheduleRoutes);
app.use('/api/v1/challans',  challanRoutes);
app.use('/api/v1/fms',       fmsRoutes);
app.use('/api/v1/ppc',       ppcRoutes);
app.use('/api/v1/dispatch-control', dispatchControlRoutes);
app.use('/api/v1/uploads',          uploadRoutes);
app.use('/api/v1/access-control',   accessControlRoutes);
app.use('/api/v1/pricing',          pricingRoutes);
app.use('/api/v1/quotes',           quoteRoutes);
app.use('/api/v1/o2d-fms',          o2dFmsRoutes); // Flow Management System (process tracking)
app.use('/api/v1/notifications',    notificationRoutes);

// ── Static — uploaded files (served as /uploads/...) ────────
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads'), {
  maxAge: '1h',
  fallthrough: true,
}));

// ── 404 Handler ─────────────────────────────────────────────
app.all('*', (req, _res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// ── Global Error Handler ────────────────────────────────────
app.use(errorHandler);

export default app;
