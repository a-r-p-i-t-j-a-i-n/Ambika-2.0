/**
 * COIL LINEAGE — the round numbering and the running remaining weight.
 *
 * What is under test is the ARITHMETIC, not a round-trip through mongod. The
 * derivation was written as pure functions in `coilLineage.js` precisely so the
 * client's worked example can be asserted figure by figure without a database
 * this repo has no harness for — the same reason `coilCircleMap.test.js` next
 * door tests the mapping rather than the endpoint.
 *
 * The expected numbers below are the CLIENT'S, transcribed from the requirement
 * by hand. They are not computed from the implementation: a test that derived
 * its expectations the same way the code does would pass whatever the code did.
 *
 * WHAT IS NOT COVERED HERE, stated plainly:
 *   • that `convert()` refuses an over-cut, a replay or a concurrent cut — all
 *     three are transaction behaviour and need a live mongod with a replica
 *     set. They are exercised against the running API by
 *     `src/scripts/e2eCutCoilsFixture.js`.
 *   • that `getCoilLineage` issues a fixed number of queries — visible in the
 *     source, provable only against a database.
 *   • that the receipt auto-binding picks the right receipt — it is a query,
 *     not a calculation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRounds, sortConversionsForRounds, summariseCoilRow, round2, EPS,
  cuttingStatus, roundStatus, ledgerCoilState, CUT_STATUS, ROUND_STATUS,
} from '../coilLineage.js';

/** A conversion as the collection stores one, with only the fields that matter. */
const cut = (id, date, coilKg, circlesKg, extra = {}) => ({
  _id: id,
  conversionNumber: `RMC-${id}`,
  conversionDate: date,
  createdAt: date,
  coilWeightKg: coilKg,
  circlesWeightKg: circlesKg,
  // Stored by the conversion as coil − circles; reproduced here the same way so
  // the fixture is a real document and not a tidier one than production has.
  scrapKg: round2(coilKg - circlesKg),
  circles: [],
  ...extra,
});

// ── A. One-shot cut ──────────────────────────────────────────────────────────
test('A — a coil cut once in full leaves nothing', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('a', '2026-01-10', 2000, 1900)],
  });

  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].roundNo, 1);
  assert.equal(rounds[0].cutKg, 2000);
  assert.equal(rounds[0].remainingAfterKg, 0);
  assert.equal(totals.remainingKg, 0);
  assert.equal(totals.rounds, 1);
  assert.equal(totals.fullyCut, true);
  assert.equal(totals.overCut, false);
});

// ── B. The client's own example ──────────────────────────────────────────────
test("B — the client's two-round example reproduces figure for figure", () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [
      cut('r1', '2026-01-10', 1000, 950),   // scrap 50
      cut('r2', '2026-01-12', 1000, 970),   // scrap 30
    ],
  });

  assert.equal(rounds.length, 2);

  assert.deepEqual(
    rounds.map((r) => [r.roundNo, r.cutKg, r.circlesKg, r.scrapKg, r.yieldPct, r.remainingAfterKg]),
    [
      [1, 1000, 950, 50, 95, 1000],
      [2, 1000, 970, 30, 97, 0],
    ],
  );

  // Coil total, exactly as the client wrote it down.
  assert.equal(totals.receivedKg, 2000);
  assert.equal(totals.cutKg, 2000);
  assert.equal(totals.circlesKg, 1920);
  assert.equal(totals.scrapKg, 80);
  assert.equal(totals.remainingKg, 0);
  assert.equal(totals.rounds, 2);
});

// ── C. Three uneven rounds ───────────────────────────────────────────────────
test('C — three rounds of different sizes still close the coil out', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [
      cut('c1', '2026-02-01', 500, 475),   // scrap 25
      cut('c2', '2026-02-03', 700, 665),   // scrap 35
      cut('c3', '2026-02-09', 800, 760),   // scrap 40
    ],
  });

  assert.equal(totals.rounds, 3);
  assert.deepEqual(rounds.map((r) => r.remainingAfterKg), [1500, 800, 0]);
  assert.equal(totals.scrapKg, 100);          // 25 + 35 + 40
  assert.equal(totals.remainingKg, 0);
});

