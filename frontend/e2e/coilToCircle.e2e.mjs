/**
 * Cut Coils — ONE Batch Number field identifies the coil, driven through the
 * real UI.
 *
 *   node e2e/coilToCircle.e2e.mjs
 *
 * Proves, on screen:
 *   • there is no mode selector and no separate GRN selector — one Batch
 *     Number field (typed, or picked from its own dropdown) — and the rest of
 *     the form is on screen before any coil;
 *   • a batch on one received coil is found and bound automatically (total /
 *     already cut / remaining, grade, rate, Received At from its GRN); a batch
 *     several coils match binds nothing until one is picked in the dropdown;
 *     the dropdown also searches GRN numbers and coil names;
 *   • a batch on no record opens manual entry in the same form; a blank batch
 *     offers "No receipt available", ticked on purpose;
 *   • a fully cut coil is found and cannot be cut again;
 *   • editing the batch releases the coil at once — Save is disabled while the
 *     new batch is looked up — and nothing stale is left behind;
 *   • a manual coil with no GRN is entered once (with its total weight), cut in
 *     three rounds across a page reload, and shows up in Cutting History, on
 *     its coil page and in Scrap by Physical Coil;
 *   • bad manual input cannot be saved;
 *   • the form is two steps and a footer — no "Check the balance" step: the
 *     checks it carried sit next to their inputs (circles, the over-cut
 *     switch), and Save / Cancel follow the circles — with Save's loading
 *     state, a refused save, a double-click, and the footer at desktop, laptop
 *     and phone sizes.
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
// While a save is answered by a stubbed failure on purpose, its 5xx is not an error.
let expectFailures = false;

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('console', (m) => { if (m.type() === 'error' && !expectFailures) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !expectFailures) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/.*\/api\/v1/, '')}`);
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

  // The page opens on its history; the form is a dialog opened from
  // "+ Coil to Circle", and closes after every successful save. Every form
  // control is looked up inside it — the page behind has its own filters.
  const F = page.getByTestId('coil-to-circle-dialog');
  const openCutForm = async () => {
    if (await F.count()) return;
    await page.getByTestId('open-coil-to-circle').click();
    await F.waitFor({ state: 'visible', timeout: 10000 });
    await settle(800);
  };
  check('the page opens on its history, with the form closed', (await page.getByTestId('cut-history-row').count()) > 0 && (await F.count()) === 0);
  await openCutForm();

  const batch = F.getByTestId('batch-input');
  const grade = F.getByRole('combobox', { name: /coil being cut/i }).first();
  const rate = F.getByLabel(/^rate/i).first();
  const receivedAt = F.getByLabel(/^received at/i).first();
  const cutField = F.getByLabel(/^cut this round/i).first();
  const total = F.getByTestId('manual-total-input');
  // textContent, not innerText: the tile labels are upper-cased by CSS, and
  // the assertions read the labels as written.
  const facts = () => F.getByTestId('coil-facts').first().textContent().then(flat);
  const saveBtn = F.getByRole('button', { name: /save this conversion/i });
  const options = () => page.locator('ul[role="listbox"] li[role="option"]');
  const receivedAtText = () => receivedAt.innerText().then(flat);
  // The Batch Number field's own status line (its helper text).
  const status = async () => flat(await F.getByTestId('batch-field').innerText());
  const openList = async () => { await batch.click(); await settle(800); };
  const closeList = async () => { if (await page.locator('ul[role="listbox"]').count()) await page.keyboard.press('Escape'); await settle(200); };
  const pickCircle = async (pcs, kg) => {
    const input = F.locator('table tbody tr').nth(0).locator('input[placeholder]').first();
    await input.click();
    await page.waitForTimeout(500);
    await options().first().click();
    await page.waitForTimeout(250);
    const row = F.locator('table tbody tr').nth(0);
    await row.locator('input[type="number"]').nth(0).fill(String(pcs));
    await row.locator('input[type="number"]').nth(1).fill(String(kg));
  };
  const clearBatch = async () => { await batch.fill(''); await settle(600); };
  // The four coil cards (Total coil weight / Already cut / Remaining weight /
  // Cutting status) exist only once a coil is identified.
  const cardsShown = async () => (await F.getByTestId('coil-facts').count()) > 0;
  /*
   * Every state the cards are RENDERED in, not just the final one: a
   * MutationObserver logs their text on each DOM change, so a previous coil's
   * figures flashing up for one render while the next coil loads is caught.
   */
  const startRecording = () => page.evaluate(() => {
    window.__factsLog = [];
    window.__factsObs?.disconnect();
    const read = () => {
      const t = (document.querySelector('[data-testid="coil-facts"]')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (window.__factsLog[window.__factsLog.length - 1] !== t) window.__factsLog.push(t);
    };
    read();
    window.__factsObs = new MutationObserver(read);
    window.__factsObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const recorded = () => page.evaluate(() => { window.__factsObs?.disconnect(); return window.__factsLog || []; });

  /* ── 0. ONE Batch Number field — no mode buttons, no GRN selector — and the full form ── */
  let formText = flat(await F.textContent());
  check('the old mode buttons are gone — no "Select Existing GRN / Received Coil", no "Manual Entry — No GRN"',
    (await F.getByTestId('mode-grn').count()) === 0 && (await F.getByTestId('mode-manual').count()) === 0
      && !/Select Existing GRN|Manual Entry — No GRN/.test(formText));
  check('…and so is the separate "Select GRN / Received Coil" dropdown',
    (await F.getByTestId('grn-coil-picker').count()) === 0 && !/Select GRN \/ Received Coil/.test(formText));
  check('one Batch Number field identifies the coil', (await F.getByTestId('batch-field').count()) === 1 && (await batch.count()) === 1);
  check('before any coil: the four cards are hidden entirely', !(await cardsShown()));
  check('the yellow warning panel stays gone: no "No physical coil chosen yet", no "Type the batch number above…", no "Coil has no GRN? …" link',
    !/No physical coil chosen yet/.test(formText) && !/Type the batch number above to find the coil/.test(formText)
      && !/Coil has no GRN\? Use Manual Entry/.test(formText));
  check('…its guidance is one line under the Batch Number field', /Type the batch number on the coil, or pick it from the list/.test(formText));
  const visible = async (loc) => (await loc.count()) > 0 && loc.first().isVisible();
  const fullForm = {
    'batch number': await visible(batch),
    'coil being cut': await visible(grade),
    'date cut': await visible(F.getByLabel(/^date cut/i)),
    'total coil weight': await visible(total),
    'received at': await visible(receivedAt),
    'scrap checked': await visible(F.getByRole('combobox', { name: /scrap checked/i })),
    rate: await visible(rate),
    'full cutting': await visible(F.getByRole('radio', { name: /full cutting/i })),
    'partial cutting': await visible(F.getByRole('radio', { name: /partial cutting/i })),
    'cut this round': await visible(cutField),
    'remaining weight / status': await visible(F.getByTestId('round-outcome')),
    'allow cutting more': await visible(F.getByText('Allow cutting more coil than we hold')),
    'circle output table': await visible(F.locator('table tbody tr input[placeholder]')),
    'add another circle size': await visible(F.getByRole('button', { name: /add another circle size/i })),
    cancel: await visible(F.getByRole('button', { name: /^cancel$/i })),
    save: await visible(saveBtn),
  };
  const missing = Object.entries(fullForm).filter(([, v]) => !v).map(([k]) => k);
  check('before any coil the FULL form is visible — every field, the round, the circle output and Save/Cancel',
    missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${Object.keys(fullForm).length} parts visible`);
  check('…with the round locked until a coil is identified: Full / Partial / "Cut this round" disabled, Save disabled',
    await F.getByRole('radio', { name: /full cutting/i }).isDisabled() && await F.getByRole('radio', { name: /partial cutting/i }).isDisabled()
      && await cutField.isDisabled() && !(await saveBtn.isEnabled()));

  /* ── 0z. No step 3: the form is the coil, the circles, and a Save / Cancel footer ── */
  check('step 3 "Check the balance" is gone — no heading, no balance bar, no Cut / Circle output / Scrap / Yield cards, no after-round cards',
    !/Check the balance/.test(formText) && !/usable circles from|to see the split/.test(formText)
      && (await F.getByTestId('this-round').count()) === 0 && (await F.getByTestId('after-round').count()) === 0
      && (await F.locator('.MuiLinearProgress-root').count()) === 0);
  const layout = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="coil-to-circle-form"]');
    const footer = form?.querySelector(':scope > [data-testid="form-footer"]');
    const btn = (re) => [...(footer?.querySelectorAll('button') || [])].find((b) => re.test(b.textContent.trim()));
    const save = btn(/^Save this conversion$/);
    const cancel = btn(/^Cancel$/);
    const r = (el) => el.getBoundingClientRect();
    const prev = footer?.previousElementSibling;
    return {
      parts: form?.children.length,
      footerLast: !!footer && form.lastElementChild === footer,
      afterCircles: !!prev && /What came out\?/.test(prev.textContent) && !!prev.querySelector('table'),
      both: !!save && !!cancel,
      sameRow: !!save && !!cancel && Math.abs(r(save).top - r(cancel).top) < 1,
      cancelThenSave: !!save && !!cancel && r(cancel).right <= r(save).left,
      rightAligned: !!save && Math.abs(r(save).right - r(footer).right) < 1.5,
    };
  });
  check('the form is two steps and a footer; the footer comes straight after the circle output',
    layout.parts === 3 && layout.footerLast && layout.afterCircles, JSON.stringify(layout));
  check('…holding Cancel then Save on one row, right-aligned', layout.both && layout.sameRow && layout.cancelThenSave && layout.rightAligned, JSON.stringify(layout));
  await shot('00-open');

  /* ── 0a. The dropdown with the box empty: received coils with weight left ── */
  await openList();
  const listed = await options().allInnerTexts();
  const batches = listed.map((t) => (t.match(/Batch (DEMO-CTC-[\w-]+)/) || [])[1]).filter(Boolean);
  check('the Batch Number dropdown lists eligible coils from the database', batches.length >= 5 && batches.includes('DEMO-CTC-003') && batches.includes('DEMO-CTC-005'), batches.join(', '));
  check('…never the fully cut DEMO-CTC-007', !batches.includes('DEMO-CTC-007'));
  check('…never the draft / cancelled / no-GRN probes', !batches.some((b) => /^DEMO-CTC-T-/.test(b)));
  check('…each option shows batch, coil, GRN number, supplier, date, location, original and remaining',
    listed.every((t) => /Batch DEMO-CTC-\d{3}/.test(t) && /DEMO-CTC-GRN-\d{3}/.test(t) && /Demo /.test(t) && /Received \d{2} \w{3} \d{4}/.test(t)
      && /at (PLG01|JW001)/.test(t) && /Original [\d,]+ kg/.test(t) && /Remaining [\d,]+ kg/.test(t)),
    flat(listed[0]));
  check('…a partly cut coil is marked as such', listed.some((t) => /DEMO-CTC-004/.test(t) && /partly cut/.test(t)));
  await shot('00a-dropdown-empty');
  await closeList();
  check('opening the list selects nothing by itself', !(await cardsShown()) && (await batch.inputValue()) === '');

  /* ── 0b. A blank batch: the existing batchless-coil rule ("No receipt available") ── */
  const noReceipt = F.getByRole('checkbox', { name: /No receipt available/i });
  check('with the batch blank, "No receipt available" is offered — unticked, saying what it does',
    (await noReceipt.count()) === 1 && !(await noReceipt.isChecked()) && /scrap cannot be traced/i.test(flat(await F.textContent())));
  check('…and a blank batch is NOT treated as batchless by itself: the round stays locked until it is ticked',
    await F.getByRole('radio', { name: /partial cutting/i }).isDisabled());
  await noReceipt.check();
  await settle(300);
  await grade.click();
  await grade.fill('JSL204-07');
  await settle(500);
  await options().first().click();
  await settle(600);
  check('ticked + a coil grade: the cut can be recorded without a coil — Partial only, no total weight, the batch box locked blank',
    !(await F.getByRole('radio', { name: /partial cutting/i }).isDisabled()) && await F.getByRole('radio', { name: /full cutting/i }).isDisabled()
      && await total.isDisabled() && await batch.isDisabled() && /will not be traceable to a coil/.test(flat(await F.textContent())));
  await noReceipt.uncheck();
  await settle(300);
  check('unticking it locks the round again and frees the batch box', await F.getByRole('radio', { name: /partial cutting/i }).isDisabled() && await batch.isEnabled());

  /* ── 1. A unique GRN batch, typed: found and bound automatically ── */
  await batch.fill('DEMO-CTC-004');
  check('typing a batch drops the "No receipt available" option (a batch is not batchless)', (await noReceipt.count()) === 0);
  await settle(2500);
  let f = await facts();
  check('typing DEMO-CTC-004 fetches the coil: 1,800 total · 700 already cut · 1,100 remaining',
    /1,800 kg/.test(f) && /Already cut\s*700 kg/.test(f) && /Remaining weight\s*1,100 kg/.test(f), f.slice(0, 160));
  check('…the status says an existing received coil was found', /Existing received coil found/.test(await status()), await status());
  check('…grade filled from its receipt (JSL202-08) — the grade picked before is not kept', /JSL202-08/.test(await grade.inputValue()), await grade.inputValue());
  check('…rate filled from its GRN (175)', (await rate.inputValue()) === '175', await rate.inputValue());
  check('…Received At filled from its GRN (JW001)', /JW001/.test(await receivedAtText()), await receivedAtText());
  check('…total coil weight shown from its receipt (1,800), read-only', (await total.inputValue()) === '1800' && await total.isDisabled());
  check('…and its GRN is named on the form (DEMO-CTC-GRN-004)', /GRN DEMO-CTC-GRN-004/.test(flat(await F.getByTestId('selected-coil').innerText())));
  await shot('01-batch-autofetch');

  /* ── 1a. Editing the batch releases the coil at once ── */
  await startRecording();
  await batch.fill('DEMO-CTC-005');
  check('typing a different batch hides the cards at once (the coil is still being looked up)', !(await cardsShown()));
  await settle(2500);
  f = await facts().catch(() => '');
  check('…then shows the NEW coil: 2,200 total · 0 cut · 2,200 remaining', /2,200 kg/.test(f) && /Already cut\s*0 kg/.test(f) && /Remaining weight\s*2,200 kg/.test(f), f.slice(0, 160));
  let log = await recorded();
  // log[0] is the screen before the switch began (DEMO-CTC-004, correctly shown then).
  check('…and DEMO-CTC-004\'s figures (1,800 / 700 / 1,100) were never rendered once the batch changed',
    !log.slice(1).some((t) => /1,800 kg|Already cut\s*700 kg|1,100 kg/.test(t)), log.map((t) => t.slice(0, 60) || '(hidden)').join(' → '));

  /* ── 1b. A batch on no record: manual entry in the same form ── */
  await startRecording();
  await batch.fill('DEMO-CTC-NO-SUCH');
  await settle(2500);
  check('a batch that finds no coil keeps the cards hidden', !(await cardsShown()));
  log = await recorded();
  check('…never falling back to the previous coil\'s figures', log.length > 1 && log.slice(1).every((t) => t === ''), log.map((t) => t.slice(0, 60) || '(hidden)').join(' → '));
  check('…DEMO-CTC-005 is released: no coil banner, its rate gone, round locked, nothing can be saved against it',
    (await F.getByTestId('selected-coil').count()) === 0 && (await rate.inputValue()) === ''
      && await F.getByRole('radio', { name: /partial cutting/i }).isDisabled() && !(await saveBtn.isEnabled()));
  check('…the field says so inline: "No matching coil/GRN found. Enter the coil details manually."',
    /No matching coil\/GRN found\. Enter the coil details manually\./.test(await status()), await status());
  check('…the coil details become editable in the same form (Coil being cut, Total coil weight) — no mode switch',
    await grade.isEnabled() && await total.isEnabled() && (await batch.inputValue()) === 'DEMO-CTC-NO-SUCH'
      && (await F.getByTestId('mode-manual').count()) === 0 && (await F.getByTestId('enter-manually').count()) === 0);
  check('…an unmatched batch is not a batchless coil: "No receipt available" is not offered', (await noReceipt.count()) === 0);
  check('…and nothing is created by the lookup itself: no cards, Save disabled', !(await cardsShown()) && !(await saveBtn.isEnabled()));
  await shot('01b-no-match-manual-fields');

  /* ── 1c. Several coils match: chosen inside the same dropdown ── */
  await batch.fill('DEMO-CTC-00');
  await settle(2500);
  check('a batch that only partly matches several coils binds none of them',
    !(await cardsShown()) && !(await saveBtn.isEnabled()) && (await F.getByTestId('selected-coil').count()) === 0);
  check('…and says to pick one from the list', /No coil has exactly this batch number — pick one from the list/.test(await status()), await status());
  await openList();
  const matchOpts = await options().allInnerTexts();
  const chosen = (flat(matchOpts[0]).match(/Batch (DEMO-CTC-\d{3})/) || [])[1];
  check('…the Batch Number dropdown offers exactly the matching coils', matchOpts.length >= 2 && matchOpts.every((t) => /Batch DEMO-CTC-00\d/.test(t)), matchOpts.map(flat).join(' | ').slice(0, 200));
  await shot('01c-batch-matches');
  await options().first().click();
  await settle(2500);
  check(`choosing ${chosen} binds it: its cards appear and the box shows its batch`,
    await cardsShown() && (await batch.inputValue()) === chosen && /Existing received coil found/.test(await status()), `${await batch.inputValue()} · ${await status()}`);

  /* ── 1d. A fully cut coil is found, says so, and cannot be cut again ── */
  await batch.fill('DEMO-CTC-007');
  await settle(2500);
  f = await facts().catch(() => '');
  check('a fully cut coil (DEMO-CTC-007) is still found: 1,000 total · 0 remaining · Fully cut', /1,000 kg/.test(f) && /Remaining weight\s*0 kg/.test(f) && /Fully cut/i.test(f), f.slice(0, 200));
  check('…the batch number says it is fully cut', /This coil is fully cut/.test(await status()));
  check('…Full cutting is disabled', await F.getByLabel(/full cutting/i).isDisabled());
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('10');
  await pickCircle(5, 8);
  await settle(400);
  check('…and a partial round is refused before the server ("Only 0 KG is available") — Save stays disabled',
    /Only 0 KG is available from this physical coil/.test(flat(await F.textContent())) && !(await saveBtn.isEnabled()));
  await F.locator('table tbody tr').nth(0).getByRole('button', { name: 'Clear this line' }).click();
  await settle(300);

  await batch.fill('DEMO-CTC-004');
  await settle(2500);
  f = await facts().catch(() => '');
  check('re-typing DEMO-CTC-004 brings its own cards back (1,800 total)', /1,800 kg/.test(f) && /Remaining weight\s*1,100 kg/.test(f), f.slice(0, 160));

  /* ── 2. The dropdown searches GRN numbers, coils and suppliers too ── */
  await F.getByRole('button', { name: /clear coil/i }).click();
  await settle(400);
  check('"Clear coil" hides the cards, empties the batch number, locks the round again and leaves Save disabled',
    !(await cardsShown()) && (await batch.inputValue()) === '' && await F.getByRole('radio', { name: /partial cutting/i }).isDisabled() && !(await saveBtn.isEnabled()));
  await batch.fill('Cu 0.80');
  await settle(2500);
  await openList();
  const cu = await options().allInnerTexts();
  check('searching by item name ("Cu 0.80") lists only that grade\'s coils', cu.length >= 1 && cu.every((t) => /JSL204-08/.test(t)), cu.map(flat).join(' | ').slice(0, 160));
  check('…and binds none of them on its own', !(await cardsShown()));
  await closeList();
  await batch.fill('DEMO-CTC-GRN-003');
  await settle(2500);
  await openList();
  const g3 = await options().allInnerTexts();
  check('searching by GRN number (DEMO-CTC-GRN-003) lists that GRN\'s coil', g3.length >= 1 && g3.some((t) => /Batch DEMO-CTC-003/.test(t)), g3.map(flat).join(' | ').slice(0, 160));
  check('…without selecting it (nothing selected yet)', !(await cardsShown()));
  await options().filter({ hasText: 'Batch DEMO-CTC-003' }).first().click();
  await settle(2500);
  check('the cards appear once that coil is picked', await cardsShown());
  f = await facts();
  check('picking DEMO-CTC-003 fills 1,500 total · 500 already cut · 1,000 remaining',
    /1,500 kg/.test(f) && /Already cut\s*500 kg/.test(f) && /Remaining weight\s*1,000 kg/.test(f), f.slice(0, 160));
  check('…the box now shows its batch (DEMO-CTC-003)', (await batch.inputValue()) === 'DEMO-CTC-003');
  check('…grade JSL202-06, rate 170, Received At PLG01',
    /JSL202-06/.test(await grade.inputValue()) && (await rate.inputValue()) === '170' && /PLG01/.test(await receivedAtText()),
    `${await grade.inputValue()} · ${await rate.inputValue()} · ${await receivedAtText()}`);
  await shot('02-picked-by-grn-number');

  /* ── 3. Switch to another coil by typing — nothing stale, no save in between ── */
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('123');
  await pickCircle(10, 3);
  await settle(400);

  /* ── 3a. What blocks a round is said next to its input, not in a step 3 ── */
  const row0 = F.locator('table tbody tr').nth(0);
  check('a 3 kg / 123 kg round can be saved, with the scrap advisory under the circles (not blocking)',
    await saveBtn.isEnabled() && /going to scrap/.test(flat(await F.getByTestId('low-yield-warning').innerText().catch(() => ''))));
  await row0.locator('input[type="number"]').nth(1).fill('130');
  await settle(300);
  const oc = flat(await F.getByTestId('over-cut-warning').innerText().catch(() => ''));
  check('circles heavier than the cut (130 kg out of 123 kg): "Metal cannot be created" under the circles, Save disabled',
    /The circles weigh 7kg more than the coil\. Metal cannot be created/.test(oc) && await saveBtn.isDisabled(), oc);
  await row0.locator('input[type="number"]').nth(1).fill('3');
  await row0.locator('input[type="number"]').nth(0).fill('');
  await settle(300);
  check('a circle weight with no piece count is flagged under the circles, Save disabled',
    /1 circle line has a weight but no piece count/.test(flat(await F.getByTestId('missing-pcs-warning').innerText().catch(() => ''))) && await saveBtn.isDisabled());
  await row0.locator('input[type="number"]').nth(0).fill('10');
  await cutField.fill('1200');
  await settle(300);
  check('1,200 kg off a coil with 1,000 kg left: refused on the field itself, Save disabled',
    /Only 1,000 KG is available from this physical coil/.test(flat(await F.textContent())) && await saveBtn.isDisabled());
  const allowOver = F.getByLabel('Allow cutting more coil than we hold');
  await allowOver.check();
  await settle(300);
  const od = flat(await F.getByTestId('overdrawn-warning').innerText().catch(() => ''));
  const odUnderSwitch = await page.evaluate(() => /Allow cutting more coil than we hold/.test(
    document.querySelector('[data-testid="overdrawn-warning"]')?.previousElementSibling?.textContent || ''));
  check('"Allow cutting more coil than we hold" lets it through, and the over-cut is spelled out right under that switch',
    await saveBtn.isEnabled() && /takes 1,200 KG but only 1,000 KG is available from this physical coil/.test(od) && /over by 200 KG/.test(od) && odUnderSwitch, od);
  await allowOver.uncheck();
  await cutField.fill('123');
  await settle(300);
  check('…switched off and back to 123 kg: no over-cut warning, Save enabled again',
    (await F.getByTestId('overdrawn-warning').count()) === 0 && await saveBtn.isEnabled());
  await shot('03a-inline-checks');

  check('a complete round on DEMO-CTC-003 can be saved…', await saveBtn.isEnabled());
  await startRecording();
  await batch.fill('DEMO-CTC-005');
  check('…but the instant the batch changes, Save is disabled (lookup pending — never saved against DEMO-CTC-003)', !(await saveBtn.isEnabled()));
  await settle(2500);
  f = await facts();
  check('switching to DEMO-CTC-005: 2,200 total · 0 cut · 2,200 remaining', /2,200 kg/.test(f) && /Already cut\s*0 kg/.test(f) && /Remaining weight\s*2,200 kg/.test(f), f.slice(0, 160));
  log = await recorded();
  check('…and from the moment it changed, DEMO-CTC-003\'s figures (1,500 / 500 / 1,000) were never rendered',
    log.slice(1).every((t) => !/1,500 kg|Already cut\s*500 kg|Remaining weight\s*1,000 kg/.test(t)), log.map((t) => t.slice(0, 60) || '(hidden)').join(' → '));
  check('…grade JSL204-10, rate 200, batch DEMO-CTC-005',
    /JSL204-10/.test(await grade.inputValue()) && (await rate.inputValue()) === '200' && (await batch.inputValue()) === 'DEMO-CTC-005');
  check('…the previous round is gone: no cutting type chosen, "Cut this round" empty',
    !(await F.getByLabel(/partial cutting/i).isChecked()) && !(await F.getByLabel(/full cutting/i).isChecked()) && (await cutField.inputValue()) === '');
  check('…and the previous coil\'s circle size was dropped (not approved for JSL204-10)',
    (await F.locator('table tbody tr').nth(0).locator('input[placeholder]').first().inputValue()) === '');
  await shot('03-switched');

  /* ── 4. Save a partial cut of a coil picked from the dropdown ── */
  await batch.fill('DEMO-CTC-0');
  await settle(2500);
  await openList();
  await options().filter({ hasText: 'Batch DEMO-CTC-003' }).first().click();
  await settle(2500);
  check('DEMO-CTC-003 picked from the Batch Number dropdown', (await batch.inputValue()) === 'DEMO-CTC-003' && await cardsShown());
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('250');
  await F.locator('table tbody tr').nth(0).locator('input[placeholder]').first().fill('');
  await pickCircle(700, 225);
  await settle(500);
  check('Save is enabled for a valid partial cut', await saveBtn.isEnabled());
  // Every POST /convert this save makes, failed or not, with its submission id.
  const convertBodies = [];
  const onConvert = (r) => { if (r.method() === 'POST' && /\/rm-ims\/convert$/.test(r.url())) convertBodies.push(r.postDataJSON()); };
  page.on('request', onConvert);
  // A refused save first (stubbed — it never reaches the server).
  expectFailures = true;
  await page.route('**/rm-ims/convert', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated refusal (e2e) — nothing saved' }),
  }));
  await saveBtn.click();
  await page.getByText(/Simulated refusal \(e2e\)/).first().waitFor({ timeout: 10000 }).catch(() => {});
  // The toast can land a render before the button leaves its saving state.
  for (let i = 0; i < 30 && !(await saveBtn.isEnabled()); i += 1) await page.waitForTimeout(100);
  const refused = {
    message: (await page.getByText(/Simulated refusal \(e2e\) — nothing saved/).count()) >= 1,
    open: (await F.count()) === 1,
    batch: await batch.inputValue(),
    cut: await cutField.inputValue(),
    partial: await F.getByLabel(/partial cutting/i).isChecked(),
    circleKg: await F.locator('table tbody tr').nth(0).locator('input[type="number"]').nth(1).inputValue(),
    saveEnabled: await saveBtn.isEnabled(),
  };
  check('a refused save shows the server\'s message and keeps the form open, every value as entered, Save enabled to retry',
    refused.message && refused.open && refused.batch === 'DEMO-CTC-003' && refused.cut === '250' && refused.partial
      && refused.circleKg === '225' && refused.saveEnabled, JSON.stringify(refused));
  await page.unroute('**/rm-ims/convert');
  expectFailures = false;
  // The real save, held back 1.5 s so its loading state can be read — and double-clicked.
  await page.route('**/rm-ims/convert', async (route) => { await new Promise((r) => { setTimeout(r, 1500); }); await route.continue(); });
  await saveBtn.dblclick();
  await page.waitForTimeout(300);
  check('while saving: Save is disabled with a spinner, Cancel and the dialog\'s Close are disabled',
    await saveBtn.isDisabled() && (await saveBtn.locator('.MuiCircularProgress-root').count()) === 1
      && await F.getByRole('button', { name: /^cancel$/i }).isDisabled() && await page.getByTestId('close-coil-to-circle').isDisabled());
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check('the cut saves', (await page.getByText(/Conversion .* saved/).count()) >= 1);
  await settle(1500);
  await page.unroute('**/rm-ims/convert');
  page.off('request', onConvert);
  check('…the double-click sent ONE save, reusing the refused attempt\'s submission id',
    convertBodies.length === 2 && !!convertBodies[0]?.clientRequestId && convertBodies[0].clientRequestId === convertBodies[1]?.clientRequestId,
    `${convertBodies.length} POST /convert`);
  check('…the form closes after saving', (await F.count()) === 0);
  await openCutForm();
  check('…and the next one starts empty (batch empty, no coil)', (await batch.inputValue()) === '' && !(await cardsShown()));
  await batch.fill('DEMO-CTC-003');
  await settle(2500);
  f = await facts();
  check('DEMO-CTC-003 now: 750 kg already cut, 750 kg remaining', /Already cut\s*750 kg/.test(f) && /Remaining weight\s*750 kg/.test(f), f.slice(0, 160));
  await clearBatch();
  check('clearing the batch number deselects the coil: cards hidden, no coil banner',
    !(await cardsShown()) && (await F.getByRole('button', { name: /clear coil/i }).count()) === 0);

  /* ── 5. A batch that is on a GRN is never a manual coil; a batch on no record is a NEW one ── */
  await batch.fill('DEMO-CTC-002');
  await settle(2500);
  f = await facts().catch(() => '');
  check('a GRN batch binds its GRN (2,500 total, JW001, rate 192) — its coil details are not editable as a manual coil',
    /2,500 kg/.test(f) && /JW001/.test(await receivedAtText()) && (await rate.inputValue()) === '192'
      && await total.isDisabled() && await grade.isDisabled() && (await F.getByTestId('manual-coil-banner').count()) === 0, f.slice(0, 80));
  await clearBatch();
  await batch.fill(MANUAL);
  await settle(2500);
  check('a new batch: "No matching coil/GRN found. Enter the coil details manually."',
    /No matching coil\/GRN found\. Enter the coil details manually\./.test(await status()), await status());
  check('…batch alone does not identify the coil: no cards', !(await cardsShown()));
  check('…no stale coil carried over (grade and total empty)', (await grade.inputValue()) === '' && (await total.inputValue()) === '');
  await grade.click();
  await grade.fill('JSL204-07');
  await settle(500);
  await options().first().click();
  await settle(600);
  check('…batch + coil, no total weight yet: still no cards', !(await cardsShown()));
  for (const bad of ['0', '-5']) {
    await total.fill(bad);
    await settle(300);
    check(`total coil weight "${bad}" is flagged and the round stays locked`,
      /number above 0 kg/.test(flat(await page.locator('body').innerText())) && await F.getByLabel(/partial cutting/i).isDisabled());
    check(`…and an invalid total ("${bad}") shows no cards`, !(await cardsShown()));
  }
  await total.fill('1500');
  await settle(600);
  check('batch + coil + a valid total: the cards appear', await cardsShown());
  f = await facts();
  check('with batch, coil and total: 1,500 total · 0 cut · 1,500 remaining', /1,500 kg/.test(f) && /Already cut\s*0 kg/.test(f) && /Remaining weight\s*1,500 kg/.test(f), f.slice(0, 160));
  check('the manual banner says it is a new manual coil with no GRN', /Manual coil DEMO-CTC-UI-M1 · JSL204-07 · no GRN/.test(await F.getByTestId('manual-coil-banner').innerText()));
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('1600');
  await settle(300);
  check('a round larger than the total coil weight is blocked', !(await saveBtn.isEnabled()));
  await cutField.fill('400');
  await pickCircle(1100, 360);
  await settle(400);
  check('the circle list offers only JSL204-07 sizes', /JSL204-07-/.test(await F.locator('table tbody tr').nth(0).locator('input[placeholder]').first().inputValue()));
  await shot('05-manual-round1-ready');
  await saveBtn.click();
  await page.getByText(/Manual coil DEMO-CTC-UI-M1 recorded at 1,500 kg/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check('round 1 saves and records the manual coil at 1,500 kg', (await page.getByText(/Manual coil DEMO-CTC-UI-M1 recorded at 1,500 kg/).count()) >= 1);
  await settle(1500);

  /* ── 6. Round 2 — the same manual coil, found by typing its batch (any case) ── */
  await openCutForm();
  await batch.fill(MANUAL.toLowerCase());
  await settle(2500);
  check('a manual coil already entered is found automatically by its batch', await cardsShown() && /Existing manual coil found \(no GRN\)/.test(await status()), await status());
  f = await facts();
  check('typing the batch again (any case) continues the coil: 1,500 · 400 cut · 1,100 remaining',
    /1,500 kg/.test(f) && /Already cut\s*400 kg/.test(f) && /Remaining weight\s*1,100 kg/.test(f), f.slice(0, 160));
  check('…total weight is locked to the stored 1,500 and the coil grade cannot change',
    (await total.inputValue()) === '1500' && await total.isDisabled() && await grade.isDisabled());
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('600');
  await pickCircle(1700, 545);
  await settle(400);
  await saveBtn.click();
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await settle(1500);

  /* ── 7. Reload — the coil and its history persist; picked from the dropdown, round 3 is FULL ── */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await settle(2500);
  await openCutForm();
  await batch.fill('DEMO-CTC-UI');
  await settle(2500);
  await openList();
  const mOpts = await options().allInnerTexts();
  check('the Batch Number dropdown also lists manual (no-GRN) coils', mOpts.some((t) => /Batch DEMO-CTC-UI-M1/.test(t) && /Manual entry · no GRN/.test(t)), mOpts.map(flat).join(' | ').slice(0, 200));
  await options().filter({ hasText: 'Batch DEMO-CTC-UI-M1' }).first().click();
  await settle(2500);
  check('picking it loads that manual coil', (await batch.inputValue()) === MANUAL
    && /Manual coil DEMO-CTC-UI-M1 · JSL204-07 · no GRN/.test(await F.getByTestId('manual-coil-banner').innerText().catch(() => '')));
  f = await facts();
  check('after a reload: 1,500 total · 1,000 cut · 500 remaining (2 rounds)',
    /1,500 kg/.test(f) && /Already cut\s*1,000 kg/.test(f) && /Remaining weight\s*500 kg/.test(f) && /2 previous rounds/.test(f), f.slice(0, 200));
  await F.getByLabel(/full cutting/i).check();
  await settle(300);
  check('Full cutting takes exactly the remaining 500 kg (read-only)', (await cutField.inputValue()) === '500');
  await pickCircle(1400, 455);
  await settle(400);
  await shot('07-manual-round3-full');
  await saveBtn.click();
  await page.getByText(/Conversion .* saved/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await settle(1800);
  await openCutForm();
  await batch.fill(MANUAL);
  await settle(2500);
  f = await facts();
  check('after the full round: 1,500 cut, 0 remaining, Fully cut', /Already cut\s*1,500 kg/.test(f) && /Remaining weight\s*0 kg/.test(f) && /Fully cut/i.test(f), f.slice(0, 200));
  check('Full cutting is no longer possible on it', await F.getByLabel(/full cutting/i).isDisabled());

  /* ── 8. Cutting History, coil page, Scrap by Physical Coil ── */
  const histRow = page.locator(`[data-testid="cut-history-row"][data-batch="${MANUAL}"]`);
  await histRow.waitFor({ timeout: 10000 }).catch(() => {});
  const hr = flat(await histRow.innerText().catch(() => ''));
  check('the history lists the manual coil as "Manual entry · No GRN" with 1,500 cut and 0 left',
    /Manual entry No GRN/.test(hr) && /1,500 1,500 .* 0 Fully cut 3 rounds$/.test(hr), hr.slice(0, 260));
  await F.getByTestId('manual-coil-banner').getByRole('button', { name: /view this coil's history/i }).click();
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

  /* ── 10. The dialog at desktop, laptop and phone sizes: Save / Cancel never clipped ── */
  const footerFit = () => page.evaluate(() => {
    const paper = document.querySelector('[data-testid="coil-to-circle-dialog"]');
    const content = paper.querySelector('.MuiDialogContent-root');
    const footer = paper.querySelector('[data-testid="form-footer"]');
    footer.scrollIntoView({ block: 'end' });
    const c = content.getBoundingClientRect();
    const b = [...footer.querySelectorAll('button')].map((x) => x.getBoundingClientRect());
    return {
      buttons: b.length,
      inside: b.every((x) => x.top >= c.top - 0.5 && x.bottom <= c.bottom + 0.5 && x.left >= c.left - 0.5 && x.right <= c.right + 0.5),
      inViewport: b.every((x) => x.left >= 0 && x.right <= window.innerWidth && x.bottom <= window.innerHeight),
      noSideScroll: document.documentElement.scrollWidth <= window.innerWidth && content.scrollWidth <= content.clientWidth,
      fullScreen: Math.abs(paper.getBoundingClientRect().width - window.innerWidth) < 1,
      sameRow: b.length === 2 && Math.abs(b[0].top - b[1].top) < 1,
      widths: b.map((x) => Math.round(x.width)),
      heights: b.map((x) => Math.round(x.height)),
      footerWidth: Math.round(footer.getBoundingClientRect().width),
    };
  });
  for (const [w, h] of [[1600, 1100], [1280, 720], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await go(`${APP}/rm-ims/conversion`);
    await settle(2000);
    await openCutForm();
    const fit = await footerFit();
    check(`${w}×${h}: Cancel and Save are reachable at the end of the form, inside the dialog and the window — never clipped`,
      fit.buttons === 2 && fit.inside && fit.inViewport && fit.sameRow, JSON.stringify(fit));
    check(`${w}×${h}: nothing scrolls sideways (the circle table scrolls inside its own box)`, fit.noSideScroll, JSON.stringify(fit));
    // Same height = neither label wrapped onto a second line.
    check(`${w}×${h}: both labels fit on one line`, fit.heights[0] === fit.heights[1] && fit.heights[1] < 44, JSON.stringify(fit));
    if (w < 600) {
      check('phone: the dialog is full screen; Cancel and Save fill the footer row, Save taking the rest of it',
        fit.fullScreen && fit.widths[1] > fit.widths[0] && fit.widths[0] + fit.widths[1] + 8 >= fit.footerWidth - 1, JSON.stringify(fit));
    }
    await page.screenshot({ path: path.join(SHOTS, `10-footer-${w}x${h}.png`) });
    if (w >= 600) {
      await page.getByTestId('close-coil-to-circle').click();
      await settle(500);
    }
  }
  // Usable, not only visible: a round entered and saved from the phone-width
  // footer. The save is answered by a stub, so the database this spec's
  // --verify reads is untouched.
  await batch.fill('DEMO-CTC-005');
  await settle(2500);
  await F.getByLabel(/partial cutting/i).check();
  await cutField.fill('100');
  await pickCircle(10, 90);
  await settle(400);
  expectFailures = true;
  await page.route('**/rm-ims/convert', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated outage (e2e, phone width)' }),
  }));
  await saveBtn.scrollIntoViewIfNeeded();
  check('phone: a complete round enables Save in the footer', await saveBtn.isEnabled());
  await saveBtn.click();
  await page.getByText(/Simulated outage \(e2e, phone width\)/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check('phone: Save submits (stubbed refusal shown) and keeps the entry',
    (await page.getByText(/Simulated outage \(e2e, phone width\)/).count()) >= 1 && (await cutField.inputValue()) === '100' && await saveBtn.isEnabled());
  await page.unroute('**/rm-ims/convert');
  expectFailures = false;
  await F.getByRole('button', { name: /^cancel$/i }).click();
  await settle(400);
  check('phone: Cancel asks before discarding what was entered', await page.getByTestId('discard-dialog').isVisible());
  await page.getByRole('button', { name: /^discard$/i }).click();
  await settle(500);
  check('…and Discard closes the form', (await F.count()) === 0);
  await shot('10-phone-after-cancel');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? `\n  ${consoleErrors.slice(0, 8).join('\n  ')}` : ''}`);
  console.log(`page errors: ${pageErrors.length}${pageErrors.length ? `\n  ${pageErrors.slice(0, 8).join('\n  ')}` : ''}`);
  console.log(`API errors (>=400): ${apiErrors.length}${apiErrors.length ? `\n  ${apiErrors.slice(0, 8).join('\n  ')}` : ''}`);
  await browser.close();
  process.exit(failed.length || pageErrors.length ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
