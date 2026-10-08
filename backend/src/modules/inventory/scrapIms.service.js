import mongoose from 'mongoose';
import ScrapRecord, { SCRAP_LOCATIONS, SCRAP_DISPOSITIONS } from './scrapRecord.model.js';
import CoilConversion from './coilConversion.model.js';
import InventoryStock from './inventoryStock.model.js';
import InventoryMovement, { TXN_TYPE } from './inventoryMovement.model.js';
import { inventoryService } from './inventory.service.js';
import { resolveScrapSku, SCRAP_UNIT } from './scrapSku.js';
// The same arithmetic the coil lineage screen uses, so a coil's scrap, yield
// and remaining weight read identically whether you arrive from this list or
// from the drill-down. Pure and unit-tested — see coilLineage.js.
import { summariseCoilRow } from './coilLineage.js';
import { SCRAP_IN_REASONS, SCRAP_OUT_REASONS } from './scrapIms.validation.js';
// Scrap Out's quantity-in-a-unit and buyer rules — one pure copy, shared with
// the Joi schema so the stock check and the write convert the same way.
import { resolveScrapQuantity, buyerRequiredFor } from './scrapUom.js';
import ScrapBuyer from './scrapBuyer.model.js';
import { toBuyerSnapshot } from './scrapBuyer.service.js';
import { toScrapOutHistoryRow } from './scrapOutHistory.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * Scrap IMS service — what each coil cut left behind, and what was decided
 * about it.
 *
 * ── TWO THINGS, KEPT APART ──────────────────────────────────────────────────
 * This service covers both halves of scrap, and they are deliberately not the
 * same number:
 *
 *   PRODUCTION SCRAP — the ScrapRecord register below. One row per cut: how
 *   much was left over, at what yield, and whether it was checked. This is a
 *   manufacturing measure, comparable with the client's Summary Scrap sheet.
 *   Nothing that is not a cut is ever written here, which is why every figure
 *   this register reports is identical to what it reported before scrap had a
 *   balance at all.
 *
 *   SCRAP STOCK — the balance, held against one scrap SKU in InventoryStock
 *   and moved only through InventoryMovement, exactly like every other item in
 *   the business. Fed by manual Scrap In, drained by manual Scrap Out, and
 *   topped up automatically by in-house cuts.
 *
 * The two meet in one place: an in-house (PLG01) cut writes a ScrapRecord AND
 * posts a SCRAP_IN, linked by `stockMovementId`. A job-work (JW001) cut writes
 * the record only — those offcuts stayed with the job worker and were never
 * stock Ambika held.
 *
 * Scrap carries no rate anywhere in the client's source, so every scrap
 * movement is quantity-only: unitCost and lineValue stay zero and scrap stock
 * values at nil. That is a recorded gap, not an oversight.
 *
 * ── THE ONE RULE THAT KEEPS EVERY FIGURE HONEST ─────────────────────────────
 * Fifteen rows of the client's sheet are coils that were never cut. Their
 * circle weight is blank, so the sheet's own `coil − circles` formula reports
 * the ENTIRE coil as scrap. Every quantity this service returns therefore
 * excludes batchStatus UNCUT, and reports their count separately instead.
 * Include them and scrap reads 287,489 kg instead of the true 246,674 kg.
 *
 * ── PLG01 vs JW001 ──────────────────────────────────────────────────────────
 * Both are reported, always split. JW001 is job-work cutting: the offcuts stay
 * with the job worker and never become stock Ambika holds, so its scrap is a
 * yield measurement, not an asset. PLG01 is in-house and is the only scrap the
 * company physically has.
 *
 * That split is now load-bearing, not just descriptive: it decides which cuts
 * create stock. The evidence is the data itself — of 246,679 kg of recorded
 * scrap, 229,774 kg is JW001. Stocking all of it would invent a quarter of a
 * million kilograms the company never held.
 */

