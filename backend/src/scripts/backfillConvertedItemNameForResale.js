/**
 * ONE-TIME BACKFILL — legacy resale names into SKU Master.
 *
 *   SOURCE       InventoryPolicy.convertedItemName   (legacy, IMS-local)
 *   DESTINATION  SKU.convertedItemNameForResale      ("Converted Item Name (For
 *                                                     Resale)" — the master field)
 *
 * A SKU is written ONLY when BOTH hold, after trimming:
 *   1. the policy's convertedItemName is non-empty, AND
 *   2. the SKU's convertedItemNameForResale is empty / null / absent.
 * An existing master value is NEVER overwritten — that is the whole safety rule,
 * and it is enforced twice: once when building the plan, and again in the update
 * filter itself, so a value written between the read and the write still wins.
 *
 * That same rule is what makes the script idempotent: after a successful run the
 * destination is non-empty, so the second run classifies the row as SKIP and
 * writes nothing.
 *
 * It never writes to InventoryPolicy, never touches SKU name/code, stock,
 * movements, or any IMS planning number (ADC, lead time, safety factor, MOQ,
 * max level, material in transit). One field on one collection, nothing else.
 * `updatedAt` does move on the SKUs it writes — the schema has timestamps:true,
 * and leaving an audit trace of the backfill is deliberate.
 *
 * USAGE
 *   node src/scripts/backfillConvertedItemNameForResale.js            ← preview (no writes)
 *   DRY_RUN=true node src/scripts/backfillConvertedItemNameForResale.js  ← same, explicit
 *   node src/scripts/backfillConvertedItemNameForResale.js --commit   ← apply
 *
 * Preview mode performs ZERO database writes: it takes the same decisions and
 * prints the same plan, then stops before the update stage. Review that output
 * before committing. DRY_RUN=true overrides --commit, so the safer intent wins.
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';

// Preview by default, exactly like backfillItemType.js and every other one-off
// script here — a bare run must never write. `--commit` applies. DRY_RUN=true is
// also honoured and OVERRIDES --commit, so the safer intent always wins.
const COMMIT = process.argv.includes('--commit');
const DRY_RUN_ENV = process.env.DRY_RUN !== undefined
  && String(process.env.DRY_RUN).toLowerCase() !== 'false';
const DRY_RUN = DRY_RUN_ENV || !COMMIT;

/** Missing, null, non-string and whitespace-only all collapse to '' — one notion of "empty". */
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Matches a destination that is still empty — absent, null, '' or whitespace —
 * as a single clause: "holds no non-whitespace character". Written this way on
 * purpose. The schema declares `set: (v) => (v == null ? '' : v)` on this path,
 * and Mongoose runs setters while casting query filters, so a literal
 * `{ field: null }` clause can be rewritten to `{ field: '' }` and quietly stop
 * matching the rows that are genuinely null. `$not: { $regex: /\S/ }` sidesteps
 * casting entirely and covers all four shapes at once.
 *
 * Used as the write-time guard too, so an update simply matches nothing if the
 * field was filled in between the read and the write.
 */
const STILL_EMPTY = { convertedItemNameForResale: { $not: { $regex: /\S/ } } };

const pad = (s, n) => String(s).slice(0, n).padEnd(n);

/** Read everything and decide, without touching the database. */
const buildPlan = async () => {
  // .lean() on purpose: raw documents, so a field that is genuinely ABSENT stays
  // absent instead of being filled in by the schema default on hydration.
  const [policies, skus] = await Promise.all([
    InventoryPolicy.find({}).select('skuId skuCode convertedItemName isDeleted').lean(),
    SKU.find({}).select('code name convertedItemNameForResale isDeleted').lean(),
  ]);

  const skuById = new Map(skus.map((s) => [String(s._id), s]));
  const withLegacy = policies.filter((p) => clean(p.convertedItemName) !== '');

  const plan = { toWrite: [], skipAlreadySet: [], skipDeletedSku: [], noSku: [] };
  for (const p of withLegacy) {
    const value = clean(p.convertedItemName);
    const sku = skuById.get(String(p.skuId));
    if (!sku) { plan.noSku.push({ policy: p, value }); continue; }
    if (sku.isDeleted === true) { plan.skipDeletedSku.push({ policy: p, sku, value }); continue; }
    if (clean(sku.convertedItemNameForResale) !== '') { plan.skipAlreadySet.push({ policy: p, sku, value }); continue; }
    plan.toWrite.push({ policy: p, sku, value });
  }

  // Two policies pointing at one SKU with different values would make the result
  // order-dependent. Surface it rather than silently letting the last one win.
  const bySku = new Map();
  for (const it of plan.toWrite) {
    const k = String(it.sku._id);
    bySku.set(k, [...(bySku.get(k) || []), it.value]);
  }
  plan.conflicts = [...bySku.entries()]
    .filter(([, vals]) => new Set(vals).size > 1)
    .map(([id, vals]) => ({ skuId: id, values: [...new Set(vals)] }));

  return { plan, totals: { policies: policies.length, skus: skus.length, withLegacy: withLegacy.length } };
};

