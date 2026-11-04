/**
 * PO Terms & Conditions — which text a PO prints (poTerms.js) and how the PDF
 * lays it out (long terms, line breaks, no overlap with the signatory or the
 * JSL footer). Pure rendering, no database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';

import { buildOtherPoPdfBuffer, buildJslPoPdfBuffer } from '../purchaseOrder.service.js';
import {
  BUILT_IN_PO_TERMS, PO_TERMS_MAX, normalizePoTerms, resolvePoTerms, defaultPoTerms, pdfSafePoTerms,
} from '../poTerms.js';
import { updatePoTermsSchema, createPoSchema } from '../purchaseOrder.validation.js';
import { settingsPatchSchema } from '../../../pricing/pricing.validation.js';

const PAGE_H = 841.89;
const LIMIT = { OTHER: PAGE_H - 40 - 2, JSL: PAGE_H - 66 };
const BUILDERS = { OTHER: buildOtherPoPdfBuffer, JSL: buildJslPoPdfBuffer };

const items = (n, fmt) => Array.from({ length: n }, (_, i) => (fmt === 'JSL'
  ? { grade: 'J4', width: '1250', finish: '2B', quantity: 100 + i, unit: 'Kgs', baseRate: 180, upfrontDiscount: 2, bonanzaDiscount: 1, finalPrice: 177, value: 17700 }
  : { itemName: `Item ${i + 1}`, quantity: 10, unit: 'Kgs', rate: 100, taxableAmount: 1000, gstRate: 18, taxAmount: 180, totalAmount: 1180 }));
const po = (fmt, n, extra = {}) => ({
  poNumber: 'AGL/PO-T/26-27', poFormatType: fmt, poDate: new Date('2026-10-20'), vendorName: 'Vendor', items: items(n, fmt), ...extra,
});

// Every text() call: string, position, page and the height it takes.
const drawCalls = async (fn) => {
  const calls = [];
  const origText = PDFDocument.prototype.text;
  const origAdd = PDFDocument.prototype.addPage;
  PDFDocument.prototype.addPage = function (...a) {
    this._spyPage = (this._spyPage ?? 0) + 1;
    return origAdd.apply(this, a);
  };
  PDFDocument.prototype.text = function (str, x, y, opts) {
    if (!this._inSpy && typeof x === 'number') {
      const h = this.heightOfString(String(str), opts || {});
      calls.push({ str: String(str), x, y, h, page: this._spyPage ?? 0, width: opts?.width });
    }
    this._inSpy = true;
    try { return origText.call(this, str, x, y, opts); } finally { this._inSpy = false; }
  };
  try { await fn(); } finally { PDFDocument.prototype.text = origText; PDFDocument.prototype.addPage = origAdd; }
  return calls;
};
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;

// ── Which terms a PO prints ──
test('a PO prints its own terms first', () => {
  assert.equal(resolvePoTerms({ poFormatType: 'JSL', termsAndConditions: 'Own terms', remarks: 'R' }), 'Own terms');
});

test('a PO saved before the field existed keeps printing its Remarks', () => {
  assert.equal(resolvePoTerms({ poFormatType: 'JSL', remarks: 'Legacy remark terms' }), 'Legacy remark terms');
  assert.equal(resolvePoTerms({ poFormatType: 'JSL', termsAndConditions: null, remarks: 'X' }), 'X');
});

test('a blank own-terms field means the default, never the Remarks', () => {
  const d = { JSL: 'JSL default', OTHER: 'Other default' };
  assert.equal(resolvePoTerms({ poFormatType: 'JSL', termsAndConditions: '', remarks: 'internal note' }, d), 'JSL default');
  assert.equal(resolvePoTerms({ poFormatType: 'OTHER', termsAndConditions: '   ' }, d), 'Other default');
});

test('defaults come from settings, falling back to the built-in text per format', () => {
  assert.equal(defaultPoTerms('JSL', { JSL: 'Valid till 31st Dec 2026' }), 'Valid till 31st Dec 2026');
  assert.equal(defaultPoTerms('JSL', { JSL: '  ' }), BUILT_IN_PO_TERMS.JSL);
  assert.equal(defaultPoTerms('OTHER'), BUILT_IN_PO_TERMS.OTHER);
  assert.equal(defaultPoTerms(undefined, {}), BUILT_IN_PO_TERMS.OTHER);
  assert.equal(resolvePoTerms({ poFormatType: 'JSL' }), BUILT_IN_PO_TERMS.JSL);
});

test('normalizing keeps line breaks and blank lines, tidies CRLF, tabs and trailing blanks', () => {
  assert.equal(normalizePoTerms('\n\n1. A  \r\n\r\n\t2. B\r\n  '), '1. A\n\n    2. B');
  assert.equal(normalizePoTerms(null), '');
  assert.equal(pdfSafePoTerms('Rate ₹ 100 and ₹200'), 'Rate Rs. 100 and Rs. 200');
});

// ── Validation ──
test('PO terms: blank allowed (= default), over the limit refused, CRLF normalized', () => {
  assert.equal(updatePoTermsSchema.validate({ termsAndConditions: '' }).error, undefined);
  assert.equal(updatePoTermsSchema.validate({ termsAndConditions: 'a\r\nb' }).value.termsAndConditions, 'a\nb');
  assert.ok(updatePoTermsSchema.validate({ termsAndConditions: 'x'.repeat(PO_TERMS_MAX + 1) }).error);
  assert.ok(updatePoTermsSchema.validate({}).error, 'the terms-only route needs the field');
  assert.ok(updatePoTermsSchema.validate({ termsAndConditions: 'x', items: [] }, { stripUnknown: true }).value.items === undefined,
    'nothing but the terms gets through');
});

test('PO create keeps the terms field (the validator strips unknown keys)', () => {
  const { value } = createPoSchema.validate({
    indentId: 'a'.repeat(24), vendorId: 'b'.repeat(24), expectedDeliveryDate: '2026-11-30',
    items: [{ itemName: 'X', quantity: 1, rate: 1 }], termsAndConditions: 'Line 1\nLine 2',
  }, { stripUnknown: true });
  assert.equal(value.termsAndConditions, 'Line 1\nLine 2');
});

test('settings: a default can be reworded but not blanked', () => {
  assert.equal(settingsPatchSchema.validate({ poTermsJsl: 'New JSL terms' }).error, undefined);
  assert.ok(settingsPatchSchema.validate({ poTermsJsl: '   ' }).error);
  assert.ok(settingsPatchSchema.validate({ poTermsOther: 'x'.repeat(PO_TERMS_MAX + 1) }).error);
});

// ── PDF ──
for (const [fmt, build] of Object.entries(BUILDERS)) {
  test(`${fmt}: prints the PO's own terms, with the edited date, line breaks intact`, async () => {
    const terms = 'This order is under Price Protection Policy till 31st December 2026.\n\n2. Second line';
    const calls = await drawCalls(() => build(po(fmt, 2, { termsAndConditions: terms }), { name: 'Co' }));
    assert.ok(calls.some((c) => c.str === terms), 'terms drawn as one block with its blank line');
    assert.ok(!calls.some((c) => /30th June 2026/.test(c.str)));
  });

  test(`${fmt}: a PO without own terms prints the Company Settings default`, async () => {
    const calls = await drawCalls(() => build(po(fmt, 2), { name: 'Co', poTerms: { JSL: 'JSL D', OTHER: 'OTHER D' } }));
    assert.ok(calls.some((c) => c.str === `${fmt} D`));
  });

  test(`${fmt}: short terms stay one page beside the signatory`, async () => {
    const buf = await build(po(fmt, 2, { termsAndConditions: 'Short.' }), { name: 'Co' });
    assert.equal(pageCount(buf), 1);
  });

  for (const [label, terms] of [
    ['many paragraphs', Array.from({ length: 60 }, (_, i) => `${i + 1}. Clause ${i + 1} — delivery by 31st December 2026, subject to the price protection policy and Mumbai jurisdiction.`).join('\n')],
    ['one long paragraph', `${'Long clause without line breaks valid till 31st December 2026. '.repeat(62)}`.slice(0, PO_TERMS_MAX)],
    ['blank lines', Array.from({ length: 300 }, (_, i) => (i % 3 ? '' : `Clause ${i}`)).join('\n')],
  ]) {
    for (const n of [2, 14, 40]) {
      test(`${fmt}: long terms (${label}, ${n} items) flow over pages without overlap`, async () => {
        const calls = await drawCalls(() => build(po(fmt, n, { termsAndConditions: terms }), { name: 'Acme Ltd' }));
        const tIdx = calls.findIndex((c) => c.str === 'TERMS & CONDITIONS');
        assert.ok(tIdx >= 0);
        const after = calls.slice(tIdx);
        const termLines = after.filter((c) => c.x === 40 && !/^TERMS & CONDITIONS/.test(c.str) && c.width === 515.28 - 200);
        // Every word of the terms is printed, in order — as one block when it fits
        // a page, else paragraph by paragraph (a blank line drawn as a space).
        const printed = normalizePoTerms(terms);
        assert.equal(termLines.map((c) => c.str).join('\n'),
          termLines.length === 1 ? printed : printed.split('\n').map((p) => p || ' ').join('\n'));
        // Nothing runs past the page's limit (the JSL limit keeps clear of its footer).
        for (const c of after.filter((x) => !/JURISDICTION|computer generated/.test(x.str))) {
          assert.ok(c.y + c.h <= LIMIT[fmt] + 0.01, `"${c.str.slice(0, 30)}" ends at ${c.y + c.h} > ${LIMIT[fmt]}`);
        }
        // The signatory is on the page where the terms end, in its own column.
        const sig = after.find((c) => c.str === 'Authorized Signatory');
        const lastTerm = termLines[termLines.length - 1];
        assert.equal(sig.page, lastTerm.page);
        assert.ok(sig.x >= 40 + (515.28 - 200), 'signatory column is right of the terms column');
        // Continuation pages are labelled.
        if (new Set(termLines.map((c) => c.page)).size > 1) {
          assert.ok(after.some((c) => c.str === 'TERMS & CONDITIONS (continued)'));
        }
        if (fmt === 'JSL') {
          const jur = calls.find((c) => c.str === 'SUBJECT TO MUMBAI JURISDICTION');
          assert.equal(jur.page, sig.page, 'jurisdiction note on the last page');
        }
      });
    }
  }

  test(`${fmt}: the longest terms never leave an empty trailing page`, async () => {
    const terms = Array.from({ length: 80 }, (_, i) => `${i + 1}. Clause ${'x'.repeat(30)}`).join('\n').slice(0, PO_TERMS_MAX);
    const buf = await build(po(fmt, 2, { termsAndConditions: terms }), { name: 'Co' });
    const calls = await drawCalls(() => build(po(fmt, 2, { termsAndConditions: terms }), { name: 'Co' }));
    // Pages are numbered from 1 (the constructor adds the first one).
    const lastPage = Math.max(...calls.map((c) => c.page));
    assert.ok(lastPage > 1, 'these terms do need a second page');
    assert.equal(pageCount(buf), lastPage, 'every page has something on it');
  });
}