// ── D. Partially cut coil ────────────────────────────────────────────────────
test('D — a half-cut coil reports the other half as still on the floor', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('d1', '2026-03-01', 1000, 940)],
  });

  assert.equal(rounds[0].remainingAfterKg, 1000);
  assert.equal(totals.remainingKg, 1000);
  assert.equal(totals.fullyCut, false);
  assert.equal(totals.scrapKg, 60);
});

/**
 * The rule that makes "remaining" mean anything.
 *
 * Remaining subtracts the CUT weight, never the scrap: the circles and the
 * offcut are both carved out of the same kilograms, so deducting both would
 * report a 2,000 kg coil as spent after 1,920 kg of cutting. This is the single
 * easiest thing to get wrong in this feature, so it is asserted directly rather
 * than left implicit in the cases above.
 */
test('remaining subtracts the cut weight only — never the scrap as well', () => {
  const { totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('x', '2026-01-10', 1000, 950)],
  });
  assert.equal(totals.remainingKg, 1000);
  assert.notEqual(totals.remainingKg, 950);                 // circles deducted
  assert.notEqual(totals.remainingKg, 2000 - 1000 - 50);    // scrap double-counted
});

// ── Over-cut: a data fault, reported and not hidden ──────────────────────────
test('a batch cut beyond its receipt reports a negative remainder, not zero', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 1000,
    conversions: [cut('o1', '2026-04-01', 1200, 1100)],
  });

  assert.equal(rounds[0].remainingAfterKg, -200);
  assert.equal(totals.remainingKg, -200);
  assert.equal(totals.overCut, true);
  assert.equal(totals.fullyCut, false);
});

// ── Round ORDER is deterministic, which is what lets it go unstored ──────────
test('rounds are numbered by date, then by entry time, then by id', () => {
  // Two cuts on the SAME day — the common case on a busy shift, and the one a
  // date-only sort cannot resolve.
  const sameDay = [
    { _id: 'bbb', conversionDate: '2026-05-01', createdAt: '2026-05-01T14:00:00Z' },
    { _id: 'aaa', conversionDate: '2026-05-01', createdAt: '2026-05-01T09:00:00Z' },
  ];
  assert.deepEqual(sortConversionsForRounds(sameDay).map((c) => c._id), ['aaa', 'bbb']);

  // Same day AND same keystroke timestamp — the id is the last resort, and it
  // must be used, because an unstable order would renumber the rounds between
  // two reads of the same page.
  const identical = [
    { _id: 'zzz', conversionDate: '2026-05-01', createdAt: '2026-05-01T09:00:00Z' },
    { _id: 'aaa', conversionDate: '2026-05-01', createdAt: '2026-05-01T09:00:00Z' },
  ];
  assert.deepEqual(sortConversionsForRounds(identical).map((c) => c._id), ['aaa', 'zzz']);

  // The input array is never mutated — the caller's documents are its own.
  const input = [cut('b', '2026-05-02', 10, 9), cut('a', '2026-05-01', 10, 9)];
  sortConversionsForRounds(input);
  assert.deepEqual(input.map((c) => c._id), ['b', 'a']);
});

test('a coil whose cuts arrive out of order is still numbered chronologically', () => {
  const { rounds } = deriveRounds({
    receivedKg: 2000,
    conversions: [
      cut('late', '2026-01-12', 1000, 970),
      cut('early', '2026-01-10', 1000, 950),
    ],
  });
  assert.deepEqual(rounds.map((r) => [r.roundNo, r.conversionId]), [[1, 'early'], [2, 'late']]);
  assert.deepEqual(rounds.map((r) => r.remainingAfterKg), [1000, 0]);
});

