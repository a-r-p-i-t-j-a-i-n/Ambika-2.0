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
 * Raw Material routes to RM IMS automatically (SKU Item Type), at a "Received
 * At" that has to be chosen. Completing the GRN stocks nothing: QC completes
 * and only the ACCEPTED qty is posted — the GRN's MD signature is recorded on
 * its own and is not waited for. A coil still awaiting QC
 * cannot be stocked in by hand or cut as a manual coil.
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
import { assertE2ESetup } from './_e2eSafety.mjs';
import {
  dialogTitled, combinedBtn, stageText, confirmCompleteGrn, completeQc,
} from './_grnLifecycle.mjs';

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
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'grnRm.e2e.mjs');
const USER = { email: 'e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/grnrm';

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
const combo = (scope, label) => scope.getByRole('combobox', { name: new RegExp(label, 'i') }).first();
const comboCount = (scope, label) => scope.getByRole('combobox', { name: new RegExp(label, 'i') }).count();
const comboText = async (scope, label) => (await combo(scope, label).textContent() || '').trim();

const main = async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
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
   * index.html removes #initial-boot from a MutationObserver attached on
   * DOMContentLoaded; when React mounts first the overlay stays and swallows
   * clicks. Pre-existing and unrelated, so it is worked around here.
   */
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(120);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }).catch(() => {});
  const pickSelect = async (scope, label, optionText) => {
    await combo(scope, label).click();
    await page.getByRole('option', { name: optionText }).click();
    // MUI closes the menu itself; Escape would also close the surrounding Dialog.
    await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
  };
  const seen = (rx, ms = 6000) => page.getByText(rx).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const lineStock = async () => (await page.getByTestId('grn-line-stock').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

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
    await page.getByText(`GRN-E2E-${tag}`, { exact: true }).first().click({ timeout: 20000 });
    await page.waitForSelector('#grn-qc-section', { timeout: 15000 });
    await page.waitForTimeout(1000);
  };
  const openCompleteDialog = async () => {
    await combinedBtn(page).click();
    const dlg = dialogTitled(page, /^Complete GRN/);
    await dlg.waitFor({ timeout: 15000 });
    return dlg;
  };

  // ── Scenario A — a mixed coil + bolt draft from before automatic routing ──
  console.log('\n── Scenario A: mixed coil + bolt → routed per line, Received At must be chosen ──');
  await openGrn('MIXED');
  let dlg = await openCompleteDialog();
  check('the Complete dialog has no Inventory Type and no "Add to RM Stock" checkbox',
    (await comboCount(dlg, 'Inventory Type')) === 0 && (await dlg.getByText('Add to RM Stock', { exact: true }).count()) === 0);
  check('it lists where each line goes: RM IMS 1 · C&P IMS 1', /RM IMS: 1 · C&P IMS: 1/.test(await dlg.getByTestId('grn-complete-destinations').innerText()));
  check('Received At is asked for — the GRN has a coil — and is NOT pre-filled', (await comboCount(dlg, 'Received At')) > 0 && !/PLG01|JW001/.test(await comboText(dlg, 'Received At')));
  await shot('02-mixed-dialog');
  await dlg.getByRole('button', { name: /^Complete GRN$/ }).click();
  check('completing without Received At is refused (no location is assumed)', await seen(/Select Received At/));
  check('…and the dialog stays open', (await dlg.count()) > 0);
  await confirmCompleteGrn(page, { receivedAt: 'PLG01' });
  check('mixed GRN completed — QC open at once (no MD signature awaited)', (await stageText(page)) === 'QC Pending', await stageText(page));
  check('…nothing is stock yet: both lines read "Awaiting QC"', (await lineStock()).every((t) => /Awaiting QC/.test(t)), (await lineStock()).join(' | '));
  check('mixed GRN: QC completes without an MD signature', (await completeQc(page)) === 'QC Completed · Passed');
  const mixStock = await lineStock();
  check('coil → RM IMS · PLG01 Posted 500, bolt → C&P IMS · MAIN Posted 200',
    mixStock.some((t) => /RM IMS · PLG01 Posted 500/.test(t)) && mixStock.some((t) => /C&P IMS · MAIN Posted 200/.test(t)), mixStock.join(' | '));
  await shot('03-mixed-posted');

  // ── Scenario B — RM coil + circle, Received At PLG01 saved on the draft ────
  console.log('\n── Scenario B: coil + circle at PLG01 ──');
  await openGrn('PLG');
  dlg = await openCompleteDialog();
  check('the dialog carries the draft\'s Received At (PLG01)', /PLG01/.test(await comboText(dlg, 'Received At')), await comboText(dlg, 'Received At'));
  await confirmCompleteGrn(page);
  check('completed — the message says stock waits for QC', await seen(/awaiting QC/i, 3000) || (await stageText(page)) === 'QC Pending');
  const plgStage = await completeQc(page, page, { split: [['E2E Circle A 180mm', 280, 20]] });
  check('QC\'d — Partial (20 circles rejected)', plgStage === 'QC Completed · Partial', plgStage);
  const plgStock = await lineStock();
  check('coil 500 and circle 280 posted at PLG01 — the 20 rejected are not stock',
    plgStock.some((t) => /RM IMS · PLG01 Posted 500/.test(t)) && plgStock.some((t) => /RM IMS · PLG01 Posted 280/.test(t)), plgStock.join(' | '));
  check('GRN detail shows Received At PLG01 and Warehouse MAIN separately', /Received At\s*PLG01/i.test(await page.locator('body').innerText())
    && /Warehouse\s*MAIN/i.test(await page.locator('body').innerText()));
  await shot('04-plg-posted');

  // ── Scenario B2 — JW001 ────────────────────────────────────────────────────
  console.log('\n── Scenario B2: Received At = JW001 ──');
  await openGrn('JW');
  dlg = await openCompleteDialog();
  check('JW001 carried from the draft', /JW001/.test(await comboText(dlg, 'Received At')));
  await confirmCompleteGrn(page);
  check('JW: QC\'d', (await completeQc(page)) === 'QC Completed · Passed');
  check('JW: coil posted at JW001 only after QC', (await lineStock()).some((t) => /RM IMS · JW001 Posted 400/.test(t)), (await lineStock()).join(' | '));

  // ── The GRN FORM itself ────────────────────────────────────────────────────
  console.log('\n── GRN create form: automatic destination + Received At ──');
  await go(`${APP}/procurement/grns`);
  await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
  const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
  await form.waitFor();
  check('the GRN form has no Inventory Type and no "Add to RM Stock"',
    (await comboCount(form, 'Inventory Type')) === 0 && (await form.getByText('Add to RM Stock', { exact: true }).count()) === 0);
  check('Received At is not asked before a coil line exists', (await comboCount(form, 'Received At')) === 0);
  await form.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('option', { name: /PO-E2E-FORM/ }).click();
  await page.waitForTimeout(1500);
  check('the coil line shows → RM IMS and Received At appears, empty',
    (await form.getByTestId('grn-line-destination').allInnerTexts()).some((t) => /RM IMS/.test(t))
    && (await comboCount(form, 'Received At')) > 0 && !/PLG01|JW001/.test(await comboText(form, 'Received At')));
  // ── Batch Number is mandatory for Coil / Circle ──
  const batchField = form.getByLabel(/^Batch No/);
  check('the Coil row labels Batch No as required', (await form.getByLabel(/Batch No \*/).count()) > 0);
  check('…and the placeholder names the item kind', (await form.getByPlaceholder(/required for Coil/i).count()) > 0);
  check('the Coil batch field starts empty', (await batchField.inputValue()) === '');
  await form.getByRole('button', { name: /^Save as Draft$/ }).click();
  check('an empty Coil batch blocks submission', await seen(/Batch Number is required for Coil/i));
  await batchField.fill('BATCH-FORM-COIL-1');
  await form.getByRole('button', { name: /^Save as Draft$/ }).click();
  check('Raw Material without Received At blocks submission', await seen(/Select Received At/));
  await pickSelect(form, 'Received At', /JW001/);
  check('the coil line now reads → RM IMS · JW001', (await form.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim()).includes('→ RM IMS · JW001'));
  await shot('21-grn-form-filled');
  await form.getByRole('button', { name: /^Save as Draft$/ }).click();
  check('the GRN saves once batch and Received At are given', await seen(/created \(draft\)/i, 8000));
  await form.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.waitForTimeout(1200);

  // Reopen it through the API id: the values must have persisted.
  const formGrnId = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:5099/api/v1/procurement/grns?limit=100&sort=-createdAt', {
      headers: { authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then((r) => r.json()).catch(() => null);
    return (res?.data || []).find((g) => g.poNumber === 'PO-E2E-FORM')?._id || '';
  });
  check('the GRN raised from the form is retrievable', !!formGrnId, formGrnId || 'not found');
  if (formGrnId) {
    await go(`${APP}/procurement/grns/${formGrnId}`);
    await page.waitForTimeout(2200);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('GRN detail shows Received At = JW001 and Warehouse MAIN', /Received At\s*JW001/i.test(body) && /Warehouse\s*MAIN/i.test(body));
    check('…and "Stock Posting" after QC, no Inventory Type field', /Stock Posting\s*After QC/i.test(body) && !/Inventory Type/i.test(body));
    await shot('23-grn-detail-persisted');
  }

  // ── A non-RM product: Batch No stays optional, no Received At ──────────────
  console.log('\n── Other products: Batch No optional, no Received At ──');
  await go(`${APP}/procurement/grns`);
  await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
  const otherForm = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
  await otherForm.waitFor();
  await otherForm.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('option', { name: /PO-E2E-OTHER/ }).click();
  await page.waitForTimeout(1500);
  check('a non-RM row does NOT get the required asterisk', (await otherForm.getByLabel(/Batch No \*/).count()) === 0);
  check('a non-RM row still reads "optional"', (await otherForm.getByPlaceholder(/^optional$/i).count()) > 0);
  check('…its destination is C&P IMS · MAIN and no Received At is asked',
    (await otherForm.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim()).includes('→ C&P IMS · MAIN') && (await comboCount(otherForm, 'Received At')) === 0);
  await otherForm.getByRole('button', { name: /^Save as Draft$/ }).click();
  check('a non-RM GRN saves with no batch number', await seen(/created \(draft\)/i, 8000));
  check('no "required for" warning appeared for a non-RM item', (await page.getByText(/Batch Number is required/i).count()) === 0);
  await otherForm.getByRole('button', { name: 'Close' }).click().catch(() => {});

  // ── INHERIT: complete, but leave the QC open → Awaiting QC ─────────────────
  console.log('\n── Inherit: Received At from the draft; QC left open ──');
  await openGrn('INHERIT');
  dlg = await openCompleteDialog();
  check('the dialog pre-fills the draft\'s Received At (JW001)', /JW001/.test(await comboText(dlg, 'Received At')));
  check('…and shows no trace of the retired Inventory Type', (await comboCount(dlg, 'Inventory Type')) === 0);
  await shot('24-complete-prefilled');
  await confirmCompleteGrn(page);
  check('INHERIT completed — QC open (no MD signature awaited), line Awaiting QC', (await stageText(page)) === 'QC Pending'
    && (await lineStock()).some((t) => /RM IMS · JW001 Awaiting QC/.test(t)), (await lineStock()).join(' | '));

  // ── Duplicate submits ──────────────────────────────────────────────────────
  console.log('\n── Duplicate submit: double-click Complete GRN and Complete QC ──');
  await openGrn('DUP');
  await openCompleteDialog();
  await confirmCompleteGrn(page, { doubleClick: true });
  check('a double-clicked Complete GRN leaves the GRN completed once', (await stageText(page)) === 'QC Pending');
  check('…double-clicked Complete QC', (await completeQc(page, page, { doubleClick: true })) === 'QC Completed · Passed');
  await openGrn('DUP');
  check('a completed GRN cannot be completed again from the UI', (await page.getByRole('button', { name: /^Complete GRN$/ }).count()) === 0
    && (await combinedBtn(page).count()) === 0);
  await shot('09-dup-reopened');

  // ── RM IMS: the coil awaiting QC is visible, not usable ────────────────────
  console.log('\n── RM IMS: Awaiting QC ──');
  await go(`${APP}/rm-ims/stock`);
  await page.getByRole('row').filter({ hasText: 'E2E-COIL-A' }).first().waitFor({ timeout: 20000 });
  const coilRow = (await page.getByRole('row').filter({ hasText: 'E2E-COIL-A' }).first().innerText()).replace(/\s+/g, ' ');
  check('RM stock list shows the coil with "+250 awaiting QC" (INHERIT)', /\+250 awaiting QC/.test(coilRow), coilRow.slice(0, 200));
  await shot('10-rm-awaiting-qc');

  // ── RM Stock In ────────────────────────────────────────────────────────────
  console.log('\n── RM Stock In: existing batch auto-fill ──');
  const gotoStockIn = async () => { await go(`${APP}/rm-ims/stock-in`); await page.waitForTimeout(1800); };
  const batchBox = () => page.getByLabel('Batch number').first();
  const itemInput = () => page.locator('input[placeholder="Search a coil or circle…"]').first();
  const addBtn = () => page.getByRole('button', { name: /add to store/i }).last();
  // Stock In no longer starts on a reason: "Vendor receipt" was retired (a
  // supplier delivery belongs to its GRN + QC), and the two that remain mean
  // different things in History, so the operator chooses one.
  const pickReason = async (label) => {
    await page.getByRole('combobox', { name: /^Reason/i }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('option', { name: label, exact: true }).click();
    await page.waitForTimeout(300);
  };

  await gotoStockIn();
  // ── the retired vendor receipt ──
  await page.getByRole('combobox', { name: /^Reason/i }).first().click();
  await page.waitForTimeout(500);
  const reasonOptions = (await page.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  check('"Vendor receipt" is no longer offered as a Stock In reason', !reasonOptions.some((o) => /vendor/i.test(o)), reasonOptions.join(' | '));
  check('…the legitimate reasons are all still there', ['Opening stock', 'Correction / adjustment', 'Other'].every((o) => reasonOptions.includes(o)), reasonOptions.join(' | '));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('…and "Add to store" is disabled until a reason is picked', await addBtn().isDisabled());

  // BATCH-E2E-JW was received at JW001 (posted at its QC), so the header follows it.
  await batchBox().fill('BATCH-E2E-JW');
  await page.waitForTimeout(2500);
  check('an existing batch is found and its receipt is described', (await page.getByText(/received .* on GRN-E2E-JW/i).count()) > 0);
  check('Received At auto-fills from the receipt (JW001)', /JW001/.test(await comboText(page, 'Received At')), await comboText(page, 'Received At'));
  const qtyVal = await page.locator('input[aria-label^="Quantity received"]').first().inputValue();
  check('quantity is NOT pre-filled from the receipt', qtyVal === '', `value="${qtyVal}"`);
  await shot('11-stockin-autofill-jw');

  await gotoStockIn();
  await batchBox().fill('BATCH-E2E-PLG');
  await page.waitForTimeout(2500);
  check('the item is auto-filled from the batch', /E2E-COIL-A/.test(await itemInput().inputValue()), await itemInput().inputValue());
  const rateVal = await page.locator('tbody tr').first().locator('input[type="number"]').last().inputValue();
  check('cost per unit is auto-filled from the receipt', rateVal !== '', `rate="${rateVal}"`);
  check('the operator is warned the batch is already in stock', (await page.getByText(/Already in stock/i).count()) > 0);
  await page.locator('input[aria-label^="Quantity received"]').first().fill('25');
  await page.waitForTimeout(300);
  await pickReason('Correction / adjustment');
  await addBtn().click();
  check('an existing-batch manual Stock In submits', await seen(/Stock added for/i, 8000));

  console.log('\n── RM Stock In: a coil awaiting QC cannot be stocked by hand ──');
  await gotoStockIn();
  await itemInput().fill('E2E-COIL-A');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  await batchBox().fill('BATCH-E2E-INHERIT');
  await page.waitForTimeout(2500);
  await page.locator('input[aria-label^="Quantity received"]').first().fill('10');
  await pickReason('Correction / adjustment');
  await addBtn().click();
  check('Stock In of a batch awaiting Incoming QC is refused with the reason', await seen(/awaiting Incoming QC/i, 8000));
  check('…and nothing was added', (await page.getByText(/Stock added for/i).count()) === 0);
  await shot('12-stockin-awaiting-qc-refused');

  console.log('\n── RM Stock In: brand new batch ──');
  await gotoStockIn();
  await batchBox().fill('MANUAL-TEST-BATCH-001');
  await page.waitForTimeout(2500);
  check('an unknown batch says so and does not block', (await page.getByText(/No received batch with this number/i).count()) > 0);
  await itemInput().fill('E2E-COIL-B');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  await page.locator('input[aria-label^="Quantity received"]').first().fill('75');
  await page.waitForTimeout(300);
  check('Received At stays at the default for a new batch', /PLG01/.test(await comboText(page, 'Received At')), await comboText(page, 'Received At'));
  await pickReason('Opening stock');
  await addBtn().click();
  check('a manual new-batch Stock In submits', await seen(/Stock added for/i, 8000));

  console.log('\n── RM Stock In: batch that belongs to a different SKU ──');
  await gotoStockIn();
  await itemInput().fill('E2E-COIL-B');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  // BATCH-E2E-PLG belongs to COIL-A, but COIL-B is selected.
  await batchBox().fill('BATCH-E2E-PLG');
  await page.waitForTimeout(2500);
  check('the mismatch is reported clearly', (await page.getByText(/belongs to E2E-COIL-A/i).count()) > 0);
  check('the chosen SKU is NOT silently replaced', /E2E-COIL-B/.test(await itemInput().inputValue()), await itemInput().inputValue());
  const mismatchQty = await page.locator('input[aria-label^="Quantity received"]').first().inputValue();
  check('nothing is auto-filled on a mismatch', mismatchQty === '', `qty="${mismatchQty}"`);
  check('the operator can still correct it', await itemInput().isEditable());

  // ── Cut Coils: a coil awaiting QC cannot be entered as a manual coil ───────
  console.log('\n── Cut Coils: manual entry refused for a coil awaiting QC ──');
  await go(`${APP}/rm-ims/conversion`);
  await page.getByTestId('open-coil-to-circle').waitFor({ timeout: 20000 });
  await page.getByTestId('open-coil-to-circle').click();
  const F = page.getByTestId('coil-to-circle-dialog');
  await F.waitFor({ state: 'visible', timeout: 10000 });
  check('Cut Coils still offers its Received At selector', (await comboCount(page, 'Received At')) > 0);
  await F.getByTestId('batch-input').fill('BATCH-E2E-INHERIT');
  await page.waitForTimeout(3000);
  const ctcText = (await F.innerText()).replace(/\s+/g, ' ');
  check('the batch is explained as awaiting Incoming QC — not offered as a new manual coil', /awaiting Incoming QC/i.test(ctcText) && !/Enter the coil details manually/i.test(ctcText),
    (ctcText.match(/Batch BATCH-E2E-INHERIT[^.]*\./) || [''])[0]);
  check('…manual coil weight cannot be entered', await F.getByTestId('manual-total-input').isDisabled().catch(() => true));
  await shot('13-cutcoils-awaiting-qc');

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
  for (const [p, name] of screens) {
    const before = pageErrors.length;
    await go(APP + p);
    await page.waitForTimeout(1800);
    const crashed = pageErrors.length > before;
    const blank = (await page.locator('body').innerText()).trim().length < 40;
    check(`${name} renders`, !crashed && !blank, crashed ? 'threw' : blank ? 'blank' : 'ok');
  }

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
