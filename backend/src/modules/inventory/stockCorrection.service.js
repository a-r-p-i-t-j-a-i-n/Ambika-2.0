import SKU, { CP_IMS_ITEM_TYPES } from '../skus/sku.model.js';
import InventoryStock, { DEFAULT_WAREHOUSE } from './inventoryStock.model.js';
import ScrapRecord, { SCRAP_LOCATIONS } from './scrapRecord.model.js';
import { inventoryService, ledgerText, TXN_TYPE } from './inventory.service.js';
import { FG_ITEM_TYPES } from './fgIms.service.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * STOCK CORRECTION — set an item's stock to what is physically there.
 *
 * The system says 100, the shelf holds 98: the operator counts, enters 98, and
 * the balance becomes 98 — in Raw Material, Consumables & Packaging or
 * Finished Goods, whichever the SKU belongs to. Every screen reads the same
 * InventoryStock rows, so the correction shows everywhere at once.
 *
 * ── HOW IT IS POSTED ───────────────────────────────────────────────────────
 * The difference, never an overwrite: +2 as ADJUST_IN, −2 as ADJUST_OUT,
 * through the one stock engine — so the ledger still adds up to the balance,
 * the movement carries who did it and when, and History says "Stock
 * correction: 100 in the system → 98 counted". ADJUST_OUT is deliberately not
 * consumption, so a correction never moves Average Daily Consumption or a
 * reorder level. An incoming correction carries no unit cost, so the item's
 * average cost is unchanged.
 *
 * ── SCRAP ──────────────────────────────────────────────────────────────────
 * The Scrap pick corrects Scrap master data: the scrap recorded for a COIL SKU
 * (JSL202-06 left 6,042.67 kg at PLG01), in kg, per cutting location — the sum
 * of that SKU's cut records. The correction is written there as one more
 * record, marked CORRECTION, carrying only the change (counted − recorded) and
 * no coil or circle weight: the SKU's scrap total, its page and the Scrap
 * dashboard all add it in, while its number of cuts and its yield stay as the
 * cuts made them (scrapRecord.model.js, entryType).
 *
 * ── PER LOCATION ───────────────────────────────────────────────────────────
 * Stock is held per SKU AND location (PLG01, JW001, MAIN…), and a count is of
 * one location's shelf, so a correction line is one SKU at one location.
 *
 * ── NEVER AGAINST A STALE FIGURE ───────────────────────────────────────────
 * Each line says what the operator SAW in the system. If the figure moved
 * since (someone saved a Stock Out or a cut meanwhile), the count was made
 * against a figure that no longer exists, and the correction is refused rather
 * than silently applied to the wrong base. Replays of one submission are
 * caught by its request id, like every IMS entry — and this check is what
 * stops a scrap correction twice over, as scrap lines write no movement for
 * the request id to be found on.
 */

const EPS = 0.001;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * The IMS modules whose STOCK a correction can touch, with where each holds
 * stock by default.
 *
 * Raw Material is its circles — counted in pieces. Coils (RAW_MATERIAL) are
 * left out: they are kept by weight, coil by coil (each receipt and every cut
 * of it), so a lump kg adjustment on the SKU would put the stock out of step
 * with the coils it is made of — and a coil's kilograms beside its scrap's
 * read as one more scrap figure. Their scrap is corrected under Scrap.
 */
export const CORRECTION_MODULES = [
  { key: 'RM', label: 'Raw Material', types: ['CIRCLE'], defaultWarehouse: 'PLG01' },
  { key: 'CP', label: 'Consumables & Packaging', types: CP_IMS_ITEM_TYPES, defaultWarehouse: DEFAULT_WAREHOUSE },
  { key: 'FG', label: 'Finished Goods', types: FG_ITEM_TYPES, defaultWarehouse: DEFAULT_WAREHOUSE },
];
/** Scrap master data — coil SKUs and the scrap their cuts left, per cutting location. */
export const SCRAP_MODULE = { key: 'SCRAP', label: 'Scrap', defaultWarehouse: 'PLG01' };
const ALL_TYPES = CORRECTION_MODULES.flatMap((m) => m.types);
export const moduleOf = (itemType) => CORRECTION_MODULES.find((m) => m.types.includes(itemType)) || null;

