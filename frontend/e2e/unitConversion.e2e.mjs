/**
 * SKU purchase-unit conversion (1 BOX = 25 PCS), driven through the real UI in
 * Chromium: SKU Master configuration + validation, the Indent unit, the GRN and
 * Incoming QC detail pages, and the SKU drawer at phone width.
 *
 *   node e2e/unitConversion.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eUnitConversionFixture.js):
 *   backend  via e2eServer.js against the ambika_e2e_unitconv scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 * Ports default to :5099 / :3100; override with PROBE_API / PROBE_APP.
 * Run the fixture's `--api` on :27017 first — it leaves UC-GLOVE at
 * 1 BOX = 30 PCS with its first GRN frozen at ×25. Nothing here saves a
 * change: every edit is refused or cancelled, so the spec is re-runnable.
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
await assertE2ESetup(APP, API, 'unitConversion.e2e.mjs');
const USER = { email: 'unitconv-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/unitconv';
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
const api = (p) => page.evaluate(async ([base, url]) => {
  const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  return r.json();
}, [API, p]);
const textOf = async (sel) => (await page.locator(sel).allInnerTexts()).join(' | ');
// The actions column sits past the grid's sideways scroll at 1440px (the grid
// was already wider than the page before this feature) and MUI X does not
// render off-screen columns — scroll it into view before clicking Edit.
// The row is pinned by its id first: once scrolled right, a narrow screen no
// longer renders the name column, so the row cannot be found by its text.
const editRow = async (name) => {
  const id = await page.locator('.MuiDataGrid-row').filter({ hasText: name }).first().getAttribute('data-id');
  await page.evaluate(() => { const v = document.querySelector('.MuiDataGrid-virtualScroller'); if (v) v.scrollLeft = v.scrollWidth; });
  await page.waitForTimeout(500);
  await page.locator(`.MuiDataGrid-row[data-id="${id}"]`).getByRole('button', { name: 'Edit SKU' }).click({ timeout: 10000 });
};

// ── login ─────────────────────────────────────────────────────────────────────
await go('/');
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
check('login', true);

const gloveRes = await api('/skus/lookup/list?search=UC-GLOVE');
const glove = (gloveRes.data || []).find((s) => s.code === 'UC-GLOVE');
check('fixture data present (UC-GLOVE, 1 BOX = 30 PCS)', glove?.purchaseUnit === 'BOX' && glove?.purchaseConversionFactor === 30,
  JSON.stringify({ u: glove?.unit, pu: glove?.purchaseUnit, f: glove?.purchaseConversionFactor }));

// ── SKU Master ───────────────────────────────────────────────────────────────
console.log('\n── SKU Master');
await go('/skus');
await page.getByPlaceholder('Search SKU item or code').fill('UC-');
await page.getByText('UC Nitrile Gloves').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
const grid = await page.locator('.MuiDataGrid-root').innerText();
check('list shows the rule per SKU: 1 BOX = 30 PCS and 1 BOX = 24 PCS', /1 BOX = 30 PCS/.test(grid) && /1 BOX = 24 PCS/.test(grid));
await shot('01-sku-list');

await editRow('UC Nitrile Gloves');
const drawer = page.locator('.MuiDrawer-paper').filter({ hasText: 'Edit SKU Item' });
await drawer.waitFor({ timeout: 10000 });
check('drawer: Stock Unit PCS, Purchase Unit BOX, factor 30',
  (await drawer.getByTestId('sku-stock-unit').inputValue()) === 'PCS'
  && (await drawer.getByTestId('sku-purchase-unit').inputValue()) === 'BOX'
  && (await drawer.getByTestId('sku-conversion-factor').inputValue()) === '30');
const rule = await drawer.getByTestId('sku-conversion-rule').innerText();
check('drawer explains the rule and that only future receipts change', /1 BOX = 30 PCS/.test(rule) && /future receipts only/.test(rule), rule.slice(0, 120));
await shot('02-sku-drawer');

await drawer.getByTestId('sku-conversion-factor').fill('0');
const err0 = await drawer.locator('.Mui-error').allInnerTexts();
check('factor 0 shows a validation error in the field', err0.join(' ').includes('greater than zero'), err0.join(' | ').slice(0, 120));
await drawer.getByRole('button', { name: /save changes/i }).click();
const warned = await page.getByText(/greater than zero/).first().isVisible().catch(() => false);
await page.waitForTimeout(500);
const after0 = (await api('/skus/lookup/list?search=UC-GLOVE')).data.find((s) => s.code === 'UC-GLOVE');
check('…Save is refused in the form and nothing is stored', warned && after0.purchaseConversionFactor === 30);
await drawer.getByTestId('sku-conversion-factor').fill('');
check('a blank factor asks how many PCS are in 1 BOX', (await drawer.locator('.Mui-error').allInnerTexts()).join(' ').includes('how many PCS are in 1 BOX'));
await drawer.getByTestId('sku-convert-no').check();
await page.waitForTimeout(150);
check('answering "No" hides the conversion fields and warns that future receipts stop converting',
  !(await drawer.getByTestId('sku-purchase-conversion').isVisible().catch(() => false))
  && /stops converting future receipts \(1 BOX = 30 PCS today\)/.test(await drawer.innerText()));
await drawer.getByRole('button', { name: /^cancel$/i }).click();
await page.waitForTimeout(300);
const afterCancel = (await api('/skus/lookup/list?search=UC-GLOVE')).data.find((s) => s.code === 'UC-GLOVE');
check('cancel stores nothing (still 1 BOX = 30 PCS)', afterCancel.purchaseUnit === 'BOX' && afterCancel.purchaseConversionFactor === 30);

// ── Register a new SKU: the Yes / No question ────────────────────────────────
console.log('\n── Register New SKU: 1 BOX = 15 PCS');
const newCode = `UC-UI-${Date.now().toString(36).toUpperCase()}`;
await page.getByRole('button', { name: /register sku/i }).first().click();
const reg = page.locator('.MuiDrawer-paper').filter({ hasText: 'Register New SKU' });
await reg.waitFor({ timeout: 10000 });
check('the first question defaults to "No", with no conversion fields shown',
  await reg.getByTestId('sku-convert-no').isChecked()
  && /Do you want to convert the purchase unit into the IMS stock unit\?/.test(await reg.getByTestId('sku-convert-question').innerText())
  && !(await reg.getByTestId('sku-purchase-conversion').isVisible().catch(() => false)));
await reg.getByTestId('sku-convert-yes').check();
await reg.getByTestId('sku-purchase-conversion').waitFor({ timeout: 5000 });
const labels = (await reg.getByTestId('sku-purchase-conversion').locator('label').allInnerTexts()).map((s) => s.replace(/\s*\*$/, '').trim());
check('"Yes" shows the fields in order: Item Name, Converted Item Name, Purchase Unit, Factor, IMS Stock Unit, IMS Model',
  JSON.stringify(labels.slice(0, 6)) === JSON.stringify(['1. Item Name', '2. Converted Item Name (optional)', '3. Purchase Unit', '4. Conversion Factor', '5. IMS Stock Unit', '6. Save in IMS Model']),
  labels.join(' | '));
await reg.getByLabel('SKU Code').fill(newCode);
await reg.getByTestId('sku-item-name').fill(`UC UI Cup ${newCode}`);
// The mistake the old form let through: pieces bought, boxes stocked.
await reg.getByTestId('sku-purchase-unit').fill('PCS');
await reg.getByTestId('sku-conversion-factor').fill('15');
await reg.getByTestId('sku-stock-unit').fill('Box');
await page.waitForTimeout(200);
const revText = await reg.getByTestId('sku-purchase-conversion').innerText();
check('Purchase PCS + IMS Box is flagged "wrong way round", never shown as a valid rule',
  /Wrong way round/i.test(revText) && !(await reg.locator('.MuiAlert-standardInfo').filter({ hasText: '1 PCS = 15' }).count()), revText.match(/Wrong way round[^.]*\./i)?.[0]);
await reg.getByRole('button', { name: /register sku/i }).click();
await page.waitForTimeout(600);
check('…and Save is refused', !(await api(`/skus/lookup/list?search=${newCode}`)).data.length);
await reg.getByTestId('sku-purchase-unit').fill('BOX');
await reg.getByTestId('sku-stock-unit').fill('PCS');
await reg.getByTestId('sku-ims-model').click().catch(() => {});
await page.getByRole('option', { name: 'Consumable' }).first().click().catch(async () => {
  await reg.getByLabel('6. Save in IMS Model').click(); await page.getByRole('option', { name: /Consumable/ }).first().click();
});
await page.waitForTimeout(200);
const okRule = await reg.getByTestId('sku-conversion-rule').innerText();
check('preview reads 1 BOX = 15 PCS — 5 BOX received = 75 PCS', /1 BOX = 15 PCS/.test(okRule) && /5 BOX received = 75 PCS/.test(okRule), okRule.slice(0, 120));
await shot('02b-register-yes');
await reg.getByRole('button', { name: /register sku/i }).click();
await page.getByText('SKU registered').first().waitFor({ timeout: 10000 }).catch(() => {});
const saved = (await api(`/skus/lookup/list?search=${newCode}`)).data.find((s) => s.code === newCode);
check('stored as purchaseUnit BOX, factor 15, unit PCS, Consumable',
  saved?.purchaseUnit === 'BOX' && saved?.purchaseConversionFactor === 15 && saved?.unit === 'PCS' && saved?.itemType === 'CONSUMABLE',
  JSON.stringify({ pu: saved?.purchaseUnit, f: saved?.purchaseConversionFactor, u: saved?.unit, t: saved?.itemType }));
await page.getByPlaceholder('Search SKU item or code').fill(newCode);
await page.waitForTimeout(1200);
await editRow(newCode);
const reopen = page.locator('.MuiDrawer-paper').filter({ hasText: 'Edit SKU Item' });
await reopen.waitFor({ timeout: 10000 });
check('reopening shows Yes, BOX, 15, PCS and 1 BOX = 15 PCS',
  await reopen.getByTestId('sku-convert-yes').isChecked()
  && (await reopen.getByTestId('sku-purchase-unit').inputValue()) === 'BOX'
  && (await reopen.getByTestId('sku-conversion-factor').inputValue()) === '15'
  && (await reopen.getByTestId('sku-stock-unit').inputValue()) === 'PCS'
  && /1 BOX = 15 PCS/.test(await reopen.getByTestId('sku-conversion-rule').innerText()));
await reopen.getByRole('button', { name: /^cancel$/i }).click();

// A plain SKU registered with "No" behaves like every existing SKU.
await page.getByRole('button', { name: /register sku/i }).first().click();
const reg2 = page.locator('.MuiDrawer-paper').filter({ hasText: 'Register New SKU' });
await reg2.waitFor({ timeout: 10000 });
const plainCode = `${newCode}-P`;
await reg2.getByLabel('SKU Code').fill(plainCode);
await reg2.getByTestId('sku-item-name').fill(`UC UI Plain ${plainCode}`);
await reg2.getByRole('button', { name: /register sku/i }).click();
await page.getByText('SKU registered').first().waitFor({ timeout: 10000 }).catch(() => {});
const plainSaved = (await api(`/skus/lookup/list?search=${plainCode}`)).data.find((s) => s.code === plainCode);
check('"No" saves a plain SKU: unit PCS, no purchase unit, no factor',
  plainSaved?.unit === 'PCS' && !plainSaved?.purchaseUnit && plainSaved?.purchaseConversionFactor == null, JSON.stringify(plainSaved && { u: plainSaved.unit, pu: plainSaved.purchaseUnit }));

// ── IMS shows PCS ────────────────────────────────────────────────────────────
console.log('\n── IMS stock in PCS');
await go('/ims/stock');
await page.getByText('UC Paper Cup').first().waitFor({ timeout: 15000 }).catch(() => {});
const cupLine = await page.locator('tr, .MuiDataGrid-row').filter({ hasText: 'UC Paper Cup' }).first().innerText().catch(() => '');
check('IMS stock list shows the cup at 65 in PCS', /65/.test(cupLine) && /PCS/i.test(cupLine), cupLine.replace(/\s+/g, ' ').slice(0, 160));

// ── Indent ───────────────────────────────────────────────────────────────────
console.log('\n── Purchase Indent');
await go('/procurement/indents');
await page.getByRole('button', { name: /create|new indent|raise/i }).first().click().catch(() => {});
const quick = page.getByRole('menuitem', { name: /indent/i }).first();
if (await quick.isVisible().catch(() => false)) await quick.click();
const idrawer = page.locator('.MuiDrawer-paper, .MuiDialog-paper').filter({ hasText: /Indent/ }).last();
const picker = idrawer.getByTestId('indent-sku-picker').first();
const pickerOpen = await picker.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
if (pickerOpen) {
  await picker.click();
  await picker.fill('UC Nitrile');
  await page.getByRole('option').filter({ hasText: 'UC Nitrile Gloves' }).first().click({ timeout: 10000 });
  await page.waitForTimeout(300);
  const unit = await idrawer.getByTestId('indent-unit').first().inputValue();
  const help = await textOf('[data-testid="indent-unit-rule"]');
  check('indent line takes the purchase unit BOX and shows 1 BOX = 30 PCS', unit === 'BOX' && /1 BOX = 30 PCS/.test(help), `${unit} · ${help}`);
  await shot('03-indent');
  await page.keyboard.press('Escape');
} else {
  check('indent form opened', false, 'could not find the indent SKU picker');
}

// ── GRN detail ───────────────────────────────────────────────────────────────
console.log('\n── GRN / QC detail');
const grns = await api('/procurement/grns?limit=50');
const g1 = (grns.data || grns.docs || []).find((g) => (g.items || []).some((l) => l.skuCode === 'UC-GLOVE' && l.conversionFactor === 25));
check('the first glove GRN is found', !!g1, g1?.grnNumber);
if (g1) {
  await go(`/procurement/grns/${g1._id}`);
  await page.getByTestId('grn-line-conversion').first().waitFor({ timeout: 15000 });
  const conv = await textOf('[data-testid="grn-line-conversion"]');
  check('GRN line: 1 BOX = 25 PCS · 5 BOX = 125 PCS (the frozen ×25, not today\'s ×30)', /1 BOX = 25 PCS · 5 BOX = 125 PCS/.test(conv), conv.slice(0, 160));
  const stock = await textOf('[data-testid="grn-line-stock"]');
  check('stock column: Posted 5 BOX = 125 PCS', /5 BOX = 125 PCS/.test(stock), stock.slice(0, 200));
  // The movements load after the lines.
  await page.getByText('5 BOX × 25').first().waitFor({ timeout: 15000 }).catch(() => {});
  const body = await page.locator('body').innerText();
  check('inventory updates show +125 PCS from 5 BOX × 25', /\+125 PCS/.test(body) && /5 BOX × 25/.test(body));
  await shot('04-grn-detail');

  const qcs = await api(`/procurement/incoming-qc?grnId=${g1._id}`);
  const qc = (qcs.data || qcs.docs || []).find((q) => String(q.grnId?._id || q.grnId) === String(g1._id)) || (qcs.data || [])[0];
  if (qc) {
    await go(`/procurement/incoming-qc/${qc._id}`);
    await page.getByTestId('qc-line-conversion').first().waitFor({ timeout: 15000 });
    const qconv = await textOf('[data-testid="qc-line-conversion"]');
    check('QC detail: accepted 5 BOX = 125 PCS', /1 BOX = 25 PCS · accepted 5 BOX = 125 PCS/.test(qconv), qconv.slice(0, 160));
    await shot('05-qc-detail');
  } else {
    check('QC detail', false, 'no QC found for the GRN');
  }
}

// ── Phone width ──────────────────────────────────────────────────────────────
console.log('\n── SKU drawer at 390px');
await page.setViewportSize({ width: 390, height: 844 });
await go('/skus');
await page.getByPlaceholder('Search SKU item or code').fill('UC-GLOVE');
await page.getByText('UC Nitrile Gloves').first().waitFor({ timeout: 15000 });
await editRow('UC Nitrile Gloves');
const mdrawer = page.locator('.MuiDrawer-paper').filter({ hasText: 'Edit SKU Item' });
await mdrawer.waitFor({ timeout: 10000 });
await mdrawer.getByTestId('sku-purchase-conversion').scrollIntoViewIfNeeded();
const fit = await page.evaluate(() => {
  const box = document.querySelector('[data-testid="sku-purchase-conversion"]').getBoundingClientRect();
  const paper = document.querySelector('.MuiDrawer-paper');
  return { right: box.right, vw: window.innerWidth, paperOverflow: paper.scrollWidth - paper.clientWidth };
});
check('conversion section fits the phone width (no sideways scroll)', fit.right <= fit.vw && fit.paperOverflow <= 1, JSON.stringify(fit));
await shot('06-sku-drawer-390');

check('no page errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 300));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n[unitConversion.e2e] ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
