/**
 * Material Receipt Type per GRN line — moved off the GRN header so each SKU
 * row carries its own (items[].howItemReceived).
 *
 * Pure / DB-less tests: the Joi schemas keep the per-line value (validate.js
 * runs with stripUnknown, so an undeclared field would be dropped silently),
 * the model shape (legacy lines read null; the header stays as the legacy
 * fallback / summary and accepts null for mixed lines), the fill/summary
 * rules the service applies on every save, and the GRN PDF's per-line column.
 *
 * Saving, editing, completing and previewing through the API is covered
 * against a local scratch database by src/scripts/e2eGrnReceiptTypeFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { createGrnSchema, updateGrnSchema, previewGrnPdfSchema } from '../grn.validation.js';
import GoodsReceiptNote, { HOW_ITEM_RECEIVED } from '../grn.model.js';
import { withLineReceiptTypes, summarizeReceiptType, buildGrnPdfBuffer } from '../grn.service.js';

const PO_1 = '6ac09965f1c61c40fa206c41';
const STRIP = { stripUnknown: true };
const line = (extra = {}) => ({ itemName: 'Bolt M8', receivedQty: 5, ...extra });

// ── Validation ───────────────────────────────────────────────────────────────
test('createGrnSchema keeps each line\'s own howItemReceived (not stripped)', () => {
  const { error, value } = createGrnSchema.validate({
    poIds: [PO_1],
    items: [line({ howItemReceived: 'DAMAGED_RECEIVED' }), line({ itemName: 'Nut M8', howItemReceived: 'PARTIAL_RECEIVED' })],
  }, STRIP);
  assert.equal(error, undefined);
  assert.deepEqual(value.items.map((l) => l.howItemReceived), ['DAMAGED_RECEIVED', 'PARTIAL_RECEIVED']);
});

test('a line without howItemReceived is still accepted (older client) — the service fills it', () => {
  const { error, value } = createGrnSchema.validate({ poIds: [PO_1], items: [line()] }, STRIP);
  assert.equal(error, undefined);
  assert.equal(value.items[0].howItemReceived, undefined);
  assert.equal(value.howItemReceived, HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED, 'header default unchanged');
});

test('an unknown line receipt type is refused with a readable message', () => {
  const { error } = createGrnSchema.validate({ poIds: [PO_1], items: [line({ howItemReceived: 'LOST' })] }, STRIP);
  assert.ok(error);
  assert.match(error.message, /Material Receipt Type must be one of/);
});

test('update and preview schemas carry the per-line value too', () => {
  const upd = updateGrnSchema.validate({ items: [line({ howItemReceived: 'EXTRA_RECEIVED' })] }, STRIP);
  assert.equal(upd.error, undefined);
  assert.equal(upd.value.items[0].howItemReceived, 'EXTRA_RECEIVED');
  const prev = previewGrnPdfSchema.validate({ items: [line({ howItemReceived: 'PARTIAL_RECEIVED' })] }, STRIP);
  assert.equal(prev.error, undefined);
  assert.equal(prev.value.items[0].howItemReceived, 'PARTIAL_RECEIVED');
});

// ── Model ────────────────────────────────────────────────────────────────────
test('model: a line stores its own type; a legacy line reads null; header accepts null (mixed)', () => {
  const doc = new GoodsReceiptNote({
    grnNumber: 'T', poId: PO_1, howItemReceived: null,
    items: [{ itemName: 'a', receivedQty: 1, howItemReceived: 'DAMAGED_RECEIVED' }, { itemName: 'b', receivedQty: 1 }],
  });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.items[0].howItemReceived, 'DAMAGED_RECEIVED');
  assert.equal(doc.items[1].howItemReceived, null);
  assert.equal(doc.howItemReceived, null);
});

test('model: header still defaults to FULL MATERIAL RECEIVED; an unknown line type fails validation', () => {
  const legacy = new GoodsReceiptNote({ grnNumber: 'T', poId: PO_1, items: [{ itemName: 'a', receivedQty: 1 }] });
  assert.equal(legacy.howItemReceived, HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED);
  const bad = new GoodsReceiptNote({ grnNumber: 'T', poId: PO_1, items: [{ itemName: 'a', receivedQty: 1, howItemReceived: 'LOST' }] });
  assert.ok(bad.validateSync()?.errors?.['items.0.howItemReceived']);
});

// ── Fill + summary rules ─────────────────────────────────────────────────────
test('withLineReceiptTypes keeps every line\'s own choice — never copies one line\'s to another', () => {
  const a = { itemName: 'A', howItemReceived: 'DAMAGED_RECEIVED' };
  const b = { itemName: 'B', howItemReceived: 'PARTIAL_RECEIVED' };
  const out = withLineReceiptTypes([a, b], 'EXTRA_RECEIVED');
  assert.deepEqual(out.map((l) => l.howItemReceived), ['DAMAGED_RECEIVED', 'PARTIAL_RECEIVED']);
  assert.equal(out[0], a, 'a typed line is returned as is (routing keys lines by identity)');
});

test('withLineReceiptTypes fills only untyped lines: header fallback, else FULL MATERIAL RECEIVED', () => {
  const lines = [{ itemName: 'A' }, { itemName: 'B', howItemReceived: '' }, { itemName: 'C', howItemReceived: null }];
  assert.deepEqual(withLineReceiptTypes(lines, 'DAMAGED_RECEIVED').map((l) => l.howItemReceived),
    ['DAMAGED_RECEIVED', 'DAMAGED_RECEIVED', 'DAMAGED_RECEIVED'], 'legacy header value preserved on every line');
  assert.deepEqual(withLineReceiptTypes(lines, null).map((l) => l.howItemReceived),
    Array(3).fill(HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED));
  assert.equal(lines[0].howItemReceived, undefined, 'input not mutated');
});

test('summarizeReceiptType: the shared type, or null when lines differ', () => {
  assert.equal(summarizeReceiptType([{ howItemReceived: 'PARTIAL_RECEIVED' }, { howItemReceived: 'PARTIAL_RECEIVED' }]), 'PARTIAL_RECEIVED');
  assert.equal(summarizeReceiptType([{ howItemReceived: 'PARTIAL_RECEIVED' }, { howItemReceived: 'DAMAGED_RECEIVED' }]), null);
  assert.equal(summarizeReceiptType([]), null);
});

// ── PDF ──────────────────────────────────────────────────────────────────────
/** Text runs of a pdfkit PDF (inflates content streams, joins TJ hex pieces). */
const pdfText = (buf) => {
  const out = [];
  const raw = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const tj of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return out;
};