// ── The scrap record rides along without a query per round ───────────────────
test('each round carries its scrap record, its disposition and its stock movement', () => {
  const scrapByConversionId = new Map([
    ['r1', { _id: 's1', disposition: 'DONE', location: 'PLG01', stockMovementId: 'mov1', batchStatus: 'CUT' }],
    // Round 2 is job work: the offcut stayed with the job worker, so there is
    // deliberately NO stock movement for it.
    ['r2', { _id: 's2', disposition: 'JOB_WORK', location: 'JW001', stockMovementId: null, batchStatus: 'CUT' }],
  ]);
  const { rounds } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('r1', '2026-01-10', 1000, 950), cut('r2', '2026-01-12', 1000, 970)],
    scrapByConversionId,
  });

  assert.equal(rounds[0].scrapRecordId, 's1');
  assert.equal(rounds[0].location, 'PLG01');
  assert.equal(rounds[0].scrapStockMovementId, 'mov1');
  assert.equal(rounds[1].disposition, 'JOB_WORK');
  assert.equal(rounds[1].scrapStockMovementId, null);
});

test('a round with no scrap record reports nulls rather than inventing a state', () => {
  const { rounds } = deriveRounds({
    receivedKg: 1000,
    conversions: [cut('n1', '2026-01-10', 500, 470)],
  });
  assert.equal(rounds[0].scrapRecordId, null);
  assert.equal(rounds[0].disposition, null);
  assert.equal(rounds[0].location, null);
  // The scrap WEIGHT still reads, because that lives on the conversion.
  assert.equal(rounds[0].scrapKg, 30);
});

// ── An uncut coil ────────────────────────────────────────────────────────────
test('a coil that has never been cut is whole, with no rounds and no yield', () => {
  const { rounds, totals } = deriveRounds({ receivedKg: 2000, conversions: [] });
  assert.deepEqual(rounds, []);
  assert.equal(totals.cutKg, 0);
  assert.equal(totals.scrapKg, 0);
  assert.equal(totals.remainingKg, 2000);
  assert.equal(totals.rounds, 0);
  // Not 0% and not 100% — nothing was cut, so there is no yield to report.
  assert.equal(totals.avgYieldPct, null);
  assert.equal(totals.scrapPct, null);
});

// ── Coil-level yield is WEIGHTED, not the mean of the rounds ─────────────────
test('coil yield weights each round by how much it actually cut', () => {
  const { totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [
      cut('big', '2026-06-01', 1900, 1824),  // 96%
      cut('small', '2026-06-02', 100, 80),   // 80%
    ],
  });
  // 1904 / 2000 — NOT (96 + 80) / 2 = 88, which would damn a good coil on the
  // strength of one small round.
  assert.equal(totals.avgYieldPct, 95.2);
});

// ── Rounding: kilograms are carried to two places, consistently ──────────────
test('fractional weights accumulate without drifting', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 1000.5,
    conversions: [
      cut('f1', '2026-07-01', 333.33, 316.66),
      cut('f2', '2026-07-02', 333.33, 316.67),
      cut('f3', '2026-07-03', 333.34, 316.68),
    ],
  });
  assert.equal(rounds[2].remainingAfterKg, 0.5);
  assert.equal(totals.cutKg, 1000);
  assert.equal(totals.remainingKg, 0.5);
  assert.ok(Math.abs(totals.circlesKg - 950.01) < EPS);
});

/* ══ SCRAP BY PHYSICAL COIL ════════════════════════════════════════════════ */

// ── H. Two physical coils of the same grade stay apart ───────────────────────
test('H — two coils of one SKU keep entirely separate scrap totals', () => {
  // The whole reason the grouping key is the receipt id and not the SKU code.
  const coilA = summariseCoilRow({ receivedKg: 2000, cutKg: 2000, circlesKg: 1920, scrapKg: 80, rounds: 2 });
  const coilB = summariseCoilRow({ receivedKg: 1500, cutKg: 1000, circlesKg: 940, scrapKg: 60, rounds: 1 });

  assert.equal(coilA.scrapKg, 80);
  assert.equal(coilA.remainingKg, 0);
  assert.equal(coilA.rounds, 2);

  assert.equal(coilB.scrapKg, 60);
  assert.equal(coilB.remainingKg, 500);
  assert.equal(coilB.rounds, 1);
});

test('scrap percentage is measured against what was cut, not what arrived', () => {
  // Half the coil is still on the floor. Dividing by the arrival weight would
  // report 3% and flatter a cut that actually ran at 6% scrap.
  const row = summariseCoilRow({ receivedKg: 2000, cutKg: 1000, circlesKg: 940, scrapKg: 60, rounds: 1 });
  assert.equal(row.scrapPct, 6);
  assert.equal(row.avgYieldPct, 94);
  assert.equal(row.remainingKg, 1000);
});

