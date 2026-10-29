/**
 * Combined GRN + Incoming QC, driven through the real UI in Chromium.
 *
 *   node e2e/grnQc.e2e.mjs
 *
 * Expects (started separately, see backend/src/scripts/e2eGrnQcFixture.js):
 *   backend  :5099  via e2eServer.js against the ambika_e2e_grnqc scratch DB
 *   frontend :3100  with VITE_API_URL pointing at :5099
 *
 * New GRNs post NO stock when saved or completed: Incoming QC is completed and
 * only then is the ACCEPTED qty posted, to the module the SKU's Item Type
 * decides (no manual Inventory Type any more). The GRN's MD signature is
 * recorded on its own and never holds QC or stock posting back — the MD signs
 * afterwards here, from the GRN page's MD Approval card. LEGACY GRNs (completed
 * before that change) keep their own behaviour and are exercised separately.
 *
 * The browser performs every action; `e2eGrnQcFixture.js --verify` then reads
 * the database and is the real oracle. This file checks what the operator sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';
import {
  dialogTitled, signGrnFromCard, confirmCompleteGrn as confirmGrn, confirmCompleteQc,
} from './_grnLifecycle.mjs';

const findChromium = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const builds = fs.readdirSync(root)
    .filter((d) => d.startsWith('chromium-') && Number.isFinite(Number(d.split('-')[1])))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const b of builds) {
    const exe = path.join(root, b, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
};

const APP = 'http://127.0.0.1:3100';
const API = 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'grnQc.e2e.mjs');
const USER = { email: 'e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/grnqc';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];
const apiErrors = [];

const exe = findChromium();
const browser = await chromium.launch({ executablePath: exe });

const newPage = async (viewport) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
  });
  return page;
};

// See grnRm.e2e.mjs: the boot splash can outlive React's mount and swallow clicks.
const ready = async (page) => {
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForTimeout(150);
};
const go = async (page, url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(page); };
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});

const login = async (page) => {
  await go(page, APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
};

/** Read-only API call with the logged-in user's token. */
const api = (page, p) => page.evaluate(async ([base, url]) => {
  const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  return r.json();
}, [API, p]);
const stockOf = async (page, code) => ((await api(page, `/inventory/stock?limit=200&skuCode=${code}`)).data || [])
  .filter((r) => r.skuCode === code).reduce((s, r) => s + (r.qtyOnHand || 0), 0);

const openGrn = async (page, tag) => {
  await go(page, `${APP}/procurement/grns`);
  await page.getByText(`GRN-E2E-${tag}`, { exact: true }).first().click({ timeout: 15000 });
  await page.waitForSelector('#grn-qc-section', { timeout: 15000 });
  await page.waitForTimeout(800);
};

// `scope` = the page or the Create / Edit GRN dialog — the QC section is the same in both.
const section = (scope) => scope.locator('#grn-qc-section');
const qtyInput = (scope, field, item) => section(scope).getByLabel(`${field} — ${item}`, { exact: true });
const setQty = async (scope, item, accepted, rejected) => {
  await qtyInput(scope, 'Accepted', item).fill(String(accepted));
  await qtyInput(scope, 'Rejected', item).fill(String(rejected));
};
const sectionText = async (scope) => (await section(scope).innerText()).replace(/\s+/g, ' ');
const qcStatusText = async (scope) => ((await scope.getByTestId('grn-qc-status').first().innerText().catch(() => '')) || '').trim();
const nextText = async (scope) => ((await scope.getByTestId('grn-qc-next').first().innerText().catch(() => '')) || '').trim();
const completeBtn = (scope) => section(scope).getByRole('button', { name: 'Complete GRN + QC' });
const draftBtn = (scope) => section(scope).getByRole('button', { name: 'Save QC Draft' });
const saveDraftGrn = (form) => form.getByRole('button', { name: /^Save as Draft$/ });

