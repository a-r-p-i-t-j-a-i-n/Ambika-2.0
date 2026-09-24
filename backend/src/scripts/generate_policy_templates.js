/**
 * Produce the two "please fill these in" templates for IMS planning policies.
 *
 * Nothing in IMS may invent a demand rate, a lead time or a safety factor — they
 * are business decisions, and a wrong one silently moves every reorder level
 * built on it. So where no source exists, this asks for the numbers instead of
 * making them up.
 *
 * WHAT IT WRITES  (CSV, into ./policy-templates by default)
 *
 *   fg-policy-template.csv
 *     Every finished good, pre-filled with the facts we already hold (code,
 *     name, UOM, category, current stock) and BLANK planning columns. There is
 *     no FG planning source anywhere in the project — not in the SKU master, not
 *     in the sheets folder, not in any seed script — so all 40 need values.
 *
 *   consumables-policy-template.csv
 *     Only the consumable/packing items the client's workbook does NOT already
 *     answer for: the ones whose "Item List" row has no lead time or safety
 *     factor, plus the ones with no row at all. The items the workbook does
 *     cover are imported by import_ims_policies_from_excel.js and are deliberately
 *     left out of this file so nobody re-keys them.
 *
 * READ-ONLY on the database. Writes only CSV files.
 *
 *   node src/scripts/generate_policy_templates.js
 *   node src/scripts/generate_policy_templates.js --out ./somewhere
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import { FG_ITEM_TYPES } from '../modules/inventory/fgIms.service.js';
import { IMS_ITEM_TYPES } from '../modules/inventory/ims.service.js';

const outArg = process.argv.indexOf('--out');
const OUT_DIR = outArg > -1 ? process.argv[outArg + 1] : path.resolve(process.cwd(), 'policy-templates');
const WORKBOOK = process.env.IMS_WORKBOOK
  || path.resolve(process.cwd(), '..', 'excel', 'IMS - Consumable & Packing 24-25.xlsx');

const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`database: ${mongoose.connection.name}`);
  console.log(`output  : ${OUT_DIR}\n`);

  const stockOf = async (ids) => {
    const rows = await InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean();
    const m = new Map();
    for (const r of rows) m.set(String(r.skuId), (m.get(String(r.skuId)) || 0) + (r.qtyOnHand || 0));
    return m;
  };

  // ── Finished goods ────────────────────────────────────────────────────────
  const fg = await SKU.find({ itemType: { $in: FG_ITEM_TYPES }, isDeleted: { $ne: true } })
    .select('code name unit category').sort({ category: 1, code: 1 }).lean();
  const fgStock = await stockOf(fg.map((s) => s._id));
  const fgHeader = [
    'SKU Code', 'Finished Good', 'UOM', 'Category', 'Current Stock (read-only)',
    'Average Daily Demand - Off-season', 'Average Daily Demand - Normal', 'Average Daily Demand - Peak',
    'Active Season (LOW/NORMAL/PEAK)', 'Lead Time (days, production)', 'Safety Factor',
    'MOQ (min production batch)', 'Max Level Mode (AUTO/MANUAL)', 'Max Level (only if MANUAL)',
    'In Production / WIP', 'Booked (Committed Orders)', 'Costing Rate (Rs/unit)', 'Remarks',
  ];
  const fgRows = fg.map((s) => [s.code, s.name, s.unit, s.category || '', fgStock.get(String(s._id)) ?? 0,
    '', '', '', 'NORMAL', '', '', '', 'AUTO', '', '', '', '', '']);
  fs.writeFileSync(path.join(OUT_DIR, 'fg-policy-template.csv'), csv([fgHeader, ...fgRows]), 'utf8');
  console.log(`fg-policy-template.csv            : ${fgRows.length} finished goods, all planning columns blank`);

  // ── Consumables the workbook does not already answer for ──────────────────
  const ims = await SKU.find({ itemType: { $in: IMS_ITEM_TYPES }, isDeleted: { $ne: true } })
    .select('code name unit category itemType').sort({ itemType: 1, code: 1 }).lean();
  const imsStock = await stockOf(ims.map((s) => s._id));

  let covered = new Set();
  if (fs.existsSync(WORKBOOK)) {
    const wb = XLSX.read(fs.readFileSync(WORKBOOK), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Item List'], { defval: '' });
    for (const r of rows) {
      const code = String(r['SKU Code'] || '').trim().toUpperCase();
      const lead = Number(r['Lead Time (From Indent to Receipt)']);
      const sf = Number(r['Safety Factor']);
      if (code && lead > 0 && sf > 0) covered.add(code);
    }
    console.log(`workbook "Item List" already answers for      : ${covered.size} item(s) — excluded from the template`);
  } else {
    console.log(`workbook not found at ${WORKBOOK} — every item is listed as needing values`);
  }

  const needed = ims.filter((s) => !covered.has(s.code.trim().toUpperCase()));
  const imsHeader = [
    'SKU Code', 'Item Name', 'Type', 'UOM', 'Category', 'Current Stock (read-only)',
    'Lead Time (days, indent to receipt)', 'Safety Factor (1.0-5.0, steps of 0.1)',
    'MOQ', 'Max Level Mode (AUTO/MANUAL)', 'Max Level (only if MANUAL)',
    'Material In Transit', 'Opening Stock', 'Converted Item Name (For Resale)', 'Remarks',
  ];
  const imsRows = needed.map((s) => [s.code, s.name, s.itemType, s.unit, s.category || '',
    imsStock.get(String(s._id)) ?? 0, '', '', '', 'AUTO', '', '', '', '', '']);
  fs.writeFileSync(path.join(OUT_DIR, 'consumables-policy-template.csv'), csv([imsHeader, ...imsRows]), 'utf8');
  console.log(`consumables-policy-template.csv   : ${imsRows.length} item(s) still needing values`);

  console.log('\nVALUES THE BUSINESS MUST PROVIDE');
  console.log('  Finished goods (all 40) — no source exists anywhere in the project:');
  console.log('    • Average Daily Demand for each season (Off-season / Normal / Peak) and which season is active');
  console.log('    • Lead Time in days (starting a production run → stock ready)');
  console.log('    • Safety Factor (FG allows 0 or more; 1.5 = hold 50% extra)');
  console.log('    • MOQ, the smallest run worth producing (blank if none)');
  console.log('    • Max Level: AUTO to follow demand x lead x safety, or MANUAL plus the figure');
  console.log('    • In Production (WIP) and Booked (committed orders), if either is being tracked by hand');
  console.log('    • Costing rate per unit, if finished stock is to be valued');
  console.log(`  Consumables & packing (${imsRows.length}) — the rest come from the workbook:`);
  console.log('    • Lead Time in days and Safety Factor (1.0-5.0 in steps of 0.1) are the two required ones');
  console.log('    • MOQ, Max Level mode, Material In Transit, Opening Stock and resale name are optional');
  console.log('  NOT needed for consumables: Average Daily Consumption is MEASURED from the issue ledger');
  console.log('    (90-day CONSUME_OUT total / 90) and is never typed in.');
  await mongoose.disconnect();
};

run().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
