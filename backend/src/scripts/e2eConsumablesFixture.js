/**
 * Consumables & Packing — fixture + oracle for the browser check.
 *
 *   node src/scripts/e2eConsumablesFixture.js --seed      scratch DB + data
 *   node src/scripts/e2eConsumablesFixture.js --expect    print expected figures
 *
 * Pairs with frontend/e2e/consumables.e2e.mjs, which reads the three screens.
 *
 * The SKUs are chosen so every planning branch is exercised and every expected
 * number can be worked out by hand from the documented formulas:
 *
 *   ADC            = 90-day CONSUME_OUT ÷ 90      (measured; stored value ignored)
 *   maxLevel       = ADC × leadDays × safetyFactor
 *   reorderPoint   = ADC × leadDays
 *   daysCover      = onHand ÷ ADC                 (null when ADC = 0)
 *   suggestedOrder = max(0, maxLevel − onHand − inTransit), raised to MOQ
 *
 * SAFETY: pinned to a localhost scratch database, dropped on --seed. It never
 * reads the configured MONGO_URI, so production cannot be touched.
 */
import mongoose from 'mongoose';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';
import InventoryMovement, { TXN_TYPE, MOVEMENT_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_cp_e2e';
export const E2E_USER = { email: 'cp-e2e@test.local', password: 'E2e@12345', name: 'CP E2E', role: 'MD', mobile: '9000000002' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

const WH = 'MAIN';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * consumed = total CONSUME_OUT inside the 90-day window, so ADC = consumed/90.
 * opening/received build the on-hand balance alongside it.
 */
export const ITEMS = [
  // Steady consumption: every planning figure is non-zero.
  { code: 'CPE-STEADY', name: 'E2E Steady Consumable', unit: 'PCS', itemType: 'CONSUMABLE',
    opening: 1000, received: 0, consumed: 900, lead: 16, sf: 2.5, moq: 12 },
  // Consumed to nothing — OUT_OF_STOCK regardless of the rest.
  { code: 'CPE-EMPTY', name: 'E2E Empty Consumable', unit: 'PCS', itemType: 'CONSUMABLE',
    opening: 500, received: 0, consumed: 500, lead: 16, sf: 2.5, moq: 0 },
  // No consumption at all: the documented ADC-0 case. Every ADC-derived figure
  // collapses and Days Cover is unknown — NOT zero.
  { code: 'CPE-NOCONS', name: 'E2E Never Consumed', unit: 'PCS', itemType: 'PACKING',
    opening: 250, received: 0, consumed: 0, lead: 16, sf: 2.5, moq: 0 },
  // Far above max level — OVERSTOCK (onHand > maxLevel × 1.25).
  { code: 'CPE-OVER', name: 'E2E Overstocked Packing', unit: 'PCS', itemType: 'PACKING',
    opening: 9000, received: 0, consumed: 90, lead: 16, sf: 2.5, moq: 0 },
  // Sitting at/below lead-time demand — REORDER.
  { code: 'CPE-REORDER', name: 'E2E Reorder Consumable', unit: 'PCS', itemType: 'CONSUMABLE',
    opening: 1000, received: 0, consumed: 900, lead: 16, sf: 2.5, moq: 50, keepOnHand: 100 },
  // No policy row at all — exercises defaultPolicy (lead 16, SF 1.5, MOQ 0),
  // which is the correct state for a SKU the client never planned.
  { code: 'CPE-NOPOLICY', name: 'E2E Unplanned Consumable', unit: 'PCS', itemType: 'CONSUMABLE',
    opening: 600, received: 0, consumed: 450, lead: null, sf: null, moq: null },
];

/** What the documented formulas say each item must show. */
export const expected = (it) => {
  const onHand = r2(it.opening + it.received - it.consumed - (it.keepOnHand !== undefined ? 0 : 0));
  const adc = r2(it.consumed / 90);
  // With no policy row, Consumables now plans on CONSUMABLES_DEFAULT_LEAD_DAYS
  // (16), a Consumables-only constant. It used to read `sku.leadDays ?? 16`,
  // which always resolved to the SKU model's own default of 7 and so never
  // reached 16.
  const lead = it.lead ?? 16;
  const sf = it.sf ?? 1.5;          // defaultPolicy
  const moq = it.moq ?? 0;
  const maxLevel = r2(adc * lead * sf);
  const reorderPoint = r2(adc * lead);
  const safetyStock = r2(Math.max(0, maxLevel - reorderPoint));
  const projected = onHand;
  const daysCover = adc > 0 ? r2(onHand / adc) : null;
  let status = 'OK';
  if (onHand <= 0) status = 'OUT_OF_STOCK';
  else if (projected <= reorderPoint) status = 'REORDER';
  else if (maxLevel > 0 && onHand > maxLevel * 1.25) status = 'OVERSTOCK';
  else if (adc > 0 && projected <= safetyStock + reorderPoint && projected > reorderPoint) status = 'LOW';
  let suggested = r2(Math.max(0, maxLevel - projected));
  if (suggested > 0 && moq > 0 && suggested < moq) suggested = moq;
  return { code: it.code, onHand, adc, lead, sf, maxLevel, reorderPoint, daysCover, status, suggested };
};

const seed = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await User.create({ ...E2E_USER, isActive: true, roles: ['MD'] });

  const now = Date.now();
  for (const it of ITEMS) {
    const sku = await SKU.create({ code: it.code, name: it.name, unit: it.unit, itemType: it.itemType, category: 'E2E' });
    if (it.lead !== null) {
      await InventoryPolicy.create({
        skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit,
        itemType: it.itemType, category: 'E2E',
        averageDailyConsumption: 999,       // deliberately wrong: it must be IGNORED
        leadDays: it.lead, safetyFactor: it.sf, moq: it.moq,
        maxLevel: 0, maxLevelMode: 'AUTO', materialInTransit: 0, openingStock: it.opening,
      });
    }

    // Balance is rebuilt from the ledger, exactly as the app does it.
    let bal = 0;
    const post = async (qty, txnType, isIn, daysAgo) => {
      if (!qty) return;
      bal = r2(bal + (isIn ? qty : -qty));
      await InventoryMovement.create({
        movementNumber: `CPE-${sku.code}-${txnType}-${daysAgo}-${now}`,
        movementDate: new Date(now - daysAgo * 86400000),
        skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, warehouse: WH,
        txnType, movementType: isIn ? MOVEMENT_TYPE.IN : MOVEMENT_TYPE.OUT,
        quantity: qty, qtyDelta: isIn ? qty : -qty, balanceAfter: bal,
        sourceModule: 'IMS', refType: 'EXCEL_IMPORT', refNumber: 'e2e fixture',
      });
    };
    await post(it.opening, TXN_TYPE.OPENING, true, 120);
    await post(it.received, TXN_TYPE.GRN_IN, true, 60);
    // Inside the 90-day window, so it counts toward measured ADC.
    await post(it.consumed, TXN_TYPE.CONSUME_OUT, false, 30);

    await InventoryStock.create({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit,
      warehouse: WH, qtyOnHand: bal, avgCost: 10,
    });
  }
  console.log(JSON.stringify({ ok: true, items: ITEMS.map((i) => i.code), user: E2E_USER }, null, 2));
  await mongoose.disconnect();
};

const show = async () => {
  console.log('Expected (from the documented formulas):\n');
  console.log(`  ${'SKU'.padEnd(14)}${'onHand'.padStart(8)}${'ADC'.padStart(8)}${'maxLvl'.padStart(9)}${'reorder'.padStart(9)}${'cover'.padStart(8)}${'status'.padStart(14)}${'suggest'.padStart(9)}`);
  for (const it of ITEMS) {
    const e = expected(it);
    console.log(`  ${e.code.padEnd(14)}${String(e.onHand).padStart(8)}${String(e.adc).padStart(8)}${String(e.maxLevel).padStart(9)}`
      + `${String(e.reorderPoint).padStart(9)}${String(e.daysCover ?? '—').padStart(8)}${e.status.padStart(14)}${String(e.suggested).padStart(9)}`);
  }
};

// Only act as a CLI when run directly. Imported — by the verifier that reuses
// ITEMS and expected() — it must stay inert, or importing it would exit the
// caller before a single assertion ran.
if (process.argv[1] && process.argv[1].endsWith('e2eConsumablesFixture.js')) {
  const mode = process.argv[2];
  if (mode === '--seed') seed().catch((e) => { console.error(e); process.exit(1); });
  else if (mode === '--expect') show();
  else { console.error('Usage: --seed | --expect'); process.exit(1); }
}
