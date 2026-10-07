/**
 * Multi-round cutting of ONE physical coil, driven through the real UI.
 *
 *   node e2e/multiRoundCut.e2e.mjs
 *
 * Coil MR-UI-B001 (2,000 kg, PLG01) is cut twice, 1,000 kg each time, exactly
 * as an operator would: type the batch, read what the coil has left, enter
 * "Cut this round", the circles, save — then do it again. In between and after,
 * the Cutting History under the form must update itself: one row for the coil,
 * Partially → Fully cut, rounds 1 → 2, and the rounds in order on expand.
 *
 * Nothing is asserted from a toast. backend/src/scripts/e2eMultiRoundFixture.js
 * --verify reads the database afterwards and is the real oracle.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_e2e_multiround scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
const USER = { email: 'multiround-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const BATCH = 'MR-UI-B001';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
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
    await page.screenshot({ path: path.join(SHOTS, `multiround-${name}.png`), fullPage: true });
  };
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  console.log('\nMULTI-ROUND COIL CUTTING — real UI\n');

  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true);

  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(2500);

  /* ── Cutting History sits on the SAME page, below the form ── */
  const historyHeading = page.getByText('Cutting History', { exact: true });
  check('"Cutting History" is on the Cut Coils page', (await historyHeading.count()) === 1);
  check('…with the required subtitle', (await page.getByText('See how much of each physical coil was cut, what was produced, what remains, and every cutting round.').count()) === 1);
  const saveBox = await page.getByRole('button', { name: /save this conversion/i }).boundingBox();
  const histBox = await historyHeading.boundingBox();
  check('…BELOW the form (under the Save button)', !!saveBox && !!histBox && histBox.y > saveBox.y, `${saveBox?.y} < ${histBox?.y}`);
  const historyRow = () => page.locator(`[data-testid="cut-history-row"][data-batch="${BATCH}"]`);
  check('the uncut coil is not in the history yet', (await historyRow().count()) === 0);
  check('the untraceable older cuts are stated, not hidden', /1 older cut/.test(await page.getByTestId('cut-history-untraceable').innerText()),
    await page.getByTestId('cut-history-untraceable').innerText());
  await shot('01-open');

  const batch = page.getByLabel(/batch number/i).first();
  const cutField = page.getByLabel(/^cut this round/i).first();
  const facts = () => page.getByTestId('coil-facts').innerText().then(flat);
  const afterRound = () => page.getByTestId('after-round').innerText().then(flat);
  const thisRound = () => page.getByTestId('this-round').innerText().then(flat);
  const saveBtn = page.getByRole('button', { name: /save this conversion/i });

  const pickCircle = async (pcs, kg) => {
    const input = page.locator('table tbody tr').nth(0).locator('input[placeholder]').first();
    await input.click();
    await page.waitForTimeout(400);
    await page.locator('ul[role="listbox"] li[role="option"]').first().click();
    await page.waitForTimeout(250);
    const row = page.locator('table tbody tr').nth(0);
    await row.locator('input[type="number"]').nth(0).fill(String(pcs));
    await row.locator('input[type="number"]').nth(1).fill(String(kg));
  };

  /* ── Rate comes from the coil's own receipt, never from the grade ── */
  const rateField = page.getByLabel(/^rate/i).first();
  const gradeBox = page.getByRole('combobox', { name: /coil being cut/i }).first();
  const pickGrade = async (code) => {
    await gradeBox.click();
    await gradeBox.fill(code);
    await page.waitForTimeout(400);
    await page.locator('ul[role="listbox"] li[role="option"]').first().click();
    await page.waitForTimeout(400);
  };
  await pickGrade('JSL204-07');
  check('picking a coil GRADE does not fill the rate', (await rateField.inputValue()) === '', await rateField.inputValue());

  /* ── ROUND 1 ── */
  await batch.fill(BATCH);
  await page.waitForTimeout(3000);
  check('entering the batch fills the rate from that coil\'s goods receipt (₹170)', (await rateField.inputValue()) === '170', await rateField.inputValue());
  let f = await facts();
  check('round 1 — Original coil weight 2,000 kg', /Original coil weight 2,000 kg/i.test(f), f);
  check('round 1 — Already cut 0 kg, 0 previous rounds', /Already cut 0 kg 0 previous rounds/i.test(f), f);
  check('round 1 — Available to cut 2,000 kg', /Available to cut 2,000 kg/i.test(f), f);
  check('round 1 — status Not cut (derived, not chosen)', /Cutting status Not cut/i.test(f), f);
  check('"Cut this round" is NOT pre-filled with the whole coil', (await cutField.inputValue()) === '', await cutField.inputValue());
  check('no manual Partially/Fully cut control exists', (await page.getByRole('checkbox', { name: /fully cut|partially cut/i }).count()) === 0
    && (await page.getByRole('combobox', { name: /fully cut|partially cut|cut status/i }).count()) === 0);

  // Over-cut is refused before it ever reaches the server.
  await cutField.fill('2001');
  await page.waitForTimeout(400);
  let body = flat(await page.locator('body').innerText());
  check('2,001 kg shows "Only 2,000 KG is available from this physical coil."', /Only 2,000 KG is available from this physical coil\./.test(body));
  check('…and Save is disabled', await saveBtn.isDisabled());
  await cutField.fill('0');
  await page.waitForTimeout(200);
  check('0 kg is flagged and Save stays disabled', /Enter a weight above 0 kg/.test(flat(await page.locator('body').innerText())) && await saveBtn.isDisabled());
  await cutField.fill('-5');
  await page.waitForTimeout(200);
  check('a negative weight is flagged and Save stays disabled', /Enter a weight above 0 kg/.test(flat(await page.locator('body').innerText())) && await saveBtn.isDisabled());
  await shot('02-overcut-blocked');

  await cutField.fill('1000');
  await pickCircle(170, 850);
  await page.waitForTimeout(600);
  const t1 = await thisRound();
  check('this round: Cut 1,000 kg · Circle output 850 kg · Scrap 150 kg · Yield 85%',
    /Cut 1,000 kg/i.test(t1) && /Circle output 850 kg/i.test(t1) && /Scrap 150 kg/i.test(t1) && /Yield 85%/i.test(t1), t1);
  let a = await afterRound();
  check('after this round: Original 2,000 · Already cut 0 · This round 1,000 · Remaining 1,000 · Partially cut',
    /Original 2,000 kg/i.test(a) && /Already cut 0 kg/i.test(a) && /This round 1,000 kg/i.test(a) && /Remaining 1,000 kg/i.test(a) && /Partially cut/i.test(a), a);
  check('…labelled as round 1 of this coil', new RegExp(`round 1 of coil ${BATCH}`, 'i').test(flat(await page.locator('body').innerText())));
  await shot('03-round1-ready');
  await saveBtn.click();
  await page.waitForTimeout(4000);
  check('round 1 saves', /saved/i.test(await page.locator('body').innerText()));
  check('the form resets after saving', (await cutField.inputValue()) === '' && (await batch.inputValue()) === '');

  let hr = flat(await historyRow().innerText().catch(() => ''));
  check('Cutting History now has the coil: total cut 1,000, remaining 1,000, Partially cut, 1 round',
    (await historyRow().count()) === 1 && /2,000 1,000 850 150 85% 1,000 Partially cut PLG01 1$/.test(hr), hr);
  await shot('04-round1-saved');

  /* ── ROUND 2 — the SAME physical coil ── */
  await batch.fill(BATCH);
  await page.waitForTimeout(3000);
  f = await facts();
  check('round 2 — the same batch shows Original 2,000 kg', /Original coil weight 2,000 kg/i.test(f), f);
  check('round 2 — Already cut 1,000 kg, 1 previous round', /Already cut 1,000 kg 1 previous round/i.test(f), f);
  check('round 2 — Available to cut 1,000 kg', /Available to cut 1,000 kg/i.test(f), f);
  check('round 2 — status Partially cut', /Cutting status Partially cut/i.test(f), f);
  await cutField.fill('1001');
  await page.waitForTimeout(300);
  check('1,001 kg now shows "Only 1,000 KG is available from this physical coil."',
    /Only 1,000 KG is available from this physical coil\./.test(flat(await page.locator('body').innerText())) && await saveBtn.isDisabled());
  await cutField.fill('1000');
  await pickCircle(164, 820);
  await page.waitForTimeout(600);
  a = await afterRound();
  check('after round 2: Already cut 1,000 · This round 1,000 · Remaining 0 · Fully cut',
    /Already cut 1,000 kg/i.test(a) && /This round 1,000 kg/i.test(a) && /Remaining 0 kg/i.test(a) && /Fully cut/i.test(a), a);
  check('…labelled as round 2 of this coil', new RegExp(`round 2 of coil ${BATCH}`, 'i').test(flat(await page.locator('body').innerText())));
  const t2 = await thisRound();
  check('round 2 scrap/yield are its own (180 kg, 82%), not against the original coil', /Scrap 180 kg/i.test(t2) && /Yield 82%/i.test(t2), t2);
  await shot('05-round2-ready');
  await saveBtn.click();
  await page.waitForTimeout(4000);
  check('round 2 saves', /saved/i.test(await page.locator('body').innerText()));

  hr = flat(await historyRow().innerText().catch(() => ''));
  check('still ONE history row for the coil', (await historyRow().count()) === 1);
  check('history row: total cut 2,000, circles 1,670, scrap 330, weighted yield 83.5%, remaining 0, Fully cut, 2 rounds',
    /2,000 2,000 1,670 330 83\.5% 0 Fully cut PLG01 2$/.test(hr), hr);

  /* ── Expand the coil: every round, in order ── */
  await historyRow().click();
  await page.waitForTimeout(1500);
  const roundRows = page.getByTestId('cut-round-row');
  const rr = (await roundRows.allInnerTexts()).map(flat);
  check('expanding the coil shows its 2 rounds', rr.length === 2, String(rr.length));
  check('round 1: 1,000 cut, 850 out, 150 scrap, 85%, 1,000 remaining, Partial', /^1 \S+ .*1,000 kg 850 kg 150 kg 85% 1,000 kg Partial/.test(rr[0] || ''), rr[0]);
  check('round 2: 1,000 cut, 820 out, 180 scrap, 82%, 0 remaining, Fully cut', /^2 \S+ .*1,000 kg 820 kg 180 kg 82% 0 kg Fully cut/.test(rr[1] || ''), rr[1]);
  await shot('06-history-expanded');

  /* ── A fully cut coil is still findable, and says so ── */
  await batch.fill(BATCH);
  await page.waitForTimeout(4000);
  f = await facts().catch(() => '');
  check('typing the fully cut batch finds it: Available 0 kg, Fully cut, 2 previous rounds',
    /Available to cut 0 kg/i.test(f) && /Cutting status Fully cut/i.test(f) && /2 previous rounds/i.test(f), f);
  await shot('07-fully-cut-lookup');
  check('the batch filled the rate again (₹170)', (await rateField.inputValue()) === '170', await rateField.inputValue());
  await pickGrade('JSL204-07');
  check('changing the coil grade unlinks the batch and clears ITS rate — no grade rate takes its place',
    (await rateField.inputValue()) === '', await rateField.inputValue());

  const unexpectedApi = apiErrors;
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length}`);
  for (const e of pageErrors.slice(0, 5)) console.log(`    page: ${e}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e}`);
  for (const e of unexpectedApi.slice(0, 5)) console.log(`    api: ${e}`);
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors', consoleErrors.length === 0);
  check('no API errors (over-cuts were stopped before reaching the server)', unexpectedApi.length === 0);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
