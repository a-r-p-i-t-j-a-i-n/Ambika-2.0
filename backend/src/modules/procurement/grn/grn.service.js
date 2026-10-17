import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import GoodsReceiptNote, {
  GRN_STATUS, GRN_QC_STATUS, HOW_ITEM_RECEIVED, GRN_INVENTORY_TYPE, GRN_INVENTORY_TYPE_LABEL,
} from './grn.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_FOLLOWUP_STATUS, PO_PI_STATUS } from '../purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from '../follow-up/followUp.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import SKU, { RM_ITEM_TYPES } from '../../skus/sku.model.js';
import { DEFAULT_RM_RECEIVED_AT } from '../../inventory/inventoryStock.model.js';
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
 * The completion line in the activity timeline.
 *
 * Says what happened to the RM lines in plain words, because "GRN completed"
 * alone cannot be told apart from "GRN completed and deliberately added no RM
 * stock" six months later.
 */
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
 * test. This is the same classification planGrnStockPosting posts by, so the
 * rule and the posting can never disagree about what "RM" means.
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

/**
 * One Inventory Type per GRN. Pure — returns the received lines that do NOT
 * belong to the chosen type:
 *   RM                    every received line must be Raw Material / Circle
 *   CONSUMABLE_PACKAGING  no received line may be Raw Material / Circle (any
 *                         other purchasable type posts here, as it always has)
 * Lines whose type is unknown ('') are not judged. A PO mixing both kinds is
 * received on separate GRNs (lines not being received stay at 0 qty).
 */
export const findInventoryTypeConflicts = ({ lines = [], typeOf, inventoryType }) => {
  if (!inventoryType) return [];
  return lines.filter((l) => round2(l.receivedQty) > 0).filter((l) => {
    const t = typeOf(l);
    if (!t) return false;
    const isRm = RM_ITEM_TYPES.includes(t);
    return inventoryType === GRN_INVENTORY_TYPE.RM ? !isRm : isRm;
  });
};

/** The operator-facing refusal for findInventoryTypeConflicts. */
export const inventoryTypeConflictMessage = (conflicts, inventoryType) => {
  const names = conflicts.map((l) => `"${l.itemName}"`).join(', ');
  const chosen = GRN_INVENTORY_TYPE_LABEL[inventoryType] || inventoryType;
  const other = inventoryType === GRN_INVENTORY_TYPE.RM
    ? GRN_INVENTORY_TYPE_LABEL.CONSUMABLE_PACKAGING : GRN_INVENTORY_TYPE_LABEL.RM;
  return `Inventory Type is "${chosen}", but ${names} ${conflicts.length > 1 ? 'are' : 'is'} not ${inventoryType === GRN_INVENTORY_TYPE.RM ? 'Raw Material' : 'Consumable & Packaging'}. `
    + `Set ${conflicts.length > 1 ? 'their' : 'its'} received qty to 0 here and receive ${conflicts.length > 1 ? 'them' : 'it'} on a separate GRN with Inventory Type "${other}".`;
};

const assertInventoryType = async (lines = [], inventoryType) => {
  if (!inventoryType) return;
  const received = (lines || []).filter((l) => round2(l.receivedQty) > 0);
  if (!received.length) return;
  const conflicts = findInventoryTypeConflicts({ lines: received, typeOf: await resolveLineTypes(received), inventoryType });
  if (conflicts.length) throw new AppError(inventoryTypeConflictMessage(conflicts, inventoryType), 400);
};

/**
 * The RM fields implied by an Inventory Type: RM ⇒ RM lines post (addToRmStock)
 * at "Received At"; Consumable & Packaging ⇒ no RM posting and no RM location.
 */
const rmFieldsFor = (inventoryType, location) => (inventoryType === GRN_INVENTORY_TYPE.RM
  ? { addToRmStock: true, rmReceivedAtLocation: location || DEFAULT_RM_RECEIVED_AT }
  : { addToRmStock: false, rmReceivedAtLocation: null });

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

