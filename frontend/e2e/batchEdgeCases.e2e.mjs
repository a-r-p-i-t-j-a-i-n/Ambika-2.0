/**
 * Cut Coils — Batch Number EDGE CASES through the real UI: duplicate exact
 * batch numbers, short batch numbers, a GRN batch that is never a new manual
 * coil, a failed lookup, and editing a batch after a coil was bound.
 *
 *   node e2e/batchEdgeCases.e2e.mjs
 *
 * The database is the oracle: backend/src/scripts/e2eBatchEdgeFixture.js
 * --verify checks that each saved round is linked to the coil that was PICKED
 * and to no other coil with the same batch.
 *
 * Expects (started separately):
 *   cd backend && node src/scripts/e2eBatchEdgeFixture.js --seed
 *   backend  :5099  e2eServer.js on ambika_e2e_batchedge
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
await assertE2ESetup(APP, API, 'batchEdgeCases.e2e.mjs');
const USER = { email: 'batchedge-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/batch-edge';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];
const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
// The deliberately failed lookup (section 7) — its 500s are expected.
const PROBE = 'batchNo=DUP-0420';

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${decodeURIComponent(r.url().replace(/.*\/api\/v1/, ''))}`);
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

  console.log('\nCUT COILS — BATCH NUMBER EDGE CASES — real UI\n');
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  await go(`${APP}/rm-ims/conversion`);
  await settle(2500);

  const F = page.getByTestId('coil-to-circle-dialog');
  const openCutForm = async () => {
    if (await F.count()) return;
    await page.getByTestId('open-coil-to-circle').click();
    await F.waitFor({ state: 'visible', timeout: 10000 });
    await settle(800);
  };
  await openCutForm();

  const batch = F.getByTestId('batch-input');
  const grade = F.getByRole('combobox', { name: /coil being cut/i }).first();
  const rate = F.getByLabel(/^rate/i).first();
  const receivedAt = F.getByLabel(/^received at/i).first();
  const cutField = F.getByLabel(/^cut this round/i).first();
  const total = F.getByTestId('manual-total-input');
  const saveBtn = F.getByRole('button', { name: /save this conversion/i });
  const partial = F.getByRole('radio', { name: /partial cutting/i });
  const full = F.getByRole('radio', { name: /full cutting/i });
  const options = () => page.locator('ul[role="listbox"] li[role="option"]');
  const facts = () => F.getByTestId('coil-facts').first().textContent().then(flat).catch(() => '');
  const status = async () => flat(await F.getByTestId('batch-field').innerText());
  const cards = async () => (await F.getByTestId('coil-facts').count()) > 0;
  const banner = async () => flat(await F.getByTestId('selected-coil').innerText().catch(() => ''));
  const manualBanner = async () => flat(await F.getByTestId('manual-coil-banner').innerText().catch(() => ''));
  const receivedAtText = () => receivedAt.innerText().then(flat);
  const openList = async () => { await batch.click(); await settle(800); };
  const closeList = async () => { if (await page.locator('ul[role="listbox"]').count()) await page.keyboard.press('Escape'); await settle(200); };
  const typeBatch = async (b, ms = 2600) => { await batch.fill(b); await settle(ms); };
  const pick = async (text) => { await openList(); await options().filter({ hasText: text }).first().click(); await settle(2600); };
  const pickCircle = async (pcs, kg) => {
    const row = F.locator('table tbody tr').nth(0);
    const input = row.locator('input[placeholder]').first();
    if (await input.inputValue()) await input.fill('');
    await input.click();
    await page.waitForTimeout(500);
    await options().first().click();
    await page.waitForTimeout(250);
    await row.locator('input[type="number"]').nth(0).fill(String(pcs));
    await row.locator('input[type="number"]').nth(1).fill(String(kg));
  };
  const save = async () => {
    await saveBtn.click();
    const ok = await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    await settle(1500);
    return ok;
  };

  /* ── 1. Two GRNs, one batch number (DUP-0420) ── */
  await typeBatch('DUP-0420');
  check('DUP-0420 (on two GRNs): nothing is selected automatically — no coil, no rate, no grade, Save disabled',
    !(await cards()) && (await F.getByTestId('selected-coil').count()) === 0 && (await rate.inputValue()) === ''
      && (await grade.inputValue()) === '' && !(await saveBtn.isEnabled()));
  check('…the field says two coils carry it and asks for a pick', /2 coils carry this batch number — pick the one being cut from the list/.test(await status()), await status());
  check('…and the round stays locked', await partial.isDisabled() && await full.isDisabled());
  await openList();
  const dup = (await options().allInnerTexts()).map(flat).filter((t) => /Batch DUP-0420/.test(t));
  const optA = dup.find((t) => /GRN-BE-A/.test(t)) || '';
  const optB = dup.find((t) => /GRN-BE-B/.test(t)) || '';
  check('the dropdown lists BOTH coils with batch DUP-0420', dup.length === 2, dup.join(' || '));
  check('…GRN-BE-A told apart: JSL204-07 · Alpha Metals · received 01 Sep 2026 · PLG01 · 1,000 kg',
    /JSL204-07/.test(optA) && /Alpha Metals/.test(optA) && /Received 01 Sep 2026/.test(optA) && /at PLG01/.test(optA) && /Remaining 1,000 kg/.test(optA), optA);
  check('…GRN-BE-B told apart: JSL204-08 · Beta Coils · received 10 Sep 2026 · JW001 · 1,200 kg',
    /JSL204-08/.test(optB) && /Beta Coils/.test(optB) && /Received 10 Sep 2026/.test(optB) && /at JW001/.test(optB) && /Remaining 1,200 kg/.test(optB), optB);
  await shot('01-dup-two-grns');
  await closeList();

  await pick('GRN-BE-A');
  let f = await facts();
  check('picking GRN-BE-A loads only that coil: 1,000 kg · JSL204-07 · ₹180 · PLG01',
    /Total coil weight\s*1,000 kg/.test(f) && /JSL204-07/.test(await grade.inputValue()) && (await rate.inputValue()) === '180'
      && /PLG01/.test(await receivedAtText()) && /GRN GRN-BE-A/.test(await banner()) && (await total.inputValue()) === '1000',
    `${f.slice(0, 50)} · ${await grade.inputValue()} · ${await rate.inputValue()} · ${await receivedAtText()}`);
  await pick('GRN-BE-B');
  f = await facts();
  check('picking GRN-BE-B instead replaces everything: 1,200 kg · JSL204-08 · ₹195 · JW001 — nothing of GRN-BE-A left',
    /Total coil weight\s*1,200 kg/.test(f) && /JSL204-08/.test(await grade.inputValue()) && (await rate.inputValue()) === '195'
      && /JW001/.test(await receivedAtText()) && /GRN GRN-BE-B/.test(await banner()) && !/GRN-BE-A/.test(await banner()) && (await total.inputValue()) === '1200',
    `${f.slice(0, 50)} · ${await grade.inputValue()} · ${await rate.inputValue()} · ${await receivedAtText()}`);
  check('…its own history: 0 kg already cut, 0 previous rounds', /Already cut\s*0 kg/.test(f) && /0 previous rounds/.test(f));
  await partial.check();
  await cutField.fill('300');
  await pickCircle(60, 250);
  await settle(400);
  check('a Partial 300 kg round on GRN-BE-B can be saved', await saveBtn.isEnabled());
  await shot('02-dup-picked-B');
  check('…and saves', await save());

  await openCutForm();
  await typeBatch('DUP-0420');
  check('re-typing DUP-0420 after the save still selects neither coil (both still have weight)',
    !(await cards()) && /2 coils carry this batch number/.test(await status()));
  await openList();
  const dup2 = (await options().allInnerTexts()).map(flat).filter((t) => /Batch DUP-0420/.test(t));
  check('…and the list shows GRN-BE-B now at 900 kg, GRN-BE-A still 1,000 kg',
    dup2.some((t) => /GRN-BE-B/.test(t) && /Remaining 900 kg/.test(t)) && dup2.some((t) => /GRN-BE-A/.test(t) && /Remaining 1,000 kg/.test(t)), dup2.join(' || '));
  await closeList();

  /* ── 2. Two receipts of the SAME coil grade, one batch (DUP-SAME) ── */
  await typeBatch('DUP-SAME');
  check('DUP-SAME (two receipts, same grade): nothing selected automatically', !(await cards()) && /2 coils carry this batch number/.test(await status()));
  await openList();
  const same = (await options().allInnerTexts()).map(flat).filter((t) => /Batch DUP-SAME/.test(t));
  check('…each option shows its OWN receipt\'s weight (600 / 400), not the shared ledger\'s 1,000',
    same.length === 2 && same.some((t) => /GRN-BE-S1/.test(t) && /Remaining 600 kg/.test(t)) && same.some((t) => /GRN-BE-S2/.test(t) && /Remaining 400 kg/.test(t)), same.join(' || '));
  await closeList();
  await pick('GRN-BE-S1');
  f = await facts();
  check('picking GRN-BE-S1: 600 kg total, 600 remaining, 0 already cut — never the shared 1,000',
    /Total coil weight\s*600 kg/.test(f) && /Remaining weight\s*600 kg/.test(f) && /Already cut\s*0 kg/.test(f) && !/1,000 kg|-400/.test(f), f.slice(0, 160));
  check('…the field says the batch is shared with another receipt of the grade — Partial only',
    /stock is shared: up to this coil's own 600 kg, Partial cutting only/.test(await status()), await status());
  check('…Full cutting is disabled (it would be measured against the shared ledger); Partial is available',
    await full.isDisabled() && !(await partial.isDisabled()));
  await partial.check();
  await cutField.fill('650');
  await pickCircle(10, 100);
  await settle(400);
  check('…a round above this coil\'s own 600 kg is refused on screen and cannot be saved',
    /Only 600 KG is available from this physical coil/.test(flat(await F.textContent())) && !(await saveBtn.isEnabled()));
  await shot('03-dup-same-grade');

  /* ── 3. A GRN coil and a manual coil with one batch (MIX-0777) ── */
  await typeBatch('MIX-0777');
  check('MIX-0777 (a GRN coil + a manual coil): nothing selected automatically', !(await cards()) && /2 coils carry this batch number/.test(await status()) && !(await saveBtn.isEnabled()));
  await openList();
  const mix = (await options().allInnerTexts()).map(flat).filter((t) => /Batch MIX-0777/.test(t));
  check('…the dropdown tells them apart: GRN-BE-C (JSL204-07, Gamma Steel) vs "Manual entry · no GRN" (JSL202-06)',
    mix.length === 2 && mix.some((t) => /GRN-BE-C/.test(t) && /JSL204-07/.test(t) && /Gamma Steel/.test(t))
      && mix.some((t) => /Manual entry · no GRN/.test(t) && /JSL202-06/.test(t) && /Remaining 700 kg/.test(t)), mix.join(' || '));
  await closeList();
  await pick('Manual entry · no GRN');
  f = await facts();
  check('picking the manual coil loads only it: 900 total · 200 cut · 700 remaining · 1 round · JSL202-06 locked',
    /Manual coil MIX-0777 · JSL202-06 · no GRN/.test(await manualBanner()) && /Total coil weight\s*900 kg/.test(f) && /Already cut\s*200 kg/.test(f)
      && /Remaining weight\s*700 kg/.test(f) && /1 previous round/.test(f) && (await total.inputValue()) === '900' && await total.isDisabled()
      && /JSL202-06/.test(await grade.inputValue()) && (await F.getByTestId('selected-coil').count()) === 0, f.slice(0, 120));
  await pick('GRN-BE-C');
  f = await facts();
  check('picking its GRN namesake instead: 800 kg · JSL204-07 · ₹182 · GRN-BE-C — the manual coil is gone from the form',
    /Total coil weight\s*800 kg/.test(f) && /GRN GRN-BE-C/.test(await banner()) && (await rate.inputValue()) === '182'
      && /JSL204-07/.test(await grade.inputValue()) && (await F.getByTestId('manual-coil-banner').count()) === 0, f.slice(0, 80));
  await pick('Manual entry · no GRN');
  await partial.check();
  await cutField.fill('100');
  await pickCircle(15, 85);
  await settle(400);
  check('a Partial 100 kg round on the MANUAL coil can be saved', await saveBtn.isEnabled() && /Manual coil MIX-0777/.test(await manualBanner()));
  check('…and saves', await save());

  /* ── 4. A short batch behind more than 25 look-alikes (A1) ── */
  await openCutForm();
  await typeBatch('A1');
  f = await facts();
  check('"A1" binds the exact coil A1 automatically — although 30 newer coils contain "A1"',
    /Existing received coil found/.test(await status()) && /GRN GRN-BE-D/.test(await banner()) && /Total coil weight\s*500 kg/.test(f)
      && (await rate.inputValue()) === '190', `${await status()} · ${f.slice(0, 40)}`);
  await openList();
  const a1 = (await options().allInnerTexts()).map(flat);
  check('…the dropdown still lists the look-alikes, with the exact coil first',
    /^Batch A1 ·/.test(a1[0] || '') && a1.filter((t) => /Batch A1\d\d/.test(t)).length >= 20, `${a1.length} options · first: ${(a1[0] || '').slice(0, 50)}`);
  await closeList();

  /* ── 5. Editing a bound batch, and a failed lookup ── */
  await partial.check();
  await cutField.fill('100');
  await pickCircle(20, 85);
  await settle(400);
  check('a complete round on A1 can be saved…', await saveBtn.isEnabled());
  await batch.fill('A1Z');
  check('…but the instant the batch is edited, the coil is released and Save is disabled',
    !(await saveBtn.isEnabled()) && !(await cards()) && (await rate.inputValue()) === '');
  await settle(2600);
  check('"A1Z" matches nothing: manual entry is offered, nothing is bound, Save stays disabled',
    /No matching coil\/GRN found\. Enter the coil details manually\./.test(await status()) && await total.isEnabled() && !(await saveBtn.isEnabled()), await status());

  await page.route((u) => u.toString().includes(PROBE), (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated lookup failure (e2e)' }),
  }));
  await typeBatch('DUP-0420');
  check('a FAILED lookup says so on the field', /Could not look this batch number up/.test(await status()), await status());
  check('…and leaves no coil details behind: no cards, no banner, no rate, round locked, Save disabled',
    !(await cards()) && (await F.getByTestId('selected-coil').count()) === 0 && (await rate.inputValue()) === ''
      && await partial.isDisabled() && !(await saveBtn.isEnabled()));
  check('…nor offers manual entry on a failed lookup (Total coil weight stays locked)', await total.isDisabled());
  await shot('05-failed-lookup');
  await page.unroute((u) => u.toString().includes(PROBE));
  await typeBatch('a1');
  f = await facts();
  check('after the failure, typing "a1" (any case) binds A1 again', /GRN GRN-BE-D/.test(await banner()) && /Total coil weight\s*500 kg/.test(f));
  check('…with a fresh round: no cutting type carried over', !(await partial.isChecked()) && !(await full.isChecked()));
  await partial.check();
  await cutField.fill('100');
  await settle(400);
  check('the A1 round (100 kg) saves against A1', await saveBtn.isEnabled() && await save());

  /* ── 6. Many partial matches, no exact one (B7) ── */
  await openCutForm();
  await typeBatch('B7');
  check('"B7": no coil is bound, the field offers the list or manual entry',
    !(await cards()) && /No coil has exactly this batch number — pick one from the list, or enter the coil details manually\./.test(await status()), await status());
  check('…manual entry is possible in the same form (Coil being cut and Total coil weight editable), Save disabled',
    await grade.isEnabled() && await total.isEnabled() && !(await saveBtn.isEnabled()));
  await openList();
  const b7 = (await options().allInnerTexts()).map(flat);
  check('…and the dropdown lists the partial matches (B700…), none chosen', b7.length >= 25 && b7.every((t) => /Batch B7\d\d/.test(t)) && !(await cards()), `${b7.length}`);
  await closeList();

  /* ── 7. A GRN batch that cannot be cut is never a new manual coil (NEG-55) ── */
  await typeBatch('NEG-55');
  check('"NEG-55" (on a GRN, nothing left on its ledger): the field says it is on goods receipt GRN-BE-E and cannot be entered manually',
    /Batch NEG-55 is on goods receipt GRN-BE-E .*cannot be entered manually/.test(await status()), await status());
  check('…Total coil weight stays locked — no new manual coil can be described', await total.isDisabled());
  await grade.click();
  await grade.fill('JSL204-10');
  await settle(500);
  await options().first().click();
  await settle(500);
  check('…even with a grade picked, the round stays locked and Save disabled', await partial.isDisabled() && !(await saveBtn.isEnabled()) && !(await cards()));
  await shot('07-grn-batch-blocked');

  /* ── 8. An intentionally blank batch ── */
  await batch.fill('');
  await settle(800);
  const noReceipt = F.getByRole('checkbox', { name: /No receipt available/i });
  check('a blank batch offers "No receipt available", unticked — and is not treated as batchless until ticked',
    (await noReceipt.count()) === 1 && !(await noReceipt.isChecked()) && await partial.isDisabled());

  const failed = results.filter((r) => !r.pass);
  const unexpectedApi = apiErrors.filter((e) => !e.includes(PROBE.replace('batchNo=', '')));
  const unexpectedConsole = consoleErrors.filter((c) => !/status of 500/.test(c));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`console errors: ${consoleErrors.length} (unexpected: ${unexpectedConsole.length})${unexpectedConsole.length ? `\n  ${unexpectedConsole.slice(0, 6).join('\n  ')}` : ''}`);
  console.log(`page errors: ${pageErrors.length}${pageErrors.length ? `\n  ${pageErrors.slice(0, 6).join('\n  ')}` : ''}`);
  console.log(`API errors (>=400): ${apiErrors.length} (expected — the simulated failure: ${apiErrors.length - unexpectedApi.length})${unexpectedApi.length ? `\n  ${unexpectedApi.slice(0, 6).join('\n  ')}` : ''}`);
  await browser.close();
  process.exit(failed.length || pageErrors.length || unexpectedApi.length || unexpectedConsole.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
