import Joi from 'joi';
import {
  SAFETY_FACTOR_MIN, SAFETY_FACTOR_MAX, checkSafetyFactor,
  STOCK_IN_REASONS, STOCK_OUT_REASONS,
} from './ims.validation.js';
// The same "Received At" vocabulary the GRN Complete dialog validates against
// (see grn.validation.js) — imported rather than restated, so Cut Coils cannot
// drift from it. This is the field that decides scrap OWNERSHIP
// (resolveScrapLocation / isPhysicalScrap in rmIms.service.js), so it is
// enforced here rather than left to whatever string the client happens to send.
import { RM_RECEIVED_AT_LOCATIONS } from './inventoryStock.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * The Stock-In reason codes the RM form posted before it adopted the shared
 * vocabulary. Still accepted here and mapped forward by normalizeStockInReason,
 * so an older client build — or a replayed request — never starts failing.
 */
const RM_LEGACY_STOCK_IN_CODES = ['VENDOR', 'OPENING', 'CORRECTION'];

/**
 * Safety Factor — the buffer multiplier in  Max Level = ADC × Lead Time × SF.
 *
 * Raw Material plans on exactly the same rule as Consumables & Packaging, so it
 * uses the same range and the same step: 1.0–5.0 in 0.1 steps. The bounds and
 * the snapping rule live in ims.validation (one source of truth); only the Joi
 * wrapper is rebuilt here, because that wrapper is module-private over there.
 *
 * Before this, rmPolicySchema accepted `Joi.number().min(0)` — 0 and 0.37 both
 * passed, and a Safety Factor below 1 makes the safety stock negative.
 */
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

/**
 * "Other" needs the operator's own words — the same conditional both IMS entry
 * screens use, so History can always explain a movement it did not name itself.
 */
const customReasonField = Joi.when('reason', {
  is: 'OTHER',
  then: Joi.string().trim().min(1).max(200).required().messages({
    'any.required': 'Custom Reason is required when Reason is Other.',
    'string.empty': 'Custom Reason is required when Reason is Other.',
  }),
  otherwise: Joi.string().trim().max(200).allow('', null).default(''),
});

export const rmOverviewQuerySchema = Joi.object({
  search:   Joi.string().max(120).allow('', null),
  category: Joi.string().max(120).allow('', null),
  itemType: Joi.string().valid('RAW_MATERIAL', 'CIRCLE'),
  kind:     Joi.string().valid('COIL', 'CIRCLE'),
  status:   Joi.string().valid('OK', 'LOW', 'REORDER', 'OUT_OF_STOCK', 'OVERSTOCK'),
  limit:    Joi.number().integer().min(1).max(8000),
}).unknown(true);

export const rmForecastQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(120),
}).unknown(true);

export const rmSkuParamSchema = Joi.object({ skuId: objectId.required() });

/**
 * A calendar day as a plain YYYY-MM-DD string, so the service can bucket it on
 * the IST calendar itself. The shape alone is not enough — "2026-13-45" matches
 * the pattern and would build an Invalid Date deep inside the aggregation, so
 * the parts are checked against a real calendar. Same rule Consumables uses.
 */
const ymdDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return helpers.error('any.invalid');
    const probe = new Date(Date.UTC(y, m - 1, d));
    const okDate = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
    return okDate ? value : helpers.error('any.invalid');
  })
  .messages({
    'string.pattern.base': 'date must be in YYYY-MM-DD format',
    'any.invalid': 'date must be a real calendar date (YYYY-MM-DD)',
  });

export const rmHistoryQuerySchema = Joi.object({
  from: ymdDate,
  to:   ymdDate,
}).unknown(true);

