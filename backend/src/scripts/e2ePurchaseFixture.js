/**
 * Fixture + database oracle for the PURCHASE UI e2e (frontend/e2e/purchase.e2e.mjs).
 *
 *   node src/scripts/e2ePurchaseFixture.js --seed     scratch DB: user, one coil SKU, one supplier for it
 *   node src/scripts/e2ePurchaseFixture.js --verify   assert what the browser built, and the GRN race
 *
 * The browser does everything else, through the real screens:
 *   A  indent → submit → approve → quote NOT required → PO → approve → release
 *      → PI not required → follow-up → ready for GRN → GRN-eligible
 *   B  the same, but Step 1.2 "Yes" with an uploaded quotation file → Step 1.3
 *   C  the same as A, but with a PI → PI approved → full advance payment
 *   then ONE GRN on A's PO, completed from TWO browser sessions at once.
 *
 * Safety: the shared e2e guard (localhost scratch DB, S3 off, email off).
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import PurchaseFollowUp from '../modules/procurement/follow-up/followUp.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_purchase';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePurchaseFixture.js');
export const E2E_USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345', name: 'Purchase E2E', role: 'MD' };
export const SUPPLIER = 'E2E UI Coil Supplier';

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_purchase') throw new Error(`unexpected database ${mongoose.connection.name}`);
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  await User.create({ ...E2E_USER, mobile: '9000000031', isActive: true, roles: ['MD'] });
  await SKU.create({ code: 'JSL204-07', name: 'Cu 0.70 mm', category: 'Coil', unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  await Vendor.create({
    name: SUPPLIER, isActive: true, contactPerson: 'E2E Contact', phone: '9000000032',
    // No email on purpose: release must never try to mail anyone from a test.
    products: [{ productName: 'Cu 0.70 mm', skuCode: 'JSL204-07', unit: 'KGS', rate: 185, gstRate: 18 }],
  });
  console.log(JSON.stringify({ ok: true, user: E2E_USER, supplier: SUPPLIER }, null, 2));
  await mongoose.disconnect();
};

const verify = async () => {
  await connect();
  console.log('\nPURCHASE — database oracle\n');
  const indents = await PurchaseIndent.find({}).sort({ createdAt: 1 }).lean();
  check('three indents were raised from the UI', indents.length === 3, `${indents.length}`);
  check('all three approved', indents.every((i) => i.approvalStatus === 'APPROVED'), indents.map((i) => i.approvalStatus).join(','));
  const [ia, ib, ic] = indents;
  check('A: quote NOT required (Step 1.3 skipped)', ia?.quoteComparativeStep?.statusDone === 'QUOTE_NOT_REQUIRED' && ia?.quotationApprovalStep?.skipped === true);
  const bFiles = (ib?.quoteComparativeStep?.quotationDocuments || ib?.items?.flatMap((it) => it.quotationFiles || it.quotationDocuments || []) || []);
  check('B: quote received (Yes) with an uploaded file, then Step 1.3 approved', ib?.quoteComparativeStep?.statusDone === 'YES' && !ib?.quotationApprovalStep?.skipped,
    `files=${bFiles.length} status=${ib?.overallStatus}`);
  check('C: quote not required', ic?.quoteComparativeStep?.statusDone === 'QUOTE_NOT_REQUIRED');

  const pos = await VendorPurchaseOrder.find({}).sort({ createdAt: 1 }).lean();
  check('three POs, one per indent', pos.length === 3 && pos.every((p, i) => String(p.indentId) === String(indents[i]?._id)), `${pos.length}`);
  for (const [i, p] of pos.entries()) {
    const k = 'ABC'[i];
    check(`${k} ${p.poNumber}: supplier, SKU, quantity`, p.vendorName === SUPPLIER && p.items?.[0]?.skuCode === 'JSL204-07' && p.items?.[0]?.quantity === [500, 400, 300][i],
      `${p.vendorName} ${p.items?.[0]?.skuCode} ${p.items?.[0]?.quantity}`);
    check(`${k}: approved + released, follow-up READY_FOR_GRN with a final material date`,
      p.approvalStatus === 'APPROVED' && p.releaseStatus === 'RELEASED' && p.followUpStatus === 'READY_FOR_GRN' && !!p.finalMaterialDate,
      `${p.approvalStatus}/${p.releaseStatus}/${p.followUpStatus}`);
  }
  check('A and B: PI not required; C: PI paid', pos[0]?.piStatus === 'PI_NOT_REQUIRED' && pos[1]?.piStatus === 'PI_NOT_REQUIRED' && pos[2]?.piStatus === 'PAYMENT_COMPLETED',
    pos.map((p) => p.piStatus).join(','));
  const pis = await ProformaInvoice.find({}).lean();
  const pays = await AdvancePayment.find({}).lean();
  check('C: one PI, approved, MD-approved for the advance, fully paid by one advance payment', pis.length === 1 && pis[0].approvalStatus === 'APPROVED' && pis[0].mdApprovalStatus === 'MD_APPROVED' && pis[0].piStatus === 'PAYMENT_COMPLETED'
    && pays.length === 1 && pays[0].paymentStatus === 'FULL_PAYMENT' && Math.abs(pis[0].balanceAmount) < 0.01,
  `pis=${pis.length} pays=${pays.length} bal=${pis[0]?.balanceAmount}`);
  check('one follow-up per PO, each READY_FOR_GRN', (await PurchaseFollowUp.countDocuments({ followUpStatus: 'READY_FOR_GRN' })) === 3);

  // The two-browser GRN race on PO A.
  const grns = await GoodsReceiptNote.find({}).lean();
  check('exactly one GRN was raised (on PO A)', grns.length === 1 && String(grns[0].poId) === String(pos[0]?._id), `${grns.length}`);
  const g = grns[0];
  if (g) {
    const mv = await InventoryMovement.find({ refId: g._id }).lean();
    const qcs = await IncomingQC.find({ grnId: g._id }).lean();
    check('GRN completed once: one COMPLETE in its timeline, QC-gated', g.stockPosted === true && g.stockPostingStage === 'QC_COMPLETION'
      && (g.activityTimeline || []).filter((t) => t.action === 'COMPLETE').length === 1);
    check('MD-signed, one QC, PASSED', g.approvalStatus === 'MD_APPROVED' && qcs.length === 1 && qcs[0].qcStatus === 'PASSED', `${g.approvalStatus} ${qcs.map((q) => q.qcStatus)}`);
    check('two simultaneous completions + a double-clicked QC → ONE GRN_IN (500 kg at PLG01) and nothing else',
      mv.length === 1 && mv[0].txnType === 'GRN_IN' && mv[0].quantity === 500 && mv[0].warehouse === 'PLG01', JSON.stringify(mv.map((m) => [m.txnType, m.quantity, m.warehouse])));
    check('…posted at QC completion, not at GRN completion', !!mv[0] && !!qcs[0] && Math.abs(new Date(mv[0].movementDate) - new Date(qcs[0].completedAt)) < 5
      && new Date(mv[0].createdAt) >= new Date(g.completedAt));
    const poA = await VendorPurchaseOrder.findById(pos[0]._id).lean();
    check('PO A received 500 once (not 1,000), FULLY_RECEIVED', poA.items[0].receivedQty === 500 && poA.poStatus === 'FULLY_RECEIVED', `${poA.items[0].receivedQty} ${poA.poStatus}`);
    check('PO A timeline: one GRN_RECEIVED', (poA.activityTimeline || []).filter((t) => t.action === 'GRN_RECEIVED').length === 1);
  }
  const quick = await SKU.findOne({ code: 'E2E-UI-NEWPROD' }).lean();
  check('indent quick-add created its SKU with the Item Type chosen (CONSUMABLE), once', quick?.itemType === 'CONSUMABLE'
    && (await SKU.countDocuments({ code: 'E2E-UI-NEWPROD' })) === 1, quick?.itemType);
  const allMv = await InventoryMovement.countDocuments({});
  check('no stock anywhere except that one GRN — purchase alone created none', allMv === 1, `${allMv} movements`);
  const stock = await InventoryStock.find({}).lean();
  check('stock = the ledger (one row, 500 kg)', stock.length === 1 && stock[0].qtyOnHand === 500, JSON.stringify(stock.map((s) => [s.skuCode, s.warehouse, s.qtyOnHand])));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await mongoose.disconnect();
  return failed.length === 0;
};

/** Configure the scrap item (as every real install has) — used by uiSweep.e2e.mjs
 *  AFTER it has checked how the scrap screens behave while it is missing. */
const addScrapSku = async () => {
  await connect();
  const { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } = await import('../modules/inventory/scrapSku.js');
  if (!(await SKU.findOne({ code: SCRAP_SKU_CODE }))) await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });
  console.log(JSON.stringify({ ok: true, scrapSku: SCRAP_SKU_CODE }));
  await mongoose.disconnect();
};

const mode = process.argv[2];
(async () => {
  if (mode === '--seed') return seed();
  if (mode === '--add-scrap-sku') return addScrapSku();
  if (mode === '--verify') return verify().then((p) => process.exit(p ? 0 : 1));
  console.error('Usage: --seed | --verify');
  process.exit(1);
})().catch(async (e) => { console.error('Fixture failed:', e.stack || e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
