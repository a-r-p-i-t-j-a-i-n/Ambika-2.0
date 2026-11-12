/**
 * The combined GRN + Incoming QC Save (grn/grnQcSave.service.js) — its pure
 * parts: how a QC line is matched to a GRN line, which QC a scope gets, and
 * what a draft vs a completion accepts.
 *
 * NOT covered here (needs a live DB): the orchestration itself — see the
 * scratch-DB oracle backend/src/scripts/e2eGrnQcSaveFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  qcLineKey, qcScopesOf, entryForScope, inspectionFor, toQcDraft,
} from '../grn/grnQcSave.service.js';

const line = (over = {}) => ({ _id: 'g1', poItemId: 'p1', itemName: 'Bolt', skuCode: 'B', receivedQty: 10, ...over });
const entry = (items) => ({ items });

test('a QC line is keyed by its PO line, else its GRN line, else SKU|batch|name', () => {
  assert.equal(qcLineKey({ poItemId: 'p1', grnItemId: 'g1' }), 'p1');
  assert.equal(qcLineKey({ grnItemId: 'g1' }), 'g1');
  assert.equal(qcLineKey({ skuCode: 'S', batchNo: 'B1', itemName: 'X' }), 'S|B1|X');
});

test('one QC per PO only on a multi-PO GRN', () => {
  assert.deepEqual(qcScopesOf({ poIds: ['a'] }), [{ poId: null, poNumber: '' }]);
  assert.deepEqual(qcScopesOf({ poIds: ['a', 'b'], poNumbers: ['PO-A', 'PO-B'] }).map((s) => s.poNumber), ['PO-A', 'PO-B']);
  const qcs = [{ poId: 'a', items: [] }, { poId: 'b', items: [] }];
  assert.equal(entryForScope(qcs, { poId: 'b' }, true), qcs[1]);
  assert.equal(entryForScope([{ items: [] }], { poId: null }, false).items.length, 0);
  assert.equal(entryForScope([], { poId: 'a' }, true), null);
});

test('completion: a balanced split is taken, received qty always from the GRN line', () => {
  const { items, errors } = inspectionFor([line()], entry([{ lineKey: 'p1', receivedQty: 10, acceptedQty: 7, rejectedQty: 3 }]), { strict: true });
  assert.deepEqual(errors, []);
  assert.equal(items[0].grnItemId, 'g1');
  assert.equal(items[0].receivedQty, 10);
  assert.equal(items[0].acceptedQty, 7);
  assert.equal(items[0].rejectedQty, 3);
});

test('completion refuses an unbalanced split, an uninspected line and a changed received qty', () => {
  assert.match(inspectionFor([line()], entry([{ lineKey: 'p1', receivedQty: 10, acceptedQty: 7, rejectedQty: 2 }]), { strict: true }).errors[0], /must equal received/);
  assert.match(inspectionFor([line()], entry([]), { strict: true }).errors[0], /has not been inspected/);
  assert.match(inspectionFor([line()], entry([{ lineKey: 'p1', receivedQty: 12, acceptedQty: 12, rejectedQty: 0 }]), { strict: true }).errors[0], /received is now 10/);
  assert.match(inspectionFor([], entry([]), { strict: true }).errors[0], /no received items/);
});

test('a draft accepts an incomplete QC: missing / stale lines start as all accepted', () => {
  const r = inspectionFor([line(), line({ _id: 'g2', poItemId: 'p2', itemName: 'Nut', receivedQty: 4 })],
    entry([{ lineKey: 'p1', receivedQty: 9, acceptedQty: 9, rejectedQty: 0 }]), { strict: false });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.items.map((i) => [i.acceptedQty, i.rejectedQty]), [[10, 0], [4, 0]]);
});

test('the QC kept on a draft GRN holds only what was typed', () => {
  assert.equal(toQcDraft([]), null);
  const d = toQcDraft([{ poId: 'a', checkedByName: 'Asha', items: [{ lineKey: 'p1', acceptedQty: 5, rejectedQty: 1, junk: 1 }] }]);
  assert.equal(d[0].checkedByName, 'Asha');
  assert.deepEqual(d[0].items[0], { lineKey: 'p1', acceptedQty: 5, rejectedQty: 1 });
  assert.equal(d[0].qcReportDocument, null);
});
