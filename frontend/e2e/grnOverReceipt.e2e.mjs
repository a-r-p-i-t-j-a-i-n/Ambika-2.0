/**
 * Conditional "Allow Over-Receipt" per GRN line on the Create / Edit GRN form,
 * driven through the real UI in Chromium.
 *
 *   node e2e/grnOverReceipt.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eOverReceiptFixture.js):
 *   backend  via e2eServer.js against the ambika_e2e_over_receipt scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 * Ports default to :5099 / :3100; override with PROBE_API / PROBE_APP.
 *
 * Seed first with `--seed` (+ `--api` optionally); afterwards `--verify` reads the database.
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

const APP = process.env.PROBE_APP || 'http://127.0.0.1:3100';
const API = process.env.PROBE_API || 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'grnOverReceipt.e2e.mjs');
const USER = { email: 'over-receipt-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/grnoverreceipt';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];

const launchOpts = { ignoreDefaultArgs: ['--hide-scrollbars'] };
const exe = findChromium();
const browser = await chromium.launch(exe ? { executablePath: exe, ...launchOpts } : { channel: 'chrome', ...launchOpts });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));

const ready = async () => {
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForTimeout(150);
};
const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const snack = async (re) => {
  try { await page.getByText(re).first().waitFor({ timeout: 8000 }); return true; } catch { return false; }
};
const api = (p) => page.evaluate(async ([base, url]) => {
  const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  return r.json();
}, [API, p]);

const LINE = (code) => `PO-OR-UI|${code}`;
const block = (scope, code) => scope.locator(`[data-testid="grn-over-receipt"][data-line="${LINE(code)}"]`);
const recvInput = (scope, idx) => scope.getByLabel('Received Qty', { exact: true }).nth(idx);
const setRecv = async (scope, idx, v) => {
  const i = recvInput(scope, idx);
  await i.fill(String(v));
  await page.waitForTimeout(250);
};
const shown = async (scope, code) => (await block(scope, code).count()) > 0;
const ticked = (scope, code) => block(scope, code).getByTestId('grn-allow-over-receipt').isChecked();
const tick = async (scope, code) => { await block(scope, code).getByTestId('grn-allow-over-receipt').check(); await page.waitForTimeout(150); };
const IDX = { 'OR-A': 0, 'OR-B': 1, 'OR-C': 2 };

// ── login ─────────────────────────────────────────────────────────────────────
await go(APP);
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
check('login', true);

await go(`${APP}/purchase-fms/grn?view=grn`);
await page.getByRole('button', { name: /new grn/i }).first().waitFor({ timeout: 20000 });
await page.getByRole('button', { name: /new grn/i }).first().click();
const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await form.waitFor();
await form.getByRole('combobox', { name: /purchase order/i }).first().click();
await page.waitForTimeout(600);
await page.getByRole('option', { name: /^PO-OR-UI —/ }).click();
await page.waitForTimeout(1200);
await form.getByText('Material Receipt', { exact: true }).click();
await page.waitForTimeout(300);

console.log('\n── 1. Visibility follows Received Qty vs Pending (A 100, B 50, C 20) ──');
check('3 rows loaded, received = pending → no option anywhere',
  (await form.getByLabel('Received Qty', { exact: true }).count()) === 3 && (await form.getByTestId('grn-over-receipt').count()) === 0);
await setRecv(form, 0, 80);
check('pending 100, received 80 → hidden', !(await shown(form, 'OR-A')));
await setRecv(form, 0, 100);
check('pending 100, received 100 → hidden', !(await shown(form, 'OR-A')));
await setRecv(form, 0, 120);
check('pending 100, received 120 → shown', await shown(form, 'OR-A'));
check('…unticked by default', !(await ticked(form, 'OR-A')));
const warn = (await block(form, 'OR-A').getByTestId('grn-over-receipt-warning').innerText()).replace(/\s+/g, ' ');
check('…warning states the excess (20), the received qty and the pending qty', /20/.test(warn) && /120/.test(warn) && /100 pending/.test(warn), warn);
await shot('01-over-shown');

console.log('\n── 2. Increase, confirm, reduce, increase again ──');
await tick(form, 'OR-A');
check('ticking confirms it', await ticked(form, 'OR-A'));
await setRecv(form, 0, 140);
check('still over (140): still shown AND still confirmed; warning follows (40)',
  (await ticked(form, 'OR-A')) && /40/.test(await block(form, 'OR-A').getByTestId('grn-over-receipt-warning').innerText()));
await setRecv(form, 0, 100);
check('back to 100 → option disappears', !(await shown(form, 'OR-A')));
await setRecv(form, 0, 120);
check('120 again → shown UNTICKED (the earlier approval was not silently kept)', (await shown(form, 'OR-A')) && !(await ticked(form, 'OR-A')));

console.log('\n── 3. Independent per line (only one exceeds) ──');
await tick(form, 'OR-A');
await setRecv(form, 1, 60);
check('B over (60 > 50) shows its own option, unticked; A keeps its tick',
  (await shown(form, 'OR-B')) && !(await ticked(form, 'OR-B')) && (await ticked(form, 'OR-A')));
check('C (20 = pending) has none', !(await shown(form, 'OR-C')));
await setRecv(form, 1, 50);
check('B back to 50 → B hidden; A untouched', !(await shown(form, 'OR-B')) && (await ticked(form, 'OR-A')));
check('exactly one option on screen', (await form.getByTestId('grn-over-receipt').count()) === 1);

console.log('\n── 4. Save without confirmation is refused ──');
const gate = await api('/procurement/grns?limit=100');
const countBefore = (gate.data || []).filter((g) => (g.poNumbers || []).includes('PO-OR-UI')).length;
await page.getByTestId('grn-allow-over-receipt').first().uncheck();
await page.waitForTimeout(200);
await form.getByPlaceholder('required (extra)').first().fill('Vendor sent extra, accepted');
await form.getByRole('button', { name: 'Save as Draft' }).click();
check('warns to tick Allow Over-Receipt or reduce the qty', await snack(/tick Allow Over-Receipt/i));
const gate2 = await api('/procurement/grns?limit=100');
check('…nothing was saved', (gate2.data || []).filter((g) => (g.poNumbers || []).includes('PO-OR-UI')).length === countBefore);

console.log('\n── 5. Save draft with confirmation, then reopen ──');
await setRecv(form, 0, 150);
await tick(form, 'OR-A');
await form.getByRole('button', { name: 'Save as Draft' }).click();
check('draft saved', await snack(/created \(draft\)/));
const list = await api('/procurement/grns?limit=100');
const draft = (list.data || []).find((g) => (g.poNumbers || []).includes('PO-OR-UI'));
const flagOf = (g, code) => g.items.find((l) => l.skuCode === code);
check('saved: A 150 with consent, extra 50 (API)', flagOf(draft, 'OR-A').receivedQty === 150 && flagOf(draft, 'OR-A').allowOverReceipt === true && flagOf(draft, 'OR-A').extraQty === 50);
check('saved: B and C carry no consent', !flagOf(draft, 'OR-B').allowOverReceipt && !flagOf(draft, 'OR-C').allowOverReceipt);
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(500);
await go(`${APP}/procurement/grns/${draft._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const edit = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await edit.waitFor();
await recvInput(edit, 0).waitFor({ timeout: 15000 });
check('reopened: A shown and still confirmed', (await shown(edit, 'OR-A')) && (await ticked(edit, 'OR-A')));
check('reopened: B, C show nothing', !(await shown(edit, 'OR-B')) && !(await shown(edit, 'OR-C')));
await shot('02-reopened');

console.log('\n── 6. Edit the saved GRN ──');
await setRecv(edit, 0, 100);
check('edit: reduce A to 100 → option disappears', !(await shown(edit, 'OR-A')));
await edit.getByRole('button', { name: 'Save as Draft' }).click();
check('edit saved', await snack(/GRN updated/));
await page.waitForTimeout(500);
const afterReduce = flagOf((await api(`/procurement/grns/${draft._id}`)).data, 'OR-A');
check('saved consent cleared (API)', afterReduce.receivedQty === 100 && afterReduce.allowOverReceipt === false && afterReduce.extraQty === 0);
await go(`${APP}/procurement/grns/${draft._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const edit2 = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await edit2.waitFor();
await recvInput(edit2, 0).waitFor({ timeout: 15000 });
await setRecv(edit2, 0, 150);
check('raise A to 150 again → shown unticked', (await shown(edit2, 'OR-A')) && !(await ticked(edit2, 'OR-A')));
await tick(edit2, 'OR-A');
await edit2.getByPlaceholder('required (extra)').first().fill('Vendor sent extra, accepted').catch(() => {});
await edit2.getByRole('button', { name: 'Save as Draft' }).click();
check('edit saved with consent', await snack(/GRN updated/));
await page.waitForTimeout(500);

console.log('\n── 7. Complete GRN ──');
// Saving closes the dialog; Complete GRN + QC lives in the reopened edit form.
await go(`${APP}/procurement/grns/${draft._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const edit3 = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await edit3.waitFor();
await recvInput(edit3, 0).waitFor({ timeout: 15000 });
check('reopened again: consent persisted (150, confirmed)', (await ticked(edit3, 'OR-A')) && (await recvInput(edit3, 0).inputValue()) === '150');
await edit3.getByRole('button', { name: 'Complete GRN + QC' }).first().click();
const completeDlg = page.getByRole('dialog').filter({ hasText: 'This finalises the receipt' });
await completeDlg.waitFor({ timeout: 15000 });
check('Complete dialog recognises the line consent (no second tick asked for)',
  (await completeDlg.getByTestId('grn-complete-over-confirmed').count()) === 1
  && (await completeDlg.getByRole('checkbox', { name: /Allow over-receipt/i }).count()) === 0);
await shot('03-complete-dialog');
await completeDlg.getByRole('button', { name: 'Complete GRN', exact: true }).click();
check('finalized', await snack(/GRN completed/));
await page.waitForTimeout(800);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
