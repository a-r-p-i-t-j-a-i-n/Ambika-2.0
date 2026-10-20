/**
 * Stock In can no longer be used as a vendor receipt.
 *
 * Material that arrives from a supplier belongs to Purchase FMS: the GRN
 * records it, the MD signs it and Incoming QC decides how much is accepted —
 * and only that quantity becomes usable stock. Typing the same delivery into
 * the IMS Stock In screen created usable stock with no GRN, no signature and no
 * QC, and a second movement for one physical receipt when the GRN was completed
 * as well.
 *
 * Both IMS modules (Consumables & Packaging and Raw Material) validate the
 * reason through the one `checkStockInReason`, so this covers both. The other
 * reasons — opening stock, corrections, and OTHER with the operator's own words
 * — are deliberately untouched: they describe material that never came from a
 * supplier delivery. No database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkStockInReason, normalizeStockInReason,
  STOCK_IN_REASONS, RETIRED_STOCK_IN_REASONS, receiveSchema,
} from '../ims.validation.js';
import { rmReceiveSchema } from '../rmIms.validation.js';

const SKU_LINE = { skuId: '6ac09965f1c61c40fa20aa01', quantity: 5 };

test('a vendor receipt is refused, and the message says where it belongs', () => {
  const out = checkStockInReason('VENDOR_RECEIPT', '');
  assert.equal(out.ok, false);
  assert.match(out.message, /not a Stock In reason any more/);
  assert.match(out.message, /GRN/, 'names the route it must take');
  assert.match(out.message, /Incoming QC/, 'and who accepts it');
});

test('the older VENDOR code cannot slip past it', () => {
  // An older client build posts VENDOR; it maps forward to the same code, so
  // it meets the same refusal rather than posting stock.
  assert.equal(normalizeStockInReason('VENDOR'), 'VENDOR_RECEIPT');
  assert.equal(checkStockInReason('VENDOR', '').ok, false);
  assert.equal(checkStockInReason('vendor', '').ok, false, 'case does not matter');
});

test('an unrecognised reason is refused too, instead of silently becoming a vendor receipt', () => {
  // normalizeStockInReason falls back to VENDOR_RECEIPT, which is now a refusal
  // — the fail-safe direction. An omitted reason behaves the same way.
  assert.equal(checkStockInReason('WHATEVER', '').ok, false);
  assert.equal(checkStockInReason(undefined, '').ok, false);
  assert.equal(checkStockInReason('', '').ok, false);
});

test('opening stock, corrections and OTHER still work exactly as before', () => {
  const opening = checkStockInReason('OPENING_STOCK', '');
  assert.deepEqual(opening, { ok: true, reason: 'OPENING_STOCK', customReason: '' });

  const correction = checkStockInReason('CORRECTION_ADJUSTMENT', 'ignored text');
  assert.deepEqual(correction, { ok: true, reason: 'CORRECTION_ADJUSTMENT', customReason: '' },
    'a custom reason is still dropped unless the reason is OTHER');

  const other = checkStockInReason('OTHER', 'Returned unused from the line');
  assert.deepEqual(other, { ok: true, reason: 'OTHER', customReason: 'Returned unused from the line' });

  // Their own rules are unchanged.
  assert.match(checkStockInReason('OTHER', '').message, /Custom Reason is required/);
  assert.match(checkStockInReason('OTHER', 'x'.repeat(201)).message, /200 characters or fewer/);

  // The legacy spellings of the reasons that remain are still mapped forward.
  assert.equal(checkStockInReason('OPENING', '').reason, 'OPENING_STOCK');
  assert.equal(checkStockInReason('CORRECTION', '').reason, 'CORRECTION_ADJUSTMENT');
});

test('History keeps its label: the reason is retired for NEW entries only', () => {
  // Movements already posted under it must still render "Vendor receipt",
  // so the code stays in the label map and only the guard list refuses it.
  assert.equal(STOCK_IN_REASONS.VENDOR_RECEIPT, 'Vendor receipt');
  assert.ok(RETIRED_STOCK_IN_REASONS.VENDOR_RECEIPT);
  assert.equal(RETIRED_STOCK_IN_REASONS.OPENING_STOCK, undefined);
  assert.equal(RETIRED_STOCK_IN_REASONS.CORRECTION_ADJUSTMENT, undefined);
  assert.equal(RETIRED_STOCK_IN_REASONS.OTHER, undefined);
});

test('both Stock In routes still accept the code at the schema, so the explanation is what the user sees', () => {
  // Deliberate: the schemas are not narrowed. A request carrying the retired
  // code reaches the service and gets the message above, rather than a flat
  // "reason must be one of…" from Joi.
  for (const [name, schema, line] of [
    ['C&P', receiveSchema, SKU_LINE],
    ['RM', rmReceiveSchema, { ...SKU_LINE, batchNo: 'B-1' }],
  ]) {
    const { error, value } = schema.validate({ warehouse: 'MAIN', reason: 'VENDOR_RECEIPT', items: [line] });
    assert.equal(error, undefined, `${name} schema still parses it`);
    assert.equal(checkStockInReason(value.reason, value.customReason).ok, false, `${name} service refuses it`);
  }
});

test('an omitted reason still defaults to the retired code, so it is refused rather than guessed', () => {
  const { value } = receiveSchema.validate({ warehouse: 'MAIN', items: [SKU_LINE] });
  assert.equal(value.reason, 'VENDOR_RECEIPT');
  assert.equal(checkStockInReason(value.reason, value.customReason).ok, false);
});
