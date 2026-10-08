/**
 * Fixture + database oracle for Scrap Out: buyer master and quantity units.
 *
 *   node src/scripts/e2eScrapOutFixture.js --seed     fresh scratch DB: user, scrap item, 2 buyers, opening scrap
 *   node src/scripts/e2eScrapOutFixture.js --legacy   write the one pre-buyer-master sale (old row shape)
 *   node src/scripts/e2eScrapOutFixture.js --api      drive the HTTP API on :5098 through every rule
 *   node src/scripts/e2eScrapOutFixture.js --verify   reconcile the ledger, buyers and history
 *
 * Pairs with frontend/e2e/scrapOut.e2e.mjs, which drives the same screens in
 * Chromium. Follows the established scratch-DB fixtures (e2eGrnRmFixture.js,
 * e2eCutCoilsFixture.js): pinned to localhost, dropped on --seed, never reads
 * the configured MONGO_URI.
 *
 * THE HISTORICAL ROW. Backward compatibility is proven against a genuinely old
 * record: between --seed and starting the backend, the run writes one Scrap
 * Out using the UNCHANGED code in the main working tree (quantityKg +
 * free-text partyName, no buyer). --verify then checks that row still reads
 * correctly next to the new ones.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import ScrapBuyer from '../modules/inventory/scrapBuyer.model.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { scrapBuyerService } from '../modules/inventory/scrapBuyer.service.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_scrapout';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eScrapOutFixture.js');
const DB_NAME = 'ambika_e2e_scrapout';
const API = 'http://127.0.0.1:5098/api/v1';
export const E2E_USER = { email: 'scrapout-e2e@test.local', password: 'E2e@12345', name: 'Scrap Out E2E', role: 'MD' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

export const SEED_BUYERS = [
  { name: 'Shree Metal Traders', contactPerson: 'Ramesh Patel', phone: '9825012345', gstNo: '24AAACS1234M1Z5', address: 'GIDC Vatva', state: 'Gujarat' },
  { name: 'Om Scrap Dealers', contactPerson: 'Suresh Shah', phone: '9898012345', address: 'Naroda', state: 'Gujarat' },
];

/** Opening scrap, booked through the real Scrap In. PLG01 is 1,700 so that,
 *  after the 200 kg historical sale, it holds exactly the brief's 1,500 kg. */
const OPENING = [{ warehouse: 'PLG01', kg: 1700 }, { warehouse: 'JW001', kg: 1000 }];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error(`Unexpected database ${mongoose.connection.name} — aborting.`);
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const done = async () => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  await mongoose.disconnect();
  if (failed.length) process.exit(1);
};

/* ══ --seed ════════════════════════════════════════════════════════════════ */

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = await User.create({ ...E2E_USER, mobile: '9000000011', isActive: true, roles: ['MD'] });
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });
  // Unique indexes must exist before the duplicate tests rely on them.
  await ScrapBuyer.syncIndexes();
  for (const b of SEED_BUYERS) await scrapBuyerService.create(b, user);
  for (const o of OPENING) {
    await scrapImsService.scrapIn({ quantityKg: o.kg, warehouse: o.warehouse, reason: 'OPENING_STOCK' }, user);
  }
  console.log(JSON.stringify({
    ok: true, db: mongoose.connection.name, user: E2E_USER.email,
    buyers: (await ScrapBuyer.find().lean()).map((b) => `${b.code} ${b.name}`),
    stock: (await InventoryStock.find().lean()).map((s) => `${s.warehouse} ${s.qtyOnHand}`),
  }, null, 2));
  await mongoose.disconnect();
};

/* ══ --legacy: the historical row, without a second checkout ══════════════ */

/**
 * Writes the one pre-buyer-master Scrap Out exactly as the old code stored it
 * — a SALE with free-text partyName, no buyer snapshot, no entered unit, and
 * the old "Issued to" sentence — through the same stock engine, so the balance
 * and the ledger move together. Dated before every --api row, so it is the
 * OLDEST entry in the Scrap Out history. Run after --seed, before --api.
 */