const printAnalysis = ({ plan, totals }) => {
  console.log('── Read-only analysis ──────────────────────────────────');
  console.log(`1. Total InventoryPolicy documents                : ${totals.policies}`);
  console.log(`2. Policies with a non-empty convertedItemName    : ${totals.withLegacy}`);
  console.log(`3. ...matched to a live SKU by skuId              : ${plan.toWrite.length + plan.skipAlreadySet.length}`);
  console.log(`4. ...where the master field is already populated : ${plan.skipAlreadySet.length}   (never overwritten)`);
  console.log(`5. ...that need backfill                         : ${plan.toWrite.length}`);
  console.log(`6. ...with no matching SKU                       : ${plan.noSku.length}`);
  console.log(`   ...whose SKU is soft-deleted                   : ${plan.skipDeletedSku.length}   (skipped)`);
  console.log(`   Total SKU documents                            : ${totals.skus}`);

  const rows = [
    ...plan.toWrite.map((i) => [i.sku.code, i.value, '—', 'BACKFILL']),
    ...plan.skipAlreadySet.map((i) => [i.sku.code, i.value, clean(i.sku.convertedItemNameForResale), 'SKIP']),
    ...plan.skipDeletedSku.map((i) => [i.sku.code, i.value, clean(i.sku.convertedItemNameForResale) || '—', 'SKIP (sku deleted)']),
    ...plan.noSku.map((i) => [i.policy.skuCode || '(no code)', i.value, '(no SKU)', 'REPORT ONLY']),
  ];
  console.log('\n── Plan ────────────────────────────────────────────────');
  if (!rows.length) {
    console.log('  Nothing to do — no policy carries a resale name.');
  } else {
    console.log(`| ${pad('SKU', 16)} | ${pad('Legacy Policy Value', 38)} | ${pad('Current Master Value', 26)} | Action`);
    console.log(`|${'-'.repeat(18)}|${'-'.repeat(40)}|${'-'.repeat(28)}|--------`);
    for (const [a, b, c, d] of rows) console.log(`| ${pad(a, 16)} | ${pad(b, 38)} | ${pad(c, 26)} | ${d}`);
  }

  if (plan.noSku.length) {
    console.log('\n── Policies with a resale name but no matching SKU ─────');
    for (const { policy, value } of plan.noSku) {
      console.log(`  policy ${policy._id}  skuId=${policy.skuId}  skuCode=${policy.skuCode || '(blank)'}  value="${value}"`);
    }
  }
  if (plan.conflicts.length) {
    console.log('\n── WARNING: SKUs targeted by conflicting policy values ──');
    for (const c of plan.conflicts) console.log(`  SKU ${c.skuId}: ${JSON.stringify(c.values)}`);
    console.log('  Resolve these by hand — the script would apply whichever policy it reached first.');
  }
};

/** One guarded update. Returns 'written' | 'skipped' — never throws for a no-match. */
const applyOne = async ({ sku, value }, session) => {
  const res = await SKU.updateOne(
    { _id: sku._id, isDeleted: { $ne: true }, ...STILL_EMPTY },
    { $set: { convertedItemNameForResale: value } },
    session ? { session } : {},
  );
  return res.modifiedCount === 1 ? 'written' : 'skipped';
};

