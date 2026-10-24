import mongoose from 'mongoose';
import InventoryStock, { DEFAULT_WAREHOUSE } from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import InventoryRequestKey from './inventoryRequestKey.model.js';
import SKU from '../skus/sku.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateMovementNumber } from '../../utils/docNumberGenerator.js';
import { logger } from '../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Text on its way to the ledger.
 *
 * `undefined` and `null` must never reach the database as the literal words
 * "undefined" / "null": two legacy movements carry exactly that in `reason` and
 * `customReason`, and no reader can tell them apart from a reason somebody
 * actually typed. Anything blank becomes an empty string instead.
 */
export const ledgerText = (v) => {
  const s = String(v ?? '').trim();
  return (s === 'undefined' || s === 'null') ? '' : s;
};

// How many times a stock write is retried when another movement lands on the
// same row in the same instant. Five is far more than the handful of concurrent
// writers a store ever has, and stops a hot SKU spinning forever.
const OCC_MAX_ATTEMPTS = 5;
// How many times a whole multi-line batch is replayed when the transaction hits
// a write conflict. withTransaction already retries internally; this is the belt
// to its braces.
const TXN_MAX_ATTEMPTS = 3;

const TRANSIENT_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult'];
const isTransient = (e) => TRANSIENT_LABELS.some((l) => e?.errorLabels?.includes?.(l))
  || e?.code === 112 || e?.codeName === 'WriteConflict';
const isDuplicateKey = (e) => e?.code === 11000;
// A standalone mongod cannot run transactions. Deployments differ between
// laptops and the cluster, so this degrades instead of failing outright.
const isTxnUnsupported = (e) => e?.code === 20
  || /Transaction numbers are only allowed on a replica set|transactions are not supported/i.test(e?.message || '');

let txnUnsupportedWarned = false;

/**
 * A unit of work that must be atomic has nowhere to run on a mongod that has
 * no transactions: replaying it without a session is exactly the behaviour
 * that leaves a half-posted ledger. Refusing is the only safe answer, so the
 * caller passes `{ requireTransaction: true }` and gets this 503 instead.
 *
 * MongoDB only offers transactions on a replica set (or a sharded cluster), so
 * every environment that posts stock — production, staging, and any local one
 * used for QC testing — must run as one. A single-node replica set is enough:
 *
 *   mongod --replSet rs0 --dbpath <data>        then, once:
 *   mongosh --eval 'rs.initiate()'              and connect with ?replicaSet=rs0
 *
 * INVENTORY_ALLOW_NON_ATOMIC=true opts a throwaway local setup out of this (the
 * guarded e2e harness sets it, which is why those suites still run against a
 * standalone mongod). It must never be set where real stock is kept: it buys
 * back exactly the partial-write behaviour this guard exists to prevent.
 */
const ALLOW_NON_ATOMIC = () => String(process.env.INVENTORY_ALLOW_NON_ATOMIC || '').toLowerCase() === 'true';
const NON_ATOMIC_REFUSAL = 'This posting has to be written as one unit, and this database cannot: MongoDB only runs transactions on a replica set. '
  + 'Nothing was posted. Point the server at a replica set (a single-node one is enough) and try again.';

const refuseWithoutTransaction = (requireTransaction, detail) => {
  if (!requireTransaction || ALLOW_NON_ATOMIC()) return;
  logger.error(`[inventory] refusing a non-atomic posting — ${detail}`);
  throw new AppError(NON_ATOMIC_REFUSAL, 503);
};

/**
 * Run `work` as one all-or-nothing unit: either every movement it writes lands,
 * or none of them does.
 *
 * A multi-line Stock Out used to commit line by line, so a request that failed
 * half way left the earlier lines in the ledger while returning an error — the
 * operator saw a failure and stock had already moved. `work` is handed the
 * session and must pass it down to every write.
 *
 * On a deployment without transactions (a standalone mongod) the work still
 * runs, just without the rollback guarantee, and says so once in the log —
 * unless the caller passed `{ requireTransaction: true }`, which refuses
 * instead of degrading (see above). `work` may be replayed, so it must read
 * every document it changes afresh on each attempt.
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<any>} work
 * @param {{ requireTransaction?: boolean }} [opts]
 */
