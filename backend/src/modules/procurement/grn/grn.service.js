import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import GoodsReceiptNote, { GRN_STATUS, GRN_QC_STATUS, HOW_ITEM_RECEIVED } from './grn.model.js';
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

const assertRmBatchNumbers = async (lines = []) => {
  const received = (lines || []).filter((l) => round2(l.receivedQty) > 0);
  if (!received.length) return;

  const up = (v) => String(v || '').trim().toUpperCase();
  const ids = [...new Set(received.map((l) => l.skuId).filter(Boolean).map(String))];
  const codes = [...new Set(received.map((l) => up(l.skuCode)).filter(Boolean))];
  if (!ids.length && !codes.length) return;

  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (codes.length) or.push({ code: { $in: codes } });
  const skus = await SKU.find({ $or: or }).select('_id code itemType').lean();
  const byId = new Map(skus.map((s) => [String(s._id), s.itemType]));
  const byCode = new Map(skus.map((s) => [up(s.code), s.itemType]));
  // A line with no SKU match cannot be classified, so it is left alone — the
  // SKU master is the authority and silence is not evidence of being RM.
  const typeOf = (l) => (l.skuId && byId.get(String(l.skuId))) || byCode.get(up(l.skuCode)) || '';

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

    // Rule 2: auto-load lines from the PO (pending only).
    const sourceItems = data.items?.length ? data.items : (po.items || [])
      .filter((it) => round2((it.quantity || 0) - (it.receivedQty || 0)) > 0)
      .map((it) => {
        const pending = round2((it.quantity || 0) - (it.receivedQty || 0));
        return {
          // For JSL, itemName is the "Grade Width Finish" label that should be
          // shown as the Item Description; itemDescription only holds the raw
          // indent item name and is not used for display.
          poItemId: it._id, skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
          orderedQty: it.quantity, previouslyReceivedQty: it.receivedQty || 0,
          invoiceQty: pending, receivedQty: pending, rate: it.rate, batchNo: '', remarks: '',
        };
      });
    if (!sourceItems.length) throw new AppError('Nothing left to receive on this PO', 400);

    await assertPurchasable(sourceItems);
    await assertRmBatchNumbers(sourceItems);
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
      addToRmStock: !!data.addToRmStock,
      // Kept whatever the operator chose, independently of the opt-in: where
      // the goods landed is a fact about the receipt. It used to be nulled when
      // the box was unticked, which silently discarded a recorded location.
      rmReceivedAtLocation: data.rmReceivedAtLocation || null,
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
          receivedQty:     { $sum: { $cond: [{ $ne: ['$grnStatus', GRN_STATUS.CANCELLED] }, '$totalReceivedQty', 0] } },
          pendingQty:      { $sum: { $cond: [{ $ne: ['$grnStatus', GRN_STATUS.CANCELLED] }, { $subtract: ['$totalOrderedQty', '$totalReceivedQty'] }, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, partialReceived: 0, fullyReceived: 0, draft: 0, cancelled: 0, receivedQty: 0, pendingQty: 0 };
  },

  async update(id, data, user) {
    const grn = await findOrThrow(id);
    if (grn.approvalStatus === 'MD_APPROVED') {
      grn.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Edit blocked — GRN is MD-signed and locked', actorId: user?._id });
      await grn.save();
      throw new AppError('This GRN has been digitally signed by the MD and is locked for editing', 400);
    }
    if (grn.grnStatus !== GRN_STATUS.DRAFT) throw new AppError('Only draft GRNs can be edited', 400);
    const { items, challanDocument, invoiceDocument, ...rest } = data;
    Object.assign(grn, rest);
    if (challanDocument) grn.challanDocument = challanDocument.fileUrl ? { ...challanDocument, uploadedAt: new Date() } : {};
    if (invoiceDocument) grn.invoiceDocument = invoiceDocument.fileUrl ? { ...invoiceDocument, uploadedAt: new Date() } : {};
    if (items) {
      await assertPurchasable(items);
      await assertRmBatchNumbers(items);
      const { lines, totals } = computeLines(items);
      grn.items = lines;
      Object.assign(grn, totals);
    }
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'UPDATE', description: 'Draft GRN updated', actorId: user?._id });
    return grn.save();
  },

  async remove(id, user) {
    const grn = await findOrThrow(id);
    if (grn.grnStatus !== GRN_STATUS.DRAFT) {
      throw new AppError('Only draft GRNs can be deleted', 400);
    }
    grn.isDeleted = true;
    grn.deletedAt = new Date();
    grn.deletedBy = user?._id;
    grn.activityTimeline.push({ action: 'DELETE', description: 'GRN deleted', actorId: user?._id });
    return grn.save();
  },

  /**
   * Complete a GRN: post stock via inventoryService, update PO + PI quantities,
   * roll receipt status, generate the GRN PDF, and leave qcStatus PENDING for
   * Step 1.9 Incoming QC.
   *
   * Raw Material lines are posted ONLY when the operator ticked "Add to RM
   * Stock" (data.addToRmStock). Every other item type posts exactly as it
   * always has — the opt-in gates RM and nothing else.
   */
  async complete(id, data, user) {
    // ── 0) Claim the completion, atomically ──────────────────────────────────
    // The guard used to be read-then-write: load the GRN, check grnStatus and
    // stockPosted, then set stockPosted many awaits later. Two completes racing
    // each other both passed that check and both posted. This is a single
    // compare-and-set instead — whoever flips stockPosted false→true owns the
    // posting and everyone else is told it is already done, so a double-click, a
    // retry, a second tab or two users cannot produce a second set of movements.
    // The claim sits OUTSIDE the transaction below, the same shape
    // inventoryService.claimRequestKey uses, so it still answers a replay when
    // the transaction retries internally.
    const grn = await GoodsReceiptNote.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true }, grnStatus: GRN_STATUS.DRAFT, stockPosted: false },
      { $set: { stockPosted: true } },
      { new: true },
    );
    if (!grn) {
      // Nothing was claimed. Say precisely why, exactly as this used to.
      const existing = await findOrThrow(id); // 404 when it genuinely is not there
      if (existing.stockPosted) throw new AppError('Stock already posted for this GRN', 400);
      throw new AppError('Only draft GRNs can be completed', 400);
    }

    try {
      return await this._completeClaimed(grn, data, user);
    } catch (err) {
      // The completion did not happen, so the claim must not lock the corrected
      // retry out. Only ever releases a claim THIS request made.
      await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { stockPosted: false } }).catch(() => {});
      throw err;
    }
  },

  /** The body of complete(), once this request owns the posting. */
  async _completeClaimed(grn, data, user) {
    // Second line of defence behind the claim: if movements already exist for
    // this GRN then something posted them outside this path, and nothing more
    // should be written.
    const existingMovements = await inventoryService.getMovementsByRef('GRN', grn._id);
    if (existingMovements.length) throw new AppError('Inventory movements already exist for this GRN', 400);

    const po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } });
    if (!po) throw new AppError('Linked Purchase Order not found', 404);

    const receivedLines = grn.items.filter((it) => round2(it.receivedQty) > 0);
    if (!receivedLines.length) throw new AppError('Enter a received quantity on at least one item', 400);

    // Last gate before anything posts. create()/update() already enforce this,
    // but a GRN saved before the rule existed can still reach completion, and a
    // coil must not enter stock with no way to identify it afterwards.
    await assertRmBatchNumbers(receivedLines);

    // Rule 6: extra receipt requires remarks.
    const extraNoRemarks = receivedLines.find((l) => round2(l.extraQty) > 0 && !(l.remarks || data.remarks || grn.remarks));
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

    // ── Which lines are Raw Material? ────────────────────────────────────────
    // Read from the SKU master, never inferred from the item name: it is the
    // same source RM IMS classifies by (RM_ITEM_TYPES), so "is this line RM?"
    // cannot drift between the two modules. A line whose SKU carries any other
    // item type is not RM and is completely unaffected by the opt-in.
    const skuDocs = await SKU.find({ _id: { $in: receivedLines.map((l) => l.skuId) } })
      .select('_id itemType').lean();
    const itemTypeBySku = new Map(skuDocs.map((s) => [String(s._id), s.itemType]));

    // Both can be chosen when the GRN is raised and confirmed again here, so
    // the request wins only when it actually says something. An omitted field
    // inherits what the GRN already carries — without this, a caller that
    // completes without mentioning the flag would silently discard the
    // operator's choice from the form.
    const addToRmStock = data.addToRmStock !== undefined ? !!data.addToRmStock : !!grn.addToRmStock;
    // Two different things, deliberately separated:
    //
    //   receivedAtLocation  where the goods landed. A property of the receipt,
    //                       recorded whether or not stock is posted, and never
    //                       invented — null stays null if nobody chose one.
    //   rmLocation          the warehouse the RM movement posts to. Only exists
    //                       when the opt-in is on, and only then does the
    //                       default stand in.
    const receivedAtLocation = data.rmReceivedAtLocation || grn.rmReceivedAtLocation || null;
    const rmLocation = addToRmStock ? (receivedAtLocation || DEFAULT_RM_RECEIVED_AT) : null;

    // An RM line with the box unticked is still RECEIVED — it updates the PO,
    // the PI and the GRN — it just posts no inventory movement. That is the
    // whole of the feature.
    const plan = planGrnStockPosting({
      lines: receivedLines, itemTypeBySku, addToRmStock, rmLocation, grnWarehouse: grn.warehouse,
    });
    const planFor = new Map(plan.map((p) => [p.line, p]));
    const rmLines = plan.filter((p) => p.isRm).map((p) => p.line);

    // ── One unit of work ─────────────────────────────────────────────────────
    // Every movement, both documents' quantities and the GRN's own status land
    // together or not at all. This used to commit line by line with no session,
    // so a failure half way through left movements in the ledger behind a GRN
    // that was never completed — "GRN saved but stock failed", silently. Same
    // helper every IMS entry screen posts through; on a standalone mongod it
    // degrades to non-atomic and logs that once.
    //
    // ── EVERY ATTEMPT STARTS FROM FRESH DOCUMENTS ───────────────────────────
    // withTransaction re-runs this callback after a transient abort (a write
    // conflict, or "catalog changes" while an index builds). The PO, PI and GRN
    // used to be loaded ONCE, outside, and mutated in here — so a retry replayed
    // `receivedQty += …` and `activityTimeline.push(…)` on objects the aborted
    // attempt had already changed. On the PO that surfaced as a VersionError
    // that failed the whole completion; on the PI, whose quantity updates carry
    // no version check, it could have double-counted received quantities.
    // Re-reading them through the session per attempt makes a retry a clean
    // re-run of the same work. Decisions made above (the plan, the lines, the
    // locations) are pure reads and stay as they are.
    let completed = null;
    await inventoryService.runAtomically(async (session) => {
      const opts = session ? { session } : undefined;
      const inTxn = (q) => (session ? q.session(session) : q);
      // eslint-disable-next-line no-shadow
      const po = await inTxn(VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } }));
      if (!po) throw new AppError('Linked Purchase Order not found', 404);
      // eslint-disable-next-line no-shadow
      const pi = grn.piId ? await inTxn(ProformaInvoice.findOne({ _id: grn.piId, isDeleted: { $ne: true } })) : null;
      const txGrn = await inTxn(GoodsReceiptNote.findById(grn._id));
      const txLineById = new Map(txGrn.items.map((it) => [String(it._id), it]));

      for (const line of receivedLines) {
        // The GRN line this attempt will actually save — carries any SKU link
        // resolved above, so it is persisted exactly as before.
        const txLine = txLineById.get(String(line._id)) || line;
        if (line.skuId && !txLine.skuId) txLine.skuId = line.skuId;
        // ── 1) Post stock — strictly through inventoryService ──
        const step = planFor.get(line);
        if (step.post) {
          const { movement } = await inventoryService.increaseStock({
            skuId: line.skuId, skuCode: line.skuCode, skuName: line.itemName, unit: line.unit,
            // RM goes to the "Received At" the operator chose; everything else
            // keeps the GRN's own store. The two are never mapped onto each
            // other — a GRN's MAIN is not a Received At and never becomes one.
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
          txLine.movementId = movement._id;
          txLine.movementNumber = movement.movementNumber;
        }

        // ── 2) PO line: receivedQty / pendingQty ──
        // Runs for EVERY received line, posted or not: the goods arrived
        // against the order either way. Only the ledger entry is conditional.
        const poItem = po.items.find((p) => String(p._id) === String(line.poItemId))
          || po.items.find((p) => p.skuCode && line.skuCode && p.skuCode === line.skuCode);
        if (poItem) {
          poItem.receivedQty = round2((poItem.receivedQty || 0) + line.receivedQty);
          poItem.pendingQty = Math.max(0, round2((poItem.quantity || 0) - poItem.receivedQty));
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

      // ── 4) Roll PO status (Rules 4 & 5) ──
      const poFullyReceived = po.items.every((p) => round2((p.quantity || 0) - (p.receivedQty || 0)) <= 0);
      po.poStatus = poFullyReceived ? PO_STATUS.FULLY_RECEIVED : PO_STATUS.PARTIAL_RECEIVED;
      po.updatedBy = user?._id;
      po.activityTimeline.push({ action: 'GRN_RECEIVED', description: `${grn.grnNumber} received (${grn.totalReceivedQty})`, actorId: user?._id });
      await po.save(opts);
      if (pi) { pi.updatedBy = user?._id; await pi.save(opts); }

      // ── 5) Finalize GRN + QC handoff ── (on this attempt's fresh copy)
      txGrn.grnStatus = poFullyReceived ? GRN_STATUS.FULLY_RECEIVED : GRN_STATUS.PARTIAL_RECEIVED;
      txGrn.qcStatus = GRN_QC_STATUS.PENDING; // ready for Step 1.9 Incoming QC
      txGrn.stockPosted = true;               // already claimed above; kept explicit
      txGrn.addToRmStock = addToRmStock;      // the operator's choice, on the record
      // Record where the goods landed, not merely where stock went: when the
      // opt-in is on that is the posting location, otherwise it is whatever the
      // operator chose. Never nulled just because no stock was posted.
      txGrn.rmReceivedAtLocation = addToRmStock ? rmLocation : receivedAtLocation;
      txGrn.receivedAt = new Date();
      txGrn.completedAt = new Date();
      txGrn.completedBy = user?.name || '';
      if (data.remarks) txGrn.remarks = data.remarks;
      txGrn.updatedBy = user?._id;
      txGrn.activityTimeline.push({
        action: 'COMPLETE',
        description: buildCompletionNote(txGrn.grnStatus, rmLines.length, addToRmStock, rmLocation),
        actorId: user?._id,
      });
      await txGrn.save(opts);
      completed = txGrn;
    });
    // From here on, the document that was actually committed.
    // eslint-disable-next-line no-param-reassign
    grn = completed;

    // What the caller tells the operator. Counted from what was actually
    // decided, so the UI can never claim RM stock moved when no RM line did.
    grn.$locals.rmSummary = {
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
    return grn.save();
  },
};