const run = async () => {
  // autoIndex:false — importing these models would otherwise have Mongoose build
  // SKU's unique code index and its 4-field text index on connect. On a live
  // collection that is a pointless load event, and a unique build fails outright
  // if any duplicate code exists. A backfill has no business touching indexes.
  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  console.log(`Database : ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(`Mode     : ${DRY_RUN ? 'PREVIEW — no writes will be performed' : 'COMMIT — writes will be performed'}\n`);

  const { plan, totals } = await buildPlan();
  printAnalysis({ plan, totals });

  const summary = {
    before: totals.withLegacy,
    backfilled: 0,
    skippedMasterAlreadySet: plan.skipAlreadySet.length,
    skippedSkuDeleted: plan.skipDeletedSku.length,
    noMatchingSku: plan.noSku.length,
    failed: 0,
  };

  if (DRY_RUN) {
    console.log(`\nPREVIEW — would write ${plan.toWrite.length} SKU(s). NO DATABASE WRITES WERE PERFORMED.`);
    console.log('Re-run with --commit once this plan looks right.');
    await mongoose.disconnect();
    return;
  }

  if (!plan.toWrite.length) {
    console.log('\nNothing to write. Database unchanged.');
    await mongoose.disconnect();
    return;
  }

  // Atlas runs a replica set, so a transaction gives all-or-nothing. A standalone
  // mongod rejects it, and we fall back to guarded per-document updates — every
  // update is independently guarded and idempotent, so a partial run is still
  // correct and simply re-running finishes the rest.
  console.log(`\n── Writing ${plan.toWrite.length} SKU(s) ─────────────────────────────`);
  const failures = [];
  let usedTransaction = false;

  // Inside a transaction, errors MUST propagate untouched: the driver inspects
  // them for the TransientTransactionError label and retries the whole callback.
  // Catching them here (an earlier version did) turns a retryable blip — such as
  // "catalog changes; please retry" — into a hard, unretryable failure.
  // The callback can therefore run more than once, so it owns its own counters.
  const writeAllInTransaction = async (session) => {
    const applied = [];
    for (const item of plan.toWrite) applied.push({ item, outcome: await applyOne(item, session) });
    return applied;
  };

  /** Only a server that cannot do transactions at all — not a transaction that failed. */
  const transactionsUnsupported = (err) => err?.code === 20
    || err?.codeName === 'IllegalOperation'
    || /Transaction numbers are only allowed on a replica set member or mongos/i.test(err?.message || '')
    || /Transactions are not supported/i.test(err?.message || '');

  const session = await mongoose.startSession();
  let applied = null;
  try {
    applied = await session.withTransaction((s) => writeAllInTransaction(s));
    usedTransaction = true;
  } catch (err) {
    if (!transactionsUnsupported(err)) {
      // A genuine failure. The transaction rolled back, so nothing was applied.
      // Do NOT silently retry without one — report and let the operator re-run,
      // which is safe precisely because the script is idempotent.
      console.log(`\nTransaction rolled back — NOTHING was written: ${err.message.split('\n')[0]}`);
      console.log('Nothing is half-applied. Re-run the script to try again.');
      summary.failed = plan.toWrite.length;
      await session.endSession();
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`\nTransactions unavailable on this server (${err.message.split('\n')[0]}).`);
    console.log('Falling back to guarded per-document updates.\n');
    applied = [];
    for (const item of plan.toWrite) {
      try {
        applied.push({ item, outcome: await applyOne(item, null) });
      } catch (e) {
        failures.push({ code: item.sku.code, message: e.message });
        console.log(`  FAIL   ${item.sku.code}  ${e.message}`);
      }
    }
  } finally {
    await session.endSession();
  }

  for (const { item, outcome } of applied) {
    if (outcome === 'written') {
      summary.backfilled += 1;
      console.log(`  WROTE  ${item.sku.code}  "${item.value}"`);
    } else {
      summary.skippedMasterAlreadySet += 1;
      console.log(`  SKIP   ${item.sku.code}  (filled in between the read and the write)`);
    }
  }
  summary.failed = failures.length;

  // ── Verification: re-read from the database, do not trust the counters ──
  console.log('\n── Verification (fresh read) ───────────────────────────');
  const { plan: after, totals: afterTotals } = await buildPlan();
  // $nin: [null, ''] would count a whitespace-only value as populated, which
  // disagrees with clean(). Negating STILL_EMPTY keeps one definition of "empty".
  const populated = await SKU.countDocuments({ isDeleted: { $ne: true }, $nor: [STILL_EMPTY] });
  const overwritten = plan.skipAlreadySet.filter((b) => {
    const now = after.skipAlreadySet.find((a) => String(a.sku._id) === String(b.sku._id));
    return now && clean(now.sku.convertedItemNameForResale) !== clean(b.sku.convertedItemNameForResale);
  });
  const stillPending = after.toWrite.length;

  console.log(`  Policies with a non-empty convertedItemName   : ${afterTotals.withLegacy}  (unchanged: ${afterTotals.withLegacy === totals.withLegacy ? 'YES' : 'NO — investigate'})`);
  console.log(`  SKUs carrying convertedItemNameForResale      : ${populated}`);
  console.log(`  Eligible rows still un-backfilled             : ${stillPending}  (expected 0${failures.length ? ` + ${failures.length} failed` : ''})`);
  console.log(`  Pre-existing master values overwritten        : ${overwritten.length}  (MUST be 0)`);
  console.log(`  Policies without a matching SKU (reported)    : ${after.noSku.length}`);
  console.log(`  SKU documents before / after                  : ${totals.skus} / ${afterTotals.skus}  (no duplicates created: ${totals.skus === afterTotals.skus ? 'YES' : 'NO — investigate'})`);

  console.log('\n── Summary ─────────────────────────────────────────────');
  console.log(`Before:   ${summary.before} legacy resale value(s)`);
  console.log(`Backfilled: ${summary.backfilled}`);
  console.log(`Skipped because master already had a value: ${summary.skippedMasterAlreadySet}`);
  console.log(`Skipped because the SKU is soft-deleted:    ${summary.skippedSkuDeleted}`);
  console.log(`No matching SKU: ${summary.noMatchingSku}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Applied ${usedTransaction ? 'in a transaction' : 'as guarded per-document updates'}.`);
  console.log('InventoryPolicy.convertedItemName was NOT modified — it remains as legacy data.');

  await mongoose.disconnect();
  if (summary.failed > 0 || overwritten.length > 0 || stillPending > 0) process.exit(1);
};

run().catch(async (err) => {
  console.error('\nBackfill failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
