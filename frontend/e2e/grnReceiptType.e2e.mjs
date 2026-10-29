/**
 * Material Receipt Type per SKU row on the Create / Edit GRN form, driven
 * through the real UI in Chromium.
 *
 *   node e2e/grnReceiptType.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eGrnReceiptTypeFixture.js):
 *   backend  via e2eServer.js against the ambika_e2e_grn_receipt_type scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 * Ports default to :5099 / :3100; override with PROBE_API / PROBE_APP.
 *
 * Seed first with `--seed`; afterwards `--verify` reads the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
await assertE2ESetup(APP, API, 'grnReceiptType.e2e.mjs');
const USER = { email: 'grn-receipt-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/grnreceipttype';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];

// Scrollbars visible, so a horizontal overflow cannot hide behind headless mode.
const browser = await chromium.launch({ executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });
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

/** Text runs of a pdfkit PDF (inflates content streams, joins TJ hex pieces). */
const pdfText = (buf) => {
  const out = [];
  const raw = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const tj of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return out;
};

const sel = (scope, line) => scope.locator(`[data-testid="grn-line-receipt-type"][data-line="${line}"]`);
const typeOf = async (scope, line) => (await sel(scope, line).innerText()).trim();
const choose = async (scope, line, label) => {
  await sel(scope, line).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.waitForTimeout(200);
};
const allTypes = async (scope) => {
  const loc = scope.getByTestId('grn-line-receipt-type');
  const out = {};
  for (let i = 0; i < await loc.count(); i += 1) {
    out[await loc.nth(i).getAttribute('data-line')] = (await loc.nth(i).innerText()).trim();
  }
  return out;
};
const same = (a, b) => {
  const s = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
  return s(a) === s(b);
};
const pickPo = async (form, re) => {
  await form.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('option', { name: re }).click();
  await page.waitForTimeout(1200);
  // Blur the picker by clicking the title (Escape would close the GRN dialog itself).
  await form.getByText('Material Receipt', { exact: true }).click();
  await page.waitForTimeout(300);
};

/** No horizontal overflow: page, dialog body, every row; each dropdown inside its row and showing its whole label. */
const layoutAudit = (form) => form.evaluate((dlg) => {
  const problems = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`page ${document.documentElement.scrollWidth}>${window.innerWidth}`);
  const body = [...dlg.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto');
  if (body && body.scrollWidth > body.clientWidth + 1) problems.push(`dialog body ${body.scrollWidth}>${body.clientWidth}`);
  for (const s of dlg.querySelectorAll('[data-testid="grn-line-receipt-type"]')) {
    let r = s.parentElement; while (r && getComputedStyle(r).display !== 'grid') r = r.parentElement;
    const a = s.getBoundingClientRect(); const b = r?.getBoundingClientRect();
    if (b && (a.left < b.left - 1 || a.right > b.right + 1)) problems.push(`select ${s.dataset.line} outside its row`);
    if (s.scrollWidth > s.clientWidth + 1) problems.push(`select ${s.dataset.line} label cut (${s.scrollWidth}>${s.clientWidth})`);
    if (r && r.scrollWidth > r.clientWidth + 1) problems.push(`row of ${s.dataset.line} overflows`);
  }
  return problems;
});

// ── login ─────────────────────────────────────────────────────────────────────
await go(APP);
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
check('login', true);

// ── 1. Header no longer has the dropdown ─────────────────────────────────────
console.log('\n── 1. GRN Header ──');
await go(`${APP}/purchase-fms/grn?view=grn`);
await page.getByRole('button', { name: /new grn/i }).first().waitFor({ timeout: 20000 });
await page.getByRole('button', { name: /new grn/i }).first().click();
const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await form.waitFor();
const headerPaper = form.locator('.MuiPaper-root').filter({ hasText: 'GRN Header' }).first();
check('no Material Receipt Type in the GRN Header', (await headerPaper.getByText('Material Receipt Type').count()) === 0
  && (await form.getByRole('combobox', { name: /Material Receipt Type/ }).count()) === 0);
