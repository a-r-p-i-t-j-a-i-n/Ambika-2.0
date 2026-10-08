import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import VendorPurchaseOrder, {
  PO_APPROVAL_STATUS,
  PO_RELEASE_STATUS,
  PO_STATUS,
  PO_FOLLOWUP_STATUS,
  PO_PI_STATUS,
  PO_ADVANCE_PAYMENT_STATUS,
} from './purchaseOrder.model.js';
import GoodsReceiptNote from '../grn/grn.model.js';
import PurchaseIndent, { INDENT_OVERALL_STATUS, ITEM_PROCUREMENT_STATUS, buildItemDisplayNumber, isItemApprovalEffective } from '../indent/indent.model.js';
import Party from '../../clients/party.model.js';
import Vendor from '../../vendors/vendor.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateVendorPoNumber, generateVendorPoDraftNumber } from '../../../utils/docNumberGenerator.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { pricingHistoryService } from '../../vendors/pricingHistory.service.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { emailService } from '../../../services/email.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

// Indent states that allow PO creation. PO_READY covers re-creation after a
// cancelled PO (the indent was already moved forward).
const PO_CREATABLE_INDENT_STATES = [
  INDENT_OVERALL_STATUS.QUOTATION_APPROVED,
  INDENT_OVERALL_STATUS.PARTIAL_PO_CREATED, // still has un-POed approved vendors
  INDENT_OVERALL_STATUS.PO_READY,
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Extract the day count from a free-text lead time like "7 days" / "10". */
export const parseLeadDays = (leadTime) => {
  const m = String(leadTime || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
};

const JSL_GST_RATE = 18; // JSL POs are GST @ 18%

/** Server-authoritative line + total computation, branched by PO format. */
const computeLines = (items = [], format = 'OTHER') => {
  const lines = (items || []).map((it) => {
    const quantity = Number(it.quantity) || 0;
    const receivedQty = Number(it.receivedQty) || 0;

    if (format === 'JSL') {
      // JSL pricing: finalPrice = baseRate − upfront − bonanza; value = qty × finalPrice.
      const baseRate = Number(it.baseRate) || 0;
      const upfrontDiscount = Number(it.upfrontDiscount) || 0;
      const bonanzaDiscount = Number(it.bonanzaDiscount) || 0;
      const finalPrice = round2(baseRate - upfrontDiscount - bonanzaDiscount);
      const value = round2(quantity * finalPrice);
      const taxAmount = round2(value * JSL_GST_RATE / 100);
      const grade = (it.grade || '').trim();
      const width = (it.width || '').trim();
      const finish = (it.finish || '').trim();
      const description = [grade, width, finish].filter(Boolean).join(' ') || (it.itemName || 'JSL Item');
      return {
        // per-line source indent (multi-indent PO)
        indentId: it.indentId || undefined, indentNumber: it.indentNumber || '',
        indentItemId: it.indentItemId || undefined,
        indentItemDisplayNumber: it.indentItemDisplayNumber || '',
        // canonical fields (keep GRN/inventory working: rate=finalPrice, taxable=value)
        itemName: description,
        // real item description (from the indent), kept separate from the Grade
        // Width Finish label above so GRN can show the correct Item Description.
        itemDescription: (it.itemName || '').trim(),
        skuCode: it.skuCode || '', skuId: it.skuId || undefined,
        quantity, unit: it.unit || 'Kgs', rate: finalPrice, gstRate: JSL_GST_RATE,
        taxableAmount: value, taxAmount, totalAmount: round2(value + taxAmount),
        // JSL-specific
        grade, width, finish, baseRate, upfrontDiscount, bonanzaDiscount, finalPrice, value,
        receivedQty, pendingQty: Math.max(0, round2(quantity - receivedQty)),
      };
    }

    const rate = Number(it.rate) || 0;
    const gstRate = Number(it.gstRate) || 0;
    const taxableAmount = round2(quantity * rate);
    const taxAmount = round2(taxableAmount * gstRate / 100);
    return {
      indentId: it.indentId || undefined, indentNumber: it.indentNumber || '',
      indentItemId: it.indentItemId || undefined,
      indentItemDisplayNumber: it.indentItemDisplayNumber || '',
      itemName: it.itemName,
      skuCode: it.skuCode || '',
      skuId: it.skuId || undefined,
      hsn: it.hsn || '',
      quantity, unit: it.unit || 'Pcs', rate, gstRate,
      rateSource: it.rateSource || '',
      taxableAmount, taxAmount,
      totalAmount: round2(taxableAmount + taxAmount),
      receivedQty,
      pendingQty: Math.max(0, round2(quantity - receivedQty)),
    };
  });
  const totalTaxableValue = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const totalGSTAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  return { lines, totals: { totalTaxableValue, totalGSTAmount, grandTotal: round2(totalTaxableValue + totalGSTAmount) } };
};

/** Snapshot vendor fields from the Vendor/Party master, keeping any explicit overrides. */
const vendorSnapshot = (party, data = {}) => ({
  vendorName:    data.vendorName    || party?.name || '',
  vendorGST:     data.vendorGST     || party?.gstNo || '',
  vendorPAN:     data.vendorPAN     || party?.panNo || '',
  vendorAddress: data.vendorAddress || party?.location || party?.address || '',
  vendorEmail:   data.vendorEmail   || party?.email || '',
  vendorPhone:   data.vendorPhone   || party?.phone || '',
  creditPeriod:  data.creditPeriod ?? party?.creditPeriodDays ?? 0,
});

/**
 * Resolve a PO vendor from the Vendor master first, then fall back to the legacy
 * Party master — so new POs use Vendor records while existing Party-based POs
 * (and the multi-vendor approved-quotation flow, which uses Party ids) keep working.
 */
const resolveVendor = async (vendorId) => {
  let doc = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).lean();
  if (!doc) doc = await Party.findOne({ _id: vendorId, isDeleted: { $ne: true } }).lean();
  return doc;
};

/**
 * Resolve To/CC/BCC for a PO release email — prefers the Vendor/Party master's
 * routing lists (toEmails/ccEmails/bccEmails), falling back to the PO's
 * snapshotted vendorEmail when the vendor has none configured. `extraCc`/
 * `extraBcc` (e.g. from a bulk-release request) are merged in and deduped.
 */
const resolvePoEmailRecipients = async (po, { extraCc = [], extraBcc = [] } = {}) => {
  const vendor = await resolveVendor(po.vendorId).catch(() => null);
  const dedupe = (list) => [...new Set((list || []).filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
  const to = dedupe(vendor?.toEmails?.length ? vendor.toEmails : (po.vendorEmail ? [po.vendorEmail] : []));
  const cc = dedupe([...(vendor?.ccEmails || []), ...extraCc]);
  const bcc = dedupe([...(vendor?.bccEmails || []), ...extraBcc]);
  return { to, cc, bcc };
};

// Subject line for a PO release email — shared by the actual send and the
// release-preview endpoint so the preview always matches what gets sent.
const buildPoEmailSubject = (po) => `Purchase Order ${po.poNumber} — ${env.COMPANY_NAME || 'Ambika Global'}`;

// Branded HTML email body for a PO release — mirrors the style used by the
// dispatch-schedule / invoice emails elsewhere in the app.
const buildPoEmailHtml = (po, message) => {
  const bodyHtml = message
    ? String(message).trim().replace(/\n/g, '<br/>')
    : `<p>Dear ${po.vendorName || 'Vendor'},</p><p>Please find attached Purchase Order <b>${po.poNumber}</b> for your reference and processing.</p>`;
  const docChip = po.poPdfFileName
    ? `<tr><td style="padding:14px 24px 4px;font:600 13px Arial,Helvetica,sans-serif;color:#334155;">Attached documents</td></tr>`
      + `<tr><td style="padding:0 24px 18px;">`
      + `<span style="display:inline-block;margin:4px 6px 0 0;padding:5px 11px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font:600 12px Arial,Helvetica,sans-serif;color:#0f172a;">📎 ${po.poPdfFileName}</span>`
      + `</td></tr>`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#0f172a;padding:20px 24px;">
            <span style="font:700 18px Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:.3px;">${env.COMPANY_NAME || 'M/s AMBIKA GLOBAL'}</span>
          </td></tr>
          <tr><td style="padding:24px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#1e293b;">${bodyHtml}</td></tr>
          ${docChip ? `<tr><td><div style="border-top:1px solid #eef2f6;"></div></td></tr>${docChip}` : ''}
          <tr><td style="background:#f8fafc;border-top:1px solid #eef2f6;padding:16px 24px;font:400 12px Arial,Helvetica,sans-serif;color:#94a3b8;">
            This is a system-generated email from ${env.COMPANY_NAME || 'Ambika Global'}. Please do not reply to this message.
          </td></tr>
        </table>
      </td></tr>
    </table>`;
};

/**
 * Send the PO release email to the vendor. Throws on failure (no recipient,
 * or the mail relay rejects) — callers decide whether that's fatal for their
 * flow (single release: non-fatal; bulk release: fails just that one PO).
 * Requires po.poPdfUrl to already be set for the PDF to ride along as a real
 * attachment (falls back to a plain email with no attachment otherwise).
 */
const sendReleaseEmail = async (po, { message, extraCc = [], extraBcc = [] } = {}) => {
  const { to, cc, bcc } = await resolvePoEmailRecipients(po, { extraCc, extraBcc });
  if (!to.length) throw new AppError('Vendor has no email address on file', 400);
  const attachments = po.poPdfUrl
    ? await emailService.resolveStoredAttachments([{ filename: po.poPdfFileName || `${po.poNumber}.pdf`, url: po.poPdfUrl }])
    : [];
  await emailService.sendEmail({
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    bcc: bcc.length ? bcc.join(', ') : undefined,
    subject: buildPoEmailSubject(po),
    html: buildPoEmailHtml(po, message),
    attachments,
  });
  return { to, cc, bcc };
};

/**
 * Set of indent line-item _ids (as strings) that are APPROVED for PO creation.
 * Caller must have already confirmed the indent is in a PO-creatable state.
 *  - Per-item approvals present (Step 1.3 itemApprovedQuotations) → YES (approved)
 *    and QUOTE_NOT_REQUIRED (carried from Step 1.2 — no quote to approve) rows.
 *    QUOTATION_NOT_APPROVED (rejected) and unlisted (pending) items are excluded.
 *  - No per-item rows (whole-indent approval / Quote-Not-Required skip / legacy) → all items.
 */
const approvedItemIdSet = (indent) => {
  const iaq = indent.quotationApprovalStep?.itemApprovedQuotations || [];
  // Items Step 1.2 marked "Quote Not Required" are PO-eligible without a Step 1.3
  // approval (there is no quotation to approve).
  const notRequiredIds = (indent.quoteComparativeStep?.itemQuotations || [])
    .filter((q) => q.statusDone === 'QUOTE_NOT_REQUIRED' && q.itemId)
    .map((q) => String(q.itemId));
  let set;
  if (iaq.length) {
    set = new Set(
      iaq.filter((q) => ['YES', 'QUOTE_NOT_REQUIRED'].includes(q.statusDone) && q.itemId).map((q) => String(q.itemId)),
    );
    // Safety net for older records: include Step 1.2 not-required items even if
    // they were never carried into the Step 1.3 rows.
    notRequiredIds.forEach((id) => set.add(id));
  } else {
    set = new Set((indent.items || []).map((it) => String(it._id)));
  }
  // Item-level rejection at indent approval (Step 1.1) always wins — a rejected
  // item never reaches PO eligibility regardless of Step 1.2/1.3 state.
  const step1Approved = new Set(
    (indent.items || []).filter((it) => isItemApprovalEffective(indent, it)).map((it) => String(it._id)),
  );
  return new Set([...set].filter((id) => step1Approved.has(id)));
};

/**
 * Indent line-items already committed to an active (non-cancelled) PO. Returns both
 * the set of indent-item ids and skuCodes — the skuCode set covers legacy POs whose
 * lines predate `indentItemId`.
 */
const activePoedItemIds = async (indentId, { excludePoId } = {}) => {
  const pos = await VendorPurchaseOrder.find({
    $or: [{ indentId }, { indentIds: indentId }],
    isDeleted: { $ne: true },
    poStatus: { $ne: PO_STATUS.CANCELLED },
    ...(excludePoId ? { _id: { $ne: excludePoId } } : {}),
  }).select('poNumber draftNumber items.indentItemId items.skuCode').lean();
  const ids = new Map();   // indentItemId(string) → poNumber (or draftNumber pre-approval)
  const skus = new Map();  // skuCode(upper) → poNumber  (legacy fallback)
  for (const po of pos) {
    // A draft PO still occupies the item — poNumber isn't assigned yet, so fall
    // back to draftNumber (both are non-empty strings; either keeps the map
    // entry truthy for the "already on an active PO" exclusion check below).
    const ref = po.poNumber || po.draftNumber || 'DRAFT';
    for (const it of po.items || []) {
      if (it.indentItemId) ids.set(String(it.indentItemId), ref);
      else if (it.skuCode) skus.set(String(it.skuCode).toUpperCase(), ref);
    }
  }
  return { ids, skus };
};

/** Recompute an indent's overall status from its per-item procurement status. */
const rollupIndentStatus = (indent) => {
  const approved = approvedItemIdSet(indent);
  if (!approved.size) return; // nothing approved yet — leave status as-is
  const items = (indent.items || []).filter((it) => approved.has(String(it._id)));
  const poed = items.filter((it) => it.procurementStatus === ITEM_PROCUREMENT_STATUS.PO_CREATED).length;
  if (poed === 0) indent.overallStatus = INDENT_OVERALL_STATUS.QUOTATION_APPROVED;
  else if (poed === items.length) indent.overallStatus = INDENT_OVERALL_STATUS.PO_READY;
  else indent.overallStatus = INDENT_OVERALL_STATUS.PARTIAL_PO_CREATED;
};

/**
 * Link a freshly-created PO back to one of its source indents and recompute that
 * indent's overall status.
 *  - Multi-vendor indents (Step 1.3 approvedVendors): stamp poId/poNumber on the
 *    matching approved vendor. The indent becomes PO_READY when every approved
 *    vendor is POed, else PARTIAL_PO_CREATED.
 *  - Item-level indents (no approvedVendors): stamp procurementStatus/poId/poNumber on
 *    the covered indent items and roll the overall status up from the item statuses.
 * Mutates and saves the passed mongoose indent document.
 * `refNumber` is the PO's current reference (draftNumber at creation time —
 * poNumber isn't assigned until approval; see syncIndentPoNumber below, which
 * re-stamps the final poNumber once it exists).
 */
const linkIndentToPo = async (indent, vendorId, po, refNumber, user) => {
  const approvedVendors = indent.quotationApprovalStep?.approvedVendors || [];
  if (approvedVendors.length) {
    approvedVendors.forEach((av) => {
      if (String(av.vendorId) === String(vendorId) && !av.poId) {
        av.poId = po._id;
        av.poNumber = refNumber;
      }
    });
    const allLinked = approvedVendors.every((av) => !!av.poId);
    indent.overallStatus = allLinked
      ? INDENT_OVERALL_STATUS.PO_READY
      : INDENT_OVERALL_STATUS.PARTIAL_PO_CREATED;
  } else {
    // Item-level: stamp every indent item this PO covers (by indentItemId, with a
    // skuCode fallback for any line that lacks one), then roll the status up.
    const poItemIds = new Set((po.items || []).filter((l) => l.indentItemId).map((l) => String(l.indentItemId)));
    const poItemSkus = new Set((po.items || []).filter((l) => !l.indentItemId && l.skuCode).map((l) => String(l.skuCode).toUpperCase()));
    (indent.items || []).forEach((it) => {
      const hit = poItemIds.has(String(it._id)) || (poItemSkus.size && poItemSkus.has(String(it.skuCode || '').toUpperCase()));
      if (hit && it.procurementStatus !== ITEM_PROCUREMENT_STATUS.PO_CREATED) {
        it.procurementStatus = ITEM_PROCUREMENT_STATUS.PO_CREATED;
        it.poId = po._id;
        it.poNumber = refNumber;
      }
    });
    rollupIndentStatus(indent);
  }
  indent.activityTimeline.push({
    action: 'PO_CREATED',
    description: `PO ${refNumber} created (draft — pending approval)`,
    actorId: user?._id,
  });
  indent.updatedBy = user?._id;
  await indent.save();
};

/**
 * Re-stamp the final poNumber onto every indent this PO covers, replacing the
 * draftNumber reference that was stamped at creation. Called once, right after
 * approve() assigns po.poNumber. Non-fatal — the approval itself already stands.
 */
const syncIndentPoNumber = async (po, user) => {
  const indentIds = (po.indentIds?.length ? po.indentIds : [po.indentId]).filter(Boolean);
  if (!indentIds.length) return;
  await PurchaseIndent.updateMany(
    { _id: { $in: indentIds } },
    { $set: { 'quotationApprovalStep.approvedVendors.$[v].poNumber': po.poNumber } },
    { arrayFilters: [{ 'v.poId': po._id }] },
  );
  await PurchaseIndent.updateMany(
    { _id: { $in: indentIds } },
    { $set: { 'items.$[it].poNumber': po.poNumber } },
    { arrayFilters: [{ 'it.poId': po._id }] },
  );
  await PurchaseIndent.updateMany(
    { _id: { $in: indentIds } },
    { $push: { activityTimeline: { action: 'PO_APPROVED', description: `PO ${po.poNumber} approved`, actorId: user?._id, timestamp: new Date() } } },
  );
};

const findOrThrow = async (id) => {
  const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!po) throw new AppError('Purchase Order not found', 404);
  return po;
};

/**
 * Stamp the display-only item reference (e.g. Ind-50.1/26-27) onto each PO line
 * from its source indent item's stable line number. Falls back to array position
 * for older indent items that predate `itemLineNo`. Lines without a matching
 * indent item are left as-is.
 */
const stampLineDisplayNumbers = (lines = [], indents = []) => {
  const byItemId = new Map(); // indentItemId(string) → display reference
  for (const ind of indents) {
    (ind?.items || []).forEach((it, i) => {
      if (it?._id) {
        const lineNo = Number(it.itemLineNo) || (i + 1);
        byItemId.set(String(it._id), buildItemDisplayNumber(ind.indentNumber, lineNo));
      }
    });
  }
  lines.forEach((l) => {
    if (l.indentItemId) {
      const ref = byItemId.get(String(l.indentItemId));
      if (ref) l.indentItemDisplayNumber = ref;
    }
  });
};

// ─────────────────────────────────────────────────────────────
// PDF — professional A4 purchase order
// ─────────────────────────────────────────────────────────────
const PAGE = { w: 595.28, h: 841.89, m: 40 };
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildOtherPoPdfBuffer = (po, company = {}) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = PAGE.w - PAGE.m * 2; // usable width
    const navy = '#0b2545';
    const blue = '#1d4ed8';
    const line = '#dbe4f3';

    // ── Header band ──
    doc.rect(0, 0, PAGE.w, 86).fill(navy);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || env.COMPANY_NAME, PAGE.m, 18);
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
    const headerBits = [company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : '', company.email || env.COMPANY_EMAIL, company.phone || env.COMPANY_PHONE]
      .filter(Boolean).join('   •   ');
    doc.text(headerBits || ' ', PAGE.m, 44, { width: W - 150 });
    doc.font('Helvetica-Bold').fontSize(15).fill('#ffffff').text('PURCHASE ORDER', PAGE.m, 40, { width: W, align: 'right' });

    let y = 104;

    // ── PO info + vendor blocks ──
    // Content is drawn first so the bordered boxes can size to the taller column
    // (long addresses / emails wrap instead of overflowing a fixed-height box).
    const half = W / 2 - 8;
    const boxTop = y;
    const leftX = PAGE.m;
    const rightBoxX = PAGE.m + half + 16;
    const leftInnerX = leftX + 10;
    const rightInnerX = rightBoxX + 10;
    const innerW = half - 20;

    // LEFT — PO DETAILS
    let ly = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('PO DETAILS', leftInnerX, ly); ly += 14;
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(po.poNumber || '', leftInnerX, ly, { width: innerW }); ly += 17;
    doc.font('Helvetica').fontSize(8.5).fill(navy);
    [
      `PO Date: ${fmtDate(po.poDate)}`,
      `Indent No: ${po.indentNumber || '—'}`,
      `Lead Time: ${po.leadTime || '—'}`,
      `Credit Period: ${po.creditPeriod ? `${po.creditPeriod} days` : '—'}`,
    ].forEach((t) => { doc.text(t, leftInnerX, ly, { width: innerW }); ly += 13; });
    const leftBottom = ly;

    // RIGHT — VENDOR / SUPPLIER (fixed label column, wrapping values)
    const vLabelW = 52;       // fixed-width label column → colons + values align
    const vValX = rightInnerX + vLabelW + 8;
    const vValW = innerW - vLabelW - 8;
    let ry = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('VENDOR / SUPPLIER', rightInnerX, ry); ry += 14;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy);
    const vNameH = doc.heightOfString(po.vendorName || '—', { width: innerW });
    doc.text(po.vendorName || '—', rightInnerX, ry, { width: innerW }); ry += vNameH + 6;

    // One label:value row; value wraps within its column, row height auto-adjusts.
    const vRow = (label, value) => {
      doc.font('Helvetica').fontSize(8.5);
      doc.fill('#475a8a').text(label, rightInnerX, ry, { width: vLabelW, lineBreak: false });
      doc.fill('#475a8a').text(':', rightInnerX + vLabelW, ry);
      const vh = doc.fill(navy).heightOfString(value || '—', { width: vValW });
      doc.text(value || '—', vValX, ry, { width: vValW });
      ry += Math.max(11, vh) + 2;
    };
    vRow('GST No.', po.vendorGST || '—');
    vRow('PAN No.', po.vendorPAN || '—');
    ry += 4;
    vRow('Address', po.vendorAddress || '—');
    ry += 4;
    vRow('Phone No.', po.vendorPhone || '—');
    vRow('Email', po.vendorEmail || '—');
    const rightBottom = ry;

    // Borders sized to the taller of the two columns.
    const boxH = Math.max(leftBottom, rightBottom) - boxTop + 10;
    doc.roundedRect(leftX, boxTop, half, boxH, 6).stroke(line);
    doc.roundedRect(rightBoxX, boxTop, half, boxH, 6).stroke(line);

    y = boxTop + boxH + 14;

    // ── Terms strip ──
    doc.roundedRect(PAGE.m, y, W, 30, 6).fill('#f5f8ff');
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Delivery Terms: ${po.deliveryTerms || '—'}`, PAGE.m + 10, y + 6, { width: W / 2 - 20 })
      .text(`Payment Terms: ${po.paymentTerms || '—'}`, PAGE.m + W / 2, y + 6, { width: W / 2 - 10 });
    y += 44;

    // ── Items table ──
    const cols = [
      { key: 'sr',      label: 'SR',                w: 24,  align: 'center' },
      { key: 'name',    label: 'DESCRIPTION OF GOODS', w: 150, align: 'left' },
      { key: 'qty',     label: 'QTY',               w: 44,  align: 'right' },
      { key: 'unit',    label: 'UNIT',              w: 34,  align: 'center' },
      { key: 'rate',    label: 'RATE',              w: 52,  align: 'right' },
      { key: 'taxable', label: 'TAXABLE',           w: 62,  align: 'right' },
      { key: 'gst',     label: 'GST %',             w: 34,  align: 'center' },
      { key: 'tax',     label: 'TAX AMT',           w: 52,  align: 'right' },
      { key: 'total',   label: 'AMOUNT',            w: 63,  align: 'right' },
    ];
    const drawHeaderRow = () => {
      doc.rect(PAGE.m, y, W, 20).fill(navy);
      let x = PAGE.m;
      doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 3, y + 6.5, { width: c.w - 6, align: c.align }); x += c.w; });
      y += 20;
    };
    drawHeaderRow();

    const nameCol = cols.find((c) => c.key === 'name');
    const PADY = 5; // top/bottom cell padding
    (po.items || []).forEach((it, i) => {
      // Measure the description cell: item name (primary) + optional SKU line
      // (secondary). Row height auto-adjusts so long names wrap cleanly.
      const nameStr = it.itemName || '';
      // Secondary line: item-level indent reference (Ind-50.1/26-27) + SKU.
      const refStr = it.indentItemDisplayNumber ? `Ref: ${it.indentItemDisplayNumber}` : '';
      const skuStr = it.skuCode ? `SKU: ${it.skuCode}` : '';
      const subStr = [refStr, skuStr].filter(Boolean).join('   ·   ');
      doc.font('Helvetica').fontSize(8);
      const nameH = doc.heightOfString(nameStr, { width: nameCol.w - 6 });
      const skuH = subStr ? 10 : 0;
      const rowH = Math.max(18, nameH + skuH + PADY * 2 - 2);

      if (y + rowH > PAGE.h - 150) { doc.addPage(); y = PAGE.m; drawHeaderRow(); }

      if (i % 2 === 1) doc.rect(PAGE.m, y, W, rowH).fill('#f8fafc');

      const cells = {
        sr: String(i + 1),
        qty: String(it.quantity), unit: it.unit || 'Pcs',
        rate: Number(it.rate || 0).toFixed(2), taxable: Number(it.taxableAmount || 0).toFixed(2),
        gst: `${it.gstRate || 0}%`, tax: Number(it.taxAmount || 0).toFixed(2),
        total: Number(it.totalAmount || 0).toFixed(2),
      };
      let x = PAGE.m;
      cols.forEach((c) => {
        if (c.key === 'name') {
          doc.font('Helvetica').fontSize(8).fill(navy).text(nameStr, x + 3, y + PADY, { width: c.w - 6 });
          if (subStr) {
            doc.font('Helvetica').fontSize(7).fill('#64748b')
              .text(subStr, x + 9, y + PADY + nameH + 1, { width: c.w - 12 });
          }
        } else {
          doc.font('Helvetica').fontSize(8).fill(navy)
            .text(cells[c.key], x + 3, y + PADY, { width: c.w - 6, align: c.align, ellipsis: true });
        }
        x += c.w;
      });
      doc.moveTo(PAGE.m, y + rowH).lineTo(PAGE.m + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    // ── Totals block ──
    y += 10;
    const totX = PAGE.m + W - 220;
    const totRow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fill(navy);
      doc.text(label, totX, y, { width: 120, align: 'right' });
      doc.text(value, totX + 124, y, { width: 96, align: 'right' });
      y += bold ? 18 : 14;
    };
    totRow('Total Taxable Value:', INR(po.totalTaxableValue));
    totRow('Total GST:', INR(po.totalGSTAmount));
    doc.moveTo(totX, y).lineTo(PAGE.m + W, y).strokeColor(navy).lineWidth(1).stroke(); y += 5;
    totRow('GRAND TOTAL:', INR(po.grandTotal), true);

    // ── Terms & signature footer ──
    y += 12;
    if (y > PAGE.h - 150) { doc.addPage(); y = PAGE.m; }
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('TERMS & CONDITIONS', PAGE.m, y); y += 12;
    doc.font('Helvetica').fontSize(7.5).fill(navy).text(
      po.remarks ||
      '1. Kindly sign and fax back to mark a token of your confirmation.\n' +
      '2. Kindly mention the purchase order number on the tax invoice. Extra qty other than PO will not be accepted.',
      PAGE.m, y, { width: W - 200 },
    );

    doc.font('Helvetica-Bold').fontSize(9).fill(navy)
      .text(`For ${company.name || env.COMPANY_NAME}`, PAGE.m + W - 180, y + 6, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8)
      .text('Authorized Signatory', PAGE.m + W - 180, y + 58, { width: 180, align: 'center' });

    doc.end();
  } catch (err) { reject(err); }
});