export const runAtomically = async (work, opts = {}) => {
  const { requireTransaction = false } = opts;
  let session;
  try {
    session = await mongoose.startSession();
  } catch (e) {
    refuseWithoutTransaction(requireTransaction, `sessions unavailable: ${e.message}`);
    if (!txnUnsupportedWarned) { logger.warn(`[inventory] transactions unavailable — writes are not atomic: ${e.message}`); txnUnsupportedWarned = true; }
    return work(null);
  }
  try {
    for (let attempt = 1; attempt <= TXN_MAX_ATTEMPTS; attempt += 1) {
      try {
        let out;
        await session.withTransaction(async () => { out = await work(session); });
        return out;
      } catch (e) {
        if (isTxnUnsupported(e)) {
          // Nothing was committed (the server refused to start the transaction
          // at all), so refusing here leaves no partial state behind.
          refuseWithoutTransaction(requireTransaction, 'this mongod is not a replica set member');
          if (!txnUnsupportedWarned) { logger.warn('[inventory] transactions unavailable — writes are not atomic'); txnUnsupportedWarned = true; }
          return work(null);
        }
        if (isTransient(e) && attempt < TXN_MAX_ATTEMPTS) { await sleep(25 * attempt); continue; }
        if (isTransient(e)) {
          throw new AppError('These items are being updated by someone else right now. Please try again.', 409);
        }
        throw e;
      }
    }
    return undefined;
  } finally {
    await session.endSession();
  }
};

/**
 * Collapse repeated lines for the same SKU into one before anything is checked
 * or written.
 *
 * Two lines of 25 for a SKU holding 30 used to pass the availability check —
 * each was compared against the same on-hand on its own — and then the first
 * committed and the second failed, leaving 5 in the store behind an HTTP 400.
 * Summing first means the check sees the 50 that is really being asked for.
 *
 * Only quantity is summed. Batch and remarks are kept from the first line and
 * the rest appended, so nothing an operator typed is silently dropped.
 */
export const mergeDuplicateLines = (items = []) => {
  const byKey = new Map();
  for (const it of items) {
    const key = String(it.skuId);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, { ...it, quantity: Number(it.quantity) || 0 }); continue; }
    existing.quantity = round2(existing.quantity + (Number(it.quantity) || 0));
    const extra = [it.batchNo, it.remarks].filter(Boolean).join(' ');
    if (extra) existing.remarks = [existing.remarks, extra].filter(Boolean).join(' · ');
  }
  return [...byKey.values()];
};

/**
 * Fold every warehouse row for one SKU into the single figure the IMS screens
 * show.
 *
 * IMS has no warehouse selector: the stock list, the forecast and the stock card
 * all answer "what does the company hold". Keying a Map by skuId silently kept
 * whichever warehouse row came back last, so a SKU stocked in two places showed
 * one of them and under-reported the rest. The ledger reconciles against the sum
 * across warehouses, so the sum is what these screens have always meant. The
 * write path stays warehouse-scoped — only the reading is combined.
 */
export const combineStockRows = (rows = []) => {
  if (!rows.length) return {};
  if (rows.length === 1) return rows[0];
  let qtyOnHand = 0;
  let qtyOnHandKg = 0;
  let qtyReserved = 0;
  let stockValue = 0;
  let lastMovementAt = null;
  let lastCost = 0;
  for (const r of rows) {
    qtyOnHand = round2(qtyOnHand + (r.qtyOnHand || 0));
    qtyOnHandKg = round2(qtyOnHandKg + (r.qtyOnHandKg || 0));
    qtyReserved = round2(qtyReserved + (r.qtyReserved || 0));
    stockValue = round2(stockValue + (r.qtyOnHand || 0) * (r.avgCost || 0));
    if (r.lastMovementAt && (!lastMovementAt || r.lastMovementAt > lastMovementAt)) {
      lastMovementAt = r.lastMovementAt;
      lastCost = r.lastCost || lastCost;
    }
  }
  return {
    ...rows[0],
    qtyOnHand,
    qtyOnHandKg,
    qtyReserved,
    lastMovementAt,
    lastCost: lastCost || rows[0].lastCost || 0,
    // Weighted by quantity, so the combined row values the same as the parts.
    avgCost: qtyOnHand > 0 ? round2(stockValue / qtyOnHand) : round2(rows[0].avgCost || 0),
    warehouse: 'ALL',
    warehouseCount: rows.length,
  };
};

