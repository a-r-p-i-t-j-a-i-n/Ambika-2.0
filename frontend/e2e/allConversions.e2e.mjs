/**
 * Coil to Circle page — the ONE history table (the conversion ledger): every
 * recorded cut, a row per physical coil and a row per cut that names no coil,
 * paged, filtered and totalled on the server — driven through the real UI.
 *
 *   node e2e/allConversions.e2e.mjs
 *
 * It replaced two tables on this page (the Coil to Circle History and All
 * conversions); this spec carries All conversions' checks over to it, on the
 * same 104 cuts, and adds what the one table does:
 *    1  past the first rows: every page, S.No. and the API's order;
 *    2  10 / 25 / 50 / 100 rows a page, with the range;
 *    3  previous / next, each disabled at its end;
 *  4–7  batch number, date range (IST days), circle SKU and PLG01 / JW001;
 *    8  filters combined;
 *    9  every filter change goes back to page 1 and keeps the page size;
 *   10  Reset filters;
 *   11  the summary cards add up every matching cut once, never just the page
 *       shown — and never a coil and its rounds both;
 *   12  cuts naming no physical coil (imports, "No receipt available") are rows
 *       of their own: listed, filterable, searchable, with their details;
 *   13  one fixed order — shared dates and save times included — at every size;
 *   14  a real cut through the form shows up, nothing repeated or skipped;
 *   15  a coil row is the coil: its rounds open under it, and a per-cut filter
 *       dims exactly the rounds the server left out of the totals;
 *   16  the record-type tabs and their counts, the clickable summary cards and
 *       a row's ⋮ actions;
 *   17  laptop, tablet and phone widths: the table where it fits, cards below,
 *       never a page that scrolls sideways.
 *
 * The database is the oracle: backend/src/scripts/e2eAllConversionsFixture.js
 * --verify checks that this run saved exactly its one cut, and
 * e2eConversionLedgerFixture.js --check --db=ambika_e2e_allconv checks every
 * answer of the endpoint this table reads against the raw documents.
 *
 * Expects (started separately):
 *   cd backend && node src/scripts/e2eAllConversionsFixture.js --seed && … --api
 *   backend  :5099  e2eServer.js on ambika_e2e_allconv
 *   frontend :3100  with VITE_API_URL=http://127.0.0.1:5099/api/v1
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

const APP = 'http://127.0.0.1:3100';
const API = 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'allConversions.e2e.mjs');
const USER = { email: 'allconv-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const CUTS = 104;
const ROWS = 47; // 4 physical coils + 43 cuts with no physical coil
const TABS0 = 'All records (47) With physical coil (4) Without physical coil (43)';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const consoleErrors = [];
const reactWarnings = [];
const pageErrors = [];
const apiErrors = [];
const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const seq = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const tabsOf = (all, coil, none) => `All records (${all}) With physical coil (${coil}) Without physical coil (${none})`;

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // Failures this spec CAUSES on purpose are tagged here and not counted.
  let expectFailures = false;
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !(expectFailures && /500|Internal Server Error|Simulated/i.test(t))) consoleErrors.push(t);
    if ((m.type() === 'warning' || m.type() === 'error') && /^Warning:|React|validateDOMNesting|unique "key"|out-of-range|out of range/i.test(t)) reactWarnings.push(t);
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !expectFailures) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
  });
  const shot = async (name, fullPage = true) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `ledger-${name}.png`), fullPage });
  };
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  // ── The records: table rows from md up, cards below — the same records ──
  const table = page.getByRole('table', { name: 'Coil to Circle history' });
  const rows = () => page.locator('[data-testid="history-records"] > [data-id]');
  const coilRows = () => page.getByTestId('cut-history-row');
  const cutRows = () => page.getByTestId('ledger-cut-row');
  const data = (loc, k) => loc.evaluateAll((els, key) => els.map((e) => e.dataset[key] ?? ''), k);
  const ids = () => data(rows(), 'id');
  const kinds = () => data(rows(), 'kind');
  const snos = () => page.getByTestId('cut-history-sno').allInnerTexts().then((a) => a.map((s) => s.replace('#', '')));
  const pager = () => page.getByTestId('history-pagination');
  const range = async () => flat(await pager().locator('.MuiTablePagination-displayedRows').innerText().catch(() => ''));
  const perPageShown = async () => flat(await pager().getByRole('combobox').innerText().catch(() => ''));
  const tabs = async () => flat(await page.getByTestId('record-tabs').innerText().catch(() => ''));
  const pressed = async () => (await page.getByTestId('record-tabs').locator('[aria-pressed="true"]').getAttribute('data-testid').catch(() => '')) || '';
  const scope = async () => flat(await page.getByTestId('history-totals-scope').innerText().catch(() => ''));
  const cards = async () => flat(await page.getByTestId('history-cards').innerText().catch(() => ''));
  const footer = async () => flat(await page.getByTestId('cut-history-untraceable').innerText().catch(() => ''));
  const bar = () => page.getByTestId('history-filters');
  // Wait until the records have settled on an answer (not loading, not dimmed).
  const settle = async () => {
    await page.waitForTimeout(500);
    await page.waitForFunction(() => {
      const t = document.querySelector('[aria-label="Coil to Circle history"][aria-busy]');
      return t && t.getAttribute('aria-busy') !== 'true';
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  const next = async () => { await pager().getByRole('button', { name: /go to next page/i }).click(); await settle(); };
  const prev = async () => { await pager().getByRole('button', { name: /go to previous page/i }).click(); await settle(); };
  const perPage = async (n) => {
    await pager().getByRole('combobox').click();
    await page.getByRole('option', { name: String(n), exact: true }).click();
    await settle();
  };
  const pick = async (label, option) => {
    await bar().getByRole('combobox', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await settle();
  };
  const pickCircle = async (code) => {
    const box = page.getByTestId('filter-circle');
    await box.click();
    await box.fill(code.slice(-6));
    await page.getByRole('option', { name: new RegExp(code) }).click();
    await settle();
  };
  const reset = async () => { await page.getByTestId('filter-reset').click(); await settle(); };
  // Batch number and cutting status sit behind "More filters".
  const moreFilters = async () => {
    if (await page.getByTestId('filter-batch').isVisible().catch(() => false)) return;
    await page.getByTestId('filter-more').click();
    await page.waitForTimeout(400);
  };
  const batchFill = async (v) => { await moreFilters(); await page.getByTestId('filter-batch').fill(v); await settle(); };
  // The same request the table makes, straight to the API — whose every answer
  // e2eConversionLedgerFixture.js --check has checked against the raw documents.
  const api = (q) => page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
    return r.json();
  }, `${API}/rm-ims/conversion-ledger?${new URLSearchParams(q)}`);
  const apiAll = async (q = {}) => {
    const out = [];
    for (let p = 1; p < 50; p += 1) {
      const r = await api({ ...q, page: p, limit: 100 });
      out.push(...r.data);
      if (r.data.length < 100) return { rows: out, meta: r.meta };
    }
    return { rows: out };
  };
  const cardsMatch = (c, t) => new RegExp(`Total Conversions ${fmt(t.cuts)} `, 'i').test(`${c} `)
    && new RegExp(`Total Coil Weight Cut ${fmt(t.cutKg)} kg ${fmt(t.circlesKg)} kg circles`, 'i').test(c)
    && new RegExp(`Total Scrap Generated ${fmt(t.scrapKg)} kg`, 'i').test(c);
  const conversionsCard = (n) => new RegExp(`Total Conversions ${fmt(n)} `);
  // Σ of the "Cut (kg)" column on the page shown (its first line — a coil's
  // second line is the coil's total weight).
  const pageCutSum = () => rows().evaluateAll((els) => els
    .reduce((s, e) => s + (Number(e.querySelectorAll('td')[7].innerText.split('\n')[0].replace(/[^0-9.]/g, '')) || 0), 0));
  const roundsOf = (loc) => loc.evaluateAll((els) => els.map((e) => Number((e.querySelector('[data-testid="cut-history-rounds"]')?.innerText || '0').replace(/\D/g, ''))));
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  console.log('\nTHE COIL TO CIRCLE HISTORY — one table of every cut\n');

  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });

  /* ── Loading: a skeleton while the first page loads, never "nothing cut" ── */
  await page.route('**/rm-ims/conversion-ledger?*', async (route) => {
    await new Promise((r) => { setTimeout(r, 1500); });
    await route.continue().catch(() => {});
  });
  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(700);
  check('loading: a skeleton shows while the first page loads — not "No physical coil has been cut yet", no cards, no counts on the tabs',
    (await table.locator('.MuiSkeleton-root').count()) > 0 && (await page.getByTestId('history-empty').count()) === 0
      && (await rows().count()) === 0 && (await page.getByTestId('history-cards').count()) === 0
      && (await page.getByTestId('record-tab-all').getAttribute('data-count')) === '');
  await rows().first().waitFor({ timeout: 20000 });
  await page.unroute('**/rm-ims/conversion-ledger?*');
  await settle();

  /* ── The page: its header, one table, no second "All conversions" section ── */
  const header = flat(await page.locator('body').innerText());
  check('the header: "Coil to Circle", "Track coil cutting history, circle output and remaining weight.", "Record Cutting Round"; the RM tab is "Coil to Circle"',
    /Track coil cutting history, circle output and remaining weight\./.test(header)
      && flat(await page.getByTestId('open-coil-to-circle').innerText()) === 'Record Cutting Round'
      && (await page.getByRole('link', { name: 'Coil to Circle' }).or(page.getByRole('tab', { name: 'Coil to Circle' })).or(page.getByRole('button', { name: 'Coil to Circle' })).count()) >= 1);
  const one = {
    history: await page.getByRole('table', { name: 'Coil to Circle history' }).count(),
    allConversions: await page.getByRole('table', { name: 'All conversions' }).count(),
    section: await page.getByTestId('all-conversions').count(),
    filterBars: await page.locator('[data-testid$="filters"]').count(),
  };
  check('one history table on the page — the separate "All conversions" table, section and filter bar are gone',
    one.history === 1 && one.allConversions === 0 && one.section === 0 && one.filterBars === 1, JSON.stringify(one));
  const heads = (await table.locator(':scope > thead th').allInnerTexts()).map((h) => flat(h).toLowerCase()).filter(Boolean);
  check('the columns, as the design names them: # · Date · Batch / Coil · GRN / Source · Coil SKU / Item · Location · Cut · Circles pcs | kg · Scrap · Yield · Remaining · Status · Type',
    same(heads, ['#', 'date', 'batch / coil', 'grn / source', 'coil sku / item', 'location', 'cut (kg)', 'circles pcs | kg', 'scrap (kg)', 'yield', 'remaining (kg)', 'status', 'type']),
    heads.join(' | '));
  check('the filter bar: Search, From date, To date, Circle SKU, Cutting location, Record type, More filters, Reset — each field named by its label',
    await page.getByLabel('Search').isVisible() && await page.getByLabel('From date').isVisible() && await page.getByLabel('To date').isVisible()
      && await page.getByLabel('Circle SKU').isVisible() && await bar().getByRole('combobox', { name: /^Cutting location/ }).isVisible()
      && await bar().getByRole('combobox', { name: /^Record type/ }).isVisible() && await page.getByTestId('filter-more').isVisible()
      && await page.getByTestId('filter-reset').isVisible() && !(await page.getByTestId('filter-batch').isVisible()));

  /* ── Default: 10 a page, both kinds of row, totals over every cut ── */
  const all = await apiAll();
  const order = all.rows.map((r) => r.id);
  const plgId = all.rows.find((r) => r.batchNo === 'AC-PLG-1').id;
  const t0 = all.meta;
  check(`2. opens at 10 a page: "1–10 of ${ROWS}", S.No. 1–10`, (await rows().count()) === 10 && (await range()) === `1–10 of ${ROWS}`
    && same(await snos(), seq(1, 10)), await range());
  check('…in the API\'s order: newest cut first', same(await ids(), order.slice(0, 10)));
  check('16. the record tabs count every kind: "All records (47) · With physical coil (4) · Without physical coil (43)", All pressed',
    (await tabs()) === TABS0 && (await pressed()) === 'record-tab-all', await tabs());
  const c0 = await cards();
  check(`11. the cards: 4 physical coils (3 partially · 1 fully cut) and ${CUTS} conversions — 61 on physical coils, 43 without`,
    /Physical Coils 4 3 partially cut · 1 fully cut/.test(c0) && /Total Conversions 104 61 on physical coils · 43 without physical coil/.test(c0), c0);
  check('11. …and the weights ARE every cut: 11,330 kg cut · 9,672 kg circles · 1,658 kg scrap, split PLG01 / job worker',
    cardsMatch(c0, t0) && /Total Coil Weight Cut 11,330 kg 9,672 kg circles · Yield/.test(c0) && /Total Scrap Generated 1,658 kg PLG01 [\d,.]+ kg · Job worker [\d,.]+ kg/.test(c0), c0);
  check('11. the line under the cards says what they cover — and keeps the average yield per cut (84.94%) and the unplaced scrap',
    /^The weights add up all 104 recorded cuts — every page, each cut once\. Coils are counted, never added\./.test(await scope())
      && /Yield averaged per cut: 84\.94%/.test(await scope()) && /kg of the scrap has no recorded cutting location/.test(await scope()), await scope());
  check('12. the footer counts the 43 rows that are cuts with no physical coil — over every page',
    /^43 rows are cuts \([\d,.]+ kg\) that name no physical coil/.test(await footer()), await footer());
  check('17. 1,600 px: the table, every column in view — the page does not scroll sideways, nor does the table',
    (await overflowX()) <= 1 && await table.evaluate((t) => t.parentElement.scrollWidth <= t.parentElement.clientWidth + 1));
  await shot('01-open', false);

  /* ── 13. Every row once, in order, at every size ── */
  check('3. "previous" is disabled on page 1', await pager().getByRole('button', { name: /go to previous page/i }).isDisabled());
  const walked = [];
  const walkedSno = [];
  const walkedKinds = [];
  for (let p = 0; p < 5; p += 1) {
    walked.push(...await ids());
    walkedSno.push(...await snos());
    walkedKinds.push(...await kinds());
    if (p < 4) await next();
  }
  check(`13. paging through all 5 pages lists all ${ROWS} rows once each, S.No. 1–${ROWS}`,
    walked.length === ROWS && new Set(walked).size === ROWS && same(walkedSno, seq(1, ROWS)), `${walked.length} rows, ${new Set(walked).size} distinct`);
  check('13. …in exactly the API\'s order — the imported cuts sharing a date and a save time included', same(walked, order));
  check('12. …4 coil rows and 43 rows of their own for the cuts with no coil',
    walkedKinds.filter((k) => k === 'COIL').length === 4 && walkedKinds.filter((k) => k === 'UNLINKED').length === 43);
  check(`3. the last page: "41–${ROWS} of ${ROWS}", 7 rows, "next" disabled`, (await range()) === `41–${ROWS} of ${ROWS}`
    && (await rows().count()) === 7 && await pager().getByRole('button', { name: /go to next page/i }).isDisabled(), await range());
  check('11. the last page shows the SAME totals as the first — the cards never follow the page', (await cards()) === c0);
  await prev();
  check(`3. previous → "31–40 of ${ROWS}", S.No. 31–40`, (await range()) === `31–40 of ${ROWS}` && same(await snos(), seq(31, 40))
    && same(await ids(), order.slice(30, 40)));
  await perPage(25);
  const at25 = [];
  for (let p = 0; p < 2; p += 1) { at25.push(...await ids()); if (p < 1) await next(); }
  check('13. at 25 a page the order is the same (a tie never straddles two pages differently)', same(at25, order));
  await perPage(50);
  check(`2. 50 a page: "1–${ROWS} of ${ROWS}" — a change of size goes back to page 1`,
    (await rows().count()) === ROWS && (await range()) === `1–${ROWS} of ${ROWS}` && same(await snos(), seq(1, ROWS)), await range());
  await perPage(100);
  check(`2. 100 a page: "1–${ROWS} of ${ROWS}"`, (await rows().count()) === ROWS && (await range()) === `1–${ROWS} of ${ROWS}`);
  // Each cut once: a coil row's rounds + the rows of their own = every cut.
  const roundsShown = (await roundsOf(coilRows())).reduce((s, n) => s + n, 0);
  check(`11. Σ rounds of the 4 coil rows (${roundsShown}) + the 43 rows of their own = the ${CUTS} conversions the card counts`,
    roundsShown === 61 && roundsShown + (await cutRows().count()) === CUTS, String(roundsShown));
  await perPage(10);

  /* ── 15. A coil row is the coil; its rounds open under it ── */
  const plg1 = coilRows().filter({ has: page.locator('[data-testid="cut-history-rounds"]', { hasText: '30 rounds' }) });
  check('15. a coil row reads as the design lays it out: date (and first cut), batch, "30 rounds", GRN, SKU, location, cut "of" the total, pcs over kg, scrap, yield, remaining, status, "Physical coil"',
    /^\d+ \d\d-\d\d-\d{4} First: 05-01-2026 AC-PLG-1 30 rounds GRN AC-GRN-1 JSL204-07 .+ PLG01 · Plant 1,500 of 5,000 270 1,260 kg 240 84% 3,500 Partially cut Physical coil$/
      .test(flat(await plg1.innerText())), flat(await plg1.innerText()));
  await plg1.getByTestId('cut-history-rounds').click();
  await page.waitForTimeout(1200);
  const rr = page.getByTestId('cut-round-row');
  check('15. "30 rounds" opens AC-PLG-1: "Cutting rounds (30)", numbered 1–30, none dimmed, with Open coil page',
    (await rr.count()) === 30 && flat(await page.getByTestId('rounds-title').innerText()) === 'Cutting rounds (30)'
      && same(await rr.evaluateAll((els) => els.map((e) => e.dataset.round)), seq(1, 30)) && (await data(rr, 'matches')).every((m) => m === '')
      && await page.getByTestId('round-details-coil-page').isVisible());
  const firstRound = (await data(rr, 'conversion'))[0];
  const rheads = (await page.getByTestId('rounds-table').locator('thead th').allInnerTexts()).map((h) => flat(h).toLowerCase());
  check('15. the rounds table: Round · Date · Conversion No. · Cutting type | This round: Cut · Circles (pcs) · Circles (kg) · Scrap · Yield | After this round: Remaining · Status',
    same(rheads, ['round', 'date', 'conversion no.', 'cutting type', 'this round', 'after this round', 'cut (kg)', 'circles (pcs)', 'circles (kg)', 'scrap (kg)', 'yield', 'remaining (kg)', 'status']),
    rheads.join(' | '));
  check('15. a round reads: 1 · date · conversion · Partial · 50 · 9 pcs · 42 · 8 · 84% · 4,950 left · Partial',
    /^1 05-01-2026 \S+ Partial 50 9 42 8 84% 4,950 Partial$/.test(flat(await rr.first().innerText())), flat(await rr.first().innerText()));
  check('15. each round says whether its scrap was checked, without adding text to the row', (await page.getByTestId('round-scrap-checked').count()) === 30);
  await shot('02-coil-open', false);
  await plg1.getByTestId('cut-history-rounds').click();
  await page.waitForTimeout(400);

  /* ── 16. A row's ⋮ actions ── */
  await plg1.getByTestId('row-actions').click();
  await page.waitForTimeout(300);
  check('16. ⋮ on a coil row offers "Show cutting rounds" and "Open coil page"',
    /^Show cutting rounds$/.test(flat(await page.getByTestId('row-action-toggle').innerText())) && await page.getByTestId('row-action-coil-page').isVisible());
  await page.getByTestId('row-action-toggle').click();
  await page.waitForTimeout(1000);
  check('16. …"Show cutting rounds" opens them', (await rr.count()) === 30 && (await plg1.getAttribute('data-open')) === 'true');
  await plg1.getByTestId('row-actions').click();
  await page.waitForTimeout(300);
  check('16. …and then offers "Hide cutting rounds"', /^Hide cutting rounds$/.test(flat(await page.getByTestId('row-action-toggle').innerText())));
  await page.getByTestId('row-action-coil-page').click();
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 15000 });
  await ready();
  check('16. "Open coil page" opens AC-PLG-1\'s own page', page.url().endsWith(`/rm-ims/coil/${plgId}`), page.url());
  await page.goBack();
  await ready();
  await rows().first().waitFor({ timeout: 20000 });
  await settle();

  /* ── 12 / 16. The record tabs: a cut with no coil opens to its own record ── */
  await page.getByTestId('record-tab-none').click();
  await settle();
  check('16. "Without physical coil (43)": just the 43 cuts with no coil; the counts stay, the tab and "Record type" say so',
    (await tabs()) === TABS0 && (await pressed()) === 'record-tab-none' && (await kinds()).every((k) => k === 'UNLINKED') && (await range()) === '1–10 of 43'
      && /^Without physical coil \(older cuts\)/.test(flat(await bar().getByRole('combobox', { name: /^Record type/ }).innerText())), await tabs());
  check('12. …the cards add up those 43 alone', /Physical Coils 0 /.test(await cards()) && /Total Conversions 43 0 on physical coils · 43 without physical coil/.test(await cards()), await cards());
  const noReceipt = cutRows().filter({ hasText: 'No receipt available' }).first();
  check('12. a cut with no coil reads: date, "—" batch and its conversion no., "No physical coil · No receipt available", SKU, location, cut, pcs over kg, scrap, yield, "—" remaining and status, "Unlinked"',
    /^\d+ 16-03-2026 — AGL\/RMC-\d+\/\d\d-\d\d No physical coil No receipt available JSL204-10 .+ (PLG01 · Plant|JW001 · Job work) 50 8 44 kg 6( with job worker)? 88% — — Unlinked$/
      .test(flat(await noReceipt.innerText())), flat(await noReceipt.innerText()));
  check('12. …nothing made up for it: no total weight ("of"), "—" for remaining and status',
    (await noReceipt.locator('td').evaluateAll((tds) => [tds[11], tds[12]].map((td) => td.innerText.trim()))).every((x) => x === '—')
      && !/ of /.test(await noReceipt.locator('td').nth(7).innerText()));
  await noReceipt.getByTestId('row-actions').click();
  await page.waitForTimeout(300);
  check('16. ⋮ on such a row offers "Show details" — and no coil page', /^Show details$/.test(flat(await page.getByTestId('row-action-toggle').innerText()))
    && (await page.getByTestId('row-action-coil-page').count()) === 0);
  await page.getByTestId('row-action-toggle').click();
  await page.waitForTimeout(500);
  // The whole region: its title, facts and the notes.
  const details = () => page.locator('[role="region"][id^="cut-details-"]');
  const det = flat(await details().innerText());
  check('12. its own record: "Conversion details" — conversion, dates, cutting type, size, scrap check, source',
    /^Conversion details/.test(det) && /Conversion AGL\/RMC-\d+\/\d\d-\d\d/.test(det) && /Cut on \d\d-\d\d-\d{4}/.test(det) && /Saved \d\d-\d\d-\d{4} \d\d:\d\d/.test(det)
      && /Scrap checked\? (Verified|Not yet checked)/.test(det) && /Source Saved with “No receipt available”/.test(det) && /none is guessed from its batch number/.test(det), det);
  await noReceipt.getByTestId('cut-history-expand').click();
  await page.waitForTimeout(300);
  await page.getByTestId('record-tab-coil').click();
  await settle();
  check('16. "With physical coil (4)": the 4 coils, 61 conversions', (await kinds()).length === 4 && (await kinds()).every((k) => k === 'COIL')
    && (await pressed()) === 'record-tab-coil' && /Total Conversions 61 Cutting rounds of these coils/.test(await cards()), await cards());
  await page.getByTestId('record-tab-all').click();
  await settle();
  check('16. "All records" again: 47 rows', (await range()) === `1–10 of ${ROWS}` && (await pressed()) === 'record-tab-all');

  /* ── 16. The summary cards that act ── */
  await page.getByTestId('card-physical-coils').click();
  await settle();
  check('16. clicking "Physical Coils" shows the physical coil records (the tab follows)', (await pressed()) === 'record-tab-coil' && (await kinds()).every((k) => k === 'COIL'));
  await page.getByTestId('card-conversions').click();
  await settle();
  check('16. clicking "Total Conversions" shows all records again', (await pressed()) === 'record-tab-all' && (await range()) === `1–10 of ${ROWS}`);
  check('16. "Total Coil Weight Cut" is a figure, not a button', (await page.getByTestId('card-weight').evaluate((e) => e.tagName)) !== 'BUTTON');

  /* ── 4 / 9. Batch number — partial, any case; back to page 1, size kept ── */
  await next(); await next();
  check('(on page 3 before filtering)', (await range()) === `21–30 of ${ROWS}`);
  await batchFill('l-00');
  check('4. batch "l-00" (under More filters) → L-009 … L-001, newest first (ties by id)',
    same(await data(rows(), 'batch'), ['L-009', 'L-008', 'L-007', 'L-006', 'L-005', 'L-004', 'L-003', 'L-002', 'L-001']), (await data(rows(), 'batch')).join(','));
  check('9. …back on page 1, still 10 a page: "1–9 of 9", S.No. 1–9',
    (await range()) === '1–9 of 9' && same(await snos(), seq(1, 9)) && /^10$/.test(await perPageShown()), `${await range()} · ${await perPageShown()}`);
  check('the tabs count only what the batch matches: 9 · 0 · 9', (await tabs()) === tabsOf(9, 0, 9), await tabs());
  check('11. the cards add up only those 9: 936 kg', conversionsCard(9).test(await cards()) && /0 on physical coils · 9 without physical coil/.test(await cards())
    && /Total Coil Weight Cut 936 kg/.test(await cards()) && cardsMatch(await cards(), (await api({ batchNo: 'l-00' })).meta), await cards());
  check('11. …and the line says they are the 9 matching cuts of 104', /^The weights add up the 9 matching cuts \(of 104 recorded\)/.test(await scope()), await scope());
  check('More filters stays open while one of its filters is set, and counts it', await page.getByTestId('filter-batch').isVisible()
    && flat(await page.getByTestId('filter-more').innerText()).startsWith('1'));
  await batchFill('ac-jw');
  check('4. batch "ac-jw" → the coil AC-JW-1, one row, 25 conversions', same(await data(rows(), 'batch'), ['AC-JW-1']) && (await tabs()) === tabsOf(1, 1, 0)
    && conversionsCard(25).test(await cards()), `${await tabs()} · ${await cards()}`);
  await reset();

  /* ── 5. Date range — the cutting date, read in IST ── */
  await page.getByTestId('filter-from').fill('2026-02-10');
  await page.getByTestId('filter-to').fill('2026-02-20');
  await settle();
  check('5. 10 → 20 Feb 2026: the coil AC-JW-1, "11 of 25 match"; the cards count those 11 cuts',
    same(await data(rows(), 'batch'), ['AC-JW-1']) && /11 of 25 match/.test(flat(await coilRows().first().innerText()))
      && (await tabs()) === tabsOf(1, 1, 0) && conversionsCard(11).test(await cards()), `${await tabs()} · ${await cards()}`);
  await coilRows().first().getByTestId('cut-history-expand').click();
  await page.waitForTimeout(1200);
  const lit = await rr.evaluateAll((els) => els.filter((e) => e.dataset.matches === 'true').map((e) => e.querySelector('td:nth-child(2)').innerText.trim().slice(0, 10)));
  const dim = await rr.evaluateAll((els) => els.filter((e) => e.dataset.matches === 'false').length);
  check('15. opened: the 11 rounds cut 10–20 Feb are lit, the other 14 dimmed (not hidden) — exactly the cuts the cards count',
    lit.length === 11 && dim === 14 && lit.every((d) => /^(1\d|20)-02-2026$/.test(d)) && /Rounds the filters leave out are dimmed/.test(flat(await page.getByTestId('rounds-caption').innerText())),
    lit.join(','));
  await coilRows().first().getByTestId('cut-history-expand').click();
  await page.getByTestId('filter-from').fill('2026-02-10');
  await page.getByTestId('filter-to').fill('2026-02-10');
  await settle();
  check('5. 10 Feb alone (IST): one round of AC-JW-1, "1 of 25 match"', /1 of 25 match/.test(flat(await coilRows().first().innerText()))
    && conversionsCard(1).test(await cards()), await cards());
  await page.getByTestId('filter-from').fill('2026-03-01');
  await page.getByTestId('filter-to').fill('2026-02-01');
  await settle();
  check('5. "From date" after "To date" is refused on screen — no rows, no cards, no counts',
    /"From date" is after "To date"/.test(flat(await page.locator('body').innerText())) && /Must be on or after "From date"/.test(flat(await bar().innerText()))
      && (await rows().count()) === 0 && (await page.getByTestId('history-cards').count()) === 0 && (await page.getByTestId('record-tab-all').getAttribute('data-count')) === '');
  await reset();

  /* ── 6. Circle SKU — a size only the imported cuts produced is offered ── */
  await pickCircle('JSL204-08-978');
  check('6. circle JSL204-08-978 → the 8 imported cuts that produced it, each its own row',
    same(await data(rows(), 'batch'), ['L-036', 'L-031', 'L-026', 'L-021', 'L-016', 'L-011', 'L-006', 'L-001']) && (await tabs()) === tabsOf(8, 0, 8),
    `${(await data(rows(), 'batch')).join(',')} · ${await tabs()}`);
  await reset();

  /* ── 7. Location — PLG01 / JW001, imported cuts included ── */
  await pick('Cutting location', 'JW001 — Job Work');
  const jw = await apiAll({ location: 'JW001' });
  check('7. JW001 → 39 cuts: the coil AC-JW-1 and 14 cuts with no coil, "1–10 of 15"', (await range()) === '1–10 of 15'
    && (await tabs()) === tabsOf(15, 1, 14) && /Total Conversions 39 25 on physical coils · 14 without physical coil/.test(await cards()), `${await range()} · ${await tabs()}`);
  check('7. the note says how location is read and that unrecorded ones are under "All locations"',
    /a cut with no recorded location is listed only under All locations/.test(flat(await page.getByTestId('history-filter-note').innerText())));
  const shownKg = await pageCutSum();
  check('11. JW001: the weights are all 39 matching cuts (3,110 kg), not the rows on screen',
    /Total Coil Weight Cut 3,110 kg/.test(await cards()) && cardsMatch(await cards(), jw.meta) && shownKg !== 3110 && shownKg > 0, `page shows ${fmt(shownKg)} kg · ${await cards()}`);
  await next();
  check('12. JW001\'s page 2: imported cuts filed by their own Summary Scrap row, in the API\'s order',
    (await range()) === '11–15 of 15' && (await data(cutRows(), 'location')).every((l) => l === 'JW001') && same(await ids(), jw.rows.slice(10).map((r) => r.id)));
  await pick('Cutting location', 'PLG01 — Plant');
  check('7/9. PLG01 → 51 cuts, back on page 1', (await range()).startsWith('1–10 of') && conversionsCard(51).test(await cards())
    && (await data(cutRows(), 'location')).every((l) => l === 'PLG01'), `${await range()} · ${await cards()}`);

  /* ── 8. Filters combined ── */
  await pick('Cutting location', 'JW001 — Job Work');
  await page.getByTestId('filter-from').fill('2026-02-05');
  await page.getByTestId('filter-to').fill('2026-02-15');
  await pickCircle('JSL204-08-700');
  check('8. JW001 + 5–15 Feb + JSL204-08-700 → 6 cuts, all rounds of AC-JW-1', (await tabs()) === tabsOf(1, 1, 0)
    && /6 of 25 match/.test(flat(await coilRows().first().innerText())) && /Total Coil Weight Cut 360 kg/.test(await cards()), `${await tabs()} · ${await cards()}`);
  await batchFill('no-such-batch');
  check('the no-match state: a message and a Reset — never a blank table',
    (await rows().count()) === 0 && /Nothing matches these filters/.test(flat(await page.getByTestId('history-empty').innerText()))
      && (await range()) === '0–0 of 0' && (await tabs()) === tabsOf(0, 0, 0), `${await range()} · ${await tabs()}`);
  check('…zero totals, no yield made up, and no footer note about 0 rows', /Total Coil Weight Cut 0 kg 0 kg circles/.test(await cards())
    && !/Yield/.test(await cards()) && (await page.getByTestId('cut-history-untraceable').count()) === 0, await cards());
  await shot('03-no-match', false);

  /* ── 10. Reset ── */
  await page.getByTestId('history-empty').getByRole('button', { name: /reset filters/i }).click();
  await settle();
  check(`10. Reset clears every filter: "1–10 of ${ROWS}" (size kept), Reset disabled`,
    (await tabs()) === TABS0 && (await range()) === `1–10 of ${ROWS}` && !(await page.getByTestId('filter-reset').isEnabled())
      && (await page.getByTestId('filter-batch').inputValue()) === '' && (await page.getByTestId('filter-from').inputValue()) === ''
      && (await page.getByTestId('filter-circle').inputValue()) === '', `${await tabs()} · ${await range()}`);
  check('10. …and the cards are back to all 104 cuts', (await cards()) === c0);

  /* ── 12. Record type and status ── */
  await moreFilters();
  await pick('Record type', 'Manual coil (no GRN)');
  check('record type "Manual coil" → AC-MAN-1 alone, its 4 rounds; the "With physical coil" tab is pressed',
    same(await data(rows(), 'batch'), ['AC-MAN-1']) && conversionsCard(4).test(await cards()) && (await pressed()) === 'record-tab-coil');
  await pick('Cutting status', 'Fully cut');
  check('manual + Fully cut → none (the manual coil is partly cut)', (await rows().count()) === 0);
  check('the note explains why a status cannot match a cut with no coil',
    /a cut that names no physical coil is not listed under a status/.test(flat(await page.getByTestId('history-filter-note').innerText())));
  await pick('Record type', 'All records');
  check('Fully cut alone → AC-PLG-2 (2 rounds) and no cut with no coil; the tabs say 1 · 1 · 0',
    same(await data(rows(), 'batch'), ['AC-PLG-2']) && conversionsCard(2).test(await cards()) && (await tabs()) === tabsOf(1, 1, 0));
  await pick('Record type', 'GRN-linked coil');
  await pick('Cutting status', 'Any status');
  check('record type "GRN-linked coil" → the 3 GRN coils, 57 cuts', (await kinds()).length === 3 && (await kinds()).every((k) => k === 'COIL')
    && conversionsCard(57).test(await cards()), await cards());
  await reset();

  /* ── 12 / 15. Search — a conversion number finds its row; a round's, its coil ── */
  await page.getByTestId('filter-search').fill('EXL/L-040');
  await settle();
  const l40 = cutRows().first();
  check('12. search "EXL/L-040" → that one imported cut, its own row, no recorded location, "Legacy import"',
    (await rows().count()) === 1 && (await data(cutRows(), 'conversion'))[0] === 'EXL/L-040' && (await data(cutRows(), 'origin'))[0] === 'IMPORT'
      && (await data(cutRows(), 'location'))[0] === '' && /Legacy import$/.test(flat(await l40.innerText())), flat(await l40.innerText().catch(() => '')));
  await l40.click();
  await page.waitForTimeout(400);
  check('12. …opened: "Imported record" with its source row, and that no location was recorded',
    /Source Imported record EXCEL_\S+\|CONVERSION\|L-040/.test(flat(await details().innerText()))
      && /No cutting location was recorded for it\./.test(flat(await details().innerText())), flat(await details().innerText()));
  await page.getByTestId('filter-search').fill('EXL/L-039');
  await settle();
  check('12. "EXL/L-039" → cut at JW001 (its Summary Scrap row)', (await data(cutRows(), 'location'))[0] === 'JW001');
  await page.getByTestId('filter-search').fill(firstRound);
  await settle();
  check(`15. search a round's conversion number (${firstRound}) → its coil AC-PLG-1, "1 of 30 match"`,
    same(await data(rows(), 'batch'), ['AC-PLG-1']) && /1 of 30 match/.test(flat(await coilRows().first().innerText())) && conversionsCard(1).test(await cards()));
  await coilRows().first().getByTestId('cut-history-expand').click();
  await page.waitForTimeout(1200);
  check('15. …opened, that round alone is lit', same(await rr.evaluateAll((els) => els.filter((e) => e.dataset.matches === 'true').map((e) => e.dataset.conversion)), [firstRound]));
  await coilRows().first().getByTestId('cut-history-expand').click();
  await page.getByTestId('filter-search').fill('jobwork steel');
  await settle();
  check('search by GRN supplier "jobwork steel" → AC-JW-1, its 25 rounds', same(await data(rows(), 'batch'), ['AC-JW-1']) && conversionsCard(25).test(await cards()));
  await reset();

  /* ── An API failure reads as a failure, never as "nothing cut" ── */
  expectFailures = true;
  await page.route('**/rm-ims/conversion-ledger?*', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated server failure (e2e)' }),
  }));
  await page.getByTestId('filter-search').fill('zz-err');
  await settle();
  await page.waitForTimeout(800);
  check('a failed request shows the error with Try again — not the no-match message, no cards, no counts',
    await page.getByTestId('history-error').isVisible() && /Could not load the cutting history/.test(flat(await page.getByTestId('history-error').innerText()))
      && (await page.getByTestId('history-empty').count()) === 0 && (await page.getByTestId('history-cards').count()) === 0
      && (await page.getByTestId('record-tab-all').getAttribute('data-count')) === '' && (await rows().count()) === 0);
  await page.unroute('**/rm-ims/conversion-ledger?*');
  expectFailures = false;
  await page.getByTestId('history-error').getByRole('button', { name: /try again/i }).click();
  await settle();
  check('Try again recovers (now a genuine no-match)', await page.getByTestId('history-empty').isVisible());
  await reset();

  /* ── 14. A real cut, through "Record Cutting Round" — the table picks it up ── */
  const before = [];
  for (let p = 0; p < 2; p += 1) { before.push(...await ids()); if (p < 1) await next(); }
  const dialog = page.getByTestId('coil-to-circle-dialog');
  await page.getByTestId('open-coil-to-circle').click();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
  await dialog.getByTestId('batch-input').fill('AC-PLG-1');
  await dialog.getByRole('radio', { name: /partial cutting/i }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const r = [...document.querySelectorAll('input[type="radio"][value="PARTIAL"]')][0];
    return r && !r.disabled;
  }, null, { timeout: 15000 });
  const facts = flat(await dialog.getByTestId('coil-facts').innerText());
  check('14. "Record Cutting Round" opens the existing form, which identifies the coil from its batch: AC-PLG-1, 5,000 kg, 3,500 kg left',
    /Total coil weight 5,000 kg/i.test(facts) && /3,500 kg/.test(facts), facts);
  await dialog.getByRole('radio', { name: /partial cutting/i }).check();
  await dialog.getByLabel(/^cut this round/i).first().fill('50');
  const circleRow = dialog.locator('table tbody tr').nth(0);
  await circleRow.locator('input[placeholder]').first().click();
  await page.waitForTimeout(500);
  await page.locator('ul[role="listbox"] li[role="option"]').first().click();
  await page.waitForTimeout(250);
  await circleRow.locator('input[type="number"]').nth(0).fill('9');
  await circleRow.locator('input[type="number"]').nth(1).fill('42');
  await page.waitForTimeout(500);
  const save = dialog.getByRole('button', { name: /save this conversion/i });
  check('14. the round is ready to save', await save.isEnabled());
  await save.click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await settle();
  check('14. the save closes the form and the table goes back to page 1', (await dialog.count()) === 0 && (await range()) === `1–10 of ${ROWS}`, await range());
  const after = [];
  for (let p = 0; p < 2; p += 1) { after.push(...await ids()); if (p < 1) await next(); }
  await prev();
  check('14. AC-PLG-1 moves to the top; every other row keeps its order — nothing repeated, nothing skipped',
    after[0] === plgId && same(after.slice(1), before.filter((x) => x !== plgId).slice(0, 19)), after.slice(0, 4).join(','));
  check('14. …its row now says 31 rounds', /31 rounds/.test(flat(await coilRows().first().innerText())), flat(await coilRows().first().innerText()));
  check('14. …and the cards count the new cut once: 105 conversions, 11,380 kg', /Total Conversions 105 62 on physical coils/.test(await cards())
    && /Total Coil Weight Cut 11,380 kg/.test(await cards()), await cards());
  await shot('04-after-cut', false);

  /* ── 16. "Total Scrap Generated" opens Scrap by Physical Coil ── */
  await page.getByTestId('card-scrap').click();
  await page.waitForURL(/\/scrap-ims\/by-coil/, { timeout: 15000 }).catch(() => {});
  check('16. clicking "Total Scrap Generated" opens Scrap by Physical Coil', /\/scrap-ims\/by-coil/.test(page.url()), page.url());

  /* ── 17. Laptop, tablet and phone ── */
  const sizes = [
    [1366, 900, 'laptop 1,366 px: the table, fitting without sideways scroll', 'table'],
    [1280, 900, 'laptop 1,280 px: record cards — two a row where the area is 760 px wide or more', 'cards'],
    [820, 1100, 'tablet 820 px (sidebar open): record cards, as many a row as fit', 'cards'],
    [390, 844, 'phone 390 px: record cards, one a row', 'cards'],
  ];
  for (const [w, h, label, want] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await go(`${APP}/rm-ims/conversion`);
    await rows().first().waitFor({ timeout: 20000 });
    await settle();
    const layout = await page.evaluate(() => {
      const recs = document.querySelector('[data-testid="history-records"]');
      const t = document.querySelector('table[aria-label="Coil to Circle history"]');
      return {
        table: !!t,
        tableScrolls: t ? t.parentElement.scrollWidth > t.parentElement.clientWidth + 1 : null,
        columns: recs && !t ? getComputedStyle(recs).gridTemplateColumns.split(' ').length : null,
        area: recs ? Math.round(recs.closest('.MuiPaper-root').getBoundingClientRect().width) : null,
      };
    });
    const ok = want === 'table'
      ? layout.table && layout.tableScrolls === false
      : !layout.table && layout.columns === (layout.area >= 760 ? 2 : 1);
    check(`17. ${label}; nothing scrolls the page sideways; 10 records, the pager at "1–10 of ${ROWS}"`,
      ok && (await overflowX()) <= 1 && (await rows().count()) === 10 && (await range()) === `1–10 of ${ROWS}`, JSON.stringify(layout));
    await shot(`05-${w}`, false);
  }
  // Phone: the filters fold behind one button; a card opens to its rounds.
  check('17. phone: Search on the bar, every other filter behind "Filters"', await page.getByTestId('filter-search').isVisible()
    && !(await page.getByTestId('filter-from').isVisible()) && /Filters/.test(flat(await page.getByTestId('filter-more').innerText())));
  await page.getByTestId('filter-more').click();
  await page.waitForTimeout(500);
  check('17. …"Filters" opens dates, circle, location, record type, batch and status', await page.getByTestId('filter-from').isVisible()
    && await page.getByTestId('filter-batch').isVisible() && await bar().getByRole('combobox', { name: /^Record type/ }).isVisible());
  await page.getByTestId('filter-more').click();
  const phoneCoil = coilRows().filter({ has: page.locator('[data-testid="cut-history-rounds"]', { hasText: '2 rounds' }) }).first();
  await phoneCoil.getByTestId('cut-history-expand').click();
  await page.waitForTimeout(1500);
  const pr = await page.locator('[role="region"][id^="coil-rounds-"]').first().boundingBox();
  check('17. phone: a coil card opens to its rounds as cards, inside the screen, no sideways scroll',
    (await page.getByTestId('cut-round-row').count()) === 2 && !!pr && pr.x >= 0 && pr.x + pr.width <= 391 && (await overflowX()) <= 1,
    `${Math.round(pr?.x)}+${Math.round(pr?.width)}`);
  await shot('06-phone-open');

  /* ── Console, page and API errors; React warnings ── */
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length}, React warnings: ${reactWarnings.length}`);
  for (const e of pageErrors.slice(0, 5)) console.log(`    page: ${e}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e.slice(0, 300)}`);
  for (const e of apiErrors.slice(0, 5)) console.log(`    api: ${e}`);
  for (const e of reactWarnings.slice(0, 5)) console.log(`    react: ${e.slice(0, 300)}`);
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors (other than the failure this spec caused)', consoleErrors.length === 0);
  check('no unexpected API errors', apiErrors.length === 0);
  check('no React or MUI warnings', reactWarnings.length === 0);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