export const rmPolicySchema = Joi.object({
  adcLow:    Joi.number().min(0),
  adcNormal: Joi.number().min(0),
  adcPeak:   Joi.number().min(0),
  consumptionMode: Joi.string().valid('LOW', 'NORMAL', 'PEAK'),
  averageDailyConsumption: Joi.number().min(0),
  leadDays:        Joi.number().min(0),
  safetyFactor:    safetyFactorField,
  moq:             Joi.number().min(0),
  maxLevel:        Joi.number().min(0),
  // AUTO  → Max Level is always recomputed from ADC × Lead Time × Safety Factor.
  // MANUAL→ the stored maxLevel is a deliberate override; the formula is ignored.
  maxLevelMode:    Joi.string().valid('AUTO', 'MANUAL'),
  materialInTransit: Joi.number().min(0),
  bookedQty:       Joi.number().min(0),
  openingStock:    Joi.number().min(0),
  vendorName:      Joi.string().trim().max(200).allow('', null),
  rate:            Joi.number().min(0),
  convertedItemName: Joi.string().trim().max(200).allow('', null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
}).min(1);

const lineItem = Joi.object({
  skuId:    objectId.required(),
  skuCode:  Joi.string().trim().max(60).allow('', null),
  // The stock quantity, in the SKU's OWN unit: kilograms for a coil, pieces for
  // a circle. Never one standing in for the other.
  quantity: Joi.number().greater(0).required(),
  // The weight recorded beside a piece count, for circles. Optional because the
  // source often does not state one — an issue to production gives pieces only —
  // and `null` is kept distinct from 0 all the way to the ledger.
  quantityKg: Joi.number().min(0).allow(null),
  unitCost: Joi.number().min(0),
  batchNo:  Joi.string().trim().max(60).allow('', null),
  remarks:  Joi.string().trim().max(500).allow('', null),
});

/**
 * The id the entry screen mints for one submission. Optional, so every existing
 * caller is unaffected; when present it makes the entry idempotent — a
 * double-click or a browser retry is recognised instead of posting twice.
 */
const clientRequestIdField = Joi.string().trim().max(100).allow('', null);

export const rmReceiveSchema = Joi.object({
  date:      Joi.date(),
  clientRequestId: clientRequestIdField,
  // The shared IMS vocabulary, plus the three codes the RM form used to post.
  reason:    Joi.string()
    .valid(...Object.keys(STOCK_IN_REASONS), ...RM_LEGACY_STOCK_IN_CODES)
    .default('VENDOR_RECEIPT'),
  customReason: customReasonField,
  reference: Joi.string().trim().max(120).allow('', null),
  warehouse: Joi.string().trim().max(40).allow('', null),
  items:     Joi.array().items(lineItem).min(1).required(),
});

export const rmIssueSchema = Joi.object({
  date:        Joi.date(),
  clientRequestId: clientRequestIdField,
  // Optional and defaulted, so a Stock Out posted by an older client build —
  // which sent no reason at all — behaves exactly as it always did.
  reason:      Joi.string().valid(...Object.keys(STOCK_OUT_REASONS)).default('PRODUCTION_ISSUE'),
  customReason: customReasonField,
  purpose:     Joi.string().trim().max(200).allow('', null),
  issuedTo:    Joi.string().trim().max(120).allow('', null),
  department:  Joi.string().trim().max(120).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});

export const rmConvertSchema = Joi.object({
  conversionDate: Joi.date(),
  // Same submission id Stock In and Stock Out already send, so a replayed
  // cut is recognised rather than posted twice.
  clientRequestId: clientRequestIdField,
  batchNo:    Joi.string().trim().max(60).allow('', null),
  coilSkuId:  objectId.required(),
  /**
   * The GRN_IN movement of the physical coil being cut, when one was chosen.
   *
   * Optional on purpose. A coil received without a batch number cannot be
   * identified, so the by-item fallback has to keep working and every client
   * that predates this field keeps working unchanged. When it IS sent, the
   * service checks the receipt and takes the batch number from it rather than
   * trusting what was typed.
   */
  coilReceiptId: objectId.allow('', null),
  /**
   * "This coil genuinely has no goods receipt behind it."
   *
   * The counterpart to `coilReceiptId` being optional. Optional is no longer
   * the same as absent: a cut that names no receipt and does not tick this is
   * now REFUSED by the service, which instead resolves the batch number to a
   * receipt and binds it. Without this flag the 22 coils received with no batch
   * number could not be cut at all, and that fallback has to keep working.
   *
   * Defaulted false so every existing caller keeps its current meaning — what
   * changed is what the service does with that meaning, not the wire format.
   */
  manualFallback: Joi.boolean().default(false),
  /**
   * "Manual Entry — No GRN": a physical coil with no goods receipt, kept
   * traceable (unlike `manualFallback`, which names no coil at all).
   *
   *   manualCoilId  a coil already entered manually — a later round of it.
   *   manualCoil    a coil entered for the first time: its batch number and the
   *                 ORIGINAL weight of the whole coil (not this round's cut).
   *
   * At most one way of naming the coil per cut — see the oxor below.
   */
  manualCoilId: objectId.allow('', null),
  manualCoil: Joi.object({
    batchNo: Joi.string().trim().min(1).max(60).required().messages({
      'any.required': 'Enter the batch number of the coil.',
      'string.empty': 'Enter the batch number of the coil.',
    }),
    totalWeightKg: Joi.number().greater(0).required().messages({
      'any.required': 'Enter the total weight of the whole coil.',
      'number.base': 'Total coil weight must be a number.',
      'number.greater': 'Total coil weight must be greater than zero.',
    }),
  }).allow(null),
  coilWeightKg: Joi.number().greater(0).required(),
  rate:       Joi.number().min(0),
  /**
   * "Received At" — where the coil was actually CUT, not where it happened to
   * be received. This is the one field resolveScrapLocation() reads first (see
   * rmIms.service.js), and it alone decides whether the cut's offcut becomes
   * Ambika-owned scrap stock (PLG01) or stays with the job worker (JW001) — so
   * it is restricted to the two real cutting locations here, at the API
   * boundary, rather than trusted as free text. A caller that sends neither
   * falls back to the coil's own receipt location, exactly as before; a caller
   * that sends something else is refused outright instead of silently landing
   * on PLG01 by default.
   */
  warehouse:  Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow('', null)
    .messages({ 'any.only': `Received At must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` }),
  allowNegative: Joi.boolean().default(false),
  // The operator's choice for THIS round. Optional, so a caller that predates
  // it (a script, an older client) behaves exactly as before. FULL makes the
  // server take the coil's remaining weight, checked against what was sent.
  cuttingType: Joi.string().trim().uppercase().valid('FULL', 'PARTIAL').allow('', null)
    .messages({ 'any.only': 'Cutting type must be FULL or PARTIAL.' }),
  // Only the two values Cut Coils now offers are accepted from THIS endpoint.
  // The model/ScrapRecord enums keep JOB_WORK/REJECTED too, for the historical
  // rows and any other caller that still carries them — see coilConversion.model.js.
  scrapVerified: Joi.string().valid('PENDING', 'DONE'),
  remarks:    Joi.string().trim().max(1000).allow('', null),
  circles: Joi.array().items(Joi.object({
    circleSkuId: objectId.required(),
    sizeLabel:   Joi.string().trim().max(120).allow('', null),
    // Circles are STOCKED in pieces and only WEIGHED for yield, so the piece
    // count is what the ledger posts. It used to be optional, and the service
    // then fell back to the weight (`pcs > 0 ? pcs : wt`) — silently adding
    // kilograms to a balance counted in pieces. That fallback is now gone from
    // the service too; this required rule is the outer guard.
    pcs:         Joi.number().greater(0).required().messages({
      'any.required':     'Enter the number of pieces for every circle produced.',
      'number.greater':   'Pieces must be greater than zero.',
    }),
    // Still required: yield and scrap are weight-based.
    weightKg:    Joi.number().greater(0).required(),
  })).min(1).required(),
})
  // A cut names its coil ONE way. Sending a receipt and a manual coil (or a
  // manual coil and "No receipt available") is a confused client, not a choice.
  .custom((v, helpers) => {
    const ways = [v.coilReceiptId, v.manualCoilId, v.manualCoil, v.manualFallback === true]
      .filter((x) => x !== undefined && x !== null && x !== '' && x !== false);
    return ways.length > 1 ? helpers.error('any.invalid') : v;
  })
  .messages({ 'any.invalid': 'Name the coil one way only: a received coil (GRN), a manual-entry coil, or "No receipt available".' });

export const rmMovementQuerySchema = Joi.object({
  search:  Joi.string().max(120).allow('', null),
  txnType: Joi.string().max(40).allow('', null),
  page:    Joi.number().integer().min(1),
  limit:   Joi.number().integer().min(1).max(200),
}).unknown(true);

/**
 * Cutting History — one row per physical coil. Status is DERIVED on the server,
 * so filtering by it is a question, never an instruction.
 *
 * Two kinds of filter, and the difference matters (see listCuttingHistory):
 *   coil-level   search, batchNo, entryType, status — about the coil itself;
 *   round-level  from/to, circleSkuId, location — a coil is listed when at
 *                least ONE of its rounds satisfies all of them together.
 *
 * `from` / `to` are calendar days (YYYY-MM-DD, read in IST), the same shape
 * every other IMS history screen sends.
 */
const isoDay = Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': '{#label} must be a date (YYYY-MM-DD)' });
export const rmCuttingHistoryQuerySchema = Joi.object({
  search:   Joi.string().trim().max(120).allow('', null),
  batchNo:  Joi.string().trim().max(80).allow('', null),
  entryType: Joi.string().trim().uppercase().valid('GRN', 'MANUAL').allow('', null)
    .messages({ 'any.only': 'Entry type must be GRN or MANUAL' }),
  location: Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow('', null)
    .messages({ 'any.only': `Location must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` }),
  status:   Joi.string().trim().uppercase().valid('NOT_CUT', 'PARTIALLY_CUT', 'FULLY_CUT').allow('', null),
  circleSkuId: objectId.allow('', null)
    .messages({ 'string.pattern.base': 'Circle SKU is not a valid id' }),
  from:     isoDay.allow('', null).label('From date'),
  to:       isoDay.allow('', null).label('To date'),
  page:     Joi.number().integer().min(1),
  limit:    Joi.number().integer().min(1).max(200),
}).unknown(true).custom((v, helpers) => (
  // Compared as strings: both are YYYY-MM-DD, which sorts as it reads.
  v.from && v.to && v.from > v.to ? helpers.message('From date cannot be after To date') : v
));

/**
 * All conversions — one row per CUT. The Coil to Circle History's filters, with
 * the same names and the same meaning (see listConversions), asked of each cut:
 *
 *   batchNo, search        about the cut's batch / coil / GRN / supplier;
 *   from/to, circleSkuId,   about the cut itself — the day it was cut (IST),
 *   location               a circle it produced, where it was cut;
 *   entryType, status      about the coil it was cut from.
 *
 * `entryType` has one value the history does not need: NONE — a cut that names
 * no physical coil (the spreadsheet imports, "No receipt available"), which the
 * history never lists and this table always does.
 *
 * `page` is optional: a caller that sends only `limit` gets the newest cuts, as
 * before. `limit` stays at its old ceiling for those callers.
 */
export const rmConversionsQuerySchema = Joi.object({
  search:   Joi.string().trim().max(120).allow('', null),
  batchNo:  Joi.string().trim().max(80).allow('', null),
  entryType: Joi.string().trim().uppercase().valid('GRN', 'MANUAL', 'NONE').allow('', null)
    .messages({ 'any.only': 'Entry type must be GRN, MANUAL or NONE' }),
  location: Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow('', null)
    .messages({ 'any.only': `Location must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` }),
  status:   Joi.string().trim().uppercase().valid('NOT_CUT', 'PARTIALLY_CUT', 'FULLY_CUT').allow('', null),
  circleSkuId: objectId.allow('', null)
    .messages({ 'string.pattern.base': 'Circle SKU is not a valid id' }),
  from:     isoDay.allow('', null).label('From date'),
  to:       isoDay.allow('', null).label('To date'),
  page:     Joi.number().integer().min(1),
  limit:    Joi.number().integer().min(1).max(500),
}).unknown(true).custom((v, helpers) => (
  v.from && v.to && v.from > v.to ? helpers.message('From date cannot be after To date') : v
));

/**
 * The circle SKUs a cutting table can filter by. Default: those produced by
 * rounds that name a physical coil (the Coil to Circle History). `scope=all`:
 * those produced by ANY recorded cut, the imported ones included (All
 * conversions) — so a size only an older cut produced can still be found.
 */
export const rmCuttingCirclesQuerySchema = Joi.object({
  scope: Joi.string().trim().lowercase().valid('all').allow('', null),
}).unknown(true);

/**
 * The conversion ledger — every recorded cut in one table: a row per physical
 * coil, and a row per cut that names no coil (rmImsService.listConversionLedger).
 * The same filters, with the same meanings, as the two lists it unites;
 * `entryType` NONE is the cuts with no physical coil, COIL every physical coil.
 */
export const rmConversionLedgerQuerySchema = Joi.object({
  search:   Joi.string().trim().max(120).allow('', null),
  batchNo:  Joi.string().trim().max(80).allow('', null),
  // COIL: every physical coil (GRN or manual).
  entryType: Joi.string().trim().uppercase().valid('GRN', 'MANUAL', 'COIL', 'NONE').allow('', null)
    .messages({ 'any.only': 'Record type must be GRN, MANUAL, COIL or NONE' }),
  location: Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow('', null)
    .messages({ 'any.only': `Location must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` }),
  status:   Joi.string().trim().uppercase().valid('NOT_CUT', 'PARTIALLY_CUT', 'FULLY_CUT').allow('', null),
  circleSkuId: objectId.allow('', null)
    .messages({ 'string.pattern.base': 'Circle SKU is not a valid id' }),
  from:     isoDay.allow('', null).label('From date'),
  to:       isoDay.allow('', null).label('To date'),
  page:     Joi.number().integer().min(1),
  limit:    Joi.number().integer().min(1).max(200),
}).unknown(true).custom((v, helpers) => (
  v.from && v.to && v.from > v.to ? helpers.message('From date cannot be after To date') : v
));

/**
 * Finding the physical coil that is about to be cut.
 *
 * `q` is deliberately one box rather than a field per identifier: the operator
 * may be holding the coil (batch number), the receipt (GRN), the order (PO) or
 * the request (indent), and only the batch number names one coil. The other
 * three each cover several coils, so they narrow the list and the operator
 * picks from it.
 */
export const rmReceivedCoilsQuerySchema = Joi.object({
  q:         Joi.string().trim().max(120).allow('', null),
  // An EXACT batch number (any case) — how Cut Coils resolves the coil the
  // operator typed, so a short batch is never lost behind partial matches.
  batchNo:   Joi.string().trim().max(120).allow('', null),
  skuId:     objectId.allow('', null),
  warehouse: Joi.string().trim().max(40).allow('', null),
  // Fully-cut coils are hidden by default — they cannot be cut again. Kept
  // reachable so the screen can explain why a batch someone remembers is gone.
  includeConsumed: Joi.boolean().default(false),
  // Cut Coils only: offer just the coils the Coil → Circle sheet maps. Off by
  // default so Stock In's duplicate-batch check still sees every coil.
  circleMapped: Joi.boolean().default(false),
  // The "Select GRN / Received Coil" dropdown: only receipts of a COMPLETED,
  // stock-posted GRN (or the historical GRN register import). Off by default,
  // so the batch-number lookup keeps finding exactly what it always found.
  grnOnly: Joi.boolean().default(false),
  limit:     Joi.number().integer().min(1).max(100),
}).unknown(true);

/**
 * Manual Entry — No GRN: is this batch number already a coil?
 * Answers with the manual coil it names (to continue its rounds) or the goods
 * receipt that already carries it (which must be cut from its GRN instead).
 */
export const rmManualCoilLookupQuerySchema = Joi.object({
  batchNo: Joi.string().trim().min(1).max(60).required(),
}).unknown(true);

/**
 * Which circle sizes the identified coil is approved to produce.
 *
 * The coil is named by id, not by code: the screen already knows the id of the
 * coil the batch number resolved to, and the server reads that SKU's own code
 * to consult the client's mapping. A caller therefore cannot ask about a coil
 * code that is not the coil they are holding.
 */
/**
 * One physical coil's cutting history.
 *
 * The parameter is the GRN_IN movement's own id — the stable internal key the
 * conversion already stores as `coilReceiptId`. Deliberately NOT a batch
 * number: a batch number is a business identifier printed on a label, it is
 * free text, and the whole point of this feature is that lineage does not
 * depend on it.
 */
export const rmCoilLineageParamSchema = Joi.object({
  receiptId: objectId.required().messages({
    'any.required': 'Say which received coil to show.',
    'string.pattern.base': 'That is not a received-coil reference.',
  }),
});

export const rmCircleOptionsQuerySchema = Joi.object({
  coilSkuId: objectId.required().messages({
    'any.required': 'Pick the coil being cut before choosing circle sizes.',
  }),
}).unknown(true);
