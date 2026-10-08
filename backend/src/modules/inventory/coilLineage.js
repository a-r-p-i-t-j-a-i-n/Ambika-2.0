/**
 * Coil lineage — turning the existing records into "what happened to THIS coil".
 *
 * ── WHY THIS FILE IS PURE ────────────────────────────────────────────────────
 * Everything below is arithmetic over documents the caller has already read. It
 * touches no model, opens no session and knows nothing about Mongo, which is
 * what lets the client's own worked example be asserted line by line in
 * `__tests__/coilLineage.test.js` — this repo has no database harness, and the
 * rounding rule in here is exactly the kind of thing that must not go untested.
 *
 * ── THE ONE RULE THAT KEEPS THIS HONEST ─────────────────────────────────────
 * NOTHING here is stored. There is deliberately no `cuttingRoundNo` column and
 * no `remainingAfterKg` column, because either one would be a second answer to
 * a question the ledger already answers, free to drift from it the first time a
 * conversion is corrected or soft-deleted. The round number is a POSITION in a
 * deterministic ordering, and the remaining weight is a SUBTRACTION. Both are
 * recomputed on every read, from:
 *
 *     the GRN_IN movement   — how much physically arrived
 *     its CoilConversions   — how much was cut, each time (coilWeightKg)
 *     their ScrapRecords    — what each cut left behind
 *
 * ── WHY REMAINING SUBTRACTS THE CUT, NOT THE SCRAP ──────────────────────────
 * A cut's `coilWeightKg` is the whole weight fed into the machine, and the
 * circles and the offcut are both carved out of it:
 *
 *     cutKg = circlesKg + scrapKg
 *
 * So remaining is `received − Σ cut`. Subtracting scrap as well would deduct
 * the same kilograms twice and report a 2,000 kg coil as exhausted after
 * 1,920 kg of cutting. This mirrors the ledger, where the conversion posts a
 * CONVERT_OUT for the FULL coil weight and returns the offcut to a different
 * sku (the scrap one) — see the header of scrapRecord.model.js.
 */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Float noise on a sum of kilograms, not a real balance. The same epsilon
 * `listReceivedCoils` already uses, so "fully cut" means the same thing in the
 * picker and on the lineage screen.
 */
export const EPS = 0.001;

/**
 * Where a physical coil stands — NOT CUT, PARTIALLY CUT or FULLY CUT.
 *
 * Derived, never chosen and never stored. An operator who could tick "fully
 * cut" could tick it on a coil with 400 kg still on the floor; the quantities
 * cannot lie that way. The caller decides WHICH quantities: the rounds alone
 * (`deriveRounds`), or the batch's own ledger, which also sees weight that left
 * the coil without naming it — the historical spreadsheet cuts, an adjustment
 * (see `ledgerCoilState` below).
 *
 * Over-cutting (remaining < 0, only possible with "allow negative") is FULLY
 * CUT — there is nothing left to cut — and is reported separately as `overCut`
 * rather than as a fourth status.
 */
export const CUT_STATUS = Object.freeze({
  NOT_CUT: 'NOT_CUT',
  PARTIALLY_CUT: 'PARTIALLY_CUT',
  FULLY_CUT: 'FULLY_CUT',
});

export const cuttingStatus = ({ cutKg = 0, remainingKg = 0 } = {}) => {
  if (round2(cutKg) <= EPS) return CUT_STATUS.NOT_CUT;
  if (round2(remainingKg) > EPS) return CUT_STATUS.PARTIALLY_CUT;
  return CUT_STATUS.FULLY_CUT;
};

/**
 * One ROUND's status: did this cut leave anything on the coil? Only two
 * answers — a round by definition cut something.
 */
export const ROUND_STATUS = Object.freeze({ PARTIAL: 'PARTIAL', FULLY_CUT: 'FULLY_CUT' });
export const roundStatus = (remainingAfterKg) => (
  round2(remainingAfterKg) > EPS ? ROUND_STATUS.PARTIAL : ROUND_STATUS.FULLY_CUT
);

