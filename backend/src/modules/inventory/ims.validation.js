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

/**
 * A calendar day, kept as a plain YYYY-MM-DD string (no Joi date coercion) so
 * the service can bucket it on the IST calendar itself.
 *
 * The shape alone is not enough: "2026-13-45" matches the pattern, and the
 * service then built an Invalid Date from it and threw deep inside a
 * toLocaleDateString — a 500 for what is plainly a bad request. The parts are
 * checked against a real calendar here, which also rejects 2026-02-30.
 */
export const ymdDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return helpers.error('any.invalid');
    const probe = new Date(Date.UTC(y, m - 1, d));
    // Round-tripping catches the days a month does not have: Date rolls
    // 2026-02-30 forward to 2026-03-02 rather than rejecting it.
    const ok = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
    return ok ? value : helpers.error('any.invalid');
  })
  .messages({
    'string.pattern.base': 'date must be in YYYY-MM-DD format',
    'any.invalid': 'date must be a real calendar date (YYYY-MM-DD)',
  });

export const historyQuerySchema = Joi.object({
  from:      ymdDate,
  to:        ymdDate,
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

/**
 * Reasons that may no longer be used for a NEW Stock In, and why.
 *
 * VENDOR_RECEIPT is material arriving from a supplier, which is exactly what
 * Purchase FMS owns: the GRN records the receipt, the MD signs it and Incoming
 * QC decides how much is accepted — only then does it become usable stock.
 * Typing the same delivery into Stock In created usable stock with no GRN, no
 * signature and no QC, and (when the GRN was completed too) a second movement
 * for one physical receipt.
 *
 * It stays in STOCK_IN_REASONS above because movements already posted under it
 * must keep rendering their label in History — only new entries are refused.
 * Opening stock, corrections and OTHER are untouched: they describe material
 * that never came from a supplier delivery, and each still carries its own
 * authorization and audit trail.
 */
export const RETIRED_STOCK_IN_REASONS = {
  VENDOR_RECEIPT:
    'Vendor receipt is not a Stock In reason any more — material received from a supplier must be entered as a GRN, so the MD can sign it and Incoming QC can accept it. '
    + 'Raise a GRN against the Purchase Order (or a Without-PO GRN when there is no order); the accepted quantity is posted to this store automatically when its QC completes. '
    + 'Use "Correction / adjustment" only to fix a counting mistake, and "Opening stock" only for material that was already in the store before IMS.',
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
  // Refused before anything else: a supplier delivery belongs to Purchase FMS.
  // normalizeStockInReason maps the older VENDOR code here too, and falls back
  // to VENDOR_RECEIPT for an unrecognised one, so neither an older client build
  // nor a stray code can post a vendor receipt around the GRN + QC route.
  if (RETIRED_STOCK_IN_REASONS[code]) {
    return { ok: false, message: RETIRED_STOCK_IN_REASONS[code] };
  }
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

/**
 * Why material left the store on a manual Stock Out.
 *
 * Deliberately only reasons that ARE consumption. Every Stock Out still posts a
 * CONSUME_OUT, which is what Average Daily Consumption is measured from, so a
 * reason must never describe something that is not consumption — writing off
 * damage or correcting a miscount through this screen would quietly inflate
 * every reorder level built on ADC. Those belong in a separate adjustment flow.
 */
export const STOCK_OUT_REASONS = {
  PRODUCTION_ISSUE: 'Production issue',
  MAINTENANCE:      'Maintenance / upkeep',
  SAMPLE_TESTING:   'Sample / testing',
  OTHER:            'Other',
};

/**
 * Same shape as checkStockInReason: an unknown code falls back to the default
 * rather than failing, and OTHER must carry the operator's own words.
 * @returns {{ok:true, reason:string, customReason:string}|{ok:false, message:string}}
 */
export const checkStockOutReason = (reason, customReason) => {
  const v = String(reason || '').trim().toUpperCase();
  const code = STOCK_OUT_REASONS[v] ? v : 'PRODUCTION_ISSUE';
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

/**
 * The id an entry screen mints for one submission. Optional everywhere, so every
 * existing caller is unaffected; when present it makes the entry idempotent —
 * a double-click or a browser retry is recognised instead of posting twice.
 */
export const clientRequestIdField = Joi.string().trim().max(100).allow('', null);

export const receiveSchema = Joi.object({
  date:      Joi.date(),
  clientRequestId: clientRequestIdField,
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
  clientRequestId: clientRequestIdField,
  // Optional and defaulted, so a Stock Out posted before this field existed —
  // or by any caller that does not send one — behaves exactly as it always did.
  reason:      Joi.string().valid(...Object.keys(STOCK_OUT_REASONS)).default('PRODUCTION_ISSUE'),
  customReason: Joi.when('reason', {
    is: 'OTHER',
    then: Joi.string().trim().min(1).max(200).required().messages({
      'any.required': 'Custom Reason is required when Reason is Other.',
      'string.empty': 'Custom Reason is required when Reason is Other.',
    }),
    otherwise: Joi.string().trim().max(200).allow('', null).default(''),
  }),
  purpose:     Joi.string().trim().max(200).allow('', null),
  issuedTo:    Joi.string().trim().max(120).allow('', null),
  department:  Joi.string().trim().max(120).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});
