/**
 * API oracle for editable PO Terms & Conditions (purchase-order/poTerms.js).
 *
 *   node src/scripts/e2ePoTermsFixture.js --seed      upsert users + vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_poterms node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5097/api/v1 node src/scripts/e2ePoTermsFixture.js --api
 *   API=... node src/scripts/e2ePoTermsFixture.js --prep-ui   POs for the browser probe
 *
 * Users: MD (roles ['MD'] — also the settings admin) and BUYER (PLANNER).
 * --api makes fresh indents/POs every run (re-runnable) and resets the two
 * default-terms settings it changes back to what it found. Checks:
 *   D  Defaults: read by any user, edited by settings.edit only, never blank, audited.
 *   C  Create: blank terms → the format's default copied onto the PO; custom
 *      text kept (line breaks, CRLF tidied); a later default change leaves it.
 *   P  PDF: preview / on-demand / release all print the PO's terms, edited date
 *      included; release remarks no longer land in the printed terms.
 *   E  Terms-only edit: draft (anyone), approved (MD only), released /
 *      cancelled / rejected refused; nothing but the terms changes; stale
 *      stored PDF dropped; draft PATCH /:id carries terms too.
 *   L  Legacy POs (no terms field): keep printing Remarks; pinned before a
 *      release / cancel remark overwrites Remarks.
 *   R  Revise carries terms; validation + auth.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import zlib from 'zlib';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import CompanySettings from '../modules/pricing/company-settings.model.js';
import AuditLog from '../modules/audit-logs/audit-log.model.js';
import SKU from '../modules/skus/sku.model.js';
import { BUILT_IN_PO_TERMS, PO_TERMS_MAX } from '../modules/procurement/purchase-order/poTerms.js';

export const DB_NAME = 'ambika_e2e_poterms';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePoTermsFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5097/api/v1').replace(/\/+$/, '');
const ORIGIN = new URL(API).origin;
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:    { email: 'poterms-md@test.local',    name: 'E2E Terms MD',    role: 'MD', roles: ['MD'],      mobile: '9000000091' },
  BUYER: { email: 'poterms-buyer@test.local', name: 'E2E Terms Buyer', role: 'EA', roles: ['PLANNER'], mobile: '9000000092' },
};
const VENDORS = [
  { code: 'PT-JINDAL', name: 'PT Jindal Stainless Ltd', isActive: true },
  { code: 'PT-OTHER', name: 'PT Other Traders', isActive: true },
];
const RUN = Date.now().toString(36);

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 400)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

// ── Seed (idempotent upserts — never drops) ────────────────────────────────
const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, ...rest } = u;
    if (!await User.findOne({ email: u.email })) {
      await User.create({ ...rest, password: PASSWORD, role, roles, permissionGrants: [], isActive: true });
    }
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants: [], permissionDenies: [], isActive: true } });
  }
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, { $set: { name: v.name, isActive: v.isActive, isDeleted: false } }, { upsert: true });
  }
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; vendors ${VENDORS.map((v) => v.name).join(', ')}`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
const tokens = {};
const call = async (who, method, path, body, headers = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};
const login = async () => {
  for (const [key, u] of Object.entries(USERS)) {
    const r = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[key] = r.data?.token || '';
    if (!tokens[key]) throw new Error(`login ${u.email} failed: ${r.status} ${r.message} — run --seed first`);
  }
};

// Text drawn in a PDFKit PDF: inflate every content stream, decode each Tj/TJ
// hex string (Helvetica = Windows-1252, so "—" is byte 0x97). Returns the
// drawn strings — one per printed line — plus one whitespace-normalized string.
// (Node's TextDecoder('windows-1252') decodes as plain latin1, hence the table.)
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const cp1252 = { decode: (buf) => [...buf].map((b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b))).join('') };
const pdfText = (buf) => {
  const raw = buf.toString('latin1');
  const lines = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const op of s.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexes = op[1] != null ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]) : [op[2]];
      lines.push(hexes.map((h) => cp1252.decode(Buffer.from(h, 'hex'))).join(''));
    }
  }
  return { lines, flat: lines.join(' ').replace(/\s+/g, ' ') };
};
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const pdfOf = async (url) => {
  const res = await fetch(url.replace(/^https?:\/\/[^/]+/, ORIGIN));
  return Buffer.from(await res.arrayBuffer());
};
// Generate (POST /:id/pdf) and read back the stored file.
const savedPdf = async (who, id) => {
  const r = await call(who, 'POST', `/procurement/purchase-orders/${id}/pdf`);
  if (r.status !== 200) throw new Error(`pdf ${id} → ${r.status} ${r.message}`);
  return { url: r.data.poPdfUrl, text: pdfText(await pdfOf(r.data.poPdfUrl)) };
};

const skuItem = async (name, quantity) => {
  const code = `E2E-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60);
  const sku = await SKU.findOneAndUpdate({ code }, { $setOnInsert: { code, name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true, new: true }).lean();
  return { skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity, unit: 'Pcs' };
};

// A PO-ready indent (quotation not required), every item's vendor fixed to `vendorId`.
let seq = 0;
const readyIndent = async (label, vendorId) => {
  seq += 1;
  const ind = await ok('MD', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `po-terms e2e ${RUN}`,
    items: [await skuItem(`PT ${label} ${RUN}-${seq}`, 10)],
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [] })),
  });
  for (const it of approved.items) {
    await ok('MD', 'PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: ind._id, indentItemId: it._id, vendorId });
  }
  return PurchaseIndent.findById(ind._id).lean();
};

const due = () => new Date(Date.now() + 7 * 864e5).toISOString();
const line = (fmt, indent, it) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit,
  ...(fmt === 'JSL'
    ? { grade: 'J4', width: '1250', finish: '2B', baseRate: 180, upfrontDiscount: 2, bonanzaDiscount: 1 }
    : { rate: 100, gstRate: 18 }),
});
const createPo = (who, fmt, indent, vendorId, extra = {}) => call(who, 'POST', '/procurement/purchase-orders/create-from-items', {
  poFormatType: fmt, vendorId, expectedDeliveryDate: due(), items: indent.items.map((it) => line(fmt, indent, it)), ...extra,
});
const newPo = async (who, fmt, vendorId, extra = {}) => {
  const ind = await readyIndent(`${fmt} ${who}`, vendorId);
  const r = await createPo(who, fmt, ind, vendorId, extra);
  if (r.status !== 201) throw new Error(`create ${fmt} → ${r.status} ${r.message}`);
  return { indent: ind, po: r.data };
};
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
// Turn a PO into one saved before the terms field existed (Remarks = its terms).
const makeLegacy = async (id, remarks) => {
  const r = await VendorPurchaseOrder.updateOne({ _id: id }, { $unset: { termsAndConditions: 1 }, $set: { remarks } });
  if (r.matchedCount !== 1) throw new Error(`makeLegacy ${id}: no PO matched`);
};
const approve = (id) => ok('MD', 'POST', `/procurement/purchase-orders/${id}/approve`, { decision: 'APPROVED' });
const setTerms = (who, id, termsAndConditions, extra = {}) => call(who, 'PATCH', `/procurement/purchase-orders/${id}/terms`, { termsAndConditions, ...extra });
const setDefault = (field, text) => call('MD', 'PATCH', '/pricing/settings', { [field]: text });

// Fields a terms-only edit must never touch.
const frozen = (po) => JSON.stringify({
  items: po.items, vendorId: String(po.vendorId), vendorName: po.vendorName, approvalStatus: po.approvalStatus,
  releaseStatus: po.releaseStatus, poStatus: po.poStatus, poNumber: po.poNumber, draftNumber: po.draftNumber,
  totalTaxableValue: po.totalTaxableValue, totalGSTAmount: po.totalGSTAmount, grandTotal: po.grandTotal,
  remarks: po.remarks, deliveryTerms: po.deliveryTerms, paymentTerms: po.paymentTerms, approval: po.approval,
  expectedDeliveryDate: po.expectedDeliveryDate, poFormatType: po.poFormatType, indentIds: po.indentIds,
});

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  await login();
  const [jindal, other] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  const J = String(jindal._id);
  const O = String(other._id);
  const md = await User.findOne({ email: USERS.MD.email }).lean();
  // Remember the defaults so the run can put them back.
  const before = await ok('BUYER', 'GET', '/procurement/purchase-orders/terms-defaults');
  console.log(`run ${RUN} against ${API}`);

  try {
    // ── D: defaults ──
    console.log('\nD  Default terms per format (Company Settings)');
    check('D1 any PO user reads both defaults', !!before.JSL && !!before.OTHER, JSON.stringify(before));
    const buyerEdit = await call('BUYER', 'PATCH', '/pricing/settings', { poTermsJsl: 'buyer try' });
    check('D2 a non-admin cannot change a default (403)', buyerEdit.status === 403, `${buyerEdit.status} ${buyerEdit.message}`);
    const blank = await setDefault('poTermsJsl', '   ');
    check('D3 a default cannot be blanked (422)', blank.status === 422, `${blank.status} ${blank.message}`);
    const tooLong = await setDefault('poTermsOther', 'x'.repeat(PO_TERMS_MAX + 1));
    check('D4 a default over the limit is refused (422)', tooLong.status === 422, `${tooLong.status}`);
    const v2 = `This order is under Price Protection Policy till 31st March 2027.\r\nRun ${RUN}.`;
    const auditBefore = await AuditLog.countDocuments({ entityName: 'CompanySettings', module: 'settings' });
    const saved = await setDefault('poTermsJsl', v2);
    const d = await ok('BUYER', 'GET', '/procurement/purchase-orders/terms-defaults');
    check('D5 admin edits the JSL default (CRLF tidied) and the PO form sees it', saved.status === 200 && d.JSL === v2.replace('\r\n', '\n'), `${saved.status} ${JSON.stringify(d.JSL)}`);
    check('D6 OTHER default untouched', d.OTHER === before.OTHER);
    const audit = await AuditLog.findOne({ entityName: 'CompanySettings', module: 'settings' }).sort({ createdAt: -1 }).lean();
    check('D7 change audited with the old and new text and who made it',
      (await AuditLog.countDocuments({ entityName: 'CompanySettings', module: 'settings' })) === auditBefore + 1
      && audit?.oldValue?.poTermsJsl === before.JSL && audit?.newValue?.poTermsJsl === d.JSL && String(audit?.updatedBy) === String(md._id),
      JSON.stringify(audit));
    await setDefault('poTermsJsl', v2);
    check('D8 saving the same text again writes no audit row', (await AuditLog.countDocuments({ entityName: 'CompanySettings', module: 'settings' })) === auditBefore + 1);

    // ── C: create ──
    console.log('\nC  New POs copy the default, or keep the buyer\'s text');
    const { po: jsl1 } = await newPo('BUYER', 'JSL', J);
    check('C1 JSL PO created with blank terms stores the current JSL default', (await poNow(jsl1._id)).termsAndConditions === d.JSL, (await poNow(jsl1._id)).termsAndConditions);
    const custom = 'Custom OTHER terms — valid till 15th January 2027.\r\n\r\n2. Second clause\t(tab)';
    const { po: oth1 } = await newPo('BUYER', 'OTHER', O, { termsAndConditions: custom, remarks: 'internal only' });
    const oth1Db = await poNow(oth1._id);
    check('C2 custom terms stored with line breaks kept, CRLF/tab tidied', oth1Db.termsAndConditions === 'Custom OTHER terms — valid till 15th January 2027.\n\n2. Second clause    (tab)', JSON.stringify(oth1Db.termsAndConditions));
    const { po: oth2 } = await newPo('BUYER', 'OTHER', O);
    check('C3 OTHER PO with blank terms stores the OTHER default', (await poNow(oth2._id)).termsAndConditions === d.OTHER);
    const v3 = `JSL default v3 — Price Protection till 30th September 2027. ${RUN}`;
    await setDefault('poTermsJsl', v3);
    check('C4 changing the default later leaves an existing PO as it was', (await poNow(jsl1._id)).termsAndConditions === d.JSL);
    const { po: jsl2 } = await newPo('BUYER', 'JSL', J);
    check('C5 a new JSL PO gets the new default', (await poNow(jsl2._id)).termsAndConditions === v3);
    const longInd = await readyIndent('long', O);
    const long = await createPo('BUYER', 'OTHER', longInd, O, { termsAndConditions: 'x'.repeat(PO_TERMS_MAX + 1) });
    check('C6 terms over the limit refused on create (422), nothing created', long.status === 422
      && (await VendorPurchaseOrder.countDocuments({ indentIds: longInd._id })) === 0, `${long.status} ${long.message}`);
    const md1 = await newPo('MD', 'JSL', J, { saveMode: 'DIRECT', termsAndConditions: 'MD direct terms till 1st May 2027' });
    check('C7 MD "Save PO Directly" keeps the terms and still approves', md1.po.approvalStatus === 'APPROVED' && (await poNow(md1.po._id)).termsAndConditions === 'MD direct terms till 1st May 2027');

    // ── P: PDFs ──
    console.log('\nP  PDF preview / download / release print the PO\'s terms');
    const pv = await call('BUYER', 'POST', '/procurement/purchase-orders/preview-pdf', {
      poFormatType: 'JSL', vendorId: J, items: [line('JSL', longInd, longInd.items[0])],
      termsAndConditions: 'Preview terms valid till 31st August 2027.\nSecond line',
    });
    const pvText = pv.pdf ? pdfText(pv.pdf) : { flat: '', lines: [] };
    const pvAt = pvText.lines.indexOf('Preview terms valid till 31st August 2027.');
    check('P1 preview (no save) prints the edited date, the line break kept', pv.status === 200
      && pvAt >= 0 && pvText.lines[pvAt + 1] === 'Second line', pvText.lines.filter((l) => /Preview|Second/.test(l)).join(' | '));
    const pvBlank = await call('BUYER', 'POST', '/procurement/purchase-orders/preview-pdf', {
      poFormatType: 'JSL', vendorId: J, items: [line('JSL', longInd, longInd.items[0])], remarks: 'a remark',
    });
    const pvBlankText = pdfText(pvBlank.pdf);
    check('P2 preview with blank terms prints the current default, never the Remarks',
      pvBlankText.flat.includes(flat(v3)) && !pvBlankText.flat.includes('a remark'));
    check('P3 no PDF prints the old hardcoded date unless a PO/default says so', !pvText.flat.includes('30th June 2026') && !pvBlankText.flat.includes('30th June 2026'));
    const oth1Pdf = await savedPdf('BUYER', oth1._id);
    check('P4 saved draft PDF prints its own terms, not its Remarks', oth1Pdf.text.flat.includes('Custom OTHER terms') && oth1Pdf.text.flat.includes('15th January 2027')
      && oth1Pdf.text.flat.includes('Second clause') && !oth1Pdf.text.flat.includes('internal only'));
    const jsl1Pdf = await savedPdf('BUYER', jsl1._id);
    check('P5 JSL PDF prints the default it was created with (31st March 2027), not the newer one', jsl1Pdf.text.flat.includes('31st March 2027') && !jsl1Pdf.text.flat.includes(flat(v3)));
    // Release with a release remark.
    await approve(jsl1._id);
    const rel = await call('MD', 'POST', `/procurement/purchase-orders/${jsl1._id}/release`, { sendEmail: false, remarks: `Release note ${RUN}` });
    const jsl1Rel = await poNow(jsl1._id);
    const relText = pdfText(await pdfOf(jsl1Rel.poPdfUrl));
    check('P6 release PDF prints the PO terms; the release remark is not printed as terms', rel.status === 200
      && relText.flat.includes('31st March 2027') && !relText.flat.includes(`Release note ${RUN}`), `${rel.status} ${rel.message}`);
    check('P7 the release remark still goes to Remarks; terms unchanged', jsl1Rel.remarks === `Release note ${RUN}` && jsl1Rel.termsAndConditions === d.JSL);
    const dl = await call('BUYER', 'POST', `/procurement/purchase-orders/${jsl1._id}/pdf`);
    check('P8 download of a released PO returns the stored release copy', dl.status === 200 && dl.data.poPdfUrl === jsl1Rel.poPdfUrl);
    const bulkPo = (await newPo('MD', 'OTHER', O, { termsAndConditions: `Bulk terms ${RUN} till 2nd June 2027` })).po;
    await approve(bulkPo._id);
    const bulk = await call('MD', 'POST', '/procurement/purchase-orders/bulk-release', { poIds: [bulkPo._id], sendEmail: false });
    const bulkDb = await poNow(bulkPo._id);
    check('P9 bulk release PDF prints the PO terms', bulk.status === 200 && pdfText(await pdfOf(bulkDb.poPdfUrl)).flat.includes(`Bulk terms ${RUN} till 2nd June 2027`), `${bulk.status} ${bulk.message}`);

    // ── E: terms-only edit ──
    console.log('\nE  Edit Terms & Conditions on an existing PO');
    const draft = (await poNow(oth2._id));
    await savedPdf('BUYER', draft._id); // a stored preview PDF that must not go stale
    const draftBefore = await poNow(draft._id);
    const edited = 'Edited OTHER terms — delivery by 20th December 2026.\n\n- point one\n- point two';
    const e1 = await setTerms('BUYER', draft._id, edited, { items: [], approvalStatus: 'APPROVED', grandTotal: 1, vendorId: J, remarks: 'hack' });
    const draftAfter = await poNow(draft._id);
    check('E1 buyer edits a draft\'s terms (200)', e1.status === 200 && draftAfter.termsAndConditions === edited, `${e1.status} ${e1.message}`);
    check('E2 nothing else changed — extra fields in the request are ignored', frozen(draftAfter) === frozen(draftBefore), `${frozen(draftBefore)}\n≠ ${frozen(draftAfter)}`);
    check('E3 activity log gets UPDATE_TERMS by the buyer', draftAfter.activityTimeline.at(-1)?.action === 'UPDATE_TERMS'
      && draftAfter.activityTimeline.length === draftBefore.activityTimeline.length + 1);
    check('E4 the stored (now stale) PDF is dropped', draftBefore.poPdfUrl && !draftAfter.poPdfUrl);
    const e5 = await savedPdf('BUYER', draft._id);
    check('E5 the next PDF prints the edited terms and date', e5.text.flat.includes('20th December 2026') && e5.text.flat.includes('- point two'));
    const again = await setTerms('BUYER', draft._id, edited);
    check('E6 saving the same text again is a no-op (no extra log entry)', again.status === 200 && (await poNow(draft._id)).activityTimeline.length === draftAfter.activityTimeline.length);
    const reset = await setTerms('BUYER', draft._id, '');
    check('E7 blank resets to the format\'s current default', reset.status === 200 && (await poNow(draft._id)).termsAndConditions === d.OTHER);
    const got = await ok('BUYER', 'GET', `/procurement/purchase-orders/${draft._id}`);
    check('E8 GET /:id returns the terms', got.termsAndConditions === d.OTHER);

    const viaUpdate = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${draft._id}`, { termsAndConditions: 'Via draft edit till 9th Nov 2027' });
    const viaDb = await poNow(draft._id);
    check('E9 draft "Save Changes" (PATCH /:id) saves terms with items untouched', viaUpdate.status === 200 && viaDb.termsAndConditions === 'Via draft edit till 9th Nov 2027'
      && JSON.stringify(viaDb.items.map((i) => [i.quantity, i.rate])) === JSON.stringify(draftBefore.items.map((i) => [i.quantity, i.rate])), `${viaUpdate.status} ${viaUpdate.message}`);
    await savedPdf('BUYER', draft._id);
    await call('BUYER', 'PATCH', `/procurement/purchase-orders/${draft._id}`, { leadTime: '9 days' });
    check('E10 any draft edit drops the stored PDF (no stale preview)', !(await poNow(draft._id)).poPdfUrl);
    const viaUpdateBlank = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${draft._id}`, { termsAndConditions: '' });
    check('E11 draft edit with blank terms → default', viaUpdateBlank.status === 200 && (await poNow(draft._id)).termsAndConditions === d.OTHER);
    const noTermsKey = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${draft._id}`, { leadTime: '10 days' });
    check('E12 a draft edit without the terms key leaves them alone', noTermsKey.status === 200 && (await poNow(draft._id)).termsAndConditions === d.OTHER);

    const { po: appr } = await newPo('BUYER', 'JSL', J);
    await approve(appr._id);
    const apprBefore = await poNow(appr._id);
    const eb = await setTerms('BUYER', appr._id, 'buyer change after approval');
    check('E13 approved PO: a non-MD is refused (403), unchanged', eb.status === 403 && eb.message === 'Only the MD can change the terms of an approved PO'
      && (await poNow(appr._id)).termsAndConditions === apprBefore.termsAndConditions, `${eb.status} ${eb.message}`);
    const em = await setTerms('MD', appr._id, 'MD change after approval — till 31st Jan 2028');
    const apprAfter = await poNow(appr._id);
    check('E14 approved PO: the MD can change the terms; still approved, same number', em.status === 200 && apprAfter.termsAndConditions === 'MD change after approval — till 31st Jan 2028'
      && frozen(apprAfter) === frozen(apprBefore), `${em.status} ${em.message}`);
    const apprPdf = await savedPdf('MD', appr._id);
    check('E15 approved PO PDF prints the MD\'s terms', apprPdf.text.flat.includes('31st Jan 2028'));
    await call('MD', 'POST', `/procurement/purchase-orders/${appr._id}/release`, { sendEmail: false });
    const releasedBefore = await poNow(appr._id);
    for (const who of ['MD', 'BUYER']) {
      const r = await setTerms(who, appr._id, 'after release');
      check(`E16 released PO: ${who} refused (400), terms + PDF unchanged`, r.status === 400 && /already released/.test(r.message)
        && (await poNow(appr._id)).termsAndConditions === releasedBefore.termsAndConditions && (await poNow(appr._id)).poPdfUrl === releasedBefore.poPdfUrl, `${r.status} ${r.message}`);
    }
    const { po: toCancel } = await newPo('BUYER', 'OTHER', O, { termsAndConditions: `Cancel me ${RUN}` });
    await ok('BUYER', 'POST', `/procurement/purchase-orders/${toCancel._id}/cancel`, { remarks: 'cancel reason' });
    const ec = await setTerms('MD', toCancel._id, 'x');
    check('E17 cancelled PO refused (400)', ec.status === 400 && /cancelled/.test(ec.message), `${ec.status} ${ec.message}`);
    const { po: toReject } = await newPo('BUYER', 'OTHER', O);
    await ok('MD', 'POST', `/procurement/purchase-orders/${toReject._id}/approve`, { decision: 'REJECTED', remarks: 'no' });
    const er = await setTerms('MD', toReject._id, 'x');
    check('E18 rejected PO refused (400)', er.status === 400, `${er.status} ${er.message}`);
    const missing = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${draft._id}/terms`, {});
    const tooBig = await setTerms('BUYER', draft._id, 'y'.repeat(PO_TERMS_MAX + 1));
    const badId = await setTerms('BUYER', 'not-an-id', 'x');
    const unknown = await setTerms('BUYER', new mongoose.Types.ObjectId().toString(), 'x');
    check('E19 validation: missing 422, too long 422, bad id 422, unknown PO 404',
      missing.status === 422 && tooBig.status === 422 && badId.status === 422 && unknown.status === 404,
      [missing.status, tooBig.status, badId.status, unknown.status].join());
    const anon = await call(null, 'PATCH', `/procurement/purchase-orders/${draft._id}/terms`, { termsAndConditions: 'x' });
    const anonDefaults = await call(null, 'GET', '/procurement/purchase-orders/terms-defaults');
    check('E20 no token → 401 (edit and defaults)', anon.status === 401 && anonDefaults.status === 401);

    // ── L: legacy POs (saved before the terms field) ──
    console.log('\nL  POs saved before the terms field');
    const legacy = async (remarks) => {
      const { po } = await newPo('BUYER', 'JSL', J);
      await makeLegacy(po._id, remarks);
      return po;
    };
    const legA = await legacy('Legacy remark terms — Price Protection Policy till 30th June 2026.');
    const legAPdf = await savedPdf('BUYER', legA._id);
    check('L1 a legacy PO keeps printing its Remarks as the terms', legAPdf.text.flat.includes('Legacy remark terms'));
    const legB = await legacy('');
    check('L2 a legacy PO without Remarks prints the current default', (await savedPdf('BUYER', legB._id)).text.flat.includes(flat(v3)));
    await approve(legA._id);
    await ok('MD', 'POST', `/procurement/purchase-orders/${legA._id}/release`, { sendEmail: false, remarks: `Legacy release note ${RUN}` });
    const legARel = await poNow(legA._id);
    const legARelText = pdfText(await pdfOf(legARel.poPdfUrl));
    check('L3 releasing a legacy PO pins the terms it printed before the release remark replaces Remarks',
      legARel.termsAndConditions === 'Legacy remark terms — Price Protection Policy till 30th June 2026.' && legARel.remarks === `Legacy release note ${RUN}`
      && legARelText.flat.includes('Legacy remark terms') && !legARelText.flat.includes('Legacy release note'), JSON.stringify({ t: legARel.termsAndConditions, r: legARel.remarks }));
    const legC = await legacy(`Legacy C terms ${RUN}`);
    await ok('BUYER', 'POST', `/procurement/purchase-orders/${legC._id}/cancel`, { remarks: 'legacy cancel reason' });
    const legCDb = await poNow(legC._id);
    check('L4 cancelling a legacy PO pins its terms too', legCDb.termsAndConditions === `Legacy C terms ${RUN}` && legCDb.remarks === 'legacy cancel reason');
    const legD = await legacy('');
    await approve(legD._id);
    await ok('MD', 'POST', '/procurement/purchase-orders/bulk-release', { poIds: [legD._id], sendEmail: false });
    check('L5 bulk-releasing a legacy PO pins the default it printed', (await poNow(legD._id)).termsAndConditions === v3);
    const legE = await legacy('Legacy E remark');
    const legEGet = await ok('BUYER', 'GET', `/procurement/purchase-orders/${legE._id}`);
    check('L6 GET of a legacy PO has no terms field (the UI shows Remarks, as printed)', legEGet.termsAndConditions === undefined && legEGet.remarks === 'Legacy E remark');
    const legEdit = await setTerms('BUYER', legE._id, 'Legacy E now has its own terms');
    check('L7 a legacy draft can be given its own terms', legEdit.status === 200 && (await savedPdf('BUYER', legE._id)).text.flat.includes('Legacy E now has its own terms'));

    // ── R: revise ──
    console.log('\nR  Revise a cancelled PO');
    const revBody = (src, extra = {}) => ({
      vendorId: O, poFormatType: 'OTHER', expectedDeliveryDate: due(),
      items: src.items.map((it) => ({ indentId: it.indentId, indentItemId: it.indentItemId, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId, quantity: it.quantity, unit: it.unit, rate: it.rate, gstRate: it.gstRate })),
      ...extra,
    });
    const cancelled = await poNow(toCancel._id);
    const rv = await call('BUYER', 'POST', `/procurement/purchase-orders/${toCancel._id}/revise`, revBody(cancelled, { termsAndConditions: cancelled.termsAndConditions }));
    check('R1 revising carries the cancelled PO\'s terms to the new draft', rv.status === 201 && (await poNow(rv.data?._id)).termsAndConditions === `Cancel me ${RUN}`, `${rv.status} ${rv.message}`);
  } finally {
    // Put the defaults back as they were before this run.
    await setDefault('poTermsJsl', before.JSL);
    await setDefault('poTermsOther', before.OTHER);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

// ── UI prep: POs in each state for the browser probe ───────────────────────
// Writes frontend/e2e/shots/po-terms-manifest.json (git-ignored).
const prepUi = async () => {
  await connect();
  await login();
  const [jindal, other] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  const J = String(jindal._id);
  const O = String(other._id);
  // Known defaults for the probe.
  await setDefault('poTermsJsl', BUILT_IN_PO_TERMS.JSL);
  await setDefault('poTermsOther', BUILT_IN_PO_TERMS.OTHER);
  const createInd = await readyIndent('UI create', J);
  const draftJsl = (await newPo('BUYER', 'JSL', J)).po;
  const draftOther = (await newPo('BUYER', 'OTHER', O)).po;
  const approved = (await newPo('BUYER', 'JSL', J)).po;
  await approve(approved._id);
  const released = (await newPo('BUYER', 'OTHER', O, { termsAndConditions: 'Released terms — final.' })).po;
  await approve(released._id);
  await ok('MD', 'POST', `/procurement/purchase-orders/${released._id}/release`, { sendEmail: false });
  const legacy = (await newPo('BUYER', 'JSL', J)).po;
  await makeLegacy(legacy._id, 'Legacy remark printed as terms');
  const manifest = {
    password: PASSWORD, users: { MD: USERS.MD.email, BUYER: USERS.BUYER.email },
    createItemRef: createInd.indentNumber.replace(/\/(?=[^/]*$)/, '.1/'),
    vendorJsl: jindal.name, vendorOther: other.name,
    pos: { draftJsl: draftJsl._id, draftOther: draftOther._id, approved: approved._id, released: released._id, legacy: legacy._id },
    defaults: BUILT_IN_PO_TERMS,
  };
  const { writeFile } = await import('node:fs/promises');
  const out = new URL('../../../frontend/e2e/shots/po-terms-manifest.json', import.meta.url);
  await writeFile(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] ${JSON.stringify(manifest.pos)} → ${out.pathname}`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  const run = mode === '--seed' ? seed : mode === '--api' ? api : mode === '--prep-ui' ? prepUi : null;
  if (!run) { console.error('usage: --seed | --api | --prep-ui'); process.exit(2); }
  run()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
