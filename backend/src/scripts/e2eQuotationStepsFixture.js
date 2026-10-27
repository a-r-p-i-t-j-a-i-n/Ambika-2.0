/**
 * API oracle for Step 1.02 (Receive Quote & Make Comparative) and Step 1.03
 * (Approved Quotation) as main Purchase FMS workflow steps.
 *
 *   node src/scripts/e2eQuotationStepsFixture.js --seed   drop + seed the scratch DB
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_quotesteps node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5097/api/v1 node src/scripts/e2eQuotationStepsFixture.js --api
 *   node src/scripts/e2eQuotationStepsFixture.js --seed-ui   seed + indents in every state, for a browser look
 *
 * --api checks, through the real HTTP API (validation, controller, step timing):
 *   A  Quote Not Required: approved indent → only a pending Step 1.2; "Not Required"
 *      skips 1.3 (no pending 1.3 row, no 1.3 doer task), indent PO-ready, a PO can
 *      be raised; afterwards 1.2/1.3 resubmits are refused and the status is kept.
 *   B  Quote Required: 1.3 refused before 1.2; 1.2 "Yes" without a file refused;
 *      with files → 1.3 pending; PO refused until 1.3; 1.3 approval (one quotation
 *      removed = rejected, audit entry) → PO-ready; retry is idempotent; PO
 *      raised; re-approval refused, PO links kept; 1.2 file correction allowed.
 *   C  Rejected / draft indents never reach either step.
 *   D  Mixed indent (one item quoted, one not required) still needs 1.3.
 *   E  Two concurrent 1.2 submits: no duplicate rows, consistent state.
 *   F  Legacy records (old quoteStep shape only) are listed, never rewritten.
 *   G  Tile counts = list totals; states partition each step; per-step timing.
 *   H  Doer tasks: exactly one open task per pending indent and step.
 *   P  Planned dates: 1.02 = approval + 3 working days (Friday off) on single and
 *      bulk approval, never moved by retries / 1.02 saves; 1.03 = 1.02 actual + 1
 *      working day, none before 1.02 or when skipped; older stored dates kept.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. --api never drops the DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Party from '../modules/clients/party.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';
import { FmsTask } from '../modules/fms-doers/fmsDoer.model.js';
import { quoteComparativePlannedAt, quotationApprovalPlannedAt } from '../modules/procurement/indent/quotationSteps.js';

export const DB_NAME = 'ambika_e2e_quotesteps';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eQuotationStepsFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5097/api/v1').replace(/\/+$/, '');
const LOGIN = { email: 'quotesteps-e2e@test.local', password: 'E2e@12345' };
const doc = (name) => ({ fileName: `${name}.pdf`, fileUrl: `https://example.invalid/e2e/${name}.pdf`, fileType: 'application/pdf' });

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

// ── Seed ───────────────────────────────────────────────────────────────────
const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  await User.create({ ...LOGIN, name: 'E2E Quote Doer', role: 'MD', roles: ['MD'], mobile: '9000000088', isActive: true });
  await Party.create({ name: 'E2E Quote Vendor', partyType: 'VENDOR' }).catch(() => Party.create({ name: 'E2E Quote Vendor' }));
  console.log(`[seed] ${DB_NAME}: user ${LOGIN.email} / ${LOGIN.password}, vendor "E2E Quote Vendor"`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
let token = '';
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json, data: json?.data, meta: json?.meta, message: json?.message || '' };
};
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};

// Indent items must be SKU Master items (indent/itemSku.js): one upserted SKU
// per item name, named exactly like the item so name-based checks still hold.
const skuItem = async (name, quantity) => {
  const code = `E2E-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60);
  const sku = await SKU.findOneAndUpdate({ code }, { $setOnInsert: { code, name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true, new: true }).lean();
  return { skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity, unit: 'Pcs' };
};

const newApprovedIndent = async (items, extra = {}) => {
  const ind = await ok('POST', '/procurement/indents', {
    department: 'Stores', remarks: 'quote-steps e2e', items: await Promise.all(items.map((n, i) => skuItem(n, 10 + i))), ...extra,
  });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  return ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
};

const list = async (fmsStep, stepState, extra = '') => {
  const q = `fmsStep=${fmsStep}${stepState ? `&stepState=${stepState}` : ''}&limit=100${extra}`;
  const r = await call('GET', `/procurement/indents?${q}`);
  if (r.status !== 200) throw new Error(`list ${q} → ${r.status} ${r.message}`);
  return { rows: r.data, total: r.meta?.total };
};
const inList = async (fmsStep, stepState, id) => (await list(fmsStep, stepState)).rows.some((r) => r._id === String(id));
const stateOf = async (fmsStep, id) => {
  for (const s of ['PENDING', 'DONE', 'NOT_REQUIRED']) if (await inList(fmsStep, s, id)) return s;
  return null;
};
const fresh = (id) => PurchaseIndent.findById(id).lean();

const itemQuotes = (indent, files, statusFor = () => 'YES') => indent.items.map((it, i) => ({
  itemId: it._id, itemName: it.itemName, skuCode: it.skuCode, statusDone: statusFor(i),
  quotationDocuments: statusFor(i) === 'YES' ? files(i) : [],
}));

// The doer-task reconcile runs after the response; wait until it settles.
const tasksFor = async (id, stepKey, status = 'OPEN', expect = null) => {
  let n = -1;
  for (let i = 0; i < 40; i += 1) {
    n = await FmsTask.countDocuments({ fmsKey: 'PURCHASE', stepKey, entityType: 'INDENT', entityId: id, status });
    if (expect === null || n === expect) return n;
    await new Promise((r) => setTimeout(r, 250));
  }
  return n;
};

const poBody = (indent, vendorId) => ({
  indentId: indent._id, vendorId, vendorName: 'E2E Quote Vendor', expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: indent.items.map((it) => ({
    indentItemId: it._id, itemName: it.itemName, quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18,
  })),
});

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || login.data?.accessToken || '';
  if (!token) throw new Error(`login failed: ${login.status} ${login.message}`);
  const vendor = await Party.findOne({ name: 'E2E Quote Vendor' }).lean();
  // Step 1.3 names the approved vendor from the Vendor Master (itemVendor.js);
  // upserted here so --api keeps running on an existing DB without a reseed.
  await Vendor.updateOne({ code: 'E2E-QUOTE' }, { $set: { name: 'E2E Quote Vendor (master)', isActive: true, isDeleted: false } }, { upsert: true });
  const masterVendor = await Vendor.findOne({ code: 'E2E-QUOTE' }).lean();

  console.log('\n[A] Quotation Not Required');
  let a = await newApprovedIndent(['E2E Gasket']);
  check('A: approved indent is pending at Step 1.2', await stateOf('QUOTE_COMPARATIVE', a._id) === 'PENDING');
  check('A: not at Step 1.3 before 1.2 is done', await stateOf('QUOTATION_APPROVAL', a._id) === null);
  check('A: one open Step 1.2 doer task', await tasksFor(a._id, 'QUOTE_COMPARATIVE', 'OPEN', 1) === 1);
  const aNr = await call('POST', `/procurement/indents/${a._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED', itemQuotations: itemQuotes(a, () => [], () => 'QUOTE_NOT_REQUIRED'),
  });
  check('A: "Quote Not Required" accepted without any upload', aNr.status === 200, `${aNr.status} ${aNr.message}`);
  a = await fresh(a._id);
  check('A: indent PO-ready (QUOTATION_APPROVED), Step 1.3 skipped', a.overallStatus === 'QUOTATION_APPROVED' && a.quotationApprovalStep?.skipped === true, a.overallStatus);
  check('A: Step 1.2 state = NOT_REQUIRED', await stateOf('QUOTE_COMPARATIVE', a._id) === 'NOT_REQUIRED');
  check('A: Step 1.3 state = NOT_REQUIRED (skipped), never PENDING', await stateOf('QUOTATION_APPROVAL', a._id) === 'NOT_REQUIRED');
  check('A: no open Step 1.3 doer task', await tasksFor(a._id, 'QUOTATION_APPROVAL', 'OPEN', 0) === 0);
  check('A: Step 1.2 doer task closed', await tasksFor(a._id, 'QUOTE_COMPARATIVE', 'OPEN', 0) === 0);
  const aAq = await call('POST', `/procurement/indents/${a._id}/approve-quotation`, { itemApprovedQuotations: [] });
  check('A: Step 1.3 approval refused (skipped)', aAq.status === 400, `${aAq.status} ${aAq.message}`);
  const picker = await ok('GET', '/procurement/purchase-orders/approved-items');
  check('A: item offered in the PO approved-item picker', (picker?.items || []).some((r) => String(r.indentId) === String(a._id)));
  const aPo = await call('POST', '/procurement/purchase-orders', poBody(a, vendor._id));
  check('A: PO can be raised (existing quote-not-required path)', aPo.status === 201 || aPo.status === 200, `${aPo.status} ${aPo.message}`);
  a = await fresh(a._id);
  const aStatusAfterPo = a.overallStatus;
  check('A: indent moved on after PO (PO_READY / PARTIAL)', ['PO_READY', 'PARTIAL_PO_CREATED'].includes(aStatusAfterPo), aStatusAfterPo);
  const aRetry = await call('POST', `/procurement/indents/${a._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED', itemQuotations: itemQuotes(a, () => [], () => 'QUOTE_NOT_REQUIRED'),
  });
  check('A: repeated "Not Required" submit after the PO refused', aRetry.status === 400, `${aRetry.status} ${aRetry.message}`);
  const aYes = await call('POST', `/procurement/indents/${a._id}/quote-comparative`, {
    statusDone: 'YES', itemQuotations: itemQuotes(a, () => [doc('late')]),
  });
  check('A: switching to "Yes" after the PO refused (would reopen 1.3)', aYes.status === 400, `${aYes.status} ${aYes.message}`);
  check('A: status untouched by the refused submits', (await fresh(a._id)).overallStatus === aStatusAfterPo);

  console.log('\n[B] Quotation Required');
  let b = await newApprovedIndent(['E2E Bearing 6204', 'E2E V-Belt A42']);
  const bEarly = await call('POST', `/procurement/indents/${b._id}/approve-quotation`, { itemApprovedQuotations: [] });
  check('B: Step 1.3 refused before Step 1.2', bEarly.status === 400, `${bEarly.status} ${bEarly.message}`);
  const bPoEarly = await call('POST', '/procurement/purchase-orders', poBody(b, vendor._id));
  check('B: PO refused while the quotation is pending', bPoEarly.status === 400, `${bPoEarly.status} ${bPoEarly.message}`);
  const bNoFile = await call('POST', `/procurement/indents/${b._id}/quote-comparative`, { statusDone: 'YES', itemQuotations: itemQuotes(b, () => []) });
  check('B: Step 1.2 "Yes" without a quotation file refused', bNoFile.status === 400, `${bNoFile.status} ${bNoFile.message}`);
  check('B: still pending at Step 1.2 after the refusal', await stateOf('QUOTE_COMPARATIVE', b._id) === 'PENDING');
  const files = (i) => [doc(`B-item${i + 1}-vendorX`), doc(`B-item${i + 1}-vendorY`)];
  const bQ = await call('POST', `/procurement/indents/${b._id}/quote-comparative`, { statusDone: 'YES', itemQuotations: itemQuotes(b, files), remarks: 'X cheapest' });
  check('B: Step 1.2 recorded with item-wise quotations', bQ.status === 200, `${bQ.status} ${bQ.message}`);
  b = await fresh(b._id);
  check('B: overallStatus QUOTE_RECEIVED, files linked to the right items',
    b.overallStatus === 'QUOTE_RECEIVED'
    && b.quoteComparativeStep.itemQuotations.every((iq, i) => String(iq.itemId) === String(b.items[i]._id)
      && iq.quotationDocuments.map((d) => d.fileName).join() === files(i).map((d) => d.fileName).join()),
    JSON.stringify(b.quoteComparativeStep.itemQuotations.map((iq) => [iq.itemId, iq.quotationDocuments.map((d) => d.fileName)])));
  check('B: Step 1.2 DONE, Step 1.3 PENDING', await stateOf('QUOTE_COMPARATIVE', b._id) === 'DONE' && await stateOf('QUOTATION_APPROVAL', b._id) === 'PENDING');
  check('B: one open Step 1.3 doer task, Step 1.2 task closed',
    await tasksFor(b._id, 'QUOTATION_APPROVAL', 'OPEN', 1) === 1 && await tasksFor(b._id, 'QUOTE_COMPARATIVE', 'OPEN', 0) === 0);
  const bPoMid = await call('POST', '/procurement/purchase-orders', poBody(b, vendor._id));
  check('B: PO still refused until Step 1.3', bPoMid.status === 400, `${bPoMid.status} ${bPoMid.message}`);
  const picker2 = await ok('GET', '/procurement/purchase-orders/approved-items');
  check('B: not offered in the PO picker before approval', !(picker2?.items || []).some((r) => String(r.indentId) === String(b._id)));
  // Approver keeps vendor X's quotation per item (Y's removed = not approved).
  const approval = {
    itemApprovedQuotations: b.items.map((it, i) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES', approvedQuotationDocuments: [b.quoteComparativeStep.itemQuotations[i].quotationDocuments[0]],
      vendorId: masterVendor._id,
    })),
    remarks: 'Vendor X approved',
  };
  const bA = await call('POST', `/procurement/indents/${b._id}/approve-quotation`, approval);
  check('B: Step 1.3 approval recorded', bA.status === 200, `${bA.status} ${bA.message}`);
  b = await fresh(b._id);
  const auditApproval = b.activityTimeline.filter((t) => t.action === 'APPROVE_QUOTATION');
  check('B: QUOTATION_APPROVED; audit says 2 approved, 2 rejected',
    b.overallStatus === 'QUOTATION_APPROVED' && /2 quotation\(s\) approved.*2 rejected/.test(auditApproval.at(-1)?.description || ''),
    `${b.overallStatus} · ${auditApproval.at(-1)?.description}`);
  check('B: Step 1.3 DONE', await stateOf('QUOTATION_APPROVAL', b._id) === 'DONE');
  const bRetry = await call('POST', `/procurement/indents/${b._id}/approve-quotation`, approval);
  const b2 = await fresh(b._id);
  check('B: retried approval (before any PO) is idempotent — same approved files, same status',
    bRetry.status === 200 && b2.overallStatus === 'QUOTATION_APPROVED'
    && b2.quotationApprovalStep.itemApprovedQuotations.length === 2
    && b2.quotationApprovalStep.itemApprovedQuotations.every((r) => r.approvedQuotationDocuments.length === 1),
    `${bRetry.status} ${b2.overallStatus}`);
  check('B: open Step 1.3 task closed after approval', await tasksFor(b._id, 'QUOTATION_APPROVAL', 'OPEN', 0) === 0);
  const bPoOther = await call('POST', '/procurement/purchase-orders', poBody(b2, vendor._id));
  check('B: PO with a vendor other than the approved one refused', bPoOther.status === 400, `${bPoOther.status} ${bPoOther.message}`);
  const bPo = await call('POST', '/procurement/purchase-orders', poBody(b2, masterVendor._id));
  check('B: PO raised after approval', bPo.status === 201 || bPo.status === 200, `${bPo.status} ${bPo.message}`);
  const b3 = await fresh(b._id);
  const reAp = await call('POST', `/procurement/indents/${b._id}/approve-quotation`, approval);
  const b4 = await fresh(b._id);
  check('B: re-approval after the PO refused, status + item PO links kept',
    reAp.status === 400 && b4.overallStatus === b3.overallStatus
    && JSON.stringify(b4.items.map((i) => i.poId)) === JSON.stringify(b3.items.map((i) => i.poId)),
    `${reAp.status} ${reAp.message} · ${b3.overallStatus} → ${b4.overallStatus}`);
  const corr = await call('POST', `/procurement/indents/${b._id}/quote-comparative`, { statusDone: 'YES', itemQuotations: itemQuotes(b4, files), remarks: 'corrected' });
  const b5 = await fresh(b._id);
  check('B: Step 1.2 file correction after approval still allowed, status kept',
    corr.status === 200 && b5.overallStatus === b3.overallStatus && b5.quotationApprovalStep.statusDone === 'YES',
    `${corr.status} ${corr.message} · ${b5.overallStatus}`);

  console.log('\n[C] Rejected / draft indents');
  const draft = await ok('POST', '/procurement/indents', { department: 'Stores', items: [await skuItem('E2E Draft Item', 1)] });
  const rej = await ok('POST', '/procurement/indents', { department: 'Stores', items: [await skuItem('E2E Rejected Item', 1)] });
  await ok('POST', `/procurement/indents/${rej._id}/submit`, {});
  await ok('POST', `/procurement/indents/${rej._id}/reject`, { remarks: 'not needed' });
  for (const [label, id] of [['draft', draft._id], ['rejected', rej._id]]) {
    check(`C: ${label} indent in neither step`, await stateOf('QUOTE_COMPARATIVE', id) === null && await stateOf('QUOTATION_APPROVAL', id) === null);
  }
  const rejQ = await call('POST', `/procurement/indents/${rej._id}/quote-comparative`, { statusDone: 'QUOTE_NOT_REQUIRED' });
  check('C: Step 1.2 refused on a rejected indent', rejQ.status === 400, `${rejQ.status}`);

  console.log('\n[D] Mixed: one item quoted, one not required');
  let d = await newApprovedIndent(['E2E Fevicol 1kg', 'E2E Cotton Waste']);
  const dQ = await call('POST', `/procurement/indents/${d._id}/quote-comparative`, {
    statusDone: 'YES', itemQuotations: itemQuotes(d, (i) => [doc(`D-item${i + 1}`)], (i) => (i === 0 ? 'YES' : 'QUOTE_NOT_REQUIRED')),
  });
  d = await fresh(d._id);
  check('D: still needs Step 1.3 (pending), not skipped', dQ.status === 200 && d.overallStatus === 'QUOTE_RECEIVED'
    && await stateOf('QUOTATION_APPROVAL', d._id) === 'PENDING', `${dQ.status} ${d.overallStatus}`);
  check('D: the not-required item carries no files', d.quoteComparativeStep.itemQuotations[1].quotationDocuments.length === 0);

  console.log('\n[E] Concurrent Step 1.2 submits');
  let e = await newApprovedIndent(['E2E Hose Clamp']);
  const body = { statusDone: 'YES', itemQuotations: itemQuotes(e, () => [doc('E-q1')]) };
  const results = await Promise.all([1, 2, 3].map(() => call('POST', `/procurement/indents/${e._id}/quote-comparative`, body)));
  e = await fresh(e._id);
  check('E: every response is 200 or 409 (no 500)', results.every((r) => [200, 409].includes(r.status)), results.map((r) => r.status).join());
  check('E: one item row, one file, QUOTE_RECEIVED', e.overallStatus === 'QUOTE_RECEIVED'
    && e.quoteComparativeStep.itemQuotations.length === 1 && e.quoteComparativeStep.itemQuotations[0].quotationDocuments.length === 1);
  check('E: at most one open Step 1.3 task', await tasksFor(e._id, 'QUOTATION_APPROVAL', 'OPEN', 1) === 1);

  console.log('\n[F] Legacy records');
  const legacy = await PurchaseIndent.collection.insertOne({
    indentNumber: `Ind-LEGACY-${Date.now()}/24-25`, approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', isDeleted: false,
    productNameRevised: 'Legacy Box', quantity: 5, items: [], quoteStep: { status: 'RECEIVED', actualAt: new Date('2024-06-01') },
    createdAt: new Date('2024-06-01'), timestamp: new Date('2024-06-01'),
  });
  const before = JSON.stringify(await fresh(legacy.insertedId));
  check('F: legacy quoted indent → Step 1.2 DONE, Step 1.3 DONE',
    await stateOf('QUOTE_COMPARATIVE', legacy.insertedId) === 'DONE' && await stateOf('QUOTATION_APPROVAL', legacy.insertedId) === 'DONE');
  check('F: listing never rewrites the record', JSON.stringify(await fresh(legacy.insertedId)) === before);

  console.log('\n[P] Planned dates');
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  let p = await newApprovedIndent(['E2E Planned Item']);
  p = await fresh(p._id);
  const expected12 = iso(quoteComparativePlannedAt(p.approval.approvedAt));
  check('P: approve stamps 1.02 planned = approval + 3 working days', iso(p.quoteStep.plannedAt) === expected12,
    `${iso(p.approval.approvedAt)} → ${iso(p.quoteStep.plannedAt)} (expected ${expected12})`);
  const pRow = (await list('QUOTE_COMPARATIVE', 'PENDING')).rows.find((r) => r._id === String(p._id));
  check('P: 1.02 list shows that planned date', iso(pRow?.stepTiming?.plannedAt) === expected12, iso(pRow?.stepTiming?.plannedAt));
  const reApprove = await call('POST', `/procurement/indents/${p._id}/approve`, { items: p.items.map((it) => ({ _id: it._id, approvalStatus: 'APPROVED' })) });
  check('P: a retried approval is refused and the planned date is unchanged',
    reApprove.status === 400 && iso((await fresh(p._id)).quoteStep.plannedAt) === expected12, `${reApprove.status}`);
  check('P: no 1.03 planned date while 1.02 is pending', quotationApprovalPlannedAt(await fresh(p._id)) === null
    && await stateOf('QUOTATION_APPROVAL', p._id) === null);

  const draftB = await ok('POST', '/procurement/indents', { department: 'Stores', items: [await skuItem('E2E Bulk Planned', 3)] });
  await ok('POST', `/procurement/indents/${draftB._id}/submit`, {});
  const bulk = await ok('POST', '/procurement/indents/bulk-approve', { indents: [{ indentId: draftB._id }] });
  const pb = await fresh(draftB._id);
  check('P: bulk approval uses the same rule', bulk.approvedCount === 1
    && iso(pb.quoteStep.plannedAt) === iso(quoteComparativePlannedAt(pb.approval.approvedAt)), iso(pb.quoteStep.plannedAt));

  // Step 1.2 completed on a Thursday (date-only, as the dialog sends it) → 1.03 planned Saturday.
  const qBody = { statusDone: 'YES', actualAt: '2026-10-29', itemQuotations: itemQuotes(p, () => [doc('P-q')]).map((q) => ({ ...q, actualAt: '2026-10-29' })) };
  await ok('POST', `/procurement/indents/${p._id}/quote-comparative`, qBody);
  check('P: 1.02 completion leaves the 1.02 planned date as stamped', iso((await fresh(p._id)).quoteStep.plannedAt) === expected12);
  const p13 = (await list('QUOTATION_APPROVAL', 'PENDING')).rows.find((r) => r._id === String(p._id));
  check('P: 1.03 planned = 1.02 actual (Thu 29 Oct) + 1 working day = Sat 31 Oct (Friday skipped)',
    iso(p13?.stepTiming?.plannedAt) === '2026-10-31T00:00:00.000Z', iso(p13?.stepTiming?.plannedAt));
  await ok('POST', `/procurement/indents/${p._id}/quote-comparative`, qBody); // retry, same payload
  const p13b = (await list('QUOTATION_APPROVAL', 'PENDING')).rows.find((r) => r._id === String(p._id));
  check('P: retried 1.02 save keeps both planned dates', iso(p13b?.stepTiming?.plannedAt) === '2026-10-31T00:00:00.000Z'
    && iso((await fresh(p._id)).quoteStep.plannedAt) === expected12);
  const skipRow = (await list('QUOTATION_APPROVAL', 'NOT_REQUIRED')).rows.find((r) => r._id === String(a._id));
  check('P: skipped 1.03 (Quote Not Required) has no planned date', !!skipRow && skipRow.stepTiming.plannedAt === null, JSON.stringify(skipRow?.stepTiming));

  const oldPlanned = new Date('2025-01-06T09:00:00Z');
  const old = await PurchaseIndent.collection.insertOne({
    indentNumber: `Ind-OLDPLAN-${Date.now()}/25-26`, approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING', isDeleted: false,
    items: [{ _id: new mongoose.Types.ObjectId(), itemName: 'Old Planned Item', quantity: 2, approvalStatus: 'APPROVED' }],
    approval: { approvedAt: oldPlanned }, quoteStep: { status: 'PENDING', plannedAt: oldPlanned }, createdAt: oldPlanned, timestamp: oldPlanned,
  });
  const oldBefore = JSON.stringify(await fresh(old.insertedId));
  const oldRow = (await list('QUOTE_COMPARATIVE', 'PENDING')).rows.find((r) => r._id === String(old.insertedId));
  check('P: an older indent keeps its stored planned date (not recomputed)', iso(oldRow?.stepTiming?.plannedAt) === oldPlanned.toISOString(), iso(oldRow?.stepTiming?.plannedAt));
  check('P: and the record is not rewritten', JSON.stringify(await fresh(old.insertedId)) === oldBefore);

  console.log('\n[G] Counts, partition, per-step timing');
  const stats = (await ok('GET', '/procurement/indents/stats')).quotationSteps;
  for (const step of ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL']) {
    const totals = {};
    for (const s of ['PENDING', 'DONE', 'NOT_REQUIRED']) totals[s] = (await list(step, s)).total;
    const all = (await list(step)).total;
    check(`G: ${step} tiles match list totals`, ['PENDING', 'DONE', 'NOT_REQUIRED'].every((s) => stats[step][s] === totals[s]) && stats[step].ALL === all,
      JSON.stringify({ stats: stats[step], totals, all }));
    check(`G: ${step} states partition the step`, totals.PENDING + totals.DONE + totals.NOT_REQUIRED === all);
    const rows = (await list(step)).rows;
    check(`G: ${step} rows carry this step's timing`, rows.length > 0 && rows.every((r) => r.stepTiming?.stepKey === step),
      JSON.stringify(rows.map((r) => r.stepTiming?.stepKey)));
  }
  const g = await newApprovedIndent(['E2E Pending Timing Item']);
  const pendingRow = (await list('QUOTE_COMPARATIVE', 'PENDING')).rows.find((r) => r._id === String(g._id));
  check('G: pending 1.2 row has planned, no actual', !!pendingRow?.stepTiming?.plannedAt && pendingRow.stepTiming.actualAt === null,
    JSON.stringify(pendingRow?.stepTiming));
  const skippedRow = (await list('QUOTATION_APPROVAL', 'NOT_REQUIRED')).rows.find((r) => r._id === String(a._id));
  check('G: skipped 1.3 row shows no actual / performer', skippedRow?.stepTiming?.done === true && !skippedRow.stepTiming.actualAt && !skippedRow.stepTiming.doneByName);
  const search = await list('QUOTE_COMPARATIVE', undefined, `&search=${encodeURIComponent(b.indentNumber)}`);
  check('G: search combines with the step filter', search.total === 1 && search.rows[0]._id === String(b._id), `${search.total}`);
  const bad = await call('GET', '/procurement/indents?fmsStep=PO_CREATE');
  check('G: unknown step rejected (422/400)', [400, 422].includes(bad.status), `${bad.status}`);
  const plain = await call('GET', '/procurement/indents?limit=100');
  check('G: plain indent list unchanged (all indents, current-step timing)', plain.meta?.total >= 7 && plain.data.every((r) => !r.stepTiming || r.stepTiming.multiStep), `${plain.meta?.total}`);

  console.log('\n[H] Doer tasks');
  await tasksFor(g._id, 'QUOTE_COMPARATIVE', 'OPEN', 1);
  const stats2 = (await ok('GET', '/procurement/indents/stats')).quotationSteps;
  const dupes = await FmsTask.aggregate([
    { $match: { fmsKey: 'PURCHASE', status: 'OPEN', stepKey: { $in: ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL'] } } },
    { $group: { _id: { s: '$stepKey', e: '$entityId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  check('H: no duplicate open quotation tasks', dupes.length === 0, JSON.stringify(dupes));
  const open12 = await FmsTask.countDocuments({ fmsKey: 'PURCHASE', stepKey: 'QUOTE_COMPARATIVE', status: 'OPEN' });
  const open13 = await FmsTask.countDocuments({ fmsKey: 'PURCHASE', stepKey: 'QUOTATION_APPROVAL', status: 'OPEN' });
  check('H: open tasks = pending rows (1.2 / 1.3)', open12 === stats2.QUOTE_COMPARATIVE.PENDING && open13 === stats2.QUOTATION_APPROVAL.PENDING,
    `tasks ${open12}/${open13} vs pending ${stats2.QUOTE_COMPARATIVE.PENDING}/${stats2.QUOTATION_APPROVAL.PENDING}`);
};

// A pending row in each step for a browser look (on top of --api data).
const seedUi = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || '';
  if (!token) throw new Error('login failed — is the e2e backend running on this DB?');
  const p1 = await newApprovedIndent(['E2E UI Pending Quote Item']);
  const p2 = await newApprovedIndent(['E2E UI Approval Item A', 'E2E UI Approval Item B']);
  await ok('POST', `/procurement/indents/${p2._id}/quote-comparative`, {
    statusDone: 'YES', itemQuotations: itemQuotes(p2, (i) => [doc(`UI-${i}-X`), doc(`UI-${i}-Y`)]),
  });
  console.log(`[seed-ui] pending 1.2: ${p1.indentNumber} · pending 1.3: ${p2.indentNumber}`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === '--seed') await seed();
    else if (mode === '--api') await api();
    else if (mode === '--seed-ui') await seedUi();
    else { console.log('usage: --seed | --api | --seed-ui'); process.exitCode = 2; }
    if (mode === '--api') {
      console.log(`\n${passes} passed, ${failures} failed`);
      if (failures) process.exitCode = 1;
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