/** Group stock rows by SKU and combine each SKU's warehouses into one row. */
export const stockBySkuId = (rows = []) => {
  const byId = new Map();
  for (const r of rows) {
    const k = String(r.skuId);
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(r);
  }
  return new Map([...byId].map(([k, list]) => [k, combineStockRows(list)]));
};

/**
 * Apply one signed delta to a SKU+warehouse stock row and return the saved row.
 *
 * This used to read the document, mutate it and call `.save()`. With
 * `optimisticConcurrency` on the base schema two simultaneous movements on one
 * SKU raced: the loser got a raw Mongoose VersionError, which escaped as an HTTP
 * 500 quoting the internal document id, and its movement was simply lost. Here
 * the read and the write are joined by a version-guarded findOneAndUpdate, so a
 * loser re-reads the winner's number and applies its delta on top of it.
 */
const applyStockDelta = async (p) => {
  for (let attempt = 1; attempt <= OCC_MAX_ATTEMPTS; attempt += 1) {
    const find = InventoryStock.findOne({ skuId: p.skuId, warehouse: p.warehouse });
    if (p.session) find.session(p.session);
    const current = await find.lean();

    const onHand = round2(current?.qtyOnHand || 0);
    if (p.movementType === MOVEMENT_TYPE.OUT && onHand < p.quantity && !p.allowNegative) {
      throw new AppError(`Insufficient stock for ${p.skuCode || p.skuId} in ${p.warehouse} (on-hand ${onHand}, requested ${p.quantity})`, 400);
    }

    const set = {
      qtyOnHand: round2(onHand + p.qtyDelta),
      lastMovementAt: p.lastMovementAt,
      updatedBy: p.updatedBy,
    };
    // Secondary weight, only when THIS movement carried one. A caller that says
    // nothing about kilograms leaves the recorded weight exactly as it was, so
    // Consumables, Finished Goods and every GRN behave as they always have.
    if (p.qtyKgDelta !== null && p.qtyKgDelta !== undefined) {
      set.qtyOnHandKg = round2((current?.qtyOnHandKg || 0) + p.qtyKgDelta);
    }
    // Weighted-average cost on IN (only when a unit cost is given) — unchanged
    // arithmetic, now computed from the row this update is guarded against.
    if (p.movementType === MOVEMENT_TYPE.IN && p.unitCost > 0) {
      const newQty = onHand + p.quantity;
      const avgCost = round2(current?.avgCost || 0);
      set.avgCost = newQty > 0 ? round2((onHand * avgCost + p.quantity * p.unitCost) / newQty) : p.unitCost;
      set.lastCost = p.unitCost;
    }
    if (p.skuCode && !current?.skuCode) set.skuCode = p.skuCode;
    if (p.skuName && !current?.skuName) set.skuName = p.skuName;

    if (!current) {
      try {
        const [created] = await InventoryStock.create([{
          skuId: p.skuId, skuCode: p.skuCode || '', skuName: p.skuName || '', unit: p.unit || 'PCS',
          warehouse: p.warehouse, ...set,
        }], p.session ? { session: p.session } : undefined);
        return created;
      } catch (e) {
        // Another movement created the row first (unique skuId+warehouse) —
        // read it back and apply this delta on top.
        if (isDuplicateKey(e) && !p.session && attempt < OCC_MAX_ATTEMPTS) { await sleep(5 * attempt); continue; }
        throw e;
      }
    }

    const updated = await InventoryStock.findOneAndUpdate(
      { _id: current._id, __v: current.__v },
      { $set: set, $inc: { __v: 1 } },
      { new: true, session: p.session },
    );
    if (updated) return updated;
    // Inside a transaction a collision surfaces as a write conflict, which the
    // caller replays; there is no point re-reading our own snapshot here.
    if (p.session) throw new AppError('This item is being updated by someone else right now. Please try again.', 409);
    if (attempt < OCC_MAX_ATTEMPTS) await sleep(5 * attempt);
  }
  throw new AppError('This item is being updated by someone else right now. Please try again.', 409);
};