test('a coil row with no receipt behind it reports no remainder rather than a wrong one', () => {
  // What a soft-deleted receipt looks like: the cuts are known, the arrival
  // weight is not. Remaining goes negative-by-construction, so the service
  // flags `receiptMissing` and the screen explains it instead of showing a
  // confident number nobody can act on.
  const row = summariseCoilRow({ receivedKg: 0, cutKg: 1000, circlesKg: 950, scrapKg: 50, rounds: 1 });
  assert.equal(row.scrapKg, 50);
  assert.equal(row.scrapPct, 5);
  assert.equal(row.remainingKg, -1000);
});

// ── J. Historical rows are not attributed to a coil ──────────────────────────
test('J — an unlinked historical cut contributes nothing to any coil row', () => {
  // The aggregation groups on `coilReceiptId`, so a null one falls into its own
  // bucket. This asserts the arithmetic that bucket is summarised with; that
  // the GROUPING puts it there is a Mongo `$group` property, not ours.
  const untraceable = summariseCoilRow({ receivedKg: 0, cutKg: 3000, circlesKg: 2850, scrapKg: 150, rounds: 4 });
  assert.equal(untraceable.scrapKg, 150);
  assert.equal(untraceable.rounds, 4);
  // No receipt, so no claim is made about how much coil is left anywhere.
  assert.equal(untraceable.receivedKg, 0);
});

test('an empty coil row is all zeroes and no percentages', () => {
  const row = summariseCoilRow();
  assert.equal(row.scrapKg, 0);
  assert.equal(row.cutKg, 0);
  assert.equal(row.scrapPct, null);
  assert.equal(row.avgYieldPct, null);
});

// ── M. Multi-round cutting: status is DERIVED, never chosen ──────────────────
// The figures are the multi-round requirement's own, transcribed by hand.

test('M1 — status: nothing cut is NOT CUT, some left is PARTIALLY, none left is FULLY', () => {
  assert.equal(cuttingStatus({ cutKg: 0, remainingKg: 2000 }), CUT_STATUS.NOT_CUT);
  assert.equal(cuttingStatus({ cutKg: 1000, remainingKg: 1000 }), CUT_STATUS.PARTIALLY_CUT);
  assert.equal(cuttingStatus({ cutKg: 2000, remainingKg: 0 }), CUT_STATUS.FULLY_CUT);
  // Float noise on a sum of kilograms is not metal on the floor.
  assert.equal(cuttingStatus({ cutKg: 2000, remainingKg: 0.0004 }), CUT_STATUS.FULLY_CUT);
  // An over-cut coil has nothing left to cut — FULLY CUT, reported as overCut elsewhere.
  assert.equal(cuttingStatus({ cutKg: 2200, remainingKg: -200 }), CUT_STATUS.FULLY_CUT);
});

test('M2 — round 1 of 2: 2,000 kg coil, 1,000 cut → 1,000 left, PARTIALLY CUT, 1 round', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('r1', '2026-10-07', 1000, 850)],
  });
  assert.equal(totals.remainingKg, 1000);
  assert.equal(totals.status, CUT_STATUS.PARTIALLY_CUT);
  assert.equal(totals.rounds, 1);
  assert.equal(rounds[0].status, ROUND_STATUS.PARTIAL);
  assert.equal(rounds[0].scrapKg, 150);
  assert.equal(rounds[0].yieldPct, 85);
});

test('M3 — round 2 of the SAME coil finishes it: 2,000 cut, 0 left, FULLY CUT, 2 rounds', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('r2', '2026-10-08', 1000, 820), cut('r1', '2026-10-07', 1000, 850)],
  });
  assert.deepEqual(rounds.map((r) => r.conversionId), ['r1', 'r2']);
  assert.deepEqual(rounds.map((r) => r.remainingAfterKg), [1000, 0]);
  assert.deepEqual(rounds.map((r) => r.status), [ROUND_STATUS.PARTIAL, ROUND_STATUS.FULLY_CUT]);
  // Each round's scrap and yield are its OWN — never against the original coil.
  assert.deepEqual(rounds.map((r) => r.scrapKg), [150, 180]);
  assert.deepEqual(rounds.map((r) => r.yieldPct), [85, 82]);
  assert.equal(totals.cutKg, 2000);
  assert.equal(totals.remainingKg, 0);
  assert.equal(totals.status, CUT_STATUS.FULLY_CUT);
  assert.equal(totals.rounds, 2);
  assert.equal(totals.circlesKg, 1670);
  assert.equal(totals.scrapKg, 330);
});

