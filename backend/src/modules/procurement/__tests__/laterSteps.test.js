/**
 * Deleting a Purchase FMS record at any status — the shared rule.
 *
 * DB-less: the refusal message naming the later records, the reason a
 * completed record needs, and that every step's service still loads with the
 * shared helper (no import cycle).
 *
 * NOT covered here (needs a live DB, which this runner never sets up): the
 * later-step lookups themselves and what each delete undoes on earlier records.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { laterStepsMessage, assertNothingAfter, deleteReason, laterStepsOf } from '../laterSteps.js';

test('one later record: named, "rests", "delete that first"', () => {
  assert.equal(
    laterStepsMessage('PI PI-004/26-27', [{ label: 'Advance payment', number: 'ADV-002/26-27' }]),
    'PI PI-004/26-27 cannot be deleted: Advance payment ADV-002/26-27 rests on it. Delete that first (the latest step first), then delete this.',
  );
});

test('several later records: all named, "rest", "delete those first"', () => {
  const msg = laterStepsMessage('Purchase Order AGL/PO-030/26-27', [
    { label: 'Follow-up', number: 'FU-010' }, { label: 'GRN', number: 'AGL/GRN-026/26-27' },
  ]);
  assert.match(msg, /Follow-up FU-010, GRN AGL\/GRN-026\/26-27 rest on it\. Delete those first/);
});

test('assertNothingAfter: nothing after → passes; something after → 409', () => {
  assert.doesNotThrow(() => assertNothingAfter('Voucher V-1', []));
  assert.throws(() => assertNothingAfter('Voucher V-1', [{ label: 'Tally entry', number: 'TLY-1' }]),
    (err) => err.statusCode === 409 && /Tally entry TLY-1/.test(err.message));
});

test('deleteReason: required, trimmed, capped', () => {
  assert.throws(() => deleteReason('  ', 'Invoice 9'), (err) => err.statusCode === 400 && /reason for deleting Invoice 9/.test(err.message));
  assert.equal(deleteReason('  Entered twice  ', 'x'), 'Entered twice');
  assert.equal(deleteReason('a'.repeat(900), 'x').length, 500);
});

test('every step has a later-steps lookup', () => {
  assert.deepEqual(Object.keys(laterStepsOf).sort(), ['followUp', 'indent', 'invoice', 'pi', 'po', 'tally', 'voucher']);
});

test('every step service loads with the shared helper (no import cycle)', async () => {
  const mods = await Promise.all([
    import('../indent/indent.service.js'), import('../purchase-order/purchaseOrder.service.js'),
    import('../follow-up/followUp.service.js'), import('../proforma-invoice/proformaInvoice.service.js'),
    import('../vendor-invoice/vendorInvoice.service.js'), import('../voucher/voucher.service.js'),
    import('../tally-entry/tallyEntry.service.js'), import('../grn/grn.service.js'),
  ]);
  const services = [mods[0].indentService, mods[1].purchaseOrderService, mods[2].followUpService, mods[3].proformaInvoiceService,
    mods[4].vendorInvoiceService, mods[5].voucherService, mods[6].tallyEntryService, mods[7].grnService];
  for (const svc of services) assert.equal(typeof svc?.remove, 'function');
  assert.equal(typeof mods[1].purchaseOrderService._releaseIndentLinks, 'function');
});
