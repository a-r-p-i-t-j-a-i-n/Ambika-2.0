/**
 * Cut Coils → Circles, driven through the real UI in Chromium.
 *
 *   node e2e/cutCoils.e2e.mjs
 *
 * Follows grnRm.e2e.mjs: the playwright LIBRARY, not @playwright/test, because
 * that is what is installed. Every action here happens in the browser, and
 * nothing is asserted from a toast — backend/src/scripts/e2eCutCoilsFixture.js
 * --verify reads the database afterwards and is the real oracle. This file
 * checks what the OPERATOR can see.
 *
 * What it proves: that the Circle produced dropdown depends on the coil the
 * batch number identified, that it offers only the client-approved sizes, that
 * a second row is restricted the same way, that a valid cut still saves, that
 * "Received At" auto-fills from the coil's own GRN (PLG01 or JW001, never
 * guessed from the SKU) and warns rather than silently accepting a manual
 * override, and that "Scrap checked?" offers exactly the two verification
 * states — nothing that reads like a location.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_e2e_cutcoils scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';

/** Same reason as grnRm.e2e.mjs: use the newest Chromium already in the cache. */
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
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'cutCoils.e2e.mjs');
const USER = { email: 'cut-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

/** The client's mapping, transcribed — NOT imported, so the UI is checked
 *  against the sheet rather than against the same module it is served from. */
const APPROVED = {
  'JSL204-07': ['JSL204-07-700', 'JSL204-07-750', 'JSL204-07-840'],
  'JSL204-08': ['JSL204-08-700', 'JSL204-08-825', 'JSL204-08-850', 'JSL204-08-889', 'JSL204-08-900', 'JSL204-08-978'],
  'JSL202-06': ['JSL202-06-700', 'JSL202-06-725', 'JSL202-06-775', 'JSL202-06-850', 'JSL202-06-875'],
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];

const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `cutcoils-${name}.png`), fullPage: true });
};

/**
 * The Coil to Circle form. The page opens on its history and the form is a
 * dialog opened from "+ Coil to Circle" — and the page behind it has its own
 * tables and a "Batch number" filter — so every form control is looked up
 * inside the dialog.
 */
const form = (page) => page.getByTestId('coil-to-circle-dialog');
const openCutForm = async (page) => {
  if (await form(page).count()) return;
  await page.getByTestId('open-coil-to-circle').click();
  await form(page).waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(800);
};

/** The circle Autocomplete on a given row (0-based). */
const circleInput = (page, row) => form(page).locator('table tbody tr').nth(row)
  .locator('input[placeholder]').first();

/** Open a row's circle picker and read back every option it offers. */
const openCircleOptions = async (page, row) => {
  const input = circleInput(page, row);
  // A disabled picker cannot be opened — and that IS the answer before a coil
  // is known, so report it rather than waiting 30s for it to become clickable.
  if (await input.isDisabled()) return { options: [], empty: null, disabled: true };
  await input.click();
  await page.waitForTimeout(400);
  const listbox = page.locator('ul[role="listbox"]');
  if (!(await listbox.count())) return { options: [], empty: await readNoOptions(page) };
  const options = await listbox.locator('li[role="option"]').allInnerTexts();
  return { options: options.map((t) => t.replace(/\s+/g, ' ').trim()), empty: null };
};

const readNoOptions = async (page) => {
  const box = page.locator('.MuiAutocomplete-noOptions');
  return (await box.count()) ? (await box.first().innerText()).trim() : null;
};

