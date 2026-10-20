/**
 * auditInventoryClassification.js — READ-ONLY audit for automatic SKU-based
 * inventory routing and QC-gated stock posting.
 * ════════════════════════════════════════════════════════════════════
 * Answers, from real data, the questions that must be settled before GRN
 * routing is trusted on it:
 *
 *   1. SKU counts by itemType, and the destination each type routes to
 *   2. Missing / unsupported / conflicting / ambiguous classifications
 *   3. Examples of every purchasable family found in the data
 *   4. PO lines and GRN lines grouped by their SKU's classification
 *   5. GRNs by status × posting stage, completed QCs, ledger by txnType
 *   6. LEGACY GRNs that posted stock but have not completed QC (they finish
 *      under the legacy rule) and legacy lines with no recorded destination
 *   7. Open draft GRN lines the new rules would refuse at completion
 *
 * It never guesses a classification and never writes: only find / aggregate /
 * countDocuments are issued, and the connection is opened read-preference
 * secondaryPreferred with autoIndex/autoCreate off so not even an index is built.
 *
 * SAFETY — refuses to run unless --uri points at a LOCAL database
 * (mongodb://127.0.0.1 or localhost). It never reads MONGO_URI from .env, so it
 * cannot reach Atlas. Point it at a restored copy or an approved export.
 *
 * USAGE
 *   node src/scripts/auditInventoryClassification.js --uri=mongodb://127.0.0.1:27017/<restored_db> [--out=report.json]
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { describeDbTarget, isEntry } from './e2eSafety.js';
import {
  ITEM_TYPES, RM_ITEM_TYPES, FG_BLOCKED_ITEM_TYPES, NON_MATERIAL_ITEM_TYPES, inventoryDestinationOf,
} from '../modules/skus/sku.model.js';
import { classifyByCode } from '../data/item-classifier.js';

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

const POSTED = ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'];
const RM_LOCATIONS = ['PLG01', 'JW001'];
const up = (v) => String(v || '').trim().toUpperCase();

/** Families the business asked to see examples of — matched on itemType first, then on text. */
const FAMILIES = [
  ['Raw Material (coil)', (s) => s.itemType === 'RAW_MATERIAL'],
  ['Circle', (s) => s.itemType === 'CIRCLE'],
  ['Consumable', (s) => s.itemType === 'CONSUMABLE'],
  ['Packing / Packaging', (s) => ['PACKING', 'PACKAGING'].includes(s.itemType)],
  ['Chemical (type or text)', (s) => s.itemType === 'CHEMICAL' || /chemical/i.test(`${s.category} ${s.name}`)],
  ['Ink (type or text)', (s) => s.itemType === 'INK' || /\bink\b/i.test(`${s.category} ${s.name}`)],
  ['Spare part (type or text)', (s) => s.itemType === 'SPARE_PART' || /spare/i.test(`${s.category} ${s.name}`)],
  ['Service', (s) => s.itemType === 'SERVICE'],
  ['Job work', (s) => s.itemType === 'JOB_WORK'],
  ['Finished Good', (s) => FG_BLOCKED_ITEM_TYPES.includes(s.itemType)],
];

/** Text in category / name that points at a DIFFERENT destination than itemType — flagged, never acted on. */
const TEXT_HINTS = [
  [/chemical|thinner|solvent/i, 'CHEMICAL'],
  [/\bink\b/i, 'INK'],
  [/spare/i, 'SPARE_PART'],
  [/\bservice\b/i, 'SERVICE'],
  [/job ?work/i, 'JOB_WORK'],
  [/\bcoil\b|\bsheet\b/i, 'RAW_MATERIAL'],
  [/\bcircle\b/i, 'CIRCLE'],
];

