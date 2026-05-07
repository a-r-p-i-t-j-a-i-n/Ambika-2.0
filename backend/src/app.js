import express from 'express';
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
import partyRoutes    from './modules/party/party.routes.js';
import skuRoutes      from './modules/sku/sku.routes.js';
import orderRoutes    from './modules/order/order.routes.js';
import scheduleRoutes from './modules/schedule/schedule.routes.js';
import challanRoutes  from './modules/challan/challan.routes.js';
import fmsRoutes      from './modules/fms/fms.routes.js';
import ppcRoutes      from './modules/ppc/ppc.routes.js';

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
app.use('/api/v1/auth',      authRoutes);
app.use('/api/v1/parties',   partyRoutes);
app.use('/api/v1/skus',      skuRoutes);
app.use('/api/v1/orders',    orderRoutes);
app.use('/api/v1/schedules', scheduleRoutes);
app.use('/api/v1/challans',  challanRoutes);
app.use('/api/v1/fms',       fmsRoutes);
app.use('/api/v1/ppc',       ppcRoutes);

// ── 404 Handler ─────────────────────────────────────────────
app.all('*', (req, _res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// ── Global Error Handler ────────────────────────────────────
app.use(errorHandler);

export default app;