for (const l of ['GRN Date', 'Challan No', 'Invoice No', 'Invoice Date', 'Vehicle No', 'Received By', 'Prepared By']) {
  check(`header still has ${l}`, (await headerPaper.getByLabel(l, { exact: true }).count()) > 0);
}

// ── 2. Rows, independent choices, multi-PO add/remove ────────────────────────
console.log('\n── 2. Per-row dropdowns ──');
await pickPo(form, /^PO-RT-UI-A —/);
check('one dropdown per SKU row (PO A: 2)', (await form.getByTestId('grn-line-receipt-type').count()) === 2);
check('dropdowns live in the Material Receipt section, not the header', (await headerPaper.getByTestId('grn-line-receipt-type').count()) === 0);
check('rows start at FULL MATERIAL RECEIVED (old header default)', Object.values(await allTypes(form)).every((t) => t === 'FULL MATERIAL RECEIVED'));
const menuOpts = async () => {
  await sel(form, 'PO-RT-UI-A|RT-NUT').click();
  const o = (await page.getByRole('option').allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  return o;
};
check('same options + labels as before', same(Object.fromEntries((await menuOpts()).map((o) => [o, 1])),
  { 'FULL MATERIAL RECEIVED': 1, 'PARTIAL RECEIVED': 1, 'EXTRA RECEIVED': 1, 'DAMAGED RECEIVED': 1 }));
await choose(form, 'PO-RT-UI-A|RT-BOLT', 'DAMAGED RECEIVED');
check('changing one row leaves the other alone', same(await allTypes(form), { 'PO-RT-UI-A|RT-BOLT': 'DAMAGED RECEIVED', 'PO-RT-UI-A|RT-NUT': 'FULL MATERIAL RECEIVED' }));

await pickPo(form, /^PO-RT-UI-B —/);
check('adding PO B keeps PO A\'s choices; new rows default', same(await allTypes(form), {
  'PO-RT-UI-A|RT-BOLT': 'DAMAGED RECEIVED', 'PO-RT-UI-A|RT-NUT': 'FULL MATERIAL RECEIVED',
  'PO-RT-UI-B|RT-BOLT': 'FULL MATERIAL RECEIVED', 'PO-RT-UI-B|RT-WASHER': 'FULL MATERIAL RECEIVED',
}), JSON.stringify(await allTypes(form)));
await choose(form, 'PO-RT-UI-B|RT-BOLT', 'EXTRA RECEIVED');
await choose(form, 'PO-RT-UI-A|RT-NUT', 'PARTIAL RECEIVED');
check('same SKU on two POs keeps two separate choices', await typeOf(form, 'PO-RT-UI-A|RT-BOLT') === 'DAMAGED RECEIVED'
  && await typeOf(form, 'PO-RT-UI-B|RT-BOLT') === 'EXTRA RECEIVED');
await shot('01-two-pos-1440');

await form.locator('.MuiChip-root', { hasText: 'PO-RT-UI-A' }).locator('.MuiChip-deleteIcon').click();
await page.waitForTimeout(500);
check('removing PO A drops only its rows; PO B keeps its choices', same(await allTypes(form), {
  'PO-RT-UI-B|RT-BOLT': 'EXTRA RECEIVED', 'PO-RT-UI-B|RT-WASHER': 'FULL MATERIAL RECEIVED',
}), JSON.stringify(await allTypes(form)));
await pickPo(form, /^PO-RT-UI-A —/);
check('re-adding PO A: its rows start fresh, PO B untouched', same(await allTypes(form), {
  'PO-RT-UI-B|RT-BOLT': 'EXTRA RECEIVED', 'PO-RT-UI-B|RT-WASHER': 'FULL MATERIAL RECEIVED',
  'PO-RT-UI-A|RT-BOLT': 'FULL MATERIAL RECEIVED', 'PO-RT-UI-A|RT-NUT': 'FULL MATERIAL RECEIVED',
}), JSON.stringify(await allTypes(form)));
await choose(form, 'PO-RT-UI-A|RT-BOLT', 'DAMAGED RECEIVED');
await choose(form, 'PO-RT-UI-A|RT-NUT', 'PARTIAL RECEIVED');
const WANT = {
  'PO-RT-UI-B|RT-BOLT': 'EXTRA RECEIVED', 'PO-RT-UI-B|RT-WASHER': 'FULL MATERIAL RECEIVED',
  'PO-RT-UI-A|RT-BOLT': 'DAMAGED RECEIVED', 'PO-RT-UI-A|RT-NUT': 'PARTIAL RECEIVED',
};
check('final choices on screen', same(await allTypes(form), WANT));

// ── 3. Layout at several widths ──────────────────────────────────────────────
console.log('\n── 3. Layout / overflow ──');
for (const w of [1920, 1440, 1280, 1024, 900, 768, 390, 360]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const problems = await layoutAudit(form);
  check(`no overflow at ${w}px`, problems.length === 0, problems.join('; '));
  if ([1440, 1024, 900, 390].includes(w)) await shot(`02-rows-${w}`);
}
await page.setViewportSize({ width: 1440, height: 950 });
await page.waitForTimeout(300);

// ── 4. Preview PDF ───────────────────────────────────────────────────────────
console.log('\n── 4. Preview PDF ──');
const [prevRes] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/grns/preview-pdf'), { timeout: 20000 }),
  form.getByRole('button', { name: 'Preview PDF' }).click(),
]);
const prevText = pdfText(Buffer.from(await prevRes.body()));
const prevTypes = prevText.filter((t) => / RECEIVED$/.test(t) && !/^Invoice/.test(t));
check('preview PDF rows show each row\'s type, in form order', JSON.stringify(prevTypes)
  === JSON.stringify(['EXTRA RECEIVED', 'FULL MATERIAL RECEIVED', 'DAMAGED RECEIVED', 'PARTIAL RECEIVED']), JSON.stringify(prevTypes));
