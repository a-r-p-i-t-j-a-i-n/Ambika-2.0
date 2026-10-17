/**
 * Coil to Circle page — history table, filters, summary cards and the entry
 * form in its dialog, driven through the real UI.
 *
 *   node e2e/coilToCircleHistory.e2e.mjs
 *
 * Proves, on screen:
 *   • the page opens on the history table with the form closed;
 *   • "+ Coil to Circle" opens the existing form; Close / Cancel return to the
 *     table, asking first when something was entered;
 *   • a failed save keeps every value and says why; a successful save (even
 *     double-clicked) closes the form and refreshes table, cards and count;
 *   • batch (partial), date range, Circle SKU and PLG01 / JW001 filters, alone
 *     and combined; Reset; the empty state; an API failure that reads as a
 *     failure, never as "no history";
 *   • pagination, S.No. across pages, the matching-record count;
 *   • GRN-linked and manual coils both listed; a multi-round coil is one row
 *     whose rounds open under it, its weight never counted twice.
 *
 * The database is the oracle: backend/src/scripts/e2eCoilHistoryFixture.js
 * --verify checks what this run saved (exactly one round, nothing from the
 * failed save) and reconciles coil, circle and scrap stock.
 *
 * Expects (started separately):
 *   cd backend && node src/scripts/e2eCoilHistoryFixture.js --seed && … --api && … --bulk
 *   backend  :5099  e2eServer.js on ambika_e2e_coilhistory
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
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'coilToCircleHistory.e2e.mjs');
const USER = { email: 'coilhistory-e2e@test.local', password: 'E2e@12345' };
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

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // Failures this spec CAUSES on purpose are tagged here and not counted.
  let expectFailures = false;
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !(expectFailures && /500|Internal Server Error|Simulated/i.test(t))) consoleErrors.push(t);
    if ((m.type() === 'warning' || m.type() === 'error') && /^Warning:|React|validateDOMNesting|unique "key"|out-of-range/i.test(t)) reactWarnings.push(t);
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !expectFailures) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
  });
  const shot = async (name) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `ctc-history-${name}.png`), fullPage: true });
  };
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  const rows = () => page.getByTestId('cut-history-row');
  const batchesShown = async () => (await rows().evaluateAll((els) => els.map((e) => e.dataset.batch)));
  const count = async () => flat(await page.getByTestId('history-count').innerText().catch(() => ''));
  const cards = async () => flat(await page.getByTestId('history-cards').innerText().catch(() => ''));
  // Wait until the table has settled on an answer (not loading, not dimmed).
  const settle = async () => {
    await page.waitForTimeout(500);
    await page.waitForFunction(() => {
      const t = document.querySelector('table[aria-label="Coil to Circle history"]');
      return t && t.getAttribute('aria-busy') !== 'true';
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  const dialog = page.getByTestId('coil-to-circle-dialog');
  const openForm = async () => {
    await page.getByTestId('open-coil-to-circle').click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);
  };
  const pickSelect = async (label, option) => {
    await page.getByRole('combobox', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await settle();
  };
  const reset = async () => { await page.getByTestId('filter-reset').click(); await settle(); };

  console.log('\nCOIL TO CIRCLE — history, filters and the entry form\n');

  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });

  await go(`${APP}/rm-ims/conversion`);
  await page.getByTestId('cut-history-row').first().waitFor({ timeout: 20000 });
  await settle();

  /* ── 1. Table first, form closed ── */
  const body0 = flat(await page.locator('body').innerText());
  check('1. title "Coil to Circle" and its explanation', /Coil to Circle/.test(body0)
    && body0.includes('View cutting records, track remaining coil weight and record new cutting rounds.'));
  check('1. the history table is visible', await page.getByRole('table', { name: 'Coil to Circle history' }).isVisible());
  check('1. the entry form is NOT open', (await dialog.count()) === 0 && (await page.getByTestId('coil-to-circle-form').count()) === 0);
  check('1. "+ Coil to Circle" is on screen', await page.getByTestId('open-coil-to-circle').isVisible());
  check('14. 10 rows on page 1, 12 coils counted', (await rows().count()) === 10 && /^12 coils$/.test(await count()), await count());
  const c0 = await cards();
  check('cards: 12 physical coils · 14 rounds · 5,300 kg cut · 470 kg scrap', /Physical coils 12/i.test(c0) && /Cutting rounds 14/i.test(c0)
    && /Coil weight cut 5,300 kg/i.test(c0) && /Scrap generated 470 kg/i.test(c0), c0);
  check('cards: scrap split PLG01 / job worker (350 / 120)', /PLG01 350 kg · with job worker 120 kg/.test(c0), c0);
  const sno1 = await page.getByTestId('cut-history-sno').allInnerTexts();
  check('14. S.No. 1–10 on page 1', same(sno1, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']), sno1.join(','));
  check('newest cut first: H-PLG-C, H-MAN-D, H-PLG-A, H-JW-B …', same((await batchesShown()).slice(0, 4), ['H-PLG-C', 'H-MAN-D', 'H-PLG-A', 'H-JW-B']));
  check('the untraceable older cut is stated', /1 older cut \(600 kg\)/.test(flat(await page.getByTestId('cut-history-untraceable').innerText())));
  await shot('01-open');

  /* ── 15. GRN-linked and manual both listed, and told apart ── */
  check('15. GRN-linked coils listed', (await page.locator('[data-testid="cut-history-row"][data-source="GRN"]').count()) >= 3);
  const manualRow = page.locator('[data-testid="cut-history-row"][data-batch="H-MAN-D"]');
  check('15. the manual coil is listed, marked "Manual entry · No GRN"', /Manual entry No GRN/.test(flat(await manualRow.innerText())));
  const aRow = page.locator('[data-testid="cut-history-row"][data-batch="H-PLG-A"]');
  const aText = flat(await aRow.innerText());
  check('15. a GRN coil shows its GRN number', /GRN GRN-H-H-PLG-A/.test(aText), aText);

  /* ── 16. A two-round coil: one row, whole-coil figures, rounds on open ── */
  check('16. H-PLG-A is ONE row: 2,000 total · 1,200 cut · 270 pcs · 1,090 kg · 110 scrap · 800 left · 2 rounds',
    (await aRow.count()) === 1 && /2,000 1,200 270 1,090 110 90.83% 800 Partially cut 2 rounds$/.test(aText), aText);
  check('16. its date shows the last cut and the first', /10-04-2026 first 05-03-2026/.test(aText), aText);
  await aRow.getByTestId('cut-history-rounds').click();
  await page.waitForTimeout(1500);
  const aRounds = (await page.getByTestId('cut-round-row').allInnerTexts()).map(flat);
  check('16. opening it shows both rounds, remaining 1,500 then 800', aRounds.length === 2
    && /^1 05-03-2026 .* 500 kg .* 1,500 kg/.test(aRounds[0]) && /^2 10-04-2026 .* 700 kg .* 800 kg/.test(aRounds[1]), aRounds.join(' | '));
  await aRow.getByTestId('cut-history-rounds').click();
  await page.waitForTimeout(400);

  /* ── 14. Pagination ── */
  await page.getByRole('button', { name: /go to next page/i }).click();
  await settle();
  check('14. page 2: 2 rows, S.No. 11 and 12', (await rows().count()) === 2
    && same(await page.getByTestId('cut-history-sno').allInnerTexts(), ['11', '12']));
  check('14. count unchanged on page 2', /^12 coils$/.test(await count()));

  /* ── 6. Batch number — partial, and resets to page 1 ── */
  await page.getByTestId('filter-batch').fill('plg');
  await settle();
  check('6. "plg" → H-PLG-C, H-PLG-A; back on page 1', same(await batchesShown(), ['H-PLG-C', 'H-PLG-A'])
    && same(await page.getByTestId('cut-history-sno').allInnerTexts(), ['1', '2']), (await batchesShown()).join(','));
  check('6. count says "2 coils match"', /^2 coils match$/.test(await count()), await count());
  await page.getByTestId('filter-batch').fill('H-JW-B');
  await settle();
  check('6. exact batch → only H-JW-B', same(await batchesShown(), ['H-JW-B']));
  await reset();
  check('11. Reset restores all 12', /^12 coils$/.test(await count()) && (await page.getByTestId('filter-batch').inputValue()) === '');

  /* ── 7. Date range on the cutting date ── */
  await page.getByTestId('filter-from').fill('2026-03-01');
  await page.getByTestId('filter-to').fill('2026-03-31');
  await settle();
  check('7. 01-03 → 31-03: H-MAN-D, H-PLG-A, H-JW-B', same(await batchesShown(), ['H-MAN-D', 'H-PLG-A', 'H-JW-B']), (await batchesShown()).join(','));
  check('7. count: 3 coils match · 3 matching rounds', /^3 coils match · 3 matching rounds$/.test(await count()), await count());
  const cMar = await cards();
  check('7/16. cards add up only March rounds: 3 rounds · 2,300 kg cut (no coil counted twice)',
    /Cutting rounds 3/i.test(cMar) && /Coil weight cut 2,300 kg/i.test(cMar) && /Rounds matching the filters/.test(cMar), cMar);
  check('7. a two-round coil says "1 of 2 match"', /1 of 2 match/.test(flat(await aRow.innerText())));
  check('7. …and still shows its WHOLE coil (1,200 cut, 800 left)', /2,000 1,200 .* 800 Partially cut/.test(flat(await aRow.innerText())));
  await page.getByTestId('filter-from').fill('2026-04-01');
  await page.getByTestId('filter-to').fill('2026-03-01');
  await settle();
  const bodyBad = flat(await page.locator('body').innerText());
  check('7. From after To is refused on screen, no rows shown', /"Cut from" is after "Cut to"/.test(bodyBad)
    && /Must be on or after "Cut from"/.test(bodyBad) && (await rows().count()) === 0);
  await reset();

  /* ── 8. Circle SKU produced ── */
  const circleBox = page.getByTestId('filter-circle');
  await circleBox.click();
  await circleBox.fill('08-850');
  await page.getByRole('option', { name: /JSL204-08-850/ }).click();
  await settle();
  check('8. circle JSL204-08-850 → H-PLG-C, H-JW-B', same(await batchesShown(), ['H-PLG-C', 'H-JW-B']), (await batchesShown()).join(','));
  const optsShown = await (async () => {
    await circleBox.click();
    await page.waitForTimeout(300);
    const o = (await page.getByRole('option').allInnerTexts()).map(flat);
    await page.keyboard.press('Escape');
    return o;
  })();
  check('8. offered sizes are circle SKUs only, never a coil SKU', optsShown.length >= 6 && optsShown.every((o) => /^JSL20\d-\d\d-\d{3,4}/.test(o)), optsShown.join(' | '));
  await reset();

  /* ── 9. PLG01 / JW001 ── */
  await pickSelect('Cutting location', 'JW001 — Job Work');
  check('9. JW001 → H-JW-B only', same(await batchesShown(), ['H-JW-B']));
  check('9. …its scrap is all with the job worker', /PLG01 0 kg · with job worker 120 kg/.test(await cards()), await cards());
  await pickSelect('Cutting location', 'PLG01 — Plant');
  check('9. PLG01 → 11 coils, none of them H-JW-B', /^11 coils match/.test(await count()) && !(await batchesShown()).includes('H-JW-B'), await count());

  /* ── 10. Filters combine ── */
  await circleBox.click();
  await circleBox.fill('08-850');
  await page.getByRole('option', { name: /JSL204-08-850/ }).click();
  await settle();
  check('10. PLG01 + JSL204-08-850 → H-PLG-C only', same(await batchesShown(), ['H-PLG-C']));

  /* ── Filters survive opening and closing the form ── */
  await openForm();
  await page.getByTestId('close-coil-to-circle').click();
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await settle();
  check('filters are kept while the form opens and closes', same(await batchesShown(), ['H-PLG-C'])
    && /PLG01 — Plant/.test(flat(await page.getByTestId('history-filters').innerText())));

  /* ── 12. No results ── */
  await page.getByTestId('filter-batch').fill('plg');
  await pickSelect('Cutting location', 'JW001 — Job Work');
  await settle();
  check('12. "plg" + JW001 + 08-850 → the no-match message, not a blank table',
    (await rows().count()) === 0 && (await page.getByTestId('history-empty').isVisible())
      && /No coil matches these filters/.test(flat(await page.getByTestId('history-empty').innerText())));
  check('12. count says 0', /^0 coils match/.test(await count()), await count());
  await shot('02-no-match');
  await reset();
  check('11. Reset clears every filter', /^12 coils$/.test(await count()) && !(await page.getByTestId('filter-reset').isEnabled()));

  /* ── More filters: entry type ── */
  await page.getByRole('button', { name: /more filters/i }).click();
  await page.waitForTimeout(300);
  await pickSelect('Entry type', 'Manual entry (no GRN)');
  check('entry type "Manual entry" → H-MAN-D only', same(await batchesShown(), ['H-MAN-D']));
  await pickSelect('Cutting status', 'Fully cut');
  check('manual + fully cut → none', (await rows().count()) === 0);
  await reset();

  /* ── 13. API failure is a failure, not "no history" ── */
  expectFailures = true;
  await page.route('**/rm-ims/cutting-history?*', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated server failure (e2e)' }),
  }));
  await page.getByTestId('filter-batch').fill('zz-err');
  await settle();
  await page.waitForTimeout(800);
  check('13. a failed request shows the error with Try again', await page.getByTestId('history-error').isVisible()
    && /Could not load the cutting history/.test(flat(await page.getByTestId('history-error').innerText())));
  check('13. …not the empty-history message, not cards, not a count', (await page.getByTestId('history-empty').count()) === 0
    && (await page.getByTestId('history-cards').count()) === 0 && (await page.getByTestId('history-count').count()) === 0
    && (await rows().count()) === 0);
  await shot('03-api-failure');
  await page.unroute('**/rm-ims/cutting-history?*');
  expectFailures = false;
  await page.getByRole('button', { name: /try again/i }).click();
  await settle();
  check('13. Try again recovers (and now reads as a genuine no-match)', await page.getByTestId('history-empty').isVisible());
  await reset();

  /* ── 2 / 3. Open; Close with nothing entered; Cancel with something entered ── */
  await openForm();
  // The coil is identified by ONE Batch Number field — no mode buttons.
  check('2. "+ Coil to Circle" opens the existing form', await dialog.getByTestId('coil-to-circle-form').isVisible()
    && await dialog.getByTestId('batch-input').isVisible() && (await dialog.getByTestId('mode-grn').count()) === 0
    && await dialog.getByRole('button', { name: /save this conversion/i }).isVisible());
  check('2. the form no longer carries the "Yield is the share…" note', !/Yield is the share of the coil/i.test(flat(await dialog.innerText())));
  await shot('04-form-open');
  await page.getByTestId('close-coil-to-circle').click();
  await page.waitForTimeout(500);
  check('3. Close on an untouched form returns to the table at once', (await dialog.count()) === 0 && (await page.getByTestId('discard-dialog').count()) === 0);

  await openForm();
  await dialog.getByTestId('batch-input').fill('UI-E01');
  await page.waitForTimeout(400);
  await dialog.getByRole('button', { name: /^cancel$/i }).click();
  await page.waitForTimeout(300);
  check('3. Cancel with something entered asks before discarding', await page.getByTestId('discard-dialog').isVisible());
  await page.getByRole('button', { name: /keep editing/i }).click();
  await page.waitForTimeout(300);
  check('3. "Keep editing" keeps the form and what was typed', await dialog.isVisible() && (await dialog.getByTestId('batch-input').inputValue()) === 'UI-E01');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('3. Esc also asks', await page.getByTestId('discard-dialog').isVisible());
  await page.getByRole('button', { name: /^discard$/i }).click();
  await page.waitForTimeout(500);
  check('3. "Discard" closes the form', (await dialog.count()) === 0);
  await openForm();
  check('3. reopening starts a fresh form', (await dialog.getByTestId('batch-input').inputValue()) === '');

  /* ── 5. A failed save keeps everything ── */
  const fillRound = async (batchNo, cutKg, pcs, kg) => {
    await dialog.getByTestId('batch-input').fill(batchNo);
    await dialog.getByRole('radio', { name: /partial cutting/i }).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const r = [...document.querySelectorAll('input[type="radio"][value="PARTIAL"]')][0];
      return r && !r.disabled;
    }, null, { timeout: 15000 });
    await dialog.getByRole('radio', { name: /partial cutting/i }).check();
    await dialog.getByLabel(/^cut this round/i).first().fill(String(cutKg));
    const row = dialog.locator('table tbody tr').nth(0);
    await row.locator('input[placeholder]').first().click();
    await page.waitForTimeout(500);
    await page.locator('ul[role="listbox"] li[role="option"]').first().click();
    await page.waitForTimeout(250);
    await row.locator('input[type="number"]').nth(0).fill(String(pcs));
    await row.locator('input[type="number"]').nth(1).fill(String(kg));
    await page.waitForTimeout(500);
  };
  await fillRound('UI-F01', 300, 50, 280);
  const factsF = flat(await dialog.getByTestId('coil-facts').innerText());
  check('5. batch auto-fetch still fills the coil (1,000 kg, JW001 coil)', /Total coil weight 1,000 kg/i.test(factsF), factsF);
  check('5. Received At follows the coil\'s GRN (JW001)', /JW001/.test(flat(await dialog.getByRole('combobox', { name: /received at/i }).innerText())));
  expectFailures = true;
  await page.route('**/rm-ims/convert', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated server failure (e2e) — nothing saved' }),
  }));
  await dialog.getByRole('button', { name: /save this conversion/i }).click();
  await page.waitForTimeout(1500);
  check('5. the failure is shown in words', /Simulated server failure \(e2e\) — nothing saved/.test(flat(await page.locator('body').innerText())));
  const row0 = dialog.locator('table tbody tr').nth(0);
  check('5. the form stays open with every value kept', await dialog.isVisible()
    && (await dialog.getByTestId('batch-input').inputValue()) === 'UI-F01'
    && (await dialog.getByLabel(/^cut this round/i).first().inputValue()) === '300'
    && (await row0.locator('input[type="number"]').nth(0).inputValue()) === '50'
    && (await row0.locator('input[type="number"]').nth(1).inputValue()) === '280'
    && await dialog.getByRole('radio', { name: /partial cutting/i }).isChecked());
  await shot('05-failed-save-kept');
  await page.unroute('**/rm-ims/convert');
  expectFailures = false;
  await page.getByTestId('close-coil-to-circle').click();
  await page.getByRole('button', { name: /^discard$/i }).click();
  await page.waitForTimeout(500);

  /* ── 4 / 26. A successful save, double-clicked ── */
  await page.getByTestId('filter-batch').fill('UI-E01');
  await settle();
  check('before saving, UI-E01 is not in the history', (await rows().count()) === 0);
  await reset();
  await openForm();
  await fillRound('UI-E01', 600, 100, 550);
  const saveBtn = dialog.getByRole('button', { name: /save this conversion/i });
  check('4. the round is ready to save', await saveBtn.isEnabled());
  let convertPosts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/rm-ims\/convert$/.test(r.url())) convertPosts += 1; });
  await saveBtn.dblclick();
  await dialog.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await settle();
  await page.waitForTimeout(1200);
  check('4. a successful save closes the form', (await dialog.count()) === 0);
  check('26. a double-click sent ONE save', convertPosts === 1, `${convertPosts} POST /convert`);
  check('4. the page says what was saved', /saved against coil UI-E01/.test(flat(await page.getByTestId('last-cut-banner').innerText())));
  const ui = page.locator('[data-testid="cut-history-row"][data-batch="UI-E01"]');
  const uiText = flat(await ui.innerText().catch(() => ''));
  check('4. the table refreshed: UI-E01 first, 2,000 · 600 cut · 100 pcs · 550 kg · 50 scrap · 1,400 left · 1 round',
    (await batchesShown())[0] === 'UI-E01' && /2,000 600 100 550 50 91.67% 1,400 Partially cut 1 round$/.test(uiText), uiText);
  check('4. count and cards refreshed: 13 coils · 15 rounds · 5,900 kg', /^13 coils$/.test(await count())
    && /Cutting rounds 15/i.test(await cards()) && /Coil weight cut 5,900 kg/i.test(await cards()), `${await count()} | ${await cards()}`);
  await shot('06-saved');

  /* ── The "Cut a coil" shortcut opens the form ── */
  await go(`${APP}/rm-ims/conversion?new=1`);
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  check('?new=1 opens the form, and the URL is cleaned', await dialog.isVisible() && !/new=1/.test(page.url()));
  await page.getByTestId('close-coil-to-circle').click();

  /* ── Narrow screen: the page and the form still work ── */
  await page.setViewportSize({ width: 390, height: 844 });
  await go(`${APP}/rm-ims/conversion`);
  await page.getByTestId('cut-history-row').first().waitFor({ timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone width: no sideways page scroll (the table scrolls in its panel)', overflow <= 1, `${overflow}px`);
  await shot('07-phone');
  await openForm();
  const box = await dialog.boundingBox();
  check('phone width: the form opens full-screen', !!box && box.width >= 380 && box.x <= 1, JSON.stringify(box));
  await page.getByTestId('close-coil-to-circle').click();

  /* ── 29. Console, page and API errors; React warnings ── */
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length}, React warnings: ${reactWarnings.length}`);
  for (const e of pageErrors.slice(0, 5)) console.log(`    page: ${e}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e.slice(0, 300)}`);
  for (const e of apiErrors.slice(0, 5)) console.log(`    api: ${e}`);
  for (const e of reactWarnings.slice(0, 5)) console.log(`    react: ${e.slice(0, 300)}`);
  check('29. no uncaught page errors', pageErrors.length === 0);
  check('29. no console errors (other than the two failures this spec caused)', consoleErrors.length === 0);
  check('29. no unexpected API errors', apiErrors.length === 0);
  check('29. no React warnings', reactWarnings.length === 0);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
