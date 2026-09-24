/**
 * Import Consumables & Packing planning policies from the client's own workbook.
 *
 * SOURCE (the only source — nothing here is invented):
 *   excel/IMS - Consumable & Packing 24-25.xlsx  →  sheet "Item List"
 *   columns: SKU Code | Item Name | Category | Average Daily Consumption |
 *            Lead Time (From Indent to Receipt) | Safety Factor | MOQ |
 *            Max Level | Material In Transit | Opening Stock |
 *            Converted Item Name (For Resale)
 *
 * WHY THIS EXISTS
 * ---------------
 * `seed_ims_consumable_packaging.js` carries 14 of these rows hardcoded in the
 * file. The sheet holds 170, of which 163 match a SKU in the database and 73
 * carry a complete set of planning values. This reads the sheet instead, so the
 * numbers are the client's and stay the client's.
 *
 * WHAT IT WRITES
 *   • One InventoryPolicy per matched SKU that has BOTH a lead time and a
 *     safety factor. A row missing either is SKIPPED and listed — a policy
 *     without them would have to be guessed, and guessing planning parameters is
 *     exactly what must not happen.
 *   • Nothing else. It never posts stock: opening balances are a separate
 *     decision and belong to the Stock In → Opening Stock flow.
 *
 * maxLevelMode: MANUAL when the sheet states a Max Level that does not match
 * ADC × lead × safety factor, because that figure was then a deliberate choice;
 * AUTO otherwise, so the formula stays live. Nothing is inferred beyond that.
 *
 * DRY RUN BY DEFAULT.
 *   node src/scripts/import_ims_policies_from_excel.js            # report only
 *   node src/scripts/import_ims_policies_from_excel.js --confirm  # write
 *   MONGO_URI=<test-db> node src/scripts/import_ims_policies_from_excel.js --confirm
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';
import { IMS_ITEM_TYPES } from '../modules/inventory/ims.service.js';
import { checkSafetyFactor } from '../modules/inventory/ims.validation.js';

const WORKBOOK = process.env.IMS_WORKBOOK
  || path.resolve(process.cwd(), '..', 'excel', 'IMS - Consumable & Packing 24-25.xlsx');
const SHEET = 'Item List';
const confirm = process.argv.includes('--confirm');

const num = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

const run = async () => {
  if (!fs.existsSync(WORKBOOK)) {
    console.error(`Workbook not found: ${WORKBOOK}\nSet IMS_WORKBOOK to its path.`);
    process.exit(1);
  }
  const wb = XLSX.read(fs.readFileSync(WORKBOOK), { type: 'buffer' });
  if (!wb.Sheets[SHEET]) { console.error(`Sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: '' })
    .filter((r) => String(r['SKU Code'] || '').trim());

  await mongoose.connect(env.MONGO_URI);
  console.log(`workbook : ${path.basename(WORKBOOK)} → "${SHEET}" (${rows.length} rows with a SKU code)`);
  console.log(`database : ${mongoose.connection.name}`);
  console.log(confirm ? 'action   : WRITE\n' : 'action   : DRY RUN (nothing will be written)\n');

  const skus = await SKU.find({ itemType: { $in: IMS_ITEM_TYPES }, isDeleted: { $ne: true } })
    .select('code name unit category itemType').lean();
  const byCode = new Map(skus.map((s) => [s.code.trim().toUpperCase(), s]));

  const ready = []; const noSku = []; const incomplete = [];
  for (const r of rows) {
    const code = String(r['SKU Code']).trim().toUpperCase();
    const sku = byCode.get(code);
    if (!sku) { noSku.push(code); continue; }

    const adc = num(r['Average Daily Consumption']);
    const leadDays = num(r['Lead Time (From Indent to Receipt)']);
    const safetyFactor = num(r['Safety Factor']);
    const missing = [];
    if (leadDays === null || leadDays <= 0) missing.push('Lead Time');
    if (safetyFactor === null || safetyFactor <= 0) missing.push('Safety Factor');
    if (missing.length) { incomplete.push({ code, name: sku.name, missing }); continue; }

    // The Consumables safety-factor rule (1.0–5.0 in 0.1 steps) is the API's, so
    // a sheet value outside it is reported rather than quietly rounded in.
    const sf = checkSafetyFactor(safetyFactor);
    if (!sf.ok) { incomplete.push({ code, name: sku.name, missing: [`Safety Factor ${safetyFactor}: ${sf.message}`] }); continue; }

    const sheetMax = num(r['Max Level']);
    const formulaMax = round2((adc || 0) * leadDays * sf.value);
    // A stated Max Level that the formula does not produce was a deliberate
    // choice, so it is kept as a manual override. One that matches is the
    // sheet's own calculated column — leave the formula live.
    const manual = sheetMax !== null && sheetMax > 0 && Math.abs(sheetMax - formulaMax) > Math.max(1, formulaMax * 0.02);

    ready.push({
      skuId: sku._id, code: sku.code, name: sku.name, unit: sku.unit, category: sku.category, itemType: sku.itemType,
      averageDailyConsumption: adc ?? 0,
      leadDays, safetyFactor: sf.value,
      moq: num(r.MOQ) ?? 0,
      maxLevel: manual ? sheetMax : 0,
      maxLevelMode: manual ? 'MANUAL' : 'AUTO',
      materialInTransit: num(r['Material In Transit']) ?? 0,
      openingStock: num(r['Opening Stock']) ?? 0,
      convertedItemName: String(r['Converted Item Name (For Resale)'] || '').trim(),
      formulaMax,
    });
  }

  console.log(`importable (lead time + safety factor present) : ${ready.length}`);
  console.log(`skipped — no matching SKU in the database      : ${noSku.length}${noSku.length ? ` (${noSku.slice(0, 8).join(', ')}${noSku.length > 8 ? ' …' : ''})` : ''}`);
  console.log(`skipped — planning values missing in the sheet : ${incomplete.length}`);
  const sheetCodes = new Set(rows.map((r) => String(r['SKU Code']).trim().toUpperCase()));
  const absent = skus.filter((s) => !sheetCodes.has(s.code.trim().toUpperCase()));
  console.log(`SKUs with no row in the sheet at all           : ${absent.length}`);
  console.log(`\n→ ${incomplete.length + absent.length} item(s) still need planning values from the business.`);
  console.log('   Run generate_policy_templates.js to produce the list to fill in.\n');

  console.log('first 10 policies to be written:');
  console.log('  SKU          | ADC   | Lead | SF   | MOQ  | Max Level          | Opening');
  for (const p of ready.slice(0, 10)) {
    console.log(`  ${p.code.padEnd(12)} | ${String(p.averageDailyConsumption).padEnd(5)} | ${String(p.leadDays).padEnd(4)} `
      + `| ${String(p.safetyFactor).padEnd(4)} | ${String(p.moq).padEnd(4)} `
      + `| ${p.maxLevelMode === 'MANUAL' ? `${p.maxLevel} (manual)` : `${p.formulaMax} (auto)`.padEnd(18)} | ${p.openingStock}`);
  }
  if (ready.length > 10) console.log(`  … and ${ready.length - 10} more`);

  if (!confirm) { console.log('\nDry run. Re-run with --confirm to write these policies.'); await mongoose.disconnect(); return; }

  let created = 0; let updated = 0;
  for (const p of ready) {
    const existing = await InventoryPolicy.findOne({ skuId: p.skuId }).lean();
    await InventoryPolicy.updateOne({ skuId: p.skuId }, {
      $set: {
        skuCode: p.code, skuName: p.name, unit: p.unit, category: p.category || '', itemType: p.itemType,
        averageDailyConsumption: p.averageDailyConsumption,
        leadDays: p.leadDays, safetyFactor: p.safetyFactor, moq: p.moq,
        maxLevel: p.maxLevel, maxLevelMode: p.maxLevelMode,
        materialInTransit: p.materialInTransit, openingStock: p.openingStock,
        convertedItemName: p.convertedItemName,
        remarks: 'Imported from "IMS - Consumable & Packing 24-25.xlsx" → Item List',
      },
      $setOnInsert: { skuId: p.skuId },
    }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
    existing ? updated += 1 : created += 1;
  }
  console.log(`\npolicies created: ${created}, updated: ${updated}`);
  console.log('No stock was posted — opening balances remain a separate, explicit decision.');
  await mongoose.disconnect();
};

run().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