const legacy = async () => {
  await connect();
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const sku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  const party = 'Old Buyer (legacy free text)';
  await inventoryService.decreaseStock({
    skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit,
    quantity: 200, warehouse: 'PLG01',
    txnType: TXN_TYPE.SCRAP_OUT, sourceModule: 'SCRAP_IMS', refType: 'SCRAP_OUT', refNumber: '',
    reason: 'SALE', customReason: '', partyName: party,
    remarks: `Sold · Issued to: ${party}`,
    performedBy: user, movementDate: new Date('2026-10-01T00:00:00.000Z'),
  });
  console.log(JSON.stringify({ ok: true, legacy: party, plg01: await balance('PLG01') }));
  await mongoose.disconnect();
};

/* ══ --api: every rule, through the real HTTP API ══════════════════════════ */

let TOKEN = '';
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json, data: json?.data, message: json?.message || '' };
};
// The real Scrap Out screen always sends a date-only `date` (today, by
// default) — never a bare "now" timestamp. Defaulting it here the same way
// means every row this script posts sorts exactly as a genuine same-day
// operator entry would (tied on the date, decided by createdAt), instead of
// carrying a precise clock time that would artificially outrank a UI-submitted
// "today" row for the rest of the calendar day. Callers that care about a
// specific day (the legacy/backdated rows) still pass their own `date`.
const TODAY = new Date().toISOString().slice(0, 10);
const out = (body) => call('POST', '/scrap-ims/scrap-out', { date: TODAY, ...body });
const balance = async (wh) => round2((await InventoryStock.findOne({ skuCode: SCRAP_SKU_CODE, warehouse: wh }).lean())?.qtyOnHand);
const movementOf = (res) => InventoryMovement.findById(res.data?.results?.[0]?.movementId).lean();

