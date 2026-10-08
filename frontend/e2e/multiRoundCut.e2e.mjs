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
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'multiRoundCut.e2e.mjs');
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
  await page.getByTestId('cut-history-untraceable').waitFor({ timeout: 15000 }).catch(() => {});
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
  /* ── Before any coil is chosen: information shows "—", the round is locked ── */
  {
    const f0 = flat(await page.getByTestId('coil-facts').innerText());
    check('no coil: Total coil weight / Already cut / Remaining weight all read "—"',
      /Total coil weight —/i.test(f0) && /Already cut —/i.test(f0) && /Remaining weight —/i.test(f0), f0);
    check('no coil: Full and Partial cutting are both disabled',
      await page.getByRole('radio', { name: /full cutting/i }).isDisabled() && await page.getByRole('radio', { name: /partial cutting/i }).isDisabled());
    check('no coil: "Cut this round" is disabled', await page.getByLabel(/^cut this round/i).first().isDisabled());
    check('no coil: "No physical coil chosen yet." is shown', /No physical coil chosen yet\./.test(await page.locator('body').innerText()));
    await shot('00-no-coil');
  }

  await pickGrade('JSL204-07');
  check('picking a coil GRADE does not fill the rate', (await rateField.inputValue()) === '', await rateField.inputValue());
  check('a coil grade alone is not a physical coil: the round stays locked', await page.getByLabel(/^cut this round/i).first().isDisabled());

  /* ── ROUND 1 ── */
  await batch.fill(BATCH);
  await page.waitForTimeout(3000);
  check('entering the batch fills the rate from that coil\'s goods receipt (₹170)', (await rateField.inputValue()) === '170', await rateField.inputValue());
  let f = await facts();
  check('round 1 — Total coil weight 2,000 kg', /Total coil weight 2,000 kg/i.test(f), f);
  check('round 1 — Already cut 0 kg, 0 previous rounds', /Already cut 0 kg 0 previous rounds/i.test(f), f);
  check('round 1 — Remaining weight 2,000 kg', /Remaining weight 2,000 kg/i.test(f), f);
  check('round 1 — status Not cut (derived, not chosen)', /Cutting status Not cut/i.test(f), f);
  check('"Cut this round" is NOT pre-filled with the whole coil', (await cutField.inputValue()) === '', await cutField.inputValue());
  check('the physical-coil STATUS is not something the operator can set (no status control)',
    (await page.getByRole('checkbox', { name: /fully cut|partially cut/i }).count()) === 0
    && (await page.getByRole('combobox', { name: /fully cut|partially cut|cut status/i }).count()) === 0);

  // Cutting TYPE is the operator's choice for this round — offered, never pre-selected.
  const fullRadio = page.getByRole('radio', { name: /full cutting/i });
  const partialRadio = page.getByRole('radio', { name: /partial cutting/i });
  check('Cutting type offers Full cutting and Partial cutting', (await fullRadio.count()) === 1 && (await partialRadio.count()) === 1);
  check('…neither is pre-selected', !(await fullRadio.isChecked()) && !(await partialRadio.isChecked()));
  check('…and the weight cannot be entered until one is chosen', await cutField.isDisabled());
  await partialRadio.check();
  await page.waitForTimeout(200);
  check('Partial cutting makes "Cut this round" editable', await cutField.isEditable());

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
  check('after this round: Partial · Total 2,000 · Already cut 0 · This round 1,000 · Remaining 1,000 · Partially cut',
    /Cutting type Partial/i.test(a) && /Total coil 2,000 kg/i.test(a) && /Already cut 0 kg/i.test(a) && /This round 1,000 kg/i.test(a)
      && /Remaining 1,000 kg/i.test(a) && /Partially cut/i.test(a), a);
  const o1 = flat(await page.getByTestId('round-outcome').innerText());
  check('beside the field, After this round: Cut this round 1,000 · Remaining weight 1,000 · Status Partially cut',
    /Cut this round 1,000 kg Remaining weight 1,000 kg Status Partially cut/i.test(o1), o1);
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
  check('round 2 — the same batch shows Total coil weight 2,000 kg', /Total coil weight 2,000 kg/i.test(f), f);
  check('round 2 — Already cut 1,000 kg, 1 previous round', /Already cut 1,000 kg 1 previous round/i.test(f), f);
  check('round 2 — Remaining weight 1,000 kg', /Remaining weight 1,000 kg/i.test(f), f);
  check('round 2 — status Partially cut', /Cutting status Partially cut/i.test(f), f);
  check('round 2 — the cutting type starts unchosen again for the new round',
    !(await fullRadio.isChecked()) && !(await partialRadio.isChecked()));
  await partialRadio.check();
  await cutField.fill('1001');
  await page.waitForTimeout(300);
  check('Partial 1,001 kg shows "Only 1,000 KG is available from this physical coil."',
    /Only 1,000 KG is available from this physical coil\./.test(flat(await page.locator('body').innerText())) && await saveBtn.isDisabled());
  // Full cutting: the system fills the remaining weight, read-only.
  await fullRadio.check();
  await page.waitForTimeout(300);
  check('Full cutting sets "Cut this round" to the remaining 1,000 kg automatically', (await cutField.inputValue()) === '1000', await cutField.inputValue());
  check('…and the operator cannot type over it (read-only)', !(await cutField.isEditable()));
  await pickCircle(164, 820);
  await page.waitForTimeout(600);
  a = await afterRound();
  check('after round 2: Full · Already cut 1,000 · This round 1,000 · Remaining 0 · Fully cut',
    /Cutting type Full/i.test(a) && /Already cut 1,000 kg/i.test(a) && /This round 1,000 kg/i.test(a) && /Remaining 0 kg/i.test(a) && /Fully cut/i.test(a), a);
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
  check('round 1: cutting type Partial, 1,000 cut, 850 out, 150 scrap, 85%, 1,000 remaining, Partial',
    /^1 \S+ \S+ Partial 1,000 kg 850 kg 150 kg 85% 1,000 kg Partial/.test(rr[0] || ''), rr[0]);
  check('round 2: cutting type Full, 1,000 cut, 820 out, 180 scrap, 82%, 0 remaining, Fully cut',
    /^2 \S+ \S+ Full 1,000 kg 820 kg 180 kg 82% 0 kg Fully cut/.test(rr[1] || ''), rr[1]);
  await shot('06-history-expanded');

  /* ── A fully cut coil is still findable, and says so ── */
  await batch.fill(BATCH);
  await page.waitForTimeout(4000);
  f = await facts().catch(() => '');
  check('typing the fully cut batch finds it: Remaining 0 kg, Fully cut, 2 previous rounds',
    /Remaining weight 0 kg/i.test(f) && /Cutting status Fully cut/i.test(f) && /2 previous rounds/i.test(f), f);
  check('…and Full cutting is unavailable — nothing is left to take', await fullRadio.isDisabled());
  await shot('07-fully-cut-lookup');
  check('the batch filled the rate again (₹170)', (await rateField.inputValue()) === '170', await rateField.inputValue());
  await pickGrade('JSL204-07');
  check('changing the coil grade unlinks the batch and clears ITS rate — no grade rate takes its place',
    (await rateField.inputValue()) === '', await rateField.inputValue());

  /* ── A FRESH coil cut completely in ONE round (Full cutting) ── */
  const FULL_BATCH = 'MR-UI-FULL';
  await batch.fill(FULL_BATCH);
  await page.waitForTimeout(3000);
  f = await facts();
  check('fresh coil: Total 2,000 · Already cut 0 · Remaining 2,000', /Total coil weight 2,000 kg/i.test(f) && /Already cut 0 kg/i.test(f) && /Remaining weight 2,000 kg/i.test(f), f);
  await fullRadio.check();
  await page.waitForTimeout(300);
  check('Full cutting sets "Cut this round" to the whole 2,000 kg', (await cutField.inputValue()) === '2000', await cutField.inputValue());
  // Two circle sizes in one round: 1,000 + 700 = 1,700 kg out of 2,000.
  await pickCircle(200, 1000);
  await page.getByRole('button', { name: /add another circle size/i }).click();
  await page.waitForTimeout(300);
  {
    const input = page.locator('table tbody tr').nth(1).locator('input[placeholder]').first();
    await input.click();
    await page.waitForTimeout(400);
    await page.locator('ul[role="listbox"] li[role="option"]').nth(1).click();
    await page.waitForTimeout(250);
    const row = page.locator('table tbody tr').nth(1);
    await row.locator('input[type="number"]').nth(0).fill('140');
    await row.locator('input[type="number"]').nth(1).fill('700');
  }
  await page.waitForTimeout(600);
  const t3 = await thisRound();
  check('one Full round, two circle sizes: Cut 2,000 · Circle output 1,700 · Scrap 300 · Yield 85%',
    /Cut 2,000 kg/i.test(t3) && /Circle output 1,700 kg/i.test(t3) && /Scrap 300 kg/i.test(t3) && /Yield 85%/i.test(t3), t3);
  a = await afterRound();
  check('after this round: Full · Remaining 0 · Fully cut', /Cutting type Full/i.test(a) && /Remaining 0 kg/i.test(a) && /Fully cut/i.test(a), a);
  await shot('08-full-one-round-ready');
  await saveBtn.click();
  await page.waitForTimeout(4000);
  check('the one-round full cut saves', /saved/i.test(await page.locator('body').innerText()));
  const fullRow = page.locator(`[data-testid="cut-history-row"][data-batch="${FULL_BATCH}"]`);
  const fr = flat(await fullRow.innerText().catch(() => ''));
  check('history: the coil is Fully cut in 1 round — 2,000 cut, 1,700 out, 300 scrap, 85%, 0 left',
    /2,000 2,000 1,700 300 85% 0 Fully cut PLG01 1$/.test(fr), fr);
  await fullRow.click();
  await page.waitForTimeout(1500);
  const fRounds = (await page.getByTestId('cut-round-row').allInnerTexts()).map(flat).filter((t) => /2,000 kg 1,700 kg/.test(t));
  check('its single round shows cutting type Full and status Fully cut', /^1 \S+ \S+ Full 2,000 kg 1,700 kg 300 kg 85% 0 kg Fully cut/.test(fRounds[0] || ''), fRounds[0]);
  await shot('09-full-one-round-history');

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
