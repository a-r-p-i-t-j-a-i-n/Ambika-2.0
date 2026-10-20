/**
 * The complete business flow, driven through the real UI in Chromium.
 *
 *   node e2e/fullFlow.e2e.mjs
 *
 *   PO -> GRN (no stock) -> MD signature -> Incoming QC -> RM Stock -> batch lookup
 *      -> Cut Coils -> Circle stock -> Scrap -> Scrap by physical coil -> Movement history
 *
 * The coil's destination comes from its SKU (RM IMS) at the chosen Received At;
 * completing the GRN posts nothing — the accepted coil is stocked at QC.
 *
 * Follows grnRm.e2e.mjs and cutCoils.e2e.mjs: the playwright LIBRARY, not
 * @playwright/test, because that is what is installed. Every action below is
 * performed by the browser; backend/src/scripts/e2eFullFlowFixture.js --verify
 * is the database oracle, so no result rests on a success toast.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_e2e_fullflow scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';
import { combinedBtn, confirmCompleteGrn, signAndCompleteQc, stageText } from './_grnLifecycle.mjs';

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
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'fullFlow.e2e.mjs');
const API = 'http://127.0.0.1:5099/api/v1';
const USER = { email: 'fullflow-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

/**
 * The batch prefix and the purchase list are overridable, so the same flow that
 * tests with seeded POs can also build the visible demo on top of POs raised
 * through Purchase FMS:  BATCH_PREFIX=DEMO-COIL FLOW_CONFIG=<purchase json>
 */
const P = process.env.BATCH_PREFIX || 'E2E-COIL';
const B = (n) => `${P}-00${n}`;

/** The three purchases, transcribed from the brief — NOT imported from the
 *  fixture, so the UI is checked against the requirement rather than against
 *  the same constants that seeded the data. */
const DEFAULT_PURCHASES = [
  { po: 'PO-E2E-FF-001', supplier: 'E2E Demo Supplier 1', coil: 'JSL204-07', batch: B(1), qty: 2000, at: 'PLG01' },
  { po: 'PO-E2E-FF-002', supplier: 'E2E Demo Supplier 2', coil: 'JSL204-08', batch: B(2), qty: 2500, at: 'JW001' },
  { po: 'PO-E2E-FF-003', supplier: 'E2E Demo Supplier 3', coil: 'JSL202-06', batch: B(3), qty: 1500, at: 'PLG01' },
];
const PURCHASES = process.env.FLOW_CONFIG
  ? JSON.parse(fs.readFileSync(process.env.FLOW_CONFIG, 'utf8')).map((x) => ({
    po: x.poNumber, supplier: x.supplier, coil: x.coil, batch: x.batchNo, qty: x.qty, at: x.receivedAt,
  }))
  : DEFAULT_PURCHASES;

/** The cutting rounds. Circle codes are from the client's approved mapping. */
const ROUNDS = [
  { batch: B(1), coilKg: 800, circle: 'JSL204-07-700', pcs: 900, kg: 680, scrap: 120, yield: 85 },
  { batch: B(1), coilKg: 500, circle: 'JSL204-07-750', pcs: 560, kg: 425, scrap: 75, yield: 85 },
  { batch: B(2), coilKg: 1000, circle: 'JSL204-08-850', pcs: 1100, kg: 820, scrap: 180, yield: 82 },
  { batch: B(3), coilKg: 600, circle: 'JSL202-06-700', pcs: 700, kg: 510, scrap: 90, yield: 85 },
];

/** What "Scrap by physical coil" must end up showing. */
const EXPECTED_COILS = {
  [B(1)]: { received: '2,000', cut: '1,300', output: '1,105', scrap: '195', scrapPct: '15%', yld: '85', remaining: '700', rounds: '2' },
  [B(2)]: { received: '2,500', cut: '1,000', output: '820', scrap: '180', scrapPct: '18%', yld: '82', remaining: '1,500', rounds: '1' },
  [B(3)]: { received: '1,500', cut: '600', output: '510', scrap: '90', scrapPct: '15%', yld: '85', remaining: '900', rounds: '1' },
};

