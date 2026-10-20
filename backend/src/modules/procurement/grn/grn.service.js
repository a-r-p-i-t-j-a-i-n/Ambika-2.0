import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import GoodsReceiptNote, {
  GRN_STATUS, GRN_QC_STATUS, HOW_ITEM_RECEIVED, GRN_INVENTORY_TYPE_LABEL,
  GRN_STOCK_POSTING_STAGE, GRN_LINE_STOCK_STATUS,
} from './grn.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_FOLLOWUP_STATUS, PO_PI_STATUS } from '../purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from '../follow-up/followUp.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import SKU, {
  RM_ITEM_TYPES, INVENTORY_DESTINATION, NON_MATERIAL_ITEM_TYPES, FG_BLOCKED_ITEM_TYPES, inventoryDestinationOf,
} from '../../skus/sku.model.js';
import { inventoryService } from '../../inventory/inventory.service.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateGrnNumber, generateGrnUniqueId } from '../../../utils/docNumberGenerator.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';
import { registerApprovalDocument } from '../../approvals/approval.registry.js';
import { approvalService } from '../../approvals/approval.service.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Coil and Circle must arrive with a batch number; nothing else changes.
 *
 * A batch number is how a coil is identified for the rest of its life — RM
 * batch lookup, the Cut Coils picker and the scrap trail all key off it — so an
 * RM receipt without one cannot be traced back to a physical unit. Every other
 * purchased item keeps its existing optional behaviour.
 *
 * Classified from the SKU master (`SKU.itemType` against RM_ITEM_TYPES), never
 * from the item name: GRN lines carry a free-typed `itemName`, and a coil whose
 * description happens to omit the word would slip straight through a string
 * test. This is the same classification routeGrnLines routes by, so the rule
 * and the posting can never disagree about what "RM" means.
 *
 * Scoped to lines with a received quantity: a draft row with nothing received
 * is not a receipt and has nothing to identify yet.
 *
 * Enforced here rather than in the Joi schema because the schema sees only the
 * request body — it has no way to know a SKU's item type.
 */
const RM_KIND_LABEL = { RAW_MATERIAL: 'Coil', CIRCLE: 'Circle' };

/**
 * SKU item type for each received line, from the SKU master (by skuId, else
 * code). A line with no SKU match returns '' — unclassifiable, so the rules
 * below leave it alone (silence is not evidence of being RM or not).
 */
const resolveLineTypes = async (lines = []) => {
  const up = (v) => String(v || '').trim().toUpperCase();
  const ids = [...new Set(lines.map((l) => l.skuId).filter(Boolean).map(String))];
  const codes = [...new Set(lines.map((l) => up(l.skuCode)).filter(Boolean))];
  if (!ids.length && !codes.length) return () => '';
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (codes.length) or.push({ code: { $in: codes } });
  const skus = await SKU.find({ $or: or }).select('_id code itemType').lean();
  const byId = new Map(skus.map((s) => [String(s._id), s.itemType]));
  const byCode = new Map(skus.map((s) => [up(s.code), s.itemType]));
  return (l) => (l.skuId && byId.get(String(l.skuId))) || byCode.get(up(l.skuCode)) || '';
};

// ── Automatic inventory routing ──────────────────────────────────────────────
// Replaces the manual, one-per-GRN Inventory Type. Every received line is routed
// on its own, from its SKU's itemType (inventoryDestinationOf), so one GRN may
// carry Raw Material and Consumables together. A line that cannot be routed is
// refused with the reason — it is never skipped and never guessed into a module.

/** Why a received line cannot be routed. */
export const ROUTING_PROBLEM = {
  NO_SKU: 'NO_SKU',                   // not linked to any SKU in the master
  NON_MATERIAL: 'NON_MATERIAL',       // Service / Job Work — never received on a GRN
  NOT_PURCHASABLE: 'NOT_PURCHASABLE', // Finished Goods / Scrap
  UNCLASSIFIED: 'UNCLASSIFIED',       // any other itemType no destination exists for
};

const NOT_PURCHASABLE_TYPES = new Set([...FG_BLOCKED_ITEM_TYPES, 'SCRAP']);

/**
 * Where each RECEIVED line's stock lands. Pure and exported so the rule can be
 * read — and tested — without a database.
 *
 *   RM_IMS      warehouse = the GRN's "Received At" (null when none was chosen;
 *               the caller refuses that — no location is ever assumed)
 *   CP_IMS      warehouse = the GRN's own store (MAIN), as it always was
 *   MAIN_STORE  warehouse = the GRN's own store; listed by no IMS screen
 *
 * @param {object[]} lines        GRN lines (lines with receivedQty 0 are left out)
 * @param {Function} typeOf       line -> SKU itemType ('' when no SKU matched)
 * @param {string|null} rmLocation  the GRN's Received At
 * @param {string} grnWarehouse   the GRN's own store
 * @returns {{ line, itemType, destination, isRm, warehouse, problem }[]}
 */
export const routeGrnLines = ({ lines = [], typeOf, rmLocation = null, grnWarehouse = 'MAIN' }) => lines
  .filter((l) => round2(l.receivedQty) > 0)
  .map((line) => {
    const itemType = String(typeOf(line) || '').trim().toUpperCase();
    const destination = inventoryDestinationOf(itemType);
    let problem = null;
    if (!itemType) problem = ROUTING_PROBLEM.NO_SKU;
    else if (NON_MATERIAL_ITEM_TYPES.includes(itemType)) problem = ROUTING_PROBLEM.NON_MATERIAL;
    else if (NOT_PURCHASABLE_TYPES.has(itemType)) problem = ROUTING_PROBLEM.NOT_PURCHASABLE;
    else if (!destination) problem = ROUTING_PROBLEM.UNCLASSIFIED;
    const isRm = destination === INVENTORY_DESTINATION.RM_IMS;
    const warehouse = !destination ? null : (isRm ? (rmLocation || null) : grnWarehouse);
    return { line, itemType, destination, isRm, warehouse, problem };
  });

const names = (routes) => routes.map((r) => `"${r.line.itemName}"`).join(', ');
const isAre = (list) => (list.length > 1 ? 'are' : 'is');

/** The operator-facing refusal for every line a GRN cannot route. */
export const routingProblemMessage = (routes = []) => {
  const of = (p) => routes.filter((r) => r.problem === p);
  const parts = [];
  const nonMaterial = of(ROUTING_PROBLEM.NON_MATERIAL);
  if (nonMaterial.length) {
    parts.push(`${names(nonMaterial)} ${isAre(nonMaterial)} Service / Job Work, not material, and cannot be received on a GRN. `
      + 'Set the received qty to 0 — services are raised as internal-service indents and checked by Service QC.');
  }
  const blocked = of(ROUTING_PROBLEM.NOT_PURCHASABLE);
  if (blocked.length) parts.push(`${names(blocked)}: Finished Goods and Scrap cannot be received from a vendor.`);
  const unclassified = of(ROUTING_PROBLEM.UNCLASSIFIED);
  if (unclassified.length) {
    const types = [...new Set(unclassified.map((r) => r.itemType))].join(', ');
    parts.push(`${names(unclassified)} ${isAre(unclassified)} classified as "${types}" in the SKU master, which has no inventory destination. `
      + 'Correct the Item Type in SKU Master before receiving.');
  }
  const noSku = of(ROUTING_PROBLEM.NO_SKU);
  if (noSku.length) parts.push(`${names(noSku)} ${isAre(noSku)} not linked to a SKU — add it to the SKU master before receiving.`);
  return parts.join(' ');
};

/**
 * Refuse (400) when a received line cannot be routed, or a Raw Material line
 * has no "Received At". On a draft a line may still lack its SKU (the W/O PO
 * form allows a free-typed row until completion); completion passes
 * `requireSku` and refuses that too.
 */
export const assertRoutable = (routes = [], { requireSku = false } = {}) => {
  const blocking = routes.filter((r) => r.problem && (requireSku || r.problem !== ROUTING_PROBLEM.NO_SKU));
  if (blocking.length) throw new AppError(routingProblemMessage(blocking), 400);
  const rmWithoutLocation = routes.filter((r) => r.isRm && !r.warehouse);
  if (rmWithoutLocation.length) {
    throw new AppError(
      `Received At is required — ${names(rmWithoutLocation)} ${isAre(rmWithoutLocation)} Raw Material. `
      + 'Select where it was received (PLG01 — Plant or JW001 — Job work).',
      400,
    );
  }
};