export const classifySku = (s) => {
  const flags = [];
  const t = s.itemType;
  if (!t) flags.push('MISSING_ITEM_TYPE');
  else if (!ITEM_TYPES.includes(t)) flags.push(`UNSUPPORTED_ITEM_TYPE:${t}`);
  const destination = inventoryDestinationOf(t);
  if (t && !destination && !FG_BLOCKED_ITEM_TYPES.includes(t) && !NON_MATERIAL_ITEM_TYPES.includes(t) && t !== 'SCRAP') {
    flags.push('NO_DESTINATION');
  }
  // The code-prefix classifier only knows five families; it is a hint, not a rule.
  const byCode = classifyByCode(s.code);
  if (byCode && byCode !== 'FINISHED_GOOD' && t && byCode !== t
    && !(byCode === 'PACKING' && t === 'PACKAGING')) flags.push(`CODE_SUGGESTS:${byCode}`);
  if (RM_ITEM_TYPES.includes(t) && byCode && !RM_ITEM_TYPES.includes(byCode)) flags.push('RM_TYPE_NON_RM_CODE');
  const text = `${s.category || ''} ${s.name || ''}`;
  for (const [re, hinted] of TEXT_HINTS) {
    if (re.test(text) && t && t !== hinted && inventoryDestinationOf(hinted) !== destination) flags.push(`TEXT_SUGGESTS:${hinted}`);
  }
  if (/^(QA-|E2E-|TEST)/i.test(s.code || '')) flags.push('TEST_DATA');
  return { destination, flags };
};

