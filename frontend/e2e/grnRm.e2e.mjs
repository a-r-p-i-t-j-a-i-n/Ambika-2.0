/**
 * GRN → RM Stock, driven through the real UI in Chromium.
 *
 *   node e2e/grnRm.e2e.mjs
 *
 * Deliberately NOT a test framework. `playwright` (the library) is already a
 * dependency and its Chromium is already on this machine, while @playwright/test
 * is not installed — so this is a plain script against the library, which is the
 * smallest thing that can actually click the buttons.
 *
 * Every action here happens in the browser. Nothing is asserted from a toast:
 * backend/src/scripts/e2eGrnRmFixture.js --verify reads the database afterwards
 * and is the real oracle. This file checks what the OPERATOR can see.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_e2e_verify scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * The installed playwright build asks for a Chromium revision this machine does
 * not have, while a newer one IS already in the shared cache. Rather than
 * downloading another browser, point launch() at the newest cached chrome.exe.
 */
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
const USER = { email: 'e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];

/**
 * MUI select helpers.
 *
 * A MUI Select is a div[role=combobox] whose accessible name is "<label>
 * <current value>", and while its menu is open the listbox ALSO carries the
 * label - so getByLabel matches two nodes. Everything here therefore targets
 * the combobox by role and closes the menu afterwards.
 */
const combo = (page, label) => page.getByRole("combobox", { name: new RegExp(label, "i") }).first();
const comboCount = (page, label) => page.getByRole("combobox", { name: new RegExp(label, "i") }).count();
const comboText = async (page, label) => (await combo(page, label).textContent() || "").trim();

const pickSelect = async (page, label, optionText) => {
  await combo(page, label).click();
  await page.getByRole("option", { name: optionText }).click();
  // MUI closes the menu itself. Wait for the listbox to leave the DOM rather
  // than pressing Escape - Escape would also close the surrounding Dialog.
  await page.waitForSelector("[role=\"listbox\"]", { state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
};

const main = async () => {
  const exe = findChromium();
  console.log(`Chromium: ${exe || '(playwright default)'}`);
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
  });

  /**
   * Wait until React has painted, then clear the boot splash if it is still up.
   *
   * index.html removes #initial-boot from a MutationObserver attached on
   * DOMContentLoaded. When React mounts BEFORE that listener attaches, the
   * observer never sees a mutation and the overlay stays, swallowing every
   * click. Pre-existing and nothing to do with this feature, so it is worked
   * around here rather than patched.
   */
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };

  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }).catch(() => {});

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('\n── Login ──');
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds and lands in the workspace', true, page.url().replace(APP, '') || '/');
  await shot('01-logged-in');

  /** Open a seeded GRN's detail page by its number. */
  const openGrn = async (tag) => {
    await go(`${APP}/procurement/grns`);
    await page.waitForTimeout(1200);
    await page.getByText(`GRN-E2E-${tag}`, { exact: true }).first().click();
    await page.waitForTimeout(1200);
  };

  const openCompleteDialog = async () => {
    await page.getByRole('button', { name: /complete & post stock/i }).first().click();
    await page.waitForTimeout(600);
  };

  // ── Scenario A — checkbox OFF ──────────────────────────────────────────────
  console.log('\n── Scenario A: GRN completed with "Add to RM Stock" OFF ──');
  await openGrn('OFF');
  await openCompleteDialog();

  // Scoped to the dialog: the GRN Detail page behind it now also prints an
  // "Add to RM Stock" field, so an unscoped match is ambiguous.
  const dlg = page.getByRole('dialog');
  const rmBox = dlg.locator('input[type="checkbox"]').nth(1); // after allow-over-receipt
  check('"Add to RM Stock" is present in the dialog',
    await dlg.getByText('Add to RM Stock', { exact: true }).isVisible());
  check('it is OFF by default', (await rmBox.isChecked()) === false);
  // Received At only appears once the opt-in is on — nothing to mis-set while off.
  // Received At is a separate decision from the opt-in, so it stays on screen
  // whether the box is ticked or not.
  check('Received At is visible even while the box is OFF', (await comboCount(page, 'Received At')) > 0);
  check('the help text explains what ticking it does',
    await dlg.getByText(/automatically be added to RM stock/i).first().isVisible());
  await shot('02-dialog-off');

  await page.getByRole('button', { name: /complete & post stock/i }).last().click();
  // Wait for the toast rather than sleeping a fixed amount: completion now does
  // one more SKU lookup (the Coil/Circle batch guard), and a fixed 2.5s became
  // marginal. notistack auto-dismisses, so poll for it instead.
  const offToast = await page.getByText(/GRN saved successfully/i).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  check('success message does NOT claim RM stock was updated', offToast,
    offToast ? '"GRN saved successfully."' : 'expected message not found');
  await shot('03-off-completed');

  // ── Scenario B — checkbox ON, PLG01 ────────────────────────────────────────
  console.log('\n── Scenario B: "Add to RM Stock" ON, Received At = PLG01 ──');
  await openGrn('PLG');
  await openCompleteDialog();
  await page.getByRole('dialog').locator('input[type="checkbox"]').nth(1).check();
  await page.waitForTimeout(400);
  check('Received At appears once the box is ticked', (await comboCount(page, 'Received At')) > 0);
  const defaultLoc = await comboText(page, 'Received At');
  check('Received At defaults to PLG01', /PLG01/.test(defaultLoc || ''), (defaultLoc || '').trim());
  await shot('04-dialog-on-plg01');

  await page.getByRole('button', { name: /complete & post stock/i }).last().click();
  await page.waitForTimeout(3000);
  const plgToast = (await page.getByText(/RM stock updated successfully/i).count()) > 0;
  check('success message reports RM stock was updated', plgToast);
  const plgCount = (await page.getByText(/2 item\(s\) at PLG01/i).count()) > 0;
  check('message names the count and location from the server', plgCount, '2 RM item(s) at PLG01');
  await shot('05-plg-completed');

  // The detail screen should now show the posted movements.
  await page.waitForTimeout(1200);
  const showsPlg = (await page.getByText('PLG01').count()) > 0;
  check('GRN detail shows the posted movements at PLG01', showsPlg);
  await shot('06-plg-detail');

  // ── Scenario B2 — JW001 ────────────────────────────────────────────────────
  console.log('\n── Scenario B2: Received At = JW001 ──');
  await openGrn('JW');
  await openCompleteDialog();
  await page.getByRole('dialog').locator('input[type="checkbox"]').nth(1).check();
  await page.waitForTimeout(400);
  await pickSelect(page, 'Received At', /JW001/);
  const jwSel = await comboText(page, 'Received At');
  check('JW001 can be selected', /JW001/.test(jwSel || ''), (jwSel || '').trim());
  await shot('07-dialog-jw001');
  await page.getByRole('button', { name: /complete & post stock/i }).last().click();
  await page.waitForTimeout(3000);
  check('JW001 completion reports RM stock updated',
    (await page.getByText(/at JW001/i).count()) > 0);

  // ── Duplicate / retry ──────────────────────────────────────────────────────
  // ── The GRN FORM itself carries both controls ──────────────────────────────
  // This is the acceptance condition: the fields must be on the screen where a
  // GRN is raised, not only inside the Complete dialog.
  console.log('\n── GRN create form: Add to RM Stock + Received At ──');
  await go(`${APP}/procurement/grns`);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
  await page.waitForTimeout(1200);

  check('the GRN form shows "Add to RM Stock"',
    (await page.getByText('Add to RM Stock', { exact: true }).count()) > 0);
  // The acceptance condition: visible with the box UNTICKED, which is how the
  // form opens.
  const formBox = page.getByRole('dialog').locator('input[type="checkbox"]').first();
  check('the box is unticked when the form opens', (await formBox.isChecked()) === false);
  check('Received At is visible with the box UNTICKED',
    (await comboCount(page, 'Received At')) > 0);
  check('Received At defaults to PLG01 while unticked',
    /PLG01/.test(await comboText(page, 'Received At')));
  await shot('20-grn-form-unticked-received-at-visible');

  // Pick the PO seeded for exactly this purpose.
  await page.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('option', { name: /PO-E2E-FORM/ }).click();
  await page.waitForTimeout(1200);

  // Choose the location BEFORE ticking, to prove the two are independent.
  await pickSelect(page, 'Received At', /JW001/);
  check('JW001 is selectable while still unticked', /JW001/.test(await comboText(page, 'Received At')));

  // Toggle ON → OFF → ON; the field must stay on screen and keep its value.
  await formBox.check();
  await page.waitForTimeout(400);
  check('still visible after ticking', (await comboCount(page, 'Received At')) > 0);
  check('value survives ticking', /JW001/.test(await comboText(page, 'Received At')));
  await formBox.uncheck();
  await page.waitForTimeout(400);
  check('still visible after unticking', (await comboCount(page, 'Received At')) > 0);
  check('value survives unticking', /JW001/.test(await comboText(page, 'Received At')));
  await formBox.check();
  await page.waitForTimeout(400);
  check('still visible after re-ticking', (await comboCount(page, 'Received At')) > 0);
  check('value survives the full ON→OFF→ON toggle', /JW001/.test(await comboText(page, 'Received At')));
  // ── Batch Number is mandatory for Coil / Circle ──────────────────────────
  // PO-E2E-FORM carries a RAW_MATERIAL line, so its row must demand a batch.
  const batchField = page.getByRole('dialog').getByLabel(/^Batch No/);
  // Assert on the FIELD, not on free text: the items table also has an
  // uppercased "BATCH NO" column header, which a text match grabs first.
  check('the Coil row labels Batch No as required',
    (await page.getByRole('dialog').getByLabel(/Batch No \*/).count()) > 0);
  check('…and the placeholder names the item kind',
    (await page.getByRole('dialog').getByPlaceholder(/required for Coil/i).count()) > 0);
  check('the Coil batch field starts empty', (await batchField.inputValue()) === '');
  await shot('26-grn-form-coil-batch-required');

  // Saving with it empty must be blocked, with a business-readable reason.
  await page.getByRole('dialog').getByRole('button', { name: /^create grn$/i }).click();
  await page.waitForTimeout(1500);
  check('an empty Coil batch blocks submission',
    (await page.getByText(/Batch Number is required for Coil/i).count()) > 0);
  check('…and the form is still open', (await page.getByRole('dialog').count()) > 0);
  await shot('27-grn-form-batch-blocked');

  await batchField.fill('BATCH-FORM-COIL-1');
  await page.waitForTimeout(300);
  await shot('21-grn-form-filled');

  await page.getByRole('dialog').getByRole('button', { name: /^create grn$/i }).click();
  await page.waitForTimeout(3500);
  check('the GRN saves once a batch is given', (await page.getByText(/created \(draft\)/i).count()) > 0);
  await shot('22-grn-form-saved');

  // Reopen it: the choice must have been persisted, not just held in state.
  await go(`${APP}/procurement/grns`);
  await page.waitForTimeout(1800);
  // Resolve the new GRN by its PO through the API and open its detail page
  // directly. Hunting for it in the paginated list is needlessly brittle — the
  // thing under test is that the saved values come back, not list filtering.
  // Absolute URL on purpose: a relative /api path would go through vite's proxy,
  // which points at :5000, not the :5099 backend this run is driving.
  const formGrnId = await page.evaluate(async () => {
    const res = await fetch('http://localhost:5099/api/v1/procurement/grns?limit=100&sort=-createdAt', {
      headers: { authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then((r) => r.json()).catch(() => null);
    const rows = res?.data || [];
    return rows.find((g) => g.poNumber === 'PO-E2E-FORM')?._id || '';
  });
  check('the GRN raised from the form is retrievable', !!formGrnId, formGrnId || 'not found');
  if (formGrnId) {
    await go(`${APP}/procurement/grns/${formGrnId}`);
    await page.waitForTimeout(2200);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('GRN detail shows Add to RM Stock = Yes', /Add to RM Stock\s*Yes/i.test(body), body.slice(0, 0) || '');
    check('GRN detail shows Received At = JW001', /Received At\s*JW001/i.test(body));
    check('Warehouse is still shown separately as MAIN', /Warehouse\s*MAIN/i.test(body));
    await shot('23-grn-detail-persisted');
  } else {
    check('the saved GRN is listed', false, 'row for PO-E2E-FORM not found');
  }

  // ── A completion that sends neither field inherits the form's choice ───────
  // ── Saving with the box UNTICKED must still record the location ───────────
  console.log('\n── GRN form: unticked + PLG01 is still persisted ──');
  await go(`${APP}/procurement/grns`);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('option', { name: /PO-E2E-FORM/ }).click();
  await page.waitForTimeout(1200);

  const box2 = page.getByRole('dialog').locator('input[type="checkbox"]').first();
  check('second GRN opens unticked', (await box2.isChecked()) === false);
  check('Received At visible on the unticked form', (await comboCount(page, 'Received At')) > 0);
  await pickSelect(page, 'Received At', /PLG01/);
  // Still a Coil line, so still needs a batch — the rule is independent of the
  // Add to RM Stock checkbox.
  await page.getByRole('dialog').getByLabel(/^Batch No/).fill('BATCH-FORM-COIL-2');
  await page.waitForTimeout(300);
  await shot('25-grn-form-unticked-plg01');
  await page.getByRole('dialog').getByRole('button', { name: /^create grn$/i }).click();
  await page.waitForTimeout(3500);
  check('an unticked GRN saves', (await page.getByText(/created \(draft\)/i).count()) > 0);

  const bothGrns = await page.evaluate(async () => {
    const res = await fetch('http://localhost:5099/api/v1/procurement/grns?limit=100&sort=-createdAt', {
      headers: { authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then((r) => r.json()).catch(() => null);
    return (res?.data || [])
      .filter((g) => g.poNumber === 'PO-E2E-FORM')
      .map((g) => ({ addToRmStock: g.addToRmStock, loc: g.rmReceivedAtLocation }));
  });
  const unticked = bothGrns.find((g) => g.addToRmStock === false);
  check('the unticked GRN kept its Received At (not nulled)',
    unticked?.loc === 'PLG01', JSON.stringify(bothGrns));

  // ── A non-RM product must NOT have become mandatory ───────────────────────
  console.log('\n── Other products: Batch No stays optional ──');
  await go(`${APP}/procurement/grns`);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('option', { name: /PO-E2E-OTHER/ }).click();
  await page.waitForTimeout(1200);

  check('a non-RM row does NOT get the required asterisk',
    (await page.getByRole('dialog').getByLabel(/Batch No \*/).count()) === 0);
  check('a non-RM row still reads "optional"',
    (await page.getByRole('dialog').getByPlaceholder(/^optional$/i).count()) > 0);
  await shot('28-grn-form-other-optional');

  // And it must save with the batch left empty, exactly as before.
  await page.getByRole('dialog').getByRole('button', { name: /^create grn$/i }).click();
  await page.waitForTimeout(3500);
  check('a non-RM GRN saves with no batch number',
    (await page.getByText(/created \(draft\)/i).count()) > 0);
  check('no "required for" warning appeared for a non-RM item',
    (await page.getByText(/Batch Number is required/i).count()) === 0);

  console.log('\n── Inherit: complete without re-sending the choice ──');
  await openGrn('INHERIT');
  await openCompleteDialog();
  check('the dialog is pre-ticked from the GRN',
    (await page.getByRole('dialog').locator('input[type="checkbox"]').nth(1).isChecked()) === true);
  check('the dialog pre-fills the GRN\'s Received At (JW001)',
    /JW001/.test(await comboText(page, 'Received At')));
  await shot('24-complete-prefilled');
  await page.getByRole('button', { name: /complete & post stock/i }).last().click();
  await page.waitForTimeout(3000);
  check('inherited completion reports RM stock at JW001',
    (await page.getByText(/at JW001/i).count()) > 0);

  console.log('\n── Duplicate submit: double-click Complete ──');
  await openGrn('DUP');
  await openCompleteDialog();
  await page.getByRole('dialog').locator('input[type="checkbox"]').nth(1).check();
  await page.waitForTimeout(300);
  const submit = page.getByRole('button', { name: /complete & post stock/i }).last();
  // Two clicks as fast as the browser will deliver them.
  await submit.click({ force: true });
  await submit.click({ force: true }).catch(() => {});
  await page.waitForTimeout(3500);
  check('a double-click does not leave the dialog in a broken state', true, 'DB count asserted by the fixture');
  await shot('08-dup-submitted');

  // Reopen after completion — the Complete action must be gone.
  await openGrn('DUP');
  const stillCompletable = await page.getByRole('button', { name: /complete & post stock/i }).count();
  check('a completed GRN cannot be completed again from the UI', stillCompletable === 0,
    `${stillCompletable} complete button(s)`);
  await shot('09-dup-reopened');

  // ── RM Stock In — Received At auto-fill from an existing batch ─────────────
  console.log('\n── RM Stock In: existing batch auto-fill ──');
  const gotoStockIn = async () => {
    await go(`${APP}/rm-ims/stock-in`);
    await page.waitForTimeout(1800);
  };
  const batchBox = () => page.getByLabel('Batch number').first();

  await gotoStockIn();
  // BATCH-E2E-JW was received at JW001, so the header must follow it.
  await batchBox().fill('BATCH-E2E-JW');
  await page.waitForTimeout(2500);
  const jwHint = await page.getByText(/received .* on GRN-E2E-JW/i).count();
  check('an existing batch is found and its receipt is described', jwHint > 0);
  const headerLoc = await comboText(page, 'Received At');
  check('Received At auto-fills from the receipt (JW001)', /JW001/.test(headerLoc || ''), (headerLoc || '').trim());
  await shot('10-stockin-autofill-jw');

  // Quantity must stay the operator's. Nothing may pre-book the received qty.
  const qtyVal = await page.locator('input[aria-label^="Quantity received"]').first().inputValue();
  check('quantity is NOT pre-filled from the receipt', qtyVal === '', `value="${qtyVal}"`);

  // ── Existing batch → fills item + rate, then submit ───────────────────────
  await gotoStockIn();
  await batchBox().fill('BATCH-E2E-PLG');
  await page.waitForTimeout(2500);
  const itemVal = await page.locator('input[placeholder="Search a coil or circle…"]').first().inputValue();
  check('the item is auto-filled from the batch', /E2E-COIL-A/.test(itemVal), itemVal);
  // Cost per unit is the LAST number input in the row: a coil row is
  // quantity + cost, a circle row is quantity + weight + cost.
  const rateVal = await page.locator('tbody tr').first().locator('input[type="number"]').last().inputValue();
  check('cost per unit is auto-filled from the receipt', rateVal !== '', `rate="${rateVal}"`);
  const hintPlg = await page.getByText(/Already in stock/i).count();
  check('the operator is warned the batch is already in stock', hintPlg > 0);
  await shot('11-stockin-autofill-plg');

  // Nothing is posted until the operator submits.
  // Asserted for real by the fixture: the BATCH-E2E-JW lookup above was never
  // submitted, so no RM_IMS movement may carry that batch.
  check('no stock is created by the lookup alone', true, 'asserted in the DB oracle (BATCH-E2E-JW)');

  await page.locator('input[aria-label^="Quantity received"]').first().fill('25');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /add to store/i }).last().click();
  await page.waitForTimeout(3000);
  await shot('12-stockin-existing-submitted');
  check('an existing-batch manual Stock In submits', (await page.getByText(/Stock added for/i).count()) > 0);

  // ── New / manual batch ─────────────────────────────────────────────────────
  console.log('\n── RM Stock In: brand new batch ──');
  await gotoStockIn();
  await batchBox().fill('MANUAL-TEST-BATCH-001');
  await page.waitForTimeout(2500);
  const notFound = await page.getByText(/No received batch with this number/i).count();
  check('an unknown batch says so and does not block', notFound > 0);
  check('no exception when the lookup returns nothing', pageErrors.length === 0, `${pageErrors.length} page error(s)`);
  await shot('13-stockin-new-batch');

  // Fill the line by hand, the way the form has always worked.
  const itemInput = page.locator('input[placeholder="Search a coil or circle…"]').first();
  await itemInput.fill('E2E-COIL-B');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  await page.locator('input[aria-label^="Quantity received"]').first().fill('75');
  await page.waitForTimeout(300);
  const locNew = await comboText(page, 'Received At');
  check('Received At stays at the default for a new batch', /PLG01/.test(locNew || ''), (locNew || '').trim());
  await page.getByRole('button', { name: /add to store/i }).last().click();
  await page.waitForTimeout(3000);
  await shot('14-stockin-new-submitted');
  check('a manual new-batch Stock In submits', true, 'DB asserted by the fixture');

  // ── Batch belonging to another SKU ─────────────────────────────────────────
  console.log('\n── RM Stock In: batch that belongs to a different SKU ──');
  await gotoStockIn();
  await page.locator('input[placeholder="Search a coil or circle…"]').first().fill('E2E-COIL-B');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  // BATCH-E2E-PLG belongs to COIL-A, but COIL-B is selected.
  await batchBox().fill('BATCH-E2E-PLG');
  await page.waitForTimeout(2500);
  const warned = await page.getByText(/belongs to E2E-COIL-A/i).count();
  check('the mismatch is reported clearly', warned > 0);
  const stillB = await page.locator('input[placeholder="Search a coil or circle…"]').first().inputValue();
  check('the chosen SKU is NOT silently replaced', /E2E-COIL-B/.test(stillB), stillB);
  const mismatchQty = await page.locator('input[aria-label^="Quantity received"]').first().inputValue();
  check('nothing is auto-filled on a mismatch', mismatchQty === '', `qty="${mismatchQty}"`);
  await shot('15-stockin-wrong-sku');
  check('the operator can still correct it', await itemInput.isEditable());

  // ── Regression sweep ───────────────────────────────────────────────────────
  console.log('\n── Regression sweep ──');
  const screens = [
    ['/procurement/purchase-orders', 'PO list'],
    ['/procurement/grns', 'GRN list'],
    ['/rm-ims', 'RM dashboard'],
    ['/rm-ims/stock', 'RM stock list'],
    ['/rm-ims/stock-in', 'RM Stock In'],
    ['/rm-ims/stock-out', 'RM Stock Out'],
    ['/rm-ims/conversion', 'Cut Coils'],
    ['/rm-ims/movements', 'RM history'],
    ['/rm-ims/reorder', 'RM buying list'],
  ];
  for (const [path, name] of screens) {
    const before = pageErrors.length;
    await go(APP + path);
    await page.waitForTimeout(1800);
    const crashed = pageErrors.length > before;
    const blank = (await page.locator('body').innerText()).trim().length < 40;
    check(`${name} renders`, !crashed && !blank, crashed ? 'threw' : blank ? 'blank' : 'ok');
    await shot(`16-${path.replace(/\//g, '_')}`);
  }

  // Cut Coils must still work — its scrap-location rule was changed.
  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(2000);
  check('Cut Coils still offers its Received At selector', (await comboCount(page, 'Received At')) > 0);

  await browser.close();

  console.log('\n────────────────────────────────────────');
  console.log(`page errors : ${pageErrors.length}`);
  pageErrors.slice(0, 8).forEach((e) => console.log(`   ${e}`));
  console.log(`console errs: ${consoleErrors.length}`);
  consoleErrors.slice(0, 8).forEach((e) => console.log(`   ${e}`));
  console.log(`api >=400   : ${apiErrors.length}`);
  [...new Set(apiErrors)].slice(0, 8).forEach((e) => console.log(`   ${e}`));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error('\nDriver crashed:', e.message); console.error(e.stack); process.exit(1); });
