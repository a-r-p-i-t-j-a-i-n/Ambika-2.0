/**
 * MD Approval — browser spec for the MD's approval screen and the rule that
 * MD approval never holds a workflow step back, EXCEPT payment.
 *
 *   node e2e/mdApproval.e2e.mjs
 *
 * Order: backend/src/scripts/e2eMdApprovalFixture.js --seed, start the guarded
 * backend (e2eServer.js) on ambika_e2e_mdapproval + Vite, run this, then
 * e2eMdApprovalFixture.js --verify (the database oracle).
 * Expects: backend :5099 via e2eServer.js, frontend :3100 (VITE_API_URL → :5099).
 *
 * Covers: role-based access (a non-MD user sees no button, no screen, gets 403
 * from the API) · the header button with its pending badge on every step · the
 * dashboard cards and every filter · the detail panel and its PDFs · approving
 * from the panel (the existing signature dialog) · the advance-payment gate and
 * the final-payment gate, before and after approval · GRN → QC → stock posted
 * while the GRN's MD approval is still pending · responsive layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';
import { signAsMd, completeQc, stageText, qcSection } from './_grnLifecycle.mjs';

const APP = 'http://127.0.0.1:3100';
const API = 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'mdApproval.e2e.mjs');
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/mdapproval';
fs.mkdirSync(SHOTS, { recursive: true });
const M = JSON.parse(fs.readFileSync(path.join('e2e/shots', 'md-approval-manifest.json'), 'utf8'));

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

const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
};
const section = (s) => console.log(`\n── ${s} ──`);
const pageErrors = [];
const consoleErrors = [];
const apiErrors = [];

// A 1×1 PNG — enough for the server's signature decoder in the API-level probes.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const login = async (browser, user, tag, viewport = { width: 1600, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${tag} ${page.url().replace(APP, '')} :: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${tag} ${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${tag} ${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1].split('?')[0]}`); });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForLoadState('load').catch(() => {});
  await page.locator('input[autocomplete="email"]').fill(user.email);
  await page.locator('input[autocomplete="current-password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 90000 });
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  return { ctx, page };
};

const helpers = (page) => {
  const go = async (u) => {
    await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *');
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(1200);
  };
  const body = async () => flat(await page.locator('body').innerText());
  const waitText = async (rx, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (rx.test(await body())) return true; await page.waitForTimeout(300); } return false; };
  const toast = (rx, ms = 20000) => page.getByText(rx).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const api = (method, p, payload) => page.evaluate(async ({ base, method: m, q, b }) => {
    const r = await fetch(`${base}${q}`, {
      method: m,
      headers: { authorization: `Bearer ${localStorage.getItem('token')}`, 'content-type': 'application/json' },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { base: API, method, q: p, b: payload });
  const btn = (name, scope = page) => scope.getByRole('button', { name }).filter({ visible: true }).first();
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
  const rows = () => page.locator('.MuiDataGrid-row');
  const waitRows = async (n, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await rows().count()) === n) return true; await page.waitForTimeout(250); } return false; };
  const card = (label) => page.getByRole('button').filter({ hasText: new RegExp(`^\\s*\\d+\\s*${label}\\s*$`) }).first();
  const cardValue = async (label) => Number(flat(await card(label).innerText()).split(' ')[0]);
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(300); } return false; };
  return { go, body, waitText, toast, api, btn, shot, rows, waitRows, card, cardValue, noHScroll, until };
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });

  /* ── Role-based access: a non-MD user ───────────────────────────────── */
  section('Role-based access — non-MD (Accounts) user');
  {
    const { ctx, page } = await login(browser, M.accounts, 'ACC');
    const h = helpers(page);
    await h.go('/purchase-fms/purchase-orders');
    await page.getByTestId('pfms-quick-actions').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    check('non-MD: the header has Quick Actions but no MD Approval button',
      (await page.getByTestId('pfms-quick-actions').count()) === 1 && (await page.getByTestId('pfms-md-approval').count()) === 0);
    await h.go('/purchase-fms/md-approvals');
    check('non-MD: /purchase-fms/md-approvals sends them back to the first step',
      await h.until(async () => /\/purchase-fms\/purchase-indents$/.test(page.url())) && (await page.locator('#mda-search').count()) === 0, page.url());
    const list = await h.api('GET', '/approvals');
    check('non-MD: GET /approvals → 403', list.status === 403, `${list.status} ${list.body?.message}`);
    const sign = await h.api('POST', `/approvals/PROFORMA_INVOICE/${M.pi.id}/sign`, { signatureImageBase64: PNG });
    check('non-MD: signing (approving) → 403', sign.status === 403, `${sign.status} ${sign.body?.message}`);
    await ctx.close();
  }

  /* ── MD user ───────────────────────────────────────────────────────── */
  const { page } = await login(browser, M.md, 'MD');
  const h = helpers(page);

  section('Header button — every step, MD only, with the pending count');
  for (const step of ['purchase-indents', 'purchase-orders', 'grn', 'final-payments']) {
    await h.go(`/purchase-fms/${step}`);
    const b = page.getByTestId('pfms-md-approval');
    await h.until(async () => /MD Approval\s*\d/.test(flat(await b.innerText({ timeout: 1000 }))), 20000);
    const visible = await b.isVisible().catch(() => false);
    check(`MD: "MD Approval" beside Quick Actions on ${step}, badge 3`, visible && /MD Approval\s*3/.test(flat(await b.innerText())), visible ? flat(await b.innerText()) : 'not visible');
  }
  // Same header row as Quick Actions.
  const [qa, mda] = await Promise.all([page.getByTestId('pfms-quick-actions').boundingBox(), page.getByTestId('pfms-md-approval').boundingBox()]);
  check('…in the same header row, left of Quick Actions', qa && mda && Math.abs(qa.y - mda.y) < 6 && mda.x < qa.x, JSON.stringify({ qa, mda }));
  await page.getByTestId('pfms-md-approval').click();
  await page.waitForURL(/\/purchase-fms\/md-approvals$/, { timeout: 10000 });
  await h.waitRows(4);
  // A refresh / bookmark of the screen must keep the MD there (the user is
  // restored a render after load — the hub waits for it before deciding).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove()).catch(() => {});
  check('MD: a refresh of /purchase-fms/md-approvals stays on the screen', await h.waitRows(4, 20000) && /\/purchase-fms\/md-approvals$/.test(page.url()), page.url());
  await h.shot('01-dashboard');

  section('Dashboard — summary cards and table');
  check('cards: Total 4 · Pending 3 · Approved 0 · Completed 1',
    (await h.cardValue('Total Approvals')) === 4 && (await h.cardValue('Pending')) === 3 && (await h.cardValue('Approved')) === 0 && (await h.cardValue('Completed')) === 1,
    `${await h.cardValue('Total Approvals')}/${await h.cardValue('Pending')}/${await h.cardValue('Approved')}/${await h.cardValue('Completed')}`);
  check('four rows, pending first', (await h.rows().count()) === 4 && /Pending/.test(flat(await h.rows().first().innerText())));
  // Header text is upper-cased by CSS, so compare case-insensitively.
  const headers = flat(await page.locator('.MuiDataGrid-columnHeaders').innerText()).toLowerCase();
  check('columns: S.No., Reference No., Module / Step, Vendor, Amount, Requested By, Date, Approval Status',
    ['S.No.', 'Reference No.', 'Module / Step', 'Vendor', 'Amount', 'Requested By', 'Date', 'Approval Status'].every((c) => headers.includes(c.toLowerCase())), headers);
  check('payment-gated rows flagged "Payment on hold" (PI + voucher)', (await page.getByText('Payment on hold').count()) === 2);
  check('banner: 2 payments wait for the MD', await h.waitText(/2 payments cannot be made until you approve them/));
  const grnRow = h.rows().filter({ hasText: M.grn.number });
  check('GRN row: GRN & QC, ₹1,000.00, requested by the store user, Pending', /GRN & QC/.test(flat(await grnRow.innerText())) && /₹1,000\.00/.test(flat(await grnRow.innerText())) && /Accounts Clerk/.test(flat(await grnRow.innerText())) && /Pending/.test(flat(await grnRow.innerText())),
    flat(await grnRow.innerText()));

  section('Filters');
  await h.card('Pending').click();
  check('Pending card → 3 rows', await h.waitRows(3));
  await h.card('Completed').click();
  check('Completed card → 1 row (the paid older voucher)', await h.waitRows(1) && /PV-MDA-000/.test(flat(await h.rows().first().innerText())));
  await h.card('Total Approvals').click();
  await h.waitRows(4);
  await page.locator('#mda-search').fill('Gamma');
  check('search "Gamma" → the one voucher', await h.waitRows(1) && /PV-MDA-001/.test(flat(await h.rows().first().innerText())));
  await page.locator('#mda-search').fill('');
  await h.waitRows(4);
  await page.getByRole('combobox', { name: 'Module' }).click();
  await page.getByRole('option', { name: 'Advance Payments' }).click();
  check('module "Advance Payments" → the PI', await h.waitRows(1) && new RegExp(M.pi.number).test(flat(await h.rows().first().innerText())));
  await page.getByRole('combobox', { name: 'Module' }).click();
  await page.getByRole('option', { name: 'All' }).click();
  await h.waitRows(4);
  await page.getByRole('combobox', { name: 'Vendor' }).fill('Alpha');
  await page.getByRole('option', { name: 'E2E Alpha Traders' }).click();
  check('vendor "E2E Alpha Traders" → GRN + older voucher', await h.waitRows(2));
  await page.getByRole('combobox', { name: 'Vendor' }).click();
  await page.getByRole('combobox', { name: 'Vendor' }).press('Control+a');
  await page.getByRole('combobox', { name: 'Vendor' }).press('Backspace');
  await page.keyboard.press('Escape');
  await h.waitRows(4);
  // From = today: the voucher requested 10 days ago drops out.
  const from = page.getByLabel(/^From/).first();
  await from.click();
  await page.waitForTimeout(400);
  const todayCell = page.locator('.MuiPickersDay-today').first();
  if (await todayCell.isVisible().catch(() => false)) await todayCell.click();
  else {
    const d = new Date();
    await page.keyboard.press('Home');
    await page.keyboard.type(`${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`, { delay: 30 });
  }
  check('date From today → 3 rows (the 10-day-old request drops out)', await h.waitRows(3));
  await h.shot('02-filtered');
  await h.go('/purchase-fms/md-approvals');
  await h.waitRows(4);

  /* ── Advance payment gate ───────────────────────────────────────────── */
  section('Advance payment gate — before MD approval');
  const apTry = await h.api('POST', '/procurement/advance-payments', {
    piId: M.pi.id, paymentStatus: 'FULL_PAYMENT', paymentDate: new Date().toISOString().slice(0, 10), paidAmount: M.pi.total, paymentMode: 'E_FUND_TRANSFER',
  });
  check('API refuses the advance payment (400, until the MD approves the PI)', apTry.status === 400 && /until the MD approves this Proforma Invoice/.test(apTry.body?.message || ''), `${apTry.status} ${apTry.body?.message}`);
  await h.go(`/procurement/proforma-invoices/${M.pi.id}`);
  check('PI page: next step says the advance waits for MD approval', await h.waitText(/advance payment waits for MD approval/));
  check('PI page: MD Approval card, Pending Approval', await h.until(async () => /MD Approval.*Pending Approval/.test(flat(await page.locator('#pi-md-approval').innerText({ timeout: 1000 })))));
  await h.btn(/^Record Advance Payment$/).click();
  const apDlg = page.getByRole('dialog').filter({ hasText: 'Record Advance Payment' });
  await apDlg.waitFor({ timeout: 10000 });
  check('payment dialog: gate message shown, Record Payment disabled',
    /until the MD approves this Proforma Invoice/.test(flat(await apDlg.getByTestId('ap-md-gate').innerText())) && await apDlg.getByRole('button', { name: 'Record Payment' }).isDisabled());
  await h.shot('03-advance-gate');
  await apDlg.getByRole('button', { name: 'Cancel' }).click();

  /* ── Detail panel + approve the PI ──────────────────────────────────── */
  section('Detail panel — PI, PDF, approve');
  await h.go('/purchase-fms/md-approvals');
  await h.waitRows(4);
  await h.rows().filter({ hasText: M.pi.number }).click();
  const drawer = page.getByTestId('md-approval-drawer');
  await drawer.waitFor({ timeout: 10000 });
  await h.until(async () => /E2E MDA Brush 5in/.test(flat(await drawer.innerText({ timeout: 1000 }))));
  const dText = flat(await drawer.innerText());
  check('panel: summary, payment-on-hold note, PI lines, history', /Advance Payments/.test(dText) && /E2E Beta Metals/.test(dText) && /advance payment against this PI is on hold/.test(dText)
    && /E2E MDA Brush 5in/.test(dText) && /Approval History/i.test(dText) && /Requested By/i.test(dText), dText.slice(0, 220));
  await h.shot('04-detail-pi');
  await drawer.getByRole('button', { name: 'View PDF' }).click();
  const pdfDlg = page.getByRole('dialog').filter({ has: page.locator('iframe') }).last();
  await pdfDlg.waitFor({ timeout: 10000 });
  const pdfSrc = await pdfDlg.locator('iframe').getAttribute('src');
  const pdfRes = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, type: r.headers.get('content-type'), head: (await r.text()).slice(0, 5) }; }, pdfSrc);
  check('View PDF: the unsigned approval sheet is served as a PDF', /unsigned\.pdf$/.test(pdfSrc) && pdfRes.status === 200 && pdfRes.head === '%PDF-', `${pdfSrc} ${JSON.stringify(pdfRes)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await drawer.getByTestId('md-approve').click();
  await signAsMd(page);
  check('approve → "Document signed — MD Approved"', await h.toast(/MD Approved/));
  await page.waitForTimeout(1200);
  check('panel: status Approved, payment released, Approve gone', /Approved/.test(flat(await drawer.innerText())) && /payment can be processed/.test(flat(await drawer.innerText()))
    && (await drawer.getByTestId('md-approve').count()) === 0);
  check('panel: history records the signature by the MD', /Approved & signed — MD Approver/.test(flat(await drawer.innerText())));
  await drawer.getByRole('button', { name: 'View Signed PDF' }).click();
  const sDlg = page.getByRole('dialog').filter({ has: page.locator('iframe') }).last();
  await sDlg.waitFor({ timeout: 10000 });
  const sSrc = await sDlg.locator('iframe').getAttribute('src');
  const sRes = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, head: (await r.text()).slice(0, 5) }; }, sSrc);
  check('View Signed PDF: the signed sheet', /-signed\.pdf$/.test(sSrc) && sRes.status === 200 && sRes.head === '%PDF-', sSrc);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  check('cards now: Pending 2 · Approved 1', await (async () => { await page.waitForTimeout(1500); return (await h.cardValue('Pending')) === 2 && (await h.cardValue('Approved')) === 1; })());

  section('Advance payment — after MD approval');
  await h.go(`/procurement/proforma-invoices/${M.pi.id}`);
  check('PI page: next step is the advance payment again', await h.waitText(/record the advance payment/));
  await h.btn(/^Record Advance Payment$/).click();
  await apDlg.waitFor({ timeout: 10000 });
  check('…dialog has no gate message', (await apDlg.getByTestId('ap-md-gate').count()) === 0);
  await apDlg.getByLabel(/Payment Status/).first().click();
  await page.getByRole('option', { name: 'Full Payment' }).click();
  await page.waitForTimeout(300);
  await apDlg.getByLabel(/Reference Number/).first().fill('E2E-MDA-UTR-1');
  await apDlg.getByRole('button', { name: 'Record Payment' }).click();
  check('full advance payment recorded', await h.toast(/Payment .* recorded/));

  /* ── Final payment gate ─────────────────────────────────────────────── */
  section('Final payment gate — before MD approval');
  const fpTry = await h.api('POST', '/procurement/final-payments', { voucherId: M.pv1.id, paymentStatus: 'FULL_PAYMENT', paidAmount: M.pv1.amount, paymentMode: 'NEFT' });
  check('API refuses the final payment (400, until the MD approves the voucher)', fpTry.status === 400 && /until the MD approves this voucher/.test(fpTry.body?.message || ''), `${fpTry.status} ${fpTry.body?.message}`);
  await h.go(`/procurement/vouchers/${M.pv1.id}`);
  check('voucher page: "payment waits for MD approval"', await h.waitText(/payment waits for MD approval/));
  check('…Make Payment disabled, with the reason', await page.getByRole('button', { name: 'Make Payment' }).first().isDisabled() && /Payment unlocks once the MD approves this voucher/.test(await h.body()));
  await h.shot('05-voucher-gate');

  section('Approve the voucher from the dashboard, then pay');
  await h.go('/purchase-fms/md-approvals');
  await h.waitRows(4);
  await h.rows().filter({ hasText: M.pv1.number }).click();
  await drawer.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1000);
  check('panel: voucher details (net payable, Tally)', /Net Payable/i.test(flat(await drawer.innerText())) && /INV-MDA-1/.test(flat(await drawer.innerText())));
  await drawer.getByTestId('md-approve').click();
  await signAsMd(page);
  check('voucher approved', await h.toast(/MD Approved/));
  await page.keyboard.press('Escape');
  await h.go(`/procurement/vouchers/${M.pv1.id}`);
  await h.waitText(/record the Final Payment/);
  const pay = page.getByRole('button', { name: 'Make Payment' }).filter({ visible: true }).first();
  check('…Make Payment enabled now', !(await pay.isDisabled()));
  await pay.click();
  const fpDlg = page.getByRole('dialog').filter({ hasText: 'Make Payment' });
  await fpDlg.waitFor({ timeout: 10000 });
  await fpDlg.getByLabel('Reference No').fill('E2E-MDA-UTR-2');
  await fpDlg.getByRole('button', { name: 'Record Payment' }).click();
  check('final payment recorded', await h.toast(/Payment recorded/));

  /* ── GRN → QC → stock while the GRN's MD approval is pending ───────── */
  section('GRN → QC → stock, no MD signature needed');
  await h.go(`/procurement/grns/${M.grn.id}`);
  await page.waitForSelector('#grn-qc-section', { timeout: 20000 });
  await page.waitForTimeout(1000);
  check('GRN completed, unsigned → QC is open ("QC Pending")', (await stageText(page)) === 'QC Pending', await stageText(page));
  check('…MD Approval card shows Pending Approval', /Pending Approval/.test(flat(await page.locator('#grn-md-approval').innerText())));
  check('…Save QC Draft is available before any signature', !(await qcSection(page).getByRole('button', { name: 'Save QC Draft' }).isDisabled()));
  const qcStage = await completeQc(page);
  check('QC completed without the MD signature', qcStage === 'QC Completed · Passed', qcStage);
  const mv = (await h.api('GET', '/inventory/movements?limit=50')).body?.data || [];
  const g = (await h.api('GET', `/procurement/grns/${M.grn.id}`)).body?.data;
  check('accepted 40 posted to stock (one GRN_IN)', mv.filter((x) => x.txnType === 'GRN_IN').length === 1 && mv.find((x) => x.txnType === 'GRN_IN')?.quantity === 40,
    JSON.stringify(mv.map((x) => [x.txnType, x.quantity])));
  check('…and the GRN is still awaiting the MD', g?.approvalStatus === 'READY_FOR_MD_APPROVAL', g?.approvalStatus);
  await h.shot('06-grn-qc-unsigned');

  section('Dashboard after the run');
  await h.go('/purchase-fms/md-approvals');
  await h.waitRows(4);
  check('cards: Pending 1 (GRN) · Approved 0 · Completed 3', (await h.cardValue('Pending')) === 1 && (await h.cardValue('Approved')) === 0 && (await h.cardValue('Completed')) === 3,
    `${await h.cardValue('Pending')}/${await h.cardValue('Approved')}/${await h.cardValue('Completed')}`);
  check('GRN row: workflow "QC Passed", approval still Pending', /QC Passed/.test(flat(await h.rows().filter({ hasText: M.grn.number }).innerText())) && /Pending/.test(flat(await h.rows().filter({ hasText: M.grn.number }).innerText())));
  check('header badge now 1', /MD Approval\s*1/.test(flat(await page.getByTestId('pfms-md-approval').innerText())));

  /* ── Responsive ─────────────────────────────────────────────────────── */
  section('Responsive layout');
  for (const [w, hgt] of [[1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await h.go('/purchase-fms/md-approvals');
    await h.waitRows(4);
    const ok = await h.noHScroll();
    const btnVis = await page.getByTestId('pfms-md-approval').isVisible();
    const cardsVis = await h.card('Pending').isVisible();
    check(`${w}px: no horizontal page scroll, header button + cards visible`, ok && btnVis && cardsVis, `scroll ok ${ok} · button ${btnVis} · cards ${cardsVis}`);
    await h.shot(`07-responsive-${w}`);
    if (w === 390) {
      await h.rows().first().click();
      await drawer.waitFor({ timeout: 10000 });
      const box = await drawer.boundingBox();
      check('390px: detail panel fills the screen width', box && box.width >= 380, JSON.stringify(box));
      await h.shot('08-detail-390');
      await page.keyboard.press('Escape');
    }
  }

  await browser.close();
  // Expected: the role probes (403) and the two refused payments (400).
  const expected = [/ACC 403 GET \/approvals$/, /ACC 403 POST \/approvals\/PROFORMA_INVOICE\/[^/]+\/sign$/,
    /MD 400 POST \/procurement\/advance-payments$/, /MD 400 POST \/procurement\/final-payments$/];
  const unexpected = apiErrors.filter((e) => !expected.some((rx) => rx.test(e)));
  // With S3 off (scratch runs) uploads are served by the API origin, whose
  // helmet CSP forbids framing from the app origin — every PDF preview in the
  // app (GRN, Voucher, …) shows the same message locally. In production files
  // come from S3 via a 302, so this does not occur; the PDFs themselves are
  // verified above by fetching them.
  const realConsole = consoleErrors.filter((c) => !/status of 40[03]/.test(c) && !/Framing 'http:\/\/127\.0\.0\.1:5099\/' violates .*frame-ancestors/.test(c));
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${realConsole.length}, API errors: ${apiErrors.length} (unexpected: ${unexpected.length})`);
  [...pageErrors, ...unexpected, ...realConsole].slice(0, 10).forEach((x) => console.log(`    ${x}`));
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors besides the expected refusals', realConsole.length === 0);
  check('no unexpected API errors', unexpected.length === 0);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  if (failed.length) { console.log('\n  Failures:'); failed.forEach((x) => console.log(`   - ${x.name}: ${String(x.detail).slice(0, 200)}`)); }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