const run = async () => {
  const uri = arg('uri');
  const target = describeDbTarget(uri);
  console.log(`\n[audit] target: ${target.uri || '(none)'}`);
  if (!uri || target.srv || !target.local) {
    console.error('[audit] STOP: pass --uri=mongodb://127.0.0.1:27017/<restored db>. Only a LOCAL database is allowed (never Atlas / mongodb+srv).');
    process.exit(1);
  }
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, readPreference: 'secondaryPreferred' });
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);

  // ── 1–3: SKUs ──────────────────────────────────────────────────────────────
  const skus = await col('skus').find({ isDeleted: { $ne: true } })
    .project({ code: 1, name: 1, itemType: 1, category: 1, clientId: 1 }).toArray();
  const byType = {};
  const flagged = [];
  const flagCounts = {};
  for (const s of skus) {
    const k = s.itemType || '(missing)';
    byType[k] = byType[k] || { count: 0, destination: inventoryDestinationOf(s.itemType) || (FG_BLOCKED_ITEM_TYPES.includes(s.itemType) || s.itemType === 'SCRAP' ? 'BLOCKED' : NON_MATERIAL_ITEM_TYPES.includes(s.itemType) ? 'BLOCKED_ON_GRN' : 'NONE') };
    byType[k].count += 1;
    const { flags } = classifySku(s);
    if (flags.length) {
      flagged.push({ code: s.code, name: s.name, itemType: s.itemType || null, category: s.category || '', flags });
      for (const f of flags) { const key = f.split(':')[0]; flagCounts[key] = (flagCounts[key] || 0) + 1; }
    }
  }
  const examples = Object.fromEntries(FAMILIES.map(([label, test]) => [label, skus.filter(test).slice(0, 5)
    .map((s) => `${s.code} · ${s.name} · ${s.itemType}${s.category ? ` / ${s.category}` : ''}`)]));
  const skuById = new Map(skus.map((s) => [String(s._id), s]));
  const skuByCode = new Map(skus.map((s) => [up(s.code), s]));
  const skuOf = (l) => (l.skuId && skuById.get(String(l.skuId))) || skuByCode.get(up(l.skuCode)) || null;

  // ── 4: PO + GRN lines by classification ────────────────────────────────────
  const tally = (lines) => {
    const out = {};
    for (const l of lines) {
      const s = skuOf(l);
      const k = s ? (s.itemType || '(missing)') : '(no SKU match)';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  const pos = await col('vendorpurchaseorders').find({ isDeleted: { $ne: true } })
    .project({ poNumber: 1, poStatus: 1, items: 1 }).toArray();
  const poLines = pos.flatMap((p) => (p.items || []).map((i) => ({ ...i, poNumber: p.poNumber, poStatus: p.poStatus })));
  const grns = await col('goodsreceiptnotes').find({ isDeleted: { $ne: true } })
    .project({
      grnNumber: 1, grnStatus: 1, qcStatus: 1, stockPosted: 1, stockPostingStage: 1, addToRmStock: 1,
      inventoryType: 1, rmReceivedAtLocation: 1, approvalStatus: 1, items: 1, poIds: 1,
    }).toArray();
  const grnLines = grns.flatMap((g) => (g.items || []).filter((i) => Number(i.receivedQty) > 0).map((i) => ({ ...i, grnNumber: g.grnNumber })));
  const mixedPos = pos.filter((p) => {
    const kinds = new Set((p.items || []).map((i) => inventoryDestinationOf(skuOf(i)?.itemType)).filter(Boolean));
    return kinds.size > 1;
  }).map((p) => p.poNumber);
  const nonMaterialOnPurchase = [...poLines, ...grnLines]
    .filter((l) => { const t = skuOf(l)?.itemType; return NON_MATERIAL_ITEM_TYPES.includes(t) || FG_BLOCKED_ITEM_TYPES.includes(t) || t === 'SCRAP'; })
    .map((l) => `${l.poNumber || l.grnNumber} · ${l.itemName} · ${skuOf(l)?.itemType}`);

  // ── 5: GRNs, QCs, ledger ──────────────────────────────────────────────────
  const grnMatrix = {};
  for (const g of grns) {
    const k = `${g.grnStatus} · ${g.stockPostingStage || 'LEGACY'}`;
    grnMatrix[k] = (grnMatrix[k] || 0) + 1;
  }
  const qcByStatus = Object.fromEntries((await col('incomingqcs').aggregate([
    { $match: { isDeleted: { $ne: true } } }, { $group: { _id: { s: '$qcStatus', t: '$sourceType' }, n: { $sum: 1 } } },
  ]).toArray()).map((r) => [`${r._id.t || 'GRN'} · ${r._id.s}`, r.n]));
  const ledger = Object.fromEntries((await col('inventorymovements').aggregate([
    { $match: { isDeleted: { $ne: true } } }, { $group: { _id: { t: '$txnType', r: '$refType' }, n: { $sum: 1 }, qty: { $sum: '$quantity' } } },
  ]).toArray()).map((r) => [`${r._id.t} · ${r._id.r || '-'}`, { rows: r.n, qty: Math.round(r.qty * 100) / 100 }]));
  const movementsByGrn = new Map((await col('inventorymovements').aggregate([
    { $match: { refType: 'GRN', isDeleted: { $ne: true } } }, { $group: { _id: '$refId', n: { $sum: 1 } } },
  ]).toArray()).map((r) => [String(r._id), r.n]));

  // ── 6: legacy GRNs awaiting QC / incomplete destination ───────────────────
  const legacyCompleted = grns.filter((g) => POSTED.includes(g.grnStatus) && !g.stockPostingStage);
  const legacyAwaitingQc = legacyCompleted.filter((g) => g.qcStatus === 'PENDING').map((g) => {
    const received = (g.items || []).filter((i) => Number(i.receivedQty) > 0);
    const unposted = received.filter((i) => !i.movementId);
    return {
      grnNumber: g.grnNumber, approvalStatus: g.approvalStatus, inventoryType: g.inventoryType || null,
      addToRmStock: !!g.addToRmStock, movements: movementsByGrn.get(String(g._id)) || 0,
      receivedLines: received.length,
      linesWithoutMovement: unposted.map((i) => `${i.itemName} (${skuOf(i)?.itemType || 'no SKU'})`),
      stockPostingStatus: unposted.length ? 'PARTLY_OR_NOT_POSTED' : 'ALL_LINES_POSTED',
    };
  });
  const legacyMissingDestination = legacyCompleted.flatMap((g) => (g.items || [])
    .filter((i) => Number(i.receivedQty) > 0 && (!skuOf(i) || (!i.movementId && RM_ITEM_TYPES.includes(skuOf(i)?.itemType))))
    .map((i) => `${g.grnNumber} · ${i.itemName} · ${skuOf(i) ? `${skuOf(i).itemType}, never posted (Add to RM Stock ${g.addToRmStock ? 'on' : 'off'})` : 'no SKU'}`));

  // Stock sitting at a location its SKU type should not be at.
  const stockRows = await col('inventorystocks').find({ isDeleted: { $ne: true }, qtyOnHand: { $ne: 0 } })
    .project({ skuId: 1, skuCode: 1, warehouse: 1, qtyOnHand: 1 }).toArray();
  const locationMismatch = stockRows.filter((r) => {
    const t = skuById.get(String(r.skuId))?.itemType;
    return (RM_ITEM_TYPES.includes(t) && !RM_LOCATIONS.includes(r.warehouse))
      || (!RM_ITEM_TYPES.includes(t) && RM_LOCATIONS.includes(r.warehouse));
  }).map((r) => `${r.skuCode} (${skuById.get(String(r.skuId))?.itemType || 'unknown'}) · ${r.warehouse} · ${r.qtyOnHand}`);

  // ── 7: open drafts the new completion rules would refuse ──────────────────
  const draftProblems = grns.filter((g) => g.grnStatus === 'DRAFT' && !g.stockPosted).flatMap((g) => {
    const received = (g.items || []).filter((i) => Number(i.receivedQty) > 0);
    const out = [];
    for (const i of received) {
      const t = skuOf(i)?.itemType;
      if (!skuOf(i)) out.push(`${g.grnNumber} · ${i.itemName} · not linked to a SKU`);
      else if (NON_MATERIAL_ITEM_TYPES.includes(t)) out.push(`${g.grnNumber} · ${i.itemName} · ${t} (blocked on GRN)`);
      else if (!inventoryDestinationOf(t)) out.push(`${g.grnNumber} · ${i.itemName} · ${t} (no destination)`);
    }
    if (received.some((i) => RM_ITEM_TYPES.includes(skuOf(i)?.itemType)) && !g.rmReceivedAtLocation) {
      out.push(`${g.grnNumber} · has Raw Material but no Received At — must be chosen before completion`);
    }
    if (g.inventoryType) out.push(`${g.grnNumber} · carries retired manual Inventory Type "${g.inventoryType}" — ignored at completion`);
    return out;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    database: target.db,
    skus: { total: skus.length, byItemType: byType, flagCounts, flagged, examples },
    purchaseLines: {
      poLineCount: poLines.length, poLinesByItemType: tally(poLines),
      grnReceivedLineCount: grnLines.length, grnLinesByItemType: tally(grnLines),
      posMixingDestinations: mixedPos,
      blockedTypesOnPurchaseLines: nonMaterialOnPurchase,
    },
    grns: { total: grns.length, byStatusAndStage: grnMatrix },
    qcs: qcByStatus,
    ledgerByTxnAndRef: ledger,
    legacy: {
      completedLegacyGrns: legacyCompleted.length,
      awaitingQc: legacyAwaitingQc,
      linesWithIncompleteDestination: legacyMissingDestination,
    },
    stockAtUnexpectedLocation: locationMismatch,
    openDraftsRefusedByNewRules: draftProblems,
  };

  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report,
    skus: { ...report.skus, flagged: `${flagged.length} SKU(s) — see ${out || 'the full JSON (pass --out=)'}` },
  }, null, 2));
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  run().catch(async (err) => {
    console.error(`[audit] failed: ${err.message}`);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    process.exit(1);
  });
}
