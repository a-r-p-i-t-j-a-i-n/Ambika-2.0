/**
 * PURCHASE FMS — Direct Purchase Voucher (goods bought with no Indent / PO / GRN).
 *
 *   node e2e/directPurchase.e2e.mjs
 *
 * Drives New Voucher → Direct Purchase Voucher in a real browser and checks
 * what the server stored:
 *   - three voucher types in order; the Direct Purchase form (no expense / invoice
 *     fields), financial-only notice
 *   - client validation, vendor picker (inactive vendors disabled), credit-days
 *     payment terms / due date, SKU picker (only active, purchasable SKUs), SKU
 *     code / unit from the master, vendor rate + GST defaults, discount, add /
 *     remove item, live totals
 *   - save draft → stored without PO / GRN / invoice links; list chip, column and
 *     Type filter; detail page (items, totals, no GRN / Invoice workflow steps)
 *   - edit draft (reopens prefilled, re-totals), duplicate invoice no. refused
 *   - post → MD Approval screen label; PDF generated from the detail page
 *   - Purchase Voucher and Expense / Direct Bill forms unchanged; 390px phone fit
 *
 * Expects (started separately):
 *   cd backend
 *   node src/scripts/e2eDirectPurchaseFixture.js --seed-ui        # ambika_e2e_direct_purchase
 *   PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_direct_purchase node src/scripts/e2eServer.js
 *   cd frontend
 *   VITE_API_URL=http://127.0.0.1:5097/api/v1 node node_modules/vite/bin/vite.js --port 3102 --host 127.0.0.1 --strictPort
 * (blank AWS_* / BREVO_API_KEY / SMTP_* for the backend). Re-seed before a rerun.
 *   APP_URL=http://127.0.0.1:3102 API_URL=http://127.0.0.1:5097/api/v1 node e2e/directPurchase.e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';

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

const APP = process.env.APP_URL || 'http://127.0.0.1:3102';
const API = process.env.API_URL || 'http://127.0.0.1:5097/api/v1';
await assertE2ESetup(APP, API, 'directPurchase.e2e.mjs');
const USER = { email: 'direct-purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); } else { failures.push(`${name}: ${detail}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const run = async () => {
  const exe = findChromium();
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };
  const go = async (p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await ready(); };

  await go('/');
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  const api = (p, init) => page.evaluate(async ([url, opts]) => {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts?.headers || {}) } });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  }, [`${API}${p}`, init]);
  const dps = async () => (await api('/procurement/vouchers?voucherType=DIRECT_PURCHASE&limit=100&sort=-createdAt')).body?.data || [];
  const byInvoice = async (no) => (await dps()).filter((v) => v.invoiceNumber === no);

  const dialog = () => page.getByRole('dialog');
  const tid = (t) => dialog().getByTestId(t);
  const snack = async (re) => page.getByText(re).first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
  const typeDate = async (wrapTid, ddmmyyyy) => {
    const input = tid(wrapTid).locator('input').first();
    await input.click();
    await page.keyboard.press('Home');
    await page.keyboard.type(ddmmyyyy, { delay: 25 });
    await page.waitForTimeout(250);
  };
  const pickAuto = async (testId, text, optionRe) => {
    const input = tid(testId);
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(500);
    const opt = page.getByRole('option').filter({ hasText: optionRe }).first();
    await opt.click();
    await page.waitForTimeout(300);
  };
  const setNum = async (testId, v) => { await tid(testId).fill(String(v)); };
  const openNew = async () => {
    await page.getByRole('button', { name: 'New Voucher' }).click();
    await dialog().waitFor({ state: 'visible' });
  };
  const saveDraft = async () => {
    await dialog().getByRole('button', { name: 'Save as Draft' }).click();
    return dialog().waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false);
  };

  await go('/procurement/vouchers');
  await page.getByRole('button', { name: 'New Voucher' }).waitFor({ state: 'visible', timeout: 30000 });

  section('New Voucher: three types, Direct Purchase form');
  await openNew();
  const radios = await dialog().getByRole('radiogroup').getByRole('radio').evaluateAll((els) => els.map((e) => e.value));
  check('three voucher types in order: Purchase, Direct Purchase, Expense', radios.join() === 'PURCHASE,DIRECT_PURCHASE,EXPENSE', radios.join());
  await dialog().getByLabel('Direct Purchase Voucher').check();
  await page.waitForTimeout(300);
  check('financial-only notice shown', await tid('dp-financial-only').isVisible());
  check('no expense fields and no payment-pending invoice picker',
    !(await dialog().getByText('Expense Category *').count()) && !(await dialog().getByLabel('Invoice (Payment Pending)').count()));
  check('one empty item row to start', (await dialog().locator('[data-testid^="dp-item-row-"]').count()) === 1);

  await dialog().getByRole('button', { name: 'Save as Draft' }).click();
  check('empty form: "select the vendor" warning, nothing saved', await snack(/Select the vendor from the Vendor Master/) && (await dps()).length === 0);

  section('Vendor + invoice');
  await tid('dp-vendor').click();
  await tid('dp-vendor').fill('E2E DP Vendor');
  await page.waitForTimeout(400);
  const inactive = page.getByRole('option').filter({ hasText: /Inactive/ });
  check('inactive vendor is not offered as selectable',
    !(await inactive.count()) || (await inactive.first().getAttribute('aria-disabled')) === 'true');
  check('deleted vendor not offered', !(await page.getByRole('option').filter({ hasText: /Deleted/ }).count()));
  await page.getByRole('option').filter({ hasText: /E2E DP Vendor UI/ }).first().click();
  await tid('dp-invoice-no').fill('UI-INV-1');
  await typeDate('dp-invoice-date', '10112026');
  check('payment terms + due date prefilled from the vendor\'s 15 credit days',
    (await tid('dp-payment-terms').inputValue()) === '15 days credit'
    && (await tid('dp-due-date').locator('input').first().inputValue()) === '25/11/2026',
    `${await tid('dp-payment-terms').inputValue()} / ${await tid('dp-due-date').locator('input').first().inputValue()}`);

  section('Items');
  await tid('dp-item-sku-0').click();
  await tid('dp-item-sku-0').fill('E2E DP');
  await page.waitForTimeout(600);
  const offered = await page.getByRole('option').allInnerTexts();
  check('SKU picker hides finished goods, scrap, inactive and deleted SKUs',
    offered.some((t) => /E2E DP Bolt/.test(t)) && !offered.some((t) => /Finished Good|Scrap|Inactive|Deleted/.test(t)), offered.join(' | '));
  await page.getByRole('option').filter({ hasText: /E2E DP Bolt/ }).first().click();
  await page.waitForTimeout(300);
  check('SKU code + unit from the SKU Master; rate + GST from the vendor record',
    (await tid('dp-item-code-0').innerText()) === 'E2E-DP-BOLT' && (await tid('dp-item-unit-0').innerText()) === 'PCS'
    && (await tid('dp-item-rate-0').inputValue()) === '10' && (await tid('dp-item-gstRate-0').inputValue()) === '18');
  await setNum('dp-item-quantity-0', 10);
  await tid('dp-item-description-0').fill('Counter purchase, loose');
  check('line total 10 × 10 + 18% = ₹118.00', (await tid('dp-item-total-0').innerText()) === '₹118.00', await tid('dp-item-total-0').innerText());

  await tid('dp-add-item').click();
  await pickAuto('dp-item-sku-1', 'Gloves', /E2E DP Gloves/);
  check('purchase-unit SKU line is in BOX, GST from the SKU (5%)',
    (await tid('dp-item-unit-1').innerText()) === 'BOX' && (await tid('dp-item-gstRate-1').inputValue()) === '5');
  await setNum('dp-item-quantity-1', 2);
  await setNum('dp-item-rate-1', 250);
  await setNum('dp-item-discountAmount-1', 50);
  check('line 2: 500 − 50 = 450 + 5% = ₹472.50', (await tid('dp-item-total-1').innerText()) === '₹472.50', await tid('dp-item-total-1').innerText());
  await tid('dp-add-item').click();
  check('third row added', (await dialog().locator('[data-testid^="dp-item-row-"]').count()) === 3);
  await tid('dp-remove-item-2').click();
  check('…and removed', (await dialog().locator('[data-testid^="dp-item-row-"]').count()) === 2);
  check('totals: sub ₹600, discount ₹50, tax ₹40.50, grand ₹590.50',
    (await tid('dp-subtotal').innerText()) === '₹600.00' && (await tid('dp-discount').innerText()) === '₹50.00'
    && (await tid('dp-tax').innerText()) === '₹40.50' && (await tid('dp-grand-total').innerText()) === '₹590.50',
    await tid('dp-totals').innerText());
  await setNum('dp-item-discountAmount-1', 600);
  await dialog().getByRole('button', { name: 'Save as Draft' }).click();
  check('discount above the line amount refused before save', await snack(/discount cannot be more than the line amount/));
  await setNum('dp-item-discountAmount-1', 50);
  await tid('dp-remarks').fill('Spec direct purchase');
  await page.screenshot({ path: path.join(SHOTS, 'direct-purchase-form.png'), fullPage: false });
  check('Save as Draft closes the dialog', await saveDraft());

  section('Stored voucher');
  const [saved] = await byInvoice('UI-INV-1');
  check('saved as DRAFT Direct Purchase, AGL/DPV number',
    saved?.voucherType === 'DIRECT_PURCHASE' && saved.voucherStatus === 'DRAFT' && /^AGL\/DPV-/.test(saved.voucherNumber), JSON.stringify(saved && { t: saved.voucherType, n: saved.voucherNumber }));
  check('no PO / GRN / invoice link; totals as previewed',
    saved && !saved.poId && !saved.grnId && !saved.invoiceId && !(saved.grnNumbers || []).length
    && saved.netPayableAmount === 590.5 && saved.taxAmount === 40.5 && saved.items.length === 2
    && saved.items[0].description === 'Counter purchase, loose' && saved.items[1].unit === 'BOX');

  section('List + filter');
  const row = page.locator(`.MuiDataGrid-row[data-id="${saved._id}"]`);
  await row.waitFor({ state: 'visible', timeout: 10000 });
  check('list row: DPV chip and "Direct · UI-INV-1"',
    (await row.getByTestId('voucher-type-chip').innerText()) === 'DPV' && /Direct · UI-INV-1/.test(await row.innerText()));
  const typeResp = page.waitForResponse((r) => /voucherType=DIRECT_PURCHASE/.test(r.url()), { timeout: 8000 }).catch(() => null);
  const typeField = page.locator('.MuiFormControl-root', { has: page.locator('label', { hasText: /^Type$/ }) }).first();
  if (!(await typeField.isVisible().catch(() => false))) await page.getByRole('button', { name: /Filters/ }).first().click().catch(() => {});
  await page.locator('.MuiFormControl-root', { has: page.locator('label', { hasText: /^Type$/ }) }).first().getByRole('combobox').click();
  await page.getByRole('option', { name: 'Direct Purchase Voucher', exact: true }).click();
  check('Type filter → Direct Purchase Voucher queries the server by type', Boolean(await typeResp));
  await page.keyboard.press('Escape');

  section('Detail page');
  await go(`/procurement/vouchers/${saved._id}`);
  await page.getByTestId('voucher-direct-purchase').waitFor({ state: 'visible', timeout: 15000 });
  check('shows "Direct Purchase — no Indent / PO / GRN"', true);
  check('items table with 2 rows; grand total ₹590.50',
    (await page.getByTestId('voucher-items-table').locator('tbody tr').count()) === 2
    && (await page.getByTestId('voucher-grand-total').innerText()) === '₹590.50');
  const body = await page.locator('main, #root').first().innerText();
  check('no GRN & QC / Vendor Invoice workflow steps and no PO / GRN fields', !/GRN & QC|Vendor Invoice\b/.test(body) && !/\nPO\n|\nGRN\n/.test(body));

  section('Edit draft');
  await page.getByRole('button', { name: 'Edit' }).filter({ visible: true }).first().click();
  await dialog().waitFor({ state: 'visible' });
  check('reopens as Direct Purchase (type locked), prefilled',
    await dialog().getByLabel('Direct Purchase Voucher').isChecked() && await dialog().getByLabel('Direct Purchase Voucher').isDisabled()
    && (await tid('dp-invoice-no').inputValue()) === 'UI-INV-1' && (await dialog().locator('[data-testid^="dp-item-row-"]').count()) === 2);
  await setNum('dp-item-quantity-0', 20);
  await dialog().getByRole('button', { name: 'Save', exact: true }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  const [edited] = await byInvoice('UI-INV-1');
  check('edit saved and re-totalled (236 + 472.50 = 708.50)', edited?.netPayableAmount === 708.5, String(edited?.netPayableAmount));

  section('Duplicate invoice number');
  await go('/procurement/vouchers');
  await page.getByRole('button', { name: 'New Voucher' }).waitFor({ state: 'visible', timeout: 30000 });
  await openNew();
  await dialog().getByLabel('Direct Purchase Voucher').check();
  await pickAuto('dp-vendor', 'Vendor UI', /E2E DP Vendor UI/);
  await tid('dp-invoice-no').fill(' ui-inv-1 ');
  await typeDate('dp-invoice-date', '11112026');
  await pickAuto('dp-item-sku-0', 'Bolt', /E2E DP Bolt/);
  await setNum('dp-item-quantity-0', 1);
  await dialog().getByRole('button', { name: 'Save as Draft' }).click();
  check('same vendor + same number refused by the server', await snack(/already recorded for this vendor/) && (await dps()).length === 1);
  await dialog().getByRole('button', { name: 'Cancel' }).click();

  section('Post → MD Approval, PDF');
  await go(`/procurement/vouchers/${saved._id}`);
  await page.getByRole('button', { name: 'Post Voucher' }).filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  const afterPost = (await api(`/procurement/vouchers/${saved._id}`)).body?.data;
  check('posted; READY_FOR_MD_APPROVAL', afterPost?.voucherStatus === 'POSTED' && afterPost.approvalStatus === 'READY_FOR_MD_APPROVAL');
  const pdfResp = page.waitForResponse((r) => r.url().endsWith(`/procurement/vouchers/${saved._id}/pdf`), { timeout: 15000 }).catch(() => null);
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pr = await pdfResp;
  check('Download PDF generates the voucher PDF', pr?.status() === 200 && /\.pdf$/.test((await pr.json())?.data?.voucherPdfFileName || ''));
  await go('/purchase-fms/md-approvals');
  check('MD Approval screen lists it as Direct Purchase Voucher',
    await page.getByText(saved.voucherNumber).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
    && await page.getByText('Direct Purchase Voucher').first().isVisible().catch(() => false));

  section('Workflow stepper by voucher type (voucher page + Tally page)');
  const post = (path2, body) => api(path2, { method: 'POST', body: JSON.stringify(body) });
  const stepperLabels = async (url) => {
    await go(url);
    await page.getByTestId('workflow-stepper').waitFor({ state: 'visible', timeout: 20000 });
    return (await page.getByTestId('workflow-stepper').innerText()).split('\n').map((t) => t.trim()).filter(Boolean);
  };
  const newTally = async (voucherId) => (await post('/procurement/tally-entries', { voucherId })).body?.data;
  // Direct Purchase: the voucher posted above.
  const dpTally = await newTally(saved._id);
  const dpVoucherSteps = await stepperLabels(`/procurement/vouchers/${saved._id}`);
  const dpTallySteps = await stepperLabels(`/procurement/tally-entries/${dpTally?._id}`);
  const only3 = (l) => l.includes('Voucher') && l.includes('Tally Entry') && l.includes('Final Payment') && !l.includes('GRN & QC') && !l.includes('Vendor Invoice');
  check('Direct Purchase voucher page: Voucher → Tally Entry → Final Payment only', only3(dpVoucherSteps), dpVoucherSteps.join(' | '));
  check('Direct Purchase Tally page: the same three steps, tally entry number shown', only3(dpTallySteps) && dpTallySteps.includes(dpTally?.entryNumber), dpTallySteps.join(' | '));
  // Direct expense bill.
  const expV = (await post('/procurement/vouchers', { voucherType: 'EXPENSE', expenseCategory: 'Other', partyName: 'Spec Walk-in', basicValue: 100 })).body?.data;
  await post(`/procurement/vouchers/${expV?._id}/post`, {});
  const expTally = await newTally(expV?._id);
  const expVoucherSteps = await stepperLabels(`/procurement/vouchers/${expV?._id}`);
  const expTallySteps = await stepperLabels(`/procurement/tally-entries/${expTally?._id}`);
  check('Expense voucher page: Voucher → Tally Entry → Final Payment only', only3(expVoucherSteps), expVoucherSteps.join(' | '));
  check('Expense Tally page: the same three steps', only3(expTallySteps), expTallySteps.join(' | '));
  // Normal Purchase Voucher keeps the full original pipeline on both pages.
  const invs = (await api('/procurement/vendor-invoices?search=VI-100&limit=5')).body?.data || [];
  const pvV = (await post('/procurement/vouchers', { voucherType: 'PURCHASE', invoiceId: invs[0]?._id })).body?.data;
  await post(`/procurement/vouchers/${pvV?._id}/post`, {});
  const pvTally = await newTally(pvV?._id);
  const all5 = ['GRN & QC', 'Vendor Invoice', 'Voucher', 'Tally Entry', 'Final Payment'];
  const pvVoucherSteps = await stepperLabels(`/procurement/vouchers/${pvV?._id}`);
  const pvTallySteps = await stepperLabels(`/procurement/tally-entries/${pvTally?._id}`);
  check('Purchase voucher page: all five original steps, in order', all5.every((l, i) => pvVoucherSteps.indexOf(l) >= 0 && (i === 0 || pvVoucherSteps.indexOf(l) > pvVoucherSteps.indexOf(all5[i - 1]))), pvVoucherSteps.join(' | '));
  check('Purchase Tally page: all five original steps, in order', all5.every((l, i) => pvTallySteps.indexOf(l) >= 0 && (i === 0 || pvTallySteps.indexOf(l) > pvTallySteps.indexOf(all5[i - 1]))), pvTallySteps.join(' | '));

  section('Existing types unchanged');
  await go('/procurement/vouchers');
  await page.getByRole('button', { name: 'New Voucher' }).waitFor({ state: 'visible', timeout: 30000 });
  await openNew();
  check('Purchase Voucher is the default and still shows the payment-pending invoice picker',
    await dialog().getByLabel('Purchase Voucher', { exact: true }).isChecked() && (await dialog().getByText('Invoice (Payment Pending)').count()) > 0);
  await dialog().getByLabel('Expense / Direct Bill').check();
  await page.waitForTimeout(300);
  check('Expense / Direct Bill still shows Expense Type + Category, no item table',
    (await dialog().getByTestId('expense-type').count()) === 1 && (await dialog().getByText('Expense Category *').count()) > 0
    && (await dialog().locator('[data-testid^="dp-item-row-"]').count()) === 0);
  await dialog().getByRole('button', { name: 'Cancel' }).click();

  section('390px phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await openNew();
  await dialog().getByLabel('Direct Purchase Voucher').check();
  await page.waitForTimeout(400);
  const fit = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  check('form fits a 390px phone (item table scrolls inside its box)', fit.doc <= fit.win, JSON.stringify(fit));
  await page.screenshot({ path: path.join(SHOTS, 'direct-purchase-390.png') });

  check('no uncaught page errors', !pageErrors.length, pageErrors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exitCode = 1; }
};

run().catch((err) => { console.error(err); process.exitCode = 1; });
