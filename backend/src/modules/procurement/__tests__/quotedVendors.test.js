import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vendorsOnQuotationFiles, quotedVendorsOf, keptVendorsOf, approvedVendorProblem,
} from '../indent/itemVendor.js';

const X = '0000000000000000000000a1';
const Y = '0000000000000000000000b2';
const Z = '0000000000000000000000c3';
const f = (vendorId, vendorName, quotedRate = null, deliveryDays = null, n = '') => ({
  fileName: `q${n}.pdf`, fileUrl: `u/${vendorName}${n}`, vendorId, vendorName, quotedRate, deliveryDays,
});

test('distinct vendors on quotation files keep first-seen order, lowest rate and shortest delivery', () => {
  const v = vendorsOnQuotationFiles([
    f(X, 'Vendor X', 120, 10, 1), f(Y, 'Vendor Y', 100, null), f(X, 'Vendor X', 110, 7, 2),
    { fileName: 'old.pdf', fileUrl: 'u/old' }, // untagged file (before vendors were recorded)
  ]);
  assert.deepEqual(v, [
    { vendorId: X, vendorName: 'Vendor X', quotedRate: 110, deliveryDays: 7, files: 2 },
    { vendorId: Y, vendorName: 'Vendor Y', quotedRate: 100, deliveryDays: null, files: 1 },
  ]);
  assert.deepEqual(vendorsOnQuotationFiles(undefined), []);
});

test('quoted (Step 1.2) and kept (Step 1.3) vendors are read per item by itemId', () => {
  const item = { _id: 'i1' };
  const indent = {
    quoteComparativeStep: { itemQuotations: [
      { itemId: 'i2', quotationDocuments: [f(Z, 'Vendor Z')] },
      { itemId: 'i1', quotationDocuments: [f(X, 'Vendor X', 50), f(Y, 'Vendor Y', 45)] },
    ] },
    quotationApprovalStep: { itemApprovedQuotations: [{ itemId: 'i1', approvedQuotationDocuments: [f(Y, 'Vendor Y', 45)] }] },
  };
  assert.deepEqual(quotedVendorsOf(indent, item).map((v) => v.vendorName), ['Vendor X', 'Vendor Y']);
  assert.deepEqual(keptVendorsOf(indent, item).map((v) => v.vendorName), ['Vendor Y']);
  assert.deepEqual(quotedVendorsOf({}, item), []);
});

test('approved vendor must be one who quoted, and one whose quotation was kept', () => {
  const quoted = [{ vendorId: X, vendorName: 'Vendor X' }, { vendorId: Y, vendorName: 'Vendor Y' }];
  const kept = [{ vendorId: Y, vendorName: 'Vendor Y' }];
  const base = { quoted, kept, itemName: 'Bolt' };
  assert.equal(approvedVendorProblem({ ...base, vendorId: Y, vendorName: 'Vendor Y' }), '');
  assert.match(approvedVendorProblem({ ...base, vendorId: Z, vendorName: 'Vendor Z' }), /"Vendor Z" did not quote for "Bolt".*Vendor X, Vendor Y/);
  assert.match(approvedVendorProblem({ ...base, vendorId: X, vendorName: 'Vendor X' }), /quotation for "Bolt" was removed.*Vendor Y/);
  // No kept tags (e.g. legacy kept files) → quoting is enough.
  assert.equal(approvedVendorProblem({ quoted, kept: [], vendorId: X, itemName: 'Bolt' }), '');
});

test('quotations that name no vendor keep the Vendor Master choice (older records)', () => {
  assert.equal(approvedVendorProblem({ quoted: [], kept: [], vendorId: Z, vendorName: 'Any', itemName: 'Bolt' }), '');
});