/** Copy each line's routing onto it (display on a draft, fixed at completion). */
const stampRouting = (lines, routes) => {
  const byLine = new Map(routes.map((r) => [r.line, r]));
  return lines.map((l) => {
    const r = byLine.get(l);
    return {
      ...l,
      itemTypeAtReceipt: r?.itemType || '',
      inventoryDestination: r?.destination || null,
      stockWarehouse: r?.warehouse || '',
    };
  });
};

/** '' / undefined Received At → null, so "not chosen" has exactly one spelling. */
const locationOrNull = (v) => (String(v || '').trim() ? String(v).trim().toUpperCase() : null);

/** Route a draft's lines, refuse what cannot be routed, return them stamped. */
const routeDraftLines = async (lines, rmLocation, grnWarehouse) => {
  const received = (lines || []).filter((l) => round2(l.receivedQty) > 0);
  const typeOf = await resolveLineTypes(received);
  const routes = routeGrnLines({ lines, typeOf, rmLocation: locationOrNull(rmLocation), grnWarehouse });
  assertRoutable(routes);
  return stampRouting(lines, routes);
};

const assertRmBatchNumbers = async (lines = []) => {
  const received = (lines || []).filter((l) => round2(l.receivedQty) > 0);
  if (!received.length) return;
  const typeOf = await resolveLineTypes(received);

  const missing = received.filter((l) => RM_ITEM_TYPES.includes(typeOf(l)) && !String(l.batchNo || '').trim());
  if (!missing.length) return;

  const kinds = [...new Set(missing.map((l) => RM_KIND_LABEL[typeOf(l)] || 'Raw Material'))];
  const names = missing.map((l) => `"${l.itemName}"`).join(', ');
  throw new AppError(`Batch Number is required for ${kinds.join(' and ')}. Add it to ${names}.`, 400);
};

const DESTINATION_NOTE = {
  [INVENTORY_DESTINATION.RM_IMS]: 'RM IMS',
  [INVENTORY_DESTINATION.CP_IMS]: 'Consumable & Packaging IMS',
  [INVENTORY_DESTINATION.MAIN_STORE]: 'Main store',
};

/**
 * The completion line in the activity timeline. Says plainly that nothing was
 * stocked yet and where each line will go, because "GRN completed" alone cannot
 * be told apart from "stock posted" six months later.
 */
const buildCompletionNote = (grnStatus, routes, rmLocation) => {
  const byDest = Object.keys(DESTINATION_NOTE)
    .map((d) => [d, routes.filter((r) => r.destination === d).length])
    .filter(([, n]) => n)
    .map(([d, n]) => `${DESTINATION_NOTE[d]}${d === INVENTORY_DESTINATION.RM_IMS ? ` at ${rmLocation}` : ''}: ${n}`);
  return `GRN completed (${grnStatus}) — ${routes.length} line(s) awaiting QC; usable stock posts after the MD signs and Incoming QC completes`
    + (byDest.length ? ` · ${byDest.join(' · ')}` : '');
};

const findOrThrow = async (id) => {
  const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!grn) throw new AppError('GRN not found', 404);
  return grn;
};

// A GRN is editable/deletable/cancellable only while it is an un-posted DRAFT.
// complete() claims a draft by flipping stockPosted first, so `stockPosted`
// also covers a GRN whose completion is in flight.
const isOpenDraft = (grn) => grn.grnStatus === GRN_STATUS.DRAFT && !grn.stockPosted;
const OPEN_DRAFT_FILTER = { grnStatus: GRN_STATUS.DRAFT, stockPosted: { $ne: true } };

/**
 * Save a draft GRN only if it is still an open draft in the database — guards
 * against an edit/delete/cancel landing after a concurrent Complete claimed it.
 */
const saveOpenDraft = async (grn) => {
  grn.$where = OPEN_DRAFT_FILTER;
  try {
    return await grn.save();
  } catch (err) {
    if (err?.name === 'DocumentNotFoundError') {
      throw new AppError('This GRN has just been completed and can no longer be changed', 409);
    }
    throw err;
  }
};

/** Derive per-line short/extra/pending + totals (server-authoritative). */
const computeLines = (items = []) => {
  const lines = items.map((it) => {
    const orderedQty = round2(it.orderedQty);
    const prev = round2(it.previouslyReceivedQty);
    const invoiceQty = round2(it.invoiceQty);
    const receivedQty = round2(it.receivedQty);
    const rate = round2(it.rate);
    const pendingAvailable = Math.max(0, round2(orderedQty - prev)); // before this GRN — read-only, PO-derived
    return {
      ...it,
      orderedQty, previouslyReceivedQty: prev, invoiceQty, receivedQty, rate,
      pendingBeforeGrn: pendingAvailable,
      shortQty: round2(invoiceQty - receivedQty),
      extraQty: Math.max(0, round2(receivedQty - pendingAvailable)),
      pendingQty: Math.max(0, round2(orderedQty - (prev + receivedQty))), // after this GRN
      amount: round2(receivedQty * rate),
    };
  });
  return {
    lines,
    totals: {
      totalOrderedQty:  round2(lines.reduce((s, l) => s + l.orderedQty, 0)),
      totalInvoiceQty:  round2(lines.reduce((s, l) => s + l.invoiceQty, 0)),
      totalReceivedQty: round2(lines.reduce((s, l) => s + l.receivedQty, 0)),
      totalShortQty:    round2(lines.reduce((s, l) => s + l.shortQty, 0)),
      totalValue:       round2(lines.reduce((s, l) => s + l.amount, 0)),
    },
  };
};

// GRN states whose received qty counts toward the PO (stock already posted).
const POSTED_GRN_STATUSES = [GRN_STATUS.RECEIVED, GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED];

/**
 * Match a GRN line back to its PO line, across one or more POs (multi-PO GRN).
 * A line's poItemId is a PO-line's own _id, globally unique, so it can only
 * ever match the one PO that owns it — no ambiguity even across several POs.
 * Only a legacy/manual line with no poItemId falls back to a SKU-code scan,
 * tried PO by PO in selection order (first match wins) — this is the only
 * path where two POs offering an identical SKU could otherwise collide.
 * Returns { po, item } or null.
 */
const matchAcrossPos = (pos = [], line) => {
  if (line.poItemId) {
    for (const po of pos) {
      const item = (po.items || []).find((p) => String(p._id) === String(line.poItemId));
      if (item) return { po, item };
    }
  }
  for (const po of pos) {
    const item = (po.items || []).find((p) => p.skuCode && line.skuCode
      && String(p.skuCode).trim().toUpperCase() === String(line.skuCode).trim().toUpperCase());
    if (item) return { po, item };
  }
  return null;
};

/**
 * Received qty per PO line, summed from the completed GRNs of one or more POs
 * — the source of truth for "already received" (drafts and cancelled GRNs
 * never count). Keyed by `${poId}|${poItemId}` so identical SKUs on different
 * POs never collide.
 */
const receivedByPoLines = async (pos = []) => {
  const poIds = pos.map((p) => p._id);
  const grns = await GoodsReceiptNote.find({
    $or: [{ poId: { $in: poIds } }, { poIds: { $in: poIds } }],
    isDeleted: { $ne: true }, grnStatus: { $in: POSTED_GRN_STATUSES },
  }).select('items.poItemId items.skuCode items.receivedQty').lean();
  const received = new Map();
  for (const po of pos) for (const p of (po.items || [])) received.set(`${po._id}|${p._id}`, 0);
  for (const g of grns) {
    for (const l of g.items || []) {
      const m = matchAcrossPos(pos, l);
      if (m) {
        const key = `${m.po._id}|${m.item._id}`;
        received.set(key, round2((received.get(key) || 0) + (Number(l.receivedQty) || 0)));
      }
    }
  }
  return received;
};

/**
 * Rebuild GRN lines with ordered / previously-received qty taken from the
 * current PO(s) + completed GRNs — never from the client. Only the physical
 * receipt fields (invoice/received qty, batch, remarks) come from `items`.
 * Each line is resolved against whichever of `pos` it actually belongs to and
 * stamped with that PO's own poId/poNumber.
 */
