/**
 * Seed the Transporter master with the client's known transporters.
 * Idempotent — upserts by case-insensitive name. Re-runnable.
 * Usage: node src/scripts/seed_transporters.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import Transporter from '../modules/transporters/transporter.model.js';

const NAMES = [
  'Vishwakarma Logistics Ltd',
  'Aggarwal Roadlines',
  'Om Logistics Supply Chain Pvt. Ltd.',
  'DTDC Courier',
  'Priya Express Cargo',
  'VKL Logistics Private Limited',
  'Ganpati Transport Services',
];

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  let created = 0; let skipped = 0;
  for (const name of NAMES) {
    const existing = await Transporter.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (existing) { skipped += 1; continue; }
    await Transporter.create({ name, isActive: true });
    created += 1;
  }
  console.log(`✅ Transporters seeded — created ${created}, already-present ${skipped} (total ${NAMES.length}).`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (e) => { console.error('❌ Seed failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
