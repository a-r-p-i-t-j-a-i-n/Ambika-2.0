/**
 * Purchase Indent items from the SKU Master + Vendor Detail PO history, driven
 * through the real UI in Chromium.
 *
 *   node e2e/indentSkuVendorHistory.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eIndentSkuVendorHistoryFixture.js):
 *   backend  via e2eServer.js against the ambika_e2e_skuvendorhist scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 * Ports default to :5099 / :3100; override with PROBE_API / PROBE_APP.
 * Run `--seed` (re-arms the legacy draft) and `--api` (creates the POs) first.
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
await assertE2ESetup(APP, API, 'indentSkuVendorHistory.e2e.mjs');
const USER = { email: 'skuhist-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/skuvendorhist';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];
const browser = await chromium.launch({ executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));

const ready = async () => {
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForTimeout(150);
};
const go = async (url) => { await page.goto(`${APP}${url}`, { waitUntil: 'domcontentloaded' }); await ready(); };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const snack = async (re) => {
  try { await page.getByText(re).first().waitFor({ timeout: 8000 }); return true; } catch { return false; }
};
const api = (p) => page.evaluate(async ([base, url]) => {
  const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  return r.json();
}, [API, p]);
const pick = async (dialog, typed, optionRe) => {
  const input = dialog.getByPlaceholder('Product name').first();
  await input.click();
  await input.fill(typed);
  await page.getByRole('option').filter({ hasText: optionRe }).first().waitFor({ timeout: 10000 });
  await page.getByRole('option').filter({ hasText: optionRe }).first().click();
  await page.waitForTimeout(300);
};

// ── login ─────────────────────────────────────────────────────────────────────
await go('/');
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
check('login', true);

// ── 1. New indent: SKU Master only ───────────────────────────────────────────
console.log('\n── 1. New indent ──');
await go('/procurement/indents');
await page.getByRole('button', { name: /^Create Indent$/ }).first().click();
const d = page.getByRole('dialog').filter({ hasText: 'New Purchase Indent' });
await d.waitFor();
const codeCell = d.getByTestId('indent-sku-code').first();
check('SKU code cell is read-only', (await codeCell.getAttribute('readonly')) !== null);

const input = d.getByPlaceholder('Product name').first();
await input.click();
await input.fill('Totally free text widget');
await page.waitForTimeout(1200);
check('free text offers no item (nothing to pick)', (await page.getByRole('option').count()) === 0
  || (await page.getByText(/No matching SKU in SKU Master/).count()) > 0);
await d.getByPlaceholder('0').first().click();
await page.waitForTimeout(300);
check('leaving the field keeps no free-text item', (await input.inputValue()) === '' && (await codeCell.inputValue()) === '');

await pick(d, 'SH Bolt', /SH Bolt M8 \(SKU Master name\)/);
check('server search reaches a SKU beyond the first 2,000', (await codeCell.inputValue()) === 'SH-BOLT', await codeCell.inputValue());
check('item name shown is the SKU Master name', (await input.inputValue()) === 'SH Bolt M8 (SKU Master name)');
await d.getByRole('button', { name: 'Add Item' }).click();
await pick({ getByPlaceholder: (p) => d.getByPlaceholder(p).nth(1) }, 'sh-nut', /SH Nut M8/);
check('typing a SKU code finds it too', (await d.getByTestId('indent-sku-code').nth(1).inputValue()) === 'SH-NUT');
const unitCell = (i) => d.getByTestId('indent-unit').nth(i);
check('unit cell is read-only', (await unitCell(0).getAttribute('readonly')) !== null);
check('unit = SKU Master unit (PCS)', (await unitCell(0).inputValue()) === 'PCS', await unitCell(0).inputValue());
check('unit outside the old dropdown shown as stored (Nos, not Pcs)', (await unitCell(1).inputValue()) === 'Nos', await unitCell(1).inputValue());
await d.getByPlaceholder('0').nth(0).fill('7');
await d.getByPlaceholder('0').nth(1).fill('3');
await shot('01-new-indent');
await d.getByRole('button', { name: /^Create Indent$/ }).click();
check('indent created', await snack(/Indent created/));
const latest = ((await api('/procurement/indents?limit=5&sort=-createdAt')).data || [])[0];
check('saved items = SKU Master name + code', latest?.items?.length === 2
  && latest.items[0].itemName === 'SH Bolt M8 (SKU Master name)' && latest.items[0].skuCode === 'SH-BOLT'
  && latest.items[1].itemName === 'SH Nut M8' && latest.items[1].skuCode === 'SH-NUT', JSON.stringify(latest?.items?.map((i) => [i.itemName, i.skuCode, i.quantity])));
check('saved units = SKU Master units', latest?.items?.[0]?.unit === 'PCS' && latest?.items?.[1]?.unit === 'Nos', JSON.stringify(latest?.items?.map((i) => i.unit)));

// ── 2. Legacy hand-typed draft ───────────────────────────────────────────────
console.log('\n── 2. Legacy draft edit ──');
const leg = ((await api('/procurement/indents?search=SH-LEG-DRAFT-UI&limit=5')).data || [])[0];
await go(`/procurement/indents/${leg._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const e = page.getByRole('dialog').filter({ hasText: 'Edit Indent' });
await e.waitFor();
check('legacy row is flagged as not in SKU Master', (await e.getByText(/Not in SKU Master: "Hand typed bracket \(no SKU\)"/).count()) === 1);
await e.getByRole('button', { name: 'Save Changes' }).click();
check('saving is blocked, naming the item', await snack(/"Hand typed bracket \(no SKU\)" is not in SKU Master/));
await shot('02-legacy-flagged');
await pick(e, 'SH Washer', /SH Washer M8/);
check('picked SKU unit shown with its master casing (kg, not KGS)', (await e.getByTestId('indent-unit').first().inputValue()) === 'kg', await e.getByTestId('indent-unit').first().inputValue());
await e.getByRole('button', { name: 'Save Changes' }).click();
check('after picking the SKU it saves', await snack(/Indent updated/));
const legNow = (await api(`/procurement/indents/${leg._id}`)).data;
check('legacy draft item now bound to the SKU', legNow?.items?.[0]?.itemName === 'SH Washer M8' && legNow.items[0].skuCode === 'SH-WASHER' && legNow.items[0].unit === 'kg', legNow?.items?.[0]?.unit);

// ── 3. Vendor PO history ─────────────────────────────────────────────────────
console.log('\n── 3. Vendor Detail: Purchase Order History ──');
const vendors = (await api('/vendors?limit=100')).data || [];
const vA = vendors.find((v) => v.name === 'SH Vendor Alpha');
const vB = vendors.find((v) => v.name === 'SH Vendor Beta');
const posA = (await api(`/procurement/purchase-orders?vendorId=${vA._id}&limit=200`));
const posB = (await api(`/procurement/purchase-orders?vendorId=${vB._id}&limit=200`));
await go(`/procurement/vendors/${vA._id}`);
const hist = page.getByTestId('vendor-po-history');
await hist.getByTestId('vendor-po-row').first().waitFor({ timeout: 15000 });
await hist.scrollIntoViewIfNeeded();
const chip = (await hist.getByTestId('vendor-po-count').innerText()).trim();
check('history count = vendor A\'s POs', chip === `${posA.meta.total} POs` || chip === `${posA.meta.total} PO`, `${chip} vs ${posA.meta.total}`);
const rowsA = await hist.getByTestId('vendor-po-row').evaluateAll((rs) => rs.map((r) => ({ po: r.dataset.po, text: r.innerText })));
check('one row per PO (no duplicates)', new Set(rowsA.map((r) => r.po)).size === rowsA.length, rowsA.map((r) => r.po).join(', '));
const multi = rowsA.find((r) => /SH Bolt M8 \(SKU Master name\) \(SH-BOLT\)/.test(r.text) && /SH Nut M8 \(SH-NUT\)/.test(r.text));
check('a multi-item PO shows both lines (name, SKU, qty) in one row', !!multi);
check('cancelled PO shows CANCELLED; its revision is listed and linked', rowsA.some((r) => /Cancelled/i.test(r.text))
  && rowsA.some((r) => /Revision 1 of AGL\/PO-/.test(r.text)), rowsA.map((r) => r.text.replace(/\s+/g, ' ')).join(' | ').slice(0, 400));
const bNumbers = (posB.data || []).map((p) => p.poNumber || p.draftNumber);
check('Vendor B\'s POs are not on Vendor A\'s page', rowsA.every((r) => !bNumbers.includes(r.po)));
check('legacy Party-id PO not shown', rowsA.every((r) => r.po !== 'SH-LEGACY-PARTY-PO'));
await shot('03-vendor-a-history');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
// The section must fit the phone width — its table scrolls inside its own box.
// (The page header's Pricing History / Edit details buttons already overflow by
// ~3px at 390px with or without this section; that is not checked here.)
check('history section fits 390px; its table scrolls inside it', await hist.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const scroller = el.querySelector('table')?.parentElement;
  return r.right <= window.innerWidth + 1 && scroller && getComputedStyle(scroller).overflowX === 'auto' && scroller.scrollWidth > scroller.clientWidth;
}));
await shot('04-vendor-a-390');
await page.setViewportSize({ width: 1440, height: 950 });
await page.waitForTimeout(300);
const firstPo = rowsA[0].po;
await hist.getByTestId('vendor-po-row').first().click();
await page.waitForURL(/\/procurement\/purchase-orders\/[0-9a-f]{24}/, { timeout: 10000 }).catch(() => {});
check('clicking a row opens that PO', /\/procurement\/purchase-orders\/[0-9a-f]{24}/.test(page.url()) && (await page.getByText(firstPo).count()) > 0, page.url());

await go(`/procurement/vendors/${vB._id}`);
await page.getByTestId('vendor-po-row').first().waitFor({ timeout: 15000 });
const rowsB = await page.getByTestId('vendor-po-row').evaluateAll((rs) => rs.map((r) => r.dataset.po));
const aNumbers = (posA.data || []).map((p) => p.poNumber || p.draftNumber);
check('Vendor B page lists only B\'s POs', rowsB.length === (posB.data || []).length && rowsB.every((n) => !aNumbers.includes(n)), rowsB.join(', '));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