/**
 * Scrap recorded per coil SKU and cutting location — the figure Scrap master
 * data shows (cut records, corrections included; uncut batches never).
 */
const scrapTotals = (match = {}, session = null) => {
  const agg = ScrapRecord.aggregate([
    { $match: { isDeleted: { $ne: true }, batchStatus: 'CUT', ...match } },
    {
      $group: {
        _id: { code: '$coilSkuCode', location: '$location' },
        kg: { $sum: '$scrapKg' },
        skuId: { $first: '$coilSkuId' },
        name: { $last: '$coilSkuName' },
      },
    },
  ]);
  if (session) agg.session(session);
  return agg;
};

export const stockCorrectionService = {
  /**
   * What a correction can be made for, each with its figure at every location:
   *
   *   stock items (RM / CP / FG) — every one by default, or by `module`,
   *     `search` (code or name) or exactly `skuIds`; a SKU never stocked
   *     anywhere is offered at its module's usual location;
   *   scrap items — the coil SKUs on Scrap master data, with their scrap kg
   *     at PLG01 / JW001; returned with every module, or alone for SCRAP.
   *
   * `id` is the pick's identity: a coil appears twice — its stock under Raw
   * Material, its scrap under Scrap — and the two are different corrections.
   */
  async listSkus(query = {}) {
    const key = String(query.module || '').toUpperCase();
    const ids = String(query.skuIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    const search = String(query.search || '').trim();
    const [stock, scrap] = await Promise.all([
      key === SCRAP_MODULE.key ? [] : this._stockItems({ key, ids, search, limit: query.limit }),
      key && key !== SCRAP_MODULE.key ? [] : this._scrapItems({ ids, search }),
    ]);
    return [...stock, ...scrap];
  },

  async _stockItems({ key, ids, search, limit: lim }) {
    const limit = Math.min(Math.max(Number(lim) || 5000, 1), 5000);
    const module = CORRECTION_MODULES.find((m) => m.key === key);
    const filter = { itemType: { $in: module ? module.types : ALL_TYPES }, isDeleted: { $ne: true } };
    if (ids.length) filter._id = { $in: ids };
    if (search) filter.$or = [{ code: rx(search) }, { name: rx(search) }];

    const skus = await SKU.find(filter).select('code name unit itemType').sort({ code: 1 }).limit(ids.length || limit).lean();
    const stocks = skus.length
      ? await InventoryStock.find({ skuId: { $in: skus.map((s) => s._id) }, isDeleted: { $ne: true } })
        .select('skuId warehouse qtyOnHand').lean()
      : [];
    const bySku = new Map();
    for (const st of stocks) {
      const k = String(st.skuId);
      if (!bySku.has(k)) bySku.set(k, []);
      bySku.get(k).push({ warehouse: st.warehouse || DEFAULT_WAREHOUSE, qtyOnHand: round2(st.qtyOnHand) });
    }
    return skus.map((s) => {
      const m = moduleOf(s.itemType);
      const rows = (bySku.get(String(s._id)) || []).sort((a, b) => a.warehouse.localeCompare(b.warehouse));
      return {
        id: String(s._id),
        kind: 'STOCK',
        skuId: String(s._id),
        skuCode: s.code || '',
        skuName: s.name || '',
        unit: s.unit || '',
        module: m?.key || null,
        moduleLabel: m?.label || '',
        defaultWarehouse: m?.defaultWarehouse || DEFAULT_WAREHOUSE,
        stocks: rows,
        totalOnHand: round2(rows.reduce((t, r) => t + r.qtyOnHand, 0)),
      };
    });
  },

  async _scrapItems({ ids, search }) {
    const rows = await scrapTotals();
    const byCode = new Map();
    for (const r of rows) {
      const code = r._id.code;
      if (!code) continue;
      const it = byCode.get(code) || { code, skuId: r.skuId, name: r.name || '', stocks: [] };
      it.stocks.push({ warehouse: r._id.location, qtyOnHand: round2(r.kg) });
      byCode.set(code, it);
    }
    // The SKU master's id and name where the coil SKU is still there.
    const master = await SKU.find({ code: { $in: [...byCode.keys()] }, isDeleted: { $ne: true } }).select('code name').lean();
    const masterBy = new Map(master.map((s) => [s.code, s]));
    const want = new Set(ids);
    const hit = search ? rx(search) : null;

    return [...byCode.values()]
      .map((it) => {
        const m = masterBy.get(it.code);
        const skuId = String(m?._id || it.skuId || '');
        // In-house first, then job work — the order Scrap master data splits them.
        const stocks = it.stocks.sort((a, b) => SCRAP_LOCATIONS.indexOf(a.warehouse) - SCRAP_LOCATIONS.indexOf(b.warehouse));
        return {
          id: `SCRAP:${skuId}`,
          kind: 'SCRAP',
          skuId,
          skuCode: it.code,
          skuName: m?.name || it.name,
          unit: 'KGS',
          module: SCRAP_MODULE.key,
          moduleLabel: SCRAP_MODULE.label,
          defaultWarehouse: SCRAP_MODULE.defaultWarehouse,
          stocks,
          totalOnHand: round2(stocks.reduce((t, r) => t + r.qtyOnHand, 0)),
        };
      })
      .filter((it) => it.skuId && (!want.size || want.has(it.skuId)) && (!hit || hit.test(it.skuCode) || hit.test(it.skuName)))
      .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
  },

  /**
   * Post one correction: for each line, physical − system as one adjustment.
   *
   *   lines   [{ kind?, skuId, warehouse, systemQty, physicalQty }] — systemQty
   *           is what the form showed; physicalQty what was counted (≥ 0).
   *           kind SCRAP: the coil SKU's scrap at PLG01 / JW001, in kg.
   *   reason  optional, written on every line.
   *
   * A line whose count equals the system figure changes nothing.
   */
  async correct(payload, user) {
    const lines = (payload.lines || []).map((l) => ({
      kind: String(l.kind || 'STOCK').toUpperCase() === 'SCRAP' ? 'SCRAP' : 'STOCK',
      skuId: String(l.skuId),
      warehouse: String(l.warehouse || DEFAULT_WAREHOUSE).trim().toUpperCase(),
      systemQty: round2(l.systemQty),
      physicalQty: round2(l.physicalQty),
    }));
    if (!lines.length) throw new AppError('Add at least one item to correct.', 400);
    const seen = new Set();
    for (const l of lines) {
      const k = `${l.kind}|${l.skuId}|${l.warehouse}`;
      if (seen.has(k)) throw new AppError('The same item and location is on the form twice — keep one line for it.', 400);
      seen.add(k);
      if (l.physicalQty < 0) throw new AppError('A physical count cannot be below zero.', 400);
      if (l.kind === 'SCRAP' && !SCRAP_LOCATIONS.includes(l.warehouse)) {
        throw new AppError('Scrap is corrected at PLG01 (in-house) or JW001 (job work).', 400);
      }
    }

    const skus = await SKU.find({ _id: { $in: [...new Set(lines.map((l) => l.skuId))] }, isDeleted: { $ne: true } })
      .select('code name unit itemType').lean();
    const skuById = new Map(skus.map((s) => [String(s._id), s]));
    for (const l of lines) {
      const sku = skuById.get(l.skuId);
      if (!sku) throw new AppError('One of the items no longer exists. Reopen the form and pick it again.', 404);
      if (l.kind === 'STOCK' && sku.itemType === 'RAW_MATERIAL') {
        throw new AppError(`${sku.code} is a coil, kept by weight coil by coil, so its stock is not corrected here. Its scrap can be corrected under Scrap.`, 400);
      }
      if (l.kind === 'STOCK' && !moduleOf(sku.itemType)) {
        throw new AppError(`${sku.code} is not a circle, Consumables & Packaging or Finished Goods item, so its stock cannot be corrected here.`, 400);
      }
    }

    const reasonText = String(payload.reason || '').trim();
    const key = ledgerText(payload.clientRequestId);
    // Taken before the transaction, like every document number: a rolled-back
    // correction leaves a harmless gap rather than a number issued twice.
    const correctionNumber = await generateDocNumber('STOCK_CORRECTION').catch(() => `SC-${Date.now()}`);
    const movementDate = new Date();
    const why = reasonText ? ` · ${reasonText}` : '';

    const out = await inventoryService.runStockEntry({
      items: lines,
      clientRequestId: key,
      meta: { sourceModule: 'STOCK_CORRECTION', action: 'correct', performedBy: user?._id },
      // The system figure each line was counted against, read in the session.
      preflight: async (ls, session) => {
        for (const l of ls) {
          const sku = skuById.get(l.skuId);
          let current;
          if (l.kind === 'SCRAP') {
            // By code, as Scrap master data groups it (stored upper-case).
            const [row] = await scrapTotals({ coilSkuCode: String(sku.code).toUpperCase(), location: l.warehouse }, session);
            current = round2(row?.kg || 0);
          } else {
            const q = InventoryStock.findOne({ skuId: l.skuId, warehouse: l.warehouse, isDeleted: { $ne: true } }).select('qtyOnHand');
            if (session) q.session(session);
            current = round2((await q.lean())?.qtyOnHand || 0);
          }
          if (Math.abs(current - l.systemQty) > EPS) {
            throw new AppError(
              l.kind === 'SCRAP'
                ? `${sku.code} scrap at ${l.warehouse}: it changed while the form was open — it is now ${current} kg, not ${l.systemQty}. Remove it and pick it again to correct the new figure.`
                : `${sku.code} at ${l.warehouse}: the stock changed while the form was open — it is now ${current}, not ${l.systemQty}. Remove it and pick it again to count against the new figure.`,
              409,
            );
          }
          l.currentQty = current;
        }
      },
      write: async (l, session) => {
        const sku = skuById.get(l.skuId);
        const delta = round2(l.physicalQty - l.currentQty);
        const base = {
          kind: l.kind, skuId: l.skuId, skuCode: sku.code, warehouse: l.warehouse, before: l.currentQty, after: l.physicalQty, delta,
        };
        if (Math.abs(delta) <= EPS) return { ...base, unchanged: true };

        if (l.kind === 'SCRAP') {
          // One more record on the coil SKU's scrap: the change, and nothing else.
          const [rec] = await ScrapRecord.create([{
            entryType: 'CORRECTION',
            batchStatus: 'CUT',
            scrapDate: movementDate,
            location: l.warehouse,
            // A counted figure is a checked one, in the location's own words.
            disposition: l.warehouse === 'PLG01' ? 'DONE' : 'JOB_WORK',
            verifiedAt: movementDate,
            coilSkuId: sku._id, coilSkuCode: sku.code, coilSkuName: sku.name,
            coilWeightKg: 0, circlesWeightKg: 0, scrapKg: delta, yieldRatioPct: null,
            clientRequestId: key || undefined,
            remarks: `Scrap correction ${correctionNumber}${user?.name ? ` by ${user.name}` : ''}: ${l.currentQty} kg recorded → ${l.physicalQty} kg counted${why}`,
            createdBy: user?._id,
          }], session ? { session } : undefined);
          return { ...base, recordId: String(rec._id) };
        }

        const post = delta > 0 ? inventoryService.increaseStock : inventoryService.decreaseStock;
        const { movement, stock } = await post({
          skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit,
          quantity: Math.abs(delta), warehouse: l.warehouse,
          txnType: delta > 0 ? TXN_TYPE.ADJUST_IN : TXN_TYPE.ADJUST_OUT,
          sourceModule: 'STOCK_CORRECTION', refType: 'STOCK_CORRECTION', refNumber: correctionNumber,
          reason: 'STOCK_CORRECTION',
          remarks: `Stock correction: ${l.currentQty} in the system → ${l.physicalQty} counted${why}`,
          performedBy: user, movementDate, clientRequestId: key,
        }, { session });
        return { ...base, after: round2(stock.qtyOnHand), movementNumber: movement.movementNumber };
      },
    });

    const results = out.results || [];
    return {
      correctionNumber: out.duplicate ? null : correctionNumber,
      duplicate: !!out.duplicate,
      changed: results.filter((r) => !r.unchanged).length,
      unchanged: results.filter((r) => r.unchanged).length,
      results,
    };
  },
};

export default stockCorrectionService;