const pdfGrn = (items, header = null) => ({
  grnNumber: 'AGL/GRN-T/26-27', grnDate: new Date('2026-10-26'), poNumber: 'PO-1', vendorName: 'V',
  invoiceNumber: 'INV-1', howItemReceived: header, items,
});

test('PDF: each line shows its own receipt type; mixed lines summarise as "Per item"', async () => {
  const text = pdfText(await buildGrnPdfBuffer(pdfGrn([
    { itemName: 'Coil A', invoiceQty: 1, receivedQty: 1, unit: 'Kg', howItemReceived: 'DAMAGED_RECEIVED' },
    { itemName: 'Coil B', invoiceQty: 2, receivedQty: 2, unit: 'Kg', howItemReceived: 'PARTIAL_RECEIVED' },
  ])));
  assert.ok(text.includes('RECEIPT TYPE'));
  assert.ok(text.includes('DAMAGED RECEIVED'));
  assert.ok(text.includes('PARTIAL RECEIVED'));
  assert.ok(text.some((t) => /Material Receipt Type: Per item \(see table\)/.test(t)), text.join(' | '));
});

test('PDF: a legacy GRN (no line types) shows its header value per line and in the summary', async () => {
  const text = pdfText(await buildGrnPdfBuffer(pdfGrn([
    { itemName: 'Old A', invoiceQty: 1, receivedQty: 1 }, { itemName: 'Old B', invoiceQty: 1, receivedQty: 1 },
  ], 'EXTRA_RECEIVED')));
  assert.equal(text.filter((t) => t === 'EXTRA RECEIVED').length, 2);
  assert.ok(text.some((t) => /Material Receipt Type: EXTRA RECEIVED/.test(t)), text.join(' | '));
});