/**
 * Which received lines post stock, and where each one lands.
 *
 * Pure and exported so the rule can be read - and tested - on its own, without
 * a database behind it. The decision is deliberately only two things:
 *
 *   post       a Raw Material line posts ONLY when the operator opted in;
 *              every other item type posts exactly as it always has.
 *   warehouse  RM goes to the chosen "Received At"; everything else keeps the
 *              GRN's own store. Neither is ever mapped onto the other.
 *
 * @param {object[]} lines          received GRN lines (skuId set)
 * @param {Map} itemTypeBySku       String(skuId) -> SKU itemType
 * @param {boolean} addToRmStock    the operator's opt-in
 * @param {string|null} rmLocation  Received At for the RM lines
 * @param {string} grnWarehouse     the GRN's own store (e.g. MAIN)
 */
export const planGrnStockPosting = ({ lines = [], itemTypeBySku, addToRmStock, rmLocation, grnWarehouse }) =>
  lines.map((line) => {
    const isRm = RM_ITEM_TYPES.includes(itemTypeBySku.get(String(line.skuId)));
    return {
      line,
      isRm,
      post: !isRm || !!addToRmStock,
      warehouse: isRm ? rmLocation : grnWarehouse,
    };
  });

const buildCompletionNote = (grnStatus, rmLineCount, addToRmStock, rmLocation) => {
  const base = `GRN completed - stock posted (${grnStatus})`;
  if (!rmLineCount) return base;
  return addToRmStock
    ? `${base}; ${rmLineCount} RM line(s) added to RM stock at ${rmLocation}`
    : `${base}; ${rmLineCount} RM line(s) NOT added to RM stock (not opted in)`;
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

/** Match a GRN line back to its PO line (by PO line _id, else by SKU code). */
const matchPoItem = (poItems = [], line) =>
  poItems.find((p) => line.poItemId && String(p._id) === String(line.poItemId))
  || poItems.find((p) => p.skuCode && line.skuCode
    && String(p.skuCode).trim().toUpperCase() === String(line.skuCode).trim().toUpperCase());

/**
 * Received qty per PO line, summed from the PO's completed GRNs — the source of
 * truth for "already received" (drafts and cancelled GRNs never count).
 */
const receivedByPoLine = async (po) => {
  const grns = await GoodsReceiptNote.find({
    poId: po._id, isDeleted: { $ne: true }, grnStatus: { $in: POSTED_GRN_STATUSES },
  }).select('items.poItemId items.skuCode items.receivedQty').lean();
  const received = new Map((po.items || []).map((p) => [String(p._id), 0]));
  for (const g of grns) {
    for (const l of g.items || []) {
      const p = matchPoItem(po.items, l);
      if (p) received.set(String(p._id), round2(received.get(String(p._id)) + (Number(l.receivedQty) || 0)));
    }
  }
  return received;
};

/**
 * Rebuild GRN lines with ordered / previously-received qty taken from the
 * current PO + completed GRNs — never from the client. Only the physical
 * receipt fields (invoice/received qty, batch, remarks) come from `items`.
 */
const snapshotFromPo = (po, received, items = []) => {
  const seen = new Set();
  return items.map((it) => {
    const p = matchPoItem(po.items, it);
    if (!p) throw new AppError(`"${it.itemName}" is not a line on PO ${po.poNumber || ''}`.trim(), 400);
    const key = String(p._id);
    if (seen.has(key)) throw new AppError(`"${p.itemName}" appears more than once in this GRN`, 400);
    seen.add(key);
    return {
      ...it,
      poItemId: p._id,
      skuId: it.skuId || p.skuId, skuCode: it.skuCode || p.skuCode, unit: it.unit || p.unit,
      orderedQty: p.quantity || 0,
      previouslyReceivedQty: received.get(key) || 0,
    };
  });
};

const plain = (doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc);

/** Re-derive a GRN's PO-based figures against the current database state. */
const refreshLines = async (po, items) => {
  const received = await receivedByPoLine(po);
  return computeLines(snapshotFromPo(po, received, (items || []).map(plain)));
};

const PO_LOCK_TTL_MS = 2 * 60 * 1000;

/** Claim the per-PO GRN posting lock; null when another completion holds it. */
const acquirePoLock = async (poId) => {
  const now = new Date();
  const res = await VendorPurchaseOrder.updateOne(
    {
      _id: poId,
      $or: [{ grnPostingLockAt: null }, { grnPostingLockAt: { $lt: new Date(now.getTime() - PO_LOCK_TTL_MS) } }],
    },
    { $set: { grnPostingLockAt: now } },
  );
  return res.modifiedCount === 1 ? now : null;
};

const releasePoLock = (poId, lockedAt) => VendorPurchaseOrder.updateOne(
  { _id: poId, grnPostingLockAt: lockedAt },
  { $set: { grnPostingLockAt: null } },
).catch((err) => logger.error(`[grn] failed to release PO lock ${poId}: ${err.message}`));

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
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Date: ${fmtDate(grn.grnDate)}`, liX, cardTop + 40)
      .text(`PO No: ${grn.poNumber || '—'}`, liX, cardTop + 53)
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
    (grn.items || []).forEach((it, i) => {
      // Measure the description: item name (primary) + optional batch line
      // (secondary). Row height auto-adjusts so long names wrap cleanly.
      const itemName = it.itemName || '';
      const batchStr = it.batchNo ? `Batch: ${it.batchNo}` : '';
      doc.font('Helvetica').fontSize(8.5);
      const nameH = doc.heightOfString(itemName, { width: nameCol.w - 8 });
      const batchH = batchStr ? 10 : 0;
      const rowH = Math.max(18, nameH + batchH + PADY * 2 - 2);

      if (y + rowH > 770) { doc.addPage(); y = M; drawHead(); }
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill('#f8fafc');

      const cells = { sr: String(i + 1), invoice: String(it.invoiceQty || 0), received: String(it.receivedQty || 0), unit: it.unit || 'Pcs' };
      let x = M;
      cols.forEach((c) => {
        if (c.key === 'name') {
          doc.font('Helvetica').fontSize(8.5).fill(navy).text(itemName, x + 4, y + PADY, { width: c.w - 8 });
          if (batchStr) {
            doc.font('Helvetica').fontSize(7).fill('#64748b').text(batchStr, x + 8, y + PADY + nameH + 1, { width: c.w - 12 });
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

export const grnService = {
  async create(data, user) {
    const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } });
    if (!po) throw new AppError('Purchase Order not found', 404);

    // Rule 1: gate — material followed up to READY_FOR_GRN AND the PI step is
    // settled: either advance payment completed, or PI explicitly marked Not Required.
    const piSettled = [PO_PI_STATUS.PAYMENT_COMPLETED, PO_PI_STATUS.PI_NOT_REQUIRED].includes(po.piStatus);
    if (po.followUpStatus !== PO_FOLLOWUP_STATUS.READY_FOR_GRN || !piSettled) {
      throw new AppError('GRN can only be created when the PO is READY_FOR_GRN and its PI is completed or marked Not Required', 400);
    }

    // Rule 1b: material delivery must be confirmed — the PO must have reached the
    // ready-for-GRN gate AND carry a Final Material Date (on the PO, or on the
    // latest completed follow-up for back-compat). A PO already partially received
    // is exempt so in-flight receiving is never blocked.
    if (po.poStatus !== PO_STATUS.PARTIAL_RECEIVED) {
      let hasFinalMaterialDate = !!(po.readyForGrnAt && po.finalMaterialDate);
      if (po.readyForGrnAt && !po.finalMaterialDate) {
        const fu = await PurchaseFollowUp.findOne({
          poId: po._id, isDeleted: { $ne: true }, finalMaterialDate: { $ne: null },
        }).sort('-updatedAt').select('finalMaterialDate').lean();
        hasFinalMaterialDate = !!fu?.finalMaterialDate;
      }
      if (!hasFinalMaterialDate) {
        throw new AppError('Final Material Date is required before creating a GRN.', 400);
      }
    }

    if (po.poStatus === PO_STATUS.FULLY_RECEIVED) {
      throw new AppError('This PO is already fully received', 400);
    }

    // Rule 2: auto-load lines from the PO (pending only). Ordered / already
    // received qty always come from the PO + its completed GRNs, never the client.
    const received = await receivedByPoLine(po);
    const sourceItems = data.items?.length ? snapshotFromPo(po, received, data.items) : (po.items || [])
      .filter((it) => round2((it.quantity || 0) - (received.get(String(it._id)) || 0)) > 0)
      .map((it) => {
        const prev = received.get(String(it._id)) || 0;
        const pending = round2((it.quantity || 0) - prev);
        return {
          // For JSL, itemName is the "Grade Width Finish" label that should be
          // shown as the Item Description; itemDescription only holds the raw
          // indent item name and is not used for display.
          poItemId: it._id, skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
          orderedQty: it.quantity, previouslyReceivedQty: prev,
          invoiceQty: pending, receivedQty: pending, rate: it.rate, batchNo: '', remarks: '',
        };
      });
    if (!sourceItems.length) throw new AppError('Nothing left to receive on this PO', 400);

    await assertPurchasable(sourceItems);
    await assertRmBatchNumbers(sourceItems);
    await assertInventoryType(sourceItems, data.inventoryType);
    const { lines, totals } = computeLines(sourceItems);

    const grnNumber = await generateGrnNumber(data.grnDate || new Date());
    const uniqueId = await generateGrnUniqueId();

    const grn = await GoodsReceiptNote.create({
      grnNumber, uniqueId,
      grnDate: data.grnDate || new Date(),
      poId: po._id, poNumber: po.poNumber,
      piId: po.piId || undefined, piNumber: po.piNumber || '',
      indentId: po.indentId, indentNumber: po.indentNumber,
      vendorId: po.vendorId, vendorName: po.vendorName, vendorGST: po.vendorGST,
      vendorAddress: po.vendorAddress, vendorPhone: po.vendorPhone,
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      invoiceDate: data.invoiceDate || null,
      vehicleNumber: data.vehicleNumber || '',
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      warehouse: data.warehouse || 'MAIN',
      // The RM choice, captured when the GRN is raised rather than only at
      // completion. `warehouse` above is the GRN's own store and stays MAIN —
      // the two are never mapped onto each other.
      // The Inventory Type decides the RM handling; a caller that predates it
      // (no inventoryType) keeps the old opt-in semantics unchanged.
      inventoryType: data.inventoryType || null,
      ...(data.inventoryType
        ? rmFieldsFor(data.inventoryType, data.rmReceivedAtLocation)
        : { addToRmStock: !!data.addToRmStock, rmReceivedAtLocation: data.rmReceivedAtLocation || null }),
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      challanDocument: data.challanDocument?.fileUrl ? { ...data.challanDocument, uploadedAt: new Date() } : undefined,
      invoiceDocument: data.invoiceDocument?.fileUrl ? { ...data.invoiceDocument, uploadedAt: new Date() } : undefined,
      items: lines,
      ...totals,
      grnStatus: GRN_STATUS.DRAFT,
      qcStatus: GRN_QC_STATUS.PENDING,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `GRN created for ${po.poNumber}`, actorId: user?._id }],
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
    // GRNs on the same PO complete — show it against the current PO state.
    if (isOpenDraft(grn)) {
      try {
        const po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } }).lean();
        if (po) {
          const { lines, totals } = await refreshLines(po, grn.items);
          Object.assign(grn, totals, { items: lines });
        }
      } catch (err) {
        logger.warn(`[grn] could not refresh draft ${grn.grnNumber} against its PO: ${err.message}`);
      }
    }
    return grn;
  },

  async getByPo(poId) {
    return GoodsReceiptNote.find({ poId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
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
    const { items, challanDocument, invoiceDocument, inventoryType, ...rest } = data;
    Object.assign(grn, rest);
    if (inventoryType) {
      grn.inventoryType = inventoryType;
      Object.assign(grn, rmFieldsFor(inventoryType, data.rmReceivedAtLocation || grn.rmReceivedAtLocation));
    }
    // Every save is checked against the GRN's Inventory Type (lines as sent, or as stored).
    await assertInventoryType(items || grn.items, grn.inventoryType);
    if (challanDocument) grn.challanDocument = challanDocument.fileUrl ? { ...challanDocument, uploadedAt: new Date() } : {};
    if (invoiceDocument) grn.invoiceDocument = invoiceDocument.fileUrl ? { ...invoiceDocument, uploadedAt: new Date() } : {};
    if (items) {
      await assertPurchasable(items);
      await assertRmBatchNumbers(items);
      const po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } }).lean();
      if (!po) throw new AppError('Linked Purchase Order not found', 404);
      const { lines, totals } = await refreshLines(po, items);
      grn.items = lines;
      Object.assign(grn, totals);
    }
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
   * Complete a GRN: post stock via inventoryService, update PO + PI quantities,
   * roll receipt status, generate the GRN PDF, and leave qcStatus PENDING for
   * Step 1.9 Incoming QC. Idempotent: the draft is claimed atomically (DRAFT +
   * stockPosted:false → stockPosted:true) before anything is posted, so of two
   * concurrent/double-submitted completes only one can ever post stock.
   *
   * Raw Material lines are posted ONLY when the operator ticked "Add to RM
   * Stock" (data.addToRmStock). Every other item type posts exactly as it
   * always has — the opt-in gates RM and nothing else.
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
      throw new AppError('Stock already posted for this GRN', 400);
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
    // qty, the second waits for (and is validated against) the first.
    const poLockedAt = await acquirePoLock(grn.poId);
    if (!poLockedAt) {
      await releaseClaim();
      throw new AppError('Another GRN for this PO is being completed right now. Please try again in a moment.', 409);
    }
    try {
      return await this._completeLocked(grn, data, user, releaseClaim);
    } finally {
      await releasePoLock(grn.poId, poLockedAt);
    }
  },

  /** complete() body — runs with the GRN claimed and the PO posting lock held. */
  async _completeLocked(grn, data, user, releaseClaim) {
    let po; let pi; let receivedLines; let planFor; let rmLines;
    let addToRmStock; let receivedAtLocation; let rmLocation; let inventoryType;
    try {
      po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } });
      if (!po) throw new AppError('Linked Purchase Order not found', 404);

      // Re-derive ordered / already-received / pending from the current DB state
      // — the draft's snapshot may predate other GRNs completed on this PO.
      const { lines, totals } = await refreshLines(po, grn.items);
      grn.items = lines;
      Object.assign(grn, totals);

      receivedLines = grn.items.filter((it) => round2(it.receivedQty) > 0);
      if (!receivedLines.length) throw new AppError('Enter a received quantity on at least one item', 400);

      // Last gate before anything posts. create()/update() already enforce this,
      // but a GRN saved before the rule existed can still reach completion, and a
      // coil must not enter stock with no way to identify it afterwards.
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

      // ── Which lines are Raw Material? ──────────────────────────────────────
      // Read from the SKU master, never inferred from the item name: it is the
      // same source RM IMS classifies by (RM_ITEM_TYPES), so "is this line RM?"
      // cannot drift between the two modules. A line whose SKU carries any other
      // item type is not RM and is completely unaffected by the opt-in.
      const skuDocs = await SKU.find({ _id: { $in: receivedLines.map((l) => l.skuId) } })
        .select('_id itemType').lean();
      const itemTypeBySku = new Map(skuDocs.map((s) => [String(s._id), s.itemType]));

      // Both can be chosen when the GRN is raised and confirmed again here, so
      // the request wins only when it actually says something. An omitted field
      // inherits what the GRN already carries.
      inventoryType = data.inventoryType || grn.inventoryType || null;
      if (inventoryType) {
        // One Inventory Type per GRN — refuse before anything posts (the claim is
        // handed back below), never route a line into the wrong module.
        const conflicts = findInventoryTypeConflicts({
          lines: receivedLines, typeOf: (l) => itemTypeBySku.get(String(l.skuId)) || '', inventoryType,
        });
        if (conflicts.length) throw new AppError(inventoryTypeConflictMessage(conflicts, inventoryType), 400);
        ({ addToRmStock, rmReceivedAtLocation: receivedAtLocation } = rmFieldsFor(
          inventoryType, data.rmReceivedAtLocation || grn.rmReceivedAtLocation,
        ));
      } else {
        // GRN raised before Inventory Type existed: its recorded opt-in, unchanged.
        addToRmStock = data.addToRmStock !== undefined ? !!data.addToRmStock : !!grn.addToRmStock;
        // receivedAtLocation = where the goods landed (recorded either way, never
        // invented); rmLocation = where the RM movement posts (only when opted in,
        // and only then does the default stand in).
        receivedAtLocation = data.rmReceivedAtLocation || grn.rmReceivedAtLocation || null;
      }
      rmLocation = addToRmStock ? (receivedAtLocation || DEFAULT_RM_RECEIVED_AT) : null;

      // An RM line with the box unticked is still RECEIVED — it updates the PO,
      // the PI and the GRN — it just posts no inventory movement.
      const plan = planGrnStockPosting({
        lines: receivedLines, itemTypeBySku, addToRmStock, rmLocation, grnWarehouse: grn.warehouse,
      });
      planFor = new Map(plan.map((p) => [p.line, p]));
      rmLines = plan.filter((p) => p.isRm).map((p) => p.line);

      pi = grn.piId ? await ProformaInvoice.findOne({ _id: grn.piId, isDeleted: { $ne: true } }) : null;
    } catch (err) {
      await releaseClaim();
      throw err;
    }

    // PO lines: receivedQty / pendingQty = completed GRNs + this GRN. Absolute
    // values (not increments), so re-applying on a fresh copy after a concurrent
    // write elsewhere on the PO is safe. Runs for EVERY received line, posted or
    // not: the goods arrived against the order either way.
    const priorReceived = new Map(receivedLines.map((l) => [String(l.poItemId), round2(l.previouslyReceivedQty)]));
    let poFullyReceived = false;
    const applyToPo = (doc) => {
      for (const line of receivedLines) {
        const poItem = matchPoItem(doc.items, line);
        if (!poItem) continue;
        poItem.receivedQty = round2((priorReceived.get(String(line.poItemId)) || 0) + line.receivedQty);
        poItem.pendingQty = Math.max(0, round2((poItem.quantity || 0) - poItem.receivedQty));
      }
      // ── 4) Roll PO status (Rules 4 & 5) ──
      poFullyReceived = doc.items.every((p) => round2((p.quantity || 0) - (p.receivedQty || 0)) <= 0);
      doc.poStatus = poFullyReceived ? PO_STATUS.FULLY_RECEIVED : PO_STATUS.PARTIAL_RECEIVED;
      doc.updatedBy = user?._id;
      doc.activityTimeline.push({ action: 'GRN_RECEIVED', description: `${grn.grnNumber} received (${grn.totalReceivedQty})`, actorId: user?._id });
    };

    // ── One unit of work ─────────────────────────────────────────────────────
    // Every movement, both documents' quantities and the GRN's own status land
    // together or not at all. On a standalone mongod runAtomically degrades to
    // non-atomic and logs that once.
    try {
      await inventoryService.runAtomically(async (session) => {
        const opts = session ? { session } : undefined;

        for (const line of receivedLines) {
          // ── 1) Post stock — strictly through inventoryService ──
          const step = planFor.get(line);
          if (step.post) {
            const { movement } = await inventoryService.increaseStock({
              skuId: line.skuId, skuCode: line.skuCode, skuName: line.itemName, unit: line.unit,
              // RM goes to the "Received At" the operator chose; everything else
              // keeps the GRN's own store.
              warehouse: step.warehouse,
              quantity: round2(line.receivedQty),
              unitCost: round2(line.rate),
              txnType: 'GRN_IN', sourceModule: 'PURCHASE_FMS',
              refType: 'GRN', refId: grn._id, refNumber: grn.grnNumber,
              batchNo: line.batchNo || '',
              vendorId: grn.vendorId, vendorName: grn.vendorName,
              poId: grn.poId, poNumber: grn.poNumber, piId: grn.piId, piNumber: grn.piNumber,
              remarks: 'Stock added from Purchase GRN',
              performedBy: user, movementDate: grn.grnDate,
            }, opts);
            line.movementId = movement._id;
            line.movementNumber = movement.movementNumber;
          }

          // ── 3) PI line: receivedQty / balanceQty ──
          if (pi) {
            const piItem = pi.items.find((p) => p.skuCode && line.skuCode && p.skuCode === line.skuCode)
              || pi.items.find((p) => p.itemName === line.itemName);
            if (piItem) {
              piItem.receivedQty = round2((piItem.receivedQty || 0) + line.receivedQty);
              piItem.balanceQty = Math.max(0, round2((piItem.quantity || 0) - piItem.receivedQty));
            }
          }
        }

        // ── 2) + 4) PO quantities and status ──
        applyToPo(po);
        for (let attempt = 1; ; attempt += 1) {
          try {
            await po.save(opts);
            break;
          } catch (err) {
            if (!isVersionConflict(err) || attempt >= 4) throw err;
            po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } }).session(session || null);
            applyToPo(po);
          }
        }
        if (pi) { pi.updatedBy = user?._id; await pi.save(opts); }

        // ── 5) Finalize GRN + QC handoff ──
        grn.grnStatus = poFullyReceived ? GRN_STATUS.FULLY_RECEIVED : GRN_STATUS.PARTIAL_RECEIVED;
        grn.qcStatus = GRN_QC_STATUS.PENDING; // ready for Step 1.9 Incoming QC
        grn.stockPosted = true;               // already claimed above; kept explicit
        grn.addToRmStock = addToRmStock;      // the operator's choice, on the record
        if (inventoryType) grn.inventoryType = inventoryType;
        // Record where the goods landed, not merely where stock went.
        grn.rmReceivedAtLocation = addToRmStock ? rmLocation : receivedAtLocation;
        grn.receivedAt = new Date();
        grn.completedAt = new Date();
        grn.completedBy = user?.name || '';
        if (data.remarks) grn.remarks = data.remarks;
        grn.updatedBy = user?._id;
        grn.activityTimeline.push({
          action: 'COMPLETE',
          description: buildCompletionNote(grn.grnStatus, rmLines.length, addToRmStock, rmLocation)
            + (inventoryType ? ` · Inventory Type: ${GRN_INVENTORY_TYPE_LABEL[inventoryType]}` : ''),
          actorId: user?._id,
        });
        await grn.save(opts);
      });
    } catch (err) {
      // Rolled back (or nothing written) → release the claim. If movements did
      // land (deployment without transactions), keep the GRN locked so a retry
      // can never post the same stock twice.
      const posted = await inventoryService.getMovementsByRef('GRN', grn._id).catch(() => [{}]);
      if (!posted.length) await releaseClaim();
      else logger.error(`[grn] ${grn.grnNumber}: completion failed part-way (${posted.length} movement(s) written) — GRN left locked: ${err.message}`);
      throw err;
    }

    // What the caller tells the operator. Counted from what was actually
    // decided, so the UI can never claim RM stock moved when no RM line did.
    grn.$locals.rmSummary = {
      inventoryType,
      addToRmStock,
      rmReceivedAtLocation: rmLocation,
      rmLineCount: rmLines.length,
      rmPostedCount: addToRmStock ? rmLines.length : 0,
    };

    // ── 6) PDF (non-fatal) ──
    try {
      const { grnPdfUrl, grnPdfFileName } = await this.generatePdf(grn._id);
      grn.grnPdfUrl = grnPdfUrl;
      grn.grnPdfFileName = grnPdfFileName;
    } catch (err) { logger.error(`[grn] PDF generation failed for ${grn.grnNumber}: ${err.message}`); }

    // ── 7) Ready for MD Approval (non-fatal) ──
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
    if (data.poId) {
      const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } }).lean();
      if (po) {
        vendor = { vendorName: po.vendorName, vendorGST: po.vendorGST, vendorAddress: po.vendorAddress, vendorPhone: po.vendorPhone };
        poNumber = po.poNumber || poNumber;
      }
    }

    const { lines, totals } = computeLines(data.items || []);
    const grnLike = {
      grnNumber: data.grnNumber || '(draft — generated on completion)',
      grnDate: data.grnDate || new Date(),
      poNumber,
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
