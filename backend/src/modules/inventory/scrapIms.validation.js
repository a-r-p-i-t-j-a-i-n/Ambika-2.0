import Joi from 'joi';
import { SCRAP_LOCATIONS, SCRAP_DISPOSITIONS, SCRAP_BATCH_STATUS } from './scrapRecord.model.js';
import { SCRAP_QTY_UNIT_CODES, resolveScrapQuantity, buyerRequiredFor } from './scrapUom.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * A calendar day as a plain YYYY-MM-DD string, checked against a real calendar.
 * Same rule the RM history endpoint uses: the shape alone lets "2026-13-45"
 * through, which then builds an Invalid Date deep inside an aggregation.
 */
const ymdDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return helpers.error('any.invalid');
    const probe = new Date(Date.UTC(y, m - 1, d));
    const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
    return real ? value : helpers.error('any.invalid');
  })
  .messages({
    'string.pattern.base': 'date must be in YYYY-MM-DD format',
    'any.invalid': 'date must be a real calendar date (YYYY-MM-DD)',
  });

/** The filters both the register and the dashboard accept. */
const scrapFilters = {
  location:    Joi.string().valid(...SCRAP_LOCATIONS),
  disposition: Joi.string().valid(...SCRAP_DISPOSITIONS),
  batchStatus: Joi.string().valid(...SCRAP_BATCH_STATUS),
  coilSkuCode: Joi.string().trim().max(60).allow('', null),
  from:        ymdDate,
  to:          ymdDate,
  search:      Joi.string().trim().max(120).allow('', null),
};

export const scrapOverviewQuerySchema = Joi.object({
  ...scrapFilters,
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
}).unknown(true);

export const scrapDashboardQuerySchema = Joi.object(scrapFilters).unknown(true);

/**
 * Scrap grouped by PHYSICAL coil.
 *
 * Takes the register's own filters, so the two screens can be narrowed the same
 * way and a location or date range means the same thing in both. Paged, because
 * one row per received coil is a list that grows with every delivery — unlike
 * the dashboard's by-grade breakdown, which is bounded by the SKU master.
 */
export const scrapByCoilQuerySchema = Joi.object({
  ...scrapFilters,
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
}).unknown(true);

/**
 * Scrap master data — one row per COIL SKU (getMasterBySku), and the cuts of
 * one coil SKU behind its row (getSkuHistory). The register's location, dates
 * and search, with the same meanings; the row order; paging for the SKUs.
 */
const scrapMasterFilters = {
  location: scrapFilters.location,
  from:     ymdDate,
  to:       ymdDate,
  search:   scrapFilters.search,
};
export const scrapMasterQuerySchema = Joi.object({
  ...scrapMasterFilters,
  // Newest cut first (default), oldest first, coil SKU A → Z, or most scrap.
  sort:  Joi.string().trim().lowercase().valid('latest', 'oldest', 'az', 'scrap').allow('', null),
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(200),
}).unknown(true);
export const scrapSkuHistoryQuerySchema = Joi.object({
  ...scrapMasterFilters,
  coilSkuCode: Joi.string().trim().max(60).required(),
}).unknown(true);

export const scrapRecordParamSchema = Joi.object({ id: objectId.required() });

/* ══ Manual Scrap In / Scrap Out ═══════════════════════════════════════════ */

/**
 * Why scrap gets its own reason vocabulary.
 *
 * The shared IMS lists do not fit: STOCK_IN_REASONS is built around buying
 * ("Vendor receipt"), and scrap is never bought; STOCK_OUT_REASONS is built
 * around consuming ("Production issue"), and scrap is never consumed — it is
 * sold, dumped or moved. Forcing either list on scrap would make every entry
 * read as OTHER, which is exactly the free-text soup the reason codes exist to
 * prevent.
 */
export const SCRAP_IN_REASONS = {
  PRODUCTION_RETURN:     'Returned from production',
  JOB_WORK_RETURN:       'Returned by job worker',
  OPENING_STOCK:         'Opening stock',
  CORRECTION_ADJUSTMENT: 'Correction / adjustment',
  OTHER:                 'Other',
};

export const SCRAP_OUT_REASONS = {
  SALE:                  'Sold',
  DISPOSAL:              'Disposed of',
  TRANSFER:              'Transferred out',
  CORRECTION_ADJUSTMENT: 'Correction / adjustment',
  OTHER:                 'Other',
};

/**
 * Where scrap is held. The same two codes the cutting locations use, because
 * they ARE warehouses in the ledger already, plus MAIN for a central store.
 */
export const SCRAP_WAREHOUSES = [...SCRAP_LOCATIONS, 'MAIN'];

/**
 * "Other" needs the operator's own words — the same conditional both IMS entry
 * screens use, so the register can always explain a movement it did not name
 * itself.
 */
const customReasonField = Joi.when('reason', {
  is: 'OTHER',
  then: Joi.string().trim().min(1).max(200).required().messages({
    'any.required': 'Custom Reason is required when Reason is Other.',
    'string.empty': 'Custom Reason is required when Reason is Other.',
  }),
  otherwise: Joi.string().trim().max(200).allow('', null).default(''),
});

/**
 * The id the entry screen mints for one submission. Optional, so a caller that
 * sends none behaves as before; when present it makes the entry idempotent — a
 * double-click or a browser retry is recognised instead of moving stock twice.
 */
const clientRequestIdField = Joi.string().trim().max(100).allow('', null);

/**
 * Scrap is weighed, never counted, so there is ONE quantity field and it is
 * kilograms. `greater(0)` not `min(0)`: a zero-kilogram movement is not a
 * correction, it is a mistake, and the stock engine rejects it anyway.
 */
