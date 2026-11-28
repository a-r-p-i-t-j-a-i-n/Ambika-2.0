// Run: node --test src/features/procurement/purchase-orders/__tests__/itemVendor.test.mjs  (from frontend/)
// The pure rules behind the PO form's "Select Previous Vendor" / "Add New Vendor" (itemVendor.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLockedRow, isPreselectedRow, fixedVendorOf, assignedVendorsOf, activeVendors,
  previousVendorOptions, newVendorOptions, previousVendorCaption,
} from '../itemVendor.js';

const V = (id, name, extra = {}) => ({ _id: id, name, ...extra });
const MASTER = [V('a', 'Alpha'), V('b', 'Beta'), V('c', 'Gamma', { isActive: false }), V('d', 'Delta', { isActive: true })];
const row = (o = {}) => ({ indentItemId: 'i1', vendorState: 'MISSING', vendorId: null, ...o });
const prev = (vendorId, extra = {}) => ({ vendorId, vendorName: vendorId, poCount: 1, lastPoNumber: `PO-${vendorId}`, lastPoDate: '2026-10-01', lastRate: 95, ...extra });

test('locked = approved with the quotation; preselected = picked on a Quote Required = No item; neither for a row with no vendor', () => {
  const locked = row({ vendorState: 'SET', vendorId: 'a', vendorSource: 'APPROVED_QUOTATION' });
  const pre = row({ vendorState: 'SET', vendorId: 'a', vendorSource: 'PO_PREPARATION' });
  assert.equal(isLockedRow(locked), true);
  assert.equal(isPreselectedRow(locked), false);
  assert.equal(isLockedRow(pre), false);
  assert.equal(isPreselectedRow(pre), true);
  for (const none of [row(), row({ vendorState: 'UNASSIGNED' }), row({ vendorState: 'SET', vendorId: null, vendorSource: 'PO_PREPARATION' }), undefined, null]) {
    assert.equal(isLockedRow(none), false);
    assert.equal(isPreselectedRow(none), false);
  }
});

test('only a LOCKED vendor fixes the PO vendor (a preselection does not); two locked vendors conflict', () => {
  const locked = (id, name) => row({ indentItemId: id, vendorState: 'SET', vendorId: id, vendorName: name, vendorSource: 'APPROVED_QUOTATION' });
  const pre = row({ indentItemId: 'p', vendorState: 'SET', vendorId: 'z', vendorName: 'Zeta', vendorSource: 'PO_PREPARATION' });
  assert.equal(fixedVendorOf([pre]), null);
  assert.equal(fixedVendorOf([row()]), null);
  assert.deepEqual(fixedVendorOf([locked('a', 'Alpha'), pre]), { conflict: false, vendorId: 'a', vendorName: 'Alpha', vendorSource: 'APPROVED_QUOTATION' });
  assert.deepEqual(fixedVendorOf([locked('a', 'Alpha'), locked('b', 'Beta')]), { conflict: true, vendors: ['Alpha', 'Beta'] });
});

test('active vendors: inactive ones are never offered', () => {
  assert.deepEqual(activeVendors(MASTER).map((v) => v.name), ['Alpha', 'Beta', 'Delta']);
  assert.deepEqual(activeVendors([null, undefined, { name: 'no id' }]), []);
  assert.deepEqual(activeVendors(undefined), []);
});

test('Select Previous Vendor: the row\'s purchase-history vendors, active ones only, server order kept, purchase reference attached', () => {
  const r = row({ previousVendors: [prev('b'), prev('c'), prev('a', { poCount: 2 }), prev('gone')] });
  const opts = previousVendorOptions(r, MASTER);
  assert.deepEqual(opts.map((o) => o.name), ['Beta', 'Alpha']); // Gamma inactive, 'gone' not in the master
  assert.equal(opts[0]._previous.lastPoNumber, 'PO-b');
  assert.equal(opts[1]._previous.poCount, 2);
  // nothing in the history, or the master not loaded yet → nothing offered (and nothing selected)
  assert.deepEqual(previousVendorOptions(row(), MASTER), []);
  assert.deepEqual(previousVendorOptions(r, []), []);
});

test('Add New Vendor: every active Vendor Master vendor, whether or not it ever supplied the item', () => {
  const r = row({ previousVendors: [prev('b')] });
  const all = newVendorOptions(MASTER).map((o) => o.name);
  assert.deepEqual(all, ['Alpha', 'Beta', 'Delta']);
  // the item's own history does not narrow it: Alpha never supplied this item (history = Beta only) and is still offered,
  // and an item with NO history has no previous vendor yet offers every active vendor
  assert.deepEqual(previousVendorOptions(r, MASTER).map((o) => o.name), ['Beta']);
  assert.ok(all.includes('Alpha') && all.includes('Delta'));
  assert.equal(previousVendorOptions(row(), MASTER).length, 0);
});

test('purchase reference caption: last PO, date, rate and PO count — only what is known', () => {
  const fmt = (d) => `D(${d})`;
  assert.equal(previousVendorCaption(prev('b', { poCount: 3 }), fmt), 'Last PO PO-b · D(2026-10-01) · ₹95 · 3 POs');
  assert.equal(previousVendorCaption(prev('b'), fmt), 'Last PO PO-b · D(2026-10-01) · ₹95');
  assert.equal(previousVendorCaption({ lastPoNumber: 'PO-7' }, fmt), 'Last PO PO-7');
  assert.equal(previousVendorCaption({ lastRate: 0, poCount: 1 }, fmt), '');
  assert.equal(previousVendorCaption(undefined, fmt), '');
});

test('assignedVendorsOf still lists every vendor already fixed or preselected for ready rows', () => {
  const rows = [
    row({ indentItemId: '1', vendorState: 'SET', vendorId: 'a', vendorName: 'Alpha', vendorSource: 'APPROVED_QUOTATION' }),
    row({ indentItemId: '2', vendorState: 'SET', vendorId: 'a', vendorName: 'Alpha', vendorSource: 'PO_PREPARATION' }),
    row({ indentItemId: '3' }),
  ];
  const g = assignedVendorsOf(rows);
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 2);
});