/**
 * The coil as the LEDGER sees it, beside what its rounds account for.
 *
 * For a coil whose only movements are its receipt and its rounds the two agree
 * exactly. Every coil received before the lineage existed does not: its batch
 * carries the spreadsheet's CONVERT_OUT / ADJUST_OUT rows, which consumed the
 * coil but name no receipt. Those are NOT turned into rounds — that would be
 * inventing lineage — but they did happen, so they are reported as
 * `otherOutKg`, and status and "available" follow the ledger, which is also the
 * figure `convert()` validates a new cut against.
 *
 *   received = cutInRounds + otherOut + available
 */
export const ledgerCoilState = ({ receivedKg = 0, roundsCutKg = 0, ledgerAvailableKg = 0 } = {}) => {
  const received = round2(receivedKg);
  const available = round2(ledgerAvailableKg);
  const roundsCut = round2(roundsCutKg);
  const consumed = round2(received - available);
  return {
    availableKg: available,
    consumedKg: consumed,
    otherOutKg: round2(consumed - roundsCut),
    status: cuttingStatus({ cutKg: consumed, remainingKg: available }),
    overCut: available < -EPS,
  };
};

const time = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * The order the rounds happened in.
 *
 * `conversionDate` is a DAY, typed by the operator, so two cuts of one coil on
 * one shift tie on it constantly — and a tie decided by Mongo's natural order
 * would renumber the rounds between two reads of the same page. So the sort
 * falls through to `createdAt` (when the cut was actually keyed in) and finally
 * to the id, which is unique and monotonic by construction. The result is total
 * and stable: the same coil always numbers its rounds the same way.
 */
export const sortConversionsForRounds = (conversions = []) => [...conversions].sort((a, b) => (
  time(a.conversionDate) - time(b.conversionDate)
  || time(a.createdAt) - time(b.createdAt)
  || String(a._id).localeCompare(String(b._id))
));

/**
 * One coil's complete cutting history.
 *
 * @param receivedKg   the GRN_IN quantity — what physically arrived.
 * @param conversions  every CoilConversion carrying this receipt's id.
 * @param scrapByConversionId  Map<conversionId, ScrapRecord>, so the scrap
 *        state rides along without a query per round (see the service).
 */
