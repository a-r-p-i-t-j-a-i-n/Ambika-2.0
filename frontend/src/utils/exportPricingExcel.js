/**
 * exportPricingExcel
 * ------------------
 * Builds a single .xlsx workbook with three sheets, matching the structure
 * the client described:
 *
 *   Sheet 1 — "Current SKU Prices"
 *     SKU | Current Price | Effective Date | Previous Price | Last Revision By | Remarks
 *
 *   Sheet 2 — "Price Revision History"
 *     Timestamp | SKU | Old Price | New Price | Effective Date | Reason | Updated By | Status | Proof Link
 *
 *   Sheet 3 — "Supporting Documents"
 *     SKU | Revision Date | Updated By | File Name | File Link | Reason | Notes
 *
 * The output filename embeds the price stream + today's date:
 *   Pricing-Master_SELLING_2026-05-17.xlsx
 */

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import dayjs from 'dayjs';

const fmtDate = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '');
const fmtDT   = (d) => (d ? dayjs(d).format('DD-MM-YYYY HH:mm') : '');
const fmtINR  = (n) => (n == null || Number.isNaN(Number(n)) ? '' : Number(n));

const STATUS_LABEL = {
  LIVE:             'Live',
  PENDING_APPROVAL: 'Pending Approval',
  REJECTED:         'Rejected',
  SUPERSEDED:       'Superseded',
};

// Auto-width columns so the sheet looks polished out of the box.
const autoWidth = (rows, headerKeys) => headerKeys.map((key) => {
  const headerLen = String(key).length;
  const maxCellLen = rows.reduce((m, r) => {
    const v = r[key];
    return Math.max(m, v == null ? 0 : String(v).length);
  }, 0);
  return { wch: Math.min(60, Math.max(headerLen + 2, maxCellLen + 2)) };
});

export function exportPricingWorkbook({ current = [], history = [], documents = [], priceType = 'SELLING' }) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Current SKU Prices ──────────────────────────────────
  const currentRows = current.map((r) => {
    const changeAmt = (r.currentPrice != null && r.previousPrice != null)
      ? Number((r.currentPrice - r.previousPrice).toFixed(2))
      : '';
    return {
      'SKU':              r.code,
      'Description':      r.name || '',
      'Current Price (₹)': fmtINR(r.currentPrice),
      'Effective Date':   fmtDate(r.effectiveFrom),
      'Previous Price (₹)': fmtINR(r.previousPrice),
      'Change ₹':         changeAmt === 0 ? '' : changeAmt,
      'Change %':         r.changePercent ? Number(r.changePercent).toFixed(2) : '',
      'Last Revision By': r.revisedByName || '',
      'Status':           ({
        changed: 'Changed (last 7 days)',
        stable:  'Stable',
        stale:   'Stale (60+ days)',
        unpriced: 'Unpriced',
        pending: 'Pending Approval',
      })[r.statusTag] || '',
      'Margin %':         r.marginPercent != null ? Number(r.marginPercent).toFixed(2) : '',
      'Remarks':          r.pricingRemarks || '',
    };
  });
  const ws1 = XLSX.utils.json_to_sheet(currentRows);
  ws1['!cols'] = autoWidth(currentRows, [
    'SKU', 'Description', 'Current Price (₹)', 'Effective Date', 'Previous Price (₹)',
    'Change ₹', 'Change %', 'Last Revision By', 'Status', 'Margin %', 'Remarks',
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Current SKU Prices');

  // ── Sheet 2: Price Revision History ──────────────────────────────
  const historyRows = history.map((r) => ({
    'Timestamp':        fmtDT(r.createdAt),
    'SKU':              r.skuCode || '',
    'Description':      r.skuName || '',
    'Old Price (₹)':    fmtINR(r.oldPrice),
    'New Price (₹)':    fmtINR(r.newPrice),
    'Change %':         r.changePercent ? Number(r.changePercent).toFixed(2) : '',
    'Effective Date':   fmtDate(r.effectiveFrom),
    'Reason':           r.reason || '',
    'Updated By':       r.requestedByName || '',
    'Status':           STATUS_LABEL[r.status] || r.status || '',
    'Approved By':      r.approvedByName || '',
    'Approved At':      fmtDT(r.approvedAt),
    'Proof Link':       r.attachmentUrl || '',
    'Remarks':          r.remarks || '',
  }));
  const ws2 = XLSX.utils.json_to_sheet(historyRows);
  ws2['!cols'] = autoWidth(historyRows, [
    'Timestamp', 'SKU', 'Description', 'Old Price (₹)', 'New Price (₹)', 'Change %',
    'Effective Date', 'Reason', 'Updated By', 'Status', 'Approved By', 'Approved At',
    'Proof Link', 'Remarks',
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Price Revision History');

  // ── Sheet 3: Supporting Documents ────────────────────────────────
  const docsRows = documents.map((r) => ({
    'SKU':              r.skuCode || '',
    'Description':      r.skuName || '',
    'Revision Date':    fmtDate(r.effectiveFrom),
    'Submitted On':     fmtDT(r.createdAt),
    'Updated By':       r.requestedByName || '',
    'File Name':        r.attachmentName || '',
    'File Link':        r.attachmentUrl || '',
    'Reason':           r.reason || '',
    'Notes':            r.remarks || '',
  }));
  const ws3 = XLSX.utils.json_to_sheet(docsRows);
  ws3['!cols'] = autoWidth(docsRows, [
    'SKU', 'Description', 'Revision Date', 'Submitted On', 'Updated By',
    'File Name', 'File Link', 'Reason', 'Notes',
  ]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Supporting Documents');

  // ── Sheet 0 (added last so it appears first): About / cover ──────
  const about = [
    ['Ambika Global — Pricing MIS Export'],
    [],
    ['Price stream:', priceType === 'SELLING' ? 'Selling Prices' : 'Raw Material Costs'],
    ['Exported on:',  dayjs().format('DD MMM YYYY · HH:mm')],
    ['Total SKUs:',   current.length],
    ['Total revisions:', history.length],
    ['Documents on file:', documents.length],
    [],
    ['Sheet guide:'],
    ['  • Current SKU Prices    — the live price master (one row per SKU)'],
    ['  • Price Revision History — every revision ever filed (audit trail)'],
    ['  • Supporting Documents   — revisions that have an attached proof'],
    [],
    ['Generated by DPES — Dispatch Planning & Execution System'],
  ];
  const wsAbout = XLSX.utils.aoa_to_sheet(about);
  wsAbout['!cols'] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsAbout, 'About', true);
  // Move "About" to be the first tab
  if (wb.SheetNames[wb.SheetNames.length - 1] === 'About') {
    wb.SheetNames = ['About', ...wb.SheetNames.filter((n) => n !== 'About')];
  }

  // ── Write and download ───────────────────────────────────────────
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const filename = `Pricing-Master_${priceType}_${dayjs().format('YYYY-MM-DD')}.xlsx`;
  saveAs(blob, filename);

  return filename;
}
