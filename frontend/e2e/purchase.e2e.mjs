/**
 * PURCHASE through the real screens — and a two-browser GRN race.
 *
 *   node e2e/purchase.e2e.mjs
 *
 * Order: backend/src/scripts/e2ePurchaseFixture.js --seed, start the guarded
 * backend (e2eServer.js) + Vite, run this, then e2ePurchaseFixture.js --verify.
 *
 * Branches, each from a fresh indent to a GRN-eligible PO:
 *   A  quotation NOT required · PI not required        (500 kg)
 *   B  vendor quotation uploaded (Step 1.2 "Yes") → Step 1.3 approved · PI not required  (400 kg)
 *   C  quotation not required · PI → PI approved → MD approves the advance → full advance payment  (300 kg)
 * Then: one GRN on A's PO, completed from TWO browser contexts at the same moment
 * (no stock yet — the receipt waits for QC), then QC'd (the MD signs it afterwards): only then
 * does the accepted coil become stock, exactly once.
 *
 * Expects: backend :5099 (ambika_e2e_purchase, via e2eServer.js), frontend :3100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';
import { completeQc, signAsMd, signGrnFromCard } from './_grnLifecycle.mjs';

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
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, API, 'purchase.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SUPPLIER = 'E2E UI Coil Supplier';
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const DOC = path.resolve(SHOTS, 'e2e-quotation.pdf');
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(DOC, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
};
const section = (s) => console.log(`\n── ${s} ──`);
const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];

const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`; };

const login = async (browser, tag) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${tag} ${page.url().replace(APP, '')} :: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${tag} ${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${tag} ${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForLoadState('load').catch(() => {});
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 90000 });
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  return { ctx, page };
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const { page } = await login(browser, 'A');
  check('login', true);

  let current = '/';
  const go = async (u) => { current = u; await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#root > *'); await page.evaluate(() => document.getElementById('initial-boot')?.remove()); };
  const body = async () => flat(await page.locator('body').innerText());
  const waitText = async (rx, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (rx.test(await body())) return true; await page.waitForTimeout(300); } return false; };
  const toast = (rx, ms = 20000) => page.getByText(rx).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const shot = (n) => page.screenshot({ path: `${SHOTS}/purchase-${n}.png`, fullPage: true }).catch(() => {});
  const apiGet = (p) => page.evaluate(async ({ api, q }) => fetch(`${api}${q}`, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } }).then((r) => r.json()).catch(() => null), { api: API, q: p });
  const dialog = () => page.getByRole('dialog').last();
  /** Re-open the current detail page, as a user would between steps, so the
   *  next action is taken on the settled page rather than mid re-render. */
  // Back to the page the test last opened — dialogs may navigate elsewhere on success.
  const fresh = async () => { await page.waitForTimeout(600); await go(current); await page.waitForTimeout(1500); };
  // Detail pages repeat an action in several places (hero, next step, menus); take a VISIBLE one.
  const btn = (name) => page.getByRole('button', { name }).filter({ visible: true }).first();
  /**
   * Set a DD/MM/YYYY date field to today. Fields with `openOnClick` open the
   * MUI calendar on click — then pick today's day there, as an operator does;
   * otherwise type the date into the sectioned input.
   */
  const typeDate = async (labelRx, scope = dialog()) => {
    const f = scope.getByLabel(labelRx).first();
    await f.click();
    await page.waitForTimeout(500);
    const todayCell = page.locator('.MuiPickersDay-today').first();
    if (await todayCell.isVisible().catch(() => false)) {
      await todayCell.click();
    } else {
      await page.keyboard.press('Home');
      await page.keyboard.type(today(), { delay: 30 });
    }
    await page.waitForTimeout(400);
  };

  const buy = async ({ key, qty, quote, pi }) => {
    section(`Branch ${key}: indent ${qty} kg · quotation ${quote} · ${pi ? 'PI + advance payment' : 'PI not required'}`);
    /* indent */
    await go('/procurement/indents');
    await waitText(/Purchase Indents/);
    await btn(/^Create Indent$/).click();
    await page.waitForTimeout(800);
    let d = dialog();
    await d.getByLabel(/Raised By/).first().fill('E2E Tester');
    const prod = d.getByPlaceholder('Product name').first();
    await prod.click();
    await prod.fill('Cu 0.70'); // options are labelled by product NAME
    await page.waitForTimeout(1200);
    await page.getByRole('option').filter({ hasText: /JSL204-07|Cu 0\.70/ }).first().click();
    await page.waitForTimeout(300);
    await d.locator('input[type="number"][placeholder="0"]').first().fill(String(qty));
    await d.getByRole('button', { name: /^Create Indent$/ }).click();
    check(`${key}: indent created`, await toast(/Indent created/));
    const indent = ((await apiGet('/procurement/indents?limit=20&sort=-createdAt'))?.data || [])[0];
    check(`${key}: …${indent?.indentNumber} is DRAFT for JSL204-07 × ${qty}`, indent?.approvalStatus === 'DRAFT' && indent?.items?.[0]?.skuCode === 'JSL204-07' && indent?.items?.[0]?.quantity === qty,
      `${indent?.approvalStatus} ${indent?.items?.[0]?.skuCode} ${indent?.items?.[0]?.quantity}`);
    await go(`/procurement/indents/${indent._id}`);
    await waitText(new RegExp(indent.indentNumber.replace(/[/.]/g, '.')));
    await btn(/^Submit$|^Submit for Approval$/).click();
    check(`${key}: submitted for approval`, await toast(/submitted for approval/i));
    await fresh();
    await btn(/^Approve \/ Reject$/).click();
    await page.waitForTimeout(600);
    await dialog().getByRole('button', { name: /^Submit Decisions?$/ }).click();
    check(`${key}: indent approved`, await toast(/Indent approved/));
    await fresh();

    /* quotation */
    await btn(/^Receive Quote \/ Comparative$/).click();
    await page.waitForTimeout(800);
    d = dialog();
    if (quote === 'NOT REQUIRED') {
      const sel = d.getByRole('combobox').filter({ hasText: /^Yes$/ }).first();
      await sel.click();
      await page.getByRole('option', { name: 'Quote Not Required' }).click();
      await page.waitForTimeout(300);
    } else {
      await d.locator('input[type="file"]').first().setInputFiles(DOC);
      check(`${key}: the vendor quotation file uploads`, await waitText(/e2e-quotation\.pdf|Add file/i, 15000));
    }
    await d.getByRole('button', { name: /^Submit$/ }).click();
    check(`${key}: Step 1.2 recorded (${quote})`, await toast(/Quote & comparative recorded/));
    await fresh();
    if (quote === 'NOT REQUIRED') {
      check(`${key}: Step 1.3 skipped — indent shows "Quote Not Required" / "PO Ready"`, await waitText(/Quote Not Required/) && /PO Ready/.test(await body()));
    } else {
      check(`${key}: indent shows "Quote Received"`, await waitText(/Quote Received/));
      await btn(/^Approved Quotation 1\.03$/).click();
      await page.waitForTimeout(800);
      await dialog().getByRole('button', { name: /^Submit$/ }).click();
      check(`${key}: Step 1.3 quotation approved`, await toast(/Quotation approval recorded/));
      await fresh();
    }

    /* PO */
    await btn(/^Create Vendor PO$/).click();
    await page.waitForTimeout(2500);
    d = dialog();
    const vendorVal = await d.getByLabel(/Vendor \*/).first().inputValue().catch(() => '');
    check(`${key}: PO form preselects the approved item and the only supplier for this SKU`, vendorVal.includes(SUPPLIER), vendorVal);
    // Expected Delivery Date became mandatory on the PO form (79e4f4f); this
    // spec never filled it, so it stopped at this step even at HEAD 3310fe7.
    await typeDate(/Expected Delivery/, d);
    await shot(`${key}-po-form`);
    await d.getByRole('button', { name: /^Save as Draft$/ }).click();
    check(`${key}: PO saved as draft`, await toast(/saved as draft/i));
    const po0 = ((await apiGet('/procurement/purchase-orders?limit=20&sort=-createdAt'))?.data || [])[0];
    await go(`/procurement/purchase-orders/${po0._id}`);
    await waitText(/Approve \/ Reject/);
    await btn(/^Approve \/ Reject$/).click();
    await page.waitForTimeout(600);
    await dialog().getByRole('button', { name: /^Approve$/ }).click();
    check(`${key}: PO approved (PO number issued)`, await toast(/PO approved/));
    await fresh();
    await btn(/^Release to Supplier$/).click();
    await page.waitForTimeout(600);
    await dialog().getByRole('button', { name: /^Confirm Release$/ }).click();
    check(`${key}: PO released to the supplier`, await toast(/PO released/));
    await fresh();
    let po = (await apiGet(`/procurement/purchase-orders/${po0._id}`))?.data;
    check(`${key}: ${po?.poNumber} — supplier, SKU, qty, Released to Vendor`, po?.vendorName === SUPPLIER && po?.items?.[0]?.skuCode === 'JSL204-07' && po?.items?.[0]?.quantity === qty && po?.poStatus === 'RELEASED_TO_VENDOR',
      `${po?.vendorName} ${po?.items?.[0]?.quantity} ${po?.poStatus}`);

    /* PI */
    if (!pi) {
      await btn(/^Mark PI Not Required$/).click();
      await page.waitForTimeout(600);
      await dialog().getByLabel(/Reason/).first().fill('E2E: supplier issues no PI');
      await dialog().getByRole('button', { name: /^Confirm$/ }).click();
      check(`${key}: PI marked Not Required`, await toast(/PI marked as Not Required/));
      await fresh();
    } else {
      await btn(/^Create PI$/).click();
      await page.waitForTimeout(800);
      await dialog().locator('input[type="file"]').first().setInputFiles(DOC);
      check(`${key}: the PI document uploads`, await toast(/PI document uploaded/));
      await dialog().getByRole('button', { name: /^Create PI$/ }).click();
      check(`${key}: PI created`, await toast(/PI .* created/));
      await fresh();
      await btn(/^Approve PI$/).click();
      await page.waitForTimeout(600);
      await dialog().getByRole('button', { name: /^Approve$/ }).click();
      check(`${key}: PI approved — ready for advance payment`, await toast(/PI approved/));
      const piDoc = ((await apiGet('/procurement/proforma-invoices?limit=10&sort=-createdAt'))?.data || [])[0];
      await go(`/procurement/proforma-invoices/${piDoc._id}`);
      await waitText(/Record Advance Payment/);
      // Advance payment is the one step that waits for the MD.
      check(`${key}: PI approval raised its MD approval — the advance waits for it`, piDoc.mdApprovalStatus === 'READY_FOR_MD_APPROVAL'
        && await waitText(/advance payment waits for MD approval/), piDoc.mdApprovalStatus);
      await btn(/^Record Advance Payment$/).click();
      await page.waitForTimeout(700);
      check(`${key}: …the payment dialog refuses it until the MD approves (Record Payment disabled)`,
        /until the MD approves this Proforma Invoice/.test(await dialog().innerText()) && await dialog().getByRole('button', { name: /^Record Payment$/ }).isDisabled());
      await dialog().getByRole('button', { name: /^Cancel$/ }).click();
      await page.waitForTimeout(500);
      await page.locator('#pi-md-approval').getByRole('button', { name: 'Sign Document' }).click();
      await signAsMd(page);
      const piSigned = (await apiGet(`/procurement/proforma-invoices/${piDoc._id}`))?.data;
      check(`${key}: the MD approves the PI from its MD Approval card`, piSigned?.mdApprovalStatus === 'MD_APPROVED', piSigned?.mdApprovalStatus);
      await fresh();
      await btn(/^Record Advance Payment$/).click();
      await page.waitForTimeout(700);
      await dialog().getByLabel(/Payment Status/).first().click();
      await page.getByRole('option', { name: 'Full Payment' }).click();
      await page.waitForTimeout(300);
      await dialog().getByLabel(/Reference Number/).first().fill('E2E-UTR-UI-001');
      await dialog().getByRole('button', { name: /^Record Payment$/ }).click();
      check(`${key}: full advance payment recorded`, await toast(/Payment .* recorded/));
      await go(`/procurement/purchase-orders/${po0._id}`);
      await waitText(/Payment Completed/);
      await fresh();
    }
    po = (await apiGet(`/procurement/purchase-orders/${po0._id}`))?.data;
    check(`${key}: PO PI status = ${pi ? 'Payment Completed' : 'PI Not Required'}`, po?.piStatus === (pi ? 'PAYMENT_COMPLETED' : 'PI_NOT_REQUIRED'), po?.piStatus);

    /* follow-up → ready for GRN */
    // With the PO's (now mandatory) Expected Delivery Date, "Update Follow-up"
    // creates the follow-up itself and opens its done dialog; the separate
    // "Create Follow-up" form is only for legacy POs without that date.
    await btn(/^Update Follow-up$/).click();
    await page.waitForTimeout(700);
    // The outcome dropdown decides which date the form asks for. The select is
    // also labelled by its value, so the date field is matched with its " *".
    await dialog().getByLabel(/^Follow-up Outcome/).first().click();
    await page.getByRole('option', { name: 'Final Date of Material' }).click();
    await page.waitForTimeout(300);
    await typeDate(/^Final Date of Material \*/);
    await shot(`${key}-followup-done`);
    await dialog().getByRole('button', { name: /Confirm & Ready for GRN/ }).click();
    check(`${key}: final material date confirmed → ready for GRN`, await toast(/ready for GRN/i));
    await page.waitForTimeout(1200);
    po = (await apiGet(`/procurement/purchase-orders/${po0._id}`))?.data;
    check(`${key}: PO READY_FOR_GRN with a final material date`, po?.followUpStatus === 'READY_FOR_GRN' && !!po?.finalMaterialDate, po?.followUpStatus);
    check(`${key}: the PO page now offers "Create GRN"`, (await page.getByRole('button', { name: /^Create GRN$/ }).count()) > 0);
    const mv = await apiGet('/rm-ims/received-coils?q=JSL204-07&includeConsumed=true&limit=50');
    check(`${key}: still NO stock — a PO never creates stock before its GRN`, (mv?.data || []).length === 0, `${(mv?.data || []).length} receipts`);
    await shot(`${key}-ready-for-grn`);
    return po;
  };

  /* ── Indent quick-add: the new SKU's Item Type must be chosen ── */
  // It decides where purchased stock is posted (RM IMS / C&P IMS / main store),
  // so nothing is pre-selected. Done in a throwaway indent drawer (cancelled) so
  // the indents the branches below raise are untouched.
  section('Indent quick-add SKU — Item Type is an explicit choice');
  await go('/procurement/indents');
  await waitText(/Purchase Indents/);
  await btn(/^Create Indent$/).click();
  await page.waitForTimeout(800);
  await dialog().getByRole('button', { name: /^New Product$/ }).click();
  const qa = page.getByRole('dialog').filter({ hasText: 'Add New Product' });
  await qa.waitFor({ timeout: 10000 });
  const typeBox = qa.getByRole('combobox', { name: /Item Type/ });
  check('quick-add: no Item Type is pre-selected (was Raw Material)', !/Raw Material|Consumable|Packing/.test(await typeBox.innerText()), await typeBox.innerText());
  check('quick-add: the field says why it is required', /decides which inventory module/i.test(await qa.innerText()));
  await qa.getByLabel(/Product Name/).fill('E2E UI Polishing Buff');
  await qa.getByLabel(/SKU Code/).fill('E2E-UI-NEWPROD');
  await qa.getByRole('button', { name: /^Add Product$/ }).click();
  check('quick-add: saving without an Item Type is refused', await toast(/Select the Item Type/, 6000));
  check('…and no SKU was created', !((await apiGet('/skus/lookup/list?search=E2E-UI-NEWPROD'))?.data || []).length);
  await typeBox.click();
  await page.getByRole('option', { name: 'Consumable', exact: true }).click();
  check('quick-add: the chosen type explains its destination (C&P IMS)', /Consumable & Packaging IMS/.test(await qa.innerText()));
  await qa.getByRole('button', { name: /^Add Product$/ }).click();
  check('quick-add: product added to the SKU master', await toast(/Product added to SKU master/));
  const quickSku = ((await apiGet('/skus/lookup/list?search=E2E-UI-NEWPROD'))?.data || [])[0];
  check('…with exactly the Item Type chosen (CONSUMABLE)', quickSku?.itemType === 'CONSUMABLE', quickSku?.itemType);
  await dialog().getByRole('button', { name: /^Cancel$/ }).click().catch(() => {});
  await page.waitForTimeout(600);

  const poA = await buy({ key: 'A', qty: 500, quote: 'NOT REQUIRED', pi: false });
  const poB = await buy({ key: 'B', qty: 400, quote: 'FILE', pi: false });
  const poC = await buy({ key: 'C', qty: 300, quote: 'NOT REQUIRED', pi: true });

  /* ── GRN eligibility in the GRN form ── */
  section('GRN form — eligible POs');
  await go('/procurement/grns');
  await waitText(/GRN/);
  await btn(/^New GRN$/).click();
  await page.waitForTimeout(1000);
  // "Purchase Order(s) *" since the multi-PO GRN (f48f82c); the old exact label no longer matched.
  await dialog().getByRole('combobox', { name: /Purchase Order/i }).first().click();
  await page.waitForTimeout(1200);
  const opts = (await page.getByRole('option').allInnerTexts()).map(flat);
  for (const [k, p] of [['A', poA], ['B', poB], ['C', poC]]) {
    check(`${k}: ${p?.poNumber} is offered for GRN`, opts.some((o) => o.includes(p?.poNumber)), opts.join(' | '));
  }

  /* ── one GRN on PO A, completed from TWO browsers at once ── */
  section('Two-browser GRN completion race (PO A)');
  await page.getByRole('option').filter({ hasText: poA.poNumber }).first().click();
  await page.waitForTimeout(1200);
  const d = dialog();
  await d.getByLabel(/^Batch No/).first().fill('E2E-UI-RACE-001');
  // No manual Inventory Type: the coil's SKU routes it to RM IMS, and Received
  // At — where it physically landed — has to be chosen (never pre-filled).
  const recvAt = d.getByRole('combobox', { name: /Received At/i }).first();
  check('the GRN form has no Inventory Type; the coil line asks for Received At, not pre-filled',
    (await d.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0 && (await recvAt.count()) === 1 && !/PLG01|JW001/.test(await recvAt.innerText()));
  check('…and shows the coil going to RM IMS', (await d.getByTestId('grn-line-destination').allInnerTexts()).some((t) => /RM IMS/.test(t)));
  await recvAt.click();
  await page.getByRole('option', { name: /PLG01/ }).click();
  await d.getByRole('button', { name: /^Save as Draft$/ }).click();
  check('GRN draft created', await toast(/created \(draft\)/i));
  check('saving the draft created no stock', ((await apiGet('/inventory/movements?limit=50'))?.data || []).length === 0);
  const g = ((await apiGet('/procurement/grns?limit=10&sort=-createdAt'))?.data || [])[0];

  const { page: pageB } = await login(browser, 'B');
  const openDialog = async (p) => {
    await p.goto(`${APP}/procurement/grns/${g._id}`, { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: /^Complete GRN$/ }).first().waitFor({ timeout: 20000 });
    await p.getByRole('button', { name: /^Complete GRN$/ }).first().click();
    await p.waitForTimeout(900);
  };
  await openDialog(page);
  await openDialog(pageB);
  check('both sessions have the completion dialog open on the same GRN', (await page.getByRole('dialog').count()) > 0 && (await pageB.getByRole('dialog').count()) > 0);
  const respOf = (p) => p.waitForResponse((r) => /\/procurement\/grns\/[^/]+\/complete/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
  const [ra, rb] = await Promise.all([
    respOf(page), respOf(pageB),
    page.getByRole('dialog').getByRole('button', { name: /^Complete GRN$/ }).click(),
    pageB.getByRole('dialog').getByRole('button', { name: /^Complete GRN$/ }).click(),
  ]);
  const codes = [ra?.status(), rb?.status()].sort();
  check('exactly ONE completion succeeds; the other is refused', codes[0] === 200 && codes[1] >= 400 && codes[1] < 500, JSON.stringify(codes));
  const loser = ra?.status() === 200 ? pageB : page;
  await loser.waitForTimeout(800);
  check('the refused session gets a readable message, not a stack trace', /already been completed|only draft|being completed right now/i.test(flat(await loser.locator('body').innerText())) && !/at Object\.|TypeError|ReferenceError/.test(flat(await loser.locator('body').innerText())));
  await page.waitForTimeout(1500);
  const gAfter = (await apiGet(`/procurement/grns/${g._id}`))?.data;
  check('GRN ends completed once (receipt final, not draft)', gAfter?.stockPosted === true && gAfter?.grnStatus !== 'DRAFT', `${gAfter?.stockPosted} ${gAfter?.grnStatus}`);
  check('…and completing it posted NO stock — its coil is awaiting QC', ((await apiGet('/inventory/movements?limit=50'))?.data || []).length === 0
    && gAfter?.items?.[0]?.stockStatus === 'AWAITING_QC', gAfter?.items?.[0]?.stockStatus);

  /* ── QC completes (no MD signature needed) — only then is the coil stock ── */
  section('Incoming QC on the raced GRN, then the MD signature');
  await page.goto(`${APP}/procurement/grns/${g._id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grn-qc-section', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const qcStage = await completeQc(page, page, { doubleClick: true });
  check('QC completed before any MD signature (accept all, double-clicked)', qcStage === 'QC Completed · Passed', qcStage);
  const mvAfter = (await apiGet('/inventory/movements?limit=50'))?.data || [];
  check('now ONE GRN_IN of the accepted 500 kg at PLG01', mvAfter.length === 1 && mvAfter[0].txnType === 'GRN_IN' && mvAfter[0].quantity === 500 && mvAfter[0].warehouse === 'PLG01',
    JSON.stringify(mvAfter.map((m) => [m.txnType, m.quantity, m.warehouse])));
  check('…posted while the GRN was still awaiting the MD', (await apiGet(`/procurement/grns/${g._id}`))?.data?.approvalStatus === 'READY_FOR_MD_APPROVAL');
  await signGrnFromCard(page);
  check('the MD signs afterwards from the GRN page — still ONE GRN_IN', (await apiGet(`/procurement/grns/${g._id}`))?.data?.approvalStatus === 'MD_APPROVED'
    && ((await apiGet('/inventory/movements?limit=50'))?.data || []).length === 1);

  await browser.close();
  // Expected 4xx: the one refused GRN completion (the race loser).
  const unexpected = apiErrors.filter((e) => !/ (400|409) POST \/procurement\/grns\/[^/]+\/complete$/.test(e));
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length} (unexpected: ${unexpected.length})`);
  [...pageErrors, ...unexpected, ...consoleErrors.filter((c) => !/status of 40[09]/.test(c))].slice(0, 8).forEach((x) => console.log(`    ${x}`));
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors other than the refused race completion', consoleErrors.filter((c) => !/status of 40[09]/.test(c)).length === 0);
  check('no unexpected API errors', unexpected.length === 0);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  if (failed.length) { console.log('\n  Failures:'); failed.forEach((x) => console.log(`   - ${x.name}: ${String(x.detail).slice(0, 200)}`)); }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