const scrapQtyField = Joi.number().greater(0).required().messages({
  'number.greater': 'Quantity must be more than zero.',
  'any.required': 'Quantity is required.',
});

const scrapEntryBase = {
  date:            Joi.date(),
  clientRequestId: clientRequestIdField,
  quantityKg:      scrapQtyField,
  warehouse:       Joi.string().trim().uppercase().valid(...SCRAP_WAREHOUSES).default('PLG01'),
  customReason:    customReasonField,
  // Who it came from / went to. A plain name: scrap parties are not in the
  // Party master and the source names them only as text.
  partyName:       Joi.string().trim().max(200).allow('', null),
  reference:       Joi.string().trim().max(120).allow('', null),
  remarks:         Joi.string().trim().max(500).allow('', null),
};

export const scrapInSchema = Joi.object({
  ...scrapEntryBase,
  reason: Joi.string().valid(...Object.keys(SCRAP_IN_REASONS)).default('PRODUCTION_RETURN'),
});

/**
 * Scrap Out.
 *
 * Quantity arrives in one of two shapes. The screen now sends the figure the
 * way the weighbridge slip reads it — `quantity` plus `uom` (KG / Quintal /
 * Ton). Every earlier client sent `quantityKg`, and still may. Either way the
 * service moves KILOGRAMS: the conversion, the decimal limits and the
 * "less than the ledger can record" floor all live in scrapUom.js, and this
 * schema runs the very same function the service does, so the two can never
 * disagree about one entry.
 *
 * A SALE must name its buyer, as a Scrap Buyer master id. Every other reason
 * keeps the optional free-text "Issued to" (`partyName`) exactly as before —
 * for a transfer that names a site, not a buyer. `reason` defaults to SALE, so
 * a caller that sends no reason is held to the buyer rule too.
 */
export const scrapOutSchema = Joi.object({
  ...scrapEntryBase,
  quantityKg: Joi.number().greater(0).messages({
    'number.greater': 'Quantity must be more than zero.',
    'number.base': 'Quantity must be a number.',
  }),
  quantity: Joi.number().greater(0).messages({
    'number.greater': 'Quantity must be more than zero.',
    'number.base': 'Quantity must be a number.',
  }),
  uom: Joi.string().trim().uppercase().valid(...SCRAP_QTY_UNIT_CODES).messages({
    'any.only': 'Unit must be KG, Quintal or Ton.',
  }),
  buyerId: objectId.allow('', null).messages({ 'string.pattern.base': 'That is not a valid buyer.' }),
  reason: Joi.string().valid(...Object.keys(SCRAP_OUT_REASONS)).default('SALE'),
  // The same override every other Stock Out carries: stock figures can lag
  // reality, and a supervisor must be able to record what physically left.
  allowNegative: Joi.boolean().default(false),
}).custom((value, helpers) => {
  const q = resolveScrapQuantity(value);
  if (!q.ok) return helpers.message(q.error);
  if (buyerRequiredFor(value.reason) && !value.buyerId) {
    return helpers.message('Choose who the scrap was sold to. A buyer is required when Reason is Sold.');
  }
  return value;
});

/* ══ Scrap Buyer master ═══════════════════════════════════════════════════ */

export const createScrapBuyerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).required().messages({
    'any.required': 'Buyer name is required.',
    'string.empty': 'Buyer name is required.',
    'string.min': 'Buyer name must be at least 2 characters.',
  }),
  contactPerson: Joi.string().trim().max(100).allow('', null),
  phone:         Joi.string().trim().max(30).allow('', null),
  email:         Joi.string().trim().email({ tlds: false }).max(200).allow('', null)
    .messages({ 'string.email': 'That email address does not look right.' }),
  address:       Joi.string().trim().max(500).allow('', null),
  state:         Joi.string().trim().max(50).allow('', null),
  gstNo:         Joi.string().trim().max(20).allow('', null),
  remarks:       Joi.string().trim().max(500).allow('', null),
});

export const scrapBuyerQuerySchema = Joi.object({
  search:          Joi.string().trim().max(120).allow('', null),
  limit:           Joi.number().integer().min(1).max(200),
  includeInactive: Joi.boolean(),
}).unknown(true);

export const scrapBuyerParamSchema = Joi.object({ id: objectId.required() });

export const scrapMovementsQuerySchema = Joi.object({
  warehouse: Joi.string().trim().uppercase().valid(...SCRAP_WAREHOUSES),
  txnType:   Joi.string().valid('SCRAP_IN', 'SCRAP_OUT'),
  from:      ymdDate,
  to:        ymdDate,
  search:    Joi.string().trim().max(120).allow('', null),
  // Everything sold to one buyer, by master id — exact, unlike `search`.
  buyerId:   objectId,
  page:      Joi.number().integer().min(1),
  limit:     Joi.number().integer().min(1).max(500),
}).unknown(true);

/**
 * Scrap Out history — the table under the Scrap Out form. The direction is
 * fixed to SCRAP_OUT by the service, so there is no txnType here; `reason`
 * takes the Scrap Out codes only.
 */
export const scrapOutHistoryQuerySchema = Joi.object({
  warehouse: Joi.string().trim().uppercase().valid(...SCRAP_WAREHOUSES),
  reason:    Joi.string().valid(...Object.keys(SCRAP_OUT_REASONS)),
  from:      ymdDate,
  to:        ymdDate,
  search:    Joi.string().trim().max(120).allow('', null),
  buyerId:   objectId,
  page:      Joi.number().integer().min(1),
  limit:     Joi.number().integer().min(1).max(100),
}).unknown(true);