const snapshotFromPos = (pos, received, items = []) => {
  const seen = new Set();
  return items.map((it) => {
    const m = matchAcrossPos(pos, it);
    if (!m) throw new AppError(`"${it.itemName}" is not a line on any selected PO`, 400);
    const { po, item: p } = m;
    const key = `${po._id}|${p._id}`;
    if (seen.has(key)) throw new AppError(`"${p.itemName}" appears more than once in this GRN`, 400);
    seen.add(key);
    return {
      ...it,
      poItemId: p._id, poId: po._id, poNumber: po.poNumber,
      skuId: it.skuId || p.skuId, skuCode: it.skuCode || p.skuCode, unit: it.unit || p.unit,
      orderedQty: p.quantity || 0,
      previouslyReceivedQty: received.get(key) || 0,
    };
  });
};

const plain = (doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc);

/** Re-derive a GRN's PO-based figures against the current database state (one or more POs). */
const refreshLines = async (pos, items) => {
  const received = await receivedByPoLines(pos);
  return computeLines(snapshotFromPos(pos, received, (items || []).map(plain)));
};

const PO_LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Claim the per-PO GRN posting lock for every given PO at once — an
 * all-or-nothing atomic `updateMany` claim (the same idiom
 * `withQcInvoiceLock` uses for a set of QCs), not a sequential loop, so there
 * is no lock-ordering/deadlock concern between two multi-PO GRNs sharing POs.
 * Returns the claim timestamp, or null if not every PO could be claimed (and
 * releases whatever was claimed this attempt).
 */
const acquirePoLocks = async (poIds) => {
  if (!poIds.length) return null;
  const now = new Date();
  const res = await VendorPurchaseOrder.updateMany(
    {
      _id: { $in: poIds },
      $or: [{ grnPostingLockAt: null }, { grnPostingLockAt: { $lt: new Date(now.getTime() - PO_LOCK_TTL_MS) } }],
    },
    { $set: { grnPostingLockAt: now } },
  );
  if (res.modifiedCount !== poIds.length) {
    await VendorPurchaseOrder.updateMany({ _id: { $in: poIds }, grnPostingLockAt: now }, { $set: { grnPostingLockAt: null } }).catch(() => {});
    return null;
  }
  return now;
};

const releasePoLocks = (poIds, lockedAt) => VendorPurchaseOrder.updateMany(
  { _id: { $in: poIds }, grnPostingLockAt: lockedAt },
  { $set: { grnPostingLockAt: null } },
).catch((err) => logger.error(`[grn] failed to release PO lock(s) ${poIds.join(',')}: ${err.message}`));

const isVersionConflict = (err) => err?.name === 'VersionError' || err?.name === 'ParallelSaveError';