/**
 * Idempotency gate for a multi-line entry.
 *
 * The caller passes the id its form minted for this submission. The first
 * request claims the key; a replay — a double-click, a browser retry, a second
 * tab — finds it already claimed and is answered with what the first one did
 * instead of moving stock twice. Requests without a key behave exactly as
 * before, so every existing caller is untouched.
 *
 * Claimed OUTSIDE the transaction, deliberately. A duplicate-key error raised
 * inside a transaction aborts it, and that abort cannot be swallowed: the commit
 * then fails as a transient error and the driver replays the whole batch, over
 * and over, until the request times out. The claim is its own atomic step and
 * the transaction never sees it.
 *
 * ── A CLAIM IS NOT PROOF THE ENTRY HAPPENED ────────────────────────────────
 * A request can claim its key and then die before it settles or releases it —
 * the server restarted, the database connection dropped mid-save. Answering
 * every later retry "already saved" from that orphaned claim told operators a
 * correction had posted when nothing had moved. So a key that never settled is
 * checked against the ledger: movements carrying this id mean the entry did
 * commit (it is settled on the dead request's behalf); none, and the claim is
 * young, means it is still running — or a double-click overtook it, which is
 * given a moment to finish; none for ABANDONED_CLAIM_MS means it died, and the
 * retry takes the claim over and posts.
 *
 * @returns {{ replay: true, count: number, pending?: true } | { replay: false, claimed: boolean }}
 *   `pending` — claimed by a request still running; nothing to hand back yet.
 */
// Far longer than any live posting runs, so only a dead request's claim is
// ever taken over.
const ABANDONED_CLAIM_MS = 5 * 60 * 1000;
// How long a replay waits for the request it overtook (a double-click).
const PENDING_WAIT_MS = 1500;

const claimRequestKey = async (key, meta = {}) => {
  if (!key) return { replay: false, claimed: false };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await InventoryRequestKey.create([{ _id: key, ...meta }]);
      return { replay: false, claimed: true };
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
    const deadline = Date.now() + PENDING_WAIT_MS;
    for (;;) {
      const prior = await InventoryRequestKey.findById(key).lean();
      // Released by its failed first attempt meanwhile — claim it afresh.
      if (!prior) break;
      // Finished. A count covers keys settled before `settled` existed.
      if (prior.settled || prior.count > 0) return { replay: true, count: prior.count || 0 };
      const posted = await InventoryMovement.countDocuments({ clientRequestId: key });
      if (posted) {
        await settleRequestKey(key, posted);
        return { replay: true, count: posted };
      }
      if (Date.now() - new Date(prior.createdAt).getTime() > ABANDONED_CLAIM_MS) {
        // Guarded on the claim's own timestamp, so of two retries racing for
        // it exactly one wins; the other re-reads and finds it young.
        const taken = await InventoryRequestKey.findOneAndUpdate(
          { _id: key, settled: { $ne: true }, createdAt: prior.createdAt },
          { $set: { ...meta, createdAt: new Date() } },
          { new: true },
        ).lean();
        if (taken) {
          logger.warn(`[inventory] request ${key} was claimed ${prior.createdAt.toISOString?.() || prior.createdAt} and never finished — nothing was posted, so this retry posts it`);
          return { replay: false, claimed: true };
        }
        continue;
      }
      if (Date.now() >= deadline) return { replay: true, pending: true, count: 0 };
      await sleep(150);
    }
  }
  return { replay: true, pending: true, count: 0 };
};

/** Run a key's bookkeeping write, retried — a lost one is what orphans a claim. */
const keyWrite = async (what, key, op) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { await op(); return; } catch (e) {
      if (attempt === 3) { logger.error(`[inventory] could not ${what} request key ${key}: ${e.message}`); return; }
      await sleep(100 * attempt);
    }
  }
};

/**
 * Give a claimed key back.
 *
 * The entry did not happen, so its id must not lock out the corrected retry.
 * Only ever called for a claim this request made itself.
 */
