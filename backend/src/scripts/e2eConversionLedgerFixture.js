/**
 * Database oracle for the CONVERSION LEDGER — GET /rm-ims/conversion-ledger
 * (rmImsService.listConversionLedger): the one table on the Coil to Circle page
 * that replaced the Coil to Circle History and All conversions.
 *
 *   node src/scripts/e2eConversionLedgerFixture.js --check --db=ambika_e2e_allconv
 *       READ-ONLY. On an already-seeded scratch database: the ledger, under a
 *       matrix of filters drawn from the data, against the raw documents —
 *       every cut exactly once, every row's figures, every total, the order and
 *       the paging — and against the two lists it replaced (it must find
 *       everything either found). Then proves that nothing was written.
 *   node src/scripts/e2eConversionLedgerFixture.js --edge
 *       Drops and seeds ambika_e2e_ledger with hand-made edge cases — IST day
 *       boundaries to the millisecond, cuts sharing a date AND a save time,
 *       one batch number on two receipts, a cut with no coil that shares a GRN
 *       coil's batch, missing optional fields, a deleted cut, a coil whose
 *       receipt is gone — runs the same reconciliation, and checks the exact
 *       answers.
 *
 * The raw side is computed here, in plain JavaScript from the collections, by
 * the rules the ledger documents — never by calling the code under test.
 *
 * SAFETY: localhost scratch databases only ("e2e" in the name), S3 and email
 * off (e2eSafety.js). --check never writes; --edge drops only ambika_e2e_ledger.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import { rmImsService } from '../modules/inventory/rmIms.service.js';
import {
  rmConversionLedgerQuerySchema, rmConversionsQuerySchema, rmCuttingHistoryQuerySchema,
} from '../modules/inventory/rmIms.validation.js';
import { EPS } from '../modules/inventory/coilLineage.js';

const HOST = 'mongodb://127.0.0.1:27017';
const EDGE_DB = 'ambika_e2e_ledger';
const CHECK_DBS = [
  'ambika_e2e_allconv', 'ambika_e2e_coilrounds', 'ambika_e2e_coilhistory', 'ambika_e2e_batchedge',
  'ambika_e2e_ctc_test', 'ambika_e2e_multiround', 'ambika_e2e_cutcoils',
];
// The full IMS run's database lives on its throwaway single-node replica set.
const SPECIAL_URIS = {
  ambika_e2e_full_ims: 'mongodb://127.0.0.1:27018/ambika_e2e_full_ims?replicaSet=rsE2E&directConnection=true',
};
const mode = process.argv[2];
const dbArg = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5);
const DB = mode === '--edge' ? EDGE_DB : dbArg;
const URI = SPECIAL_URIS[DB] || `${HOST}/${DB}`;
if (isEntry(import.meta.url)) {
  if (mode === '--check' && !CHECK_DBS.includes(DB) && !SPECIAL_URIS[DB]) {
    console.error(`--check needs --db=<one of: ${[...CHECK_DBS, ...Object.keys(SPECIAL_URIS)].join(', ')}>`);
    process.exit(1);
  }
  assertE2ESafe(URI, 'e2eConversionLedgerFixture.js');
}

const { ObjectId } = mongoose.Types;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.011;
const str = (v) => (v == null ? '' : String(v));
const isOid = (v) => v instanceof ObjectId || v?._bsontype === 'ObjectId' || v?._bsontype === 'ObjectID';

let passed = 0;
const failed = [];
const check = (name, ok, detail = '') => {
  if (ok) passed += 1; else failed.push(name);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n── ${t} ──`);

const connect = async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB) throw new Error(`Connected to ${mongoose.connection.name}, expected ${DB} — aborting.`);
};
const col = (n) => mongoose.connection.collection(n);

/* ══ The ledger, as the route calls it ═════════════════════════════════════ */
const ledger = async (q) => {
  const { value, error } = rmConversionLedgerQuerySchema.validate(q);
  if (error) throw new Error(`ledger query ${JSON.stringify(q)}: ${error.message}`);
  return rmImsService.listConversionLedger(value);
};
// Every row of a filter, page after page.
const ledgerAll = async (q, limit = 200) => {
  const rows = [];
  let summary;
  for (let page = 1; page < 1000; page += 1) {
    const res = await ledger({ ...q, page, limit });
    summary = summary || res.summary;
    rows.push(...res.docs);
    if (page >= (res.summary.pagination.pages || 1)) break;
  }
  return { rows, summary };
};

/* ══ The raw side ══════════════════════════════════════════════════════════ */
const istDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

