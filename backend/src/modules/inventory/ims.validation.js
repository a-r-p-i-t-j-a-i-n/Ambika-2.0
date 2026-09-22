import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const overviewQuerySchema = Joi.object({
  search:   Joi.string().max(120).allow('', null),
  category: Joi.string().max(120).allow('', null),
  itemType: Joi.string().valid('CONSUMABLE', 'PACKING', 'PACKAGING'),
  status:   Joi.string().valid('OK', 'LOW', 'REORDER', 'OUT_OF_STOCK', 'OVERSTOCK'),
  limit:    Joi.number().integer().min(1).max(5000),
}).unknown(true);

export const forecastQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(120),
}).unknown(true);

// Kept as plain YYYY-MM-DD strings (no Joi date coercion) so the service can bucket
// them on the IST calendar itself.
const ymd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
export const historyQuerySchema = Joi.object({
  from:      ymd,
  to:        ymd,
  warehouse: Joi.string().trim().max(40).allow('', null),
}).unknown(true);

export const skuParamSchema = Joi.object({
  skuId: objectId.required(),
});

/**
 * Safety Factor — the buffer multiplier in  Max Level = ADC × Lead Time × SF.
 *
 * The client plans in 0.1 steps between 1.0 and 5.0: under 1.0 the "safety"
 * stock would sit *below* the lead-time demand (a negative buffer), and over
 * 5.0 is overstocking rather than cover. Kept here, not on the shared
 * InventoryPolicy schema, because RM IMS and FG IMS write the same collection
 * with their own (wider) ranges.
 */
export const SAFETY_FACTOR_MIN = 1;
export const SAFETY_FACTOR_MAX = 5;
export const SAFETY_FACTOR_STEP = 0.1;

/**
 * Validate + snap a Safety Factor to the allowed range/step.
 * @returns {{ ok: true, value: number } | { ok: false, message: string }}
 */
export const checkSafetyFactor = (input) => {
  const n = Number(input);
  if (!Number.isFinite(n)) return { ok: false, message: 'Safety Factor must be a number.' };
  if (n < SAFETY_FACTOR_MIN || n > SAFETY_FACTOR_MAX) {
    return { ok: false, message: `Safety Factor must be between ${SAFETY_FACTOR_MIN.toFixed(1)} and ${SAFETY_FACTOR_MAX.toFixed(1)}.` };
  }
  // 1.2 / 0.1 is 11.999… in binary floating point, so compare against the
  // nearest whole step with a tolerance instead of using a modulo.
  const steps = n / SAFETY_FACTOR_STEP;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    return { ok: false, message: 'Safety Factor must be in steps of 0.1 (e.g. 1.0, 1.2, 1.5, 2.0).' };
  }
  return { ok: true, value: Math.round(steps) / 10 };
};

const safetyFactorField = Joi.number()
  .min(SAFETY_FACTOR_MIN).max(SAFETY_FACTOR_MAX)
  .custom((value, helpers) => {
    // Range is already reported by .min()/.max(); this rule only polices the step,
    // so an out-of-range value does not collect two messages.
    if (value < SAFETY_FACTOR_MIN || value > SAFETY_FACTOR_MAX) return value;
    const res = checkSafetyFactor(value);
    return res.ok ? res.value : helpers.error('any.invalid');
  })
  .messages({
    'number.min': `safetyFactor must be between ${SAFETY_FACTOR_MIN.toFixed(1)} and ${SAFETY_FACTOR_MAX.toFixed(1)}`,
    'number.max': `safetyFactor must be between ${SAFETY_FACTOR_MIN.toFixed(1)} and ${SAFETY_FACTOR_MAX.toFixed(1)}`,
    'any.invalid': 'safetyFactor must be in steps of 0.1 (e.g. 1.0, 1.2, 1.5, 2.0)',
  });