// Escape only when a dropdown is open: with none open it would reach the
// form's dialog, which Escape closes.
const closeMenu = async (page) => {
  if (await page.locator('ul[role="listbox"], .MuiAutocomplete-popper').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
};

/** With a physical coil linked, the round's cutting type (Full / Partial) must be
 *  chosen before its weight can be typed. These runs type the weight: Partial. */
const choosePartial = async (page) => {
  const r = form(page).getByRole('radio', { name: /partial cutting/i });
  if (await r.count()) { await r.first().check(); await page.waitForTimeout(150); }
};

/** Codes look like "JSL204-07-700 — Cu - 0.7mm - 7.00""; pull the code out. */
const codesFrom = (options) => options
  .map((t) => (t.match(/JSL\d+-\d+-\d+/) || [])[0])
  .filter(Boolean);

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
  });

  console.log('\nCUT COILS → CIRCLES — real UI\n');

  // The app paints a boot splash over the page until React mounts; grnRm.e2e.mjs
  // removes it the same way rather than racing it.
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  /* ── Login ── */
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true, page.url().replace(APP, '') || '/');

  /* ── 1. Open Cut Coils ── */
  await go(`${APP}/rm-ims/conversion`);
  // Wait for the page itself rather than a fixed pause — a cold dev-server
  // load can take longer than 2.5 s.
  await page.getByRole('table', { name: 'Coil to Circle history' }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  check('Cut Coils page opens', /cut coils/i.test(await page.locator('body').innerText()));
  check('…on its history, with the form closed', (await page.getByRole('table', { name: 'Coil to Circle history' }).count()) === 1
    && (await form(page).count()) === 0);
  await openCutForm(page);
  const F = form(page);
  await shot(page, '01-open');

  /* ── 2. Before a coil is identified, the dropdown offers nothing ── */
  const before = await openCircleOptions(page, 0);
  check('before a coil is picked the circle dropdown offers NO sizes',
    before.options.length === 0, `${before.options.length} options`);
  const disabled = await circleInput(page, 0).isDisabled();
  const ph = await circleInput(page, 0).getAttribute('placeholder');
  check('the circle picker is disabled and says to pick a coil first',
    disabled && /pick a coil or batch first/i.test(ph || ''), `disabled=${disabled}, placeholder="${ph}"`);
  await closeMenu(page);
  await shot(page, '02-before-coil');

  /* ── 3. Identify the coil by batch number ── */
  const batchField = F.locator('input').filter({ hasNot: page.locator('[type=date]') }).nth(2);
  // Find the batch field by its label rather than by position.
  const batch = F.getByLabel(/batch number/i).first();
  const target = (await batch.count()) ? batch : batchField;
  await target.fill('E2E-BATCH-JSL204-07');
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  check('the batch number identifies the received coil',
    /Cu 0\.70 mm/.test(body) && /kg available to cut/.test(body),
    (body.match(/Cu 0\.70 mm[^\n]*/) || [''])[0].slice(0, 80));
  await shot(page, '03-coil-identified');

  /* ── 4. The dropdown now offers ONLY the approved sizes ── */
  const r1 = await openCircleOptions(page, 0);
  const got1 = codesFrom(r1.options);
  check('row 1 offers exactly the approved circles for JSL204-07',
    got1.join(',') === APPROVED['JSL204-07'].join(','),
    got1.join(', ') || '(none)');
  check('row 1 offers no circle from another coil family',
    !got1.some((c) => /^JSL202|^JSL204-08|^JSL204-10/.test(c)), got1.join(', '));
  await shot(page, '04-row1-options');

  /* ── 5. Pick one, and fill the line ── */
  await page.locator('ul[role="listbox"] li[role="option"]').first().click();
  await page.waitForTimeout(300);
  const row0 = F.locator('table tbody tr').nth(0);
  await row0.locator('input[type="number"]').nth(0).fill('40');
  await row0.locator('input[type="number"]').nth(1).fill('50');
  // The Autocomplete holds its choice in the input's VALUE, not in the row's
  // text, so the row's innerText never mentions it.
  const picked = await circleInput(page, 0).inputValue();
  check('an approved circle can be selected', /JSL204-07-700/.test(picked), picked);

  /* ── 6. A SECOND row is restricted the same way ── */
  await F.getByRole('button', { name: /add another circle size/i }).click();
  await page.waitForTimeout(400);
  const r2 = await openCircleOptions(page, 1);
  const got2 = codesFrom(r2.options);
  check('row 2 is restricted by the same mapping — adding a row is not a way round it',
    got2.join(',') === APPROVED['JSL204-07'].join(','), got2.join(', ') || '(none)');
  await shot(page, '05-row2-options');

  await page.locator('ul[role="listbox"] li[role="option"]').nth(1).click();
  await page.waitForTimeout(300);
  const row1 = F.locator('table tbody tr').nth(1);
  await row1.locator('input[type="number"]').nth(0).fill('25');
  await row1.locator('input[type="number"]').nth(1).fill('35');

  /* ── 7. The coil weight, and the arithmetic on screen ── */
  const weight = F.getByLabel(/^cut this round/i).first();
  await choosePartial(page);
  await weight.fill('100');
  await page.waitForTimeout(600);
  const sums = await page.locator('body').innerText();
  check('scrap and yield still compute as before (100 − 85 = 15 kg, 85%)',
    /15/.test(sums) && /85/.test(sums));
  await shot(page, '06-ready-to-save');

  // MUI Select renders as a <div role="combobox">, not a real <input> — its
  // current value is read off its text content, the same way grnRm.e2e.mjs's
  // `comboText` helper does for the PO picker.
  const comboText = async (locator) => ((await locator.textContent()) || '').trim();

  /* ── 7a. "Scrap checked?" offers exactly two states — no location hiding in it ── */
  const scrapCheckedBox = F.getByRole('combobox', { name: /scrap checked/i }).first();
  await scrapCheckedBox.click();
  await page.waitForTimeout(250);
  const scrapOpts = (await page.locator('ul[role="listbox"] li[role="option"]').allInnerTexts())
    .map((t) => t.trim());
  check('"Scrap checked?" offers exactly two options', scrapOpts.length === 2, scrapOpts.join(' | '));
  check('…"Not yet checked"', scrapOpts.includes('Not yet checked'), scrapOpts.join(' | '));
  check('…"Verified"', scrapOpts.includes('Verified'), scrapOpts.join(' | '));
  check('…and nothing that names a location ("Sent for job work" is gone)',
    !scrapOpts.some((o) => /job work/i.test(o)), scrapOpts.join(' | '));
  await page.getByRole('option', { name: 'Verified', exact: true }).click();
  await page.waitForTimeout(200);
  check('"Verified" can be selected', (await comboText(scrapCheckedBox)) === 'Verified');
  await shot(page, '06a-scrap-checked-options');

  /* ── 7b. "Received At" auto-filled this coil's GRN location (PLG01) ── */
  const receivedAtBox = F.getByRole('combobox', { name: /received at/i }).first();
  check('"Received At" auto-filled PLG01 from this coil\'s own GRN — never guessed from the SKU',
    (await comboText(receivedAtBox)) === 'PLG01 — Plant', await comboText(receivedAtBox));
  let bodyNow = await page.locator('body').innerText();
  check('no override warning while Received At still matches the GRN',
    !/recorded it as received at/i.test(bodyNow));

  /* ── 7c. Changing it away from the GRN's own record is never silent ── */
  await receivedAtBox.click();
  await page.waitForTimeout(200);
  await page.getByRole('option', { name: /JW001/ }).click();
  await page.waitForTimeout(300);
  bodyNow = await page.locator('body').innerText();
  check('picking a different location than the GRN shows a clear warning, not a silent change',
    /recorded it as received at PLG01/i.test(bodyNow) && /Received At here is now set to JW001/i.test(bodyNow),
    (bodyNow.match(/This coil's GRN recorded it[^.]*\./) || [''])[0]);
  check('the warning spells out the scrap consequence of THIS choice (job-work → not Ambika stock)',
    /will NOT be added to Ambika's scrap stock/i.test(bodyNow));
  await shot(page, '06b-location-override-warning');
  // Put it back — the rest of this run cuts at PLG01, as the GRN actually says.
  await receivedAtBox.click();
  await page.waitForTimeout(200);
  await page.getByRole('option', { name: /PLG01/ }).click();
  await page.waitForTimeout(300);
  bodyNow = await page.locator('body').innerText();
  check('the warning clears once Received At matches the GRN again',
    !/recorded it as received at/i.test(bodyNow));
  // Back to "Not yet checked" so the rest of the run is unaffected by this check.
  await scrapCheckedBox.click();
  await page.waitForTimeout(200);
  await page.getByRole('option', { name: 'Not yet checked', exact: true }).click();
  await page.waitForTimeout(200);

  /* ── 8. Switching the coil drops sizes the new coil cannot produce ── */
  await target.fill('E2E-BATCH-JSL204-08');
  await page.waitForTimeout(3500);
  const afterSwitch = await F.locator('table tbody tr').nth(0).innerText();
  check('changing the coil clears circles the new coil cannot produce',
    !/JSL204-07-700/.test(afterSwitch), afterSwitch.replace(/\s+/g, ' ').slice(0, 70));
  const r3 = await openCircleOptions(page, 0);
  const got3 = codesFrom(r3.options);
  check('the dropdown follows the NEW coil (JSL204-08, 6 approved sizes)',
    got3.join(',') === APPROVED['JSL204-08'].join(','), got3.join(', ') || '(none)');
  await closeMenu(page);
  await shot(page, '07-coil-switched');

  /* ── 9. Only coils with an approved mapping can be picked at all ── */
  // A fresh form: a typed batch that does not resolve deliberately leaves the
  // coil already bound in place, so this starts with nothing bound.
  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(2500);
  await openCutForm(page);
  const coilBox = F.getByRole('combobox', { name: /coil being cut/i }).first();
  await coilBox.click();
  await page.waitForTimeout(600);
  const coilOpts = (await page.locator('ul[role="listbox"] li[role="option"]').allInnerTexts()).join(' | ');
  for (const code of ['JSL202-06', 'JSL202-07', 'JSL202-08', 'JSL204-07', 'JSL204-08', 'JSL204-10']) {
    check(`mapped coil ${code} is offered`, coilOpts.includes(code), coilOpts.slice(0, 120));
  }
  for (const code of ['QA-FMS-SKU-NOUNIT', 'QA-TEST-COIL-01', 'JSL204-06']) {
    check(`unmapped ${code} is NOT offered`, !coilOpts.includes(code));
  }
  await coilBox.fill('204-08');
  await page.waitForTimeout(500);
  const searched = await page.locator('ul[role="listbox"] li[role="option"]').allInnerTexts();
  check('searching the coil list still works ("204-08" → JSL204-08 only)',
    searched.length === 1 && /JSL204-08/.test(searched[0]), searched.join(' | '));
  await closeMenu(page);
  await coilBox.fill('');
  await closeMenu(page);

  // The unmapped coil's batch WAS received — say so, rather than "not received".
  await F.getByLabel(/batch number/i).first().fill('E2E-BATCH-JSL204-06');
  await page.waitForTimeout(3500);
  const unmappedBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('an unmapped coil\'s batch says it cannot be cut here, and why',
    /JSL204-06.*No approved circle sizes are configured for it/.test(unmappedBody),
    (unmappedBody.match(/Batch E2E-BATCH-JSL204-06[^.]*\.[^.]*\./) || [''])[0]);
  check('…and selects no coil, so no circle can be picked',
    (await circleInput(page, 0).isDisabled()));
  await shot(page, '08-unmapped-coil');
  await F.getByLabel(/batch number/i).first().fill('');

  /* ── 9a. A coil received at JW001 auto-fills JW001, and a cut from it still
     saves — but must create no Ambika scrap stock. The real oracle for "no
     scrap stock" is the database (e2eCutCoilsFixture.js --verify, which runs
     after this file); what the browser can prove is that the operator is
     TOLD this is a job-work cut, and that saving it works end to end. ── */
  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(2500);
  await openCutForm(page);
  await F.getByLabel(/batch number/i).first().fill('E2E-BATCH-JSL202-08-JW');
  await page.waitForTimeout(3500);
  const jwReceivedAt = F.getByRole('combobox', { name: /received at/i }).first();
  check('a coil received at JW001 auto-fills "JW001 — Job work" — not guessed from the SKU, not left at the PLG01 default',
    (await comboText(jwReceivedAt)) === 'JW001 — Job work', await comboText(jwReceivedAt));
  const jwBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('…and nothing says this coil overrides its GRN (it was never changed)',
    !/recorded it as received at/i.test(jwBody));
  await shot(page, '08a-jw001-autofill');

  const jwCircle = await openCircleOptions(page, 0);
  check('the JW001 coil still offers its own approved circle sizes (cutting location does not affect the mapping)',
    codesFrom(jwCircle.options).some((c) => c.startsWith('JSL202-08')), codesFrom(jwCircle.options).join(', '));
  await page.locator('ul[role="listbox"] li[role="option"]').first().click();
  await page.waitForTimeout(300);
  await F.locator('table tbody tr').nth(0).locator('input[type="number"]').nth(0).fill('100');
  await F.locator('table tbody tr').nth(0).locator('input[type="number"]').nth(1).fill('150');
  await choosePartial(page);
  await F.getByLabel(/^cut this round/i).first().fill('200');
  await page.waitForTimeout(600);
  await shot(page, '08b-jw001-ready-to-save');
  await F.getByRole('button', { name: /save (this )?conversion/i }).click();
  await page.waitForTimeout(4000);
  const jwSaved = await page.locator('body').innerText();
  check('a JW001 (job-work) cut saves just like a PLG01 one — the conversion itself is unaffected',
    /saved|yield/i.test(jwSaved) && !/could not save/i.test(jwSaved),
    (jwSaved.match(/Conversion [^\n]*/) || [''])[0].slice(0, 90));

  check('…and the form closes after the save', (await F.count()) === 0);

  /* ── 10. Complete a valid conversion ── */
  await openCutForm(page);
  await target.fill('E2E-BATCH-JSL204-07');
  await page.waitForTimeout(3500);
  // Step 9 reloaded the form, so it has ONE circle row. Add the second one
  // here rather than counting `table tbody tr` — that also counts the recent-
  // conversions table below, which is how a phantom second row was assumed.
  await F.getByRole('button', { name: /add another circle size/i }).click();
  await page.waitForTimeout(300);
  const rows = 2;
  const pick = await openCircleOptions(page, 0);
  check('back on JSL204-07, the approved sizes are offered again',
    codesFrom(pick.options).join(',') === APPROVED['JSL204-07'].join(','),
    codesFrom(pick.options).join(', '));
  await page.locator('ul[role="listbox"] li[role="option"]').first().click();
  await page.waitForTimeout(300);
  await F.locator('table tbody tr').nth(0).locator('input[type="number"]').nth(0).fill('40');
  await F.locator('table tbody tr').nth(0).locator('input[type="number"]').nth(1).fill('50');
  if (rows > 1) {
    const pick2 = await openCircleOptions(page, 1);
    if (codesFrom(pick2.options).length) {
      await page.locator('ul[role="listbox"] li[role="option"]').nth(1).click();
      await page.waitForTimeout(250);
      await F.locator('table tbody tr').nth(1).locator('input[type="number"]').nth(0).fill('25');
      await F.locator('table tbody tr').nth(1).locator('input[type="number"]').nth(1).fill('35');
    } else { await closeMenu(page); }
  }
  await choosePartial(page);
  await weight.fill('100');
  await page.waitForTimeout(800);
  await shot(page, '09-before-save');

  const saveBtn = F.getByRole('button', { name: /save (this )?conversion/i });
  await saveBtn.click();
  await page.waitForTimeout(4000);
  const afterSave = await page.locator('body').innerText();
  check('a valid conversion saves', /saved|yield/i.test(afterSave) && !/could not save/i.test(afterSave),
    (afterSave.match(/Conversion [^\n]*/) || [''])[0].slice(0, 90));
  await shot(page, '10-saved');

  /* ── Errors seen along the way ── */
  // The deliberate 400s are the point of the exercise; anything else is not.
  const unexpectedApi = apiErrors.filter((e) => !/400 POST \/rm-ims\/convert/.test(e));
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length} (unexpected: ${unexpectedApi.length})`);
  for (const e of pageErrors.slice(0, 5)) console.log(`    page: ${e}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e}`);
  for (const e of unexpectedApi.slice(0, 5)) console.log(`    api: ${e}`);
  check('no uncaught page errors', pageErrors.length === 0);
  check('no unexpected API errors', unexpectedApi.length === 0);

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