const loadRaw = async () => {
  const convs = await col('coilconversions').find({ isDeleted: { $ne: true } }).toArray();
  const scraps = await col('scraprecords').find({ isDeleted: { $ne: true } })
    .project({ conversionId: 1, sourceRef: 1, location: 1 }).toArray();
  const ownScrap = new Map();
  const bySourceRef = new Map();
  for (const s of scraps) {
    if (s.conversionId && !ownScrap.has(String(s.conversionId))) ownScrap.set(String(s.conversionId), s);
    if (s.sourceRef && !bySourceRef.has(s.sourceRef)) bySourceRef.set(s.sourceRef, s);
  }
  const keyOf = (c) => (isOid(c.coilReceiptId) ? String(c.coilReceiptId) : isOid(c.manualCoilId) ? String(c.manualCoilId) : null);
  const keys = [...new Set(convs.map(keyOf).filter(Boolean))].map((k) => new ObjectId(k));
  const movements = await col('inventorymovements').find({ _id: { $in: keys } }).toArray();
  const manuals = await col('manualcoils').find({ _id: { $in: keys } }).toArray();
  const movBy = new Map(movements.map((m) => [String(m._id), m]));
  const manBy = new Map(manuals.map((m) => [String(m._id), m]));

  const cuts = convs.map((c) => {
    const own = ownScrap.get(String(c._id));
    const imp = /\|CONVERSION\|/.test(c.sourceRef || '') ? bySourceRef.get(c.sourceRef.replace('|CONVERSION|', '|SCRAP|')) : null;
    return {
      id: String(c._id),
      key: keyOf(c),
      isManualCut: !isOid(c.coilReceiptId),
      conversionNumber: c.conversionNumber || '',
      date: c.conversionDate ? new Date(c.conversionDate) : null,
      savedAt: c.createdAt ? new Date(c.createdAt) : null,
      batchNo: c.batchNo || '',
      coilSkuCode: c.coilSkuCode || '',
      coilSkuName: c.coilSkuName || '',
      cutKg: Number(c.coilWeightKg) || 0,
      circlesKg: Number(c.circlesWeightKg) || 0,
      pcs: (c.circles || []).reduce((s, x) => s + (Number(x.pcs) || 0), 0),
      scrapKg: Number(c.scrapKg) || 0,
      yieldPct: typeof c.yieldRatioPct === 'number' ? c.yieldRatioPct : null,
      circleIds: (c.circles || []).map((x) => str(x.circleSkuId)),
      location: own?.location ?? imp?.location ?? null,
      sourceRef: c.sourceRef || '',
    };
  });

  // Coils: grouped exactly like the ledger (a coil is GRN unless every one of
  // its cuts names it as a manual coil), with their receipt shaped alike.
  const coils = new Map();
  for (const c of cuts.filter((x) => x.key)) {
    const g = coils.get(c.key) || { key: c.key, cuts: [], isManual: 0 };
    g.cuts.push(c);
    if (c.isManualCut) g.isManual = 1;
    coils.set(c.key, g);
  }
  for (const g of coils.values()) {
    const m = movBy.get(g.key);
    const mc = manBy.get(g.key);
    g.receipt = g.isManual
      ? (mc ? { batchNo: mc.batchNo, skuId: mc.coilSkuId, skuCode: mc.coilSkuCode, skuName: mc.coilSkuName, movementNumber: '', refNumber: '', vendorName: '', quantity: mc.originalWeightKg } : null)
      : (m ? { batchNo: m.batchNo, skuId: m.skuId, skuCode: m.skuCode, skuName: m.skuName, movementNumber: m.movementNumber, refNumber: m.refNumber, vendorName: m.vendorName, quantity: m.quantity } : null);
    g.cutKg = g.cuts.reduce((s, c) => s + c.cutKg, 0);
    g.lastCutAt = Math.max(...g.cuts.map((c) => (c.date ? c.date.getTime() : -Infinity)));
    g.lastSavedAt = Math.max(...g.cuts.map((c) => (c.savedAt ? c.savedAt.getTime() : -Infinity)));
  }
  // Each coil's batch ledger, and its status — the documented rule.
  const pairs = [...coils.values()].filter((g) => !g.isManual && g.receipt).map((g) => ({ batchNo: g.receipt.batchNo, skuId: g.receipt.skuId }));
  const led = pairs.length
    ? await col('inventorymovements').find({ isDeleted: { $ne: true }, $or: pairs }).project({ batchNo: 1, skuId: 1, movementType: 1, quantity: 1 }).toArray()
    : [];
  for (const g of coils.values()) {
    const received = Number(g.receipt?.quantity) || 0;
    let available;
    if (g.isManual) available = received - g.cutKg;
    else if (!g.receipt) available = 0;
    else {
      const mine = led.filter((m) => m.batchNo === g.receipt.batchNo && str(m.skuId) === str(g.receipt.skuId));
      available = mine.reduce((s, m) => s + (m.movementType === 'IN' ? Number(m.quantity) || 0 : m.movementType === 'OUT' ? -(Number(m.quantity) || 0) : 0), 0);
    }
    g.status = received - available <= EPS ? 'NOT_CUT' : available > EPS ? 'PARTIALLY_CUT' : 'FULLY_CUT';
  }
  const unlinked = cuts.filter((c) => !c.key);
  return { cuts, coils, unlinked };
};