// ─────────────────────────────────────────────────────────────
// PDF — JSL format (grade/width/finish + discount pricing)
// ─────────────────────────────────────────────────────────────
export const buildJslPoPdfBuffer = (po, company = {}) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = PAGE.w - PAGE.m * 2;
    const navy = '#0b2545';
    const blue = '#1d4ed8';
    const line = '#dbe4f3';

    // ── Header band ──
    doc.rect(0, 0, PAGE.w, 86).fill(navy);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || env.COMPANY_NAME, PAGE.m, 18);
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
    const headerBits = [company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : '', company.email || env.COMPANY_EMAIL, company.phone || env.COMPANY_PHONE]
      .filter(Boolean).join('   •   ');
    doc.text(headerBits || ' ', PAGE.m, 44, { width: W - 150 });
    doc.font('Helvetica-Bold').fontSize(15).fill('#ffffff').text('PURCHASE ORDER', PAGE.m, 40, { width: W, align: 'right' });

    let y = 104;

    // ── PO info + supplier blocks ──
    const half = W / 2 - 8;
    const boxTop = y;
    const leftX = PAGE.m;
    const rightBoxX = PAGE.m + half + 16;
    const leftInnerX = leftX + 10;
    const rightInnerX = rightBoxX + 10;
    const innerW = half - 20;

    let ly = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('PO DETAILS', leftInnerX, ly); ly += 14;
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(po.poNumber || '', leftInnerX, ly, { width: innerW }); ly += 17;
    doc.font('Helvetica').fontSize(8.5).fill(navy);
    [
      `PO Date: ${fmtDate(po.poDate)}`,
      `Indent No: ${po.indentNumber || '—'}`,
      `GSTIN: ${po.vendorGST || '—'}`,
      `Delivery Terms: ${po.deliveryTerms || '—'}`,
      `Payment Terms: ${po.paymentTerms || '—'}`,
    ].forEach((t) => { doc.text(t, leftInnerX, ly, { width: innerW }); ly += 13; });
    const leftBottom = ly;

    const vLabelW = 52;
    const vValX = rightInnerX + vLabelW + 8;
    const vValW = innerW - vLabelW - 8;
    let ry = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('SUPPLIER', rightInnerX, ry); ry += 14;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy);
    const vNameH = doc.heightOfString(po.vendorName || '—', { width: innerW });
    doc.text(po.vendorName || '—', rightInnerX, ry, { width: innerW }); ry += vNameH + 6;
    const vRow = (label, value) => {
      doc.font('Helvetica').fontSize(8.5);
      doc.fill('#475a8a').text(label, rightInnerX, ry, { width: vLabelW, lineBreak: false });
      doc.fill('#475a8a').text(':', rightInnerX + vLabelW, ry);
      const vh = doc.fill(navy).heightOfString(value || '—', { width: vValW });
      doc.text(value || '—', vValX, ry, { width: vValW });
      ry += Math.max(11, vh) + 2;
    };
    vRow('GST No.', po.vendorGST || '—');
    vRow('PAN No.', po.vendorPAN || '—');
    ry += 4;
    vRow('Address', po.vendorAddress || '—');
    vRow('Phone No.', po.vendorPhone || '—');
    vRow('Email', po.vendorEmail || '—');
    const rightBottom = ry;

    const boxH = Math.max(leftBottom, rightBottom) - boxTop + 10;
    doc.roundedRect(leftX, boxTop, half, boxH, 6).stroke(line);
    doc.roundedRect(rightBoxX, boxTop, half, boxH, 6).stroke(line);
    y = boxTop + boxH + 16;

    // ── Items table (JSL columns) ──
    const cols = [
      { key: 'sr',       label: 'SR',       w: 22, align: 'center' },
      { key: 'grade',    label: 'GRADE',    w: 58, align: 'left' },
      { key: 'width',    label: 'WIDTH',    w: 42, align: 'center' },
      { key: 'finish',   label: 'FINISH',   w: 50, align: 'left' },
      { key: 'qty',      label: 'QTY',      w: 44, align: 'right' },
      { key: 'unit',     label: 'UNITS',    w: 32, align: 'center' },
      { key: 'base',     label: 'BASE RATE', w: 50, align: 'right' },
      { key: 'upfront',  label: 'UPFRONT DISC.', w: 52, align: 'right' },
      { key: 'bonanza',  label: 'BONANZA DISC.', w: 52, align: 'right' },
      { key: 'final',    label: 'FINAL PRICE', w: 50, align: 'right' },
      { key: 'value',    label: 'VALUE',    w: 62, align: 'right' },
    ];
    const HHT = 26; // header height (two-line labels)
    const drawHeaderRow = () => {
      doc.rect(PAGE.m, y, W, HHT).fill(navy);
      let x = PAGE.m;
      doc.font('Helvetica-Bold').fontSize(6.5).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 2, y + 6, { width: c.w - 4, align: c.align }); x += c.w; });
      y += HHT;
    };
    drawHeaderRow();

    const PADY = 5;
    (po.items || []).forEach((it, i) => {
      const gradeStr = it.grade || it.itemName || '';
      doc.font('Helvetica').fontSize(8);
      const gradeH = doc.heightOfString(gradeStr, { width: cols[1].w - 4 });
      const rowH = Math.max(18, gradeH + PADY * 2 - 2);
      if (y + rowH > PAGE.h - 150) { doc.addPage(); y = PAGE.m; drawHeaderRow(); }
      if (i % 2 === 1) doc.rect(PAGE.m, y, W, rowH).fill('#f8fafc');

      const cells = {
        sr: String(i + 1),
        grade: gradeStr,
        width: it.width || '—',
        finish: it.finish || '—',
        qty: String(it.quantity ?? 0),
        unit: it.unit || 'Kgs',
        base: Number(it.baseRate || 0).toFixed(2),
        upfront: Number(it.upfrontDiscount || 0).toFixed(2),
        bonanza: Number(it.bonanzaDiscount || 0).toFixed(2),
        final: Number(it.finalPrice || 0).toFixed(2),
        value: Number(it.value || 0).toFixed(2),
      };
      let x = PAGE.m;
      cols.forEach((c) => {
        doc.font('Helvetica').fontSize(8).fill(navy).text(cells[c.key], x + 2, y + PADY, { width: c.w - 4, align: c.align, ellipsis: true });
        x += c.w;
      });
      doc.moveTo(PAGE.m, y + rowH).lineTo(PAGE.m + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    // ── Totals ──
    y += 10;
    const totX = PAGE.m + W - 220;
    const totRow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fill(navy);
      doc.text(label, totX, y, { width: 120, align: 'right' });
      doc.text(value, totX + 124, y, { width: 96, align: 'right' });
      y += bold ? 18 : 14;
    };
    totRow('Total Taxable Value:', INR(po.totalTaxableValue));
    totRow('GST @ 18%:', INR(po.totalGSTAmount));
    doc.moveTo(totX, y).lineTo(PAGE.m + W, y).strokeColor(navy).lineWidth(1).stroke(); y += 5;
    totRow('Total Amount:', INR(po.grandTotal), true);

    // ── Terms & signature footer ──
    y += 12;
    if (y > PAGE.h - 150) { doc.addPage(); y = PAGE.m; }
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('TERMS & CONDITIONS', PAGE.m, y); y += 12;
    doc.font('Helvetica').fontSize(7.5).fill(navy).text(
      po.remarks || 'This order is under Price Protection Policy till 30th June 2026.',
      PAGE.m, y, { width: W - 200 },
    );

    doc.font('Helvetica-Bold').fontSize(9).fill(navy)
      .text(`For ${company.name || env.COMPANY_NAME}`, PAGE.m + W - 180, y + 6, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8)
      .text('Authorized Signatory', PAGE.m + W - 180, y + 58, { width: 180, align: 'center' });

    // ── Jurisdiction / computer-generated note ──
    doc.font('Helvetica-Bold').fontSize(8).fill(navy)
      .text('SUBJECT TO MUMBAI JURISDICTION', PAGE.m, PAGE.h - 60, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fill('#475a8a')
      .text('This is a computer Generated Purchase Order, no signature required.', PAGE.m, PAGE.h - 48, { width: W, align: 'center' });

    doc.end();
  } catch (err) { reject(err); }
});

