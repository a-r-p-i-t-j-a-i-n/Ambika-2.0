/**
 * Browser spec — Vendor Invoice → Payment Voucher: approval prepares the draft
 * voucher, the two-record explanation, the renamed "All Payment Vouchers" entry.
 *
 *   backend (own scratch DB, guarded):
 *     node src/scripts/e2eInvoiceVoucherFixture.js --seed-ui
 *     PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_invvoucher node src/scripts/e2eServer.js   (AWS, BREVO and SMTP vars blanked)
 *   frontend: VITE_API_URL=http://127.0.0.1:5097/api/v1 node node_modules/vite/bin/vite.js --port 3102 --host 127.0.0.1 --strictPort
 *   run:      node e2e/invoiceVoucher.e2e.mjs        (APP / API env override the defaults)
 * Login: invvoucher-e2e@test.local / E2e@12345 (MD).
 */
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';

const APP = process.env.APP || 'http://127.0.0.1:3102';
const API = process.env.API || 'http://127.0.0.1:5097/api/v1';
await assertE2ESetup(APP, API, 'invoiceVoucher.e2e.mjs');

let fails = 0; let passes = 0;
const check = (label, ok, detail = '') => { if (ok) passes += 1; else fails += 1; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 300)}` : ''}`); };
const consoleErrors = []; const apiErrors = [];

const browser = await chromium.launch({ channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 160)}`); });
page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1].split('?')[0]}`); });
const flat = (t) => t.replace(/\s+/g, ' ');
const body = async () => flat(await page.locator('body').innerText());
const boot = () => page.evaluate(() => document.getElementById('initial-boot')?.remove());
const go = async (u) => { await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#root > *'); await boot(); await page.waitForTimeout(1200); };
const waitText = async (rx, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (rx.test(await body())) return true; await page.waitForTimeout(250); } return false; };

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#root > *'); await boot();
await page.locator('input[autocomplete="email"]').fill('invvoucher-e2e@test.local');
await page.locator('input[autocomplete="current-password"]').fill('E2e@12345');
await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 90000 });
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
const token = await page.evaluate(() => Object.values(localStorage).find((v) => /^eyJ/.test(v)) || null);
const api = async (p) => (await (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } })).json());
const invId = async (no) => (await api(`/procurement/vendor-invoices?search=${no}&limit=5`)).data.find((i) => i.invoiceNumber === no)._id;
const liveVouchers = async (id) => (await api(`/procurement/vouchers/by-invoice/${id}`)).data.filter((v) => v.voucherStatus !== 'CANCELLED');