test('M4 — four rounds 500 / 700 / 300 / 500 of a 2,000 kg coil', () => {
  const { rounds, totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [
      cut('a', '2026-10-01', 500, 450),
      cut('b', '2026-10-02', 700, 600),
      cut('c', '2026-10-03', 300, 250),
      cut('d', '2026-10-04', 500, 430),
    ],
  });
  assert.deepEqual(rounds.map((r) => r.roundNo), [1, 2, 3, 4]);
  assert.deepEqual(rounds.map((r) => r.remainingAfterKg), [1500, 800, 500, 0]);
  assert.deepEqual(rounds.map((r) => r.status), ['PARTIAL', 'PARTIAL', 'PARTIAL', 'FULLY_CUT']);
  assert.equal(totals.cutKg, 2000);
  assert.equal(totals.remainingKg, 0);
  assert.equal(totals.status, CUT_STATUS.FULLY_CUT);
  assert.equal(totals.rounds, 4);
});

test('M5 — coil yield is WEIGHTED: 850/1,000 + 400/500 is 83.33%, not the 82.5% mean', () => {
  const { totals } = deriveRounds({
    receivedKg: 2000,
    conversions: [cut('a', '2026-10-01', 1000, 850), cut('b', '2026-10-02', 500, 400)],
  });
  assert.equal(totals.avgYieldPct, 83.33);
  assert.notEqual(totals.avgYieldPct, 82.5);
  // The summary row the history list is built from says the same.
  const row = summariseCoilRow({ receivedKg: 2000, cutKg: 1500, circlesKg: 1250, scrapKg: 250, rounds: 2 });
  assert.equal(row.avgYieldPct, 83.33);
  assert.equal(row.remainingKg, 500);
  assert.equal(row.status, CUT_STATUS.PARTIALLY_CUT);
});

test('M6 — round status helper', () => {
  assert.equal(roundStatus(1), ROUND_STATUS.PARTIAL);
  assert.equal(roundStatus(0), ROUND_STATUS.FULLY_CUT);
  assert.equal(roundStatus(-50), ROUND_STATUS.FULLY_CUT);
});

test('M7 — the ledger view: a coil with only its rounds reconciles exactly', () => {
  const s = ledgerCoilState({ receivedKg: 2000, roundsCutKg: 1000, ledgerAvailableKg: 1000 });
  assert.deepEqual(s, {
    availableKg: 1000, consumedKg: 1000, otherOutKg: 0, status: CUT_STATUS.PARTIALLY_CUT, overCut: false,
  });
});

test('M8 — a spreadsheet-era coil with NO linked rounds is not "not cut" when its ledger says it is gone', () => {
  // 2,000 received; the historical import consumed it without naming the receipt.
  const s = ledgerCoilState({ receivedKg: 2000, roundsCutKg: 0, ledgerAvailableKg: 0 });
  assert.equal(s.status, CUT_STATUS.FULLY_CUT);
  assert.equal(s.otherOutKg, 2000);   // reported, never turned into a round
  assert.equal(s.availableKg, 0);
});

test('M9 — an over-cut (allow negative) is FULLY CUT with overCut set', () => {
  const s = ledgerCoilState({ receivedKg: 2000, roundsCutKg: 2200, ledgerAvailableKg: -200 });
  assert.equal(s.status, CUT_STATUS.FULLY_CUT);
  assert.equal(s.overCut, true);
  assert.equal(s.otherOutKg, 0);
});

test('M10 — an untouched coil is NOT CUT', () => {
  const s = ledgerCoilState({ receivedKg: 2000, roundsCutKg: 0, ledgerAvailableKg: 2000 });
  assert.equal(s.status, CUT_STATUS.NOT_CUT);
});
