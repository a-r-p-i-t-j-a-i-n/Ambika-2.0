/**
 * Coil to Circle history — ROUND DETAILS, and how a coil's rounds and the
 * cuts that name no coil share the one table. Driven through the real UI.
 *
 *   node e2e/coilRounds.e2e.mjs
 *
 * Proves, on screen (numbers are the task's tests):
 *   1  every coil is collapsed by default; a ONE-round coil's row is enough —
 *      nothing under it repeats the row;
 *   2  opened on request, a one-round coil shows only what its row cannot:
 *      conversion number, cutting type, circle sizes — and its coil page;
 *   3  a multi-round coil opens to every round exactly once, oldest first;
 *      one coil open at a time;
 *   4  the coil row is the total of its rounds, which read as each round's own
 *      ("This round" / "After this round");
 *   5  opening and closing rows changes no figure (and --verify: no write);
 *   6  the same table lists every cut — the older ones naming no coil as rows
 *      of their own, one click ("Show only them") from the rest; a round's
 *      conversion number finds its coil;
 *   7  filters, pages, counts and cards; a date / location filter dims exactly
 *      the rounds the server's "N of M match" left out;
 *   8  a new coil's first round and an existing coil's next round land in the
 *      right place and order;
 *      plus: the details open in view when the wide table is scrolled sideways,
 *      and fit a phone.
 *
 * Expects (started separately):
 *   cd backend && node src/scripts/e2eCoilRoundsFixture.js --seed && … --api
 *   backend  :5099  e2eServer.js on ambika_e2e_coilrounds
 *   frontend :3100  with VITE_API_URL=http://127.0.0.1:5099/api/v1
 * then: node src/scripts/e2eCoilRoundsFixture.js --verify
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
await assertE2ESetup(APP, API, 'coilRounds.e2e.mjs');
const USER = { email: 'coilrounds-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

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
const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') consoleErrors.push(t);
    if ((m.type() === 'warning' || m.type() === 'error') && /^Warning:|React|validateDOMNesting|unique "key"|out-of-range|out of range/i.test(t)) reactWarnings.push(t);
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
  });
  const shot = async (name) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `coil-rounds-${name}.png`), fullPage: true });
  };
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  // ── The history ──
  const rows = () => page.getByTestId('cut-history-row');
  const row = (b) => page.locator(`[data-testid="cut-history-row"][data-batch="${b}"]`);
  const batches = () => rows().evaluateAll((els) => els.map((e) => e.dataset.batch));
  const rowTexts = () => rows().evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  // What the record tabs count — every row, coils, cuts with no coil.
  const count = async () => flat(await page.getByTestId('record-tabs').innerText().catch(() => ''));
  const cards = async () => flat(await page.getByTestId('history-cards').innerText().catch(() => ''));
  const regions = () => page.locator('[role="region"][id^="coil-rounds-"]');
  const roundRows = () => page.getByTestId('cut-round-row');
  const roundData = (k) => roundRows().evaluateAll((els, key) => els.map((e) => e.dataset[key]), k);
  const roundTexts = async () => (await roundRows().allInnerTexts()).map(flat);
  const settle = async () => {
    await page.waitForTimeout(450);
    await page.waitForFunction(() => {
      const t = document.querySelector('[aria-label="Coil to Circle history"][aria-busy]');
      return t && t.getAttribute('aria-busy') !== 'true';
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  // Open a coil and wait for what opens under it to load.
  const opened = async () => {
    await page.waitForFunction(() => {
      const r = document.querySelector('[role="region"][id^="coil-rounds-"]');
      return r && !r.querySelector('.MuiSkeleton-root');
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(350);
  };
  const expand = async (b, how = 'chevron') => {
    if (how === 'chevron') await row(b).getByTestId('cut-history-expand').click();
    else if (how === 'count') await row(b).getByTestId('cut-history-rounds').click();
    else await row(b).locator('td').nth(3).click();
    await opened();
  };
  const pick = async (scope, label, option) => {
    await page.getByTestId(scope).getByRole('combobox', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await settle();
  };
  const api = (p) => page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
    return r.json();
  }, `${API}${p}`);

  // ── Every row of the table: coils and the cuts that name no coil ──
  const allRows = () => page.locator('[data-testid="history-records"] > [data-id]');
  const cutRows = () => page.getByTestId('ledger-cut-row');
  const COUNT0 = 'All records (16) With physical coil (12) Without physical coil (4)';

  console.log('\nCOIL TO CIRCLE HISTORY — round details\n');

  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  await go(`${APP}/rm-ims/conversion`);
  await rows().first().waitFor({ timeout: 20000 });
  await settle();

  // The oracle: the same endpoints the screen calls (checked against the raw
  // documents by the fixture's --api run).
  const hist = await api('/rm-ims/cutting-history?limit=50');
  const coil = Object.fromEntries(hist.data.map((d) => [d.batchNo, d]));
  const lineage = async (b) => (await api(`/rm-ims/coil/${coil[b].coilId}/lineage`)).data;
  const L = {};
  for (const b of ['R-MULTI-3', 'R-LONG', 'R-MIXED', 'R-ONE-FULL', 'R-ONE-2SZ']) L[b] = await lineage(b);
  // The table's own rows, in order — 12 coils and 4 cuts naming no coil.
  const ledger = await api('/rm-ims/conversion-ledger?limit=50');
  const kinds1 = ledger.data.slice(0, 10).map((r) => r.kind);
  const coilsOnPage1 = kinds1.filter((k) => k === 'COIL').length;

  /* ── 1. Collapsed by default ── */
  check(`1. 12 coils and 4 older cuts, 10 rows on page 1 (${coilsOnPage1} of them coils), every one collapsed — no round details, no round table on screen`,
    (await count()) === COUNT0 && ledger.data.length === 16 && (await allRows().count()) === 10 && (await rows().count()) === coilsOnPage1
      && same(await allRows().evaluateAll((els) => els.map((e) => e.dataset.id)), ledger.data.slice(0, 10).map((r) => r.id))
      && (await allRows().evaluateAll((els) => els.every((e) => e.dataset.open === 'false')))
      && (await regions().count()) === 0 && (await roundRows().count()) === 0 && (await page.getByTestId('round-details').count()) === 0,
    await count());
  const cards0 = await cards();
  const texts0 = await rowTexts();
  check('1. the newest-cut coil heads the list; one-round coils say "1 round"',
    (await batches())[0] === 'R-LONG' && / 1 round /.test(flat(await row('R-ONE-FULL').innerText())), (await batches()).join(','));
  await shot('01-collapsed');

  /* ── 2. A one-round coil, opened on request ── */
  const oneRow = flat(await row('R-ONE-FULL').innerText());
  check('the one-round coil\'s row already says it all: 1,000 cut of 1,000 · 180 pcs · 860 kg · 140 scrap · 86% · 0 left · Fully cut',
    /1,000 of 1,000 180 860 kg 140 86% 0 Fully cut Physical coil$/.test(oneRow), oneRow);
  await expand('R-ONE-FULL', 'chevron');
  const one = page.getByTestId('round-details');
  const oneText = flat(await one.innerText().catch(() => ''));
  const r1 = L['R-ONE-FULL'][0];
  check('2. opened: ONE details line — no round table, no "Round 1" row repeating the coil',
    (await one.count()) === 1 && (await one.getAttribute('data-rounds')) === '1'
      && (await page.getByTestId('rounds-table').count()) === 0 && (await roundRows().count()) === 0, oneText);
  check('2. …its conversion number, the cutting type chosen (Full) and the circle size produced',
    flat(await page.getByTestId('round-details-conversion').innerText()) === r1.conversionNumber
      && flat(await page.getByTestId('round-details-type').innerText()) === 'Full'
      && flat(await page.getByTestId('round-details-sizes').innerText()) === 'JSL204-08-850 · Cu - 0.8mm - 8.50"',
    oneText);
  check('1. …and none of the row\'s figures again (no 1,000 · 860 · 140 · 86% · Fully cut)',
    !/1,000|860|140|86%|Fully cut/.test(oneText), oneText);
  const chevron = row('R-ONE-FULL').getByTestId('cut-history-expand');
  const regionId = await regions().first().getAttribute('id');
  check('accessible: the toggle says what it opens, is expanded, and controls the details region',
    (await chevron.getAttribute('aria-expanded')) === 'true' && (await chevron.getAttribute('aria-controls')) === regionId
      && /Hide the round details of batch R-ONE-FULL/.test(await chevron.getAttribute('aria-label'))
      && /Round details of batch R-ONE-FULL/.test(await regions().first().getAttribute('aria-label')));
  await shot('02-one-round-details');

  // Two sizes: the split is what the row cannot show.
  await expand('R-ONE-2SZ', 'count');
  check('3. one coil open at a time: opening R-ONE-2SZ closed R-ONE-FULL', (await regions().count()) === 1
    && (await row('R-ONE-FULL').getAttribute('data-open')) === 'false' && (await row('R-ONE-2SZ').getAttribute('data-open')) === 'true');
  check('2. two circle sizes: how pieces and weight split between them; cutting type Partial',
    flat(await page.getByTestId('round-details-sizes').innerText()) === 'JSL204-08-700 · 40 pcs · 230 kg | JSL204-08-850 · 30 pcs · 200 kg'
      && flat(await page.getByTestId('round-details-type').innerText()) === 'Partial',
    flat(await page.getByTestId('round-details-sizes').innerText()));

  // The round itself is one click away, in full.
  await page.getByTestId('round-details-coil-page').click();
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 15000 });
  await ready();
  await page.waitForTimeout(1800);
  const coilPage = flat(await page.locator('body').innerText());
  check('2. "Open coil page" → R-ONE-2SZ\'s page: 1 cutting round — Round 1 in full, its conversion and both circle sizes',
    page.url().endsWith(String(coil['R-ONE-2SZ'].coilId)) && /1 cutting round\b/.test(coilPage)
      && coilPage.includes(L['R-ONE-2SZ'][0].conversionNumber) && /JSL204-08-700/.test(coilPage) && /JSL204-08-850/.test(coilPage)
      && (await page.getByRole('button', { name: /^(Show|Hide) round 1$/ }).count()) === 1,
    coilPage.slice(0, 160));
  await page.goBack();
  await ready();
  await rows().first().waitFor({ timeout: 20000 });
  await settle();

  /* ── 3. Multi-round coils ── */
  check('3. back on the history, every coil collapsed again', (await regions().count()) === 0);
  await expand('R-MULTI-3', 'row');
  const multiText = flat(await row('R-MULTI-3').innerText());
  check('3. a click on the row opens a multi-round coil: "Cutting rounds (3)", its round table, the caption saying what the lines are',
    (await page.getByTestId('rounds-table').count()) === 1 && flat(await page.getByTestId('rounds-title').innerText()) === 'Cutting rounds (3)'
      && /^Oldest first\. Each line is one round; the coil row above is their total\.$/.test(flat(await page.getByTestId('rounds-caption').innerText())),
    flat(await page.getByTestId('rounds-caption').innerText()));
  const heads = (await page.getByTestId('rounds-table').locator('thead th').allInnerTexts()).map((h) => flat(h).toLowerCase());
  check('4. headers group a round\'s own figures ("This round") apart from the coil after it ("After this round"); no Location column (all PLG01)',
    heads.includes('this round') && heads.includes('after this round') && !heads.includes('location'), heads.join(' | '));
  const mr = await roundTexts();
  check('3. every round exactly once, numbered 1-2-3, in the API\'s order (oldest first)',
    same(await roundData('round'), ['1', '2', '3']) && same(await roundData('conversion'), L['R-MULTI-3'].map((r) => r.conversionNumber))
      && new Set(await roundData('conversion')).size === 3, mr.join(' | '));
  check('4. each line is that round: 400 / 600 / 500 kg cut (its pieces, circles, scrap, yield), 1,600 → 1,000 → 500 kg left',
    /^1 10-01-2026 \S+ Partial 400 [\d,]+ 340 60 85% 1,600 Partial$/.test(mr[0] || '')
      && /^2 20-01-2026 \S+ Partial 600 [\d,]+ 520 80 86\.67% 1,000 Partial$/.test(mr[1] || '')
      && /^3 10-02-2026 \S+ Partial 500 [\d,]+ 430 70 86% 500 Partial$/.test(mr[2] || ''), mr.join(' | '));
  check('4. …and the coil row is their total: 1,500 cut of 2,000 · 255 pcs · 1,290 kg · 210 scrap · 86% · 500 left · Partially cut · 3 rounds',
    / 3 rounds /.test(multiText) && /1,500 of 2,000 255 1,290 kg 210 86% 500 Partially cut Physical coil$/.test(multiText), multiText);
  const sums = L['R-MULTI-3'].reduce((s, r) => ({ cut: s.cut + r.cutKg, circles: s.circles + r.circlesKg, scrap: s.scrap + r.scrapKg }), { cut: 0, circles: 0, scrap: 0 });
  check('4. Σ rounds = the row (cut 1,500 · circles 1,290 · scrap 210), last round\'s remaining = the row\'s 500; no round equals the coil',
    sums.cut === coil['R-MULTI-3'].cutKg && sums.circles === coil['R-MULTI-3'].circlesKg && sums.scrap === coil['R-MULTI-3'].scrapKg
      && L['R-MULTI-3'][2].remainingAfterKg === coil['R-MULTI-3'].remainingKg && L['R-MULTI-3'].every((r) => r.cutKg !== coil['R-MULTI-3'].cutKg),
    JSON.stringify(sums));
  await shot('03-multi-round');

  await expand('R-LONG', 'chevron');
  const longConv = await roundData('conversion');
  check('3. R-LONG: all 12 rounds, each once, 1…12 — two cut on the same day stay in the order they were saved',
    (await roundRows().count()) === 12 && same(await roundData('round'), Array.from({ length: 12 }, (_, i) => String(i + 1)))
      && same(longConv, L['R-LONG'].map((r) => r.conversionNumber)) && new Set(longConv).size === 12 && (await regions().count()) === 1,
    `${await roundRows().count()} rows`);
  await expand('R-MIXED', 'chevron');
  const mixedHeads = (await page.getByTestId('rounds-table').locator('thead th').allInnerTexts()).map((h) => flat(h).toLowerCase());
  const mixedRows = await roundTexts();
  check('3. R-MIXED (cut in two places): the Location column appears — round 1 PLG01, round 2 JW001',
    mixedHeads.includes('location') && /PLG01/.test(mixedRows[0] || '') && /JW001/.test(mixedRows[1] || '')
      && /Mixed/.test(flat(await row('R-MIXED').innerText())), mixedRows.join(' | '));
  await shot('04-mixed');
  await row('R-MIXED').getByTestId('cut-history-expand').click();
  await page.waitForTimeout(500);
  check('3. closing it leaves nothing open', (await regions().count()) === 0 && (await row('R-MIXED').getAttribute('data-open')) === 'false');

  /* ── 5. Opening and closing changed no figure ── */
  check('5. after all that opening and closing: every coil row, the count and the cards are exactly as before',
    same(await rowTexts(), texts0) && (await cards()) === cards0 && (await count()) === COUNT0);
  const histAfter = await api('/rm-ims/cutting-history?limit=50');
  const convAfter = await api('/rm-ims/conversions?page=1&limit=1');
  const ledgerAfter = await api('/rm-ims/conversion-ledger?limit=1');
  check('5. …and on the server: still 12 coils · 27 rounds · 31 cuts — and 16 rows in the table',
    histAfter.meta.coils === 12 && histAfter.meta.rounds === 27 && convAfter.meta.conversionCount === 31
      && ledgerAfter.meta.entries === 16 && ledgerAfter.meta.cuts === 31);

  /* ── 7. Filters: the server counts, the details dim the rest ── */
  await page.getByTestId('filter-from').fill('2026-01-15');
  await page.getByTestId('filter-to').fill('2026-01-31');
  await settle();
  check('7. cut 15–31 Jan: R-MIXED and R-MULTI-3 — the tabs count 2 · 2 · 0; R-MULTI-3 says "1 of 3 match"',
    same((await batches()).sort(), ['R-MIXED', 'R-MULTI-3']) && (await cutRows().count()) === 0 && (await count()) === 'All records (2) With physical coil (2) Without physical coil (0)'
      && /1 of 3 match/.test(flat(await row('R-MULTI-3').innerText())), `${await count()}`);
  const janApi = await api('/rm-ims/conversion-ledger?limit=50&from=2026-01-15&to=2026-01-31');
  check('7. the cards add up the 3 matching rounds, as the server does (1,500 kg cut)',
    new RegExp(`Total Conversions ${janApi.meta.cuts} `).test(`${await cards()} `) && janApi.meta.cuts === 3
      && new RegExp(`Total Coil Weight Cut ${fmt(janApi.meta.cutKg)} kg`).test(await cards()) && janApi.meta.cutKg === 1500, await cards());
  await expand('R-MULTI-3', 'chevron');
  check('7. opened: round 2 (20 Jan) is the match; rounds 1 and 3 are dimmed — the caption says why',
    same(await roundData('matches'), ['false', 'true', 'false']) && /dimmed/.test(flat(await page.getByTestId('rounds-caption').innerText())));
  const opac = await roundRows().evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  check('7. …dimmed means faded, not hidden: all 3 rounds still listed', (await roundRows().count()) === 3
    && Number(opac[0]) < 1 && Number(opac[1]) === 1 && Number(opac[2]) < 1, opac.join(','));
  check('7. the undimmed rounds are exactly the server\'s "1 of 3"',
    (await roundData('matches')).filter((m) => m === 'true').length === janApi.data.find((d) => d.batchNo === 'R-MULTI-3').matchedRounds);
  await shot('05-filtered-dimmed');
  await page.getByTestId('filter-reset').click();
  await settle();
  await pick('history-filters', 'Cutting location', 'JW001 — Job Work');
  check('7. JW001: only R-MIXED, "1 of 2 match"', same(await batches(), ['R-MIXED']) && /1 of 2 match/.test(flat(await row('R-MIXED').innerText())));
  await expand('R-MIXED', 'chevron');
  check('7. opened: its JW001 round matches, the PLG01 round is dimmed', same(await roundData('matches'), ['false', 'true']));
  await page.getByTestId('filter-reset').click();
  await settle();
  check('7. Reset: 12 coils again; the coil left open now dims nothing',
    (await count()) === COUNT0 && (await regions().count()) === 1 && same(await roundData('matches'), [null, null])
      && !/dimmed/.test(flat(await page.getByTestId('rounds-caption').innerText())));
  // Pages.
  await page.getByRole('button', { name: /go to next page/i }).first().click();
  await settle();
  const p2 = await batches();
  const p2Want = ledger.data.slice(10).filter((r) => r.kind === 'COIL').map((r) => r.batchNo);
  check(`7. page 2: rows 11–16 — the oldest coils (${p2Want.join(', ')}) then the 3 imported cuts; count unchanged`,
    same(p2, p2Want) && same(await page.getByTestId('cut-history-sno').allInnerTexts(), ['11', '12', '13', '14', '15', '16'])
      && same(await allRows().evaluateAll((els) => els.map((e) => e.dataset.id)), ledger.data.slice(10).map((r) => r.id))
      && (await count()) === COUNT0, p2.join(','));
  await expand(p2[0], 'chevron');
  check('7. a one-round coil on page 2 opens to its details line', (await page.getByTestId('round-details').count()) === 1 && (await regions().count()) === 1);
  await page.getByRole('button', { name: /go to previous page/i }).first().click();
  await settle();
  check(`7. back on page 1: ${coilsOnPage1} coils, none open (the open one was on page 2)`, (await rows().count()) === coilsOnPage1 && (await regions().count()) === 0);

  /* ── 6. The same table: every cut, the older ones too — one click away ── */
  const foot = flat(await page.getByTestId('cut-history-untraceable').innerText());
  check('6. the table says 4 of its rows are older cuts (650 kg) that name no coil — and the "Without physical coil (4)" tab shows only them',
    /^4 rows are cuts \(650 kg\) that name no physical coil/.test(foot) && flat(await page.getByTestId('record-tab-none').innerText()) === 'Without physical coil (4)', foot);
  check('6. the hint says how the one table reads (a row per coil, a row of its own for a cut with none)',
    /One row per physical coil, totalled across its cutting rounds — open it for each round\. A cut that names no physical coil is a row of its own\./
      .test(flat(await page.locator('body').innerText())));
  await page.getByTestId('record-tab-none').click();
  await settle();
  check('6. "Without physical coil": exactly those 4 rows — 3 imports and 1 "No receipt available", no coil; the tab is pressed',
    (await count()) === COUNT0 && (await page.getByTestId('record-tab-none').getAttribute('aria-pressed')) === 'true'
      && (await cutRows().count()) === 4 && (await rows().count()) === 0
      && same((await cutRows().evaluateAll((els) => els.map((e) => e.dataset.origin))).sort(), ['IMPORT', 'IMPORT', 'IMPORT', 'NO_RECEIPT'])
      && /Without physical coil \(older cuts\)/.test(flat(await page.getByTestId('history-filters').innerText())), await count());
  await shot('06-older-cuts');
  await page.getByTestId('filter-reset').click();
  await settle();
  check('6. unfiltered: 31 conversions = the coils\' 27 rounds + those 4', /Total Conversions 31 27 on physical coils · 4 without physical coil/.test(await cards()), await cards());
  if (!(await page.getByTestId('filter-search').isVisible().catch(() => false))) {
    await page.getByTestId('history-filters').getByRole('button', { name: /more filters/i }).click();
    await page.waitForTimeout(350);
  }
  await page.getByTestId('filter-search').fill(L['R-MULTI-3'][1].conversionNumber);
  await settle();
  check('6. a round\'s conversion number finds its coil — R-MULTI-3, "1 of 3 match"',
    same(await batches(), ['R-MULTI-3']) && (await cutRows().count()) === 0 && /1 of 3 match/.test(flat(await row('R-MULTI-3').innerText())));
  await expand('R-MULTI-3', 'chevron');
  check('6. …opened, round 2 alone is lit', same(await roundData('matches'), ['false', 'true', 'false']));
  await row('R-MULTI-3').getByTestId('cut-history-expand').click();
  await page.waitForTimeout(400);
  await page.getByTestId('filter-reset').click();
  await settle();

  /* ── 8. New cuts land in place ── */
  const dialog = page.getByTestId('coil-to-circle-dialog');
  const cutRound = async (batchNo, kg, pcs, outKg) => {
    await page.getByTestId('open-coil-to-circle').click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);
    await dialog.getByTestId('batch-input').fill(batchNo);
    await dialog.getByRole('radio', { name: /partial cutting/i }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const r = [...document.querySelectorAll('input[type="radio"][value="PARTIAL"]')][0];
      return r && !r.disabled;
    }, null, { timeout: 15000 });
    await dialog.getByRole('radio', { name: /partial cutting/i }).check();
    await dialog.getByLabel(/^cut this round/i).first().fill(String(kg));
    const cr = dialog.locator('table tbody tr').nth(0);
    await cr.locator('input[placeholder]').first().click();
    await page.waitForTimeout(500);
    await page.locator('ul[role="listbox"] li[role="option"]').first().click();
    await page.waitForTimeout(250);
    await cr.locator('input[type="number"]').nth(0).fill(String(pcs));
    await cr.locator('input[type="number"]').nth(1).fill(String(outKg));
    await page.waitForTimeout(500);
    await dialog.getByRole('button', { name: /save this conversion/i }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await settle();
    await page.waitForTimeout(1200);
    const banner = flat(await page.getByTestId('last-cut-banner').innerText().catch(() => ''));
    return (banner.match(/Conversion (\S+) saved/) || [])[1] || '';
  };
  const newConv = await cutRound('UI-NEW', 200, 40, 180);
  check('8. a new coil\'s first round: UI-NEW heads the history as a one-round coil, collapsed',
    !!newConv && (await batches())[0] === 'UI-NEW' && / 1 round /.test(flat(await row('UI-NEW').innerText()))
      && (await row('UI-NEW').getAttribute('data-open')) === 'false' && (await count()) === 'All records (17) With physical coil (13) Without physical coil (4)', `${newConv} · ${await count()}`);
  await expand('UI-NEW', 'chevron');
  check('8. …opened, its details line names the conversion just saved',
    flat(await page.getByTestId('round-details-conversion').innerText()) === newConv);
  // The next round of an existing coil, with that coil left open.
  await expand('R-MULTI-3', 'chevron');
  const nextConv = await cutRound('R-MULTI-3', 100, 15, 85);
  await opened();
  const m4 = await roundTexts();
  check('8. the next round of R-MULTI-3: the coil moves to the top, now "4 rounds", 400 kg left',
    !!nextConv && (await batches())[0] === 'R-MULTI-3' && / 4 rounds .* 1,600 of 2,000 .* 400 Partially cut Physical coil$/.test(flat(await row('R-MULTI-3').innerText())),
    flat(await row('R-MULTI-3').innerText()));
  check('8. …its open round table refreshed itself: round 4 last, the conversion just saved, 400 kg left',
    same(await roundData('round'), ['1', '2', '3', '4']) && (await roundData('conversion'))[3] === nextConv
      && /^4 \S+ \S+ Partial 100 15 85 15 85% 400 Partial$/.test(m4[3] || '') && new Set(await roundData('conversion')).size === 4, m4[3]);
  check('8. the cards count both new rounds once each: 13 coils · 33 cuts (29 on physical coils)',
    /Physical Coils 13 /.test(await cards()) && /Total Conversions 33 29 on physical coils · 4 without physical coil/.test(await cards()), await cards());
  const firstTwo = await allRows().evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.batch));
  check('8. the table\'s first two rows are the two coils just cut, newest first: R-MULTI-3, then UI-NEW', same(firstTwo, ['R-MULTI-3', 'UI-NEW']),
    firstTwo.join(', '));
  await shot('07-after-cuts');

  /* ── The details open in view on a narrower screen ── */
  await page.setViewportSize({ width: 1320, height: 900 });
  await go(`${APP}/rm-ims/conversion`);
  await rows().first().waitFor({ timeout: 20000 });
  await settle();
  const scroller = page.locator('table[aria-label="Coil to Circle history"]').locator('xpath=..');
  const sw = await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; return { scrollLeft: el.scrollLeft, client: el.clientWidth, width: el.scrollWidth }; });
  await page.waitForTimeout(300);
  check('(1,320 px: the coil table scrolls sideways to reach its actions)', sw.width > sw.client && sw.scrollLeft > 0, JSON.stringify(sw));
  await row('R-LONG').getByTestId('row-actions').click();
  await page.getByTestId('row-action-toggle').click();
  await opened();
  const sBox = await scroller.boundingBox();
  const rBox = await regions().first().boundingBox();
  check('scrolled to the far right, the round details still open fully in view (pinned to the visible width)',
    !!sBox && !!rBox && rBox.x >= sBox.x - 1 && rBox.x + rBox.width <= sBox.x + sBox.width + 1 && rBox.width > 300,
    `scroller ${Math.round(sBox?.x)}–${Math.round((sBox?.x || 0) + (sBox?.width || 0))} · details ${Math.round(rBox?.x)}–${Math.round((rBox?.x || 0) + (rBox?.width || 0))}`);
  await shot('08-narrow-scrolled');

  /* ── Phone ── */
  await page.setViewportSize({ width: 390, height: 844 });
  await go(`${APP}/rm-ims/conversion`);
  await rows().first().waitFor({ timeout: 20000 });
  await settle();
  await expand('R-MULTI-3', 'chevron');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const pBox = await regions().first().boundingBox();
  check('phone: an opened coil adds no sideways page scroll; the details fit the screen', overflow <= 1 && !!pBox && pBox.width <= 390,
    `${overflow}px · details ${Math.round(pBox?.width)}px`);
  await shot('09-phone');

  /* ── Console, page and API errors; React warnings ── */
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length}, React warnings: ${reactWarnings.length}`);
  for (const e of pageErrors.slice(0, 5)) console.log(`    page: ${e}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e.slice(0, 300)}`);
  for (const e of apiErrors.slice(0, 5)) console.log(`    api: ${e}`);
  for (const e of reactWarnings.slice(0, 5)) console.log(`    react: ${e.slice(0, 300)}`);
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors', consoleErrors.length === 0);
  check('no API errors', apiErrors.length === 0);
  check('no React or MUI warnings', reactWarnings.length === 0);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
