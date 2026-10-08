/**
 * Scrap by physical coil, driven through the real UI in Chromium.
 *
 *   node e2e/scrapByCoil.e2e.mjs
 *
 * Follows cutCoils.e2e.mjs: the playwright LIBRARY, not @playwright/test,
 * because that is what is installed. Everything here is read off the rendered
 * page — backend/src/scripts/e2eScrapByCoilFixture.js --verify is the database
 * oracle. This file checks what the OPERATOR can see.
 *
 * What it proves: that both demo coils appear as their own rows with the right
 * figures, that clicking one opens that coil's cutting rounds and only that
 * coil's, that the untraceable bucket is still reported beside them, and that
 * search and the location filter narrow the table.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_e2e_scrapcoil scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';

/** Same reason as cutCoils.e2e.mjs: use the newest Chromium already in the cache. */
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
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'scrapByCoil.e2e.mjs');
const USER = { email: 'scrap-coil-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

/**
 * What the screen must show. Transcribed from the client's worked example, NOT
 * imported from the fixture — so the UI is checked against the brief rather
 * than against the same constants that produced the data.
 */
const EXPECTED = {
  'DEMO-COIL-001': {
    received: '2,000', cut: '1,300', output: '1,105', scrap: '195',
    scrapPct: '15%', yield: '85', remaining: '700', rounds: '2',
    skuCode: 'JSL204-07', grn: 'GRN-DEMO-001', supplier: 'Demo Supplier',
  },
  'DEMO-COIL-002': {
    received: '2,500', cut: '1,000', output: '820', scrap: '180',
    scrapPct: '18%', yield: '82', remaining: '1,500', rounds: '1',
    skuCode: 'JSL204-08', grn: 'GRN-DEMO-002', supplier: 'Demo Supplier',
  },
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};

const consoleErrors = [];
const pageErrors = [];

const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `scrapbycoil-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`    shot → ${file}`);
};

/** Every data row of the by-coil table, as plain cell text. */
const readTable = async (page) => page.$$eval('table tbody tr', (rows) => rows
  .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.trim()))
  .filter((cells) => cells.length >= 12));

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  console.log('\nScrap by physical coil — browser\n');

  /* ── Log in ── */
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true, page.url().replace(APP, '') || '/');

  /* ── 1–2. Open the screen, both coils present ── */
  await page.goto(`${APP}/scrap-ims/by-coil`, { waitUntil: 'domcontentloaded' });
  // Wait for the DATA, not merely for a <tr> — the loading state renders a
  // skeleton row, so `table tbody tr` is satisfied before the query resolves.
  await page.waitForSelector('table tbody tr:has-text("DEMO-COIL-001")', { timeout: 30000 });
  const body = await page.innerText('body');

  check('the page is the by-coil screen', body.includes('Scrap by physical coil'));
  check('header says 2 coils traced', /2\s+coils traced/.test(body), body.match(/\d+\s+coils traced/)?.[0]);
  check('untraceable bucket is still reported',
    /246,779\.3\s*kg untraceable/.test(body) || /untraceable/i.test(body),
    body.match(/[\d,.]+\s*kg untraceable/)?.[0]);

  const rows = await readTable(page);
  check('the table has exactly 2 physical coils', rows.length === 2, `got ${rows.length}`);
  await shot(page, '1-list');

  /* ── 3–11. Every column, for each coil ── */
  for (const [batchNo, e] of Object.entries(EXPECTED)) {
    const row = rows.find((c) => c[1]?.includes(batchNo));
    console.log(`\n— ${batchNo} —`);
    if (!row) { check(`${batchNo} row is on screen`, false, 'not found'); continue; }
    check(`${batchNo} row is on screen`, true);
    // Columns: 0 S.No | 1 Coil/batch | 2 Item | 3 Received | 4 Cut | 5 Output
    //          6 Scrap | 7 Scrap% | 8 Yield | 9 Remaining | 10 Rounds | 11 Supplier/GRN
    const cell = (i) => (row[i] || '').replace(/\s+/g, ' ').trim();
    check(`${batchNo} batch number`, cell(1).includes(batchNo), cell(1));
    check(`${batchNo} item code ${e.skuCode}`, cell(2).includes(e.skuCode), cell(2));
    check(`${batchNo} received = ${e.received}`, cell(3).startsWith(e.received), cell(3));
    check(`${batchNo} cut = ${e.cut}`, cell(4).startsWith(e.cut), cell(4));
    check(`${batchNo} output = ${e.output}`, cell(5).startsWith(e.output), cell(5));
    check(`${batchNo} scrap = ${e.scrap}`, cell(6).startsWith(e.scrap), cell(6));
    check(`${batchNo} scrap % = ${e.scrapPct}`, cell(7) === e.scrapPct, cell(7));
    check(`${batchNo} yield = ${e.yield}%`, cell(8).includes(e.yield), cell(8));
    check(`${batchNo} remaining = ${e.remaining}`, cell(9).startsWith(e.remaining), cell(9));
    check(`${batchNo} rounds = ${e.rounds}`, cell(10) === e.rounds, cell(10));
    check(`${batchNo} supplier`, cell(11).includes(e.supplier), cell(11));
    check(`${batchNo} GRN ${e.grn}`, cell(11).includes(e.grn), cell(11));
  }

  /* ── 12–15. Click through to the coil's cutting rounds ── */
  console.log('\n— drill-down —');
  await page.click('table tbody tr:has-text("DEMO-COIL-001")');
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const detail = await page.innerText('body');

  check('clicking the row opens a coil page', /\/rm-ims\/coil\//.test(page.url()), page.url());
  check('the coil page names DEMO-COIL-001', detail.includes('DEMO-COIL-001'));
  check('DEMO-COIL-002 does NOT appear inside DEMO-COIL-001',
    !detail.includes('DEMO-COIL-002'));
  check('the 2,000 kg arrival weight is shown', /2,000/.test(detail));

  // The rounds table on the lineage page.
  const roundRows = await page.$$eval('table tbody tr', (rs) => rs
    .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.trim()))
    .filter((c) => c.length > 2));
  const roundsText = roundRows.map((r) => r.join(' | '));
  check('two cutting rounds are listed', roundRows.length >= 2, `${roundRows.length} rows`);
  check('round 1 shows 800 kg cut', roundsText.some((t) => t.includes('800')), roundsText[0]);
  check('round 2 shows 500 kg cut', roundsText.some((t) => t.includes('500')), roundsText[1]);
  check('round 1 precedes round 2 (chronological)',
    roundsText.findIndex((t) => t.includes('800')) < roundsText.findIndex((t) => t.includes('500')));
  await shot(page, '2-coil1-rounds');

  /* ── 16. Search by batch number ── */
  console.log('\n— search & filter —');
  await page.goto(`${APP}/scrap-ims/by-coil`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr:has-text("DEMO-COIL-001")', { timeout: 30000 });
  const search = page.locator('input[placeholder*="Search"]').first();
  await search.fill('DEMO-COIL-001');
  await page.waitForTimeout(1200);
  let r = await readTable(page);
  check('search by batch number narrows to 1 row', r.length === 1, `got ${r.length}`);
  check('search by batch number keeps the right coil',
    r[0]?.[1]?.includes('DEMO-COIL-001'), r[0]?.[1]);
  await shot(page, '3-search-batch');

  /* ── 17. Search by coil code ── */
  await search.fill('');
  await search.fill('JSL204-08');
  await page.waitForTimeout(1200);
  r = await readTable(page);
  check('search by coil code narrows to 1 row', r.length === 1, `got ${r.length}`);
  check('search by coil code keeps the right coil',
    r[0]?.[1]?.includes('DEMO-COIL-002'), r[0]?.[1]);

  /* ── 18. Location filter ── */
  await search.fill('');
  await page.waitForTimeout(900);
  const locSelect = page.locator('div[role="combobox"]').first();
  await locSelect.click();
  await page.locator('li[role="option"]', { hasText: 'PLG01' }).first().click()
    .catch(async () => { await page.locator('li[role="option"]').nth(1).click(); });
  await page.waitForTimeout(1200);
  r = await readTable(page);
  check('PLG01 filter shows only the in-house coil',
    r.length === 1 && r[0][1].includes('DEMO-COIL-001'),
    r.map((x) => x[1]).join(' / '));
  await shot(page, '4-filter-plg01');

  await locSelect.click();
  await page.locator('li[role="option"]', { hasText: 'JW001' }).first().click()
    .catch(async () => { await page.locator('li[role="option"]').nth(2).click(); });
  await page.waitForTimeout(1200);
  r = await readTable(page);
  check('JW001 filter shows only the job-work coil',
    r.length === 1 && r[0][1].includes('DEMO-COIL-002'),
    r.map((x) => x[1]).join(' / '));

  /* ── No errors on the way ── */
  console.log('');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