/** The combined action on a completed GRN → confirm in the existing Complete QC dialog. */
const completeQc = async (page, scope = page, { doubleClick = false } = {}) => {
  await completeBtn(scope).click();
  await confirmCompleteQc(page, { doubleClick });
};
const confirmCompleteGrn = (page, opts) => confirmGrn(page, opts);

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const page = await newPage({ width: 1440, height: 950 });
await login(page);
check('login', true);

// ── Navigation: GRN and QC are ONE step ──────────────────────────────────────
console.log('\n── Navigation (one GRN & QC step) ──');
await go(page, `${APP}/purchase-fms/grn`);
// The first screen after a cold dev-server start compiles on demand — wait for it, don't guess a delay.
await page.getByText(/^GRN & QC/).first().waitFor({ timeout: 20000 }).catch(() => {});
check('hub stepper shows a single "GRN & QC" step', (await page.getByText(/^GRN & QC/).count()) >= 1);
check('hub stepper has no separate "Incoming QC" / "Goods Receipt (GRN)" step',
  (await page.getByText('Incoming QC', { exact: true }).count()) === 0 && (await page.getByText('Goods Receipt (GRN)').count()) === 0);
await go(page, `${APP}/purchase-fms/incoming-qc`);
await page.waitForTimeout(1500);
check('old /purchase-fms/incoming-qc redirects to the QC Records tab', page.url().endsWith('/purchase-fms/grn?view=qc'), page.url().replace(APP, ''));
check('QC Records has no standalone "New QC" button', (await page.getByRole('button', { name: 'New QC' }).count()) === 0);
const resumeRow = page.getByRole('row').filter({ hasText: 'QC-E2E-RESUME' });
await resumeRow.getByRole('button', { name: 'Actions' }).click();
await page.getByRole('menuitem', { name: 'View' }).click();
await page.waitForURL(/\/procurement\/incoming-qc\//); await ready(page);
// The detail page compiles on first visit after a cold dev-server start — wait for it.
await page.getByRole('button', { name: /Open GRN & QC/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
check('QC detail of a GRN draft offers "Open GRN & QC", not its own Complete QC',
  (await page.getByRole('button', { name: /Open GRN & QC/ }).count()) >= 1 && (await page.getByRole('button', { name: 'Complete QC' }).count()) === 0);

// ── The required journey, on the Create GRN form itself ──────────────────────
console.log('\n── Save GRN → Complete GRN → QC → stock (same form, no MD signature needed) ──');
await go(page, `${APP}/purchase-fms/grn?view=grn`);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /new grn/i }).first().click();
const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await form.waitFor();
check('before saving: "Save GRN first to enter QC details."', await form.getByText('Save GRN first to enter QC details.').isVisible());
check('…and no QC inputs yet', (await section(form).count()) === 0);
await shot(page, '10-create-form-before-save');

await form.getByRole('combobox', { name: /purchase order/i }).first().click();
await page.waitForTimeout(800);
await page.getByRole('option', { name: /PO-E2E-NEWGRN/ }).click();
await page.waitForTimeout(1500);
// The legacy GRNs the fixture seeds (DONE, HIST, LEGACY) already hold bolts at
// MAIN, posted at their completion — every stock check below is against that baseline.
const boltBase = await stockOf(page, 'E2E-BOLT');

check('no manual Inventory Type dropdown, no "Add to RM Stock" checkbox',
  (await form.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0 && (await form.getByText('Add to RM Stock').count()) === 0);
const tagsCp = (await form.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim());
check('the bolt line shows its destination from the SKU master: C&P IMS · MAIN', tagsCp.includes('→ C&P IMS · MAIN'), tagsCp.join(' | '));
check('Received At is not asked for (no Raw Material on this GRN)', (await form.getByRole('combobox', { name: /Received At/ }).count()) === 0);
await saveDraftGrn(form).click();
await page.waitForTimeout(3000);
const summary = form.getByTestId('grn-form-saved-summary');
const summaryText = (await summary.innerText().catch(() => '')).replace(/\s+/g, ' ');
check('1. Save as Draft keeps the user on the same form, with a GRN number', (await form.isVisible()) && /AGL\/GRN-\d+/.test(summaryText), summaryText);
check('…showing GRN status and QC status', /Draft/.test(summaryText) && /QC Pending/.test(summaryText));
check('…saving the draft posted NO stock', (await stockOf(page, 'E2E-BOLT')) === boltBase);
check('2. the actual QC form appears right after saving (inputs for the line)', await qtyInput(form, 'Rejected', 'E2E Bolt M8').isVisible());
check('…Save QC Draft waits for the GRN to be completed (existing rule)', await draftBtn(form).isDisabled());
check('…the next action is spelled out: Complete GRN', /^Next action: Complete GRN/.test(await nextText(form)), await nextText(form));
await setQty(form, 'E2E Bolt M8', 6, 2);
await shot(page, '11-create-form-qc-entered');

await completeBtn(form).click();
const cdlgCp = dialogTitled(page, /^Complete GRN/);
await cdlgCp.waitFor();
check('Complete GRN dialog: no Inventory Type; says stock is not usable yet',
  (await cdlgCp.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0 && /not usable yet/i.test(await cdlgCp.innerText()));
await confirmCompleteGrn(page);
check('5a. "Complete GRN + QC" first completes the GRN — form still open, QC open at once (no MD signature needed)',
  (await form.isVisible()) && /Fully Received/.test(await summary.innerText()) && (await qcStatusText(form)) === 'QC Pending' && !(await draftBtn(form).isDisabled()),
  await qcStatusText(form));
check('…completing the GRN posted NO stock', (await stockOf(page, 'E2E-BOLT')) === boltBase);
const cpGrnNo = (summaryText.match(/AGL\/GRN-\d+\/\d+-\d+/) || [''])[0];
const cpGrn = ((await api(page, `/procurement/grns?search=${encodeURIComponent(cpGrnNo)}`)).data || [])[0];
check('…but the line is recorded as received, awaiting QC', cpGrn?.items?.[0]?.stockStatus === 'AWAITING_QC' && cpGrn?.items?.[0]?.receivedQty === 8,
  `${cpGrn?.items?.[0]?.stockStatus} ${cpGrn?.items?.[0]?.receivedQty}`);
check('…GRN part is now read-only (no Save as Draft)', (await saveDraftGrn(form).count()) === 0);
check('…QC entries kept across the step (rejected 2)', (await qtyInput(form, 'Rejected', 'E2E Bolt M8').inputValue()) === '2');
check('5b. …next action: Complete QC — accepted quantities posted then', /^Next action: Complete QC — accepted quantities/.test(await nextText(form)), await nextText(form));
check('…the GRN\'s MD approval is raised and pending — recorded, not blocking', cpGrn?.approvalStatus === 'READY_FOR_MD_APPROVAL', cpGrn?.approvalStatus);
await shot(page, '12-create-form-grn-completed');

await draftBtn(form).click();
await page.waitForTimeout(2000);
check('3. QC saved as a draft on the server', (await qcStatusText(form)) === 'QC Draft');

await completeBtn(form).click();
const qdlg = dialogTitled(page, /^Complete QC/);
await qdlg.waitFor();
check('Complete QC dialog: accepted 6 posts now, rejected 2 will not enter stock',
  /Accepted 6 will be posted to stock now/.test(await qdlg.innerText()) && /Rejected 2 will not enter stock/.test(await qdlg.innerText()));
await qdlg.getByRole('button', { name: 'Complete QC' }).dblclick();
await qdlg.waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(2000);
const done = await sectionText(form);
check('5c/7. QC completed on the same form — result shown read-only with the GRN',
  /result\s*partial/i.test(done) && (await section(form).locator('input[type=number]').count()) === 0 && (await qcStatusText(form)) === 'QC Completed · Partial',
  (done.match(/result\s*\S+\s*\S+/i) || [''])[0]);
check('…only the ACCEPTED 6 became stock (double-click did not duplicate it)', (await stockOf(page, 'E2E-BOLT')) === boltBase + 6, `${await stockOf(page, 'E2E-BOLT')}`);
await shot(page, '13-create-form-qc-done');
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(1500);
check('closing opens the GRN page showing the same completed QC', (await qcStatusText(page)) === 'QC Completed · Partial', page.url().replace(APP, ''));
const cpBody = await page.locator('body').innerText();
check('the GRN page shows "Stock Posting" (no manual Inventory Type)', /Stock Posting/i.test(cpBody) && !/Inventory Type \(earlier GRN\)/i.test(cpBody));
const cpStock = (await page.getByTestId('grn-line-stock').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
check('…and the line: C&P IMS · MAIN, Posted 6, with its movement', cpStock.some((t) => /C&P IMS · MAIN Posted 6 MOV-/.test(t)), cpStock.join(' | '));
const cpAfterQc = ((await api(page, `/procurement/grns?search=${encodeURIComponent(cpGrnNo)}`)).data || [])[0];
check('…stock was posted while the GRN was still awaiting the MD', cpAfterQc?.approvalStatus === 'READY_FOR_MD_APPROVAL', cpAfterQc?.approvalStatus);
await signGrnFromCard(page);
const cpSigned = ((await api(page, `/procurement/grns?search=${encodeURIComponent(cpGrnNo)}`)).data || [])[0];
check('5d. the MD signs afterwards from the GRN page — QC result and stock unchanged', cpSigned?.approvalStatus === 'MD_APPROVED'
  && (await qcStatusText(page)) === 'QC Completed · Partial' && (await stockOf(page, 'E2E-BOLT')) === boltBase + 6, cpSigned?.approvalStatus);

// ── Raw Material through the form: Received At asked for automatically ──────
console.log('\n── Raw Material through the form → RM IMS (after QC) ──');
await go(page, `${APP}/purchase-fms/grn?view=grn`);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /new grn/i }).first().click();
const rmForm = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await rmForm.waitFor();
await rmForm.getByRole('combobox', { name: /purchase order/i }).first().click();
await page.waitForTimeout(800);
await page.getByRole('option', { name: /PO-E2E-NEWRM/ }).click();
await page.waitForTimeout(1500);
const recvAt = rmForm.getByRole('combobox', { name: /Received At/ });
check('a coil line makes Received At appear by itself — not pre-filled', (await recvAt.count()) === 1 && !/PLG01|JW001/.test(await recvAt.innerText()));
await rmForm.getByLabel(/^Batch No/).fill('B-FORM-RM-1');
await saveDraftGrn(rmForm).click();
check('saving Raw Material without Received At is refused', await page.getByText(/Select Received At/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
await recvAt.click();
await page.getByRole('option', { name: /JW001/ }).click();
await page.waitForTimeout(300);
check('the coil line reads → RM IMS · JW001', (await rmForm.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim()).includes('→ RM IMS · JW001'));
await saveDraftGrn(rmForm).click();
await page.waitForTimeout(3000);
const rmSummary = (await rmForm.getByTestId('grn-form-saved-summary').innerText().catch(() => '')).replace(/\s+/g, ' ');
const rmGrnNo = (rmSummary.match(/AGL\/GRN-\d+\/\d+-\d+/) || [''])[0];
check('RM GRN saved from the form', Boolean(rmGrnNo), rmSummary);
await completeBtn(rmForm).click();
const cdlgRm = dialogTitled(page, /^Complete GRN/);
await cdlgRm.waitFor();
check('Complete GRN dialog carries Received At JW001 and lists RM IMS: 1',
  /JW001/.test(await cdlgRm.getByRole('combobox', { name: /Received At/ }).innerText()) && /RM IMS: 1/.test(await cdlgRm.getByTestId('grn-complete-destinations').innerText()));
await cdlgRm.getByRole('button', { name: /^Complete GRN$/ }).dblclick();
await cdlgRm.waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(2000);
// No coil anywhere yet: RMPLG is completed later on, and the legacy RMOFF coil was never stocked.
check('RM GRN completed — QC open at once (no MD signature), no coil stock yet', (await qcStatusText(rmForm)) === 'QC Pending' && (await stockOf(page, 'E2E-COIL')) === 0,
  `${await qcStatusText(rmForm)} · coil stock ${await stockOf(page, 'E2E-COIL')}`);
await setQty(rmForm, 'E2E Coil 1250mm', 45, 5);
await completeQc(page, rmForm, { doubleClick: true });
check('RM QC completed — accepted 45 of the coil now in stock', (await qcStatusText(rmForm)) === 'QC Completed · Partial');
await rmForm.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(1500);
const rmPage = await page.locator('body').innerText();
check('GRN page: Received At JW001, line RM IMS · JW001 Posted 45', /Received At\s*JW001/i.test(rmPage)
  && (await page.getByTestId('grn-line-stock').allInnerTexts()).some((t) => /RM IMS · JW001\s*Posted 45/.test(t)));

// The stock is in the module — on its own screens, nobody re-enters it.
await go(page, `${APP}/rm-ims/movements`);
await page.waitForTimeout(2500);
const rmLedger = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check('RM IMS ledger lists the RM GRN receipt', rmLedger.includes(rmGrnNo), rmGrnNo);
check('…and does not list the Consumable & Packaging GRN', !rmLedger.includes(cpGrnNo), cpGrnNo);
await go(page, `${APP}/rm-ims/stock`);
await page.waitForTimeout(2500);
check('RM IMS stock list shows the coil', (await page.getByText('E2E Coil 1250mm').count()) > 0);
await shot(page, '15-rm-ims-stock');
await go(page, `${APP}/ims/movements`);
await page.waitForTimeout(2500);
const cpLedger = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check('Consumable & Packaging IMS ledger lists the C&P GRN receipt', cpLedger.includes(cpGrnNo), cpGrnNo);
check('…and does not list the RM GRN', !cpLedger.includes(rmGrnNo));
await shot(page, '16-cp-ims-movements');

// Reopening a draft: no type to choose, destinations come from the SKU master.
await openGrn(page, 'DRAFT');
await page.getByRole('button', { name: 'Edit' }).first().click();
const editForm = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await editForm.waitFor();
await page.waitForTimeout(1200);
check('reopening a draft: no Inventory Type, each line shows its destination',
  (await editForm.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0
  && (await editForm.getByTestId('grn-line-destination').allInnerTexts()).every((t) => /C&P IMS · MAIN/.test(t)));
await editForm.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(800);

// ── Prerequisites on the GRN page ────────────────────────────────────────────
console.log('\n── Prerequisites on the GRN page ──');
await openGrn(page, 'DRAFT');
check('draft GRN: QC form is shown and editable', (await section(page).locator('input[type=number]').count()) > 0);
check('…Save QC Draft disabled until the GRN is completed, Complete GRN + QC offered', (await draftBtn(page).isDisabled()) && !(await completeBtn(page).isDisabled()));
await setQty(page, 'E2E Nut M8', 1, 4);
await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
await page.waitForSelector('#grn-qc-section'); await page.waitForTimeout(1000);
check('…entries typed before the QC can be saved are kept on this device (reload)', (await qtyInput(page, 'Rejected', 'E2E Nut M8').inputValue()) === '4');
await shot(page, '01-draft-grn-qc-form');

await openGrn(page, 'UNSIGNED');
check('completed, unsigned: QC open ("QC Pending"), next = Complete QC — the MD signature is not awaited', (await qcStatusText(page)) === 'QC Pending'
  && /^Next action: Complete QC/.test(await nextText(page)) && !(await draftBtn(page).isDisabled()), await nextText(page));
const unsignedStock = (await page.getByTestId('grn-line-stock').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
check('…its lines read "Awaiting QC" — nothing usable before the QC', unsignedStock.length === 2 && unsignedStock.every((t) => /Awaiting QC/.test(t)), unsignedStock.join(' | '));
await openGrn(page, 'NOREQ');
check('no MD approval raised at all: QC is still open — Complete GRN + QC enabled', (await qcStatusText(page)) === 'QC Pending' && !(await completeBtn(page).isDisabled()),
  await qcStatusText(page));

// ── Full journey on the GRN page (existing GRN) ──────────────────────────────
console.log('\n── Existing GRN page (GRN-E2E-FLOW) ──');
await openGrn(page, 'FLOW');
await completeBtn(page).click();
await confirmCompleteGrn(page);
check('stage after completion: QC Pending, form open — no MD signature step', (await qcStatusText(page)) === 'QC Pending', await qcStatusText(page));
// The simplified table: Item · SKU · Received · Accepted · Rejected · Remark.
const headers = [];
for (const h of ['Item', 'SKU', 'Received', 'Accepted', 'Rejected', 'Remark', 'Rework', 'Remaining', 'Defect', 'Severity']) {
  headers.push([h, await section(page).getByText(h, { exact: true }).count()]);
}
const shown = headers.filter(([, n]) => n > 0).map(([h]) => h);
check('table columns are exactly Item · SKU · Received · Accepted · Rejected · Remark',
  shown.join(',') === 'Item,SKU,Received,Accepted,Rejected,Remark', shown.join(','));
check('Received is read-only (no input), Accepted / Rejected are inputs',
  (await section(page).getByLabel('Received — E2E Bolt M8').count()) === 0 && await qtyInput(page, 'Accepted', 'E2E Bolt M8').isEditable());
await setQty(page, 'E2E Bolt M8', 6, 3);
const mismatch = (await section(page).getByTestId('qc-balance').innerText().catch(() => '')).replace(/\s+/g, ' ');
check('mismatch message: "Accepted + Rejected must equal Received … (6 + 3 ≠ 10)"', /Accepted \+ Rejected must equal Received for: E2E Bolt M8 \(6 \+ 3 ≠ 10\)/.test(mismatch), mismatch);
await completeBtn(page).click();
await page.waitForTimeout(600);
check('unbalanced (uninspected 1): Complete GRN + QC refused (no confirm dialog)', (await page.getByRole('dialog').count()) === 0);
await setQty(page, 'E2E Bolt M8', 7, 3);
check('balanced: mismatch message gone', (await section(page).getByTestId('qc-balance').count()) === 0);
// Optional per-line remark + the existing QC report / photo attachment.
await section(page).getByLabel('Remark — E2E Bolt M8').fill('Seal damaged on 3');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await section(page).getByTestId('qc-attachment-input').setInputFiles({ name: 'qc-photo.png', mimeType: 'image/png', buffer: PNG });
await section(page).getByTestId('qc-attachment').waitFor({ timeout: 15000 });
check('attachment uploaded through the existing upload (qc-photo.png)', (await section(page).getByTestId('qc-attachment').innerText()).includes('qc-photo.png'));
await draftBtn(page).click();
await page.waitForTimeout(1500);
await draftBtn(page).click(); // a second save updates, never creates another
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
await page.waitForSelector('#grn-qc-section'); await page.waitForTimeout(1200);
check('4. after reload the draft is resumed (QC Draft, rejected 3)', (await qcStatusText(page)) === 'QC Draft'
  && (await qtyInput(page, 'Rejected', 'E2E Bolt M8').inputValue()) === '3');
check('…remark and attachment resumed with it', (await section(page).getByLabel('Remark — E2E Bolt M8').inputValue()) === 'Seal damaged on 3'
  && (await section(page).getByTestId('qc-attachment').innerText()).includes('qc-photo.png'));
await completeQc(page, page, { doubleClick: true });
check('7. completed QC read-only (Partial)', (await qcStatusText(page)) === 'QC Completed · Partial' && (await section(page).locator('input[type=number]').count()) === 0);
check('next step points to the Vendor Invoice', await page.getByText('QC complete — next: record the Vendor Invoice').isVisible());
check('completed view shows the remark and attachment read-only', (await sectionText(page)).includes('Seal damaged on 3')
  && (await section(page).getByTestId('qc-attachment').innerText()).includes('qc-photo.png'));
await shot(page, '05-flow-qc-done');
const flowGrnId = page.url().split('/procurement/grns/')[1]?.split(/[?#]/)[0];
check('FLOW: QC completed and stock posted while the GRN awaits the MD', (await api(page, `/procurement/grns/${flowGrnId}`)).data?.approvalStatus === 'READY_FOR_MD_APPROVAL');
await signGrnFromCard(page);
check('FLOW: the MD signs afterwards — QC result unchanged', (await api(page, `/procurement/grns/${flowGrnId}`)).data?.approvalStatus === 'MD_APPROVED'
  && (await qcStatusText(page)) === 'QC Completed · Partial');
await section(page).getByRole('button', { name: 'View full QC record' }).click();
await page.waitForURL(/\/procurement\/incoming-qc\//); await ready(page); await page.waitForTimeout(1200);
const fullFlow = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const lineMov = (await page.getByTestId('qc-line-movement').allInnerTexts()).map((t) => t.trim());
check('full QC record: remark, attachment, timeline, and the accepted stock-IN movement per line',
  fullFlow.includes('Seal damaged on 3') && fullFlow.includes('qc-photo.png') && /Timeline/i.test(fullFlow) && lineMov.length === 2 && lineMov.every((t) => /^IN MOV-/.test(t)),
  lineMov.join(' | '));
await shot(page, '05c-flow-full-record');

// ── Records written by the earlier form (rework / defect / severity) ────────
console.log('\n── Historical rework / defect records ──');
await openGrn(page, 'REWORK');
const legacyNote = await section(page).getByTestId('qc-line-legacy').first().innerText().catch(() => '');
check('draft with earlier rework: shown, not dropped — "rework 2 — enter it as Accepted or Rejected"', /rework 2 — enter it as Accepted or Rejected/.test(legacyNote), legacyNote);
await completeBtn(page).click();
await page.waitForTimeout(600);
check('…cannot complete until re-split (6 + 2 ≠ 10 shown, no confirm dialog)', (await page.getByRole('dialog').count()) === 0
  && /6 \+ 2 ≠ 10/.test(await section(page).getByTestId('qc-balance').innerText()));
await setQty(page, 'E2E Bolt M8', 6, 4);
await section(page).getByLabel('Remark — E2E Bolt M8').fill('Rework not possible');
await completeQc(page);
check('…re-split to Accepted 6 / Rejected 4 and completed', (await qcStatusText(page)) === 'QC Completed · Partial');
await section(page).getByRole('button', { name: 'View full QC record' }).click();
await page.waitForURL(/\/procurement\/incoming-qc\//); await ready(page); await page.waitForTimeout(1200);
const fullRework = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check('…full record keeps the earlier defect "scratch" / MAJOR and the new remark', fullRework.includes('scratch') && fullRework.includes('MAJOR') && fullRework.includes('Rework not possible'));

await openGrn(page, 'HIST');
const histNote = await section(page).getByTestId('qc-line-legacy').first().innerText().catch(() => '');
check('completed historical QC: read-only, earlier rework / defect still shown', /Also recorded: rework 3 · defect: dent \(MINOR\)/.test(histNote)
  && (await sectionText(page)).includes('rework 3'), histNote);
await section(page).getByRole('button', { name: 'View full QC record' }).click();
await page.waitForURL(/\/procurement\/incoming-qc\//); await ready(page); await page.waitForTimeout(1200);
const fullHist = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check('…full record lists Rework 3, defect "dent", severity MINOR', /Rework \(earlier form\)\s*3/i.test(fullHist) && fullHist.includes('dent') && fullHist.includes('MINOR'));
await shot(page, '06b-hist-full-record');

// ── Raw Material on the GRN page (DB asserted by --verify) ───────────────────
console.log('\n── Raw Material GRNs ──');
await openGrn(page, 'RMPLG');
await setQty(page, 'E2E Coil 1250mm', 400, 100);
await completeBtn(page).click();
check('RMPLG: Complete GRN dialog carries Received At PLG01 (saved on the draft)',
  /PLG01/.test(await dialogTitled(page, /^Complete GRN/).getByRole('combobox', { name: /Received At/ }).innerText()));
await confirmCompleteGrn(page);
await completeQc(page);
check('RMPLG: coil GRN completed and QC\'d on one page — no signature step', (await qcStatusText(page)) === 'QC Completed · Partial');

// ── LEGACY GRNs: completed before QC-gated posting ───────────────────────────
console.log('\n── Legacy GRNs (stock posted at completion) ──');
await openGrn(page, 'RMOFF');
check('RMOFF (earlier GRN): its old "Add to RM Stock: No" is shown as recorded, not reinterpreted',
  /Inventory Type \(earlier GRN\)[\s\S]*Add to RM Stock: No/i.test(await page.locator('body').innerText()));
await setQty(page, 'E2E Coil 1250mm', 400, 200);
await completeQc(page);
check('RMOFF: QC completes on the earlier GRN', (await qcStatusText(page)) === 'QC Completed · Partial');
await openGrn(page, 'LEGACY');
check('LEGACY: next action explains the earlier GRN already holds its stock', /already added its stock, so rejected quantities move out/.test(await nextText(page)), await nextText(page));
await setQty(page, 'E2E Bolt M8', 8, 2);
await completeBtn(page).click();
const ldlg = dialogTitled(page, /^Complete QC/);
await ldlg.waitFor();
check('LEGACY: QC dialog says the rejected 2 move OUT of stock (QC_REJECT_OUT)', /Rejected 2 will be moved OUT of stock/.test(await ldlg.innerText()));
await ldlg.getByRole('button', { name: 'Complete QC' }).click();
await ldlg.waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(1500);
check('LEGACY: QC completed', (await qcStatusText(page)) === 'QC Completed · Partial');

// ── 8. Existing / historical GRNs ────────────────────────────────────────────
console.log('\n── Existing & historical GRNs ──');
await openGrn(page, 'READYFAIL');
await setQty(page, 'E2E Bolt M8', 0, 10);
await setQty(page, 'E2E Nut M8', 0, 5);
check('all-rejected → expected result FAIL shown', /expected result\s*fail/i.test(await sectionText(page)));
await completeQc(page);
check('READYFAIL completed → QC Completed · Failed', (await qcStatusText(page)) === 'QC Completed · Failed');
const failStock = (await page.getByTestId('grn-line-stock').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
check('…every line "Not posted" — nothing rejected became stock', failStock.length === 2 && failStock.every((t) => /Not posted/.test(t)), failStock.join(' | '));
await openGrn(page, 'RESUME');
check('seeded historical draft resumed (QC Draft, rejected 2)', (await qcStatusText(page)) === 'QC Draft'
  && (await qtyInput(page, 'Rejected', 'E2E Bolt M8').inputValue()) === '2');
await completeQc(page);
await openGrn(page, 'DONE');
check('historical completed QC read-only (QC Completed · Passed)', (await qcStatusText(page)) === 'QC Completed · Passed'
  && (await completeBtn(page).count()) === 0);
await go(page, `${APP}/purchase-fms/grn?view=qc`);
await page.waitForTimeout(1500);
check('QC Records tab still lists historical QCs', await page.getByText('QC-E2E-DONE').first().isVisible());

// ── Phone width ──────────────────────────────────────────────────────────────
console.log('\n── Phone width (390px) ──');
const m = await newPage({ width: 390, height: 844 });
await login(m);
await openGrn(m, 'READYPASS');
check('phone: QC inputs visible and labelled', await qtyInput(m, 'Accepted', 'E2E Bolt M8').isVisible());
check('phone: no horizontal page scroll', await noHorizontalScroll(m));
await shot(m, '07-phone-qc-open');
await completeQc(m);
check('phone: QC completed (Passed)', (await qcStatusText(m)) === 'QC Completed · Passed');

await browser.close();

const benignApi = apiErrors.filter((e) => !/^40[14] GET \/(auth\/me|notifications|approvals)/.test(e));
check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`  INFO  API errors seen: ${benignApi.length ? benignApi.join(' | ') : 'none'}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