export const deriveRounds = ({ receivedKg = 0, conversions = [], scrapByConversionId = new Map() } = {}) => {
  const received = round2(receivedKg);
  const ordered = sortConversionsForRounds(conversions);

  let cumulativeCut = 0;
  const rounds = ordered.map((c, i) => {
    const cutKg = round2(c.coilWeightKg);
    const circlesKg = round2(c.circlesWeightKg);
    // Taken from the conversion rather than recomputed as cut − circles: the
    // conversion is what the ledger and the Scrap register were both written
    // from, so recomputing it here would be a second opinion nobody asked for.
    const scrapKg = round2(c.scrapKg);
    cumulativeCut = round2(cumulativeCut + cutKg);
    const remainingAfterKg = round2(received - cumulativeCut);

    const scrap = scrapByConversionId.get(String(c._id)) || null;

    return {
      roundNo: i + 1,
      conversionId: c._id,
      conversionNumber: c.conversionNumber || '',
      date: c.conversionDate || null,
      cutKg,
      circles: (c.circles || []).map((x) => ({
        circleSkuId: x.circleSkuId,
        skuCode: x.circleSkuCode || '',
        itemName: x.circleSkuName || '',
        sizeLabel: x.sizeLabel || '',
        // Circles are STOCKED in pieces and only WEIGHED for yield. Both are
        // carried, named for what they are, so nothing downstream can add a
        // piece count to a kilogram figure.
        pcs: Number(x.pcs || 0),
        weightKg: round2(x.weightKg),
        movementNumber: x.movementNumber || '',
      })),
      circlesKg,
      scrapKg,
      yieldPct: cutKg > 0 ? round2((circlesKg / cutKg) * 100) : null,
      // Derived, never stored. Can go NEGATIVE where more was cut from a batch
      // than ever arrived — that is a real data fault and the screen says so
      // rather than clamping it to zero and hiding it.
      remainingAfterKg,
      // Partial while this round left metal on the coil, Fully Cut on the round
      // that finished it. The same subtraction, never stored.
      status: roundStatus(remainingAfterKg),
      // What the operator CHOSE for the round (FULL / PARTIAL), as stored on
      // the conversion — the one figure here that is not derived, because
      // intent cannot be recovered from weights. Null where it was never
      // captured (every cut made before it existed); never guessed.
      cuttingType: c.cuttingType || null,

      scrapRecordId: scrap?._id || null,
      disposition: scrap?.disposition || null,
      // The cutting location, off the scrap record — it decides whether the
      // offcut became stock Ambika holds (PLG01) or stayed with the job worker.
      location: scrap?.location || null,
      scrapStockMovementId: scrap?.stockMovementId || null,
      batchStatus: scrap?.batchStatus || null,

      coilMovementNumber: c.coilMovementNumber || '',
    };
  });

  const cutKg = cumulativeCut;
  const circlesKg = round2(rounds.reduce((s, r) => s + r.circlesKg, 0));
  const scrapKg = round2(rounds.reduce((s, r) => s + r.scrapKg, 0));
  const remainingKg = round2(received - cutKg);

  return {
    rounds,
    totals: {
      receivedKg: received,
      cutKg,
      circlesKg,
      scrapKg,
      remainingKg,
      /**
       * Yield for the COIL, weighted by how much each round actually cut —
       * circles ÷ cut, not the mean of the per-round percentages. A 1,900 kg
       * round at 96% and a 100 kg round at 80% is a 95.2% coil, and the plain
       * mean would call it 88%.
       *
       * Deliberately NOT the same figure as the Scrap dashboard's `avgYield`,
       * which averages per CUT across many coils and must stay comparable with
       * the client's Summary Scrap sheet. Different question, different number.
       */
      avgYieldPct: cutKg > 0 ? round2((circlesKg / cutKg) * 100) : null,
      scrapPct: cutKg > 0 ? round2((scrapKg / cutKg) * 100) : null,
      rounds: rounds.length,
      // What the ROUNDS say. The lineage service adds the ledger's view
      // (`ledgerCoilState`) beside it.
      status: cuttingStatus({ cutKg, remainingKg }),
      fullyCut: remainingKg <= EPS && remainingKg >= -EPS,
      // More cut than received. Reported, never hidden.
      overCut: remainingKg < -EPS,
    },
  };
};

/**
 * One row of "scrap by physical coil".
 *
 * Same arithmetic as `deriveRounds`, from figures a `$group` has already
 * summed, so the aggregation and the drill-down can never disagree about a
 * coil's scrap.
 */
export const summariseCoilRow = ({ receivedKg = 0, cutKg = 0, circlesKg = 0, scrapKg = 0, rounds = 0 } = {}) => {
  const received = round2(receivedKg);
  const cut = round2(cutKg);
  const scrap = round2(scrapKg);
  const circles = round2(circlesKg);
  return {
    receivedKg: received,
    cutKg: cut,
    circlesKg: circles,
    scrapKg: scrap,
    // Scrap as a share of what was CUT, not of what arrived: a coil half of
    // which is still on the floor has not yet had a chance to scrap the rest,
    // and dividing by the arrival weight would flatter it.
    scrapPct: cut > 0 ? round2((scrap / cut) * 100) : null,
    remainingKg: round2(received - cut),
    avgYieldPct: cut > 0 ? round2((circles / cut) * 100) : null,
    rounds,
    status: cuttingStatus({ cutKg: cut, remainingKg: received - cut }),
  };
};

export default {
  deriveRounds, sortConversionsForRounds, summariseCoilRow, cuttingStatus, roundStatus, ledgerCoilState,
  CUT_STATUS, ROUND_STATUS, round2, EPS,
};