check('preview PDF summary: Per item', prevText.some((t) => /Material Receipt Type: Per item/.test(t)));
await page.waitForTimeout(800);
await shot('03-preview');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ── 5. Save as Draft → reload → restore ──────────────────────────────────────
console.log('\n── 5. Save draft + edit restore ──');
await form.getByRole('button', { name: 'Save as Draft' }).click();
check('draft saved', await snack(/created \(draft\)/));
const list = await api('/procurement/grns?limit=50');
const draft = (list.data || []).find((g) => (g.poNumbers || []).includes('PO-RT-UI-A') && (g.poNumbers || []).includes('PO-RT-UI-B'));
const savedTypes = Object.fromEntries((draft?.items || []).map((l) => [`${l.poNumber}|${l.skuCode}`, String(l.howItemReceived || '').replace(/_/g, ' ')]));
check('saved per line (API)', same(savedTypes, WANT), JSON.stringify(savedTypes));
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(500);
await go(`${APP}/procurement/grns/${draft._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const edit = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await edit.waitFor();
await sel(edit, 'PO-RT-UI-A|RT-BOLT').waitFor({ timeout: 15000 });
check('editing the draft restores every row\'s own type', same(await allTypes(edit), WANT), JSON.stringify(await allTypes(edit)));
check('edit form has no header dropdown either', (await edit.locator('.MuiPaper-root').filter({ hasText: 'GRN Header' }).first().getByText('Material Receipt Type').count()) === 0);

// ── 6. Save & Finalize → detail page ─────────────────────────────────────────
console.log('\n── 6. Save & Finalize ──');
await edit.getByRole('button', { name: /Save & Finalize GRN/ }).click();
check('finalized', await snack(/saved and completed/));
await page.waitForTimeout(800);
await go(`${APP}/procurement/grns/${draft._id}`);
await page.getByTestId('grn-line-receipt-type-value').first().waitFor({ timeout: 15000 });
const rows = await page.locator('tr').filter({ has: page.getByTestId('grn-line-receipt-type-value') }).allInnerTexts();
const rowType = (po, name) => rows.find((r) => r.includes(po) && r.includes(name)) || '';
check('detail table shows each line\'s type', /DAMAGED RECEIVED/.test(rowType('PO-RT-UI-A', 'RT Bolt')) && /PARTIAL RECEIVED/.test(rowType('PO-RT-UI-A', 'RT Nut'))
  && /EXTRA RECEIVED/.test(rowType('PO-RT-UI-B', 'RT Bolt')) && /FULL MATERIAL RECEIVED/.test(rowType('PO-RT-UI-B', 'RT Washer')), rows.join(' | ').replace(/\s+/g, ' '));
check('GRN Information says "Per item (mixed)"', (await page.getByText('Per item (mixed)').count()) > 0);
await shot('04-detail');

// ── 7. Legacy GRNs ───────────────────────────────────────────────────────────
console.log('\n── 7. Legacy GRNs (header value only) ──');
const all = (await api('/procurement/grns?limit=100')).data || [];
const legUi = all.find((g) => g.grnNumber === 'GRN-RT-LEG-UI');
const legDone = all.find((g) => g.grnNumber === 'GRN-RT-LEG-DONE');
await go(`${APP}/procurement/grns/${legDone._id}`);
await page.getByTestId('grn-line-receipt-type-value').first().waitFor({ timeout: 15000 });
check('completed legacy GRN loads; line shows the header value', (await page.getByTestId('grn-line-receipt-type-value').allInnerTexts()).every((t) => t.trim() === 'PARTIAL RECEIVED'));
check('…and the header field too', (await page.getByText('PARTIAL RECEIVED', { exact: true }).count()) >= 2);
await go(`${APP}/procurement/grns/${legUi._id}`);
await page.getByRole('button', { name: 'Edit' }).first().click();
const legEdit = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await legEdit.waitFor();
await sel(legEdit, 'PO-RT-LEG-UI|RT-NUT').waitFor({ timeout: 15000 });
check('legacy draft: every row restored from the header value', same(await allTypes(legEdit), {
  'PO-RT-LEG-UI|RT-NUT': 'DAMAGED RECEIVED', 'PO-RT-LEG-UI|RT-WASHER': 'DAMAGED RECEIVED',
}), JSON.stringify(await allTypes(legEdit)));
await choose(legEdit, 'PO-RT-LEG-UI|RT-WASHER', 'PARTIAL RECEIVED');
await legEdit.getByRole('button', { name: 'Save as Draft' }).click();
check('legacy draft saved', await snack(/GRN updated/));
await page.waitForTimeout(500);

// ── 8. Without PO: add / remove rows ─────────────────────────────────────────
console.log('\n── 8. W/O PO rows ──');
await go(`${APP}/purchase-fms/grn?view=grn`);
await page.getByRole('button', { name: /new grn/i }).first().click();
const wo = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await wo.waitFor();
await wo.getByRole('button', { name: /Without PO/ }).click();
await page.waitForTimeout(300);
await wo.getByRole('button', { name: 'Add Item' }).click();
await page.waitForTimeout(300);
const woSel = wo.getByTestId('grn-line-receipt-type');
check('each W/O PO row has its own dropdown', (await woSel.count()) === 2);
await woSel.nth(1).click();
await page.getByRole('option', { name: 'DAMAGED RECEIVED', exact: true }).click();
await page.waitForTimeout(200);
check('row 2 changed, row 1 untouched', (await woSel.nth(0).innerText()).trim() === 'FULL MATERIAL RECEIVED' && (await woSel.nth(1).innerText()).trim() === 'DAMAGED RECEIVED');
await wo.getByTitle('Remove item').first().click();
await page.waitForTimeout(300);
check('removing row 1 keeps row 2\'s choice on the remaining row', (await woSel.count()) === 1 && (await woSel.nth(0).innerText()).trim() === 'DAMAGED RECEIVED');
const woProblems = await layoutAudit(wo);
check('W/O PO rows: no overflow at 1440px', woProblems.length === 0, woProblems.join('; '));
await shot('05-wopo');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