const releaseRequestKey = async (key) => {
  if (!key) return;
  await keyWrite('release', key, () => InventoryRequestKey.deleteOne({ _id: key }));
};

/** Mark the claimed entry finished, with how many lines it wrote for a replay to report. */
const settleRequestKey = async (key, count) => {
  if (!key) return;
  await keyWrite('settle', key, () => InventoryRequestKey.updateOne({ _id: key }, { $set: { count, settled: true } }));
};

/**
 * Core stock engine — the ONLY place that mutates InventoryStock. Every call
 * upserts the on-hand balance AND writes one append-only InventoryMovement
 * row, so stock is always reconstructable from the ledger.
 *
 * @param {object} input
 *   skuId* , skuCode?, skuName?, unit?
 *   warehouse?            (default MAIN)
 *   movementType*         'IN' | 'OUT'
 *   txnType*              e.g. 'GRN_IN'
 *   quantity*             magnitude > 0
 *   unitCost?             per-unit cost (drives weighted-avg on IN)
 *   batchNo?, remarks?
 *   sourceModule?, refType?, refId?, refNumber?
 *   vendorId?, vendorName?, poId?, poNumber?, piId?, piNumber?
 *   buyer?, enteredQty?, enteredUom?   Scrap Out only (buyer snapshot; figure as typed)
 *   performedBy?          { _id, name }  (or pass performedBy/performedByName)
 *   movementDate?
 * @param {object} opts  { allowNegative?: boolean }
 * @returns {{ movement, stock }}
 */
const createStockMovement = async (input = {}, opts = {}) => {
  const quantity = round2(input.quantity);
  if (!input.skuId) throw new AppError('skuId is required for a stock movement', 400);
  if (!(quantity > 0)) throw new AppError('Movement quantity must be greater than zero', 400);

  const movementType = input.movementType || MOVEMENT_TYPE.IN;
  if (!Object.values(MOVEMENT_TYPE).includes(movementType)) {
    throw new AppError(`Invalid movementType: ${movementType}`, 400);
  }
  const txnType = input.txnType || (movementType === MOVEMENT_TYPE.IN ? TXN_TYPE.ADJUST_IN : TXN_TYPE.ADJUST_OUT);
  const warehouse = (input.warehouse || DEFAULT_WAREHOUSE).trim();
  const unitCost = round2(input.unitCost);
  const sign = movementType === MOVEMENT_TYPE.IN ? 1 : -1;
  const qtyDelta = round2(sign * quantity);
  // Optional secondary weight (RM circles). Absent stays absent all the way to
  // the ledger: null means the source did not state a weight, which is not 0.
  const hasKg = input.quantityKg !== null && input.quantityKg !== undefined && input.quantityKg !== '';
  const quantityKg = hasKg ? round2(input.quantityKg) : null;
  const qtyKgDelta = hasKg ? round2(sign * quantityKg) : null;

  // Fill item identity from the SKU master when not supplied.
  let { skuCode, skuName, unit } = input;
  if (!skuCode || !skuName) {
    const sku = await SKU.findById(input.skuId).select('code name unit').lean();
    if (sku) { skuCode = skuCode || sku.code; skuName = skuName || sku.name; unit = unit || sku.unit; }
  }

  // Get-or-create the stock row for this SKU+warehouse and apply the delta under
  // a version guard, so two simultaneous movements cannot overwrite each other.
  const stock = await applyStockDelta({
    skuId: input.skuId, warehouse, quantity, qtyDelta, qtyKgDelta, movementType, unitCost,
    skuCode, skuName, unit,
    lastMovementAt: input.movementDate || new Date(),
    updatedBy: input.performedBy?._id || input.performedById,
    allowNegative: !!opts.allowNegative,
    session: opts.session,
  });

  const movementNumber = await generateMovementNumber(input.movementDate || new Date());
  const [movement] = await InventoryMovement.create([{
    movementNumber,
    movementDate: input.movementDate || new Date(),
    skuId: input.skuId, skuCode: skuCode || '', skuName: skuName || '', unit: unit || stock.unit,
    warehouse,
    txnType, movementType, quantity, qtyDelta,
    balanceAfter: stock.qtyOnHand,
    // Null unless this movement stated a weight — see the model's note.
    quantityKg, qtyKgDelta,
    balanceKgAfter: hasKg ? round2(stock.qtyOnHandKg || 0) : null,
    unitCost, lineValue: round2(quantity * unitCost),
    batchNo: ledgerText(input.batchNo),
    sourceModule: ledgerText(input.sourceModule),
    refType: ledgerText(input.refType),
    refId: input.refId || undefined,
    refNumber: ledgerText(input.refNumber),
    vendorId: input.vendorId || undefined,
    vendorName: ledgerText(input.vendorName),
    poId: input.poId || undefined,
    poNumber: ledgerText(input.poNumber),
    piId: input.piId || undefined,
    piNumber: ledgerText(input.piNumber),
    // Only manual entries set these; every other caller leaves them blank.
    // ledgerText keeps a missing value out of the ledger as '' rather than as
    // the literal word "undefined", which is what two legacy rows carry.
    reason: ledgerText(input.reason),
    customReason: ledgerText(input.customReason),
    // The other side of a manual movement (Scrap In/Out). Blank for every
    // automated caller, exactly like reason/customReason above.
    partyName: ledgerText(input.partyName),
    // Scrap Out only: the buyer snapshot and the figure as entered. Absent for
    // every other caller, so they are left off the row entirely, not blanked.
    buyer: input.buyer || undefined,
    enteredQty: input.enteredQty ?? undefined,
    enteredUom: input.enteredUom || undefined,
    remarks: ledgerText(input.remarks),
    // Set only by the entry screens, so a replayed submission can be recognised.
    clientRequestId: ledgerText(input.clientRequestId),
    performedBy: input.performedBy?._id || input.performedById,
    performedByName: input.performedBy?.name || input.performedByName || '',
    createdBy: input.performedBy?._id || input.performedById,
  }], opts.session ? { session: opts.session } : undefined);

  return { movement, stock };
};

