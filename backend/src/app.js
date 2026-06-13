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
import orderIntakeRoutes from './modules/order-intake/order-intake.routes.js';
// Purchase FMS
import indentRoutes from './modules/procurement/indent/indent.routes.js';
import vendorPoRoutes from './modules/procurement/purchase-order/purchaseOrder.routes.js';
import followUpRoutes from './modules/procurement/follow-up/followUp.routes.js';
import proformaInvoiceRoutes from './modules/procurement/proforma-invoice/proformaInvoice.routes.js';
import advancePaymentRoutes from './modules/procurement/advance-payment/advancePayment.routes.js';

// Shared inventory stock-movement foundation (reused by GRN etc.)
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import grnRoutes from './modules/procurement/grn/grn.routes.js';
import incomingQcRoutes from './modules/procurement/incoming-qc/incomingQc.routes.js';
import vendorInvoiceRoutes from './modules/procurement/vendor-invoice/vendorInvoice.routes.js';
import voucherRoutes from './modules/procurement/voucher/voucher.routes.js';
import tallyEntryRoutes from './modules/procurement/tally-entry/tallyEntry.routes.js';
import finalPaymentRoutes from './modules/procurement/final-payment/finalPayment.routes.js';



const app = express();

// Trust the reverse proxy (Render) to properly set X-Forwarded-For headers
app.set('trust proxy', 1);

// ── Security Middleware ─────────────────────────────────────
// Allow the (different-origin) frontend to load files/images served by this API
// — otherwise Helmet's default same-origin CORP blocks attachment previews.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
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
app.use('/api/v1/order-intake',     orderIntakeRoutes);
app.use('/api/v1/procurement/indents', indentRoutes); // Purchase FMS — Purchase Indents
app.use('/api/v1/procurement/purchase-orders', vendorPoRoutes); // Purchase FMS — Vendor POs (Step 1.4)
app.use('/api/v1/procurement/follow-ups', followUpRoutes); // Purchase FMS — Material Follow-ups (Step 1.5)
app.use('/api/v1/procurement/proforma-invoices', proformaInvoiceRoutes); // Purchase FMS — PI Forms (Step 1.6)
app.use('/api/v1/procurement/advance-payments', advancePaymentRoutes); // Purchase FMS — Advance Payments (Step 1.7)

app.use('/api/v1/inventory', inventoryRoutes); // Shared inventory stock-movement foundation
app.use('/api/v1/procurement/grns', grnRoutes); // Purchase FMS — Goods Receipt Notes (Step 1.8)
app.use('/api/v1/procurement/incoming-qc', incomingQcRoutes); // Purchase FMS — Incoming QC (Step 1.9)
app.use('/api/v1/procurement/vendor-invoices', vendorInvoiceRoutes); // Purchase FMS — Vendor Invoices (Step 1.10)
app.use('/api/v1/procurement/vouchers', voucherRoutes); // Purchase FMS — Vouchers (Step 1.11)
app.use('/api/v1/procurement/tally-entries', tallyEntryRoutes); // Purchase FMS — Purchase Entry in Tally (Step 1.12)
app.use('/api/v1/procurement/final-payments', finalPaymentRoutes); // Purchase FMS — Make Payment (Step 1.13)


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