export const SCRAP_SOURCE = 'EXCEL_RM_24_25';
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * Intersect a filter with one batch status.
 *
 * Only a cut coil produced scrap, so every scrap aggregate in this file is
 * narrowed to CUT. But the caller can filter the register to UNCUT, and CUT and
 * UNCUT are disjoint — so that narrowing must never overwrite a status the
 * caller already chose. Spreading a { batchStatus: 'CUT' } constant last did
 * exactly that: a register filtered to UNCUT still reported the whole CUT set's
 * 246,674 kg beside its 15 uncut rows. An empty $in matches nothing, which is
 * the truthful answer: no batch is both.
 */
const onlyStatus = (filter, status) => ({
  ...filter,
  batchStatus: !filter.batchStatus || filter.batchStatus === status ? status : { $in: [] },
});

/** Scrap the company physically holds — in-house cutting only. */
export const isPhysicalScrap = (location) => location === 'PLG01';

/** Turn a query string into a Mongo filter. Shared by overview and dashboard. */
const buildFilter = (query = {}) => {
  const filter = { isDeleted: { $ne: true } };
  if (query.location) filter.location = query.location;
  if (query.disposition) filter.disposition = query.disposition;
  if (query.batchStatus) filter.batchStatus = query.batchStatus;
  if (query.coilSkuCode) filter.coilSkuCode = String(query.coilSkuCode).trim().toUpperCase();
  if (query.from || query.to) {
    filter.scrapDate = {};
    if (query.from) filter.scrapDate.$gte = new Date(`${query.from}T00:00:00.000+05:30`);
    if (query.to) filter.scrapDate.$lte = new Date(`${query.to}T23:59:59.999+05:30`);
  }
  if (query.search) {
    const r = rx(query.search);
    filter.$or = [{ batchNo: r }, { coilSkuCode: r }, { coilSkuName: r }, { conversionNumber: r }];
  }
  return filter;
};

/**
 * Turn a query string into a ledger filter on the scrap SKU. Shared by Scrap
 * movement and Scrap Out history, so a date range or a search means the same
 * thing on both screens.
 */
const buildMovementFilter = (skuId, query = {}) => {
  const filter = { skuId, isDeleted: { $ne: true } };
  if (query.warehouse) filter.warehouse = query.warehouse;
  if (query.txnType) filter.txnType = query.txnType;
  if (query.from || query.to) {
    filter.movementDate = {};
    if (query.from) filter.movementDate.$gte = new Date(`${query.from}T00:00:00.000+05:30`);
    if (query.to) filter.movementDate.$lte = new Date(`${query.to}T23:59:59.999+05:30`);
  }
  if (query.buyerId) filter['buyer.buyerId'] = new mongoose.Types.ObjectId(String(query.buyerId));
  if (query.search) {
    const r = rx(query.search);
    // partyName already holds the buyer's name on every sale; the snapshot
    // adds the code, phone and GSTIN someone may search by instead.
    filter.$or = [
      { movementNumber: r }, { refNumber: r }, { partyName: r }, { remarks: r },
      { 'buyer.code': r }, { 'buyer.phone': r }, { 'buyer.gstNo': r },
    ];
  }
  return filter;
};

