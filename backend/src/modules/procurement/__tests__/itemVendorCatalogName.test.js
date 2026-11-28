import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSku, sameCatalogProduct, matchHistory } from '../indent/itemVendorHistory.js';

const ITEM = { _id: 'i1', skuId: 's1', skuCode: 'PK-PC-01-00', itemName: 'Paper Cone 1.00"' };
const V = (id, name, products) => ({ _id: id, name, code: id.toUpperCase(), location: 'Thane', products });
const ACTIVE = (...vs) => vs.map((v) => ({ _id: v._id, name: v.name, code: v.code, location: v.location }));

test('a catalog product is the item when linked to the same SKU (id, else code) — as before', () => {
  assert.equal(sameCatalogProduct({ skuId: 's1', productName: 'x' }, ITEM), true);
  assert.equal(sameCatalogProduct({ skuCode: ' pk-pc-01-00 ', productName: 'x' }, ITEM), true);
  assert.equal(sameCatalogProduct({ skuId: 's2', skuCode: 'OTHER', productName: 'x' }, ITEM), false);
  assert.equal(sameSku({ productName: 'Paper Cone 1.00"' }, ITEM), false); // the SKU match itself is unchanged
});

test('a product typed in as a NAME only (no SKU id, no code) is the item when the names are equal', () => {
  assert.equal(sameCatalogProduct({ productName: 'Paper Cone 1.00"' }, ITEM), true);
  assert.equal(sameCatalogProduct({ productName: '  paper   CONE 1.00"  ' }, ITEM), true);
  assert.equal(sameCatalogProduct({ productName: 'Paper Cone 1.00" Large' }, ITEM), false);
  assert.equal(sameCatalogProduct({ productName: 'Paper Cone' }, ITEM), false);
  assert.equal(sameCatalogProduct({ productName: '' }, ITEM), false);
  assert.equal(sameCatalogProduct({}, { ...ITEM, itemName: '' }), false);
});

test('a product linked to a SKU is decided by that SKU alone, never by its name', () => {
  assert.equal(sameCatalogProduct({ skuId: 's2', productName: 'Paper Cone 1.00"' }, ITEM), false);
  assert.equal(sameCatalogProduct({ skuCode: 'OTHER-CODE', productName: 'Paper Cone 1.00"' }, ITEM), false);
});

test('matchHistory lists a vendor whose item list has the product typed by name, flagged as on the item list', () => {
  const linked = V('va', 'Linked Vendor', [{ skuId: 's1', skuCode: 'PK-PC-01-00', productName: 'Paper Cone 1.00"' }]);
  const typed = V('vb', 'Typed Vendor', [{ productName: 'paper cone 1.00"' }]);
  const other = V('vc', 'Other Vendor', [{ productName: 'Something else' }]);
  const linkedElsewhere = V('vd', 'Linked Elsewhere', [{ skuId: 's9', skuCode: 'X', productName: 'Paper Cone 1.00"' }]);
  const out = matchHistory([ITEM], [], [linked, typed, other, linkedElsewhere], ACTIVE(linked, typed, other, linkedElsewhere)).get('i1');
  assert.deepEqual(out.map((v) => v.vendorName), ['Linked Vendor', 'Typed Vendor']);
  assert.ok(out.every((v) => v.inCatalog && v.basis.includes('VENDOR') && v.poCount === 0));
});

test('an inactive / unknown vendor is never listed, name match or not', () => {
  const typed = V('vb', 'Typed Vendor', [{ productName: 'Paper Cone 1.00"' }]);
  assert.deepEqual(matchHistory([ITEM], [], [typed], []).get('i1'), []);
});
