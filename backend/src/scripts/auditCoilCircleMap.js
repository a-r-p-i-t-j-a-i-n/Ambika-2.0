/**
 * Audit the client's Coil → Circle mapping against the real data.
 *
 *   node src/scripts/auditCoilCircleMap.js        (npm run audit:coil-map)
 *
 * READ-ONLY. There is no --commit flag and no write path anywhere in this file:
 * it opens the configured MONGO_URI, reads, prints, and disconnects. The
 * mapping is client business data and the conversions it disagrees with are
 * history — neither is this script's to correct. It exists so that a
 * disagreement is SEEN and taken back to the client, rather than silently
 * merged into the master or quietly left to surprise someone.
 *
 * It answers three questions:
 *
 *   1. Can every approved size actually be chosen? — a code on the sheet with
 *      no active CIRCLE SKU behind it is a size the floor cannot record.
 *   2. Which items does the mapping shut out? — active coils the sheet omits
 *      (they can no longer be cut at all) and active circles no coil produces.
 *   3. What does already-recorded history say? — conversions whose circle does
 *      not appear on their coil's row. These are left exactly as they are.
 *
 * Exit code is 0 even when it finds disagreements: finding them is the job, and
 * a non-zero exit would stop this being runnable from a dashboard or a hook.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import SKU from '../modules/skus/sku.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import {
  COIL_CIRCLE_MAP, allowedCirclesForCoil, allMappedCircleCodes, mappedCoilCodes,
} from '../data/coil-circle-map.js';

dotenv.config();

const h = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
const ok = (msg) => console.log(`   ok    ${msg}`);
const flag = (msg) => console.log(`   FLAG  ${msg}`);

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set — nothing to audit against.');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nCOIL → CIRCLE MAP AUDIT  ·  read-only  ·  ${new Date().toISOString()}`);
  console.log(`${mappedCoilCodes().length} coils, ${allMappedCircleCodes().length} approved circles in the sheet.`);

  const findings = { missingCircles: 0, unmappedCoils: 0, orphanCircles: 0, historyConflicts: 0 };

  /* ── 1. Every approved size resolves to an active CIRCLE SKU ── */
  h('Approved sizes vs the SKU master');
  const circleCodes = allMappedCircleCodes();
  const circleSkus = await SKU.find({ code: { $in: circleCodes }, isDeleted: { $ne: true } })
    .select('code name itemType isActive').lean();
  const circleByCode = new Map(circleSkus.map((s) => [s.code, s]));

  for (const coilCode of mappedCoilCodes()) {
    for (const { code, clientLabel } of allowedCirclesForCoil(coilCode)) {
      const sku = circleByCode.get(code);
      if (!sku) {
        findings.missingCircles += 1;
        flag(`${coilCode} → ${code} ("${clientLabel}") — no SKU in the master. The size cannot be selected.`);
      } else if (sku.itemType !== 'CIRCLE') {
        findings.missingCircles += 1;
        flag(`${coilCode} → ${code} — exists but itemType is ${sku.itemType}, not CIRCLE. Not offered.`);
      } else if (sku.isActive === false) {
        findings.missingCircles += 1;
        flag(`${coilCode} → ${code} ("${sku.name}") — SKU is inactive. Not offered.`);
      }
    }
  }
  if (!findings.missingCircles) ok(`all ${circleCodes.length} approved circles exist, are active and are CIRCLE items.`);

  /* ── 2. What the mapping shuts out ── */
  h('Active items the mapping does not cover');
  const activeCoils = await SKU.find({ itemType: 'RAW_MATERIAL', isActive: true, isDeleted: { $ne: true } })
    .select('code name').lean();
  for (const c of activeCoils) {
    if (!COIL_CIRCLE_MAP[c.code]) {
      findings.unmappedCoils += 1;
      flag(`coil ${c.code} ("${c.name}") is active but unmapped — it cannot be cut until the client maps it.`);
    }
  }
  if (!findings.unmappedCoils) ok('every active coil has a mapping.');

  const activeCircles = await SKU.find({ itemType: 'CIRCLE', isActive: true, isDeleted: { $ne: true } })
    .select('code name').lean();
  const approved = new Set(circleCodes);
  for (const c of activeCircles) {
    if (!approved.has(c.code)) {
      findings.orphanCircles += 1;
      flag(`circle ${c.code} ("${c.name}") is active but no coil produces it — unselectable everywhere.`);
    }
  }
  if (!findings.orphanCircles) ok('every active circle is produced by at least one coil.');

  /* ── 3. History. Reported, never touched. ── */
  h('Conversions already recorded');
  const convs = await CoilConversion.find({ isDeleted: { $ne: true } })
    .select('conversionNumber conversionDate batchNo coilSkuCode circles.circleSkuCode').lean();

  const combos = new Map();
  for (const cv of convs) {
    const allowed = allowedCirclesForCoil(cv.coilSkuCode);
    const allowedCodes = allowed ? allowed.map((a) => a.code) : null;
    for (const line of cv.circles || []) {
      const code = line.circleSkuCode;
      if (!code) continue;
      if (allowedCodes && allowedCodes.includes(code)) continue;
      findings.historyConflicts += 1;
      const key = `${cv.coilSkuCode} → ${code}`;
      const hit = combos.get(key) || { count: 0, examples: [] };
      hit.count += 1;
      if (hit.examples.length < 3) {
        hit.examples.push(`${cv.conversionNumber}${cv.batchNo ? ` (batch ${cv.batchNo})` : ''}`);
      }
      combos.set(key, hit);
    }
  }

  console.log(`   ${convs.length} conversions scanned.`);
  if (!findings.historyConflicts) {
    ok('every recorded conversion agrees with the client mapping.');
  } else {
    for (const [combo, hit] of [...combos.entries()].sort((a, b) => b[1].count - a[1].count)) {
      flag(`${combo} — ${hit.count} line${hit.count > 1 ? 's' : ''}, e.g. ${hit.examples.join(', ')}`);
    }
    console.log('   These records are NOT changed by this script or by the new validation.');
    console.log('   The mapping applies to conversions saved from now on.');
  }

  /* ── Summary ── */
  h('Summary');
  const total = Object.values(findings).reduce((a, b) => a + b, 0);
  console.log(`   approved sizes with no usable SKU : ${findings.missingCircles}`);
  console.log(`   active coils with no mapping      : ${findings.unmappedCoils}`);
  console.log(`   active circles no coil produces   : ${findings.orphanCircles}`);
  console.log(`   historical lines that disagree    : ${findings.historyConflicts}`);
  console.log(total
    ? '\n   Take the flagged items to the client before changing the mapping or the master.\n'
    : '\n   Mapping, SKU master and history all agree.\n');

  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error('\nAudit failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
