/**
 * Correct the negative finished-goods balances left by the six orphaned
 * DISPATCH_OUT movements of 2026-07-07 (ref AGL/DC-041/26-27).
 *
 * WHAT IS WRONG
 * -------------
 * Six finished goods sit below zero because each has exactly one movement — a
 * dispatch — and no receipt was ever posted against it:
 *
 *   PF0600-202 -50 · PF1000-202 -70 · PF1500-202 -70
 *   PP0400-202 -100 · PP1000-202 -200 · PP1500-202 -10      (total -500)
 *
 * All six carry refType DELIVERY_CHALLAN and ref AGL/DC-041/26-27, and no
 * performedBy. That challan no longer exists: the surviving series starts at
 * AGL/DC-067/26-27, and `purge_o2d_trial_data.js` empties `deliverychallans`
 * while deliberately KEEPING IMS data. So the purge removed the documents and
 * left their ledger rows behind. Nothing in the code base writes a DISPATCH_OUT
 * with refType DELIVERY_CHALLAN any more — the only writer today is FG IMS
 * Dispatch Out, which stamps refType FG_DISPATCH.
 *
 * TWO POSSIBLE CORRECTIONS
 * ------------------------
 *   --mode=reverse   (default, recommended)
 *       Post a compensating IN of the same quantity as a CORRECTION
 *       (ADJUST_IN), bringing each SKU back to 0. Use this if the dispatches
 *       are agreed to be trial-data residue: no goods were produced, none
 *       shipped, and the balance should never have moved.
 *
 *   --mode=opening
 *       Post the missing balance as OPENING stock dated before the dispatch, so
 *       the history reads "opened with N, dispatched N, closed at 0". Use this
 *       ONLY if the business confirms the goods genuinely existed and were
 *       genuinely shipped, and the opening balance was simply never entered.
 *       This ADDS 500 units of stock value to the books, so it must not be
 *       chosen by default.
 *
 * Either way the original dispatch rows are PRESERVED — nothing is deleted or
 * edited, and both corrections go through the normal FG Production In service,
 * so the stock cache and the ledger move together and stay reconciled.
 *
 * Evidence for --mode=reverse being the correct one (gathered 2026-09-24):
 *   • every PPC entry for these six SKUs reports fgStock 0 and
 *     producedQtyTillDate 0 — production never believed this stock existed;
 *   • the six quantities match no surviving challan or sales-order line;
 *   • these are the only six movements in the database with refType
 *     DELIVERY_CHALLAN;
 *   • the sales order they name, AGL/SO-056/26-27, was purged as well.
 *
 * USAGE
 *   node src/scripts/fix_negative_fg_stock.js                        # dry run
 *   node src/scripts/fix_negative_fg_stock.js --mode=opening         # dry run
 *   node src/scripts/fix_negative_fg_stock.js --confirm              # WRITE
 *   MONGO_URI=... node src/scripts/fix_negative_fg_stock.js --confirm
 *
 * Runs against whatever MONGO_URI points at. Check the database name it prints
 * before passing --confirm.
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import { fgImsService, FG_ITEM_TYPES } from '../modules/inventory/fgIms.service.js';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const mode = (args.find((a) => a.startsWith('--mode=')) || '--mode=reverse').split('=')[1];

// The six the audit found. Used as a guard, not as the input: the script reads
// the live balances and refuses to touch anything it was not told about.
const EXPECTED = {
  'PF0600-202': -50, 'PF1000-202': -70, 'PF1500-202': -70,
  'PP0400-202': -100, 'PP1000-202': -200, 'PP1500-202': -10,
};
// Dated the day before the orphaned dispatch, so an opening balance sorts ahead
// of it on the stock card instead of appearing to arrive after the goods left.
const OPENING_DATE = '2026-07-06';

const MODES = {
  reverse: {
    reason: 'CORRECTION',
    label: 'compensating correction (ADJUST_IN)',
    remark: 'Correction of orphaned dispatch AGL/DC-041/26-27 — challan purged with the O2D trial data; no stock was ever received in',
    date: null,                 // today
  },
  opening: {
    reason: 'OPENING',
    label: 'opening stock (OPENING)',
    remark: 'Opening balance not entered when IMS went live — backfilled against dispatch AGL/DC-041/26-27',
    date: OPENING_DATE,
  },
};

const run = async () => {
  if (!MODES[mode]) {
    console.error(`Unknown --mode=${mode}. Use --mode=reverse or --mode=opening.`);
    process.exit(1);
  }
  const cfg = MODES[mode];
  await mongoose.connect(env.MONGO_URI);
  console.log(`database : ${mongoose.connection.name}`);
  console.log(`mode     : ${mode} — ${cfg.label}`);
  console.log(confirm ? 'action   : WRITE (movements will be created)' : 'action   : DRY RUN (nothing will be written)');

  const fgSkus = await SKU.find({ itemType: { $in: FG_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id code name unit').lean();
  const byId = new Map(fgSkus.map((s) => [String(s._id), s]));
  const negatives = (await InventoryStock.find({
    skuId: { $in: fgSkus.map((s) => s._id) }, qtyOnHand: { $lt: 0 }, isDeleted: { $ne: true },
  }).lean()).sort((a, b) => a.skuCode.localeCompare(b.skuCode));

  if (!negatives.length) { console.log('\nNo finished good is below zero. Nothing to do.'); await mongoose.disconnect(); return; }

  console.log('\n| SKU | Current Stock | Dispatch Qty | Correction Qty | Expected Final |');
  console.log('|-----|---------------|--------------|----------------|----------------|');
  const plan = [];
  let unexpected = 0;
  for (const st of negatives) {
    const sku = byId.get(String(st.skuId));
    const moves = await InventoryMovement.find({ skuId: st.skuId, isDeleted: { $ne: true } }).lean();
    const out = moves.filter((m) => m.movementType === 'OUT').reduce((a, m) => a + m.quantity, 0);
    const qty = Math.abs(st.qtyOnHand);
    const known = EXPECTED[st.skuCode] === st.qtyOnHand;
    if (!known) unexpected += 1;
    plan.push({ skuId: st.skuId, code: st.skuCode, unit: sku?.unit, current: st.qtyOnHand, dispatched: out, qty, warehouse: st.warehouse, known });
    console.log(`| ${st.skuCode} | ${st.qtyOnHand} | ${out} | +${qty} | ${st.qtyOnHand + qty} |${known ? '' : '  <-- NOT in the audited set'}`);
  }
  const total = plan.reduce((a, p) => a + p.qty, 0);
  console.log(`\ntotal correction: +${total} units across ${plan.length} SKU(s); every balance ends at 0`);
  console.log(`movement to be created per SKU: reason ${cfg.reason}, dated ${cfg.date || 'today'}, refType FG_PRODUCTION`);
  console.log(`remarks: "${cfg.remark}"`);
  console.log('the six original DISPATCH_OUT rows are NOT modified, reversed or deleted.');

  if (unexpected) {
    console.log(`\nREFUSING: ${unexpected} negative balance(s) are not in the audited set. Re-audit before running this.`);
    await mongoose.disconnect();
    process.exit(2);
  }
  if (!confirm) {
    console.log('\nDry run. Re-run with --confirm to write, once the mode has been approved.');
    await mongoose.disconnect();
    return;
  }

  // One entry per SKU, through the ordinary Production In service so the stock
  // cache and the ledger move together inside a transaction.
  const user = { _id: undefined, name: 'Stock correction (approved)' };
  for (const p of plan) {
    const res = await fgImsService.produce({
      date: cfg.date || undefined,
      reason: cfg.reason,
      reference: 'AGL/DC-041/26-27',
      warehouse: p.warehouse,
      clientRequestId: `negfix-${mode}-${p.code}`,   // re-running cannot double-post
      items: [{ skuId: String(p.skuId), skuCode: p.code, quantity: p.qty, remarks: cfg.remark }],
    }, user);
    const after = await InventoryStock.findOne({ skuId: p.skuId, warehouse: p.warehouse }).lean();
    console.log(`  ${p.code}: ${p.current} -> ${after.qtyOnHand}  (${res.duplicate ? 'already applied, skipped' : res.results[0].movementNumber})`);
  }

  console.log('\nverifying…');
  let bad = 0;
  for (const p of plan) {
    const st = await InventoryStock.findOne({ skuId: p.skuId, warehouse: p.warehouse }).lean();
    const moves = await InventoryMovement.find({ skuId: p.skuId, isDeleted: { $ne: true } }).lean();
    const net = moves.reduce((a, m) => a + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
    const dispatchStillThere = moves.some((m) => m.refType === 'DELIVERY_CHALLAN');
    const ok = st.qtyOnHand === 0 && Math.abs(net - st.qtyOnHand) < 0.005 && dispatchStillThere;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${p.code}: stock ${st.qtyOnHand}, ledger ${net}, original dispatch preserved: ${dispatchStillThere}`);
  }
  console.log(bad ? `\n${bad} SKU(s) did not verify.` : '\nAll balances corrected and reconciled.');
  await mongoose.disconnect();
};

run().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
