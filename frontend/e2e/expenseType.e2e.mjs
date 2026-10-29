/**
 * PURCHASE FMS — Expense / Direct Bill voucher: Expense Type.
 *
 *   node e2e/expenseType.e2e.mjs
 *
 * Drives the New Voucher form for all three expense types and checks what the
 * server stored:
 *   - Direct Expense (Without PO & GRN): full original form, saves with no PO / GRN
 *   - Expense Against PO (Without GRN): PO picker (received POs not offered),
 *     vendor locked to the PO, PO-value warning, saves with the PO and no GRN
 *   - Expense Against GRN (Without PO): GRN picker (only W/O-PO GRNs), the
 *     GRN's supplier bill no. prefilled, saves with the GRN and no PO
 *   - validation (no PO picked, bill above the PO value), server refusals
 *     through the real API (Joi + service), duplicate clicks / requests
 *   - detail page, edit (keeps the PO, re-totals), post → MD approval queue
 *   - Purchase Voucher path unchanged; dialog fits a 390px phone
 *
 * Expects (started separately):
 *   cd backend
 *   node src/scripts/e2eExpenseTypeFixture.js --seed-ui      # ambika_e2e_expense_type
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_expense_type node src/scripts/e2eServer.js
 *   cd frontend
 *   VITE_API_URL=http://127.0.0.1:5099/api/v1 node node_modules/vite/bin/vite.js --port 3100 --host 127.0.0.1 --strictPort
 * (blank AWS_* / BREVO_API_KEY / SMTP_* for the backend). Re-seed before a rerun.
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

const APP = process.env.APP_URL || 'http://127.0.0.1:3100';
const API = process.env.API_URL || 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'expenseType.e2e.mjs');
const USER = { email: 'expense-e2e@test.local', password: 'E2e@12345' };
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

  // ── Login ──
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  const api = (p, init) => page.evaluate(async ([url, opts]) => {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts?.headers || {}) },
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  }, [`${API}${p}`, init]);
  const vouchers = async () => (await api('/procurement/vouchers?voucherType=EXPENSE&limit=100&sort=-createdAt')).body?.data || [];
  const byBill = async (no) => (await vouchers()).filter((v) => v.expenseInvoiceNo === no);

  const dialog = () => page.getByRole('dialog');
  const field = (label) => dialog().locator('.MuiFormControl-root', { has: page.locator('label', { hasText: label }) }).first();
  const selectOption = async (label, option) => {
    await field(label).getByRole('combobox').click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.waitForTimeout(250);
  };
  const fill = async (label, value) => { await dialog().getByLabel(label, { exact: true }).fill(String(value)); };
  // Toasts are the app's own components (src/components/Toast.jsx) — match the text.
  const snack = async (re) => page.getByText(re).first()
    .waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
  const openNewExpense = async () => {
    await page.getByRole('button', { name: 'New Voucher' }).click();
    await dialog().waitFor({ state: 'visible' });
    await dialog().getByLabel('Expense / Direct Bill').check();
    await page.waitForTimeout(300);
  };
  const pickLink = async (text, optionRe) => {
    const input = dialog().getByTestId('expense-link');
    await input.click();
    await input.fill(text);
    await page.getByRole('option').filter({ hasText: optionRe }).first().click();
    await page.waitForTimeout(300);
  };
  const saveDraft = async () => {
    await dialog().getByRole('button', { name: 'Save as Draft' }).click();
    return dialog().waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false);
  };

  await page.goto(`${APP}/procurement/vouchers`, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.getByRole('button', { name: 'New Voucher' }).waitFor({ state: 'visible', timeout: 30000 });

  section('Expense Type dropdown + Direct Expense (Without PO & GRN)');
  await openNewExpense();
  const typeValue = (await field('Expense Type').getByRole('combobox').innerText()).trim();
  check('Expense Type defaults to Direct Expense', typeValue === 'Direct Expense (Without PO & GRN)', typeValue);
  await field('Expense Type').getByRole('combobox').click();
  const optionTexts = await page.getByRole('option').allInnerTexts();
  check('three Expense Type options, in order', optionTexts.join('|') === [
    'Direct Expense (Without PO & GRN)', 'Expense Against PO (Without GRN)', 'Expense Against GRN (Without PO)'].join('|'), optionTexts.join('|'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const directFields = ['Voucher Date', 'Expense Category *', 'Vendor / Party Name *', 'Vendor Bill/Invoice No (optional)', 'Bill Date (optional)',
    'Basic Value', 'Freight Charges', 'Packing & Forwarding', 'Other Charges', 'Taxable Amount', 'GST Rate %', 'Tax Amount (if no GST rate)',
    'TCS (+)', 'TDS (−)', 'Advance Payment (−)', 'Other Reason', 'Payment Terms', 'Due Date', 'Prepared By', 'Remarks'];
  const missing = [];
  for (const l of directFields) if (!(await field(l).isVisible().catch(() => false))) missing.push(l);
  check('Direct shows every original field (and the Upload button)', !missing.length && await dialog().getByRole('button', { name: 'Upload' }).isVisible(), missing.join(', '));
  check('Direct shows no PO / GRN picker', (await dialog().getByTestId('expense-link').count()) === 0);
  await selectOption('Expense Category', 'Computer Repair');
  await dialog().getByLabel('Vendor / Party Name *').fill('Spec Laptop Repairs');
  await fill('Vendor Bill/Invoice No (optional)', 'SPEC-D-1');
  await fill('Basic Value', 1000);
  await fill('Taxable Amount', 1000);
  await fill('GST Rate %', 18);
  check('Direct: total payable preview 1,180', /₹1,180\.00/.test(await dialog().innerText()));
  check('Direct: Save as Draft closes the dialog', await saveDraft());
  const [d] = await byBill('SPEC-D-1');
  check('Direct saved: type DIRECT, no PO / GRN, net 1180, party kept',
    d?.expenseType === 'DIRECT' && !d.poId && !d.grnId && d.netPayableAmount === 1180 && d.partyName === 'Spec Laptop Repairs', JSON.stringify(d && { t: d.expenseType, po: d.poId, n: d.netPayableAmount }));

  section('Expense Against PO (Without GRN)');
  await openNewExpense();
  await selectOption('Expense Type', 'Expense Against PO (Without GRN)');
  check('PO picker appears, labelled Purchase Order *', await field('Purchase Order *').isVisible());
  const vendorBox = dialog().getByTestId('expense-vendor');
  check('vendor field is read-only until a PO is picked', (await vendorBox.getAttribute('readonly')) !== null && (await vendorBox.inputValue()) === '');
  check('bill no. is required for a PO bill (label)', await field('Vendor Bill/Invoice No *').isVisible());
  await selectOption('Expense Category', 'AMC');
  await dialog().getByRole('button', { name: 'Save as Draft' }).click();
  check('saving without a PO is stopped with a clear message', await snack(/Select the Purchase Order this expense is against/));
  const linkInput = dialog().getByTestId('expense-link');
  await linkInput.click();
  await page.waitForTimeout(800);
  const poOptions = await page.getByRole('option').allInnerTexts();
  check('picker offers PO-EXP-UI but not the received / draft / cancelled POs',
    poOptions.some((t) => t.startsWith('PO-EXP-UI')) && !poOptions.some((t) => /PO-EXP-(G|DRAFT|CANC|REJ)\b/.test(t)), poOptions.map((t) => t.split('\n')[0]).join(', '));
  await page.keyboard.press('Escape');
  await pickLink('PO-EXP-UI', /^PO-EXP-UI\s·/);
  check('vendor locked to the PO vendor', (await vendorBox.inputValue()) === 'E2E Vendor A', await vendorBox.inputValue());
  const summary = dialog().getByTestId('expense-link-summary');
  check('PO summary shows PO value 11,800', /PO-EXP-UI/.test(await summary.innerText()) && /11,800\.00/.test(await summary.innerText()), await summary.innerText());
  check('payment terms prefilled from the PO', (await dialog().getByLabel('Payment Terms', { exact: true }).inputValue()) === '30 days');
  await fill('Vendor Bill/Invoice No *', 'SPEC-PO-1');
  await fill('Basic Value', 2000);
  await fill('Taxable Amount', 2000);
  await fill('GST Rate %', 18);
  check('Against PO: Save as Draft closes the dialog', await saveDraft());
  const [p] = await byBill('SPEC-PO-1');
  check('Against PO saved: PO linked, no GRN, vendor from PO, net 2360',
    p?.expenseType === 'AGAINST_PO' && p.poNumber === 'PO-EXP-UI' && !p.grnId && !(p.grnNumbers || []).length && p.vendorName === 'E2E Vendor A' && p.netPayableAmount === 2360,
    JSON.stringify(p && { t: p.expenseType, po: p.poNumber, v: p.vendorName, n: p.netPayableAmount }));

  section('PO value guard (form + server)');
  const before = (await vouchers()).length;
  await openNewExpense();
  await selectOption('Expense Type', 'Expense Against PO (Without GRN)');
  await selectOption('Expense Category', 'Other');
  await pickLink('PO-EXP-UI2', /^PO-EXP-UI2\s·/);
  await fill('Vendor Bill/Invoice No *', 'SPEC-PO-OVER');
  await fill('Basic Value', 1000);
  check('warning shown when the bill is above the PO value', await dialog().getByTestId('expense-over-po').isVisible());
  await dialog().getByRole('button', { name: 'Save as Draft' }).click();
  check('…and saving is stopped', await snack(/above what is left on this PO/));
  check('…nothing was created', (await vouchers()).length === before);
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await dialog().waitFor({ state: 'hidden' });

  section('Expense Against GRN (Without PO)');
  const grnOpts = (await api('/procurement/vouchers/expense-links?type=GRN')).body?.data || [];
  const uiGrn = grnOpts.find((g) => g.invoiceNumber === 'SUP-UI-9');
  const otherGrns = grnOpts.filter((g) => g !== uiGrn);
  check('API: GRN options are W/O-PO GRNs (3 completed, none from a PO)', grnOpts.length === 3 && !!uiGrn, JSON.stringify(grnOpts.map((g) => g.grnNumber)));
  await openNewExpense();
  await selectOption('Expense Type', 'Expense Against GRN (Without PO)');
  check('GRN picker appears, labelled GRN (raised without PO) *', await field('GRN (raised without PO) *').isVisible());
  await selectOption('Expense Category', 'Other');
  await pickLink(uiGrn.grnNumber, new RegExp(`^${uiGrn.grnNumber.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&')}\\s·`));
  check('vendor locked to the GRN vendor', (await dialog().getByTestId('expense-vendor').inputValue()) === 'E2E Vendor C (walk-in)');
  check('bill no. prefilled from the GRN supplier invoice', (await dialog().getByLabel('Vendor Bill/Invoice No *', { exact: true }).inputValue()) === 'SUP-UI-9');
  await fill('Basic Value', 1000);
  check('Against GRN: Save as Draft closes the dialog', await saveDraft());
  const [g] = await byBill('SUP-UI-9');
  check('Against GRN saved: GRN linked, no PO, vendor from GRN, net 1000',
    g?.expenseType === 'AGAINST_GRN' && (g.grnNumbers || []).join() === uiGrn.grnNumber && !g.poId && !g.poNumber && g.vendorName === 'E2E Vendor C (walk-in)' && g.netPayableAmount === 1000,
    JSON.stringify(g && { t: g.expenseType, grn: g.grnNumbers, po: g.poNumber, n: g.netPayableAmount }));
  const grnAfter = (await api('/procurement/vouchers/expense-links?type=GRN')).body?.data || [];
  check('a billed GRN leaves the picker', !grnAfter.some((x) => x._id === uiGrn._id) && grnAfter.length === 2);

  section('Server-side rules through the real API');
  const post = (body) => api('/procurement/vouchers', { method: 'POST', body: JSON.stringify({ voucherType: 'EXPENSE', expenseCategory: 'AMC', ...body }) });
  const poUi = ((await api('/procurement/vouchers/expense-links?type=PO&search=PO-EXP-UI2')).body?.data || [])[0];
  const r1 = await post({ expenseType: 'AGAINST_PO', poId: poUi._id, grnId: otherGrns[0]._id, expenseInvoiceNo: 'X1', basicValue: 1 });
  check('Against PO with a GRN too → 422', r1.status === 422 && /grnId/.test(r1.body?.message), `${r1.status} ${r1.body?.message}`);
  const r2 = await post({ expenseType: 'AGAINST_GRN', grnId: uiGrn._id, expenseInvoiceNo: 'X2', basicValue: 1 });
  check('second bill on a billed GRN → 400', r2.status === 400 && /already billed/.test(r2.body?.message), `${r2.status} ${r2.body?.message}`);
  const r3 = await post({ expenseType: 'AGAINST_PO', poId: poUi._id, vendorId: otherGrns[0].vendorId, expenseInvoiceNo: 'X3', basicValue: 1 });
  check('vendor mismatch → 400', r3.status === 400 && /does not match/.test(r3.body?.message), `${r3.status} ${r3.body?.message}`);
  const r4 = await post({ partyName: 'X', poId: poUi._id, basicValue: 1 });
  check('Direct with a poId → 422', r4.status === 422 && /poId/.test(r4.body?.message), `${r4.status} ${r4.body?.message}`);
  const r5 = await post({ expenseType: 'AGAINST_PO', poId: poUi._id, basicValue: 1 });
  check('PO bill without a bill no. → 422', r5.status === 422 && /expenseInvoiceNo/.test(r5.body?.message), `${r5.status} ${r5.body?.message}`);

  section('Duplicate submissions');
  const dupGrn = otherGrns[0];
  await openNewExpense();
  await selectOption('Expense Type', 'Expense Against GRN (Without PO)');
  await selectOption('Expense Category', 'Other');
  await pickLink(dupGrn.grnNumber, new RegExp(`^${dupGrn.grnNumber.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&')}\\s·`));
  await fill('Vendor Bill/Invoice No *', 'SPEC-DUP-1');
  await fill('Basic Value', 300);
  await dialog().getByRole('button', { name: 'Save as Draft' }).dblclick();
  await dialog().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const onDup = (await vouchers()).filter((v) => String(v.grnId) === dupGrn._id && v.voucherStatus !== 'CANCELLED');
  check('double-click on Save: one voucher on the GRN', onDup.length === 1, String(onDup.length));
  const lastGrn = otherGrns[1];
  const parallel = await Promise.all([1, 2].map((n) => post({ expenseType: 'AGAINST_GRN', grnId: lastGrn._id, expenseInvoiceNo: `SPEC-PAR-${n}`, basicValue: 10 })));
  const onLast = (await vouchers()).filter((v) => String(v.grnId) === lastGrn._id && v.voucherStatus !== 'CANCELLED');
  check('two parallel API creates on one GRN: never both kept', onLast.length <= 1 && parallel.some((r) => !r.ok), `${onLast.length} kept; ${parallel.map((r) => r.status).join()}`);

  section('List, detail, edit, post');
  await page.goto(`${APP}/procurement/vouchers`, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.getByText('AMC · PO-EXP-UI', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check('list shows the PO next to the category', await page.getByText('AMC · PO-EXP-UI', { exact: true }).first().isVisible());
  await page.goto(`${APP}/procurement/vouchers/${p._id}`, { waitUntil: 'domcontentloaded' });
  await ready();
  const chip = page.getByTestId('voucher-expense-type');
  await chip.waitFor({ state: 'visible', timeout: 20000 });
  check('detail shows Expense Against PO (Without GRN)', (await chip.innerText()).trim() === 'Expense Against PO (Without GRN)');
  check('detail links the PO', await page.getByRole('button', { name: 'PO-EXP-UI', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await dialog().waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  check('edit opens on Against PO with the PO selected',
    (await field('Expense Type').getByRole('combobox').innerText()).trim() === 'Expense Against PO (Without GRN)'
    && /^PO-EXP-UI ·/.test(await dialog().getByTestId('expense-link').inputValue()), await dialog().getByTestId('expense-link').inputValue());
  await fill('Basic Value', 3000);
  await fill('Taxable Amount', 3000);
  await dialog().getByRole('button', { name: 'Save', exact: true }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  const pEdited = (await api(`/procurement/vouchers/${p._id}`)).body?.data;
  check('edit saved: PO kept, net 3540', pEdited?.poNumber === 'PO-EXP-UI' && pEdited.netPayableAmount === 3540 && pEdited.expenseType === 'AGAINST_PO',
    JSON.stringify(pEdited && { po: pEdited.poNumber, n: pEdited.netPayableAmount }));
  await page.getByRole('button', { name: 'Post Voucher' }).first().click();
  await page.waitForTimeout(2500);
  const pPosted = (await api(`/procurement/vouchers/${p._id}`)).body?.data;
  check('post: POSTED and queued for MD approval', pPosted?.voucherStatus === 'POSTED' && pPosted.approvalStatus === 'READY_FOR_MD_APPROVAL',
    `${pPosted?.voucherStatus} / ${pPosted?.approvalStatus}`);

  section('Purchase Voucher path unchanged; phone width');
  await page.goto(`${APP}/procurement/vouchers`, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.getByRole('button', { name: 'New Voucher' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'New Voucher' }).click();
  await dialog().waitFor({ state: 'visible' });
  check('Purchase Voucher is still the default, with its invoice picker',
    await dialog().getByLabel('Purchase Voucher').isChecked() && await field('Invoice (Payment Pending)').isVisible() && (await dialog().getByTestId('expense-type').count()) === 0);
  await dialog().getByRole('button', { name: 'Cancel' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewExpense();
  await selectOption('Expense Type', 'Expense Against PO (Without GRN)');
  await pickLink('PO-EXP-UI2', /^PO-EXP-UI2\s·/);
  const overflow = await dialog().locator('.MuiDialogContent-root').evaluate((el) => el.scrollWidth - el.clientWidth);
  check('390px: dialog content has no horizontal overflow', overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(SHOTS, 'expenseType-390.png') });
  await dialog().getByRole('button', { name: 'Cancel' }).click();

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();
};

run()
  .catch((err) => { failures.push(`crashed: ${err.stack || err.message}`); console.error(err); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
    process.exit(0);
  });