// Dispatch to the right layout based on the PO's format.
const buildPoPdfBuffer = (po, company = {}) => (
  po?.poFormatType === 'JSL' ? buildJslPoPdfBuffer(po, company) : buildOtherPoPdfBuffer(po, company)
);

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────
export const purchaseOrderService = {
  /**
   * Global approved-item picker for the New PO form. Returns one flat row per
   * APPROVED, not-yet-PO'd indent line item across every PO-creatable indent, each
   * carrying its item-level reference (Ind-52.1/26-27) so the user can pick items
   * individually and raise a PO for just those — the same indent can feed several
   * POs. Multi-vendor (approvedVendors / Step 1.3) indents are excluded; those use
   * the dedicated multi-vendor drawer. Rows:
   *   - pending-quotation / never-approved items → excluded (approvedItemIdSet)
   *   - rejected (QUOTATION_NOT_APPROVED) items → excluded (approvedItemIdSet)
   *   - already on an active (non-cancelled) PO → excluded
   */
  async getAllApprovedItems() {
    const indents = await PurchaseIndent.find({
      isDeleted: { $ne: true },
      overallStatus: { $in: PO_CREATABLE_INDENT_STATES },
    }).sort({ createdAt: -1 }).lean();

    const items = [];
    for (const indent of indents) {
      // Multi-vendor approvals are committed at the vendor grain — skip here.
      if ((indent.quotationApprovalStep?.approvedVendors?.length || 0) > 0) continue;
      const approvedIds = approvedItemIdSet(indent);
      if (!approvedIds.size) continue;
      // Items that came through the "Quote Not Required" path (whole-indent skip or
      // per-item in Step 1.2) — surfaced so the PO picker can badge them.
      const stepSkipped = !!indent.quotationApprovalStep?.skipped
        || indent.quoteComparativeStep?.statusDone === 'QUOTE_NOT_REQUIRED';
      const notRequiredItemIds = new Set(
        (indent.quoteComparativeStep?.itemQuotations || [])
          .filter((q) => q.statusDone === 'QUOTE_NOT_REQUIRED' && q.itemId)
          .map((q) => String(q.itemId)),
      );
      const { ids: poedIds, skus: poedSkus } = await activePoedItemIds(indent._id);
      (indent.items || []).forEach((it, i) => {
        if (!approvedIds.has(String(it._id))) return;
        const poNumber = poedIds.get(String(it._id)) || poedSkus.get(String(it.skuCode || '').toUpperCase()) || '';
        if (poNumber) return; // already PO-created — exclude
        const approvedQuantity = Number(it.approvedQuantity) || Number(it.revisedQuantity) || Number(it.quantity) || 0;
        if (approvedQuantity <= 0) return; // only items with an approved qty
        const lineNo = Number(it.itemLineNo) || (i + 1);
        const display = buildItemDisplayNumber(indent.indentNumber, lineNo);
        items.push({
          indentId: indent._id,
          indentNumber: indent.indentNumber,
          indentItemId: it._id,
          itemLineNo: lineNo,
          indentItemDisplayNumber: display,
          itemDisplayNumber: display, // alias for any older reads
          skuId: it.skuId || null,
          skuCode: it.skuCode || '',
          itemName: it.itemName || '',
          unit: it.unit || 'Pcs',
          approvedQuantity,
          quoteNotRequired: stepSkipped || notRequiredItemIds.has(String(it._id)),
        });
      });
    }
    return { items };
  },

  async create(data, user) {
    // Rule: PO only from Approved Indent + Approved Quotation.
    const indent = await PurchaseIndent.findOne({ _id: data.indentId, isDeleted: { $ne: true } });
    if (!indent) throw new AppError('Indent not found', 404);
    if (!PO_CREATABLE_INDENT_STATES.includes(indent.overallStatus)) {
      throw new AppError('Purchase Order can only be created after the quotation is approved (Step 1.3)', 400);
    }

    // Rule: one active PO per vendor on an indent. When the indent approved
    // multiple vendors (Step 1.3), each approved vendor may have its own PO, so
    // the guard is scoped to (indent + vendor). For legacy single-vendor indents
    // the scope collapses to one active PO per indent. Only a CANCELLED PO frees
    // the slot — draft/approved/released/received POs all block re-creation.
    const isMultiVendor = (indent.quotationApprovalStep?.approvedVendors?.length || 0) > 0;
    const activePo = await VendorPurchaseOrder.findOne({
      indentId: indent._id,
      ...(isMultiVendor ? { vendorId: data.vendorId } : {}),
      isDeleted: { $ne: true },
      poStatus: { $ne: PO_STATUS.CANCELLED },
    }).select('poNumber draftNumber poStatus vendorName').lean();
    if (activePo) {
      const scope = isMultiVendor ? `vendor ${activePo.vendorName || ''}`.trim() : `Indent ${indent.indentNumber}`;
      throw new AppError(`${scope} already has an active PO (${activePo.poNumber || activePo.draftNumber}). Cancel it before creating a new one.`, 400);
    }

    const party = await resolveVendor(data.vendorId);
    if (!party) throw new AppError('Vendor not found', 404);

    // Finished Goods are sell-side only — never purchasable.
    await assertPurchasable(data.items);

    const poFormatType = data.poFormatType === 'JSL' ? 'JSL' : 'OTHER';
    const { lines, totals } = computeLines(data.items, poFormatType);
    // Single-indent PO: every line belongs to this indent.
    lines.forEach((l) => { l.indentId = indent._id; l.indentNumber = indent.indentNumber; });
    // Stamp the item-level display reference (Ind-50.1/26-27) from the indent.
    stampLineDisplayNumbers(lines, [indent]);
    // Draft-only reference — the final poNumber is assigned on approval so the
    // sequence follows approval order, not draft-creation order.
    const draftNumber = await generateVendorPoDraftNumber(data.poDate || new Date());

    const po = await VendorPurchaseOrder.create({
      draftNumber,
      poFormatType,
      poDate: data.poDate || new Date(),
      indentId: indent._id,
      indentNumber: indent.indentNumber,
      indentIds: [indent._id],
      indentNumbers: [indent.indentNumber],
      vendorId: party._id,
      ...vendorSnapshot(party, data),
      deliveryTerms: data.deliveryTerms || '',
      paymentTerms: data.paymentTerms || '',
      leadTime: data.leadTime || '',
      remarks: data.remarks || '',
      items: lines,
      ...totals,
      approvalStatus: PO_APPROVAL_STATUS.DRAFT,
      releaseStatus: PO_RELEASE_STATUS.NOT_RELEASED,
      poStatus: PO_STATUS.DRAFT,
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `PO created from ${indent.indentNumber} (draft ${draftNumber})`, actorId: user?._id }],
    });

    // Move the indent forward (linkage for future Follow-up / GRN). Non-fatal.
    try {
      const update = {
        $set: { overallStatus: INDENT_OVERALL_STATUS.PO_READY },
        $push: { activityTimeline: { action: 'PO_CREATED', description: `PO ${draftNumber} created (draft — pending approval)`, actorId: user?._id, timestamp: new Date() } },
      };
      const arrayFilters = [];
      // Multi-vendor: stamp the PO linkage onto the matching approved vendor so
      // the indent reflects which vendor still needs a PO.
      if (isMultiVendor) {
        update.$set['quotationApprovalStep.approvedVendors.$[v].poId'] = po._id;
        update.$set['quotationApprovalStep.approvedVendors.$[v].poNumber'] = draftNumber;
        arrayFilters.push({ 'v.vendorId': party._id });
      } else {
        // Item-level grain: stamp procurement status on the indent items this PO
        // covers (legacy payload has no indentItemId, so match by skuCode).
        const skus = [...new Set(lines.map((l) => String(l.skuCode || '').toUpperCase()).filter(Boolean))];
        if (skus.length) {
          update.$set['items.$[it].procurementStatus'] = ITEM_PROCUREMENT_STATUS.PO_CREATED;
          update.$set['items.$[it].poId'] = po._id;
          update.$set['items.$[it].poNumber'] = draftNumber;
          arrayFilters.push({ 'it.skuCode': { $in: skus } });
        }
      }
      await PurchaseIndent.updateOne(
        { _id: indent._id },
        update,
        arrayFilters.length ? { arrayFilters } : {},
      );
    } catch (err) { logger.error(`[po] indent status update failed: ${err.message}`); }

    return po;
  },

  /**
   * Multi-indent PO: one vendor, items drawn from one or more approved indents.
   * Business rule — one PO = one vendor; a PO may combine same-vendor items from
   * several indents. The caller (form) groups items by vendor and submits one
   * vendor group at a time, each item tagged with its source indentId.
   */
  async createMulti(data, user) {
    const indentIds = [...new Set((data.indentIds || []).map(String))];
    if (!indentIds.length) throw new AppError('Select at least one approved indent', 400);
    if (!data.items?.length) throw new AppError('At least one item is required', 400);

    // Load + validate every selected indent.
    const indents = await PurchaseIndent.find({ _id: { $in: indentIds }, isDeleted: { $ne: true } });
    if (indents.length !== indentIds.length) throw new AppError('One or more indents not found', 404);
    const indentById = new Map(indents.map((i) => [String(i._id), i]));
    for (const ind of indents) {
      if (!PO_CREATABLE_INDENT_STATES.includes(ind.overallStatus)) {
        throw new AppError(`Indent ${ind.indentNumber} is not ready for PO (approve its quotation first)`, 400);
      }
    }

    const party = await resolveVendor(data.vendorId);
    if (!party) throw new AppError('Vendor not found', 400);

    // Every item row must belong to one of the selected indents.
    if (data.items.some((it) => !indentById.has(String(it.indentId || '')))) {
      throw new AppError('Every PO item must belong to one of the selected indents', 400);
    }

    // Conflict guard, scoped per indent:
    //  - Multi-vendor (approvedVendors) indents keep the "one active PO per (indent,
    //    vendor)" rule, since items are committed at the vendor grain.
    //  - Item-level indents reject only the specific items already on an active PO,
    //    so the same indent's remaining approved items can still be POed separately.
    for (const ind of indents) {
      const isMulti = (ind.quotationApprovalStep?.approvedVendors?.length || 0) > 0;
      if (isMulti) {
        const activePo = await VendorPurchaseOrder.findOne({
          $or: [{ indentIds: ind._id }, { indentId: ind._id }],
          vendorId: party._id,
          isDeleted: { $ne: true },
          poStatus: { $ne: PO_STATUS.CANCELLED },
        }).select('poNumber draftNumber').lean();
        if (activePo) {
          throw new AppError(`Indent ${ind.indentNumber} already has an active PO (${activePo.poNumber || activePo.draftNumber}) for this vendor. Cancel it before creating a new one.`, 400);
        }
      } else {
        const { ids: poedIds, skus: poedSkus } = await activePoedItemIds(ind._id);
        const offenders = data.items
          .filter((it) => String(it.indentId) === String(ind._id))
          .filter((it) => (it.indentItemId && poedIds.has(String(it.indentItemId)))
            || (!it.indentItemId && it.skuCode && poedSkus.has(String(it.skuCode).toUpperCase())));
        if (offenders.length) {
          const names = offenders.map((o) => o.itemName || o.skuCode).filter(Boolean).join(', ');
          throw new AppError(`Already on an active PO for ${ind.indentNumber}: ${names}. Refresh and try again.`, 400);
        }
      }
    }

    await assertPurchasable(data.items);

    const poFormatType = data.poFormatType === 'JSL' ? 'JSL' : 'OTHER';
    const { lines, totals } = computeLines(data.items, poFormatType);
    lines.forEach((l) => {
      if (!l.indentNumber && l.indentId) l.indentNumber = indentById.get(String(l.indentId))?.indentNumber || '';
    });
    // Stamp each line's item-level display reference from its source indent item.
    stampLineDisplayNumbers(lines, indents);

    const orderedIndents = indentIds.map((id) => indentById.get(id)).filter(Boolean);
    // Draft-only reference — the final poNumber is assigned on approval so the
    // sequence follows approval order, not draft-creation order.
    const draftNumber = await generateVendorPoDraftNumber(data.poDate || new Date());

    const po = await VendorPurchaseOrder.create({
      draftNumber,
      poFormatType,
      poDate: data.poDate || new Date(),
      indentId: orderedIndents[0]._id,
      indentNumber: orderedIndents[0].indentNumber,
      indentIds: orderedIndents.map((i) => i._id),
      indentNumbers: orderedIndents.map((i) => i.indentNumber),
      vendorId: party._id,
      ...vendorSnapshot(party, data),
      deliveryTerms: data.deliveryTerms || '',
      paymentTerms: data.paymentTerms || '',
      leadTime: data.leadTime || '',
      remarks: data.remarks || '',
      items: lines,
      ...totals,
      approvalStatus: PO_APPROVAL_STATUS.DRAFT,
      releaseStatus: PO_RELEASE_STATUS.NOT_RELEASED,
      poStatus: PO_STATUS.DRAFT,
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `PO created from ${orderedIndents.map((i) => i.indentNumber).join(', ')} (draft ${draftNumber})`, actorId: user?._id }],
    });

    // Link every involved indent and recompute its status (non-fatal per indent).
    for (const ind of orderedIndents) {
      try {
        await linkIndentToPo(ind, party._id, po, draftNumber, user);
      } catch (err) { logger.error(`[po] multi-indent link failed for ${ind.indentNumber}: ${err.message}`); }
    }

    return po;
  },

  /**
   * Item-wise PO creation from the New PO form's "Approved Item(s)" picker. The
   * client sends one vendor + a hand-picked set of approved items (each tagged with
   * its source indentId / indentItemId). We derive the distinct source indents and
   * delegate to createMulti, which enforces "one PO = one vendor", the per-item
   * already-PO'd guard, and the indent status roll-up. The same indent can thus
   * feed several POs (different items → different vendors), one PO at a time.
   */
  async createFromItems(data, user) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) throw new AppError('Select at least one approved item', 400);
    if (items.some((it) => !it.indentId)) throw new AppError('Every selected item must reference its source indent', 400);
    const indentIds = [...new Set(items.map((it) => String(it.indentId)))];
    return this.createMulti({ ...data, indentIds }, user);
  },

  /**
   * Render a PO PDF from in-progress form data WITHOUT saving anything. Used by the
   * "Preview PDF" button so the user can review before Save-as-Draft. Reuses the
   * same JSL / OTHER builders as the released-PO PDF, so the layout matches 1:1.
   */
  async previewPdf(data = {}) {
    const poFormatType = data.poFormatType === 'JSL' ? 'JSL' : 'OTHER';
    const { lines, totals } = computeLines(data.items || [], poFormatType);

    // Vendor snapshot — prefer the explicit form fields, fall back to a lookup by id.
    let party = null;
    if (data.vendorId) { try { party = await resolveVendor(data.vendorId); } catch { /* preview is best-effort */ } }

    const poLike = {
      poNumber: data.poNumber || 'DRAFT — PREVIEW',
      poFormatType,
      poDate: data.poDate || new Date(),
      ...vendorSnapshot(party, data),
      deliveryTerms: data.deliveryTerms || '',
      paymentTerms: data.paymentTerms || '',
      leadTime: data.leadTime || '',
      remarks: data.remarks || '',
      items: lines,
      ...totals,
    };

    // Best-effort company header (same source as the saved-PO PDF).
    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail };
    } catch { /* fall back to env defaults inside the builder */ }

    return buildPoPdfBuffer(poLike, company);
  },

  async getAll(query) {
    const features = new ApiFeatures(
      VendorPurchaseOrder.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['poNumber', 'draftNumber', 'indentNumber', 'vendorName'])
      .sort()
      .select()
      .paginate()
      .populateRefs([{ path: 'createdBy', select: 'name' }]);
    return features.exec();
  },

  async getById(id) {
    // vendorId is intentionally NOT populated — it may reference either the Vendor
    // master or the legacy Party master. The PO stores vendor* snapshot fields for
    // display, and keeping the raw id lets the edit form re-match it.
    const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name')
      .lean();
    if (!po) throw new AppError('Purchase Order not found', 404);
    // Resolve the "revised as" link by query so the cancelled PO stays unmutated.
    const revision = await VendorPurchaseOrder.findOne({ revisedFromPoId: po._id, isDeleted: { $ne: true } })
      .select('poNumber poStatus').sort({ createdAt: -1 }).lean();
    if (revision) { po.revisedToPoId = revision._id; po.revisedToPoNumber = revision.poNumber; }
    return po;
  },

  async getStats() {
    const rows = await VendorPurchaseOrder.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          approved:        { $sum: { $cond: [{ $eq: ['$approvalStatus', PO_APPROVAL_STATUS.APPROVED] }, 1, 0] } },
          released:        { $sum: { $cond: [{ $eq: ['$releaseStatus', PO_RELEASE_STATUS.RELEASED] }, 1, 0] } },
          partialReceived: { $sum: { $cond: [{ $eq: ['$poStatus', PO_STATUS.PARTIAL_RECEIVED] }, 1, 0] } },
          fullyReceived:   { $sum: { $cond: [{ $eq: ['$poStatus', PO_STATUS.FULLY_RECEIVED] }, 1, 0] } },
          totalValue:      { $sum: '$grandTotal' },
        },
      },
    ]);
    return rows[0] || { total: 0, approved: 0, released: 0, partialReceived: 0, fullyReceived: 0, totalValue: 0 };
  },

  async update(id, data, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft purchase orders can be edited', 400);
    }
    if (data.vendorId && String(data.vendorId) !== String(po.vendorId)) {
      const party = await resolveVendor(data.vendorId);
      if (!party) throw new AppError('Vendor not found', 404);
      Object.assign(po, { vendorId: party._id }, vendorSnapshot(party, data));
    }
    const { vendorId: _v, items, ...rest } = data;
    Object.assign(po, rest); // applies poFormatType (if sent) before recompute
    if (items) {
      await assertPurchasable(items);
      const { lines, totals } = computeLines(items, po.poFormatType);
      po.items = lines;
      Object.assign(po, totals);
    }
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'UPDATE', description: 'Draft PO updated', actorId: user?._id });
    const saved = await po.save();
    return saved;
  },

  async remove(id, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft purchase orders can be deleted', 400);
    }
    po.isDeleted = true;
    po.deletedAt = new Date();
    po.deletedBy = user?._id;
    po.activityTimeline.push({ action: 'DELETE', description: 'Purchase order deleted', actorId: user?._id });
    return po.save();
  },

  async approve(id, data, user) {
    const approved = data.decision !== 'REJECTED';
    const approval = {
      decidedBy: user?.name || '',
      decidedById: user?._id,
      decidedAt: new Date(),
      remarks: data.remarks || '',
    };

    // Atomically flip DRAFT → APPROVED/REJECTED, filtered on approvalStatus still
    // being DRAFT. MongoDB applies findOneAndUpdate as a single atomic operation
    // per document, so of two concurrent approve calls on the same PO only one can
    // match-and-flip; the other's filter re-evaluates against the now-updated doc,
    // finds no match, and falls through to the "not draft" error below — so only
    // one caller ever proceeds to mint a poNumber.
    const claimed = await VendorPurchaseOrder.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true }, approvalStatus: PO_APPROVAL_STATUS.DRAFT },
      {
        $set: {
          approvalStatus: approved ? PO_APPROVAL_STATUS.APPROVED : PO_APPROVAL_STATUS.REJECTED,
          poStatus: approved ? PO_STATUS.APPROVED : PO_STATUS.DRAFT,
          approval,
          updatedBy: user?._id,
        },
      },
      { new: true },
    );
    if (!claimed) {
      const exists = await VendorPurchaseOrder.exists({ _id: id, isDeleted: { $ne: true } });
      if (!exists) throw new AppError('Purchase Order not found', 404);
      throw new AppError('Only draft purchase orders can be approved/rejected', 400);
    }

    // The final PO number is minted here, on approval — not at draft creation —
    // so the sequence follows approval order (generateVendorPoNumber's counter
    // increment is atomic, so concurrent approvals of different POs never collide).
    if (approved && !claimed.poNumber) {
      claimed.poNumber = await generateVendorPoNumber(claimed.poDate || new Date());
    }
    claimed.activityTimeline.push({
      action: approved ? 'APPROVE' : 'REJECT',
      description: approved ? `PO approved — assigned ${claimed.poNumber}` : 'PO rejected',
      actorId: user?._id,
    });
    const saved = await claimed.save();

    if (approved) {
      try { await syncIndentPoNumber(saved, user); }
      catch (err) { logger.error(`[po] indent poNumber sync failed for ${saved.poNumber}: ${err.message}`); }
      // Vendor Master + Pricing History are updated only once the PO is approved
      // (never from a draft that may still be edited, rejected or deleted), so
      // every PO-sourced history row carries the final PO number.
      await pricingHistoryService.recordPoLines(saved, user);
    }

    return saved;
  },

  /** Generate the PO PDF, store to S3 (or local fallback) and persist its URL. */
  async generatePdf(id) {
    const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!po) throw new AppError('Purchase Order not found', 404);

    // Best-effort company GSTIN from the pricing CompanySettings singleton.
    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail };
    } catch { /* fall back to env */ }

    const buffer = await buildPoPdfBuffer(po, company);
    const fileName = `${String(po.poNumber || 'PO').replace(/[^\w.-]/g, '_')}.pdf`;

    let poPdfUrl;
    if (s3Enabled) {
      const key = buildKey('purchase-orders', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      poPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'purchase-orders');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      poPdfUrl = `${SERVER_BASE}/uploads/purchase-orders/${path.basename(fp)}`;
    }
    await VendorPurchaseOrder.updateOne({ _id: id }, { $set: { poPdfUrl, poPdfFileName: fileName } });
    return { poPdfUrl, poPdfFileName: fileName };
  },

  async release(id, data, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.APPROVED) {
      throw new AppError('PO must be approved before it can be released', 400);
    }
    if (po.releaseStatus === PO_RELEASE_STATUS.RELEASED) {
      throw new AppError('PO is already released', 400);
    }

    po.releaseStatus = PO_RELEASE_STATUS.RELEASED;
    po.poStatus = PO_STATUS.RELEASED_TO_VENDOR;
    po.releasedBy = user?.name || '';
    po.releasedById = user?._id;
    po.releasedAt = new Date();
    // Step 1.5 — open the material follow-up window.
    po.followUpStatus = PO_FOLLOWUP_STATUS.PENDING;
    const leadDays = parseLeadDays(po.leadTime);
    if (leadDays > 0) {
      po.expectedDeliveryDate = new Date(po.releasedAt.getTime() + leadDays * 86400000);
    }
    if (data.supplierAcknowledgement) po.supplierAcknowledgement = data.supplierAcknowledgement;
    if (data.remarks) po.remarks = data.remarks;
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'RELEASE', description: 'PO released to vendor', actorId: user?._id });
    await po.save();

    // Generate + store the PDF (non-fatal — release stands even if PDF fails;
    // the email below needs this URL to attach it, so it happens first).
    try {
      const { poPdfUrl, poPdfFileName } = await this.generatePdf(id);
      po.poPdfUrl = poPdfUrl;
      po.poPdfFileName = poPdfFileName;
    } catch (err) { logger.error(`[po] PDF generation failed for ${po.poNumber}: ${err.message}`); }

    // Email the vendor (non-fatal — the release itself already stands either way).
    if (data.sendEmail) {
      try {
        await sendReleaseEmail(po, { message: data.emailMessage, extraCc: data.ccEmails, extraBcc: data.bccEmails });
        po.supplierEmailSent = true;
        po.supplierEmailSentAt = new Date();
        po.activityTimeline.push({ action: 'EMAIL_SENT', description: `PO email sent to ${po.vendorEmail || 'vendor'}`, actorId: user?._id });
        await po.save();
      } catch (err) {
        logger.error(`[po] release email failed for ${po.poNumber}: ${err.message}`);
        po.activityTimeline.push({ action: 'EMAIL_FAILED', description: `PO email failed: ${err.message}`, actorId: user?._id });
        await po.save();
      }
    }

    return po;
  },

  /**
   * Bulk-release multiple approved, not-yet-released POs to their vendors in
   * one request (Step 1.4 — "Bulk Release PO"). Each PO is processed fully
   * independently. The release status is flipped as soon as a PO's own
   * eligibility is confirmed — PDF generation and the vendor email are
   * best-effort side effects that can never block the release itself (same
   * semantics as the single-PO release below), so a mail-transport outage or
   * a vendor with no email on file can no longer make the entire batch fail
   * while every PO stays stuck looking "eligible". One PO's failure never
   * stops or affects any other PO in the batch.
   */
  async bulkRelease(data, user) {
    const poIds = [...new Set((data.poIds || []).map(String))];
    const result = { total: poIds.length, released: 0, failedCount: 0, success: [], failed: [] };

    for (const poId of poIds) {
      let poNumberForError = '';
      try {
        const po = await VendorPurchaseOrder.findOne({ _id: poId, isDeleted: { $ne: true } });
        if (!po) throw new AppError('Purchase Order not found', 404);
        poNumberForError = po.poNumber;

        // Rule: only APPROVED + NOT_RELEASED POs can be released.
        if (po.releaseStatus === PO_RELEASE_STATUS.RELEASED) {
          throw new AppError('Already released', 400);
        }
        if (po.approvalStatus !== PO_APPROVAL_STATUS.APPROVED || po.poStatus !== PO_STATUS.APPROVED) {
          throw new AppError('Invalid status — PO must be approved and awaiting release', 400);
        }

        // 1) Flip the release status — this is the release, and it stands
        // regardless of what happens with the PDF/email below.
        po.releaseStatus = PO_RELEASE_STATUS.RELEASED;
        po.poStatus = PO_STATUS.RELEASED_TO_VENDOR;
        po.releasedBy = user?.name || '';
        po.releasedById = user?._id;
        po.releasedAt = new Date();
        po.followUpStatus = PO_FOLLOWUP_STATUS.PENDING;
        const leadDays = parseLeadDays(po.leadTime);
        if (leadDays > 0) {
          po.expectedDeliveryDate = new Date(po.releasedAt.getTime() + leadDays * 86400000);
        }
        po.updatedBy = user?._id;
        po.activityTimeline.push({ action: 'RELEASE', description: 'PO released to vendor (bulk release)', actorId: user?._id });
        await po.save();

        // 2) Generate + store the PDF (non-fatal — release already stands).
        try {
          const { poPdfUrl, poPdfFileName } = await this.generatePdf(poId);
          po.poPdfUrl = poPdfUrl;
          po.poPdfFileName = poPdfFileName;
        } catch (err) {
          logger.error(`[po] bulk-release PDF generation failed for ${po.poNumber}: ${err.message}`);
        }

        // 3) Email the vendor (non-fatal — release already stands either way).
        let emailedTo = '';
        try {
          const { to, cc, bcc } = await resolvePoEmailRecipients(po, { extraCc: data.ccEmails, extraBcc: data.bccEmails });
          if (!to.length) throw new Error('Missing vendor email');
          await emailService.sendEmail({
            to: to.join(', '),
            cc: cc.length ? cc.join(', ') : undefined,
            bcc: bcc.length ? bcc.join(', ') : undefined,
            subject: buildPoEmailSubject(po),
            html: buildPoEmailHtml(po, data.emailMessage),
            attachments: await emailService.resolveStoredAttachments([{ filename: po.poPdfFileName || `${po.poNumber}.pdf`, url: po.poPdfUrl }]),
          });
          emailedTo = to.join(', ');
          po.supplierEmailSent = true;
          po.supplierEmailSentAt = new Date();
          po.activityTimeline.push({ action: 'EMAIL_SENT', description: `PO email sent to ${emailedTo}`, actorId: user?._id });
        } catch (err) {
          logger.error(`[po] bulk-release email failed for ${po.poNumber}: ${err.message}`);
          po.activityTimeline.push({ action: 'EMAIL_FAILED', description: `PO email failed: ${err.message}`, actorId: user?._id });
        }
        await po.save();

        result.released += 1;
        result.success.push({ poId: po._id, poNumber: po.poNumber, vendorName: po.vendorName, email: emailedTo });
      } catch (err) {
        result.failedCount += 1;
        result.failed.push({ poId, poNumber: poNumberForError, reason: err.message });
      }
    }

    return result;
  },

  /**
   * Read-only preview of who a bulk-release will actually email, and what the
   * subject/attachment will be — mirrors the exact recipient resolution and
   * subject template `bulkRelease` uses, without sending anything or writing
   * anything. Best-effort: a PO that no longer exists is silently skipped
   * rather than failing the whole preview.
   */
  async getReleasePreview({ poIds, ccEmails = [], bccEmails = [] } = {}) {
    const ids = [...new Set((poIds || []).map(String))];
    const pos = await VendorPurchaseOrder.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).lean();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const items = await Promise.all(pos.map(async (po) => {
      const { to, cc, bcc } = await resolvePoEmailRecipients(po, { extraCc: ccEmails, extraBcc: bccEmails });
      let emailStatus;
      if (po.releaseStatus === PO_RELEASE_STATUS.RELEASED) emailStatus = 'ALREADY_RELEASED';
      else if (!to.length) emailStatus = 'MISSING_RECIPIENT';
      else if (to.some((e) => !emailRe.test(e))) emailStatus = 'INVALID_EMAIL';
      else emailStatus = 'READY';

      return {
        poId: po._id,
        poNumber: po.poNumber || po.draftNumber || '',
        vendorId: po.vendorId,
        vendorName: po.vendorName || '',
        to,
        cc,
        bcc,
        emailStatus,
        subject: buildPoEmailSubject(po),
        attachmentName: po.poPdfFileName || `${po.poNumber || po.draftNumber || 'PO'}.pdf`,
        pdfReady: !!po.poPdfUrl,
      };
    }));

    return { from: env.MAIL_FROM || env.COMPANY_NAME || '', items };
  },

  /**
   * Mark PI as Not Required — the audited "PI is optional" path.
   * Only valid for a RELEASED PO that has no PI in progress and no GRN yet.
   * Records reason/remarks/who/when forever and advances the PI gate so a GRN
   * can proceed without a proforma invoice or advance payment.
   */
  async markPiNotRequired(id, data, user) {
    const po = await findOrThrow(id);

    if (po.poStatus !== PO_STATUS.RELEASED_TO_VENDOR) {
      throw new AppError('PI can only be marked Not Required after the PO is released to the vendor', 400);
    }
    if (po.piStatus === PO_PI_STATUS.PI_NOT_REQUIRED) {
      throw new AppError('PI is already marked as Not Required', 400);
    }
    // A PI already exists / is in progress → cannot skip it.
    if (po.piStatus !== PO_PI_STATUS.NOT_RECEIVED || po.piId) {
      throw new AppError('A proforma invoice already exists for this PO — it cannot be marked Not Required', 400);
    }
    // No downstream document may exist yet (GRN is the gateway to QC/Invoice/Voucher).
    const grnCount = await GoodsReceiptNote.countDocuments({ poId: po._id, isDeleted: { $ne: true } });
    if (grnCount > 0) {
      throw new AppError('A GRN already exists for this PO — PI cannot be marked Not Required', 400);
    }

    po.piStatus = PO_PI_STATUS.PI_NOT_REQUIRED;
    po.advancePaymentStatus = PO_ADVANCE_PAYMENT_STATUS.NOT_REQUIRED;
    po.piNotRequiredReason = data.reason;
    po.piNotRequiredRemarks = data.remarks || '';
    po.piNotRequiredBy = user?._id;
    po.piNotRequiredByName = user?.name || '';
    po.piNotRequiredAt = new Date();
    po.updatedBy = user?._id;
    po.activityTimeline.push({
      action: 'PI_NOT_REQUIRED',
      description: `PI marked as Not Required. Reason: ${data.reason}${data.remarks ? ` | Remarks: ${data.remarks}` : ''}`,
      actorId: user?._id,
    });
    return po.save();
  },

  async cancel(id, data, user) {
    const po = await findOrThrow(id);
    if ([PO_STATUS.FULLY_RECEIVED, PO_STATUS.CLOSED, PO_STATUS.CANCELLED].includes(po.poStatus)) {
      throw new AppError(`Cannot cancel a PO in ${po.poStatus} state`, 400);
    }
    po.poStatus = PO_STATUS.CANCELLED;
    if (data.remarks) po.remarks = data.remarks;
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'CANCEL', description: 'PO cancelled', actorId: user?._id });
    await po.save();

    // Release every indent item / approved vendor this PO had committed, so the
    // freed items become selectable again and the indent status rolls back.
    // Non-fatal — the cancellation itself already stands.
    try {
      const indentIds = (po.indentIds?.length ? po.indentIds : [po.indentId]).filter(Boolean);
      for (const indId of indentIds) {
        const indent = await PurchaseIndent.findOne({ _id: indId, isDeleted: { $ne: true } });
        if (!indent) continue;
        const avs = indent.quotationApprovalStep?.approvedVendors || [];
        if (avs.length) {
          let touched = false;
          avs.forEach((av) => {
            if (String(av.poId) === String(po._id)) { av.poId = null; av.poNumber = ''; touched = true; }
          });
          if (touched) {
            indent.overallStatus = avs.some((av) => !!av.poId)
              ? INDENT_OVERALL_STATUS.PARTIAL_PO_CREATED
              : INDENT_OVERALL_STATUS.QUOTATION_APPROVED;
          }
        } else {
          (indent.items || []).forEach((it) => {
            if (String(it.poId) === String(po._id)) {
              it.procurementStatus = ITEM_PROCUREMENT_STATUS.PENDING;
              it.poId = null;
              it.poNumber = '';
            }
          });
          rollupIndentStatus(indent);
        }
        indent.activityTimeline.push({ action: 'PO_CANCELLED', description: `PO ${po.poNumber || po.draftNumber} cancelled — items released`, actorId: user?._id });
        indent.updatedBy = user?._id;
        await indent.save();
      }
    } catch (err) { logger.error(`[po] cancel item release failed: ${err.message}`); }

    return po;
  },

  /**
   * Revise a CANCELLED PO into a NEW draft PO. The cancelled PO is never edited —
   * a fresh record is created (new number, DRAFT) from the submitted (possibly
   * edited) payload, linked back via revisedFromPoId / revisionNo. Reuses
   * createMulti so the one-PO-per-vendor + per-item already-PO'd guards and the
   * indent status roll-up all apply (an item can't land on two active POs).
   */
  async revise(id, data, user) {
    const src = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!src) throw new AppError('Purchase Order not found', 404);
    if (src.poStatus !== PO_STATUS.CANCELLED) {
      throw new AppError('Only a cancelled purchase order can be revised', 400);
    }

    // Default each line's source indent to the cancelled PO's indent when missing
    // (covers manually-added lines), then derive the distinct source indents.
    const items = (Array.isArray(data.items) ? data.items : []).map((it) => ({
      ...it,
      indentId: it.indentId || src.indentId,
      indentNumber: it.indentNumber || src.indentNumber || '',
    }));
    if (!items.length) throw new AppError('At least one item is required to revise the PO', 400);
    const indentIds = [...new Set(items.map((it) => String(it.indentId)).filter(Boolean))];

    const po = await this.createMulti({
      ...data,
      vendorId: data.vendorId || src.vendorId,
      poFormatType: data.poFormatType || src.poFormatType,
      indentIds,
      items,
    }, user);

    // Stamp the revision linkage onto the freshly-created draft. The cancelled
    // source may itself have been cancelled before ever being approved, in which
    // case it never got a final poNumber — fall back to its draftNumber.
    const srcRef = src.poNumber || src.draftNumber;
    po.revisedFromPoId = src._id;
    po.revisedFromPoNumber = srcRef;
    po.revisionNo = (Number(src.revisionNo) || 0) + 1;
    po.activityTimeline.push({
      action: 'REVISE',
      description: `Revised from ${srcRef} (revision ${po.revisionNo})`,
      actorId: user?._id,
    });
    await po.save();
    return po;
  },
};