export const scrapImsService = {
  SCRAP_LOCATIONS,
  SCRAP_DISPOSITIONS,

  /**
   * The scrap register — every recorded cut, filtered, with totals.
   *
   * The rows returned are a PAGE; the summary is not. It comes from its own
   * aggregation over the whole filtered set, so "scrap generated" never
   * silently describes only the newest page. (The RM conversion screen shipped
   * with exactly that bug and it was an order of magnitude out.)
   */
  async getOverview(query = {}) {
    const filter = buildFilter(query);
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 500);

    const [docs, total, summary] = await Promise.all([
      ScrapRecord.find(filter).sort({ scrapDate: -1, batchNo: 1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      ScrapRecord.countDocuments(filter),
      this._summarise(filter),
    ]);

    return {
      docs: docs.map((d) => ({ ...d, isPhysicalScrap: isPhysicalScrap(d.location) })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary,
    };
  },

  /**
   * Totals over a filter. Scrap quantities count CUT batches only; the uncut
   * ones are counted separately so they are visible but never added in.
   */
  async _summarise(filter) {
    const [agg, uncut, byLoc] = await Promise.all([
      ScrapRecord.aggregate([
        { $match: onlyStatus(filter, 'CUT') },
        {
          $group: {
            _id: null,
            scrapKg: { $sum: '$scrapKg' },
            coilKg: { $sum: '$coilWeightKg' },
            circlesKg: { $sum: '$circlesWeightKg' },
            avgYield: { $avg: '$yieldRatioPct' },
            batches: { $sum: 1 },
          },
        },
      ]),
      ScrapRecord.countDocuments(onlyStatus(filter, 'UNCUT')),
      ScrapRecord.aggregate([
        { $match: onlyStatus(filter, 'CUT') },
        { $group: { _id: '$location', scrapKg: { $sum: '$scrapKg' }, batches: { $sum: 1 }, avgYield: { $avg: '$yieldRatioPct' } } },
      ]),
    ]);

    const a = agg[0] || {};
    const loc = {};
    for (const l of SCRAP_LOCATIONS) {
      const row = byLoc.find((x) => x._id === l);
      loc[l] = {
        scrapKg: round2(row?.scrapKg || 0),
        batches: row?.batches || 0,
        avgYield: round2(row?.avgYield || 0),
        isPhysicalScrap: isPhysicalScrap(l),
      };
    }

    return {
      // Scrap that actually exists, from coils that were actually cut.
      scrapKg: round2(a.scrapKg || 0),
      coilKg: round2(a.coilKg || 0),
      circlesKg: round2(a.circlesKg || 0),
      avgYield: round2(a.avgYield || 0),
      batchesCut: a.batches || 0,
      byLocation: loc,
      // In-house scrap is the only scrap the company holds. Reported, but NO
      // stock is created from it and no availability rule is applied.
      inHouseScrapKg: loc.PLG01.scrapKg,
      jobWorkScrapKg: loc.JW001.scrapKg,
      // Coils recorded in the scrap sheet that were never cut. NOT scrap.
      uncutBatches: uncut,
    };
  },

  /** KPIs and breakdowns for the Scrap dashboard. */
  async getDashboard(query = {}) {
    const filter = buildFilter(query);
    const cut = onlyStatus(filter, 'CUT');

    const [summary, byDisposition, byCoil, monthly, uncutRows] = await Promise.all([
      this._summarise(filter),
      ScrapRecord.aggregate([
        { $match: filter },
        { $group: { _id: { d: '$disposition', l: '$location' }, n: { $sum: 1 }, scrapKg: { $sum: '$scrapKg' } } },
        { $sort: { n: -1 } },
      ]),
      ScrapRecord.aggregate([
        { $match: cut },
        {
          $group: {
            _id: { code: '$coilSkuCode', name: '$coilSkuName' },
            scrapKg: { $sum: '$scrapKg' }, coilKg: { $sum: '$coilWeightKg' },
            batches: { $sum: 1 }, avgYield: { $avg: '$yieldRatioPct' },
          },
        },
        { $sort: { scrapKg: -1 } },
      ]),
      ScrapRecord.aggregate([
        { $match: cut },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$scrapDate', timezone: 'Asia/Kolkata' } },
            scrapKg: { $sum: '$scrapKg' }, batches: { $sum: 1 }, avgYield: { $avg: '$yieldRatioPct' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Listed in full — there are only a handful and each one is a coil that
      // someone should look at, not a number to bury in a total.
      ScrapRecord.find(onlyStatus(filter, 'UNCUT'))
        .select('batchNo scrapDate location coilSkuCode coilSkuName coilWeightKg disposition')
        .sort({ scrapDate: -1 }).lean(),
    ]);

    return {
      summary,
      byDisposition: byDisposition.map((d) => ({
        disposition: d._id.d, location: d._id.l, count: d.n, scrapKg: round2(d.scrapKg),
      })),
      byCoil: byCoil.map((c) => ({
        coilSkuCode: c._id.code, coilSkuName: c._id.name,
        scrapKg: round2(c.scrapKg), coilKg: round2(c.coilKg),
        batches: c.batches, avgYield: round2(c.avgYield),
      })),
      monthly: monthly.map((m) => ({ month: m._id, scrapKg: round2(m.scrapKg), batches: m.batches, avgYield: round2(m.avgYield) })),
      uncut: uncutRows,
      // Every recorded cut, newest first — the activity strip.
      recent: await ScrapRecord.find(cut)
        .select('batchNo scrapDate location coilSkuCode coilSkuName coilWeightKg circlesWeightKg scrapKg yieldRatioPct disposition conversionNumber')
        .sort({ scrapDate: -1 }).limit(12).lean(),
    };
  },

  /**
   * SCRAP BY PHYSICAL COIL — "how much scrap came off THIS coil?"
   *
   * ── NOT A REPLACEMENT FOR `byCoil` ON THE DASHBOARD ────────────────────────
   * The dashboard's existing `byCoil` groups on `coilSkuCode`, which is the
   * GRADE — "how much scrap does JSL204-08 produce as a material?". That is a
   * real question, it is what the client's Summary Scrap sheet answers, and it
   * is left exactly as it is. This answers a different one: "how much scrap
   * came off the 2,000 kg coil that arrived on GRN-262 with batch TX89165708?"
   * Both ship, both are labelled, and neither is derived from the other.
   *
   * The grouping key is `coilReceiptId` — the GRN_IN movement, which IS the
   * physical coil. Never `batchNo`: a batch number is free text printed on a
   * label, and two suppliers reusing one would silently merge two coils'
   * scrap into a single row.
   *
   * ── THE UNTRACEABLE BUCKET IS NOT OPTIONAL ─────────────────────────────────
   * Most of the collection has `coilReceiptId: null` — every row imported from
   * the client's workbook, which names a batch and not a receipt. Those cannot
   * be attributed to a coil, and nothing here guesses: a batch number that
   * merely LOOKS like a receipt's is not evidence, and attaching 246,000 kg of
   * historical scrap to coils on that basis would be fabrication.
   *
   * So they are returned as their own bucket with their own totals, rather than
   * filtered out. Dropping them would make the page's scrap total disagree with
   * every other scrap figure in the module for no reason the reader could see.
   */
  async getScrapByCoil(query = {}) {
    const filter = onlyStatus(buildFilter(query), 'CUT');
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 500);

    // One pipeline, three readings of the same grouped set: the page of traced
    // coils, the totals across ALL traced coils (never summed from the page —
    // this module has been bitten by that before), and the untraced bucket.
    const [agg] = await ScrapRecord.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$coilReceiptId',
          scrapKg:   { $sum: '$scrapKg' },
          cutKg:     { $sum: '$coilWeightKg' },
          circlesKg: { $sum: '$circlesWeightKg' },
          // One scrap record per cut, so a count of records IS a count of
          // cutting rounds for this coil.
          rounds:    { $sum: 1 },
          batchNo:     { $first: '$batchNo' },
          coilSkuId:   { $first: '$coilSkuId' },
          coilSkuCode: { $first: '$coilSkuCode' },
          coilSkuName: { $first: '$coilSkuName' },
          firstCutAt:  { $min: '$scrapDate' },
          lastCutAt:   { $max: '$scrapDate' },
          locations:    { $addToSet: '$location' },
          dispositions: { $addToSet: '$disposition' },
        },
      },
      {
        $facet: {
          rows: [
            { $match: { _id: { $ne: null } } },
            { $sort: { scrapKg: -1, lastCutAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          stats: [
            { $match: { _id: { $ne: null } } },
            {
              $group: {
                _id: null,
                coils: { $sum: 1 },
                scrapKg: { $sum: '$scrapKg' }, cutKg: { $sum: '$cutKg' },
                circlesKg: { $sum: '$circlesKg' }, rounds: { $sum: '$rounds' },
              },
            },
          ],
          untraced: [{ $match: { _id: null } }],
        },
      },
    ]).option({ allowDiskUse: true });

    const rows = agg?.rows || [];
    const stats = agg?.stats?.[0] || { coils: 0, scrapKg: 0, cutKg: 0, circlesKg: 0, rounds: 0 };
    const un = agg?.untraced?.[0] || null;

    /**
     * How much each of these coils actually weighed when it arrived.
     *
     * The scrap record knows what was CUT, not what was RECEIVED — only the
     * GRN_IN movement knows that, and "remaining" is meaningless without it.
     * ONE query for the whole page, keyed by _id, so a page of fifty coils
     * costs one read and not fifty.
     */
    const receiptIds = rows.map((r) => r._id).filter(Boolean);
    const receipts = receiptIds.length
      ? await InventoryMovement.find({ _id: { $in: receiptIds }, isDeleted: { $ne: true } })
        .select('movementNumber batchNo skuId skuCode skuName quantity unitCost warehouse movementDate refType refNumber poNumber vendorName')
        .lean()
      : [];
    const byId = new Map(receipts.map((m) => [String(m._id), m]));

    const docs = rows.map((r) => {
      const m = byId.get(String(r._id)) || null;
      return {
        coilReceiptId: r._id,
        movementNumber: m?.movementNumber || '',
        // The receipt's own batch number wins over the scrap record's copy:
        // the receipt is where the identity lives, the copy is denormalised.
        batchNo: m?.batchNo || r.batchNo || '',
        skuId: m?.skuId || r.coilSkuId || null,
        skuCode: m?.skuCode || r.coilSkuCode || '',
        itemName: m?.skuName || r.coilSkuName || '',
        ...summariseCoilRow({
          // A receipt that has been soft-deleted leaves this at 0 rather than
          // inventing a weight; `receiptMissing` below says why, so a blank
          // "remaining" column is explained instead of just looking wrong.
          receivedKg: m?.quantity || 0,
          cutKg: r.cutKg, circlesKg: r.circlesKg, scrapKg: r.scrapKg, rounds: r.rounds,
        }),
        receiptMissing: !m,
        unitCost: round2(m?.unitCost),
        supplier: m?.vendorName || '',
        grnNo: m?.refType === 'GRN' ? (m.refNumber || '') : '',
        poNo: m?.poNumber || '',
        warehouse: m?.warehouse || '',
        receivedDate: m?.movementDate || null,
        firstCutAt: r.firstCutAt || null,
        lastCutAt: r.lastCutAt || null,
        locations: (r.locations || []).filter(Boolean).sort(),
        dispositions: (r.dispositions || []).filter(Boolean).sort(),
      };
    });

    const tracedCount = stats.coils || 0;
    return {
      docs,
      summary: {
        traced: {
          coils: tracedCount,
          scrapKg: round2(stats.scrapKg),
          cutKg: round2(stats.cutKg),
          circlesKg: round2(stats.circlesKg),
          rounds: stats.rounds || 0,
        },
        /**
         * Scrap that exists but cannot be pinned to a coil. Always present,
         * even when zero, so the screen can state "0 untraceable" rather than
         * leaving the reader to wonder whether the section is missing.
         */
        untraceable: {
          records: un?.rounds || 0,
          scrapKg: round2(un?.scrapKg || 0),
          cutKg: round2(un?.cutKg || 0),
          circlesKg: round2(un?.circlesKg || 0),
        },
        pagination: {
          page, limit, total: tracedCount, pages: Math.ceil(tracedCount / limit) || 1,
        },
      },
    };
  },

  /** One scrap record, with the conversion it came from. */
  async getRecord(id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw new AppError('Invalid scrap record id.', 400);
    const doc = await ScrapRecord.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!doc) throw new AppError('Scrap record not found', 404);

    // The circle lines live on the conversion; an uncut batch has none.
    const conversion = doc.conversionId
      ? await CoilConversion.findOne({ _id: doc.conversionId, isDeleted: { $ne: true } }).lean()
      : null;

    return {
      ...doc,
      isPhysicalScrap: isPhysicalScrap(doc.location),
      conversion,
      circles: conversion?.circles || [],
    };
  },

  /* ══ SCRAP STOCK ═══════════════════════════════════════════════════════ */

  /**
   * How much scrap is on hand, per warehouse and in total.
   *
   * Read straight off InventoryStock rather than summed from the ledger: the
   * stock row IS the running total, maintained by the engine under a version
   * guard, and re-adding the ledger on every page load would be both slower and
   * a second answer capable of disagreeing with the first.
   */
  async getScrapStock() {
    const sku = await resolveScrapSku();
    const rows = await InventoryStock.find({ skuId: sku._id, isDeleted: { $ne: true } })
      .select('warehouse qtyOnHand lastMovementAt').sort({ warehouse: 1 }).lean();

    const byWarehouse = rows.map((r) => ({
      warehouse: r.warehouse,
      qtyOnHand: round2(r.qtyOnHand),
      lastMovementAt: r.lastMovementAt || null,
      // The same rule the register uses, so the two never disagree about which
      // scrap is genuinely the company's.
      isPhysicalScrap: isPhysicalScrap(r.warehouse),
    }));

    return {
      skuId: sku._id,
      skuCode: sku.code,
      skuName: sku.name,
      unit: sku.unit || SCRAP_UNIT,
      totalKg: round2(byWarehouse.reduce((s, r) => s + r.qtyOnHand, 0)),
      byWarehouse,
    };
  },

  /** The scrap ledger — every movement against the scrap SKU, newest first. */
  async getScrapMovements(query = {}) {
    const sku = await resolveScrapSku();
    const filter = buildMovementFilter(sku._id, query);

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 500);

    const [docs, total, totals] = await Promise.all([
      InventoryMovement.find(filter).sort({ movementDate: -1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      InventoryMovement.countDocuments(filter),
      // Over the whole filtered set, not the page — the same rule the scrap
      // register follows, and for the same reason.
      InventoryMovement.aggregate([
        { $match: filter },
        { $group: { _id: '$txnType', qty: { $sum: '$quantity' }, n: { $sum: 1 } } },
      ]),
    ]);

    const of = (t) => totals.find((x) => x._id === t) || {};
    return {
      docs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        inKg: round2(of(TXN_TYPE.SCRAP_IN).qty || 0),
        outKg: round2(of(TXN_TYPE.SCRAP_OUT).qty || 0),
        inCount: of(TXN_TYPE.SCRAP_IN).n || 0,
        outCount: of(TXN_TYPE.SCRAP_OUT).n || 0,
      },
    };
  },

  /**
   * Scrap Out history — the table under the Scrap Out form.
   *
   * Not a second store: these are the same SCRAP_OUT ledger rows Scrap
   * movement lists, filtered to the Out direction and reshaped for display by
   * toScrapOutHistoryRow (KG as stored, Quintal/Ton derived, the operator's
   * own remarks recovered from the stored sentence). Newest first — movement
   * date, then the order they were recorded.
   */
  async getScrapOutHistory(query = {}) {
    const sku = await resolveScrapSku();
    const filter = buildMovementFilter(sku._id, { ...query, txnType: TXN_TYPE.SCRAP_OUT });
    if (query.reason) filter.reason = query.reason;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 10, 100);

    const [docs, total, totals] = await Promise.all([
      InventoryMovement.find(filter).sort({ movementDate: -1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      InventoryMovement.countDocuments(filter),
      InventoryMovement.aggregate([
        { $match: filter },
        { $group: { _id: null, qty: { $sum: '$quantity' } } },
      ]),
    ]);

    return {
      docs: docs.map(toScrapOutHistoryRow),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      // Over the whole filtered set, not the page.
      summary: { count: total, totalKg: round2(totals[0]?.qty || 0) },
    };
  },

  /**
   * Manual Scrap In — scrap that reached the yard from somewhere other than a
   * cut recorded in this system.
   *
   * Everything dangerous about this is delegated, not reimplemented:
   * `runStockEntry` claims the submission id (so a double-click posts once),
   * opens the transaction, and releases the claim if anything throws.
   * `increaseStock` is the single writer of both the balance and the ledger row,
   * so the two can never drift.
   *
   * The entry is one line — there is one scrap item — but it is handed over as
   * a one-element array so it travels the exact code path Consumables, Raw
   * Material and Finished Goods use. A private shortcut here is how the safety
   * properties would quietly rot.
   */
  async scrapIn(payload, user) {
    return this._entry(payload, user, {
      action: 'scrapIn',
      txnType: TXN_TYPE.SCRAP_IN,
      refType: 'SCRAP_IN',
      reasons: SCRAP_IN_REASONS,
      partyLabel: 'Received from',
    });
  },

  /**
   * Manual Scrap Out — scrap sold, dumped or moved off site.
   *
   * Three separate things stop this going negative: the duplicate-line merge
   * inside `runStockEntry`, the preflight below (which reads the balance inside
   * the transaction, so a concurrent Out cannot slip between the check and the
   * write), and the engine's own guard in applyStockDelta. `allowNegative` is
   * the deliberate override, exactly as on every other Stock Out.
   */
  async scrapOut(payload, user) {
    return this._entry(payload, user, {
      action: 'scrapOut',
      txnType: TXN_TYPE.SCRAP_OUT,
      refType: 'SCRAP_OUT',
      reasons: SCRAP_OUT_REASONS,
      partyLabel: 'Issued to',
      out: true,
    });
  },

  /**
   * The shared body of Scrap In and Scrap Out.
   *
   * They differ in four values and one preflight, so they are one function with
   * a direction rather than two near-identical ones — the pair that drifts
   * apart is the classic way an OUT path loses a guard the IN path kept.
   */
  async _entry(payload, user, cfg) {
    const sku = await resolveScrapSku();

    /*
     * How many KILOGRAMS move. Scrap In keeps its single kilogram field. Scrap
     * Out may also arrive as { quantity, uom } — converted HERE, before the
     * preflight and the write, through the same pure function the schema ran,
     * so the stock check, the ledger and the response all see one number.
     * The figure as typed is kept beside it only when a unit was chosen.
     */
    let quantity;
    let entered = {};
    if (cfg.out) {
      const q = resolveScrapQuantity(payload);
      if (!q.ok) throw new AppError(q.error, 400);
      quantity = q.kg;
      const unitChosen = payload.uom !== undefined && payload.uom !== null && payload.uom !== '';
      if (unitChosen) entered = { enteredQty: q.enteredQty, enteredUom: q.enteredUom };
    } else {
      quantity = round2(payload.quantityKg);
    }
    if (!(quantity > 0)) throw new AppError('Quantity must be more than zero.', 400);

    const warehouse = String(payload.warehouse || 'PLG01').trim().toUpperCase();
    const reason = payload.reason;
    const customReason = reason === 'OTHER' ? String(payload.customReason || '').trim() : '';
    if (reason === 'OTHER' && !customReason) {
      throw new AppError('Custom Reason is required when Reason is Other.', 422);
    }

    /*
     * Who the scrap went to (Scrap Out only).
     *
     * A SALE must name a buyer from the Scrap Buyer master. The name on the row
     * is read from that master here, never taken from the request: the client
     * sends an id, and the ledger records what the master says that id is.
     * Other reasons keep the optional free-text "Issued to" — a transfer names
     * a site, not a buyer — exactly as before.
     */
    let buyer = null;
    if (cfg.out && payload.buyerId) {
      const b = await ScrapBuyer.findOne({ _id: payload.buyerId, isDeleted: { $ne: true } }).lean();
      if (!b) throw new AppError('That buyer is no longer in the Scrap Buyer master. Pick the buyer again.', 400);
      if (b.isActive === false) throw new AppError(`${b.name} is marked inactive in the Scrap Buyer master.`, 400);
      buyer = toBuyerSnapshot(b);
    } else if (cfg.out && buyerRequiredFor(reason)) {
      throw new AppError('Choose who the scrap was sold to. A buyer is required when Reason is Sold.', 422);
    }

    const movementDate = payload.date ? new Date(payload.date) : new Date();
    const partyName = buyer ? buyer.name : String(payload.partyName || '').trim();
    const partyLabel = cfg.out && reason === 'SALE' ? 'Sold to' : cfg.partyLabel;
    const allowNegative = cfg.out ? !!payload.allowNegative : false;

    // The human-readable line the ledger shows. `reason` and `partyName` are
    // stored as real fields too — this is the sentence, not the data.
    const reasonText = reason === 'OTHER'
      ? `${cfg.reasons.OTHER} — ${customReason}`
      : (cfg.reasons[reason] || reason);
    const remarks = [
      reasonText,
      partyName && `${partyLabel}: ${partyName}`,
      payload.reference,
      payload.remarks,
    ].filter(Boolean).join(' · ');

    const move = cfg.out ? inventoryService.decreaseStock : inventoryService.increaseStock;

    return inventoryService.runStockEntry({
      items: [{ skuId: sku._id, skuCode: sku.code, quantity }],
      clientRequestId: payload.clientRequestId,
      meta: { sourceModule: 'SCRAP_IMS', action: cfg.action, performedBy: user?._id },

      // Only on the way out, and only when the operator has not overridden it.
      // Reads the balance inside the session, so it sees any concurrent Out
      // that has already written.
      preflight: cfg.out ? async (lines, session) => {
        if (allowNegative) return;
        const q = InventoryStock.findOne({ skuId: sku._id, warehouse, isDeleted: { $ne: true } });
        if (session) q.session(session);
        const stock = await q.lean();
        const onHand = round2(stock?.qtyOnHand || 0);
        const asked = round2(lines.reduce((s, l) => s + Number(l.quantity || 0), 0));
        if (asked > onHand) {
          throw new AppError(
            `Not enough scrap at ${warehouse} — ${onHand} ${sku.unit || SCRAP_UNIT} on hand, ${asked} requested. `
            + 'Lower the quantity, or tick "allow negative" if the stock figure is behind reality.',
            400,
          );
        }
      } : undefined,

      write: async (line, session) => {
        const { movement, stock } = await move({
          skuId: line.skuId,
          skuCode: sku.code,
          skuName: sku.name,
          unit: sku.unit || SCRAP_UNIT,
          quantity: Number(line.quantity),
          warehouse,
          txnType: cfg.txnType,
          sourceModule: 'SCRAP_IMS',
          refType: cfg.refType,
          refNumber: payload.reference || '',
          reason,
          customReason,
          partyName,
          buyer: buyer || undefined,
          ...entered,
          remarks,
          performedBy: user,
          movementDate,
          clientRequestId: payload.clientRequestId,
          // No unitCost: scrap carries no rate anywhere in the source, so it is
          // left at zero rather than invented. See the header note.
        }, { allowNegative, session });

        return {
          movementId: movement._id,
          movementNumber: movement.movementNumber,
          warehouse,
          quantityKg: Number(line.quantity),
          ...entered,
          buyer: buyer || undefined,
          balanceAfter: stock.qtyOnHand,
        };
      },
    });
  },
};

export default scrapImsService;
