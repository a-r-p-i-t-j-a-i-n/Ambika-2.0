/**
 * Import Vendors (Purchase FMS suppliers) from CSV into the SEPARATE `vendors`
 * collection — NOT the Party (customer) collection.
 *
 * Source: src/sheets/vendors details for purcase.csv  (one row per vendor × product)
 * Columns by position (header is quote-mangled, so we read by index):
 *   0 Vendor Name · 1 Contact Person · 2 Phone · 3 Email · 4 Product Name
 *   5 Item SKU Code · 6 Rate · 7 Unit · 8 Address · 9 GST No · 10 PAN No
 *   11 GST rate · 12 Credit Period · 13 Received At · 14 TDS Rate
 *   15 To · 16 BCC · 17 CC · 18+ grade-mapping notes
 *
 * Groups rows by vendor name → one Vendor doc with products[] (deduped).
 * Idempotent (upsert by name). Flag: --dry-run.
 * Usage: node src/scripts/import_vendors.js [--dry-run]
 */

import mongoose from 'mongoose';
import path from 'path';
import xlsx from 'xlsx';
import env from '../config/env.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';

const DRY = process.argv.includes('--dry-run');
const FILE = path.resolve(process.cwd(), 'src/sheets/vendors details for purcase.csv');

const clean = (s) => {
  const v = String(s ?? '').trim();
  return (v === '-' || v === '–' || v.toLowerCase() === 'n/a') ? '' : v;
};
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const pctNum = (s) => { const v = parseFloat(String(s ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(v) ? 0 : v; };
const intNum = (s) => { const v = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10); return Number.isNaN(v) ? 0 : v; };
const rateNum = (s) => { const v = parseFloat(String(s ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(v) ? 0 : v; };
const emailOk = (e) => /@/.test(e);

const run = async () => {
  const wb = xlsx.readFile(FILE, { codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) { console.error('❌ No data rows.'); process.exit(1); }
  const body = rows.slice(1);

  await mongoose.connect(env.MONGO_URI);
  const skus = await SKU.find({ isDeleted: { $ne: true } }).select('_id name code').lean();
  const skuByName = new Map(skus.map((s) => [norm(s.name), s]));
  const skuByCode = new Map(skus.map((s) => [String(s.code || '').toUpperCase(), s]));

  const groups = new Map();
  for (const r of body) {
    const name = clean(r[0]);
    if (!name) continue;
    const key = norm(name);
    const g = groups.get(key) || {
      name, contactPerson: '', phone: '', email: '', address: '',
      gstNo: '', panNo: '', creditPeriodDays: 0, tdsRate: 0, gstRate: 0,
      to: new Set(), cc: new Set(), bcc: new Set(), products: new Map(),
    };
    if (!g.contactPerson) g.contactPerson = clean(r[1]);
    if (!g.phone) g.phone = clean(r[2]);
    if (!g.email) g.email = clean(r[3]);
    if (!g.address) g.address = clean(r[8]);
    if (!g.gstNo) g.gstNo = clean(r[9]).toUpperCase();
    if (!g.panNo) g.panNo = clean(r[10]).toUpperCase();
    if (clean(r[12])) g.creditPeriodDays = intNum(r[12]);
    if (clean(r[14])) g.tdsRate = pctNum(r[14]);
    [clean(r[3]), clean(r[15])].filter(emailOk).forEach((e) => g.to.add(e.toLowerCase()));
    [clean(r[17])].filter(emailOk).forEach((e) => g.cc.add(e.toLowerCase()));
    [clean(r[16])].filter(emailOk).forEach((e) => g.bcc.add(e.toLowerCase()));

    const productName = clean(r[4]);
    const sheetCode = clean(r[5]).toUpperCase();
    const rate = rateNum(r[6]);
    const unit = clean(r[7]) || 'Pcs';
    const gstRate = pctNum(r[11]);
    if (g.gstRate === 0 && gstRate) g.gstRate = gstRate;
    const notes = (r.slice(18) || []).map(clean).filter(Boolean).join(' · ');
    if (productName) {
      const matched = (sheetCode && skuByCode.get(sheetCode)) || skuByName.get(norm(productName)) || null;
      const pkey = `${norm(productName)}|${unit.toLowerCase()}|${gstRate}|${rate}`;
      if (!g.products.has(pkey)) {
        g.products.set(pkey, {
          skuId: matched?._id || null, productName, skuCode: matched?.code || sheetCode || '',
          unit, rate, gstRate, notes,
        });
      }
    }
    groups.set(key, g);
  }

  let created = 0; let updated = 0; let totalProducts = 0;
  for (const g of groups.values()) {
    const products = [...g.products.values()];
    totalProducts += products.length;
    const fields = {
      name: g.name, contactPerson: g.contactPerson, phone: g.phone,
      email: emailOk(g.email) ? g.email.toLowerCase() : undefined,
      address: g.address, location: (g.address.split(',').pop() || '').trim(),
      gstNo: g.gstNo, panNo: g.panNo, gstRate: g.gstRate, tdsRate: g.tdsRate,
      creditPeriodDays: g.creditPeriodDays,
      toEmails: [...g.to], ccEmails: [...g.cc], bccEmails: [...g.bcc],
      products, isActive: true,
    };
    if (DRY) continue;
    const existing = await Vendor.findOne({ name: new RegExp(`^${g.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isDeleted: { $ne: true } });
    if (existing) { Object.assign(existing, fields); await existing.save(); updated += 1; }
    else { await Vendor.create(fields); created += 1; }
  }

  console.log(`\n✅ Vendors ${DRY ? '(dry run) ' : ''}— ${groups.size} vendors · created ${created}, updated ${updated} · ${totalProducts} products.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (e) => { console.error('❌ Import failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