/** What a filter must match, by the rules in listConversionLedger's header. */
const expected = (raw, f) => {
  const has = (v, s) => str(v).toLowerCase().includes(String(s).toLowerCase());
  const lo = f.from ? new Date(`${f.from}T00:00:00.000+05:30`) : null;
  const hi = f.to ? new Date(`${f.to}T23:59:59.999+05:30`) : null;
  const loc = f.location ? f.location.toUpperCase() : '';
  const cutLevel = !!(lo || hi || f.circleSkuId || loc || f.batchNo || f.search);
  const cutMatches = (c, rc) => {
    // BSON order: a missing date is below every date.
    if (lo && !(c.date && c.date >= lo)) return false;
    if (hi && c.date && !(c.date <= hi)) return false;
    if (f.circleSkuId && !c.circleIds.includes(String(f.circleSkuId))) return false;
    if (loc && c.location !== loc) return false;
    if (f.batchNo && !(has(rc?.batchNo, f.batchNo) || has(c.batchNo, f.batchNo))) return false;
    if (f.search) {
      const s = f.search;
      const coilHit = rc && ['batchNo', 'skuCode', 'skuName', 'movementNumber', 'refNumber', 'vendorName'].some((k) => has(rc[k], s));
      const cutHit = ['batchNo', 'conversionNumber', 'coilSkuCode', 'coilSkuName'].some((k) => has(c[k], s));
      if (!coilHit && !cutHit) return false;
    }
    return true;
  };
  const et = (f.entryType || '').toUpperCase();
  const st = (f.status || '').toUpperCase();
  const rows = [];
  if (et !== 'NONE') {
    for (const g of raw.coils.values()) {
      // COIL: any physical coil.
      if (et === 'GRN' && g.isManual) continue;
      if (et === 'MANUAL' && !g.isManual) continue;
      if (st && g.status !== st) continue;
      const matched = g.cuts.filter((c) => cutMatches(c, g.receipt));
      if (cutLevel && !matched.length) continue;
      rows.push({ kind: 'COIL', id: g.key, matched, lastCutAt: g.lastCutAt, lastSavedAt: g.lastSavedAt, status: g.status, g });
    }
  }
  if ((et === '' || et === 'NONE') && !st) {
    for (const c of raw.unlinked) {
      if (cutLevel && !cutMatches(c, null)) continue;
      rows.push({
        kind: 'UNLINKED', id: c.id, matched: [c], lastCutAt: c.date ? c.date.getTime() : -Infinity, lastSavedAt: c.savedAt ? c.savedAt.getTime() : -Infinity, c,
      });
    }
  }
  rows.sort((a, b) => (b.lastCutAt - a.lastCutAt) || (b.lastSavedAt - a.lastSavedAt) || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  const m = rows.flatMap((r) => r.matched);
  const sum = (k) => m.reduce((s, c) => s + (Number(c[k]) || 0), 0);
  const atLoc = (l) => m.filter((c) => c.location === l).reduce((s, c) => s + c.scrapKg, 0);
  return {
    rows,
    cutLevel,
    matchedIds: m.map((c) => c.id),
    totals: {
      entries: rows.length,
      coils: rows.filter((r) => r.kind === 'COIL').length,
      unlinked: rows.filter((r) => r.kind === 'UNLINKED').length,
      partiallyCut: rows.filter((r) => r.status === 'PARTIALLY_CUT').length,
      fullyCut: rows.filter((r) => r.status === 'FULLY_CUT').length,
      cuts: m.length,
      cutKg: sum('cutKg'),
      circlesKg: sum('circlesKg'),
      circlesPcs: sum('pcs'),
      scrapKg: sum('scrapKg'),
      plantScrapKg: atLoc('PLG01'),
      jobWorkScrapKg: atLoc('JW001'),
      avgYieldPct: m.length ? r2(sum('yieldPct') / m.length) : null,
    },
  };
};

/* ══ One filter, reconciled ════════════════════════════════════════════════ */
const reconcile = async (raw, f, label) => {
  // Expected from the query exactly as the route will see it (trimmed,
  // upper-cased where the schema says so).
  const q = rmConversionLedgerQuerySchema.validate(f).value;
  const exp = expected(raw, q);
  const { rows, summary } = await ledgerAll(f);
  const ids = rows.map((r) => r.id);
  const t = exp.totals;
  const bad = [];
  // Each record type's count, under every other filter.
  const seg = expected(raw, { ...q, entryType: '' }).totals;
  const segIsManual = (m) => expected(raw, { ...q, entryType: m ? 'MANUAL' : 'GRN' }).totals.coils;
  const sg = summary.segments || {};
  if (sg.all !== seg.entries || sg.coils !== seg.coils || sg.unlinked !== seg.unlinked || sg.grn !== segIsManual(false) || sg.manual !== segIsManual(true)) {
    bad.push(`segments ${JSON.stringify(sg)} ≠ all ${seg.entries} / coils ${seg.coils} / unlinked ${seg.unlinked}`);
  }
  if (new Set(ids).size !== ids.length) bad.push('a row is listed twice');
  if (ids.join() !== exp.rows.map((r) => r.id).join()) {
    bad.push(`rows/order differ: got ${ids.length} [${ids.slice(0, 4).join(',')}…] expected ${exp.rows.length} [${exp.rows.slice(0, 4).map((r) => r.id).join(',')}…]`);
  }
  if (summary.pagination.total !== t.entries) bad.push(`total ${summary.pagination.total} ≠ ${t.entries}`);
  for (const k of ['coils', 'unlinked', 'partiallyCut', 'fullyCut', 'cuts']) if (summary[k] !== t[k]) bad.push(`${k} ${summary[k]} ≠ ${t[k]}`);
  for (const k of ['cutKg', 'circlesKg', 'circlesPcs', 'scrapKg', 'plantScrapKg', 'jobWorkScrapKg']) if (!close(summary[k], t[k])) bad.push(`${k} ${summary[k]} ≠ ${r2(t[k])}`);
  if (t.cuts && !close(summary.avgYieldPct, t.avgYieldPct)) bad.push(`avgYieldPct ${summary.avgYieldPct} ≠ ${t.avgYieldPct}`);
  if (!close(summary.coilCuts + summary.unlinked, summary.cuts)) bad.push('coil cuts + unlinked ≠ cuts');
  // Every matching cut exactly once — named by its row.
  const named = rows.flatMap((r) => (r.kind === 'UNLINKED' ? [String(r.conversionId)]
    : exp.cutLevel ? (r.matchedConversionIds || []) : (raw.coils.get(r.id)?.cuts || []).map((c) => c.id)));
  if (new Set(named).size !== named.length) bad.push('a cut is named by two rows');
  if ([...named].sort().join() !== [...exp.matchedIds].sort().join()) bad.push(`matched cuts differ: ${named.length} vs ${exp.matchedIds.length}`);
  // Each row's own figures.
  for (const r of rows) {
    if (r.kind === 'COIL') {
      const g = raw.coils.get(r.id);
      if (!g) { bad.push(`coil ${r.id} not in the data`); continue; }
      if (r.rounds !== g.cuts.length || !close(r.cutKg, g.cutKg) || r.status !== g.status) bad.push(`coil ${r.batchNo || r.id}: ${r.rounds} rounds/${r.cutKg} kg/${r.status} vs ${g.cuts.length}/${r2(g.cutKg)}/${g.status}`);
      if (r.matchedRounds !== (exp.cutLevel ? exp.rows.find((x) => x.id === r.id)?.matched.length : g.cuts.length)) bad.push(`coil ${r.batchNo}: matchedRounds ${r.matchedRounds}`);
    } else {
      const c = raw.unlinked.find((x) => x.id === r.id);
      if (!c) { bad.push(`unlinked ${r.id} not in the data`); continue; }
      if (r.conversionNumber !== c.conversionNumber || !close(r.cutKg, c.cutKg) || !close(r.circlesKg, c.circlesKg) || !close(r.scrapKg, c.scrapKg)
        || (r.location || null) !== c.location || r.origin !== (c.sourceRef ? 'IMPORT' : 'NO_RECEIPT') || r.batchNo !== c.batchNo) {
        bad.push(`unlinked ${c.conversionNumber}: figures differ`);
      }
    }
  }
  check(`${label}: ${t.entries} row${t.entries === 1 ? '' : 's'} · ${t.cuts} cut${t.cuts === 1 ? '' : 's'} · ${r2(t.cutKg)} kg — each cut once, every figure and total from the raw documents`,
    bad.length === 0, bad.slice(0, 4).join(' | '));
  return { rows, summary, exp };
};

/** The two lists the ledger replaced must find nothing it does not. */
const oldScreens = async (f, label, got) => {
  const et = (f.entryType || '').toUpperCase();
  const unionOnly = !!(f.batchNo || f.search); // the only filters whose meanings were united
  const matched = new Set(got.rows.flatMap((r) => (r.kind === 'UNLINKED' ? [String(r.conversionId)]
    : r.matchedConversionIds || [])));
  const allIdsOfCoils = new Set(got.rows.filter((r) => r.kind === 'COIL').map((r) => r.id));
  if (!got.summary.cutFiltered) {
    // Without a cut-level filter, a coil row stands for all of its cuts.
    got.rows.filter((r) => r.kind === 'COIL').forEach((r) => (got.exp.rows.find((x) => x.id === r.id)?.matched || []).forEach((c) => matched.add(c.id)));
  }
  // All conversions (which had no "any physical coil": GRN and manual together).
  const conv = [];
  for (const entryType of et === 'COIL' ? ['GRN', 'MANUAL'] : [f.entryType]) {
    for (let page = 1; page < 1000; page += 1) {
      const { value } = rmConversionsQuerySchema.validate({ ...f, entryType, page, limit: 500 });
      const res = await rmImsService.listConversions(value);
      conv.push(...res.docs.map((d) => String(d._id)));
      if (page >= res.totals.pagination.pages) break;
    }
  }
  const missingConv = conv.filter((id) => !matched.has(id));
  const convOk = missingConv.length === 0 && (unionOnly || conv.length === matched.size);
  // Coil to Circle History (it knew only coils; '' there meant GRN + manual).
  let histOk = true;
  let histDetail = '';
  if (et !== 'NONE') {
    const hist = [];
    let summary;
    for (let page = 1; page < 1000; page += 1) {
      const { value } = rmCuttingHistoryQuerySchema.validate({ ...f, entryType: et === 'COIL' ? '' : f.entryType, page, limit: 200 });
      const res = await rmImsService.listCuttingHistory(value);
      summary = summary || res.summary;
      hist.push(...res.docs.map((d) => String(d.coilId)));
      if (hist.length >= res.summary.pagination.total) break;
    }
    const missing = hist.filter((id) => !allIdsOfCoils.has(id));
    histOk = missing.length === 0 && (unionOnly || hist.length === got.summary.coils)
      && (unionOnly || (summary.matching.rounds === got.summary.coilCuts && close(summary.matching.cutKg, got.summary.cutKg - got.summary.unlinkedCutKg)));
    histDetail = `history ${hist.length} coils / ${summary.matching.rounds} rounds vs ledger ${got.summary.coils} / ${got.summary.coilCuts}; missing ${missing.length}`;
  }
  check(`${label}: finds everything both old lists found${unionOnly ? ' (and possibly more — the two meanings united)' : ' — and exactly that'}`,
    convOk && histOk, `${!convOk ? `All conversions ${conv.length}, ${missingConv.length} not in the ledger` : ''} ${histDetail}`);
};

/** The filter matrix, drawn from the data itself. */
const filterMatrix = (raw) => {
  const coilsArr = [...raw.coils.values()];
  const days = [...new Set(raw.cuts.filter((c) => c.date).map((c) => istDay(c.date)))].sort();
  const circles = [...new Set(raw.cuts.flatMap((c) => c.circleIds).filter(Boolean))].slice(0, 4);
  const aCoil = coilsArr.find((g) => g.receipt?.batchNo);
  const aGrn = coilsArr.find((g) => g.receipt?.refNumber);
  const aSupplier = coilsArr.find((g) => g.receipt?.vendorName);
  const aMulti = coilsArr.find((g) => g.cuts.length > 1);
  const anUnlinked = raw.unlinked.find((c) => c.batchNo);
  const F = [
    ['no filter', {}],
    ['entry type GRN', { entryType: 'GRN' }],
    ['entry type manual', { entryType: 'MANUAL' }],
    ['entry type: no physical coil', { entryType: 'NONE' }],
    ['entry type: any physical coil', { entryType: 'COIL' }],
    ['any physical coil + PLG01', { entryType: 'coil', location: 'PLG01' }],
    ['status Partially cut', { status: 'PARTIALLY_CUT' }],
    ['status Fully cut', { status: 'FULLY_CUT' }],
    ['status + no physical coil (never both)', { status: 'FULLY_CUT', entryType: 'NONE' }],
    ['location PLG01', { location: 'PLG01' }],
    ['location JW001', { location: 'jw001' }],
    ...circles.map((id, i) => [`circle #${i + 1}`, { circleSkuId: id }]),
  ];
  if (days.length) {
    const mid = days[Math.floor(days.length / 2)];
    F.push(['one IST day (the first)', { from: days[0], to: days[0] }]);
    F.push([`one IST day (${mid})`, { from: mid, to: mid }]);
    F.push(['from a day on', { from: mid }]);
    F.push(['up to a day', { to: mid }]);
    F.push(['a range + PLG01', { from: days[0], to: mid, location: 'PLG01' }]);
  }
  if (aCoil) {
    F.push(['batch, part of it, any case', { batchNo: aCoil.receipt.batchNo.slice(0, Math.max(3, aCoil.receipt.batchNo.length - 2)).toLowerCase() }]);
    F.push(['batch, exact', { batchNo: aCoil.receipt.batchNo }]);
    F.push(['search the coil SKU', { search: aCoil.receipt.skuCode }]);
  }
  if (aGrn) F.push(['search a GRN number', { search: aGrn.receipt.refNumber }]);
  if (aSupplier) F.push(['search a supplier, part of it', { search: aSupplier.receipt.vendorName.slice(0, 5) }]);
  if (aMulti) F.push(['search one round\'s conversion number', { search: aMulti.cuts[aMulti.cuts.length - 1].conversionNumber }]);
  if (anUnlinked) {
    F.push(['batch of a cut with no coil', { batchNo: anUnlinked.batchNo }]);
    F.push(['search a no-coil cut\'s conversion number', { search: anUnlinked.conversionNumber }]);
  }
  if (circles[0] && days.length) F.push(['circle + up to a day + manual', { circleSkuId: circles[0], to: days[days.length - 1], entryType: 'MANUAL' }]);
  F.push(['nothing matches', { batchNo: 'NO-SUCH-BATCH-ZZZ' }]);
  return F;
};

const pagingChecks = async (raw) => {
  section('Paging and order');
  for (const [label, f] of [['no filter', {}], ['PLG01', { location: 'PLG01' }]]) {
    const full = (await ledgerAll(f, 200)).rows.map((r) => r.id);
    for (const size of [1, 3, 7, 25]) {
      if (size === 1 && full.length > 60) continue;
      const seq = (await ledgerAll(f, size)).rows.map((r) => r.id);
      check(`${label}: ${size} a page gives the same ${full.length} rows in the same order, none twice`,
        seq.join() === full.join() && new Set(seq).size === seq.length, `${seq.length} rows`);
    }
    const again = (await ledgerAll(f, 7)).rows.map((r) => r.id);
    check(`${label}: asked twice, the same order (ties broken the same way)`, again.join() === full.join());
  }
  const res = await ledger({ page: 1, limit: 5 });
  const last = await ledger({ page: 99999, limit: 5 });
  check('a page past the end is empty, with the same totals', last.docs.length === 0 && last.summary.pagination.total === res.summary.pagination.total
    && close(last.summary.cutKg, res.summary.cutKg));
  return raw;
};

/* ══ What the database holds — to prove a read wrote nothing ═══════════════ */
const fingerprint = async () => {
  const out = {};
  for (const n of ['coilconversions', 'inventorymovements', 'scraprecords', 'manualcoils', 'inventorystocks']) {
    const c = col(n);
    const [last] = await c.find({}).sort({ updatedAt: -1 }).limit(1).project({ updatedAt: 1 }).toArray();
    out[n] = `${await c.countDocuments({})}@${last?.updatedAt ? new Date(last.updatedAt).toISOString() : '-'}`;
  }
  return out;
};

const runChecks = async () => {
  const before = await fingerprint();
  const raw = await loadRaw();
  console.log(`\n${DB}: ${raw.cuts.length} cuts · ${raw.coils.size} physical coils · ${raw.unlinked.length} cuts with no physical coil`);

  section('Every cut exactly once');
  const all = await ledgerAll({}, 200);
  const coilRows = all.rows.filter((r) => r.kind === 'COIL');
  const unl = all.rows.filter((r) => r.kind === 'UNLINKED');
  check(`unfiltered: ${raw.coils.size} coil rows + ${raw.unlinked.length} no-coil rows = ${all.rows.length}`,
    coilRows.length === raw.coils.size && unl.length === raw.unlinked.length);
  check(`Σ rounds of the coil rows + no-coil rows = all ${raw.cuts.length} cuts, and = the "cuts" total`,
    coilRows.reduce((s, r) => s + r.rounds, 0) + unl.length === raw.cuts.length && all.summary.cuts === raw.cuts.length);
  check('the count of every cut ("of M") is every non-deleted conversion', all.summary.allCuts === raw.cuts.length);
  // An always-true cut filter names every cut by its row: each exactly once.
  const named = (await ledgerAll({ from: '1900-01-01' }, 200)).rows
    .flatMap((r) => (r.kind === 'UNLINKED' ? [String(r.conversionId)] : r.matchedConversionIds || []));
  check('naming each row\'s cuts covers every cut, and none twice', named.length === raw.cuts.length && new Set(named).size === named.length
    && raw.cuts.every((c) => named.includes(c.id)));
  check('no row of a cut with no coil is attached to a coil — every one is its own row',
    raw.unlinked.every((c) => unl.some((r) => r.id === c.id)));

  section('Filters, totals and rows — against the raw documents and both old lists');
  for (const [label, f] of filterMatrix(raw)) {
    const got = await reconcile(raw, f, label);
    await oldScreens(f, label, got);
  }
  await pagingChecks(raw);

  section('Read-only');
  const after = await fingerprint();
  check('nothing was created, changed or deleted by any of these reads', JSON.stringify(before) === JSON.stringify(after),
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  return raw;
};

/* ══ --edge: hand-made edge cases ══════════════════════════════════════════ */
const ist = (s) => new Date(`${s}+05:30`);
const seedEdge = async () => {
  await mongoose.connection.dropDatabase();
  const S1 = new ObjectId(); const S2 = new ObjectId();
  const C1 = new ObjectId(); const C2 = new ObjectId();
  const id = {};
  for (const k of ['RG1', 'RD1', 'RD2', 'MC1', 'GONE', 'g1a', 'g1b', 'g1del', 'd1', 'd2', 'm1', 'x1', 'u1', 'u2', 'u3', 'u4', 'u5']) id[k] = new ObjectId();
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  let mvNo = 0;
  const mv = (o) => {
    mvNo += 1;
    return { isDeleted: false, createdAt: t0, updatedAt: t0, warehouse: 'PLG01', movementNumber: `MV-EDGE-OUT-${mvNo}`, ...o };
  };
  await col('inventorymovements').insertMany([
    mv({ _id: id.RG1, movementType: 'IN', quantity: 1000, batchNo: 'EDGE-G1', skuId: S1, skuCode: 'EDGE-COIL-1', skuName: 'Edge coil one', movementNumber: 'MV-EDGE-G1', refType: 'GRN', refNumber: 'GRN-EDGE-1', vendorName: 'Edge Supplier Pvt', poNumber: 'PO-EDGE-1', unitCost: 150, movementDate: ist('2026-02-01T10:00:00') }),
    mv({ movementType: 'OUT', quantity: 300, batchNo: 'EDGE-G1', skuId: S1 }),
    mv({ movementType: 'OUT', quantity: 300, batchNo: 'EDGE-G1', skuId: S1 }),
    // One batch number on two receipts of two coil grades: two coils.
    mv({ _id: id.RD1, movementType: 'IN', quantity: 500, batchNo: 'EDGE-DUP', skuId: S1, skuCode: 'EDGE-COIL-1', skuName: 'Edge coil one', movementNumber: 'MV-EDGE-D1', refType: 'GRN', refNumber: 'GRN-EDGE-2', vendorName: 'Dup Metals', movementDate: ist('2026-01-10T10:00:00') }),
    mv({ movementType: 'OUT', quantity: 500, batchNo: 'EDGE-DUP', skuId: S1 }),
    mv({ _id: id.RD2, movementType: 'IN', quantity: 800, batchNo: 'EDGE-DUP', skuId: S2, skuCode: 'EDGE-COIL-2', skuName: 'Edge coil two', movementNumber: 'MV-EDGE-D2', refType: 'GRN', refNumber: 'GRN-EDGE-3', vendorName: 'Dup Metals', movementDate: ist('2026-01-10T10:00:00') }),
    mv({ movementType: 'OUT', quantity: 100, batchNo: 'EDGE-DUP', skuId: S2 }),
  ]);
  await col('manualcoils').insertOne({
    _id: id.MC1, batchNo: 'EDGE-MAN', batchKey: 'EDGE-MAN', coilSkuId: S2, coilSkuCode: 'EDGE-COIL-2', coilSkuName: 'Edge coil two',
    originalWeightKg: 600, warehouse: 'JW001', rate: 0, isDeleted: false, createdAt: t0, updatedAt: t0,
  });
  const circle = (cid, code, pcs, kg) => ({ circleSkuId: cid, circleSkuCode: code, circleSkuName: `${code} circle`, sizeLabel: '', pcs, weightKg: kg });
  const cv = (o) => ({
    isDeleted: false, coilSkuId: S1, coilSkuCode: 'EDGE-COIL-1', coilSkuName: 'Edge coil one', rate: 0, createdAt: t0, updatedAt: t0, ...o,
  });
  const tSame = new Date('2025-06-10T08:00:00.000Z');
  await col('coilconversions').insertMany([
    // GRN coil, two rounds at the two ends of March in IST, to the millisecond.
    cv({ _id: id.g1a, conversionNumber: 'EDGE/001', conversionDate: ist('2026-03-01T00:00:00.000'), createdAt: new Date('2026-03-01T01:00:00Z'), batchNo: 'EDGE-G1', coilReceiptId: id.RG1, coilWeightKg: 300, circles: [circle(C1, 'EDGE-CIR-1', 10, 250)], circlesWeightKg: 250, scrapKg: 50, yieldRatioPct: 83.33, scrapVerified: 'DONE', cuttingType: 'PARTIAL' }),
    cv({ _id: id.g1b, conversionNumber: 'EDGE/002', conversionDate: ist('2026-03-31T23:59:59.999'), createdAt: new Date('2026-03-31T19:00:00Z'), batchNo: 'EDGE-G1', coilReceiptId: id.RG1, coilWeightKg: 300, circles: [circle(C2, 'EDGE-CIR-2', 12, 280)], circlesWeightKg: 280, scrapKg: 20, yieldRatioPct: 93.33, scrapVerified: 'PENDING', cuttingType: 'PARTIAL' }),
    // A deleted round of the same coil: never listed, never counted.
    cv({ _id: id.g1del, isDeleted: true, conversionNumber: 'EDGE/DEL', conversionDate: ist('2026-03-15T12:00:00'), batchNo: 'EDGE-G1', coilReceiptId: id.RG1, coilWeightKg: 999, circles: [], circlesWeightKg: 0, scrapKg: 999, yieldRatioPct: 0 }),
    // The duplicate batch: one cut each, same date, same save time.
    cv({ _id: id.d1, conversionNumber: 'EDGE/003', conversionDate: ist('2026-01-15T11:00:00'), createdAt: new Date('2026-01-15T06:00:00Z'), batchNo: 'EDGE-DUP', coilReceiptId: id.RD1, coilWeightKg: 500, circles: [circle(C1, 'EDGE-CIR-1', 20, 450)], circlesWeightKg: 450, scrapKg: 50, yieldRatioPct: 90, scrapVerified: 'DONE', cuttingType: 'FULL' }),
    cv({ _id: id.d2, conversionNumber: 'EDGE/004', conversionDate: ist('2026-01-15T11:00:00'), createdAt: new Date('2026-01-15T06:00:00Z'), batchNo: 'EDGE-DUP', coilSkuId: S2, coilSkuCode: 'EDGE-COIL-2', coilSkuName: 'Edge coil two', coilReceiptId: id.RD2, coilWeightKg: 100, circles: [circle(C1, 'EDGE-CIR-1', 4, 90)], circlesWeightKg: 90, scrapKg: 10, yieldRatioPct: 90, scrapVerified: 'PENDING', cuttingType: 'PARTIAL' }),
    // A manual coil's round with every optional field missing.
    cv({ _id: id.m1, conversionNumber: 'EDGE/005', conversionDate: ist('2026-02-10T09:00:00'), batchNo: 'EDGE-MAN', coilSkuId: S2, coilSkuCode: 'EDGE-COIL-2', coilSkuName: 'Edge coil two', manualCoilId: id.MC1, coilWeightKg: 200, circlesWeightKg: 0, scrapKg: 200 }),
    // A coil whose receipt is gone.
    cv({ _id: id.x1, conversionNumber: 'EDGE/006', conversionDate: ist('2026-02-20T09:00:00'), batchNo: 'EDGE-GONE', coilReceiptId: id.GONE, coilWeightKg: 100, circles: [circle(C1, 'EDGE-CIR-1', 4, 90)], circlesWeightKg: 90, scrapKg: 10, yieldRatioPct: 90 }),
    // Workbook imports: one date and one save time for all three.
    cv({ _id: id.u1, conversionNumber: 'EXL/L-EDGE-1', conversionDate: tSame, createdAt: tSame, batchNo: 'L-EDGE-1', sourceRef: 'EXCEL_RM_24_25|CONVERSION|L-EDGE-1', coilWeightKg: 100, circles: [circle(C2, 'EDGE-CIR-2', 5, 80)], circlesWeightKg: 80, scrapKg: 20, yieldRatioPct: 80, scrapVerified: 'REJECTED' }),
    cv({ _id: id.u2, conversionNumber: 'EXL/L-EDGE-2', conversionDate: tSame, createdAt: tSame, batchNo: 'L-EDGE-2', sourceRef: 'EXCEL_RM_24_25|CONVERSION|L-EDGE-2', coilWeightKg: 50, circles: [], circlesWeightKg: 40, scrapKg: 10 }),
    cv({ _id: id.u3, conversionNumber: 'EXL/L-EDGE-3', conversionDate: tSame, createdAt: tSame, batchNo: 'L-EDGE-3', sourceRef: 'EXCEL_RM_24_25|CONVERSION|L-EDGE-3', coilWeightKg: 70, circles: [circle(C2, 'EDGE-CIR-2', 3, 60)], circlesWeightKg: 60, scrapKg: 10, yieldRatioPct: 85.71 }),
    // "No receipt available": one a millisecond before March in IST, one at
    // the first instant of April — the second sharing the GRN coil's batch.
    cv({ _id: id.u4, conversionNumber: 'EDGE/007', conversionDate: ist('2026-02-28T23:59:59.999'), createdAt: new Date('2026-02-28T20:00:00Z'), batchNo: '', coilWeightKg: 50, circles: [circle(C1, 'EDGE-CIR-1', 2, 40)], circlesWeightKg: 40, scrapKg: 10, yieldRatioPct: 80, scrapVerified: 'PENDING', cuttingType: 'PARTIAL', rate: 140 }),
    cv({ _id: id.u5, conversionNumber: 'EDGE/008', conversionDate: ist('2026-04-01T00:00:00.000'), createdAt: new Date('2026-03-31T19:30:00Z'), batchNo: 'EDGE-G1', coilWeightKg: 40, circles: [circle(C1, 'EDGE-CIR-1', 2, 30)], circlesWeightKg: 30, scrapKg: 10, yieldRatioPct: 75, scrapVerified: 'PENDING', cuttingType: 'PARTIAL' }),
  ]);
  const sr = (o) => ({ isDeleted: false, createdAt: t0, updatedAt: t0, ...o });
  await col('scraprecords').insertMany([
    sr({ conversionId: id.g1a, location: 'PLG01' }),
    sr({ conversionId: id.g1b, location: 'JW001' }),
    sr({ conversionId: id.d1, location: 'PLG01' }),
    sr({ conversionId: id.d2, location: 'PLG01' }),
    sr({ conversionId: id.x1, location: 'PLG01' }),
    sr({ sourceRef: 'EXCEL_RM_24_25|SCRAP|L-EDGE-1', location: 'JW001' }),
    sr({ sourceRef: 'EXCEL_RM_24_25|SCRAP|L-EDGE-3', location: 'PLG01' }),
    sr({ conversionId: id.u4, location: 'PLG01' }),
    sr({ conversionId: id.u5, location: 'JW001' }),
  ]);
  return { id: Object.fromEntries(Object.entries(id).map(([k, v]) => [k, String(v)])), C1: String(C1) };
};

const edge = async () => {
  await connect();
  const { id, C1 } = await seedEdge();
  console.log(`\nSeeded ${EDGE_DB}: 5 coils (one with its receipt gone) · 5 cuts with no coil · 1 deleted cut`);
  const row = (rows, k) => rows.find((r) => r.id === id[k]);
  const ids = (rows) => rows.map((r) => r.id);

  section('Exact answers');
  let { rows, summary } = await ledgerAll({});
  check('10 rows: 5 coils + 5 cuts with no coil; 11 cuts (the deleted one nowhere)', rows.length === 10 && summary.coils === 5 && summary.unlinked === 5
    && summary.cuts === 11 && summary.allCuts === 11 && !rows.some((r) => r.conversionNumber === 'EDGE/DEL'));
  check('order: newest cut first — the first instant of April before 23:59:59.999 on 31 March', ids(rows).slice(0, 3).join() === [id.u5, id.RG1, id.u4].join(), ids(rows).join());
  const tie = ids(rows).filter((x) => [id.u1, id.u2, id.u3].includes(x));
  check('three imports with one date and one save time: ordered by id, newest id first', tie.join() === [id.u1, id.u2, id.u3].sort().reverse().join());
  const dup = ids(rows).filter((x) => [id.RD1, id.RD2].includes(x));
  check('two coils with one batch number, one date and one save time: two rows, ordered by id', dup.join() === [id.RD1, id.RD2].sort().reverse().join());
  const g1 = row(rows, 'RG1');
  check('the GRN coil: 2 rounds (not the deleted one), 600 kg cut, 400 kg left, Partially cut, its GRN and supplier and PO',
    g1.rounds === 2 && g1.cutKg === 600 && g1.remainingKg === 400 && g1.status === 'PARTIALLY_CUT' && g1.grnNo === 'GRN-EDGE-1'
      && g1.supplier === 'Edge Supplier Pvt' && g1.poNumber === 'PO-EDGE-1' && g1.unitCost === 150);
  check('a cut with no coil that shares its batch (EDGE-G1) stays its own row — never one of its rounds',
    row(rows, 'u5')?.kind === 'UNLINKED' && g1.rounds === 2);
  const gone = row(rows, 'GONE');
  check('a coil whose receipt is gone is still listed, as missing — no batch invented', gone?.kind === 'COIL' && gone.receiptMissing === true && gone.batchNo === '' && gone.rounds === 1);
  const man = row(rows, 'MC1');
  check('the manual coil, every optional field missing: listed, 200 kg cut, no yield made up', man?.coilSource === 'MANUAL' && man.cutKg === 200 && man.receivedKg === 600 && man.remainingKg === 400);
  const u2 = row(rows, 'u2');
  check('an import with no recorded location, no yield and no circle sizes: those stay empty', u2.location === null && u2.yieldPct === null && u2.circles.length === 0 && u2.origin === 'IMPORT');
  const u1 = row(rows, 'u1');
  check('an import takes its location from its own Summary Scrap row (JW001); its REJECTED scrap state is kept', u1.location === 'JW001' && u1.scrapVerified === 'REJECTED');
  const u4 = row(rows, 'u4');
  check('"No receipt available": origin, rate, scrap state and cutting type as recorded', u4.origin === 'NO_RECEIPT' && u4.rate === 140 && u4.scrapVerified === 'PENDING' && u4.cuttingType === 'PARTIAL');

  ({ rows, summary } = await ledgerAll({ from: '2026-03-01', to: '2026-03-31' }));
  check('1–31 March (IST): exactly the two rounds at 00:00:00.000 and 23:59:59.999 — not the cuts a millisecond either side',
    ids(rows).join() === id.RG1 && rows[0].matchedConversionIds.sort().join() === [id.g1a, id.g1b].sort().join() && summary.cuts === 2 && summary.cutKg === 600);
  ({ rows, summary } = await ledgerAll({ from: '2026-03-01', to: '2026-03-01' }));
  check('1 March alone: the coil, with only its first round matched (300 kg)', ids(rows).join() === id.RG1 && rows[0].matchedConversionIds.join() === id.g1a
    && rows[0].matchedRounds === 1 && rows[0].rounds === 2 && summary.cutKg === 300);
  ({ rows } = await ledgerAll({ to: '2026-02-28' }));
  check('up to 28 February includes the cut at 23:59:59.999 IST that day', ids(rows).includes(id.u4) && !ids(rows).includes(id.RG1));
  ({ rows } = await ledgerAll({ from: '2026-04-01' }));
  check('from 1 April includes the cut at its first instant', ids(rows).join() === id.u5);
  ({ rows } = await ledgerAll({ batchNo: 'edge-g1' }));
  check('batch "edge-g1" (any case): the GRN coil and, separately, the no-coil cut carrying that batch', ids(rows).sort().join() === [id.RG1, id.u5].sort().join());
  ({ rows } = await ledgerAll({ batchNo: 'EDGE-DUP' }));
  check('batch EDGE-DUP: both coils', ids(rows).sort().join() === [id.RD1, id.RD2].sort().join());
  ({ rows } = await ledgerAll({ search: 'edge/005' }));
  check('search a conversion number: the manual coil it belongs to, that round matched', ids(rows).join() === id.MC1 && rows[0].matchedConversionIds.join() === id.m1);
  ({ rows } = await ledgerAll({ search: 'supplier pvt' }));
  check('search part of a supplier name: that coil, both rounds', ids(rows).join() === id.RG1 && rows[0].matchedRounds === 2);
  ({ rows, summary } = await ledgerAll({ location: 'JW001' }));
  check('JW001: the coil (its JW001 round only), the no-coil cut cut there, and the import placed there',
    ids(rows).join() === [id.u5, id.RG1, id.u1].join() && rows[1].matchedConversionIds.join() === id.g1b && summary.jobWorkScrapKg === 50 && summary.cuts === 3);
  ({ rows } = await ledgerAll({ entryType: 'NONE' }));
  check('entry type "no physical coil": the five, newest first', ids(rows).join() === [id.u5, id.u4, ...[id.u1, id.u2, id.u3].sort().reverse()].join());
  ({ rows, summary } = await ledgerAll({ entryType: 'COIL' }));
  check('record type "any physical coil": the 5 coils, no cut without one; the counts per type still cover every row',
    rows.length === 5 && rows.every((r) => r.kind === 'COIL') && summary.entries === 5
      && JSON.stringify(summary.segments) === JSON.stringify({ all: 10, coils: 5, grn: 4, manual: 1, unlinked: 5 }), JSON.stringify(summary.segments));
  ({ rows } = await ledgerAll({ status: 'FULLY_CUT' }));
  check('Fully cut: only the 500 kg coil cut whole', ids(rows).join() === id.RD1);
  ({ rows } = await ledgerAll({ status: 'FULLY_CUT', entryType: 'NONE' }));
  check('a status with "no physical coil": nothing (a cut with no coil has no status)', rows.length === 0);
  ({ rows } = await ledgerAll({ circleSkuId: C1, entryType: 'GRN' }));
  check('circle EDGE-CIR-1 + GRN: the coils whose rounds produced it', ids(rows).sort().join() === [id.RG1, id.RD1, id.RD2, id.GONE].sort().join()
    && row(rows, 'RG1').matchedConversionIds.join() === id.g1a);

  await runChecks();
  await mongoose.disconnect();
  return done();
};

const done = () => {
  console.log(`\n${passed}/${passed + failed.length} checks passed.`);
  if (failed.length) console.log(`FAILED:\n  ${failed.join('\n  ')}`);
  return failed.length === 0;
};

const main = async () => {
  if (mode === '--edge') return edge().then((ok) => process.exit(ok ? 0 : 1));
  if (mode === '--check') {
    await connect();
    await runChecks();
    await mongoose.disconnect();
    return process.exit(done() ? 0 : 1);
  }
  console.error('Usage: --check --db=<scratch db> | --edge');
  return process.exit(1);
};

main().catch(async (e) => {
  console.error('\nFixture failed:', e.stack || e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
