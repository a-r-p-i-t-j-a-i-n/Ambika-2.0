/**
 * Cut Coils — "Select GRN / Received Coil" dropdown + "Manual Entry — No GRN",
 * driven through the real UI.
 *
 *   node e2e/coilToCircle.e2e.mjs
 *
 * Proves, on screen:
 *   • typing a batch number still fetches the coil (the existing behaviour);
 *   • the GRN dropdown lists real, eligible coils, searches, and selecting one
 *     fills exactly what the batch lookup fills — total / already cut /
 *     remaining, grade, rate, Received At — and the two stay in sync;
 *   • switching from one coil to another leaves nothing stale behind;
 *   • a manual coil with no GRN is entered once (with its total weight), cut in
 *     three rounds across a page reload, and shows up in Cutting History, on
 *     its coil page and in Scrap by Physical Coil;
 *   • bad manual input cannot be saved.
 *
 * The database is the oracle: backend/src/scripts/e2eCoilToCircleFixture.js
 * --verify checks what this run saved.
 *
 * Expects (started separately, see the fixture header):
 *   backend  :5099  e2eServer.js on ambika_e2e_ctc_test (seeded by seedCoilToCircleDemo.js)
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

const APP = process.env.APP_URL || 'http://127.0.0.1:3100';
const API = process.env.API_URL || 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'coilToCircle.e2e.mjs');
const USER = { email: 'ctc-demo@test.local', password: 'Demo@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/ctc';
const MANUAL = 'DEMO-CTC-UI-M1';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];
const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
  });
  const shot = async (name) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  };
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
  const settle = (ms = 1300) => page.waitForTimeout(ms);

  console.log('\nCUT COILS — GRN DROPDOWN + MANUAL ENTRY — real UI\n');
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true);

  await go(`${APP}/rm-ims/conversion`);
  await settle(2500);

  const batch = page.getByTestId('batch-input');
  const picker = page.getByTestId('grn-coil-picker').locator('input');
  const grade = page.getByRole('combobox', { name: /coil being cut/i }).first();
  const rate = page.getByLabel(/^rate/i).first();
  const receivedAt = page.getByLabel(/^received at/i).first();
  const cutField = page.getByLabel(/^cut this round/i).first();
  // textContent, not innerText: the tile labels are upper-cased by CSS, and
  // the assertions read the labels as written.
  const facts = () => page.getByTestId('coil-facts').first().textContent().then(flat);
  const saveBtn = page.getByRole('button', { name: /save this conversion/i });
  const options = () => page.locator('ul[role="listbox"] li[role="option"]');
  const receivedAtText = () => receivedAt.innerText().then(flat);
  const pickCircle = async (pcs, kg) => {
    const input = page.locator('table tbody tr').nth(0).locator('input[placeholder]').first();
    await input.click();
    await page.waitForTimeout(500);
    await options().first().click();
    await page.waitForTimeout(250);
    const row = page.locator('table tbody tr').nth(0);
    await row.locator('input[type="number"]').nth(0).fill(String(pcs));
    await row.locator('input[type="number"]').nth(1).fill(String(kg));
  };
  const clearBatch = async () => { await batch.fill(''); await settle(600); };

  /* ── 0. The mode selector, the dropdown, and the empty state ── */
  check('mode selector offers both ways in', (await page.getByTestId('mode-grn').count()) === 1 && (await page.getByTestId('mode-manual').count()) === 1);
  check('GRN mode is the default', (await page.getByTestId('mode-grn').getAttribute('aria-pressed')) === 'true');
  check('"Select GRN / Received Coil" dropdown is on the form', (await picker.count()) === 1);
  check('before any coil, Total coil weight reads "—"', /Total coil weight\s*—/.test(await facts()), (await facts()).slice(0, 80));
  check('"No receipt available" toggle is still offered in GRN mode', (await page.getByText('No receipt available', { exact: true }).count()) === 1);
  await shot('00-open');

  /* ── 1. Batch number auto-fetch — unchanged ── */
  await batch.fill('DEMO-CTC-004');
  await settle(2200);
  let f = await facts();
  check('typing DEMO-CTC-004 fetches the coil: 1,800 total · 700 already cut · 1,100 remaining',
    /1,800 kg/.test(f) && /Already cut\s*700 kg/.test(f) && /Remaining weight\s*1,100 kg/.test(f), f.slice(0, 160));
  check('…grade filled (JSL202-08)', /JSL202-08/.test(await grade.inputValue()), await grade.inputValue());
  check('…rate filled from its GRN (175)', (await rate.inputValue()) === '175', await rate.inputValue());
  check('…Received At filled from its GRN (JW001)', /JW001/.test(await receivedAtText()), await receivedAtText());
  check('…and the GRN dropdown shows the same coil', /DEMO-CTC-GRN-004 · DEMO-CTC-004 · JSL202-08/.test(await picker.inputValue()), await picker.inputValue());
  await shot('01-batch-autofetch');

  /* ── 2. The dropdown: contents, search, empty search ── */
  await page.getByRole('button', { name: /clear coil/i }).click();
  await clearBatch();
  check('"Clear coil" empties the dropdown too', (await picker.inputValue()) === '');
  await picker.click();
  await settle(1500);
  const listed = await options().allInnerTexts();
  const batches = listed.map((t) => (t.match(/Batch (DEMO-CTC-[\w-]+)/) || [])[1]).filter(Boolean);
  check('dropdown lists eligible coils from the database', batches.length >= 5 && batches.includes('DEMO-CTC-003') && batches.includes('DEMO-CTC-005'), batches.join(', '));
  check('…never the fully cut DEMO-CTC-007', !batches.includes('DEMO-CTC-007'));
  check('…never the draft / cancelled / no-GRN probes', !batches.some((b) => /^DEMO-CTC-T-/.test(b)));
  check('…each option shows GRN, batch, coil, date, location, original and remaining',
    listed.every((t) => /DEMO-CTC-GRN-\d{3}/.test(t) && /Received \d{2} \w{3} \d{4}/.test(t) && /at (PLG01|JW001)/.test(t) && /Original [\d,]+ kg/.test(t) && /Remaining [\d,]+ kg/.test(t)),
    flat(listed[0]));
  check('…a partly cut coil is marked as such', listed.some((t) => /DEMO-CTC-004/.test(t) && /partly cut/.test(t)));
  await shot('02-dropdown-open');
  await picker.fill('Cu 0.80');
  await settle(1500);
  const cu = await options().allInnerTexts();
  check('search by item name ("Cu 0.80") narrows to that grade', cu.length >= 1 && cu.every((t) => /JSL204-08/.test(t)), cu.map(flat).join(' | ').slice(0, 160));
  await picker.fill('ZZZ-NO-SUCH');
  await settle(1500);
  check('a search with no match says so', /No received coil with weight left matches "ZZZ-NO-SUCH"/.test(flat(await page.locator('.MuiAutocomplete-noOptions').innerText().catch(() => ''))));
  await picker.fill('DEMO-CTC-GRN-003');
  await settle(1500);
  await options().first().click();
  await settle(2000);
  f = await facts();
  check('selecting DEMO-CTC-GRN-003 fills 1,500 total · 500 already cut · 1,000 remaining',
    /1,500 kg/.test(f) && /Already cut\s*500 kg/.test(f) && /Remaining weight\s*1,000 kg/.test(f), f.slice(0, 160));
  check('…the batch box follows (DEMO-CTC-003)', (await batch.inputValue()) === 'DEMO-CTC-003');
  check('…grade JSL202-06, rate 170, Received At PLG01',
    /JSL202-06/.test(await grade.inputValue()) && (await rate.inputValue()) === '170' && /PLG01/.test(await receivedAtText()),
    `${await grade.inputValue()} · ${await rate.inputValue()} · ${await receivedAtText()}`);
  await shot('03-dropdown-selected');

  /* ── 3. Switch to another GRN — nothing stale ── */
  await page.getByLabel(/partial cutting/i).check();
  await cutField.fill('123');
  await pickCircle(10, 3);
  await picker.click();
  await picker.fill('DEMO-CTC-005');
  await settle(1500);
  await options().first().click();
  await settle(2200);
  f = await facts();
  check('switching to DEMO-CTC-005: 2,200 total · 0 cut · 2,200 remaining', /2,200 kg/.test(f) && /Already cut\s*0 kg/.test(f) && /Remaining weight\s*2,200 kg/.test(f), f.slice(0, 160));
  check('…grade JSL204-10, rate 200, batch DEMO-CTC-005',
    /JSL204-10/.test(await grade.inputValue()) && (await rate.inputValue()) === '200' && (await batch.inputValue()) === 'DEMO-CTC-005');
  check('…the previous round is gone: no cutting type chosen, "Cut this round" empty',
    !(await page.getByLabel(/partial cutting/i).isChecked()) && !(await page.getByLabel(/full cutting/i).isChecked()) && (await cutField.inputValue()) === '');
  check('…and the previous coil\'s circle size was dropped (not approved for JSL204-10)',
    (await page.locator('table tbody tr').nth(0).locator('input[placeholder]').first().inputValue()) === '');
  await shot('04-switched');

  /* ── 4. Save a partial cut of a coil picked from the dropdown ── */
  await picker.click();
  await picker.fill('DEMO-CTC-003');
  await settle(1500);
  await options().first().click();
  await settle(2000);
  await page.getByLabel(/partial cutting/i).check();
  await cutField.fill('250');
  await page.locator('table tbody tr').nth(0).locator('input[placeholder]').first().fill('');
  await pickCircle(700, 225);
  await settle(500);
  check('Save is enabled for a valid partial cut', await saveBtn.isEnabled());
  await saveBtn.click();
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check('the cut saves', (await page.getByText(/Conversion .* saved/).count()) >= 1);
  await settle(1500);
  check('…the form resets (batch empty, dropdown empty)', (await batch.inputValue()) === '' && (await picker.inputValue()) === '');
  await batch.fill('DEMO-CTC-003');
  await settle(2200);
  f = await facts();
  check('DEMO-CTC-003 now: 750 kg already cut, 750 kg remaining', /Already cut\s*750 kg/.test(f) && /Remaining weight\s*750 kg/.test(f), f.slice(0, 160));
  await clearBatch();
  await page.getByRole('button', { name: /clear coil/i }).click().catch(() => {});

  /* ── 5. Manual Entry — No GRN: round 1 (new coil) ── */
  await page.getByTestId('mode-manual').click();
  await settle(500);
  check('Manual mode: the GRN dropdown is hidden, Total coil weight field shown',
    (await page.getByTestId('grn-coil-picker').count()) === 0 && (await page.getByTestId('manual-total-input').count()) === 1);
  check('Manual mode: no stale coil carried over', (await grade.inputValue()) === '' && (await batch.inputValue()) === '');
  // A batch that already has a GRN is refused.
  await batch.fill('DEMO-CTC-002');
  await settle(1500);
  check('a GRN batch typed in Manual Entry is refused, with a way back to its GRN',
    (await page.getByTestId('manual-grn-conflict').count()) === 1 && /has a goods receipt/.test(await page.getByTestId('manual-grn-conflict').innerText()));
  check('…its total weight cannot be entered and Save stays disabled', await page.getByTestId('manual-total-input').isDisabled() && !(await saveBtn.isEnabled()));
  await shot('05-manual-grn-conflict');

  await batch.fill(MANUAL);
  await settle(1500);
  check('a new batch reads "New manual coil"', /New manual coil/.test(flat(await page.locator('body').innerText())));
  await grade.click();
  await grade.fill('JSL204-07');
  await settle(500);
  await options().first().click();
  await settle(600);
  const total = page.getByTestId('manual-total-input');
  for (const bad of ['0', '-5']) {
    await total.fill(bad);
    await settle(300);
    check(`total coil weight "${bad}" is flagged and the round stays locked`,
      /number above 0 kg/.test(flat(await page.locator('body').innerText())) && await page.getByLabel(/partial cutting/i).isDisabled());
  }
  await total.fill('1500');
  await settle(600);
  f = await facts();
  check('with batch, coil and total: 1,500 total · 0 cut · 1,500 remaining', /1,500 kg/.test(f) && /Already cut\s*0 kg/.test(f) && /Remaining weight\s*1,500 kg/.test(f), f.slice(0, 160));
  check('the manual banner says it is a new manual coil with no GRN', /Manual coil DEMO-CTC-UI-M1 · JSL204-07 · no GRN/.test(await page.getByTestId('manual-coil-banner').innerText()));
  await page.getByLabel(/partial cutting/i).check();
  await cutField.fill('1600');
  await settle(300);
  check('a round larger than the total coil weight is blocked', !(await saveBtn.isEnabled()));
  await cutField.fill('400');
  await pickCircle(1100, 360);
  await settle(400);
  check('the circle list offers only JSL204-07 sizes', /JSL204-07-/.test(await page.locator('table tbody tr').nth(0).locator('input[placeholder]').first().inputValue()));
  await shot('06-manual-round1-ready');
  await saveBtn.click();
  await page.getByText(/Manual coil DEMO-CTC-UI-M1 recorded at 1,500 kg/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check('round 1 saves and records the manual coil at 1,500 kg', (await page.getByText(/Manual coil DEMO-CTC-UI-M1 recorded at 1,500 kg/).count()) >= 1);
  await settle(1500);

  /* ── 6. Round 2 — the same coil, found again by its batch ── */
  await batch.fill(MANUAL.toLowerCase());
  await settle(1800);
  f = await facts();
  check('typing the batch again (any case) continues the coil: 1,500 · 400 cut · 1,100 remaining',
    /1,500 kg/.test(f) && /Already cut\s*400 kg/.test(f) && /Remaining weight\s*1,100 kg/.test(f), f.slice(0, 160));
  check('…total weight is locked to the stored 1,500 and the coil grade cannot change',
    (await total.inputValue()) === '1500' && await total.isDisabled() && await grade.isDisabled());
  await page.getByLabel(/partial cutting/i).check();
  await cutField.fill('600');
  await pickCircle(1700, 545);
  await settle(400);
  await saveBtn.click();
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await settle(1500);

  /* ── 7. Reload — the coil and its history persist; round 3 is FULL ── */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await settle(2500);
  await page.getByTestId('mode-manual').click();
  await batch.fill(MANUAL);
  await settle(1800);
  f = await facts();
  check('after a reload: 1,500 total · 1,000 cut · 500 remaining (2 rounds)',
    /1,500 kg/.test(f) && /Already cut\s*1,000 kg/.test(f) && /Remaining weight\s*500 kg/.test(f) && /2 previous rounds/.test(f), f.slice(0, 200));
  await page.getByLabel(/full cutting/i).check();
  await settle(300);
  check('Full cutting takes exactly the remaining 500 kg (read-only)', (await cutField.inputValue()) === '500');
  await pickCircle(1400, 455);
  await settle(400);
  await shot('07-manual-round3-full');
  await saveBtn.click();
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await settle(1800);
  await batch.fill(MANUAL);
  await settle(1800);
  f = await facts();
  check('after the full round: 1,500 cut, 0 remaining, Fully cut', /Already cut\s*1,500 kg/.test(f) && /Remaining weight\s*0 kg/.test(f) && /Fully cut/i.test(f), f.slice(0, 200));
  check('Full cutting is no longer possible on it', await page.getByLabel(/full cutting/i).isDisabled());

  /* ── 8. Cutting History, coil page, Scrap by Physical Coil ── */
  const histRow = page.locator(`[data-testid="cut-history-row"][data-batch="${MANUAL}"]`);
  await histRow.waitFor({ timeout: 10000 }).catch(() => {});
  const hr = flat(await histRow.innerText().catch(() => ''));
  check('Cutting History lists the manual coil as "Manual entry (no GRN)" with 1,500 cut and 0 left', /Manual entry \(no GRN\)/.test(hr) && /1,500/.test(hr), hr.slice(0, 200));
  await page.getByTestId('manual-coil-banner').getByRole('button', { name: /view this coil's history/i }).click();
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 10000 });
  await ready();
  await settle(1800);
  const coilPage = flat(await page.locator('body').innerText());
  check('coil page: manual entry, no GRN, total 1,500, three rounds 400 / 600 / 500',
    /Manual entry · no GRN/.test(coilPage) && /None — manual entry/.test(coilPage) && /Cut 3 times/.test(coilPage), coilPage.slice(0, 220));
  await shot('08-manual-coil-page');
  await go(`${APP}/scrap-ims/by-coil`);
  await settle(2500);
  const sRow = page.locator(`[data-testid="scrap-by-coil-row"][data-batch="${MANUAL}"]`);
  const sr = flat(await sRow.innerText().catch(() => ''));
  check('Scrap by Physical Coil identifies the manual coil (manual entry · 3 rounds)', /Manual entry · no GRN/.test(sr) && /\b3\b/.test(sr), sr.slice(0, 200));
  await shot('09-scrap-by-coil');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? `\n  ${consoleErrors.slice(0, 8).join('\n  ')}` : ''}`);
  console.log(`page errors: ${pageErrors.length}${pageErrors.length ? `\n  ${pageErrors.slice(0, 8).join('\n  ')}` : ''}`);
  console.log(`API errors (>=400): ${apiErrors.length}${apiErrors.length ? `\n  ${apiErrors.slice(0, 8).join('\n  ')}` : ''}`);
  await browser.close();
  process.exit(failed.length || pageErrors.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