const results = [];
const section = (s) => { console.log(`\n── ${s} ──`); results.push({ section: s }); };
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};

const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];

const main = async () => {
  const exe = findChromium();
  console.log(`Chromium: ${exe || '(playwright default)'}`);
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 180)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 180)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400) {
      // 4xx from the deliberate negative probes are expected and tagged later.
      apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
    }
  });

  /** index.html's boot splash can outlive React's mount and swallow clicks. */
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
  const shot = (n) => { fs.mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/ff-${n}.png`, fullPage: true }).catch(() => {}); };

  const combo = (label) => page.getByRole('combobox', { name: new RegExp(label, 'i') }).first();
  const comboText = async (label) => (await combo(label).textContent() || '').trim();
  const pickSelect = async (label, optionText) => {
    await combo(label).click();
    await page.getByRole('option', { name: optionText }).click();
    await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
  };
  const body = () => page.locator('body').innerText();

  /* ══ Login ══ */
  section('Login');
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true, page.url().replace(APP, '') || '/');

  /* ══ PART 1 — Purchase orders are visible ══ */
  section('Part 1 — Purchase / PO');
  await go(`${APP}/procurement/purchase-orders`);
  await page.waitForTimeout(2500);
  const poBody = await body();
  for (const p of PURCHASES) {
    check(`${p.po} is listed`, poBody.includes(p.po));
  }
  await shot('01-purchase-orders');

  /* ══ PART 2 — Raise + complete a GRN for each purchase ══ */
  const grnIds = {};
  for (const p of PURCHASES) {
    section(`Part 2 — GRN for ${p.po} (${p.coil} / ${p.batch} / ${p.at})`);

    await go(`${APP}/procurement/grns`);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
    await page.waitForTimeout(1200);

    const dlg = page.getByRole('dialog');
    // Pick the PO — the GRN form only lists POs that are READY_FOR_GRN.
    await page.getByRole('combobox', { name: /purchase order/i }).first().click();
    await page.waitForTimeout(900);
    const optCount = await page.getByRole('option', { name: new RegExp(p.po) }).count();
    check(`${p.po} is offered as GRN-eligible`, optCount > 0, `${optCount} option(s)`);
    await page.getByRole('option', { name: new RegExp(p.po) }).first().click();
    await page.waitForTimeout(1400);

    // The ordered quantity must have come across from the PO.
    check(`the GRN line carries ${p.qty} from the PO`,
      (await dlg.innerText()).replace(/\s+/g, ' ').includes(String(p.qty)),
      (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 120));

    // Batch Number is mandatory for a Coil line.
    const batchField = dlg.getByLabel(/^Batch No/).first();
    check('the Coil row demands a Batch No', (await dlg.getByLabel(/Batch No \*/).count()) > 0);
    await batchField.fill(p.batch);

    // No manual Inventory Type: the coil's SKU sends it to RM IMS, and Received
    // At (where it physically landed) is asked for automatically — never pre-filled.
    check('no Inventory Type; the coil line shows → RM IMS', (await dlg.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0
      && (await dlg.getByTestId('grn-line-destination').allInnerTexts()).some((t) => /RM IMS/.test(t)));
    check('Received At is asked for and not pre-filled', (await dlg.getByRole('combobox', { name: /Received At/i }).count()) > 0 && !/PLG01|JW001/.test(await comboText('Received At')));
    await pickSelect('Received At', new RegExp(p.at));
    check(`Received At is set to ${p.at}`, new RegExp(p.at).test(await comboText('Received At')));
    await shot(`02-grn-form-${p.batch}`);

    await dlg.getByRole('button', { name: /^Save as Draft$/ }).click();
    await page.waitForTimeout(3500);
    check('the GRN is created as a draft', (await page.getByText(/created \(draft\)/i).count()) > 0);

    // Resolve it by PO through the API — hunting a paginated list is brittle
    // and list filtering is not what is under test here.
    const id = await page.evaluate(async ({ api, po }) => {
      const res = await fetch(`${api}/procurement/grns?limit=100&sort=-createdAt`, {
        headers: { authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then((r) => r.json()).catch(() => null);
      return (res?.data || []).find((g) => g.poNumber === po)?._id || '';
    }, { api: API, po: p.po });
    check('the new GRN is retrievable', !!id, id || 'not found');
    if (!id) continue;
    grnIds[p.batch] = id;

    // ── Complete the GRN: receipt final, NO stock yet ──
    await go(`${APP}/procurement/grns/${id}`);
    await page.waitForSelector('#grn-qc-section', { timeout: 15000 });
    await page.waitForTimeout(1200);
    await combinedBtn(page).click();
    await page.waitForTimeout(900);
    check(`the dialog inherits Received At = ${p.at} from the form`,
      new RegExp(p.at).test(await comboText('Received At')), await comboText('Received At'));
    await shot(`03-grn-complete-${p.batch}`);
    await confirmCompleteGrn(page);
    const stockAfterGrn = (await page.getByTestId('grn-line-stock').allInnerTexts()).join(' ');
    check('completed — Awaiting MD Signature; the coil is Awaiting QC, not stock', (await stageText(page)) === 'Awaiting MD Signature'
      && /Awaiting QC/.test(stockAfterGrn), stockAfterGrn.replace(/\s+/g, ' '));

    // ── MD signs, Incoming QC accepts the coil → stock ──
    check('MD signs, QC completes (accept all)', (await signAndCompleteQc(page)) === 'QC Completed · Passed');
    const stockAfterQc = (await page.getByTestId('grn-line-stock').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
    check(`…the coil is now RM stock at ${p.at}`, new RegExp(`RM IMS · ${p.at} Posted `).test(stockAfterQc), stockAfterQc);
    await shot(`04-grn-completed-${p.batch}`);
  }

  /* ══ PART 3 — RM stock shows all three coils ══ */
  section('Part 3 — RM Stock');
  await go(`${APP}/rm-ims/stock`);
  await page.waitForTimeout(3000);
  const stockBody = (await body()).replace(/\s+/g, ' ');
  for (const p of PURCHASES) {
    check(`${p.coil} appears in RM stock`, stockBody.includes(p.coil));
  }
  await shot('05-rm-stock');

  /* ══ PART 4 — Batch lookup + Cut Coils ══ */
  // Cut Coils opens on its history; the form is a dialog opened from
  // "+ Coil to Circle", so every form control is looked up inside it.
  const F = page.getByTestId('coil-to-circle-dialog');
  const openCutForm = async () => {
    if (await F.count()) return;
    await page.getByTestId('open-coil-to-circle').click();
    await F.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);
  };
  const circleInput = (row) => F.locator('table tbody tr').nth(row).locator('input[placeholder]').first();
  const openCircleOptions = async (row) => {
    await circleInput(row).click();
    await page.waitForTimeout(700);
    const opts = await page.locator('ul[role="listbox"] li[role="option"]').allInnerTexts().catch(() => []);
    return opts;
  };
  const closeMenu = async () => { if (await page.locator('ul[role="listbox"], .MuiAutocomplete-popper').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(200); };

  for (const [i, r] of ROUNDS.entries()) {
    const p = PURCHASES.find((x) => x.batch === r.batch);
    section(`Part 4/6 — Cut ${r.batch} round (${r.coilKg} kg -> ${r.circle})`);
    await go(`${APP}/rm-ims/conversion`);
    await page.waitForTimeout(2500);
    await openCutForm();

    // Batch lookup — identify the physical coil.
    await F.getByLabel(/batch number/i).first().fill(r.batch);
    await page.waitForTimeout(3200);
    const idBody = (await body()).replace(/\s+/g, ' ');
    check(`${r.batch} identifies a received coil`, /kg available to cut/.test(idBody),
      (idBody.match(/Cutting coil[^|]{0,70}/) || [''])[0]);
    check('…and it is the right coil', idBody.includes(r.batch));
    // "No receipt available" must NOT be needed — this is the traceable path,
    // where it is not even offered.
    check('the untraceable fallback is not in play on the GRN path',
      (await F.getByRole('checkbox', { name: /No receipt available/i }).count()) === 0);
    await shot(`06-cut-${r.batch}-${i}-identified`);

    // The circle dropdown must offer only this coil's approved sizes.
    const opts = await openCircleOptions(0);
    const codes = opts.map((t) => (t.match(/[A-Z]{2,}\d[\w-]*/) || [''])[0]).filter(Boolean);
    check('the circle dropdown offers only this coil family',
      codes.length > 0 && codes.every((c) => c.startsWith(p.coil)),
      codes.join(', ') || '(none)');
    const wanted = page.locator('ul[role="listbox"] li[role="option"]', { hasText: r.circle }).first();
    if (await wanted.count()) await wanted.click();
    else await page.locator('ul[role="listbox"] li[role="option"]').first().click();
    await page.waitForTimeout(400);
    check(`${r.circle} can be selected`, (await circleInput(0).inputValue()).includes(r.circle),
      await circleInput(0).inputValue());

    const row0 = F.locator('table tbody tr').nth(0);
    await row0.locator('input[type="number"]').nth(0).fill(String(r.pcs));
    await row0.locator('input[type="number"]').nth(1).fill(String(r.kg));
    // A linked coil asks for the cutting type first; this run types the weight.
    await F.getByRole('radio', { name: /partial cutting/i }).first().check();
    await F.getByLabel(/^cut this round/i).first().fill(String(r.coilKg));
    await page.waitForTimeout(900);

    // No "Check the balance" step: the round's cut is beside its field, and a
    // scrap share above 15% (yield under 85%) is flagged under the circles.
    const outcome = (await F.getByTestId('round-outcome').innerText()).replace(/\s+/g, ' ');
    check(`the round takes ${r.coilKg} kg (After this round)`, new RegExp(`Cut this round ${r.coilKg.toLocaleString('en-IN')} kg`, 'i').test(outcome), outcome);
    const lowYield = (await F.getByTestId('low-yield-warning').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(r.yield < 85 ? `the ${r.scrap} kg scrap (${100 - r.yield}%) is flagged before saving` : 'no scrap advisory at 85% yield',
      r.yield < 85 ? lowYield.startsWith(`${100 - r.yield}% of this coil is going to scrap`) : lowYield === '', lowYield);
    await shot(`07-cut-${r.batch}-${i}-ready`);

    await F.getByRole('button', { name: /save this conversion/i }).click();
    const saved = await page.getByText(/saved against coil|conversion .*saved|cut saved/i).first()
      .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    check('the conversion saves', saved);
    const savedMsg = (await page.getByText(/Conversion .* saved — yield/).last().innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(`…with yield ${r.yield}% (worked out by the server)`, savedMsg.includes(`yield ${r.yield}%`), savedMsg);
    await page.waitForTimeout(1200);
    await shot(`08-cut-${r.batch}-${i}-saved`);
  }

  /* ══ PART 8 — Scrap by physical coil ══ */
  section('Part 8 — Scrap by physical coil');
  await go(`${APP}/scrap-ims/by-coil`);
  await page.waitForSelector(`table tbody tr:has-text("${B(1)}")`, { timeout: 30000 });
  await page.waitForTimeout(600);
  const sbBody = (await body()).replace(/\s+/g, ' ');
  check('three coils are traced', /3\s+coils traced/.test(sbBody), (sbBody.match(/\d+ coils traced/) || [''])[0]);

  const rows = await page.$$eval('table tbody tr', (rs) => rs
    .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.trim()))
    .filter((c) => c.length >= 12));
  check('the table has exactly 3 physical coils', rows.length === 3, `got ${rows.length}`);
  await shot('09-scrap-by-coil');

  for (const [batch, e] of Object.entries(EXPECTED_COILS)) {
    const row = rows.find((c) => c[1]?.includes(batch));
    if (!row) { check(`${batch} row is on screen`, false, 'not found'); continue; }
    const cell = (n) => (row[n] || '').replace(/\s+/g, ' ').trim();
    check(`${batch} received = ${e.received}`, cell(3).startsWith(e.received), cell(3));
    check(`${batch} cut = ${e.cut}`, cell(4).startsWith(e.cut), cell(4));
    check(`${batch} output = ${e.output}`, cell(5).startsWith(e.output), cell(5));
    check(`${batch} scrap = ${e.scrap}`, cell(6).startsWith(e.scrap), cell(6));
    check(`${batch} scrap % = ${e.scrapPct}`, cell(7) === e.scrapPct, cell(7));
    check(`${batch} yield = ${e.yld}%`, cell(8).includes(e.yld), cell(8));
    check(`${batch} remaining = ${e.remaining}`, cell(9).startsWith(e.remaining), cell(9));
    check(`${batch} rounds = ${e.rounds}`, cell(10) === e.rounds, cell(10));
  }

  /* ══ PART 7 — the two-round coil, drilled into ══ */
  section(`Part 7 — Multiple cutting rounds (${B(1)})`);
  await page.click(`table tbody tr:has-text("${B(1)}")`);
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const lin = (await body()).replace(/\s+/g, ' ');
  check('the coil page opens', /\/rm-ims\/coil\//.test(page.url()));
  check(`it names ${B(1)}`, lin.includes(B(1)));
  check('no other test coil leaks in',
    !lin.includes(B(2)) && !lin.includes(B(3)));
  check('arrival weight 2,000 kg is shown', /2,000/.test(lin));
  const roundRows = await page.$$eval('table tbody tr', (rs) => rs
    .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.trim()))
    .filter((c) => c.length > 2).map((c) => c.join(' | ')));
  check('two cutting rounds are listed', roundRows.length >= 2, `${roundRows.length} rows`);
  check('round 1 shows 800 cut / 680 output / 120 scrap',
    roundRows.some((t) => t.includes('800') && t.includes('680') && t.includes('120')), roundRows[0]);
  check('round 2 shows 500 cut / 425 output / 75 scrap',
    roundRows.some((t) => t.includes('500') && t.includes('425') && t.includes('75')), roundRows[1]);
  check('round 1 precedes round 2',
    roundRows.findIndex((t) => t.includes('800')) < roundRows.findIndex((t) => t.includes('500')));
  check('remaining after round 2 is 700', roundRows.some((t) => t.includes('700')));
  await shot('10-coil-lineage');

  /* ══ PART 11 — Movement history ══ */
  section('Part 11 — Movement history');
  await go(`${APP}/rm-ims/movements`);
  await page.waitForTimeout(2800);
  const search = page.locator('input[placeholder*="Search"], input[type="search"]').first();
  if (await search.count()) {
    await search.fill(B(1));
    await page.waitForTimeout(2200);
  }
  // The screen speaks business, not ledger: CONVERT_OUT reads "Coil cut up"
  // and CONVERT_IN reads "Circles produced". Assert what the operator sees.
  const mvBody = (await body()).replace(/\s+/g, ' ');
  const count = (rx) => (mvBody.match(rx) || []).length;
  check('the GRN receipt is listed', /Vendor receipt/i.test(mvBody));
  check('…carrying its GRN reference', /GRN-\d+/i.test(mvBody));
  check('both coil cuts are listed', count(/Coil cut up/gi) === 2, `${count(/Coil cut up/gi)} found`);
  check('both circle outputs are listed', count(/Circles produced/gi) === 2, `${count(/Circles produced/gi)} found`);
  check('every row keeps the batch number', count(new RegExp(B(1), 'g')) >= 5, `${count(new RegExp(B(1), 'g'))} rows`);
  check('the ledger closes at 700 kg remaining', /\b700\b/.test(mvBody));
  check('both conversions are referenced', /RMC-001/.test(mvBody) && /RMC-002/.test(mvBody));
  await shot('11-movements');

  // SCRAP_IN lives in the Scrap module, not RM — the offcut is a different SKU.
  await go(`${APP}/scrap-ims/movements`);
  await page.waitForTimeout(2800);
  // This page names the CUT (conversion reference), not the batch — so assert
  // on references and quantities, which is what the operator reads here.
  const scrapMvBody = (await body()).replace(/\s+/g, ' ');
  const scrapRows = await page.$$eval('table tbody tr', (rs) => rs
    .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.trim()).join(' | '))
    .filter((t) => /RMC-/.test(t)));
  check('three SCRAP_IN movements — one per in-house cut', scrapRows.length === 3, `${scrapRows.length} rows`);
  check('coil 1 round 1 offcut +120 kg (RMC-001)', scrapRows.some((t) => /\+120/.test(t) && /RMC-001/.test(t)));
  check('coil 1 round 2 offcut +75 kg (RMC-002)', scrapRows.some((t) => /\+75/.test(t) && /RMC-002/.test(t)));
  check('coil 3 offcut +90 kg', scrapRows.some((t) => /\+90/.test(t)));
  check('job-work cut (coil 2, 180 kg at JW001) posted NO scrap stock',
    !scrapRows.some((t) => /\+180/.test(t) || /JW001/.test(t)), scrapRows.join(' / '));
  check('scrap on hand = 195 + 90 = 285 kg', /285 kg/.test(scrapMvBody));
  await shot('11b-scrap-movements');

  /* ══ PART 10 — negative, in the UI ══ */
  section('Part 10 — Negative scenarios (UI)');
  const apiErrorsBefore = apiErrors.length;
  await go(`${APP}/rm-ims/conversion`);
  await page.waitForTimeout(2500);
  await openCutForm();
  await F.getByLabel(/batch number/i).first().fill('NO-SUCH-BATCH-ZZZ');
  await page.waitForTimeout(3200);
  const negBody = (await body()).replace(/\s+/g, ' ');
  check('A. an unknown batch identifies no coil', !/kg available to cut/.test(negBody));
  check('A. the Batch Number field says no coil/GRN has that batch and asks for the coil details in the same form',
    /No matching coil\/GRN found\. Enter the coil details manually\./i.test(negBody)
      && await F.getByRole('combobox', { name: /coil being cut/i }).first().isEnabled() && await F.getByTestId('manual-total-input').isEnabled());
  const saveDisabled = await F.getByRole('button', { name: /save this conversion/i }).isDisabled();
  check('A. saving is blocked while no coil is identified', saveDisabled);
  // An unmatched batch is a NEW (traceable) coil, never a batchless one.
  const noReceipt = F.getByRole('checkbox', { name: /No receipt available/i });
  check('C. "No receipt available" is never inferred from a failed lookup — not offered while a batch is typed',
    (await noReceipt.count()) === 0);
  await F.getByLabel(/batch number/i).first().fill('');
  await page.waitForTimeout(600);
  check('C. …and for a coil with no batch number it is an explicit, unticked choice',
    (await noReceipt.count()) === 1 && (await noReceipt.isChecked()) === false);
  await shot('12-negative-unknown-batch');

  // D. duplicate GRN completion
  const firstGrn = grnIds[B(1)];
  if (firstGrn) {
    await go(`${APP}/procurement/grns/${firstGrn}`);
    await page.waitForTimeout(2200);
    const canComplete = (await page.getByRole('button', { name: /^Complete GRN$/ }).count()) + (await page.getByRole('button', { name: 'Complete GRN + QC' }).count());
    check('D. a completed (and QC-ed) GRN offers no second "Complete GRN"', canComplete === 0,
      `${canComplete} button(s)`);
    await shot('13-negative-duplicate-grn');
  }
  const negApiErrors = apiErrors.length - apiErrorsBefore;

  /* ══ Errors ══ */
  section('Errors');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no unexpected API errors outside the negative probes',
    apiErrors.length - negApiErrors === 0, apiErrors.slice(0, 5).join(' | '));

  await browser.close();
  const named = results.filter((r) => r.name);
  const failed = named.filter((r) => !r.pass);
  console.log(`\n${named.length - failed.length}/${named.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  console.log(`pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length} apiErrors=${apiErrors.length} (negative probes: ${negApiErrors})`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