/**
 * Run a multi-line stock entry as one unit, with replay protection.
 *
 * Everything the IMS entry screens post goes through here: the duplicate-line
 * merge, the idempotency claim, the transaction and the rollback all live in one
 * place so FG and Consumables cannot drift apart on any of them.
 *
 * @param {object} cfg
 *   items*             the request's lines (already filtered to quantity > 0)
 *   clientRequestId?   the submission id, when the caller sent one
 *   mergeDuplicates?   sum repeated SKUs before checking/writing (OUT paths)
 *   meta               { sourceModule, action, performedBy } for the key row
 *   preflight?         async (lines, session) — runs before any write
 *   write*             async (line, session) — writes one line
 * @returns {{ count:number, results:any[], duplicate?:boolean }}
 */
const runStockEntry = async ({ items, clientRequestId, mergeDuplicates, meta, preflight, write }) => {
  const lines = mergeDuplicates ? mergeDuplicateLines(items) : items;
  const key = ledgerText(clientRequestId);

  const claim = await claimRequestKey(key, meta);
  // Still being written by the request that claimed it: not done yet, so this
  // must not report success — and must not write a second time either.
  if (claim.pending) {
    throw new AppError('This entry is still being saved. Give it a moment, then check the stock before saving again.', 409);
  }
  // Already recorded by an earlier, identical submission — say so and write
  // nothing. The caller reports success, because the work IS done.
  if (claim.replay) return { count: claim.count, results: [], duplicate: true };

  try {
    const out = await runAtomically(async (session) => {
      if (preflight) await preflight(lines, session);
      const results = [];
      for (const line of lines) results.push(await write(line, session));
      return { count: results.length, results };
    });
    if (claim.claimed) await settleRequestKey(key, out.count);
    return out;
  } catch (e) {
    // The entry did not happen, so its key must not lock the corrected retry
    // out. Only a claim this request made is released.
    if (claim.claimed) await releaseRequestKey(key);
    throw e;
  }
};