// ─────────────────────────────────────────────────────────────
// PDF — Goods Receiving & Inspection Report (A4)
// ─────────────────────────────────────────────────────────────
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildGrnPdfBuffer = (grn, company = {}, signature = null) => new Promise((resolve, reject) => {
  try {
    const M = 40;
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = 595.28 - M * 2;
    const navy = '#0b2545'; const blue = '#1d4ed8'; const line = '#dbe4f3';

    // ── Header band: two fixed columns — company info (left ~58%), title (right) ──
    // The band is measured first so the company address wraps within the left
    // column and never overlaps the right-aligned report title.
    const PW = 595.28;
    const leftX = M;
    const leftW = 300;                       // left column (company) — wraps here only
    const titleX = M + 312;                  // 12px gutter after the left column
    const titleW = PW - M - titleX;          // right column (title) — wraps here only
    const padTop = 16;

    const nameStr = company.name || env.COMPANY_NAME || '';
    const addrStr = company.address || env.COMPANY_ADDRESS || '';
    const gstStr = company.gstin ? `GSTIN: ${company.gstin}` : '';
    const emailStr = company.email || env.COMPANY_EMAIL || '';
    const TITLE = 'GOODS RECEIVING & INSPECTION REPORT';

    const nameH = doc.font('Helvetica-Bold').fontSize(16).heightOfString(nameStr, { width: leftW });
    doc.font('Helvetica').fontSize(8.5);
    const addrH = addrStr ? doc.heightOfString(addrStr, { width: leftW }) : 0;
    const titleH = doc.font('Helvetica-Bold').fontSize(14).heightOfString(TITLE, { width: titleW, align: 'right' });

    let leftBottom = padTop + nameH + 4 + addrH;
    if (gstStr) leftBottom += 12;
    if (emailStr) leftBottom += 12;
    const HEADER_H = Math.max(90, leftBottom, padTop + titleH) + 12;

    doc.rect(0, 0, PW, HEADER_H).fill(navy);
    // Left column — name + wrapping address + gstin + email.
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(16).text(nameStr, leftX, padTop, { width: leftW });
    let hy = padTop + nameH + 4;
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
    if (addrStr)  { doc.text(addrStr, leftX, hy, { width: leftW }); hy += addrH; }
    if (gstStr)   { doc.text(gstStr, leftX, hy, { width: leftW }); hy += 12; }
    if (emailStr) { doc.text(emailStr, leftX, hy, { width: leftW }); hy += 12; }
    // Right column — report title (right-aligned, vertically centred in the band).
    doc.font('Helvetica-Bold').fontSize(14).fill('#ffffff')
      .text(TITLE, titleX, Math.max(padTop, (HEADER_H - titleH) / 2), { width: titleW, align: 'right' });

    let y = HEADER_H + 16;
    const half = W / 2 - 8;
    // ── GRN details + supplier cards — both sized to the taller column so the
    // supplier address can wrap fully instead of being clipped. ──
    const cardTop = y;
    const liX = M + 10;
    const riX = M + half + 16 + 10;
    const cardInnerW = half - 20;

    // Measure the supplier (right) column — vendor name + wrapping address.
    const vNameH = doc.font('Helvetica-Bold').fontSize(10.5).heightOfString(grn.vendorName || '—', { width: cardInnerW });
    doc.font('Helvetica').fontSize(8.5);
    const vAddrStr = grn.vendorAddress || '';
    const vAddrH = vAddrStr ? doc.heightOfString(vAddrStr, { width: cardInnerW - 42 }) : 11;

    const leftBottomY = 66 + 13;                                  // last GRN line bottom
    const rightBottomY = 22 + vNameH + 4 + 12 + Math.max(11, vAddrH);
    const cardH = Math.max(86, leftBottomY, rightBottomY) + 8;

    doc.roundedRect(M, cardTop, half, cardH, 6).stroke(line);
    doc.roundedRect(M + half + 16, cardTop, half, cardH, 6).stroke(line);

    // LEFT — GRN DETAILS
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('GRN DETAILS', liX, cardTop + 9);
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(grn.grnNumber || '', liX, cardTop + 22, { width: cardInnerW });
    const poNoLabel = grn.isWithoutPo
      ? 'Without PO'
      : ((grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ') || '—');
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Date: ${fmtDate(grn.grnDate)}`, liX, cardTop + 40)
      .text(`PO No: ${poNoLabel}`, liX, cardTop + 53, { width: cardInnerW })
      .text(`Challan No: ${grn.challanNumber || '—'}`, liX, cardTop + 66);

    // RIGHT — SUPPLIER (fixed label column → labels + values align, address wraps)
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('SUPPLIER', riX, cardTop + 9);
    let ry = cardTop + 22;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy).text(grn.vendorName || '—', riX, ry, { width: cardInnerW }); ry += vNameH + 4;
    const sLabelW = 42, sValX = riX + sLabelW, sValW = cardInnerW - sLabelW;
    doc.font('Helvetica').fontSize(8.5);
    doc.fill('#475a8a').text('GST', riX, ry); doc.fill(navy).text(grn.vendorGST || '—', sValX, ry, { width: sValW }); ry += 12;
    doc.fill('#475a8a').text('Address', riX, ry); doc.fill(navy).text(vAddrStr || '—', sValX, ry, { width: sValW });

    y = cardTop + cardH + 14;

    // Items table.
    const cols = [
      { key: 'sr', label: 'SR', w: 26, align: 'center' },
      { key: 'name', label: 'DESCRIPTION OF GOODS', w: 220, align: 'left' },
      { key: 'invoice', label: 'INVOICE QTY', w: 80, align: 'right' },
      { key: 'received', label: 'RECEIVED QTY', w: 90, align: 'right' },
      { key: 'unit', label: 'UNIT', w: W - 26 - 220 - 80 - 90, align: 'center' },
    ];
    const drawHead = () => {
      doc.rect(M, y, W, 20).fill(navy);
      let x = M; doc.font('Helvetica-Bold').fontSize(7.5).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 4, y + 6.5, { width: c.w - 8, align: c.align }); x += c.w; });
      y += 20;
    };
    drawHead();
    const nameCol = cols.find((c) => c.key === 'name');
    const PADY = 5;
    // A multi-PO GRN shows each line's own PO number — a single-PO (or W/O PO)
    // GRN's layout is completely unaffected (nothing extra is ever drawn).
    const isMultiPo = !grn.isWithoutPo && (grn.poNumbers?.length || 0) > 1;
    (grn.items || []).forEach((it, i) => {
      // Measure the description: item name (primary) + optional batch / PO line
      // (secondary). Row height auto-adjusts so long names wrap cleanly.
      const itemName = it.itemName || '';
      const subParts = [];
      if (isMultiPo && it.poNumber) subParts.push(`PO: ${it.poNumber}`);
      if (it.batchNo) subParts.push(`Batch: ${it.batchNo}`);
      const subStr = subParts.join('  ·  ');
      doc.font('Helvetica').fontSize(8.5);
      const nameH = doc.heightOfString(itemName, { width: nameCol.w - 8 });
      const subH = subStr ? 10 : 0;
      const rowH = Math.max(18, nameH + subH + PADY * 2 - 2);

      if (y + rowH > 770) { doc.addPage(); y = M; drawHead(); }
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill('#f8fafc');

      const cells = { sr: String(i + 1), invoice: String(it.invoiceQty || 0), received: String(it.receivedQty || 0), unit: it.unit || 'Pcs' };
      let x = M;
      cols.forEach((c) => {
        if (c.key === 'name') {
          doc.font('Helvetica').fontSize(8.5).fill(navy).text(itemName, x + 4, y + PADY, { width: c.w - 8 });
          if (subStr) {
            doc.font('Helvetica').fontSize(7).fill('#64748b').text(subStr, x + 8, y + PADY + nameH + 1, { width: c.w - 12 });
          }
        } else {
          doc.font('Helvetica').fontSize(8.5).fill(navy).text(cells[c.key], x + 4, y + PADY, { width: c.w - 8, align: c.align, ellipsis: true });
        }
        x += c.w;
      });
      doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    y += 16;
    if (y > 700) { doc.addPage(); y = M; }
    const invoiceReceived = grn.invoiceNumber ? 'Yes' : 'No';
    doc.font('Helvetica-Bold').fontSize(8.5).fill(navy).text(`Invoice Received: ${invoiceReceived}`, M, y);
    doc.font('Helvetica').fontSize(8.5).text(`Invoice No: ${grn.invoiceNumber || '—'}   How Received: ${(grn.howItemReceived || '').replace(/_/g, ' ')}`, M, y + 14);
    doc.font('Helvetica-Bold').fontSize(8.5).text('Remarks:', M, y + 34);
    doc.font('Helvetica').fontSize(8.5).text(grn.remarks || '—', M, y + 47, { width: W - 180 });

    doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(`For ${company.name || env.COMPANY_NAME}`, M + W - 180, y + 30, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(`Prepared By: ${grn.preparedBy || grn.receivedBy || '—'}`, M + W - 180, y + 70, { width: 180, align: 'center' });

    // ── MD Approval block (Digital Approval & Signature engine) — always
    // rendered so the unsigned PDF shows exactly where the signature will
    // land; a signature image fills the placeholder once signed. ──
    let ay = y + 100;
    if (ay + 110 > 780) { doc.addPage(); ay = M; }
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('APPROVED BY (MD)', M, ay);
    if (signature?.imageBuffer) {
      doc.image(signature.imageBuffer, M, ay + 14, { width: 140, height: 50, fit: [140, 50] });
    } else {
      doc.roundedRect(M, ay + 14, 140, 50, 4).dash(3, { space: 2 }).stroke(line).undash();
      doc.font('Helvetica').fontSize(7).fill('#94a3b8').text('Signature will appear here', M + 8, ay + 34, { width: 124 });
    }
    doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(signature?.signedByName || '—', M, ay + 70);
    doc.font('Helvetica').fontSize(8).fill('#475a8a').text(signature?.designation || 'Managing Director', M, ay + 83);
    if (signature?.signedAt) {
      const t = new Date(signature.signedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      doc.font('Helvetica').fontSize(7.5).fill('#475a8a').text(`${fmtDate(signature.signedAt)} · ${t}`, M, ay + 95);
    }

    doc.end();
  } catch (err) { reject(err); }
});

/** Resolve the company profile once, for the approval engine's PDF adapter. */
const resolveCompanyForApproval = async () => {
  try {
    const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
    const s = await CompanySettings.findOne().lean();
    if (s) return { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
  } catch { /* env fallback */ }
  return {};
};

// Wire GRN into the generic Digital Approval & Signature engine (see
// modules/approvals) — the engine calls back into this adapter, it never
// contains GRN-specific logic itself.
registerApprovalDocument('GRN', {
  model: GoodsReceiptNote,
  numberField: 'grnNumber',
  mirrorStatusField: 'approvalStatus',
  pdfUrlField: 'grnPdfUrl',
  pdfFileNameField: 'grnPdfFileName',
  uploadFolder: 'grns',
  buildPdfBuffer: async (grn, opts) => {
    const company = await resolveCompanyForApproval();
    return buildGrnPdfBuffer(grn, company, opts?.signature || null);
  },
});

// GRN can proceed once the PI step is settled: either no PI was ever created
// (NOT_RECEIVED — a PI is optional and can still be added later), it was
// explicitly marked Not Required, or its advance payment is complete. A PI
// that was actually created and is still in progress (PI_RECEIVED / PI_APPROVED
// / READY_FOR_ADVANCE_PAYMENT) still blocks until it's resolved.
// Kept in sync with fmsCatalog.js's GRN task filter — see its comment.
export const isPiSettledForGrn = (piStatus) =>
  [PO_PI_STATUS.NOT_RECEIVED, PO_PI_STATUS.PAYMENT_COMPLETED, PO_PI_STATUS.PI_NOT_REQUIRED].includes(piStatus);

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

export const grnService = {
  async create(data, user) {
    if (data.isWithoutPo) return this.createWithoutPo(data, user);

    // One PO (legacy) or many (multi-PO GRN) — all must share one vendor.
    const rawIds = data.poIds?.length ? data.poIds : (data.poId ? [data.poId] : []);
    if (!rawIds.length) throw new AppError('Select at least one Purchase Order', 400);
    const poIdList = uniq(rawIds);
    if (poIdList.length !== rawIds.length) throw new AppError('The same Purchase Order was selected more than once', 400);

    const pos = await VendorPurchaseOrder.find({ _id: { $in: poIdList }, isDeleted: { $ne: true } });
    if (pos.length !== poIdList.length) throw new AppError('One or more selected Purchase Orders were not found', 404);
    if (uniq(pos.map((p) => p.vendorId)).length > 1) {
      throw new AppError('All selected Purchase Orders must belong to the same vendor', 400);
    }

    // Rule 1/1b: gate each PO independently — material followed up to
    // READY_FOR_GRN, PI settled, Final Material Date present, not already fully
    // received. A multi-PO GRN only proceeds once every selected PO qualifies.
    for (const po of pos) {
      if (po.followUpStatus !== PO_FOLLOWUP_STATUS.READY_FOR_GRN || !isPiSettledForGrn(po.piStatus)) {
        throw new AppError(`PO ${po.poNumber}: GRN can only be created when the PO is READY_FOR_GRN and its PI is completed or marked Not Required`, 400);
      }
      if (po.poStatus !== PO_STATUS.PARTIAL_RECEIVED) {
        let hasFinalMaterialDate = !!(po.readyForGrnAt && po.finalMaterialDate);
        if (po.readyForGrnAt && !po.finalMaterialDate) {
          const fu = await PurchaseFollowUp.findOne({
            poId: po._id, isDeleted: { $ne: true }, finalMaterialDate: { $ne: null },
          }).sort('-updatedAt').select('finalMaterialDate').lean();
          hasFinalMaterialDate = !!fu?.finalMaterialDate;
        }
        if (!hasFinalMaterialDate) {
          throw new AppError(`PO ${po.poNumber}: Final Material Date is required before creating a GRN.`, 400);
        }
      }
      if (po.poStatus === PO_STATUS.FULLY_RECEIVED) {
        throw new AppError(`PO ${po.poNumber} is already fully received`, 400);
      }
    }

    // Rule 2: auto-load lines from every PO (pending only). Ordered / already
    // received qty always come from the POs + their completed GRNs, never the client.
    const received = await receivedByPoLines(pos);
    const sourceItems = data.items?.length ? snapshotFromPos(pos, received, data.items) : pos.flatMap((po) => (po.items || [])
      .filter((it) => round2((it.quantity || 0) - (received.get(`${po._id}|${it._id}`) || 0)) > 0)
      .map((it) => {
        const prev = received.get(`${po._id}|${it._id}`) || 0;
        const pending = round2((it.quantity || 0) - prev);
        return {
          // For JSL, itemName is the "Grade Width Finish" label that should be
          // shown as the Item Description; itemDescription only holds the raw
          // indent item name and is not used for display.
          poItemId: it._id, poId: po._id, poNumber: po.poNumber,
          skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
          orderedQty: it.quantity, previouslyReceivedQty: prev,
          invoiceQty: pending, receivedQty: pending, rate: it.rate, batchNo: '', remarks: '',
        };
      }));
    if (!sourceItems.length) throw new AppError('Nothing left to receive on the selected PO(s)', 400);

    await assertPurchasable(sourceItems);
    await assertRmBatchNumbers(sourceItems);
    const computed = computeLines(sourceItems);
    // Destination per line from the SKU master; refuses Service / Job Work,
    // unclassified SKUs and Raw Material without an explicit Received At.
    const lines = await routeDraftLines(computed.lines, data.rmReceivedAtLocation, data.warehouse || 'MAIN');
    const { totals } = computed;

    const grnNumber = await generateGrnNumber(data.grnDate || new Date());
    const uniqueId = await generateGrnUniqueId();

    const primary = pos[0];
    const grn = await GoodsReceiptNote.create({
      grnNumber, uniqueId,
      grnDate: data.grnDate || new Date(),
      poId: primary._id, poNumber: primary.poNumber,
      poIds: pos.map((p) => p._id), poNumbers: pos.map((p) => p.poNumber),
      piId: primary.piId || undefined, piNumber: primary.piNumber || '',
      indentId: primary.indentId, indentNumber: primary.indentNumber,
      vendorId: primary.vendorId, vendorName: primary.vendorName, vendorGST: primary.vendorGST,
      vendorAddress: primary.vendorAddress, vendorPhone: primary.vendorPhone,
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      invoiceDate: data.invoiceDate || null,
      vehicleNumber: data.vehicleNumber || '',
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      warehouse: data.warehouse || 'MAIN',
      // Where the Raw Material lines physically landed. `warehouse` above is the
      // GRN's own store and stays MAIN — the two are never mapped onto each other.
      // The retired Inventory Type / Add to RM Stock stay at their defaults.
      rmReceivedAtLocation: locationOrNull(data.rmReceivedAtLocation),
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      challanDocument: data.challanDocument?.fileUrl ? { ...data.challanDocument, uploadedAt: new Date() } : undefined,
      invoiceDocument: data.invoiceDocument?.fileUrl ? { ...data.invoiceDocument, uploadedAt: new Date() } : undefined,
      items: lines,
      ...totals,
      grnStatus: GRN_STATUS.DRAFT,
      qcStatus: GRN_QC_STATUS.PENDING,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `GRN created for ${pos.map((p) => p.poNumber).join(', ')}`, actorId: user?._id }],
    });
    return grn;
  },

  /**
   * Create a GRN with no Purchase Order at all — vendor and items are entered
   * by hand instead of sourced from a PO. None of the PO-gated rules in
   * create() apply (follow-up status, PI settlement, final material date):
   * there is no PO lifecycle to be gated against. Every PO-derived figure on
   * each line (orderedQty, previouslyReceivedQty, pendingBeforeGrn, extraQty,
   * pendingQty) is fixed at 0/N-A — never fabricated — so the over-receipt gate
   * in complete() (which exists to catch receiving beyond a PO's pending qty)
   * never fires for a receipt that has no PO to be "over" against.
   */
  async createWithoutPo(data, user) {
    const sourceItems = (data.items || []).map((it) => ({
      skuId: it.skuId || undefined, skuCode: it.skuCode?.trim() || '', itemName: it.itemName.trim(),
      unit: it.unit || 'Pcs', orderedQty: 0, previouslyReceivedQty: 0,
      invoiceQty: round2(it.invoiceQty ?? it.receivedQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
    }));
    if (!sourceItems.length) throw new AppError('Add at least one item to receive', 400);

    await assertPurchasable(sourceItems);
    await assertRmBatchNumbers(sourceItems);
    const computed = computeLines(sourceItems);
    const lines = await routeDraftLines(computed.lines, data.rmReceivedAtLocation, data.warehouse || 'MAIN');
    const { totals } = computed;
    // No PO to compare against — these columns are not applicable, never derived.
    lines.forEach((l) => { l.orderedQty = 0; l.previouslyReceivedQty = 0; l.pendingBeforeGrn = 0; l.extraQty = 0; l.pendingQty = 0; });

    const grnNumber = await generateGrnNumber(data.grnDate || new Date());
    const uniqueId = await generateGrnUniqueId();

    const grn = await GoodsReceiptNote.create({
      grnNumber, uniqueId,
      grnDate: data.grnDate || new Date(),
      poId: null, poNumber: '', isWithoutPo: true,
      piId: undefined, piNumber: '', indentId: undefined, indentNumber: '',
      vendorId: data.vendorId, vendorName: data.vendorName.trim(),
      vendorGST: data.vendorGST || '', vendorAddress: data.vendorAddress || '', vendorPhone: data.vendorPhone || '',
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      invoiceDate: data.invoiceDate || null,
      vehicleNumber: data.vehicleNumber || '',
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      warehouse: data.warehouse || 'MAIN',
      rmReceivedAtLocation: locationOrNull(data.rmReceivedAtLocation),
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      challanDocument: data.challanDocument?.fileUrl ? { ...data.challanDocument, uploadedAt: new Date() } : undefined,
      invoiceDocument: data.invoiceDocument?.fileUrl ? { ...data.invoiceDocument, uploadedAt: new Date() } : undefined,
      items: lines,
      ...totals,
      grnStatus: GRN_STATUS.DRAFT,
      qcStatus: GRN_QC_STATUS.PENDING,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: 'GRN created without a Purchase Order (W/O PO)', actorId: user?._id }],
    });
    return grn;
  },

  async getAll(query) {
    const features = new ApiFeatures(GoodsReceiptNote.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['grnNumber', 'poNumber', 'vendorName', 'invoiceNumber', 'uniqueId'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name').lean();
    if (!grn) throw new AppError('GRN not found', 404);
    // An open draft's "already received / pending" snapshot goes stale as other
    // GRNs on the same PO complete — show it against the current PO state. A
    // W/O PO GRN has no PO to refresh against; its lines are final as saved.
    if (isOpenDraft(grn) && !grn.isWithoutPo) {
      try {
        const poIds = grn.poIds?.length ? grn.poIds : [grn.poId];
        const pos = await VendorPurchaseOrder.find({ _id: { $in: poIds }, isDeleted: { $ne: true } }).lean();
        if (pos.length) {
          const { lines, totals } = await refreshLines(pos, grn.items);
          Object.assign(grn, totals, { items: lines });
        }
      } catch (err) {
        logger.warn(`[grn] could not refresh draft ${grn.grnNumber} against its PO(s): ${err.message}`);
      }
    }
    return grn;
  },

  async getByPo(poId) {
    // A multi-PO GRN must still show up on every one of its POs' own pages —
    // not just its primary (first-selected) PO.
    return GoodsReceiptNote.find({
      $or: [{ poId }, { poIds: poId }], isDeleted: { $ne: true },
    }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await GoodsReceiptNote.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          partialReceived: { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.PARTIAL_RECEIVED] }, 1, 0] } },
          fullyReceived:   { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.FULLY_RECEIVED] }, 1, 0] } },
          draft:           { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.DRAFT] }, 1, 0] } },
          cancelled:       { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.CANCELLED] }, 1, 0] } },
          // Only completed GRNs have actually received anything.
          receivedQty:     { $sum: { $cond: [{ $in: ['$grnStatus', POSTED_GRN_STATUSES] }, '$totalReceivedQty', 0] } },
        },
      },
    ]);
    // Pending is a PO-level figure: ordered − received, per line, over POs that
    // are still awaiting material (counted once per PO, not once per GRN).
    const pendingRows = await VendorPurchaseOrder.aggregate([
      { $match: { isDeleted: { $ne: true }, poStatus: { $in: [PO_STATUS.RELEASED_TO_VENDOR, PO_STATUS.PARTIAL_RECEIVED] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: null,
          pendingQty: { $sum: { $max: [0, { $subtract: [{ $ifNull: ['$items.quantity', 0] }, { $ifNull: ['$items.receivedQty', 0] }] }] } },
        },
      },
    ]);
    const stats = rows[0] || { total: 0, partialReceived: 0, fullyReceived: 0, draft: 0, cancelled: 0, receivedQty: 0 };
    return { ...stats, pendingQty: round2(pendingRows[0]?.pendingQty || 0) };
  },

  async update(id, data, user) {
    const grn = await findOrThrow(id);
    if (grn.approvalStatus === 'MD_APPROVED') {
      grn.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Edit blocked — GRN is MD-signed and locked', actorId: user?._id });
      await grn.save();
      throw new AppError('This GRN has been digitally signed by the MD and is locked for editing', 400);
    }
    if (!isOpenDraft(grn)) throw new AppError('Only draft GRNs can be edited', 400);
    const {
      items, challanDocument, invoiceDocument,
      vendorId, vendorName, vendorGST, vendorAddress, vendorPhone,
      ...rest
    } = data;
    Object.assign(grn, rest);
    // Vendor snapshot is editable only on a W/O PO draft — a PO-backed GRN's
    // vendor always mirrors its PO and is never edited independently of it.
    if (grn.isWithoutPo) {
      if (vendorId !== undefined) grn.vendorId = vendorId || undefined;
      if (vendorName !== undefined) grn.vendorName = vendorName || '';
      if (vendorGST !== undefined) grn.vendorGST = vendorGST || '';
      if (vendorAddress !== undefined) grn.vendorAddress = vendorAddress || '';
      if (vendorPhone !== undefined) grn.vendorPhone = vendorPhone || '';
    }
    if (data.rmReceivedAtLocation !== undefined) grn.rmReceivedAtLocation = locationOrNull(data.rmReceivedAtLocation);
    if (challanDocument) grn.challanDocument = challanDocument.fileUrl ? { ...challanDocument, uploadedAt: new Date() } : {};
    if (invoiceDocument) grn.invoiceDocument = invoiceDocument.fileUrl ? { ...invoiceDocument, uploadedAt: new Date() } : {};
    if (items) {
      await assertPurchasable(items);
      await assertRmBatchNumbers(items);
      if (grn.isWithoutPo) {
        const sourceItems = items.map((it) => ({ ...it, orderedQty: 0, previouslyReceivedQty: 0 }));
        const { lines, totals } = computeLines(sourceItems);
        lines.forEach((l) => { l.pendingBeforeGrn = 0; l.extraQty = 0; l.pendingQty = 0; });
        grn.items = lines;
        Object.assign(grn, totals);
      } else {
        const poIds = grn.poIds?.length ? grn.poIds : [grn.poId];
        const pos = await VendorPurchaseOrder.find({ _id: { $in: poIds }, isDeleted: { $ne: true } }).lean();
        if (!pos.length) throw new AppError('Linked Purchase Order not found', 404);
        const { lines, totals } = await refreshLines(pos, items);
        grn.items = lines;
        Object.assign(grn, totals);
      }
    }
    // Every save re-derives each line's destination from the SKU master (lines
    // as sent, or as stored) and refuses what cannot be routed.
    grn.items = await routeDraftLines(grn.items.map(plain), grn.rmReceivedAtLocation, grn.warehouse || 'MAIN');
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'UPDATE', description: 'Draft GRN updated', actorId: user?._id });
    return saveOpenDraft(grn);
  },

  async remove(id, user) {
    const grn = await findOrThrow(id);
    if (!isOpenDraft(grn)) {
      throw new AppError('Only draft GRNs can be deleted', 400);
    }
    grn.isDeleted = true;
    grn.deletedAt = new Date();
    grn.deletedBy = user?._id;
    grn.activityTimeline.push({ action: 'DELETE', description: 'GRN deleted', actorId: user?._id });
    return saveOpenDraft(grn);
  },

  /**
   * Complete a GRN: update PO + PI quantities, roll receipt status, fix each
   * received line's inventory destination, generate the GRN PDF, request the MD
   * signature and leave qcStatus PENDING for Step 1.9 Incoming QC.
   *
   * NO usable stock is posted here (stockPostingStage QC_COMPLETION): each
   * line is marked AWAITING_QC and its accepted qty posts when its Incoming QC
   * completes, after the MD has signed (incomingQc.service). Idempotent: the
   * draft is claimed atomically (DRAFT + stockPosted:false → stockPosted:true)
   * before anything is written, so of two concurrent/double-submitted completes
   * only one can ever roll the PO quantities.
   */
  async complete(id, data, user) {
    // ── 0) Claim the completion, atomically ──────────────────────────────────
    // Whoever flips stockPosted false→true owns the posting and everyone else is
    // told it is already done, so a double-click, a retry, a second tab or two
    // users cannot produce a second set of movements. The claim sits OUTSIDE the
    // transaction below, so it still answers a replay when the transaction
    // retries internally.
    const grn = await GoodsReceiptNote.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true }, ...OPEN_DRAFT_FILTER },
      { $set: { stockPosted: true } },
      { new: true },
    );
    if (!grn) {
      const current = await findOrThrow(id); // 404 when it genuinely is not there
      if (current.grnStatus !== GRN_STATUS.DRAFT) throw new AppError('Only draft GRNs can be completed', 400);
      throw new AppError('This GRN has already been completed', 400);
    }
    // Hand the draft back (still DRAFT, editable) when completion fails before
    // any stock landed, so the user can correct it and complete again.
    const releaseClaim = () => GoodsReceiptNote.updateOne(
      { _id: grn._id, grnStatus: GRN_STATUS.DRAFT },
      { $set: { stockPosted: false } },
    ).catch(() => {});

    // Second line of defence behind the claim: if movements already exist for
    // this GRN then something posted them outside this path, and nothing more
    // should be written.
    const existing = await inventoryService.getMovementsByRef('GRN', grn._id);
    if (existing.length) throw new AppError('Inventory movements already exist for this GRN', 400);

    // Serialise completions per PO: of two GRNs racing for the same remaining
    // qty, the second waits for (and is validated against) the first. A W/O PO
    // GRN has no PO to serialise against — the claim above already makes this
    // GRN's own completion safe against concurrent/double-submission.
    const poIds = grn.poIds?.length ? grn.poIds : (grn.poId ? [grn.poId] : []);
    let poLockedAt = null;
    if (poIds.length) {
      poLockedAt = await acquirePoLocks(poIds);
      if (!poLockedAt) {
        await releaseClaim();
        throw new AppError('Another GRN for one of these PO(s) is being completed right now. Please try again in a moment.', 409);
      }
    }
    try {
      return await this._completeLocked(grn, data, user, releaseClaim);
    } finally {
      if (poIds.length) await releasePoLocks(poIds, poLockedAt);
    }
  },

  /** complete() body — runs with the GRN claimed and the PO posting lock(s) held. */
  async _completeLocked(grn, data, user, releaseClaim) {
    let pos = []; let piIdForLine = () => null; let receivedLines; let routes; let rmLocation;
    try {
      if (grn.isWithoutPo) {
        // No PO to re-derive figures against — the lines are final as saved,
        // beyond re-deriving amount/short/extra from the stored qty/rate.
        pos = [];
        const sourceItems = grn.items.map((it) => ({ ...plain(it), orderedQty: 0, previouslyReceivedQty: 0 }));
        const { lines, totals } = computeLines(sourceItems);
        lines.forEach((l) => { l.pendingBeforeGrn = 0; l.extraQty = 0; l.pendingQty = 0; });
        grn.items = lines;
        Object.assign(grn, totals);
      } else {
        const poIds = grn.poIds?.length ? grn.poIds : [grn.poId];
        pos = await VendorPurchaseOrder.find({ _id: { $in: poIds }, isDeleted: { $ne: true } });
        if (!pos.length) throw new AppError('Linked Purchase Order not found', 404);

        // Re-derive ordered / already-received / pending from the current DB state
        // — the draft's snapshot may predate other GRNs completed on these PO(s).
        const { lines, totals } = await refreshLines(pos, grn.items);
        grn.items = lines;
        Object.assign(grn, totals);
      }

      receivedLines = grn.items.filter((it) => round2(it.receivedQty) > 0);
      if (!receivedLines.length) throw new AppError('Enter a received quantity on at least one item', 400);

      // Last gates before anything is written. create()/update() already enforce
      // these, but a draft saved before a rule existed can still reach completion.
      await assertPurchasable(receivedLines);
      await assertRmBatchNumbers(receivedLines);

      // Rule 6: extra receipt (beyond the CURRENT pending qty) must be explicitly
      // allowed by the user and carry remarks.
      const extraLines = receivedLines.filter((l) => round2(l.extraQty) > 0);
      if (extraLines.length && !data.allowOverReceipt) {
        const l = extraLines[0];
        throw new AppError(
          `"${l.itemName}": receiving ${l.receivedQty} but only ${l.pendingBeforeGrn} is pending on the PO. `
          + 'Tick "Allow over-receipt" to receive the extra quantity.',
          409,
        );
      }
      const extraNoRemarks = extraLines.find((l) => !(l.remarks || data.remarks || grn.remarks));
      if (extraNoRemarks) {
        throw new AppError(`"${extraNoRemarks.itemName}" was received over the ordered qty — remarks are required for extra receipt`, 400);
      }

      // Every received line must resolve to a SKU (stock cannot be posted otherwise).
      for (const line of receivedLines) {
        if (!line.skuId && line.skuCode) {
          const sku = await SKU.findOne({ code: String(line.skuCode).trim().toUpperCase() }).select('_id').lean();
          if (sku) line.skuId = sku._id;
        }
        if (!line.skuId) throw new AppError(`"${line.itemName}" is not linked to a SKU — add it to the SKU master before receiving`, 400);
      }

      // ── Where each line's stock will land ──────────────────────────────────
      // Read from the SKU master, never from the item name or the request: the
      // same source every IMS screen lists by, so the destination cannot drift
      // from where the item is shown. Fixed on the line now and used unchanged
      // when the line's QC posts the accepted qty.
      const skuDocs = await SKU.find({ _id: { $in: receivedLines.map((l) => l.skuId) } })
        .select('_id itemType').lean();
      const itemTypeBySku = new Map(skuDocs.map((s) => [String(s._id), s.itemType]));
      // The request wins only when it actually names a location; otherwise the
      // GRN's saved choice stands. No default: Raw Material needs an explicit one.
      rmLocation = locationOrNull(data.rmReceivedAtLocation) || locationOrNull(grn.rmReceivedAtLocation);
      routes = routeGrnLines({
        lines: receivedLines,
        typeOf: (l) => itemTypeBySku.get(String(l.skuId)) || '',
        rmLocation,
        grnWarehouse: grn.warehouse || 'MAIN',
      });
      assertRoutable(routes, { requireSku: true });

      // Each touched PO's own PI (different POs on one GRN may carry different
      // PIs). Only the id is resolved here: the PI DOCUMENT is read fresh inside
      // every attempt of the unit of work below.
      const poByPoId = new Map(pos.map((p) => [String(p._id), p]));
      piIdForLine = (line) => {
        const po = poByPoId.get(String(line.poId));
        return po?.piId ? String(po.piId) : null;
      };
    } catch (err) {
      await releaseClaim();
      throw err;
    }

    // PO lines: receivedQty / pendingQty = completed GRNs + this GRN. Absolute
    // values (not increments), so re-applying on a fresh copy after a concurrent
    // write elsewhere on the PO is safe. The goods arrived against the order, so
    // the PO is rolled now — the material is no longer in transit; until its QC
    // completes it is reported as Awaiting QC (inventory/awaitingQc.service).
    // Keyed by `${poId}|${poItemId}` so two POs' identical line ids never collide.
    const priorReceived = new Map(receivedLines.map((l) => [`${l.poId}|${l.poItemId}`, round2(l.previouslyReceivedQty)]));
    // One flag per PO — the GRN is only FULLY_RECEIVED once every PO it
    // touches is itself fully received (resolves the multi-PO status gap).
    const poFullyReceivedById = new Map();
    /** Apply this GRN's received lines for ONE PO onto that PO's own document. */
    const applyToPo = (doc) => {
      const lines = receivedLines.filter((l) => String(l.poId) === String(doc._id));
      for (const line of lines) {
        const poItem = doc.items.find((p) => String(p._id) === String(line.poItemId));
        if (!poItem) continue;
        poItem.receivedQty = round2((priorReceived.get(`${line.poId}|${line.poItemId}`) || 0) + line.receivedQty);
        poItem.pendingQty = Math.max(0, round2((poItem.quantity || 0) - poItem.receivedQty));
      }
      // ── Roll PO status (Rules 4 & 5) ──
      const fully = doc.items.every((p) => round2((p.quantity || 0) - (p.receivedQty || 0)) <= 0);
      poFullyReceivedById.set(String(doc._id), fully);
      doc.poStatus = fully ? PO_STATUS.FULLY_RECEIVED : PO_STATUS.PARTIAL_RECEIVED;
      doc.updatedBy = user?._id;
      doc.activityTimeline.push({ action: 'GRN_RECEIVED', description: `${grn.grnNumber} received (${grn.totalReceivedQty})`, actorId: user?._id });
    };

    // ── 1) Fix each line's destination; its stock waits for QC ──
    // Pure and repeatable, so done once, before the unit of work.
    const routeFor = new Map(routes.map((r) => [r.line, r]));
    const rmLineCount = routes.filter((r) => r.isRm).length;
    for (const line of receivedLines) {
      const route = routeFor.get(line);
      line.itemTypeAtReceipt = route.itemType;
      line.inventoryDestination = route.destination;
      line.stockWarehouse = route.warehouse;
      line.stockStatus = GRN_LINE_STOCK_STATUS.AWAITING_QC;
      line.postedQty = 0;
    }
    const finalItems = grn.items.map(plain);
    const finalTotals = {
      totalOrderedQty: grn.totalOrderedQty, totalInvoiceQty: grn.totalInvoiceQty, totalReceivedQty: grn.totalReceivedQty,
      totalShortQty: grn.totalShortQty, totalValue: grn.totalValue,
    };
    const retiredType = grn.inventoryType;
    let saved = null;

    // ── One unit of work ─────────────────────────────────────────────────────
    // Both documents' quantities and the GRN's own status land together or not
    // at all. No inventory movement is written here.
    //
    // The callback can run MORE THAN ONCE: withTransaction replays it after a
    // transient abort, and on a standalone mongod runAtomically re-runs it
    // without a session after the first write is refused. So every attempt
    // starts from FRESH copies of the PO, PI and GRN — never from a document an
    // earlier attempt already changed in memory, which would add a second
    // timeline entry or a second PI receipt.
    try {
      await inventoryService.runAtomically(async (session) => {
        const opts = session ? { session } : undefined;
        const read = (q) => q.session(session || null);

        // ── 2) PI lines: receivedQty / balanceQty ──
        const pis = new Map();
        const touchedPiIds = new Set();
        for (const line of receivedLines) {
          const piId = piIdForLine(line);
          if (!piId) continue;
          if (!pis.has(piId)) pis.set(piId, await read(ProformaInvoice.findOne({ _id: piId, isDeleted: { $ne: true } })));
          const pi = pis.get(piId);
          if (!pi) continue;
          const piItem = pi.items.find((p) => p.skuCode && line.skuCode && p.skuCode === line.skuCode)
            || pi.items.find((p) => p.itemName === line.itemName);
          if (piItem) {
            piItem.receivedQty = round2((piItem.receivedQty || 0) + line.receivedQty);
            piItem.balanceQty = Math.max(0, round2((piItem.quantity || 0) - piItem.receivedQty));
            touchedPiIds.add(piId);
          }
        }

        // ── 3) PO quantities and status — nothing to roll for a W/O PO GRN,
        // one save (with its own version-conflict retry) per distinct PO ──
        for (const { _id: poId } of pos) {
          let po = await read(VendorPurchaseOrder.findOne({ _id: poId, isDeleted: { $ne: true } }));
          if (!po) throw new AppError('Linked Purchase Order not found', 404);
          applyToPo(po);
          for (let attempt = 1; ; attempt += 1) {
            try {
              await po.save(opts);
              break;
            } catch (err) {
              if (!isVersionConflict(err) || attempt >= 4) throw err;
              po = await read(VendorPurchaseOrder.findOne({ _id: poId, isDeleted: { $ne: true } }));
              applyToPo(po);
            }
          }
        }
        for (const piId of touchedPiIds) {
          const piDoc = pis.get(piId);
          piDoc.updatedBy = user?._id;
          await piDoc.save(opts);
        }

        // ── 4) Finalize GRN + QC handoff ──
        // A W/O PO GRN has no PO to be "partial" or "full" against — RECEIVED is
        // the terminal status for it (already QC-eligible, see GRN_QC_ELIGIBLE).
        // FULLY_RECEIVED only once EVERY PO this GRN touches is itself fully
        // received — a multi-PO GRN with one PO still partial stays PARTIAL.
        const g = await read(GoodsReceiptNote.findById(grn._id));
        const allPosFullyReceived = pos.length > 0 && pos.every((po) => poFullyReceivedById.get(String(po._id)));
        g.items = finalItems;
        Object.assign(g, finalTotals);
        g.grnStatus = g.isWithoutPo ? GRN_STATUS.RECEIVED : (allPosFullyReceived ? GRN_STATUS.FULLY_RECEIVED : GRN_STATUS.PARTIAL_RECEIVED);
        g.qcStatus = GRN_QC_STATUS.PENDING; // ready for Step 1.9 Incoming QC
        g.stockPosted = true;               // the completion claim (see the model)
        g.stockPostingStage = GRN_STOCK_POSTING_STAGE.QC_COMPLETION;
        // Kept truthful for older readers: RM lines here always go to RM IMS.
        g.addToRmStock = rmLineCount > 0;
        // A draft raised before Inventory Type was retired may still carry one;
        // it is no longer what decides anything, so the record says so.
        g.inventoryType = null;
        g.rmReceivedAtLocation = rmLocation;
        g.receivedAt = new Date();
        g.completedAt = new Date();
        g.completedBy = user?.name || '';
        if (data.remarks) g.remarks = data.remarks;
        g.updatedBy = user?._id;
        g.activityTimeline.push({
          action: 'COMPLETE',
          description: buildCompletionNote(g.grnStatus, routes, rmLocation)
            + (retiredType ? ` · draft's manual Inventory Type "${GRN_INVENTORY_TYPE_LABEL[retiredType] || retiredType}" ignored — destination derived per line from the SKU master` : ''),
          actorId: user?._id,
        });
        await g.save(opts);
        saved = g;
      });
    } catch (err) {
      // Nothing posts stock here, so a failed completion is simply handed back
      // as an editable draft. (The movement check stays as a tripwire: nothing
      // in this path writes one, so finding any means something else did.)
      const posted = await inventoryService.getMovementsByRef('GRN', grn._id).catch(() => [{}]);
      if (!posted.length) await releaseClaim();
      else logger.error(`[grn] ${grn.grnNumber}: completion failed and ${posted.length} movement(s) exist for it — GRN left locked: ${err.message}`);
      throw err;
    }
    grn = saved;

    // What the caller tells the operator — counted from what was decided.
    const count = (d) => routes.filter((r) => r.destination === d).length;
    grn.$locals.rmSummary = {
      stockPostingStage: GRN_STOCK_POSTING_STAGE.QC_COMPLETION,
      awaitingQcLineCount: routes.length,
      rmLineCount,
      rmReceivedAtLocation: rmLineCount ? rmLocation : null,
      rmPostedCount: 0, // nothing posts at GRN completion any more
      destinations: {
        [INVENTORY_DESTINATION.RM_IMS]: count(INVENTORY_DESTINATION.RM_IMS),
        [INVENTORY_DESTINATION.CP_IMS]: count(INVENTORY_DESTINATION.CP_IMS),
        [INVENTORY_DESTINATION.MAIN_STORE]: count(INVENTORY_DESTINATION.MAIN_STORE),
      },
    };

    // ── 5) PDF (non-fatal) ──
    try {
      const { grnPdfUrl, grnPdfFileName } = await this.generatePdf(grn._id);
      grn.grnPdfUrl = grnPdfUrl;
      grn.grnPdfFileName = grnPdfFileName;
    } catch (err) { logger.error(`[grn] PDF generation failed for ${grn.grnNumber}: ${err.message}`); }

    // ── 6) Ready for MD Approval (non-fatal) ──
    try {
      await approvalService.ensureReady({ documentType: 'GRN', documentId: grn._id, documentNumber: grn.grnNumber }, user);
    } catch (err) { logger.error(`[grn] approval ensureReady failed for ${grn.grnNumber}: ${err.message}`); }

    return grn;
  },

  /**
   * Render the GRN PDF from in-memory form data for an on-screen preview.
   * Pure read: resolves the PO only for the vendor snapshot + PO number, computes
   * the same lines/totals as create(), and returns the PDF buffer. Saves NOTHING —
   * no record, no status change, no inventory, no PDF upload. Mirrors create()'s
   * data assembly so the preview matches the final document.
   */
  async previewPdf(data, user) {
    let vendor = {
      vendorName: data.vendorName || '',
      vendorGST: data.vendorGST || '',
      vendorAddress: data.vendorAddress || '',
    };
    let poNumber = data.poNumber || '';
    let poNumbers = [];
    const previewPoIds = data.poIds?.length ? data.poIds : (data.poId ? [data.poId] : []);
    if (previewPoIds.length) {
      const pos = await VendorPurchaseOrder.find({ _id: { $in: previewPoIds }, isDeleted: { $ne: true } }).lean();
      if (pos.length) {
        const primary = pos[0];
        vendor = { vendorName: primary.vendorName, vendorGST: primary.vendorGST, vendorAddress: primary.vendorAddress, vendorPhone: primary.vendorPhone };
        poNumber = primary.poNumber || poNumber;
        poNumbers = pos.map((p) => p.poNumber);
      }
    }

    const { lines, totals } = computeLines(data.items || []);
    const grnLike = {
      grnNumber: data.grnNumber || '(draft — generated on completion)',
      grnDate: data.grnDate || new Date(),
      poNumber, poNumbers, isWithoutPo: !!data.isWithoutPo,
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      remarks: data.remarks || '',
      ...vendor,
      items: lines,
      ...totals,
    };

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
    } catch { /* env fallback */ }

    return buildGrnPdfBuffer(grnLike, company);
  },

  async generatePdf(id) {
    const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!grn) throw new AppError('GRN not found', 404);

    // MD-signed GRNs are locked — the signed PDF lives in DocumentApproval and is
    // mirrored onto grnPdfUrl/grnPdfFileName by the approval engine. Never
    // re-render an unsigned copy over it; just hand back what's already stored.
    if (grn.approvalStatus === 'MD_APPROVED') {
      return { grnPdfUrl: grn.grnPdfUrl, grnPdfFileName: grn.grnPdfFileName };
    }

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
    } catch { /* env fallback */ }

    const buffer = await buildGrnPdfBuffer(grn, company);
    const fileName = `${String(grn.grnNumber || 'GRN').replace(/[^\w.-]/g, '_')}.pdf`;
    let grnPdfUrl;
    if (s3Enabled) {
      const key = buildKey('grns', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      grnPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'grns');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      grnPdfUrl = `${SERVER_BASE}/uploads/grns/${path.basename(fp)}`;
    }
    await GoodsReceiptNote.updateOne({ _id: id }, { $set: { grnPdfUrl, grnPdfFileName: fileName } });
    return { grnPdfUrl, grnPdfFileName: fileName };
  },

  async cancel(id, data, user) {
    const grn = await findOrThrow(id);
    if (grn.approvalStatus === 'MD_APPROVED') {
      grn.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Cancel blocked — GRN is MD-signed and locked', actorId: user?._id });
      await grn.save();
      throw new AppError('This GRN has been digitally signed by the MD and cannot be cancelled', 400);
    }
    if ([GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED].includes(grn.grnStatus) || grn.stockPosted) {
      throw new AppError('A completed GRN cannot be cancelled (stock already posted)', 400);
    }
    if (grn.grnStatus === GRN_STATUS.CANCELLED) throw new AppError('GRN is already cancelled', 400);
    grn.grnStatus = GRN_STATUS.CANCELLED;
    if (data.remarks) grn.remarks = data.remarks;
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'CANCEL', description: 'GRN cancelled', actorId: user?._id });
    return saveOpenDraft(grn);
  },
};
