/**
 * Import Party (Client) Details from Excel — idempotent, grouped, audited.
 *
 * Source: src/sheets/PARTY DETAILS.xlsx  · sheet "Client Details"
 * One row per (client × SKU). Columns:
 *   Client Name, Place, Address, SKU, Unit, Pcs Per Box, Weight Per Box,
 *   Approx Days, Credit Period, To Email Address, BCC Email Address,
 *   CC Email Address, SKU Code, Accounts Email Address, SP
 *
 * What it does:
 *   - Groups rows by Client Name → one Party per client.
 *   - Collects every SKU the client orders into party.orderedSkus (deduped),
 *     matched to the SKU master by code/name so Sales Orders can auto-fill them.
 *   - Saves Place→location, Address, Approx Days→approxDays (+leadTimeDays),
 *     Credit Period→creditPeriodDays, and To/CC/BCC/Accounts emails (deduped).
 *   - Upserts by case-insensitive name (re-runnable; updates in place).
 *
 * Flags:  --dry-run   parse + report only, no DB writes.
 * Usage:  node src/scripts/import_party_details.js [--dry-run]
 */

import mongoose from 'mongoose';
import path from 'path';
import xlsx from 'xlsx';
import env from '../config/env.js';
import Party from '../modules/clients/party.model.js';
import SKU from '../modules/skus/sku.model.js';

const DRY = process.argv.includes('--dry-run');
const FILE = path.resolve(process.cwd(), 'src/sheets/PARTY DETAILS.xlsx');

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const splitEmails = (s) => String(s ?? '')
  .split(/[,;\n]/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
const numOr = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

const run = async () => {
  const wb = xlsx.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) { console.error('❌ No rows found in the sheet.'); process.exit(1); }

  await mongoose.connect(env.MONGO_URI);

  // SKU master lookup (match ordered SKUs → real SKU for auto-fill).
  const skus = await SKU.find({ isDeleted: { $ne: true } }).select('_id name code unit pcsPerBox weightPerBox sellingPrice').lean();
  const byName = new Map(skus.map((s) => [norm(s.name), s]));
  const byCode = new Map(skus.map((s) => [String(s.code || '').toUpperCase(), s]));

  // Group rows by client name.
  const groups = new Map();
  for (const r of rows) {
    const name = String(r['Client Name'] || '').trim();
    if (!name) continue;
    const key = norm(name);
    const g = groups.get(key) || {
      name, place: '', address: '', approxDays: 0, creditPeriod: 30,
      to: new Set(), cc: new Set(), bcc: new Set(), accounts: new Set(),
      skus: new Map(), // skuName(norm) → ordered sku
    };
    // Party-level fields — take first non-empty.
    if (!g.place && r.Place) g.place = String(r.Place).trim();
    if (!g.address && r.Address) g.address = String(r.Address).trim();
    if (r['Approx Days'] !== '') g.approxDays = numOr(r['Approx Days'], g.approxDays);
    if (r['Credit Period'] !== '') g.creditPeriod = numOr(r['Credit Period'], g.creditPeriod);
    splitEmails(r['To Email Address']).forEach((e) => g.to.add(e));
    splitEmails(r['CC Email Address']).forEach((e) => g.cc.add(e));
    splitEmails(r['BCC Email Address']).forEach((e) => g.bcc.add(e));
    splitEmails(r['Accounts Email Address']).forEach((e) => g.accounts.add(e));

    // Ordered SKU line.
    const skuName = String(r.SKU || '').trim();
    if (skuName) {
      const sheetCode = String(r['SKU Code'] || '').trim().toUpperCase();
      const matched = (sheetCode && byCode.get(sheetCode)) || byName.get(norm(skuName)) || null;
      g.skus.set(norm(skuName), {
        skuId: matched?._id || null,
        skuName,
        skuCode: matched?.code || sheetCode || '',
        unit: String(r.Unit || matched?.unit || 'Pcs').trim(),
        pcsPerBox: numOr(r['Pcs Per Box'], matched?.pcsPerBox || 0),
        weightPerBox: numOr(r['Weight Per Box'], matched?.weightPerBox || 0),
        sellingPrice: numOr(r.SP, matched?.sellingPrice || 0),
      });
    }
    groups.set(key, g);
  }

  let created = 0; let updated = 0; let matchedSku = 0; let unmatchedSku = 0;
  const report = [];
  for (const g of groups.values()) {
    const orderedSkus = [...g.skus.values()];
    orderedSkus.forEach((s) => { if (s.skuId) matchedSku += 1; else unmatchedSku += 1; });

    const fields = {
      name: g.name,
      location: g.place,
      address: g.address,
      approxDays: g.approxDays,
      leadTimeDays: g.approxDays || 7,
      creditPeriodDays: g.creditPeriod,
      toEmails: [...g.to],
      ccEmails: [...g.cc],
      bccEmails: [...g.bcc],
      accountsEmails: [...g.accounts],
      email: [...g.to][0] || undefined, // primary, for code that reads party.email
      orderedSkus,
    };
    report.push(`${g.name.padEnd(28)} | SKUs ${String(orderedSkus.length).padStart(2)} | credit ${g.creditPeriod}d | approx ${g.approxDays}d | to:${g.to.size} acct:${g.accounts.size}`);

    if (DRY) continue;
    const existing = await Party.findOne({ name: new RegExp(`^${g.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (existing) {
      Object.assign(existing, fields);
      // Keep a structured primary address too (used by challan/PDF address blocks).
      existing.addresses = [{ label: 'Primary', line1: g.address || '', city: g.place || '' }];
      await existing.save();
      updated += 1;
    } else {
      await Party.create({ ...fields, addresses: [{ label: 'Primary', line1: g.address || '', city: g.place || '' }], isActive: true });
      created += 1;
    }
  }

  console.log('\n── Party Details Import ' + (DRY ? '(DRY RUN) ' : '') + '──');
  report.forEach((l) => console.log(l));
  console.log(`\n✅ ${groups.size} clients · created ${created}, updated ${updated} · ordered-SKUs matched ${matchedSku}, unmatched ${unmatchedSku}.`);
  if (unmatchedSku) console.log('   ⚠️  Unmatched SKUs are still saved by name (skuId null) — they will match once the SKU master has them.');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Import failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
