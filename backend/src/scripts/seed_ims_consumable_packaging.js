/**
 * Seed the Packaging & Consumables IMS — planning policy + opening stock.
 *
 * For each row: find the SKU by code, upsert its InventoryPolicy (average daily
 * consumption, lead time, safety factor, MOQ, max level, converted name), and —
 * if an opening stock is given and none was posted yet — write a one-time
 * OPENING stock movement so on-hand matches the sheet's opening balance.
 *
 * Idempotent: re-running updates policies in place and never double-posts the
 * opening movement (guarded by an existing OPENING/IMS movement check).
 *
 * This seeds the rows we have from the client's "list item" sheet. The rest of
 * the catalogue can be filled from the IMS → Master Data screen or extended here.
 *
 * Run:  node src/scripts/seed_ims_consumable_packaging.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';

const LEAD = 16; // days — indent → receipt (uniform in the sheet)

// code, name, ADC, safetyFactor, MOQ, maxLevel, openingStock, convertedItemName
const ROWS = [
  ['CO-SB-15-02', 'Side Buff - Bharat', 1.00, 2.5, 12, 40, 11, ''],
  ['CO-BF-30-00', 'Buff - 3"',          0.50, 1.5, 12, 12, 0,  ''],
  ['CO-BF-35-00', 'Buff - 3.5"',        2.80, 1.5, 12, 67, 244, ''],
  ['CO-BF-50-00', 'Buff - 5"',          3.20, 1.5, 12, 77, 146, ''],
  ['CO-BF-45-00', 'Buff - 4.5"',        2.00, 1.5, 12, 48, 197, ''],
  ['CO-BF-40-00', 'Buff - 4"',          0,    1.5, 12, 0,  0,   ''],
  ['CO-KB-35-00', 'Khila Buff - 3.5"',  6.00, 1.5, 12, 144, 341, ''],
  ['CO-KB-45-00', 'Khila Buff - 4.5"',  4.00, 1.5, 12, 96, 73,  ''],
  ['CO-KB-40-00', 'Khila Buff - 4"',    0,    1.5, 12, 0,  0,   ''],
  ['CO-KB-50-00', 'Khila Buff - 5"',    0.40, 1.5, 5,  10, 68,  ''],
  ['CO-JB-80-00', 'Jeans Buff - 8"',    0,    1.5, 46, 0,  0,   ''],
  ['CO-BS-70-00', 'Brush 7"',           0,    1.5, 46, 0,  13,  ''],
  ['CO-BS-50-00', 'Brush - 5"',         1.67, 1.5, 5,  40, 44,  '1.75" Brush'],
  ['CO-BS-45-00', 'Brush - 4.5"',       0,    1.5, 0,  80, 65,  ''],
];

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const sysUser = { _id: undefined, name: 'IMS Seed' };

  let policies = 0; let opened = 0; let missing = [];
  for (const [code, , adc, sf, moq, maxLevel, opening, converted] of ROWS) {
    const sku = await SKU.findOne({ code: new RegExp(`^${code}$`, 'i'), isDeleted: { $ne: true } })
      .select('_id code name unit category itemType').lean();
    if (!sku) { missing.push(code); continue; }

    await InventoryPolicy.updateOne(
      { skuId: sku._id },
      {
        $set: {
          skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category || '', itemType: sku.itemType,
          averageDailyConsumption: adc, leadDays: LEAD, safetyFactor: sf, moq,
          maxLevel, openingStock: opening, convertedItemName: converted,
        },
        $setOnInsert: { skuId: sku._id },
      },
      { upsert: true },
    );
    policies += 1;

    if (opening > 0) {
      const already = await InventoryMovement.findOne({
        skuId: sku._id, txnType: TXN_TYPE.OPENING, sourceModule: 'IMS', isDeleted: { $ne: true },
      }).select('_id').lean();
      if (!already) {
        await inventoryService.increaseStock({
          skuId: sku._id, quantity: opening,
          txnType: TXN_TYPE.OPENING, sourceModule: 'IMS', refType: 'IMS_OPENING',
          remarks: 'Opening stock (IMS seed)', performedBy: sysUser,
        });
        opened += 1;
      }
    }
  }

  console.log(`✅ IMS seeded — ${policies} policies upserted, ${opened} opening-stock movements posted.`);
  if (missing.length) console.log(`   ⚠️  SKU not found (skipped): ${missing.join(', ')}`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ IMS seed failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