export const policySchema = Joi.object({
  averageDailyConsumption: Joi.number().min(0),
  leadDays:        Joi.number().min(0),
  safetyFactor:    safetyFactorField,
  moq:             Joi.number().min(0),
  maxLevel:        Joi.number().min(0),
  // AUTO  → Max Level is always recomputed from ADC × Lead Time × Safety Factor.
  // MANUAL→ the stored maxLevel is a deliberate override; the formula is ignored.
  maxLevelMode:    Joi.string().valid('AUTO', 'MANUAL'),
  materialInTransit: Joi.number().min(0),
  openingStock:    Joi.number().min(0),
  convertedItemName: Joi.string().trim().max(200).allow('', null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
}).min(1);

const lineItem = Joi.object({
  skuId:    objectId.required(),
  skuCode:  Joi.string().trim().max(60).allow('', null),
  quantity: Joi.number().greater(0).required(),
  unitCost: Joi.number().min(0),
  batchNo:  Joi.string().trim().max(60).allow('', null),
  remarks:  Joi.string().trim().max(500).allow('', null),
});

/**
 * Why a manual Stock-In was made. The code is stored on the movement; the label
 * is what History shows. OTHER carries the operator's own words in customReason
 * instead of minting a new code per one-off situation.
 */
export const STOCK_IN_REASONS = {
  VENDOR_RECEIPT:        'Vendor receipt',
  OPENING_STOCK:         'Opening stock',
  CORRECTION_ADJUSTMENT: 'Correction / adjustment',
  OTHER:                 'Other',
};

// The codes the Stock-In form posted before this change. Still accepted and
// mapped forward, so nothing that already speaks the old vocabulary breaks.
const LEGACY_REASON_CODES = {
  VENDOR:     'VENDOR_RECEIPT',
  OPENING:    'OPENING_STOCK',
  CORRECTION: 'CORRECTION_ADJUSTMENT',
};

/** Accepts either vocabulary and always returns the current code. */
export const normalizeStockInReason = (value) => {
  const v = String(value || '').trim().toUpperCase();
  const code = LEGACY_REASON_CODES[v] || v;
  return STOCK_IN_REASONS[code] ? code : 'VENDOR_RECEIPT';
};

/** @returns {{ok:true, reason:string, customReason:string}|{ok:false, message:string}} */
export const checkStockInReason = (reason, customReason) => {
  const code = normalizeStockInReason(reason);
  const custom = String(customReason || '').trim();
  if (code === 'OTHER' && !custom) {
    return { ok: false, message: 'Custom Reason is required when Reason is Other.' };
  }
  if (custom.length > 200) {
    return { ok: false, message: 'Custom Reason must be 200 characters or fewer.' };
  }
  // A custom reason only means anything alongside OTHER — drop it otherwise so a
  // predefined reason can never carry stray text.
  return { ok: true, reason: code, customReason: code === 'OTHER' ? custom : '' };
};

export const receiveSchema = Joi.object({
  date:      Joi.date(),
  reason:    Joi.string()
    .valid(...Object.keys(STOCK_IN_REASONS), ...Object.keys(LEGACY_REASON_CODES))
    .default('VENDOR_RECEIPT'),
  // Required only for OTHER; ignored (and blanked by the service) for the rest.
  customReason: Joi.when('reason', {
    is: 'OTHER',
    then: Joi.string().trim().min(1).max(200).required().messages({
      'any.required':  'Custom Reason is required when Reason is Other.',
      'string.empty':  'Custom Reason is required when Reason is Other.',
    }),
    otherwise: Joi.string().trim().max(200).allow('', null).default(''),
  }),
  reference: Joi.string().trim().max(120).allow('', null),
  warehouse: Joi.string().trim().max(40).allow('', null),
  items:     Joi.array().items(lineItem).min(1).required(),
});

export const issueSchema = Joi.object({
  date:        Joi.date(),
  purpose:     Joi.string().trim().max(200).allow('', null),
  issuedTo:    Joi.string().trim().max(120).allow('', null),
  department:  Joi.string().trim().max(120).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});
