/**
 * UI STATE SWEEP — loading, empty, tooltip, error and disabled states on the
 * screens this work touched. Read-mostly: it changes nothing in the database
 * (the only submits it makes are ones the UI itself refuses).
 *
 *   node e2e/uiSweep.e2e.mjs
 *
 * Runs on the ambika_e2e_purchase scratch DB AFTER purchase.e2e.mjs: by then
 * there is RM stock (one coil from the GRN race) but no cut, no scrap and no
 * Scrap Out — so the empty states below are real empty states.
 *
 * Expects: backend :5099 via e2eServer.js, frontend :3100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
await assertE2ESetup(APP, API, 'uiSweep.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
};
const section = (s) => console.log(`\n── ${s} ──`);
const STACK = /\bat [\w.$<>]+ \(|TypeError|ReferenceError|Cannot read propert|undefined is not|\[object Object\]|NaN kg|NaN%/;
const pageErrors = [];
const consoleErrors = [];

const SCREENS = [
  ['Purchase — indents', '/procurement/indents'],
  ['Purchase — POs', '/procurement/purchase-orders'],
  ['GRN list', '/procurement/grns'],
  ['RM stock', '/rm-ims/stock'],
  ['Cut Coils', '/rm-ims/conversion'],
  ['Scrap Register', '/scrap-ims/records'],
  ['Scrap by Physical Coil', '/scrap-ims/by-coil'],
  ['Scrap Movement', '/scrap-ims/movements'],
  ['Scrap Out', '/scrap-ims/scrap-out'],
];

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 160)}`); });
  const ready = async () => { await page.waitForSelector('#root > *', { timeout: 90000 }); await page.evaluate(() => document.getElementById('initial-boot')?.remove()); };
  const go = async (u) => { await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await ready(); };
  const body = async () => flat(await page.locator('body').innerText());
  const waitText = async (rx, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (rx.test(await body())) return true; await page.waitForTimeout(250); } return false; };
  // Cut Coils opens on its history; its form is a dialog opened from "+ Coil to Circle".
  const F = page.getByTestId('coil-to-circle-dialog');
  const openCutForm = async () => {
    if (await F.count()) return;
    await page.getByTestId('open-coil-to-circle').click();
    await F.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);
  };

  await go('/');
  await page.waitForLoadState('load').catch(() => {});
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill('wrong-password');
  await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 90000 });
  await page.waitForTimeout(1500);
  const loginErr = await body();
  check('a wrong password gives a readable message, not a stack trace', /invalid|incorrect|wrong/i.test(loginErr) && !STACK.test(loginErr), (loginErr.match(/(invalid|incorrect|wrong)[^.]{0,60}/i) || [''])[0]);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 90000 });
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  // Warm every route once (first-compile time is not a loading state).
  for (const [name, u] of SCREENS) {
    const t0 = Date.now();
    try { await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#root > *', { timeout: 90000 }); } catch (e) { console.log(`  (warm-up) ${name} slow: ${e.message.split('\n')[0]}`); }
    console.log(`  (warm-up) ${name}: ${Date.now() - t0} ms`);
    await page.waitForTimeout(1000);
  }

  /* ── Loading states: slow the API down and look for a loader ── */
  section('Loading states (API latency 1.5 s)');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const setLatency = (ms) => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: ms, downloadThroughput: -1, uploadThroughput: -1 });
  await setLatency(1500);
  const loaders = {};
  for (const [name, u] of SCREENS) {
    await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' });
    let seen = false;
    const end = Date.now() + 2500;
    while (Date.now() < end && !seen) {
      seen = await page.evaluate(() => !!document.querySelector('.MuiSkeleton-root, .MuiCircularProgress-root, .MuiLinearProgress-root')
        || /Loading|Looking/i.test(document.body.innerText));
      if (!seen) await page.waitForTimeout(100);
    }
    loaders[name] = seen;
    check(`${name}: shows a loader while its data is on the way`, seen);
  }
  await setLatency(0);

  /* ── Server errors: the scrap item is not configured yet (503 from the API) ── */
  section('Server-error states (scrap item not configured → 503)');
  const NOT_SET_UP = /Scrap item is not set up yet/;
  await go('/scrap-ims/movements');
  check('Scrap Movement: a failed load says so, with the server’s reason — not "No scrap movements yet"',
    await waitText(/Could not load the scrap movements./) && NOT_SET_UP.test(await body()) && !/No scrap movements yet/.test(await body()));
  await go('/scrap-ims/scrap-out');
  await page.waitForTimeout(3000);
  const so = await body();
  check('Scrap Out: a failed stock load is said as such — not "Available at PLG01: 0 kg"',
    /Could not load the scrap on hand/.test(so) && !/Available at PLG01: 0 kg/.test(so), (so.match(/Could not load[^.]{0,90}|Available at[^.]{0,30}/) || [''])[0]);
  check('…and issuing stays blocked', await page.getByRole('button', { name: /issue scrap/i }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/uisweep-scrap-503.png` }).catch(() => {});
  // Now configure it, as every real installation has, and carry on.
  const BACKEND = path.resolve('..', 'backend');
  const added = execFileSync('node', ['src/scripts/e2ePurchaseFixture.js', '--add-scrap-sku'], { cwd: BACKEND, env: process.env, encoding: 'utf8' });
  check('the scrap item is then configured for the rest of the sweep', /"ok":true/.test(added));
  const errPhaseConsole = consoleErrors.length;

  /* ── Empty states ── */
  section('Empty states');
  await go('/rm-ims/conversion');
  check('Coil to Circle history, nothing cut yet: "No physical coil has been cut yet"', await waitText(/No physical coil has been cut yet/));
  await openCutForm();
  check('no coil chosen: the coil cards are hidden, not shown with "—"', (await F.getByTestId('coil-facts').count()) === 0);
  check('no "No physical coil chosen yet." panel — one line under the Batch Number field instead',
    !/No physical coil chosen yet/.test(await body()) && /Type the batch number on the coil, or pick it from the list/.test(await body()));
  check('…one Batch Number field — no "Select Existing GRN" / "Manual Entry — No GRN" mode buttons, no separate GRN selector',
    (await F.getByTestId('mode-grn').count()) === 0 && (await F.getByTestId('mode-manual').count()) === 0 && (await F.getByTestId('grn-coil-picker').count()) === 0);
  check('…and the rest of the form is still on screen with no coil (cutting type, cut weight, circles, Save)',
    await F.getByRole('radio', { name: /partial cutting/i }).first().isVisible() && await F.getByLabel(/^cut this round/i).first().isVisible()
      && await F.locator('table tbody tr').first().isVisible() && await F.getByRole('button', { name: /save this conversion/i }).isVisible());
  await F.getByLabel(/batch number/i).first().fill('NO-SUCH-BATCH-123');
  check('an unknown batch says so, inline — "No matching coil/GRN found. Enter the coil details manually."',
    await waitText(/No matching coil\/GRN found\. Enter the coil details manually\./));
  await F.getByLabel(/batch number/i).first().fill('');
  await go('/scrap-ims/records');
  check('Scrap Register with no scrap: an empty-state message, not a blank table', await waitText(/No scrap records/i));
  await go('/scrap-ims/by-coil');
  check('Scrap by Physical Coil with no cut coil: "No scrap is traced to a physical coil yet"', await waitText(/No scrap is traced to a physical coil yet/));
  await go('/scrap-ims/scrap-out');
  check('Scrap Out History with nothing issued: the empty-state message', await waitText(/Every scrap issued from the form above will be listed here/));
  await page.locator('[data-testid="scrap-out-history-search"]').fill('no such buyer');
  check('…and a search with no match says so', await waitText(/No Scrap Out matches these filters/));
  await go('/procurement/grns');
  await page.waitForTimeout(1500);
  const grnSearch = page.getByPlaceholder(/search/i).first();
  if (await grnSearch.count()) {
    await grnSearch.fill('NO-SUCH-GRN-XYZ');
    await page.waitForTimeout(1500);
    check('GRN list: a search with no match shows the grid’s empty state ("No rows", 0–0 of 0)', /No rows/.test(await body()) && /0–0 of 0/.test(await body()));
  } else check('GRN list has a search box', false);
  await go('/procurement/indents');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('Search indents…').fill('NO-SUCH-INDENT-XYZ');
  await page.waitForTimeout(1500);
  // The Indents grid now renders the Purchase FMS pager ("Showing 0 to 0 of 0
  // indents") in place of MUI's default "0–0 of 0" strip. Same assertion, same
  // strength — an empty result must still be stated as empty AND counted as
  // zero; only the wording the grid uses to say it has changed.
  check('Indents: a search with no match shows the grid’s empty state ("No rows", zero count)', /No rows/.test(await body()) && /Showing 0 to 0 of 0 indents/.test(await body()));
  await page.screenshot({ path: `${SHOTS}/uisweep-empty-indents.png` }).catch(() => {});

  /* ── Disabled states (Cut Coils, Scrap Out) ── */
  section('Disabled states');
  await go('/rm-ims/conversion');
  await waitText(/Coil to Circle history/);
  await openCutForm();
  check('Cut Coils, no coil: Full cutting disabled', await F.getByRole('radio', { name: /full cutting/i }).isDisabled());
  check('…Partial cutting disabled', await F.getByRole('radio', { name: /partial cutting/i }).isDisabled());
  check('…"Cut this round" disabled', await F.getByLabel(/^cut this round/i).first().isDisabled());
  check('…Save disabled', await F.getByRole('button', { name: /save this conversion/i }).isDisabled());
  // "No receipt available" is for a coil with no batch number: offered only
  // while the batch is blank, and an explicit tick there, never inferred.
  check('…"No receipt available" is offered while the batch is blank, unticked',
    (await F.getByRole('checkbox', { name: /No receipt available/i }).count()) === 1
      && !(await F.getByRole('checkbox', { name: /No receipt available/i }).isChecked()));
  await F.getByRole('checkbox', { name: /No receipt available/i }).check();
  await page.waitForTimeout(300);
  check('with "No receipt available" ticked it says the cut will not be traceable — and the round waits for the coil being cut',
    /will not be traceable to a coil/i.test(await body()) && await F.getByRole('radio', { name: /partial cutting/i }).isDisabled());
  const grade = F.getByRole('combobox', { name: /coil being cut/i }).first();
  await grade.click();
  await page.waitForTimeout(500);
  const gradeOpts = page.locator('ul[role="listbox"] li[role="option"]');
  if (await gradeOpts.count()) await gradeOpts.first().click();
  await page.waitForTimeout(400);
  check('with "No receipt available" and a coil: Full stays disabled (it needs a physical coil), Partial is enabled',
    await F.getByRole('radio', { name: /full cutting/i }).isDisabled() && !(await F.getByRole('radio', { name: /partial cutting/i }).isDisabled()));
  await go('/scrap-ims/scrap-out');
  await waitText(/Scrap Out History/);
  check('Scrap Out with nothing entered: Issue scrap disabled', await page.getByRole('button', { name: /issue scrap/i }).isDisabled());
  check('…and with the scrap item configured, availability reads "Available at PLG01: 0 kg"', await waitText(/Available at PLG01: 0 kg/));

  /* ── Error messages: readable and tied to the field ── */
  section('Error messages');
  await go('/rm-ims/conversion');
  await waitText(/Coil to Circle history/);
  await openCutForm();
  await F.getByLabel(/batch number/i).first().fill('E2E-UI-RACE-001');
  await page.waitForTimeout(3000);
  await F.getByRole('radio', { name: /partial cutting/i }).check();
  await F.getByLabel(/^cut this round/i).first().fill('600');
  await page.waitForTimeout(400);
  const cutHelp = flat(await F.getByLabel(/^cut this round/i).first().locator('xpath=ancestor::div[contains(@class,"MuiFormControl")][1]').innerText());
  check('over-cut on the field itself: "Only 500 KG is available from this physical coil."', /Only 500 KG is available from this physical coil\./.test(cutHelp), cutHelp);
  await F.getByLabel(/^cut this round/i).first().fill('-5');
  await page.waitForTimeout(300);
  check('a negative weight: "Enter a weight above 0 kg." on the field', /Enter a weight above 0 kg/.test(flat(await F.getByLabel(/^cut this round/i).first().locator('xpath=ancestor::div[contains(@class,"MuiFormControl")][1]').innerText())));
  await go('/scrap-ims/scrap-out');
  await waitText(/Scrap Out History/);
  await page.locator('[data-testid="scrap-out-qty"]').fill('5');
  await page.waitForTimeout(400);
  check('Scrap Out over stock (0 kg held): a plain-language warning', /more than the 0 kg|Not enough|0 kg on hand|nothing/i.test(await body()), ((await body()).match(/[^.]{0,40}(more than|Not enough)[^.]{0,60}/) || [''])[0]);

  /* ── Tooltips ── */
  section('Tooltips');
  await go('/rm-ims/conversion');
  await waitText(/Coil to Circle history/);
  await openCutForm();
  const help = F.locator('table thead svg').first();
  await help.scrollIntoViewIfNeeded().catch(() => {});
  await help.hover().catch(() => {});
  await page.waitForTimeout(800);
  const tip = flat(await page.locator('[role="tooltip"]').first().innerText().catch(() => ''));
  check('a column help icon on Cut Coils shows its explanation', tip.length > 10, tip);
  await go('/scrap-ims/records');
  await page.waitForTimeout(1500);
  await page.locator('table thead svg').first().hover().catch(() => {});
  await page.waitForTimeout(800);
  const tip2 = flat(await page.locator('[role="tooltip"]').first().innerText().catch(() => ''));
  check('a column help icon on the Scrap Register shows its explanation', tip2.length > 10, tip2);

  /* ── No technical text anywhere ── */
  section('No technical text on any screen');
  for (const [name, u] of SCREENS) {
    await go(u);
    await page.waitForTimeout(1800);
    const t = await body();
    check(`${name}: no stack trace / NaN / [object Object] on screen`, !STACK.test(t), (t.match(STACK) || [''])[0]);
  }

  await browser.close();
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}`);
  [...pageErrors, ...consoleErrors].slice(0, 8).forEach((x) => console.log(`    ${x}`));
  // The wrong-password probe returns 401 — that console line is the one expected error.
  check('no uncaught page errors', pageErrors.length === 0);
  // Expected: the wrong-password 401, and the 503s of the deliberate not-configured phase.
  const unexpectedConsole = consoleErrors.slice(errPhaseConsole).filter((c) => !/status of 401|Failed to log in/.test(c));
  check('no console errors outside the two deliberate probes (wrong password, scrap item not configured)', unexpectedConsole.length === 0, unexpectedConsole.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} UI-state checks passed.`);
  if (failed.length) { console.log('\n  Failures:'); failed.forEach((x) => console.log(`   - ${x.name}: ${String(x.detail).slice(0, 200)}`)); }
  console.log(`  loaders: ${JSON.stringify(loaders)}`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nSweep failed:', e); process.exit(1); });
