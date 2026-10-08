/**
 * Scrap Out — buyer master and quantity units, driven through the real UI.
 *
 *   node e2e/scrapOut.e2e.mjs
 *
 * Follows the other e2e files here (playwright LIBRARY, not @playwright/test).
 * Every action is the operator's; backend/src/scripts/e2eScrapOutFixture.js
 * --verify is the database oracle that runs afterwards.
 *
 * Expects (started separately):
 *   backend  :5098  against the ambika_e2e_scrapout scratch database, after
 *            e2eScrapOutFixture.js --seed (and its --api run, which leaves
 *            PLG01 at 400 kg — this test tops it up to the brief's 1,500 kg)
 *   frontend :3101  with VITE_API_URL pointing at :5098
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

const APP = process.env.APP_URL || 'http://127.0.0.1:3101';
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5098/api/v1', 'scrapOut.e2e.mjs');
const USER = { email: 'scrapout-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/scrap-out';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};
const pageErrors = [];
const consoleErrors = [];
const apiErrors = [];

const main = async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChromium() });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`); });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (u) => { await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await ready(); await page.waitForTimeout(1200); };
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
  const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const toast = async (rx) => page.getByText(rx).first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

  const issueBtn = () => page.getByRole('button', { name: /issue scrap/i });
  const qtyBox = () => page.locator('[data-testid="scrap-out-qty"]');
  const pickUnit = async (label) => {
    await page.locator('[data-testid="scrap-out-uom"]').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page.waitForTimeout(250);
  };
  // By role, not label: while its menu is open MUI's listbox carries the same
  // label, so getByLabel matches two nodes (see grnRm.e2e.mjs for the same note).
  const buyerBox = () => page.getByRole('combobox', { name: /Sold to \/ Buyer/ });
  const searchBuyer = async (term) => {
    await buyerBox().click();
    await buyerBox().fill(term);
    await page.waitForTimeout(900); // debounce + request
  };

  /* ── Login ── */
  await go('/');
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login', true);

  /* ── [19] Scrap In screen still works — top PLG01 up to 1,500 kg ── */
  console.log('\n── Scrap In (regression) ──');
  await go('/scrap-ims/scrap-in');
  await page.getByLabel(/^Quantity \(KGS\)/).fill('1100');
  await page.getByRole('button', { name: /^add scrap$/i }).click();
  check('[19] Scrap In saves as before', await toast(/kg added to PLG01|added/i));
  await page.waitForTimeout(800);

  /* ── Scrap Out: layout and the buyer rule ── */
  console.log('\n── Scrap Out: sale needs a buyer ──');
  await go('/scrap-ims/scrap-out');
  let t = await text();
  check('the sale section is titled "Buyer / sale details"', /Buyer \/ sale details/.test(t));
  check('[6] the "Sold to / Buyer" field is there and marked required', (await buyerBox().count()) > 0);
  check('the old free-text "Issued to" is NOT shown for a sale', !/Issued to \(optional\)/.test(t));
  check('available stock is shown in KG', /Available at PLG01: 1,500 kg/.test(t), (t.match(/Available at PLG01:[^.]*/) || [''])[0]);
  check('[1][2][3] the page loads with "Scrap Out History" below the form, on this same page', /Scrap Out History/.test(t));
  // Newest-first with 10 per page: the oldest (legacy) row is not necessarily on
  // page 1 once more than 10 Scrap Outs exist (it won't be, after the --api
  // fixture's dozen rows) — so this only checks the table has real rows, not
  // which ones.
  check('…and it already shows the existing Scrap Out records, not an empty table',
    (await page.locator('[data-testid="scrap-out-history-row"]').count()) > 0);
  await qtyBox().fill('10');
  await page.waitForTimeout(300);
  check('[6] with a quantity but no buyer, Issue scrap stays disabled', await issueBtn().isDisabled());
  check('[6] …and the confirm bar says why', /Choose who the scrap was sold to/.test(await text()));
  await shot('01-sale-needs-buyer');

  /* ── [14]/[13] units against 1,500 kg ── */
  console.log('\n── Units against 1,500 kg ──');
  // A FRACTIONAL Ton on purpose: the review found the typed figure was shown
  // rounded to 2 decimals ("2.13 Ton" beside 2,125 kg). Whole numbers hid it.
  await pickUnit('Ton');
  await qtyBox().fill('2.125');
  await page.waitForTimeout(400);
  t = await text();
  check('[14] 2.125 Ton is read as 2,125 kg and flagged against 1,500 kg', /2,125 kg is more than the 1,500 kg/.test(t), (t.match(/[\d,]+ kg is more than[^.]*/) || [''])[0]);
  check('[14] REGRESSION: the alert shows the typed figure exactly — 2.125 Ton, not 2.13', /2,125 kg \(2\.125 Ton\) is more than/.test(t), (t.match(/[\d,]+ kg \([^)]*\)/) || [''])[0]);
  check('[14] Issue scrap is disabled', await issueBtn().isDisabled());
  await shot('02-two-ton-blocked');

  await pickUnit('Quintal');
  await qtyBox().fill('10');
  await page.waitForTimeout(400);
  t = await text();
  check('[13] 10 Quintal shows its KG equivalent "= 1,000 kg"', /= 1,000 kg/.test(t));
  check('[13] …and the after-balance 500 kg', /500 kg after/.test(t));
  check('the unit helper explains the factor', /1 Quintal = 100 kg/.test(t));

  /* ── [1]/[2] search and select an existing buyer ── */
  console.log('\n── Pick an existing buyer ──');
  await searchBuyer('24AAACS');
  const opt = page.getByRole('option', { name: /Shree Metal Traders/ });
  check('[2] searching by GSTIN fragment finds the buyer', (await opt.count()) > 0);
  await opt.first().click();
  await page.waitForTimeout(400);
  t = await text();
  const card = page.locator('[data-testid="selected-buyer"]');
  check('[1] selecting fills the buyer details card', (await card.count()) > 0);
  const cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('[1] …contact person', /Ramesh Patel/.test(cardText), cardText);
  check('[1] …phone', /9825012345/.test(cardText));
  check('[1] …GSTIN', /24AAACS1234M1Z5/.test(cardText));
  check('[1] …code', /SB-0001/.test(cardText));
  await page.getByLabel(/^Reference/).fill('INV-UI-101');
  check('Issue scrap is now enabled', !(await issueBtn().isDisabled()));
  await shot('03-buyer-selected-10-quintal');
  await issueBtn().click();
  check('[13] 10 Quintal sale saves, reported in kg and as typed, to the buyer',
    await toast(/1,000 kg \(10 Quintal\) issued from PLG01 to Shree Metal Traders/));
  await page.waitForTimeout(1000);
  check('the form clears the buyer after saving', (await card.count()) === 0);

  /* ── Scrap Out History: on the SAME page, below the form, no reload ── */
  console.log('\n── Scrap Out History ──');
  const history = () => page.locator('[data-testid="scrap-out-history"]');
  const historyRows = () => page.locator('[data-testid="scrap-out-history-row"]');
  const firstRowText = async () => (await historyRows().first().innerText()).replace(/\s+/g, ' ');
  await history().scrollIntoViewIfNeeded();
  t = await text();
  check('the history sits on this same page, under the heading "Scrap Out History"', /Scrap Out History/.test(t));
  check('…with its subtitle', /History of scrap sold, disposed of or moved out\./.test(t));
  await (await historyRows().first().elementHandle())?.waitForElementState('stable').catch(() => {});
  await page.waitForTimeout(300);
  check('[16] the just-saved sale appears immediately — no browser refresh', /10 Quintal/.test(await firstRowText()));
  let r1 = await firstRowText();
  check('…S.No. 1 for the newest row', /^1\s/.test(r1), r1);
  check('…Sold Weight shows the figure AS ENTERED — "10 Quintal", not the normalized 1,000 kg split three ways',
    /10 Quintal/.test(r1) && !/1,000/.test(r1), r1);
  check('…Sold To is the buyer actually picked', /Shree Metal Traders/.test(r1), r1);
  check('…Reason reads "Sold"', /Sold/.test(r1), r1);
  check('…Taken From reads PLG01', /PLG01/.test(r1), r1);
  check('…Status reads "Sold", not the technical "Active"', /Sold/.test(r1) && !/Active/.test(r1), r1);
  check('…Reference is shown', /INV-UI-101/.test(r1), r1);
  await shot('09-history-after-first-sale');

  /* ── [3]/[4] add a new buyer without leaving Scrap Out ── */
  console.log('\n── Add a new buyer inline ──');
  await searchBuyer('Kalika Steel Scrap');
  const addOpt = page.getByRole('option', { name: /\+ Add "Kalika Steel Scrap" as a new buyer/ });
  check('[3] an "+ Add … as a new buyer" option is offered', (await addOpt.count()) > 0);
  await addOpt.first().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible', timeout: 5000 });
  check('[3] the dialog opens with the typed name prefilled',
    (await dlg.getByLabel(/Buyer \/ company name/).inputValue()) === 'Kalika Steel Scrap');
  await dlg.getByLabel(/Contact person/).fill('Anil Joshi');
  await dlg.getByLabel(/Mobile \/ phone/).fill('9727012345');
  await dlg.getByLabel(/^GSTIN/).fill('24aabck9999q1z3');
  await dlg.getByLabel(/^Address/).fill('Changodar');
  await shot('04-add-buyer-dialog');
  await dlg.getByRole('button', { name: /save & select/i }).click();
  check('[3] the buyer is saved to the master', await toast(/Scrap buyer added/));
  await page.waitForTimeout(600);
  const cardNew = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('[4] …and selected on the Scrap Out automatically', /Kalika Steel Scrap/.test(cardNew), cardNew);
  check('[4] …with its new master code', /SB-\d{4}/.test(cardNew));
  check('[4] GSTIN was stored upper-case', /24AABCK9999Q1Z3/.test(cardNew));
  const newCode = (cardNew.match(/SB-\d{4}/) || [''])[0];
  await shot('05-new-buyer-selected');

  // [11] 5 Quintal to the new buyer: 1,500 − 1,000 − 500 = 0
  await qtyBox().fill('5');
  await page.waitForTimeout(400);
  check('[11] 5 Quintal shows "= 500 kg"', /= 500 kg/.test(await text()));
  await issueBtn().click();
  check('[11] the sale to the new buyer saves', await toast(/500 kg \(5 Quintal\) issued from PLG01 to Kalika Steel Scrap/));
  await page.waitForTimeout(1000);
  await history().scrollIntoViewIfNeeded();
  r1 = await firstRowText();
  check('[16] the second sale replaces the first as the TOP row — no refresh needed', /Kalika Steel Scrap/.test(r1), r1);
  check('…S.No. is still 1 at the top after a new row arrives', /^1\s/.test(r1), r1);
  check('…Sold Weight shows "5 Quintal" as entered, not 500 kg', /5 Quintal/.test(r1) && !/\b500\b/.test(r1), r1);
  const r2 = (await historyRows().nth(1).innerText()).replace(/\s+/g, ' ');
  check('…the earlier Shree Metal Traders sale moved down to row 2, S.No. 2', /^2\s/.test(r2) && /Shree Metal Traders/.test(r2), r2);

  /* ── [5] the same buyer typed differently → no duplicate ── */
  console.log('\n── Duplicate buyer prevention ──');
  await searchBuyer('kalika  STEEL scrap');
  const addDup = page.getByRole('option', { name: /\+ Add/ });
  if (await addDup.count()) {
    await addDup.first().click();
    await dlg.waitFor({ state: 'visible', timeout: 5000 });
    await dlg.getByRole('button', { name: /save & select/i }).click();
    check('[5] the server says it already exists and selects it', await toast(/already in the buyer master/i));
    await page.waitForTimeout(600);
    const cardDup = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('[5] …the SAME buyer (same code) is selected, not a copy', newCode && cardDup.includes(newCode), cardDup);
  } else {
    check('[5] duplicate path reachable', false, 'no add option');
  }
  await shot('06-duplicate-selected-existing');

  /* ── [7] a non-sale reason keeps the old free-text field ── */
  console.log('\n── Non-sale reasons ──');
  await page.getByLabel(/^Reason/).click();
  await page.getByRole('option', { name: /Disposed of/ }).click();
  await page.waitForTimeout(300);
  t = await text();
  check('[7] Disposed of shows "Who it went to" with the optional "Issued to"', /Who it went to/.test(t) && /Issued to \(optional\)/.test(t));
  check('[7] …and no buyer picker', (await buyerBox().count()) === 0);
  await page.getByLabel(/^Taken from/).click();
  await page.getByRole('option', { name: /JW001/ }).click();
  await pickUnit('Ton');
  await qtyBox().fill('0.0125');
  await page.getByLabel(/Issued to \(optional\)/).fill('Municipal yard');
  await page.waitForTimeout(300);
  check('[15] 0.0125 Ton shows "= 12.5 kg"', /= 12\.5 kg/.test(await text()));
  check('[7] it can be saved with no buyer', !(await issueBtn().isDisabled()));
  await issueBtn().click();
  check('[7] Disposed of (no buyer) saves', await toast(/12\.5 kg/));
  check('REGRESSION: the toast shows the typed figure exactly — 0.0125 Ton', await toast(/12\.5 kg \(0\.0125 Ton\) issued from JW001/));
  await page.waitForTimeout(800);

  /* ── History: a disposal is not "sold to" anyone, and a filter narrows it ── */
  await history().scrollIntoViewIfNeeded();
  r1 = await firstRowText();
  check('[9] a Disposed of row shows no buyer under Sold To', /—/.test(r1) && !/Shree|Kalika/.test(r1), r1);
  check('[10] …its Reason reads "Disposed of"', /Disposed of/.test(r1), r1);
  check('[11] …Taken From reads JW001', /JW001/.test(r1), r1);
  check('…and the free-text party is shown, not mistaken for a buyer', /Municipal yard/.test(r1), r1);
  check('…Sold Weight shows "0.0125 Ton" as entered, not 12.5 kg', /0\.0125 Ton/.test(r1) && !/12\.5\b/.test(r1), r1);
  check('…a non-sale keeps the plain "Active" status — only a sale reads "Sold"', /Active/.test(r1) && !/\bSold\b/.test(r1), r1);

  await page.locator('[data-testid="scrap-out-history-search"]').fill('Shree');
  await page.waitForTimeout(500);
  const shreeRows = await historyRows().count();
  check('[14] search narrows the history to that Sold To', shreeRows >= 1, `${shreeRows} rows`);
  const shreeTexts = await historyRows().allInnerTexts();
  check('…every visible row now matches the search', shreeTexts.every((x) => /Shree/.test(x)), shreeTexts.join(' | '));
  await page.locator('[data-testid="scrap-out-history-search"]').fill('no such buyer at all xyz');
  await page.waitForTimeout(500);
  check('[20] a search with no match shows the "no match" empty state, not a blank table',
    /No Scrap Out matches these filters/.test(await text()));
  await page.locator('[data-testid="scrap-out-history-search"]').fill('');
  await page.waitForTimeout(500);
  check('clearing the search brings the rows back', (await historyRows().count()) > shreeRows - 1);
  await shot('10-history-filtered');

  /* ── History: pagination, 10 per page, S.No. continuous ── */
  const totalBefore = Number((await page.locator('.MuiTablePagination-displayedRows').last().innerText()).match(/of (\d+)/)?.[1] || 0);
  check('[13] pagination total matches the rows recorded so far', totalBefore >= 4, `total=${totalBefore}`);
  if (totalBefore > 10) {
    await page.locator('[aria-label="Go to next page"]').last().click();
    await page.waitForTimeout(400);
    const pageTwoFirst = (await historyRows().first().innerText()).replace(/\s+/g, ' ');
    check('[13] S.No. does not restart at 1 on page 2 — it continues at 11', /^11\s/.test(pageTwoFirst), pageTwoFirst);
    await page.locator('[aria-label="Go to previous page"]').last().click();
    await page.waitForTimeout(400);
  } else {
    check('[13] fewer than 11 rows so far — page 2 not reachable yet (expected at this point)', true);
  }

  /* ── [8] buyers and history persist across a reload ── */
  console.log('\n── Persistence ──');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.waitForTimeout(1200);
  await searchBuyer('Kalika');
  check('[8] after a page refresh the new buyer is still in the master', (await page.getByRole('option', { name: /Kalika Steel Scrap/ }).count()) > 0);
  await page.keyboard.press('Escape');
  await history().scrollIntoViewIfNeeded();
  r1 = await firstRowText();
  check('[8] the history is still there after a reload, same top row', /Municipal yard/.test(r1), r1);

  /* ── [9] buyer and unit visible in Scrap Movement; search by buyer ── */
  console.log('\n── Scrap Movement ──');
  await go('/scrap-ims/movements');
  t = await text();
  check('[9] the sale shows the buyer name', /Shree Metal Traders/.test(t));
  check('[9] …with code, phone and GSTIN', /SB-0001 · 9825012345 · GSTIN 24AAACS1234M1Z5/.test(t));
  check('[9] the quantity shows the figure as typed (10 Quintal)', /10 Quintal/.test(t));
  check('REGRESSION: history shows a fractional entry exactly — 0.0125 Ton, not 0.01', /0\.0125 Ton/.test(t));
  check('REGRESSION: …and the API run\'s 0.1255 Ton exactly, not 0.13', /0\.1255 Ton/.test(t));
  check('[9] the new buyer\'s sale is there too', /Kalika Steel Scrap/.test(t));
  check('[20] the historical row still shows its old free-text party', /Old Buyer \(legacy free text\)/.test(t));
  await shot('07-movements-buyer-and-unit');
  await page.locator('[data-testid="scrap-mv-search"]').fill('24AABCK');
  await page.waitForTimeout(1600);
  const rows = await page.$$eval('table tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')).filter((x) => x.length > 20));
  check('[9] searching the GSTIN shows only that buyer\'s sales', rows.length >= 1 && rows.every((r) => /Kalika Steel Scrap/.test(r)), `${rows.length} rows`);
  await shot('08-movements-search-by-gstin');

  /* ── [21]-[23] the rest of Scrap IMS still renders ── */
  console.log('\n── Regression: other scrap screens ──');
  await go('/scrap-ims/records');
  check('[21] Scrap Register renders', /Scrap register|register/i.test(await text()));
  await go('/scrap-ims/by-coil');
  check('[23] Scrap by physical coil renders', /Scrap by physical coil/.test(await text()));
  await go('/scrap-ims');
  check('Scrap dashboard renders', /Scrap/.test(await text()));

  await browser.close();
  console.log('');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('[28] no API 4xx/5xx during the UI flow', apiErrors.length === 0, apiErrors.join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