const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', { email: E2E_USER.email, password: E2E_USER.password });
  TOKEN = login.data?.token || '';
  if (!TOKEN) throw new Error(`Login on :5098 failed (${login.status}) — is the dev-copy backend running on the scratch DB?`);
  const shree = await ScrapBuyer.findOne({ name: 'Shree Metal Traders' }).lean();
  const om = await ScrapBuyer.findOne({ name: 'Om Scrap Dealers' }).lean();

  console.log('\n— buyer master —');
  const all = await call('GET', '/scrap-ims/buyers');
  eq('[1] the two seeded buyers are listed', (all.data || []).length, 2);
  eq('[2] search by name', (await call('GET', '/scrap-ims/buyers?search=shree')).data?.[0]?.name, 'Shree Metal Traders');
  eq('[2] search by GSTIN fragment', (await call('GET', '/scrap-ims/buyers?search=24AAACS')).data?.[0]?.name, 'Shree Metal Traders');
  eq('[2] search by phone', (await call('GET', '/scrap-ims/buyers?search=98980')).data?.[0]?.name, 'Om Scrap Dealers');
  eq('[2] search by contact person', (await call('GET', '/scrap-ims/buyers?search=ramesh')).data?.[0]?.name, 'Shree Metal Traders');
  eq('[2] search by code', (await call('GET', `/scrap-ims/buyers?search=${shree.code}`)).data?.[0]?.name, 'Shree Metal Traders');
  const weird = await call('GET', `/scrap-ims/buyers?search=${encodeURIComponent('C++ (Metals')}`);
  check('[2] regex characters in the search do not crash it', weird.status === 200 && Array.isArray(weird.data), `${weird.status}`);

  const added = await call('POST', '/scrap-ims/buyers', { name: 'Ganesh Recyclers', contactPerson: 'Mahesh', phone: '9712012345', gstNo: '24AABCG5678K1Z2', address: 'Odhav', state: 'Gujarat' });
  check('[3] a new buyer is created (201, created:true)', added.status === 201 && added.data?.created === true, `${added.status}`);
  check('[3] it gets a master code', /^SB-\d{4}$/.test(added.data?.buyer?.code || ''), added.data?.buyer?.code);
  const dupName = await call('POST', '/scrap-ims/buyers', { name: '  ganesh   RECYCLERS ' });
  check('[5] same name, different case/spacing → existing buyer returned, not created',
    dupName.status === 200 && dupName.data?.created === false && dupName.data?.matchedOn === 'name'
    && String(dupName.data?.buyer?._id) === String(added.data?.buyer?._id), `${dupName.status} ${dupName.message}`);
  const dupGst = await call('POST', '/scrap-ims/buyers', { name: 'Totally Different Name', gstNo: '24 aaacs1234m1z5' });
  check('[5] same GSTIN under another name → existing buyer returned',
    dupGst.data?.created === false && dupGst.data?.matchedOn === 'gstNo' && String(dupGst.data?.buyer?._id) === String(shree._id),
    `${dupGst.status} ${dupGst.message}`);
  const [r1, r2] = await Promise.all([
    call('POST', '/scrap-ims/buyers', { name: 'Race Condition Metals' }),
    call('POST', '/scrap-ims/buyers', { name: 'Race Condition Metals' }),
  ]);
  const raced = await ScrapBuyer.countDocuments({ nameKey: 'race condition metals', isDeleted: false });
  check('[5] two simultaneous "Save" clicks make ONE buyer', raced === 1 && [r1, r2].filter((r) => r.data?.created).length === 1,
    `rows=${raced}, statuses ${r1.status}/${r2.status}`);
  eq('[5] blank buyer name is refused', (await call('POST', '/scrap-ims/buyers', { name: '' })).status, 422);
  eq('[5] one-letter buyer name is refused', (await call('POST', '/scrap-ims/buyers', { name: 'A' })).status, 422);

  console.log('\n— buyer rule on Scrap Out —');
  const mvBefore = await InventoryMovement.countDocuments({ txnType: 'SCRAP_OUT' });
  const noBuyer = await out({ quantity: 5, uom: 'QUINTAL', reason: 'SALE', warehouse: 'PLG01' });
  check('[6] Sold without a buyer is refused (422)', noBuyer.status === 422 && /buyer/i.test(noBuyer.message), `${noBuyer.status} ${noBuyer.message}`);
  const defaultReason = await out({ quantity: 5, uom: 'KG', warehouse: 'PLG01' });
  check('[6] no reason sent → defaults to Sold → buyer still required', defaultReason.status === 422, `${defaultReason.status}`);
  const ghost = await out({ quantity: 5, uom: 'KG', reason: 'SALE', warehouse: 'PLG01', buyerId: new mongoose.Types.ObjectId().toString() });
  check('[6] a buyer id that is not in the master is refused', ghost.status === 400 && /no longer/i.test(ghost.message), `${ghost.status} ${ghost.message}`);
  eq('[6] none of the refusals moved stock', await InventoryMovement.countDocuments({ txnType: 'SCRAP_OUT' }), mvBefore);

  console.log('\n— quantity units against 1,500 kg at PLG01 —');
  eq('    PLG01 holds 1,500 kg before the unit tests', await balance('PLG01'), 1500);
  const twoTon = await out({ quantity: 2, uom: 'TON', reason: 'SALE', warehouse: 'PLG01', buyerId: String(shree._id) });
  check('[14] 2 Ton (= 2,000 kg) against 1,500 kg is refused', twoTon.status === 400 && /Not enough scrap/.test(twoTon.message), `${twoTon.status} ${twoTon.message}`);
  eq('[14] …and stock is untouched', await balance('PLG01'), 1500);

  const tenQ = await out({ quantity: 10, uom: 'QUINTAL', reason: 'SALE', warehouse: 'PLG01', buyerId: String(shree._id), partyName: 'Spoofed Name', reference: 'INV-SCR-001' });
  check('[13] 10 Quintal (= 1,000 kg) against 1,500 kg is allowed', tenQ.status === 201, `${tenQ.status} ${tenQ.message}`);
  eq('[13] the ledger moved 1,000 kg', tenQ.data?.results?.[0]?.quantityKg, 1000);
  eq('[13] balance now 500 kg', await balance('PLG01'), 500);
  const m1 = await movementOf(tenQ);
  eq('[13] stored quantity is KG', m1?.quantity, 1000);
  eq('[13] what was typed is kept: 10', m1?.enteredQty, 10);
  eq('[13] …in QUINTAL', m1?.enteredUom, 'QUINTAL');
  eq('[ 9] buyer snapshot stored on the movement', String(m1?.buyer?.buyerId), String(shree._id));
  eq('[ 9] buyer GSTIN stored', m1?.buyer?.gstNo, '24AAACS1234M1Z5');
  eq('[ 9] partyName is the MASTER name, not the client\'s text', m1?.partyName, 'Shree Metal Traders');
  check('[ 9] remarks read "Sold to", not "Issued to"', /Sold to: Shree Metal Traders/.test(m1?.remarks || ''), m1?.remarks);
  eq('[ 9] reference kept for the sale document', m1?.refNumber, 'INV-SCR-001');

  const fiveQ = await out({ quantity: 5, uom: 'QUINTAL', reason: 'SALE', warehouse: 'PLG01', buyerId: String(om._id) });
  eq('[11] 5 Quintal = 500 kg', fiveQ.data?.results?.[0]?.quantityKg, 500);
  eq('[11] PLG01 now exactly 0', await balance('PLG01'), 0);

  eq('    JW001 holds 1,000 kg', await balance('JW001'), 1000);
  const fiveHundredKg = await out({ quantity: 500, uom: 'KG', reason: 'SALE', warehouse: 'JW001', buyerId: String(om._id) });
  eq('[10] 500 KG = 500 kg', fiveHundredKg.data?.results?.[0]?.quantityKg, 500);
  const decTon = await out({ quantity: 0.1255, uom: 'TON', reason: 'SALE', warehouse: 'JW001', buyerId: String(om._id) });
  eq('[15] 0.1255 Ton = 125.5 kg', decTon.data?.results?.[0]?.quantityKg, 125.5);
  eq('[15] the typed figure is stored exactly — 0.1255, not rounded', (await movementOf(decTon))?.enteredQty, 0.1255);
  const decQ = await out({ quantity: 2.5, uom: 'QUINTAL', reason: 'SALE', warehouse: 'JW001', buyerId: String(om._id) });
  eq('[15] 2.5 Quintal = 250 kg', decQ.data?.results?.[0]?.quantityKg, 250);
  eq('[15] JW001 = 1000 − 500 − 125.5 − 250 = 124.5', await balance('JW001'), 124.5);

  console.log('\n— refusals on the quantity —');
  const n0 = await InventoryMovement.countDocuments({});
  eq('[16] zero is refused', (await out({ quantity: 0, uom: 'KG', reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  eq('[17] negative is refused', (await out({ quantity: -5, uom: 'TON', reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  eq('    no unit is refused', (await out({ quantity: 5, reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  eq('    an unknown unit is refused', (await out({ quantity: 5, uom: 'POUND', reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  const tooFine = await out({ quantity: 1.005, uom: 'KG', reason: 'DISPOSAL', warehouse: 'JW001' });
  check('    3 decimals in KG is refused, naming the limit', tooFine.status === 422 && /2 decimal/.test(tooFine.message), tooFine.message);
  eq('    0.000004 Ton (rounds to nothing) is refused', (await out({ quantity: 0.000004, uom: 'TON', reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  eq('    quantity AND quantityKg together is refused', (await out({ quantity: 5, uom: 'KG', quantityKg: 5, reason: 'DISPOSAL', warehouse: 'JW001' })).status, 422);
  eq('    none of these moved stock', await InventoryMovement.countDocuments({}), n0);

  console.log('\n— allow negative —');
  const neg = await out({ quantity: 2, uom: 'TON', reason: 'DISPOSAL', warehouse: 'PLG01' });
  check('[18] 2 Ton from an empty PLG01 is refused without the override', neg.status === 400, `${neg.status}`);
  const negOk = await out({ quantity: 2, uom: 'TON', reason: 'DISPOSAL', warehouse: 'PLG01', allowNegative: true });
  eq('[18] …and recorded with it', negOk.status, 201);
  eq('[18] PLG01 goes to exactly −2,000 kg', await balance('PLG01'), -2000);

  console.log('\n— non-sale reasons keep the old behaviour —');
  const disp = await out({ quantity: 50, uom: 'KG', reason: 'DISPOSAL', warehouse: 'JW001', partyName: 'Municipal dump yard' });
  eq('[ 7] Disposed of, with no buyer, is accepted', disp.status, 201);
  const dm = await movementOf(disp);
  eq('[ 7] its free-text "Issued to" is kept', dm?.partyName, 'Municipal dump yard');
  eq('[ 7] …and it carries no buyer', dm?.buyer, undefined);
  check('[ 7] remarks still read "Issued to"', /Issued to: Municipal dump yard/.test(dm?.remarks || ''), dm?.remarks);
  eq('[ 7] Transferred out, with nobody named, is accepted', (await out({ quantity: 10, uom: 'KG', reason: 'TRANSFER', warehouse: 'JW001' })).status, 201);

  console.log('\n— the original request shape still works —');
  const legacy = await out({ quantityKg: 25, reason: 'CORRECTION_ADJUSTMENT', warehouse: 'JW001' });
  eq('[20] { quantityKg } alone is still accepted', legacy.status, 201);
  const lm = await movementOf(legacy);
  eq('[20] …moving 25 kg', lm?.quantity, 25);
  eq('[20] …and no entered unit is invented for it', lm?.enteredUom, undefined);
  eq('    JW001 = 124.5 − 50 − 10 − 25 = 39.5', await balance('JW001'), 39.5);
  // REGRESSION (review finding): the old shape keeps its old rounding — a stale
  // client posting 10.125 kg is recorded at 10.13 kg, exactly as before.
  const legacyFine = await out({ quantityKg: 10.125, reason: 'CORRECTION_ADJUSTMENT', warehouse: 'JW001' });
  eq('[20] old shape with 3 decimals still saves (was rounded before, still is)', legacyFine.status, 201);
  eq('[20] …recorded as 10.13 kg', (await movementOf(legacyFine))?.quantity, 10.13);
  eq('    JW001 = 39.5 − 10.13 = 29.37', await balance('JW001'), 29.37);

  console.log('\n— Scrap In is unchanged —');
  const sin = await call('POST', '/scrap-ims/scrap-in', { quantityKg: 2500, warehouse: 'PLG01', reason: 'CORRECTION_ADJUSTMENT', remarks: 'Recount' });
  eq('[19] Scrap In with quantityKg still works', sin.status, 201);
  eq('[19] PLG01 −2,000 + 2,500 = 500', await balance('PLG01'), 500);
  const sinUnits = await call('POST', '/scrap-ims/scrap-in', { quantity: 5, uom: 'TON', warehouse: 'PLG01', reason: 'OTHER', customReason: 'x' });
  eq('[19] Scrap In did NOT gain the unit fields (quantityKg still required)', sinUnits.status, 422);

  console.log('\n— a double-clicked sale —');
  const rid = `e2e-dup-${Date.now()}`;
  const d1 = await out({ quantity: 1, uom: 'QUINTAL', reason: 'SALE', warehouse: 'PLG01', buyerId: String(shree._id), clientRequestId: rid });
  const d2 = await out({ quantity: 1, uom: 'QUINTAL', reason: 'SALE', warehouse: 'PLG01', buyerId: String(shree._id), clientRequestId: rid });
  check('    the replay is recognised, not posted again', d1.status === 201 && d2.status === 200 && d2.data?.duplicate === true, `${d1.status}/${d2.status}`);
  eq('    one movement for that submission', await InventoryMovement.countDocuments({ clientRequestId: rid }), 1);
  eq('    PLG01 = 500 − 100 = 400', await balance('PLG01'), 400);

  console.log('\n— history: filter and search by buyer —');
  const byShree = await call('GET', `/scrap-ims/movements?buyerId=${shree._id}&limit=100`);
  check('[ 9] buyerId filter returns only that buyer\'s sales',
    byShree.data?.length === 2 && byShree.data.every((m) => String(m.buyer?.buyerId) === String(shree._id)), `${byShree.data?.length}`);
  const byGst = await call('GET', '/scrap-ims/movements?search=24AAACS&limit=100');
  check('[ 9] search by the buyer\'s GSTIN finds their sales', byGst.data?.length === 2, `${byGst.data?.length}`);
  const byPhone = await call('GET', '/scrap-ims/movements?search=98980&limit=100');
  check('[ 9] search by the buyer\'s phone finds their sales', byPhone.data?.length === 4, `${byPhone.data?.length}`);
  const hist = await call('GET', '/scrap-ims/movements?limit=100');
  const legacyRow = (hist.data || []).find((m) => m.partyName === 'Old Buyer (legacy free text)');
  check('[20] the historical row is still listed, with its old free-text party', !!legacyRow && !legacyRow.buyer, legacyRow ? 'buyer present?' : 'missing');

  console.log('\n— Scrap Out history (the table under the form) —');
  // One sale carrying operator remarks, from JW001 so PLG01 stays at the 400 kg
  // the UI test tops up from. JW001: 29.37 − 2.37 = 27.
  const withRemarks = await out({
    quantity: 2.37, uom: 'KG', reason: 'SALE', warehouse: 'JW001', buyerId: String(om._id),
    reference: 'INV-HIST-1', remarks: 'Loaded on GJ01 truck · paid cash',
  });
  eq('    a sale with remarks saves', withRemarks.status, 201);
  eq('    JW001 = 29.37 − 2.37 = 27', await balance('JW001'), 27);

  const H = (qs = '') => call('GET', `/scrap-ims/scrap-out/history${qs}`);
  const histAll = await H('?limit=100');
  const sku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  const dbOut = await InventoryMovement.find({ skuId: sku._id, txnType: 'SCRAP_OUT', isDeleted: { $ne: true } })
    .sort({ movementDate: -1, createdAt: -1 }).lean();
  const hRows = histAll.data || [];
  eq('[ 2] history lists every SCRAP_OUT movement — no more, no fewer', histAll.body?.meta?.total, dbOut.length);
  check('[11] …and they ARE the ledger rows (same ids), not copies',
    hRows.length === dbOut.length && hRows.every((r, i) => String(r._id) === String(dbOut[i]._id)), `${hRows.length}/${dbOut.length}`);
  const inIds = new Set((await InventoryMovement.find({ txnType: 'SCRAP_IN' }).select('_id').lean()).map((m) => String(m._id)));
  check('[11] no Scrap In row leaks into the history', hRows.every((r) => !inIds.has(String(r._id))));
  check('[ 4] newest first: date DESC, then createdAt DESC', hRows.every((r, i) => i === 0
    || new Date(hRows[i - 1].date) > new Date(r.date)
    || (+new Date(hRows[i - 1].date) === +new Date(r.date) && new Date(hRows[i - 1].createdAt) >= new Date(r.createdAt))));
  eq('[16] the latest save is the TOP row', String(hRows[0]?._id), String(withRemarks.data?.results?.[0]?.movementId));
  eq('[ 4] the dated-earlier legacy sale is the LAST row', hRows[hRows.length - 1]?.soldTo, 'Old Buyer (legacy free text)');
  eq('    summary totals the whole filtered set', histAll.body?.meta?.summary?.totalKg, round2(dbOut.reduce((s, m) => s + m.quantity, 0)));

  const rowOf = (res) => hRows.find((r) => String(r._id) === String(res.data?.results?.[0]?.movementId));
  const h10q = rowOf(tenQ);
  eq('[ 6] 10 Quintal sale: KG 1000', h10q?.quantityKg, 1000);
  eq('[ 7] …Quintal 10', h10q?.quintal, 10);
  eq('[ 8] …Ton 1', h10q?.ton, 1);
  eq('[ 9] …Sold To from the buyer snapshot', h10q?.soldTo, 'Shree Metal Traders');
  eq('[10] …Reason', h10q?.reasonLabel, 'Sold');
  eq('[11] …Taken From', h10q?.warehouse, 'PLG01');
  eq('[12] …Status is the stored value', h10q?.status, (await movementOf(tenQ))?.status);
  eq('[12] …which is ACTIVE', h10q?.status, 'ACTIVE');
  eq('[13] …Reference', h10q?.reference, 'INV-SCR-001');
  eq('[15] …no operator remarks → empty, not the composed sentence', h10q?.remarks, '');
  const h5h = rowOf(fiveHundredKg);
  check('[6-8] 500 kg = 5 Quintal = 0.5 Ton', h5h?.quantityKg === 500 && h5h?.quintal === 5 && h5h?.ton === 0.5, JSON.stringify(h5h && [h5h.quantityKg, h5h.quintal, h5h.ton]));
  const hdec = rowOf(decTon);
  check('[6-8] 125.5 kg = 1.255 Quintal = 0.1255 Ton', hdec?.quintal === 1.255 && hdec?.ton === 0.1255, JSON.stringify(hdec && [hdec.quintal, hdec.ton]));
  const hrem = rowOf(withRemarks);
  eq('[14] Remarks are what the operator typed', hrem?.remarks, 'Loaded on GJ01 truck · paid cash');
  eq('[13] …with its reference', hrem?.reference, 'INV-HIST-1');
  eq('[11] …taken from JW001', hrem?.warehouse, 'JW001');
  const hdisp = rowOf(disp);
  eq('[ 9] a disposal is not "sold to" anyone', hdisp?.soldTo, null);
  eq('    …its free-text party comes back as issuedTo', hdisp?.issuedTo, 'Municipal dump yard');
  eq('[10] …Reason "Disposed of"', hdisp?.reasonLabel, 'Disposed of');
  eq('[15] …empty reference', hdisp?.reference, '');
  eq('[20] the legacy sale shows its stored party as Sold To', hRows.at(-1)?.soldTo, 'Old Buyer (legacy free text)');
  eq('[20] …and its old sentence is not shown as remarks', hRows.at(-1)?.remarks, '');

  const p1 = await H('?limit=3&page=1');
  const p2 = await H('?limit=3&page=2');
  check('[18] page 2 continues exactly where page 1 ends',
    (p2.data || []).map((r) => String(r._id)).join() === hRows.slice(3, 6).map((r) => String(r._id)).join()
    && (p1.data || []).every((r) => !(p2.data || []).some((x) => String(x._id) === String(r._id))));
  eq('[18] pagination meta', JSON.stringify({ page: p2.body?.meta?.page, limit: p2.body?.meta?.limit, total: p2.body?.meta?.total }),
    JSON.stringify({ page: 2, limit: 3, total: dbOut.length }));

  const byReason = await H('?reason=DISPOSAL&limit=100');
  check('[20] reason filter', byReason.data?.length === dbOut.filter((m) => m.reason === 'DISPOSAL').length
    && byReason.data.every((r) => r.reason === 'DISPOSAL'), `${byReason.data?.length}`);
  const byWh = await H('?warehouse=JW001&limit=100');
  check('[20] taken-from filter', byWh.data?.length === dbOut.filter((m) => m.warehouse === 'JW001').length
    && byWh.data.every((r) => r.warehouse === 'JW001'), `${byWh.data?.length}`);
  const byRef = await H('?search=INV-SCR-001');
  check('[20] search by reference', byRef.data?.length === 1 && byRef.data[0].reference === 'INV-SCR-001', `${byRef.data?.length}`);
  const bySold = await H('?search=shree&limit=100');
  check('[20] search by Sold To', bySold.data?.length === 2 && bySold.data.every((r) => r.soldTo === 'Shree Metal Traders'), `${bySold.data?.length}`);
  const byDate = await H('?from=2026-10-01&to=2026-10-01');
  check('[20] date filter isolates the legacy day', byDate.data?.length === 1 && byDate.data[0].soldTo === 'Old Buyer (legacy free text)', `${byDate.data?.length}`);
  eq('    an unknown reason is refused', (await H('?reason=FOO')).status, 422);
  eq('    a Scrap In reason is refused here', (await H('?reason=OPENING_STOCK')).status, 422);
  eq('    limit above 100 is refused', (await H('?limit=101')).status, 422);
  const mvOut = await call('GET', '/scrap-ims/movements?txnType=SCRAP_OUT&limit=1');
  eq('[23] Scrap movement still counts the same Out rows', mvOut.body?.meta?.total, dbOut.length);
  const mvAll = await call('GET', '/scrap-ims/movements?limit=1');
  check('[23] …and still lists Scrap In too', mvAll.body?.meta?.summary?.inCount > 0, JSON.stringify(mvAll.body?.meta?.summary));

  await done();
};

/* ══ --verify: the ledger still adds up ═══════════════════════════════════ */

const verify = async () => {
  await connect();
  console.log('\nScrap Out — database reconciliation\n');
  const sku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();

  console.log('— [24] every balance equals its ledger —');
  for (const s of await InventoryStock.find({ skuId: sku._id }).lean()) {
    const mv = await InventoryMovement.find({ skuId: sku._id, warehouse: s.warehouse, isDeleted: { $ne: true } }).lean();
    const net = round2(mv.reduce((t, m) => t + (m.movementType === MOVEMENT_TYPE.IN ? m.quantity : -m.quantity), 0));
    eq(`${s.warehouse}: Σ in − Σ out = on hand (${net})`, net, round2(s.qtyOnHand));
    const last = mv.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    eq(`${s.warehouse}: the newest movement's balanceAfter = on hand`, round2(last?.balanceAfter), round2(s.qtyOnHand));
  }

  console.log('\n— every unit entry converted exactly —');
  const unitRows = await InventoryMovement.find({ enteredUom: { $exists: true } }).lean();
  const F = { KG: 1, QUINTAL: 100, TON: 1000 };
  check(`all ${unitRows.length} unit entries: quantity = enteredQty × factor`,
    unitRows.length > 0 && unitRows.every((m) => round2(m.enteredQty * F[m.enteredUom]) === round2(m.quantity)),
    unitRows.filter((m) => round2(m.enteredQty * F[m.enteredUom]) !== round2(m.quantity)).map((m) => m.movementNumber).join(','));

  console.log('\n— every sale names a real buyer —');
  const sales = await InventoryMovement.find({ txnType: 'SCRAP_OUT', reason: 'SALE' }).lean();
  const newSales = sales.filter((m) => m.partyName !== 'Old Buyer (legacy free text)');
  const buyers = new Map((await ScrapBuyer.find().lean()).map((b) => [String(b._id), b]));
  check(`all ${newSales.length} new sales carry a buyer snapshot`, newSales.length > 0 && newSales.every((m) => m.buyer?.buyerId), '');
  check('…pointing at a buyer that exists', newSales.every((m) => buyers.has(String(m.buyer?.buyerId))), '');
  check('…with partyName equal to that buyer\'s name', newSales.every((m) => m.partyName === buyers.get(String(m.buyer?.buyerId))?.name), '');

  console.log('\n— [9/20] the historical row is intact —');
  const old = sales.find((m) => m.partyName === 'Old Buyer (legacy free text)');
  check('the pre-change Scrap Out is still there', !!old);
  eq('…200 kg', old?.quantity, 200);
  eq('…no buyer snapshot (it never had one)', old?.buyer, undefined);
  eq('…no entered unit (it never had one)', old?.enteredUom, undefined);
  check('…its old "Issued to" sentence untouched', /Issued to: Old Buyer/.test(old?.remarks || ''), old?.remarks);

  console.log('\n— [5] no duplicate buyers —');
  const live = await ScrapBuyer.find({ isDeleted: false }).lean();
  eq('no two live buyers share a name key', new Set(live.map((b) => b.nameKey)).size, live.length);
  const gsts = live.filter((b) => b.gstNo).map((b) => b.gstNo);
  eq('no two live buyers share a GSTIN', new Set(gsts).size, gsts.length);
  eq('every buyer code is unique', new Set(live.map((b) => b.code)).size, live.length);
  const idx = (await ScrapBuyer.collection.indexes()).map((i) => i.name);
  check('the database enforces it (unique name + GSTIN indexes present)',
    idx.includes('uniq_live_buyer_name') && idx.includes('uniq_live_buyer_gst'), idx.join(','));

  console.log('\n— other modules untouched by the new ledger fields —');
  eq('no non-scrap movement gained buyer/entered fields',
    await InventoryMovement.countDocuments({ skuId: { $ne: sku._id }, $or: [{ buyer: { $exists: true } }, { enteredUom: { $exists: true } }] }), 0);

  await done();
};

const MODES = { '--seed': seed, '--legacy': legacy, '--api': api, '--verify': verify };
const mode = process.argv.find((a) => MODES[a]);
if (!mode) { console.error(`Usage: node src/scripts/e2eScrapOutFixture.js [${Object.keys(MODES).join(' | ')}]`); process.exit(1); }
MODES[mode]().catch((e) => { console.error(e); process.exit(1); });