console.log('\n[Vendor Invoices & Payments page]');
await go('/purchase-fms/invoices-payments');
await waitText(/Vendor Invoice — the supplier's bill/);
let t = await body();
check('explainer explains the invoice vs the voucher', /Vendor Invoice — the supplier's bill/.test(t) && /Payment Voucher — our accounting document/.test(t));
check('lifecycle shows the five stages', ['Record supplier invoice', 'Prepare & approve voucher', 'Post to Tally', 'Record payment', 'Track balance'].every((s) => t.includes(s)));
check('old "Expense / All Vouchers" label and "Step 1.10–1.11" are gone', !/Expense \/ All Vouchers/.test(t) && !/Step 1\.10–1\.11/.test(t));
const allBtn = page.getByRole('button', { name: 'All Payment Vouchers (incl. Expense & Direct Purchase)' });
check('"All Payment Vouchers (incl. Expense & Direct Purchase)" button present', await allBtn.count() === 1);
await page.getByRole('button', { name: 'Hide' }).first().click();
await page.waitForTimeout(300);
check('explainer can be hidden (and the choice is only a convenience)', !/Vendor Invoice — the supplier's bill/.test(await body()));
await page.getByRole('button', { name: 'Show' }).first().click();

console.log('\n[navigation to the standalone vouchers page]');
await allBtn.click();
await page.waitForURL(/\/procurement\/vouchers$/);
await waitText(/All Payment Vouchers \(\d+\)/);
t = await body();
check('standalone page is titled "All Payment Vouchers" and says what is in it', /All Payment Vouchers \(\d+\)/.test(t) && /Expense and Direct Purchase vouchers that have no invoice/.test(t));
check('no "Step 1.11" wording on the page', !/Step 1\.11/.test(t));
check('"New Voucher" (Expense / Direct Purchase) still available', await page.getByRole('button', { name: 'New Voucher' }).count() >= 1);
check('seeded auto-prepared voucher is listed', await waitText(/AGL\/PUR-001/));
await page.getByRole('button', { name: 'New Voucher' }).click();
await waitText(/Expense/);
check('the form still offers Expense and Direct Purchase types', /Expense/.test(await body()) && /Direct Purchase/i.test(await body()));
await page.getByRole('button', { name: 'Cancel' }).click();

console.log('\n[approve an invoice in the UI → draft voucher prepared]');
const hId = await invId('INV-IV-H');
check('before: invoice H has no voucher', (await liveVouchers(hId)).length === 0);
await go(`/procurement/vendor-invoices/${hId}`);
await waitText(/Approve \/ Reject/);
t = await body();
check('banner: approving prepares the draft voucher', /Approving it prepares the draft Payment Voucher automatically/.test(t));
await page.getByRole('button', { name: 'Approve / Reject' }).first().click();
await page.getByRole('button', { name: 'Approve', exact: true }).click();
const toast = await waitText(/draft voucher AGL\/PUR-\d+\/26-27 prepared\. Review & Post it next\./);
check('toast names the prepared voucher number', toast, (await body()).slice(0, 200));
await page.waitForTimeout(1500);
const lv = await liveVouchers(hId);
check('exactly one live DRAFT purchase voucher now exists', lv.length === 1 && lv[0].voucherStatus === 'DRAFT' && lv[0].voucherType === 'PURCHASE');
t = await body();
check('detail shows the voucher number in the Payment Voucher section + caption', new RegExp(`Payment Voucher · ${lv[0].voucherNumber.replace(/\//g, '\\/')}`).test(t) && /prepared when the invoice was approved/.test(t));
check('"Review & Post Voucher" action offered; no manual "Create Voucher"', await page.getByRole('button', { name: 'Review & Post Voucher' }).count() >= 1 && await page.getByRole('button', { name: 'Create Voucher' }).count() === 0);
check('lifecycle stepper shows Voucher step', /Voucher/.test(t));

console.log('\n[Review & Post from the invoice page]');
await page.getByRole('button', { name: 'Review & Post Voucher' }).first().click();
await waitText(/Posted/i);
await page.waitForTimeout(1500);
const posted = (await liveVouchers(hId))[0];
check('voucher is POSTED, still the invoice\'s only live voucher', posted?.voucherStatus === 'POSTED' && (await liveVouchers(hId)).length === 1, posted?.voucherStatus);
check('next step is now the Tally Entry', /Create Tally Entry/.test(await body()));

console.log('\n[older approved invoice (no voucher): manual fallback, no duplicate]');
const dId = await invId('INV-IV-D');
await go(`/procurement/vendor-invoices/${dId}`);
await waitText(/Voucher Not Created/);
t = await body();
check('explains this is an older invoice and Create Voucher will not duplicate', /approved before vouchers were prepared automatically/.test(t) && /will not create a duplicate/.test(t));
await page.getByRole('button', { name: 'Create Voucher' }).first().click();
await page.getByRole('button', { name: 'Save as Draft' }).click();
await page.waitForTimeout(2000);
check('Create Voucher fallback creates exactly one draft', (await liveVouchers(dId)).length === 1);
await go(`/procurement/vendor-invoices/${dId}`);
check('then the Create Voucher button is gone', await page.getByRole('button', { name: 'Create Voucher' }).count() === 0);

console.log('\n[list: Voucher column]');
await go('/purchase-fms/invoices-payments');
await page.getByRole('button', { name: 'All', exact: true }).first().click().catch(() => {});
await page.waitForTimeout(1500);
t = await body();
check('invoice rows show their voucher numbers', /AGL\/PUR-00\d/.test(t));
check('"Awaiting Voucher (older / retry)" chip label', /Awaiting Voucher \(older \/ retry\)/.test(t));
await page.getByRole('button', { name: /Awaiting Voucher/ }).first().click().catch(() => {});
await page.waitForTimeout(1200);
check('Awaiting Voucher filter no longer lists the approved invoices that now have vouchers', !/INV-IV-H/.test(await body()) && !/INV-IV-D/.test(await body()));

const realConsole = consoleErrors.filter((e) => !/favicon|Failed to load resource/.test(e));
check('no console errors', realConsole.length === 0, realConsole.join(' | '));
check('no unexpected 4xx/5xx API responses', apiErrors.length === 0, apiErrors.join(' | '));
console.log(`\n${fails ? `FAILED — ${fails} failed, ${passes} passed` : `ALL ${passes} CHECKS PASSED`}\n`);
await browser.close();
process.exit(fails ? 1 : 0);