export const inventoryService = {
  createStockMovement,
  runStockEntry,
  runAtomically,
  // The two halves of runStockEntry's idempotency, for callers whose writes are
  // not a uniform list of lines (see rmIms convert).
  claimRequestKey,
  releaseRequestKey,
  settleRequestKey,
  mergeDuplicateLines,
  combineStockRows,
  stockBySkuId,
  ledgerText,

  /** Thin helper: record an IN movement (caller supplies txnType e.g. GRN_IN). */
  increaseStock: (input, opts) => createStockMovement({ ...input, movementType: MOVEMENT_TYPE.IN }, opts),

  /** Thin helper: record an OUT movement. */
  decreaseStock: (input, opts) => createStockMovement({ ...input, movementType: MOVEMENT_TYPE.OUT }, opts),

  // ── Reads (for the future Inventory Ledger screen + traceability) ──
  async getStock(query) {
    const features = new ApiFeatures(InventoryStock.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['skuCode', 'skuName']).sort().select().paginate();
    return features.exec();
  },

  async getStockBySku(skuId) {
    return InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean();
  },

  async getMovements(query) {
    const features = new ApiFeatures(InventoryMovement.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['movementNumber', 'skuCode', 'skuName', 'refNumber', 'poNumber', 'piNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  /**
   * ONE ITEM'S HISTORY — every movement of a SKU, a page at a time, with what
   * came in and went out across ALL of them (not just the page shown).
   *
   * Newest first by the DAY it happened (IST), then by when it was saved
   * within the day: a movement's date is sometimes a bare day and sometimes a
   * full time, and imported rows were all saved on the import day, so neither
   * field alone orders the history as it happened. The module's own reader
   * checks the SKU is one of its items before calling this.
   */
  async getItemLedger(skuId, query = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
    const [agg] = await InventoryMovement.aggregate([
      { $match: { skuId: new mongoose.Types.ObjectId(String(skuId)), isDeleted: { $ne: true } } },
      { $addFields: { _day: { $dateToString: { format: '%Y-%m-%d', date: '$movementDate', timezone: '+05:30' } } } },
      { $sort: { _day: -1, createdAt: -1, _id: -1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { _day: 0 } }],
          totals: [{ $group: { _id: '$movementType', qty: { $sum: '$quantity' }, n: { $sum: 1 } } }],
        },
      },
    ]);
    const byDir = new Map((agg?.totals || []).map((t) => [t._id, t]));
    const total = (byDir.get(MOVEMENT_TYPE.IN)?.n || 0) + (byDir.get(MOVEMENT_TYPE.OUT)?.n || 0);
    return {
      docs: agg?.rows || [],
      pagination: {
        page, limit, total, pages: Math.ceil(total / limit),
        totals: {
          inQty: round2(byDir.get(MOVEMENT_TYPE.IN)?.qty || 0),
          outQty: round2(byDir.get(MOVEMENT_TYPE.OUT)?.qty || 0),
          inCount: byDir.get(MOVEMENT_TYPE.IN)?.n || 0,
          outCount: byDir.get(MOVEMENT_TYPE.OUT)?.n || 0,
        },
      },
    };
  },

  /** Every movement created by a given source document (e.g. a GRN). */
  async getMovementsByRef(refType, refId) {
    return InventoryMovement.find({ refType, refId, isDeleted: { $ne: true } }).sort('createdAt').lean();
  },

  async getStats() {
    const rows = await InventoryStock.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          skuCount:   { $sum: 1 },
          totalQty:   { $sum: '$qtyOnHand' },
          stockValue: { $sum: { $multiply: ['$qtyOnHand', '$avgCost'] } },
        },
      },
    ]);
    return rows[0] || { skuCount: 0, totalQty: 0, stockValue: 0 };
  },

  /** Manual adjustment endpoint (reuses the same engine). */
  async adjust(data, user) {
    const movementType = data.movementType || MOVEMENT_TYPE.IN;
    return createStockMovement({
      ...data,
      movementType,
      txnType: movementType === MOVEMENT_TYPE.IN ? TXN_TYPE.ADJUST_IN : TXN_TYPE.ADJUST_OUT,
      sourceModule: 'INVENTORY',
      refType: 'ADJUSTMENT',
      remarks: data.remarks || 'Manual stock adjustment',
      performedBy: user,
    });
  },
};

export { MOVEMENT_TYPE, TXN_TYPE };
