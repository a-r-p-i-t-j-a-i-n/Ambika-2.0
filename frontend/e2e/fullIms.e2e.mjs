/**
 * FULL IMS lifecycle, driven through the real UI:
 *   Purchase (indent/PO, created by the REAL chain in --seed) → GRN → RM stock
 *   → batch lookup → Cut Coils (Partial / Full / multi-round / stale Full)
 *   → Cutting History → Scrap Register → Scrap by Physical Coil → Scrap Movement
 *   → Scrap Out (existing + new buyer, KG / Quintal / Ton) → Scrap Out History.
 *
 *   node e2e/fullIms.e2e.mjs
 *
 * Order: backend/src/scripts/e2eFullImsFixture.js --seed, --api, --rollback,
 * then this, then --verify (the database oracle). Nothing here is asserted
 * from a toast alone; --verify re-derives every figure from the ledger.
 *
 * Expects (started separately, AWS_* variables BLANK so no PDF reaches S3):
 *   backend  :5099  against mongodb://127.0.0.1:27018/ambika_e2e_full_ims (replica set)
 *   frontend :3100  with VITE_API_URL=http://127.0.0.1:5099/api/v1
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
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'fullIms.e2e.mjs');
const API = 'http://127.0.0.1:5099/api/v1';
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SHOTS, 'full-ims-manifest.json'), 'utf8'));
const USER = MANIFEST.user;
const BACKEND_DIR = path.resolve('..', 'backend');

const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();

const results = [];
const section = (s) => console.log(`\n── ${s} ──`);
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
};
const consoleErrors = [];
const pageErrors = [];
const apiErrors = [];

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
  });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (u) => { await page.goto(`${APP}${u}`, { waitUntil: 'domcontentloaded' }); await ready(); };
  const shot = (n) => { fs.mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/fullims-${n}.png`, fullPage: true }).catch(() => {}); };
  const body = async () => flat(await page.locator('body').innerText());
  /** Wait (up to `ms`) until the page text matches — cold Vite pages compile on first visit. */
  const waitText = async (rx, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (rx.test(await body())) return true; await page.waitForTimeout(400); }
    return false;
  };
  const toast = (rx, ms = 20000) => page.getByText(rx).first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
  const combo = (label) => page.getByRole('combobox', { name: new RegExp(label, 'i') }).first();
  const apiGet = (p) => page.evaluate(async ({ api, p: q }) => fetch(`${api}${q}`, {
    headers: { authorization: `Bearer ${localStorage.getItem('token')}` },
  }).then((r) => r.json()).catch(() => null), { api: API, p });

  /* ══ Login ══ */
  section('Login');
  await go('/');
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true);

  const ui = MANIFEST.purchases.filter((p) => p.ui);

  /* ══ Purchase: indent + PO screens ══ */
  section('Purchase — indents and POs (created by the real chain in --seed)');
  await go('/procurement/indents');
  for (const p of ui) check(`indent ${MANIFEST.pos[p.key].indentNumber} is listed`, await waitText(new RegExp(rxEsc(MANIFEST.pos[p.key].indentNumber))));
  await shot('01-indents');
  await go('/procurement/purchase-orders');
  for (const p of ui) check(`PO ${MANIFEST.pos[p.key].poNumber} (${p.vendor}) is listed`, await waitText(new RegExp(rxEsc(MANIFEST.pos[p.key].poNumber))));
  await shot('02-purchase-orders');

  /* ══ GRN ══ */
  const grnIds = {};
  for (const p of ui) {
    const po = MANIFEST.pos[p.key].poNumber;
    section(`GRN — ${po} · ${p.lines[0].sku} · ${p.batch} · ${p.at}`);
    await go('/procurement/grns');
    await waitText(/GRN/);
    await page.getByRole('button', { name: /new grn|create grn|^grn$/i }).first().click();
    await page.waitForTimeout(1200);
    const dlg = page.getByRole('dialog');
    await page.getByRole('combobox', { name: /purchase order/i }).first().click();
    await page.waitForTimeout(900);
    const opt = page.getByRole('option', { name: new RegExp(rxEsc(po)) });
    check(`${po} is offered as GRN-eligible`, (await opt.count()) > 0);
    await opt.first().click();
    await page.waitForTimeout(1400);
    const dlgText = flat(await dlg.innerText());
    check(`the line comes across from the PO (${p.lines[0].qty} ${p.lines[0].sku})`, dlgText.includes(String(p.lines[0].qty)) || dlgText.includes(p.lines[0].qty.toLocaleString('en-IN')), dlgText.slice(0, 140));
    check('the coil line marks Batch No as required', (await dlg.getByLabel(/Batch No \*/).count()) > 0);
    // Inventory Type replaced the "Add to RM Stock" checkbox: "Raw Material (RM)"
    // sends the coil to RM stock, at the "Received At" asked for only then.
    check('Received At is not asked for before an Inventory Type is chosen', (await dlg.getByRole('combobox', { name: /Received At/i }).count()) === 0);
    await combo('Inventory Type').click();
    await page.getByRole('option', { name: 'Raw Material (RM)', exact: true }).click();
    await page.waitForTimeout(200);
    // Batch is mandatory: saving stays refused without it.
    await combo('Received At').click();
    await page.getByRole('option', { name: new RegExp(p.at) }).click();
    await page.waitForTimeout(200);
    // The form's submit is "Save GRN" (it then stays open for Incoming QC).
    await dlg.getByRole('button', { name: /^save grn$/i }).click();
    await page.waitForTimeout(1500);
    check('creating without a batch number is refused', (await page.getByText(/created \(draft\)/i).count()) === 0
      && /batch/i.test(flat(await page.locator('body').innerText())));
    await dlg.getByLabel(/^Batch No/).first().fill(p.batch);
    check(`Received At = ${p.at} and Inventory Type = Raw Material (RM) on the form`,
      new RegExp(p.at).test(flat(await combo('Received At').textContent())) && /Raw Material \(RM\)/.test(flat(await combo('Inventory Type').textContent())));
    await shot(`03-grn-form-${p.key}`);
    await dlg.getByRole('button', { name: /^save grn$/i }).click();
    check('GRN created as a draft', await toast(/created \(draft\)/i));
    const list = await apiGet('/procurement/grns?limit=100&sort=-createdAt');
    const g = (list?.data || []).find((x) => x.poNumber === po);
    check('the new GRN is retrievable', !!g, g?.grnNumber);
    if (!g) continue;
    grnIds[p.key] = g._id;
    check('no stock exists for the batch before completion', !(await apiGet(`/rm-ims/received-coils?q=${p.batch}&includeConsumed=true`))?.data?.length);

    await go(`/procurement/grns/${g._id}`);
    await waitText(new RegExp(rxEsc(g.grnNumber)));
    await page.getByRole('button', { name: /complete & post stock/i }).first().click();
    await page.waitForTimeout(900);
    check('completion inherits Inventory Type = Raw Material (RM) from the GRN', /Raw Material \(RM\)/.test(flat(await combo('Inventory Type').textContent())));
    check(`completion inherits Received At = ${p.at} (not the completion date)`, new RegExp(p.at).test(flat(await combo('Received At').textContent())));
    await page.getByRole('button', { name: /complete & post stock/i }).last().click();
    check('completion reports RM stock updated', await toast(/RM stock updated successfully/i));
    check(`…at ${p.at}`, (await page.getByText(new RegExp(`at ${p.at}`, 'i')).count()) > 0);
    await page.waitForTimeout(1200);
    const detail = await body();
    check('GRN detail shows the batch and the location', detail.includes(p.batch) && detail.includes(p.at));
    check('…and no second "Complete & post stock" is possible', (await page.getByRole('button', { name: /complete & post stock/i }).count()) === 0);
    await shot(`04-grn-done-${p.key}`);
  }

  /* ══ RM stock + batch lookup ══ */
  section('RM stock and batch lookup');
  await go('/rm-ims/stock');
  for (const c of ['JSL204-07', 'JSL204-08', 'JSL202-06']) check(`${c} is in RM stock`, await waitText(new RegExp(c)));
  await shot('05-rm-stock');
  const coils = await apiGet('/rm-ims/received-coils?q=E2E-FULL-COIL&limit=50&includeConsumed=true');
  for (const p of ui) {
    const c = (coils?.data || []).find((x) => x.batchNo === p.batch);
    check(`${p.batch}: ${p.lines[0].qty.toLocaleString('en-IN')} kg ${p.lines[0].sku} at ${p.at}, GRN + supplier`,
      c && c.receivedWeight === p.lines[0].qty && c.availableWeight === p.lines[0].qty && c.warehouse === p.at && c.skuCode === p.lines[0].sku && /GRN/.test(c.grnNumber) && c.supplier === p.vendor,
      JSON.stringify(c && [c.receivedWeight, c.availableWeight, c.warehouse, c.grnNumber, c.supplier]));
  }
  await go('/rm-ims/stock-in');
  await page.waitForTimeout(1500);
  await page.getByLabel('Batch number').first().fill('E2E-FULL-COIL-002');
  await page.waitForTimeout(2500);
  check('Stock In: an existing batch auto-fills its Received At (JW001)', /JW001/.test(flat(await combo('Received At').textContent())));
  check('…and its item', /JSL204-08|Cu 0\.80/.test(await page.locator('input[placeholder="Search a coil or circle…"]').first().inputValue()));
  await go('/rm-ims/stock-in');
  await page.waitForTimeout(1500);
  await page.locator('input[placeholder="Search a coil or circle…"]').first().fill('JSL204-07');
  await page.waitForTimeout(1200);
  await page.getByRole('option').first().click();
  await page.waitForTimeout(400);
  await page.getByLabel('Batch number').first().fill('E2E-FULL-COIL-002');
  await page.waitForTimeout(2500);
  check('Stock In: an existing batch on the WRONG SKU is reported', (await page.getByText(/belongs to JSL204-08/i).count()) > 0);
  check('…and does NOT auto-fill the other coil', /JSL204-07|Cu 0\.70/.test(await page.locator('input[placeholder="Search a coil or circle…"]').first().inputValue()));
  await shot('06-stockin-wrong-sku');

  /* ══ Cut Coils ══ */
  await go('/rm-ims/conversion');
  await waitText(/Coil to Circle history/);
  // The page opens on its history; the form is a dialog opened from
  // "+ Coil to Circle" that closes after every save. Form controls are looked
  // up inside it, and picking a batch reopens it when needed.
  const F = page.getByTestId('coil-to-circle-dialog');
  const openCutForm = async () => {
    if (await F.count()) return;
    await page.getByTestId('open-coil-to-circle').click();
    await F.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);
  };
  await openCutForm();
  const batch = F.getByLabel(/batch number/i).first();
  const cutField = F.getByLabel(/^cut this round/i).first();
  const fullRadio = F.getByRole('radio', { name: /full cutting/i });
  const partialRadio = F.getByRole('radio', { name: /partial cutting/i });
  const saveBtn = F.getByRole('button', { name: /save this conversion/i });
  const facts = async () => flat(await F.getByTestId('coil-facts').innerText());
  // The round before saving: "After this round", beside the field. Scrap and
  // yield are read from the history once saved (there is no step 3).
  const outcome = async () => flat(await F.getByTestId('round-outcome').innerText());
  const historyRow = (b) => page.locator(`[data-testid="cut-history-row"][data-batch="${b}"]`);
  const circleInput = (i) => F.locator('table tbody tr').nth(i).locator('input[placeholder]').first();
  const circleCodes = async (i) => {
    await circleInput(i).click();
    await page.waitForTimeout(600);
    const o = await page.locator('ul[role="listbox"] li[role="option"]').allInnerTexts();
    await page.keyboard.press('Escape');
    return o.map((t) => (t.match(/JSL\d+-\d+-\d+/) || [''])[0]).filter(Boolean);
  };
  const fillCircles = async (circles) => {
    for (let i = 0; i < circles.length; i += 1) {
      const [code, pcs, kg] = circles[i];
      if (i > 0 && (await F.locator('table tbody tr').nth(i).locator('input[placeholder]').count()) === 0) {
        await F.getByRole('button', { name: /add another circle size/i }).click();
        await page.waitForTimeout(300);
      }
      await circleInput(i).click();
      await page.waitForTimeout(500);
      await page.locator('ul[role="listbox"] li[role="option"]').filter({ hasText: code }).first().click();
      await page.waitForTimeout(250);
      const row = F.locator('table tbody tr').nth(i);
      await row.locator('input[type="number"]').nth(0).fill(String(pcs));
      await row.locator('input[type="number"]').nth(1).fill(String(kg));
    }
    await page.waitForTimeout(500);
  };
  const pickBatch = async (b) => { await openCutForm(); await batch.fill(''); await page.waitForTimeout(400); await batch.fill(b); await page.waitForTimeout(3200); };
  const save = async () => { await saveBtn.click(); return toast(/Conversion .* saved/i); };

  section('Cut Coils — the coil list and the mapping');
  const coilBox = F.getByRole('combobox', { name: /coil being cut/i }).first();
  await coilBox.click();
  await coilBox.fill('QA-E2E');
  await page.waitForTimeout(600);
  check('the unmapped QA raw material is NOT offered as a coil to cut', (await page.locator('ul[role="listbox"] li[role="option"]').count()) === 0);
  await page.keyboard.press('Escape');
  await coilBox.fill('');

  const R = MANIFEST.rounds;
  /* ── Coil 1, round 1: Partial 1,000 kg, two circle sizes ── */
  section('Coil 1 (E2E-FULL-COIL-001, 2,000 kg PLG01) — round 1, Partial');
  await pickBatch('E2E-FULL-COIL-001');
  let f = await facts();
  check('Total 2,000 · Already cut 0 · Remaining 2,000 · Not cut', /Total coil weight 2,000 kg/i.test(f) && /Already cut 0 kg/i.test(f) && /Remaining weight 2,000 kg/i.test(f) && /Cutting status Not cut/i.test(f), f);
  check('neither cutting type is selected yet', !(await fullRadio.isChecked()) && !(await partialRadio.isChecked()));
  check('the approved circles for JSL204-07 — and only those', JSON.stringify(await circleCodes(0)) === JSON.stringify(['JSL204-07-700', 'JSL204-07-750', 'JSL204-07-840']));
  await partialRadio.check();
  await cutField.fill(String(R.C1[0].cut));
  await fillCircles(R.C1[0].circles);
  let o = await outcome();
  check('after: Partial · Cut this round 1,000 · Remaining 1,000 · Partially cut', await partialRadio.isChecked() && /Cut this round 1,000 kg Remaining weight 1,000 kg Status Partially cut/i.test(o), o);
  await shot('07-c1-r1');
  check('round 1 saves', await save());
  await page.waitForTimeout(1500);
  let hr = flat(await historyRow('E2E-FULL-COIL-001').innerText().catch(() => ''));
  check('history: 2,000 · 1,000 cut · 850 · 150 · 85% · 1,000 left · Partially cut · PLG01 · 1 round', /PLG01 · Plant 2,000 1,000 [\d,]+ 850 150 85% 1,000 Partially cut 1 round$/.test(hr), hr);

  /* ── Coil 1, round 2: Full ── */
  section('Coil 1 — round 2, Full');
  await pickBatch('E2E-FULL-COIL-001');
  f = await facts();
  check('Total 2,000 · Already cut 1,000 · Remaining 1,000 · Partially cut', /Total coil weight 2,000 kg/i.test(f) && /Already cut 1,000 kg 1 previous round/i.test(f) && /Remaining weight 1,000 kg/i.test(f) && /Partially cut/i.test(f), f);
  await fullRadio.check();
  await page.waitForTimeout(300);
  check('Full fills Cut this round = 1,000 automatically, read-only', (await cutField.inputValue()) === '1000' && !(await cutField.isEditable()));
  await fillCircles(R.C1[1].circles);
  o = await outcome();
  check('after: Full · Remaining 0 · Fully cut', await fullRadio.isChecked() && /Cut this round 1,000 kg Remaining weight 0 kg Status Fully cut/i.test(o), o);
  check('round 2 saves', await save());
  await page.waitForTimeout(1500);
  hr = flat(await historyRow('E2E-FULL-COIL-001').innerText().catch(() => ''));
  check('history: 2,000 cut · 1,720 · 280 · weighted 86% · 0 left · Fully cut · 2 rounds', /PLG01 · Plant 2,000 2,000 [\d,]+ 1,720 280 86% 0 Fully cut 2 rounds$/.test(hr), hr);
  await historyRow('E2E-FULL-COIL-001').click();
  await page.waitForTimeout(1500);
  let rr = (await page.getByTestId('cut-round-row').allInnerTexts()).map(flat);
  // Both rounds were cut at PLG01, which the coil row already says — so the
  // rounds carry no Location column (`$`: nothing after the status).
  check('round 1: Partial · 1,000 · 850 · 150 · 85% · 1,000 left · Partial', /^1 \S+ \S+ Partial 1,000 kg 850 kg 150 kg 85% 1,000 kg Partial$/.test(rr[0] || ''), rr[0]);
  check('round 2: Full · 1,000 · 870 · 130 · 87% · 0 left · Fully cut', /^2 \S+ \S+ Full 1,000 kg 870 kg 130 kg 87% 0 kg Fully cut$/.test(rr[1] || ''), rr[1]);
  await shot('08-c1-history');
  await historyRow('E2E-FULL-COIL-001').click();
  await pickBatch('E2E-FULL-COIL-001');
  check('a fully cut coil: Full cutting is disabled', await fullRadio.isDisabled());

  /* ── Coil 2 (JW001), two Partial rounds ── */
  section('Coil 2 (E2E-FULL-COIL-002, 2,500 kg JW001) — job work');
  await pickBatch('E2E-FULL-COIL-002');
  check('Received At follows the coil\'s GRN: JW001', /JW001/.test(flat(await combo('Received At').textContent())));
  check('switching coil refreshes the circles to JSL204-08\'s six', JSON.stringify(await circleCodes(0)) === JSON.stringify(['JSL204-08-700', 'JSL204-08-825', 'JSL204-08-850', 'JSL204-08-889', 'JSL204-08-900', 'JSL204-08-978']));
  await partialRadio.check();
  await cutField.fill('1000');
  await fillCircles(R.C2[0].circles);
  o = await outcome();
  check('round 1: Cut this round 1,000 · Remaining 1,500 · Partially cut', /Cut this round 1,000 kg Remaining weight 1,500 kg Status Partially cut/i.test(o), o);
  // 820 of 1,000 kg out: the 18% to scrap is flagged under the circles, not blocking.
  check('round 1: 820 kg out of 1,000 — "18% of this coil is going to scrap", Save enabled',
    /^18% of this coil is going to scrap/.test(flat(await F.getByTestId('low-yield-warning').innerText().catch(() => ''))) && await saveBtn.isEnabled());
  check('JW001 round 1 saves', await save());
  await page.waitForTimeout(1200);
  await pickBatch('E2E-FULL-COIL-002');
  f = await facts();
  check('round 2: Already cut 1,000 · Remaining 1,500', /Already cut 1,000 kg/i.test(f) && /Remaining weight 1,500 kg/i.test(f), f);
  await partialRadio.check();
  await cutField.fill('500');
  await fillCircles(R.C2[1].circles);
  o = await outcome();
  check('after: Remaining 1,000 · Partially cut', /Remaining weight 1,000 kg Status Partially cut/i.test(o), o);
  check('JW001 round 2 saves', await save());
  await page.waitForTimeout(1500);
  hr = flat(await historyRow('E2E-FULL-COIL-002').innerText().catch(() => ''));
  check('history: 2,500 · 1,500 cut · 1,230 · 270 (with job worker) · 82% · 1,000 left · Partially cut · JW001 · 2', /JW001 · Job work 2,500 1,500 [\d,]+ 1,230 270 with job worker 82% 1,000 Partially cut 2 rounds$/.test(hr), hr);

  /* ── Coil 3: Partial, then a STALE Full, then the real Full ── */
  section('Coil 3 (E2E-FULL-COIL-003, 1,500 kg PLG01) — stale Full');
  await pickBatch('E2E-FULL-COIL-003');
  await partialRadio.check();
  await cutField.fill('1000');
  await fillCircles(R.C3[0].circles);
  check('coil 3 round 1 (Partial 1,000) saves', await save());
  await page.waitForTimeout(1200);
  await pickBatch('E2E-FULL-COIL-003');
  await fullRadio.check();
  await page.waitForTimeout(300);
  check('the form loads Remaining 500 and Full = 500', (await cutField.inputValue()) === '500' && /Remaining weight 500 kg/i.test(await facts()));
  await fillCircles([['JSL202-06-725', 400, 340]]);
  // Someone else cuts 100 kg off this coil while this form sits open.
  const behind = execFileSync('node', ['src/scripts/e2eFullImsFixture.js', '--behind'], { cwd: BACKEND_DIR, env: process.env, encoding: 'utf8' });
  check('another round (100 kg) was saved behind this form', /"ok":true/.test(behind), (behind.match(/\{.*\}/) || [''])[0]);
  const convsBefore = (await apiGet('/rm-ims/conversions?limit=200'))?.meta?.conversionCount;
  await saveBtn.click();
  check('the STALE Full is refused: "now has 400 KG remaining, not 500 KG"', await toast(/now has 400 KG remaining, not 500 KG/));
  const convsAfter = (await apiGet('/rm-ims/conversions?limit=200'))?.meta?.conversionCount;
  check('…and nothing was saved for it', convsBefore === convsAfter, `${convsBefore} → ${convsAfter}`);
  await shot('09-c3-stale-full-refused');
  await pickBatch('E2E-FULL-COIL-003');
  f = await facts();
  check('re-entering the batch shows the truth: Already cut 1,100 (2 rounds) · Remaining 400', /Already cut 1,100 kg 2 previous rounds/i.test(f) && /Remaining weight 400 kg/i.test(f), f);
  await fullRadio.check();
  await page.waitForTimeout(300);
  check('Full now = 400', (await cutField.inputValue()) === '400');
  await fillCircles(R.C3[2].circles);
  check('the corrected Full (400) saves', await save());
  await page.waitForTimeout(1500);
  hr = flat(await historyRow('E2E-FULL-COIL-003').innerText().catch(() => ''));
  check('history: 1,500 · 1,500 cut · 1,275 · 225 · 85% · 0 left · Fully cut · 3 rounds', /PLG01 · Plant 1,500 1,500 [\d,]+ 1,275 225 85% 0 Fully cut 3 rounds$/.test(hr), hr);
  await historyRow('E2E-FULL-COIL-003').click();
  await page.waitForTimeout(1500);
  rr = (await page.getByTestId('cut-round-row').allInnerTexts()).map(flat);
  check('its rounds in order: Partial 1,000 · Partial 100 · Full 400', /^1 \S+ \S+ Partial 1,000 kg/.test(rr[0] || '') && /^2 \S+ \S+ Partial 100 kg/.test(rr[1] || '') && /^3 \S+ \S+ Full 400 kg .* 0 kg Fully cut/.test(rr[2] || ''), rr.join(' | '));
  await shot('10-history-final');

  /* ══ Scrap screens ══ */
  const convList = (await apiGet('/rm-ims/conversions?limit=200'))?.data || [];
  // Oldest first — the API lists newest first.
  const convNo = (b) => convList.filter((c) => c.batchNo === b)
    .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt)).map((c) => c.conversionNumber);
  section('Scrap Register');
  await go('/scrap-ims/records');
  check('Scrap Register lists the PLG01 coils\' cuts', await waitText(/E2E-FULL-COIL-001/) && (await body()).includes('E2E-FULL-COIL-003'));
  check('…and the JW001 coil, as job work (not Ambika stock)', (await body()).includes('E2E-FULL-COIL-002') && /Job work/i.test(await body()));
  await shot('11-scrap-register');

  /* ── Every value on the Register, against the database behind it ── */
  section('Scrap Register — displayed values vs the database');
  const regRows = (await apiGet('/scrap-ims/overview?limit=200&page=1'))?.data || [];
  const fmtN = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fmtD = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const LOC = { PLG01: 'Plant', JW001: 'Job work' };
  // The Register's own vocabulary (scrapImsMeta DISPOSITION_TOKENS): PENDING → "Not checked".
  const DISP = { PENDING: /^Not checked$/i, DONE: /^Verified$/i };
  const regUi = async () => (await page.$$eval('table tbody tr', (rs) => rs.map((r) => [...r.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()))))
    .filter((c) => c.length >= 11 && /E2E-FULL/.test(c[2] || ''));
  let regView = await regUi();
  check(`the Register shows one row per cutting round (${regRows.length})`, regView.length === regRows.length && regRows.length === 10, `${regView.length} on screen, ${regRows.length} in the DB`);
  const mismatches = [];
  for (const r of regRows) {
    const row = regView.find((c) => c[2] === r.batchNo && c[5] === `${fmtN(r.coilWeightKg)} kg` && c[7] === `${fmtN(r.scrapKg)} kg`);
    if (!row) { mismatches.push(`${r.batchNo} ${r.coilWeightKg}/${r.scrapKg}: no matching row`); continue; }
    const want = {
      date: fmtD(r.scrapDate), coil: r.coilSkuCode, where: LOC[r.location], circles: `${fmtN(r.circlesWeightKg)} kg`, yield: `${fmtN(r.yieldRatioPct)}%`,
    };
    if (row[1] !== want.date) mismatches.push(`${r.batchNo}: date ${row[1]} ≠ ${want.date}`);
    if (!row[3].includes(want.coil)) mismatches.push(`${r.batchNo}: coil ${row[3]}`);
    if (!row[4].includes(want.where)) mismatches.push(`${r.batchNo}: where ${row[4]} ≠ ${want.where}`);
    if (row[6] !== want.circles) mismatches.push(`${r.batchNo}: circles ${row[6]} ≠ ${want.circles}`);
    if (!row[8].includes(want.yield)) mismatches.push(`${r.batchNo}: yield ${row[8]} ≠ ${want.yield}`);
    if (!(DISP[r.disposition] || /./).test(row[9])) mismatches.push(`${r.batchNo}: checked? ${row[9]} for ${r.disposition}`);
    if (!/cut/i.test(row[10])) mismatches.push(`${r.batchNo}: cut? ${row[10]}`);
  }
  check('every row: date, batch, coil, location, coil kg, circles kg, scrap kg, yield, checked, cut = the database', mismatches.length === 0, mismatches.slice(0, 4).join(' | '));
  check('S.No. runs 1…n', regView.every((c, i) => c[0] === String(i + 1)), regView.map((c) => c[0]).join(','));
  await combo('Where').click();
  await page.getByRole('option', { name: /JW001/ }).click();
  await page.waitForTimeout(1500);
  regView = await regUi();
  check('filter Where = JW001 → only the job-work coil\'s 2 rounds, shown as Job work', regView.length === 2 && regView.every((c) => c[2] === 'E2E-FULL-COIL-002' && /Job work/.test(c[4])), regView.map((c) => c[2]).join(','));
  await combo('Where').click();
  await page.getByRole('option').first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Search by batch, coil code or name…').fill('E2E-FULL-COIL-001');
  await page.waitForTimeout(1500);
  regView = await regUi();
  check('search by batch → exactly coil 1\'s 2 rounds', regView.length === 2 && regView.every((c) => c[2] === 'E2E-FULL-COIL-001'), regView.map((c) => c[2]).join(','));
  await page.getByPlaceholder('Search by batch, coil code or name…').fill('NO-SUCH-BATCH-XYZ');
  await page.waitForTimeout(1500);
  check('a search with no match shows the empty state, not a blank table', /No scrap records match these filters/.test(await body()));
  check('pagination counts the filtered set', /0–0 of 0|0-0 of 0/.test(await body()));
  await shot('11b-scrap-register-empty-search');

  section('Scrap by Physical Coil');
  await go('/scrap-ims/by-coil');
  await waitText(/E2E-FULL-COIL-001/);
  const coilRow = async (b) => flat(await page.locator('tr', { hasText: b }).first().innerText().catch(() => ''));
  let cr = await coilRow('E2E-FULL-COIL-001');
  check('coil 1: received 2,000 · cut 2,000 · output 1,720 · scrap 280 · remaining 0 · 2 rounds · supplier', /2,000/.test(cr) && /1,720/.test(cr) && /\b280\b/.test(cr) && /E2E Full Supplier 1/.test(cr) && / 2 /.test(` ${cr} `), cr);
  cr = await coilRow('E2E-FULL-COIL-002');
  check('coil 2 (JW001): cut 1,500 · output 1,230 · remaining 1,000', /1,500/.test(cr) && /1,230/.test(cr) && /1,000/.test(cr), cr);
  await page.locator('tr', { hasText: 'E2E-FULL-COIL-001' }).first().click();
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 15000 }).catch(() => {});
  const c1Convs = convNo('E2E-FULL-COIL-001');
  await waitText(new RegExp(rxEsc(c1Convs[0] || '§§')));
  const lineageText = await body();
  check('opening coil 1 shows its own lineage page with both rounds, in order',
    /\/rm-ims\/coil\//.test(page.url()) && c1Convs.length === 2 && c1Convs.every((n) => lineageText.includes(n))
      && lineageText.indexOf(c1Convs[0]) < lineageText.indexOf(c1Convs[1]), `${page.url()} ${c1Convs.join(',')}`);
  const roundRow = async (conv) => flat(await page.locator('tr', { hasText: conv }).first().innerText().catch(() => ''));
  const lr1 = await roundRow(c1Convs[0]);
  const lr2 = await roundRow(c1Convs[1]);
  check('lineage round 1: cut 1,000 · circles 850 · scrap 150 · 1,000 left', /1,000/.test(lr1) && /\b850\b/.test(lr1) && /\b150\b/.test(lr1), lr1);
  check('lineage round 2: cut 1,000 · circles 870 · scrap 130 · 0 left', /1,000/.test(lr2) && /\b870\b/.test(lr2) && /\b130\b/.test(lr2), lr2);
  // JW001: its own coil page — two rounds, at the job worker.
  await go('/scrap-ims/by-coil');
  await waitText(/E2E-FULL-COIL-002/);
  await page.locator('tr', { hasText: 'E2E-FULL-COIL-002' }).first().click();
  await page.waitForURL(/\/rm-ims\/coil\//, { timeout: 15000 }).catch(() => {});
  const c2Convs = convNo('E2E-FULL-COIL-002');
  await waitText(new RegExp(rxEsc(c2Convs[0] || '§§')));
  const jwRowsText = [await roundRow(c2Convs[0]), await roundRow(c2Convs[1])];
  check('JW001 coil page: both rounds shown at the job worker (Job work), 180 and 90 kg calculated scrap',
    jwRowsText.every((t) => /Job work/i.test(t)) && /\b180\b/.test(jwRowsText[0]) && /\b90\b/.test(jwRowsText[1]), jwRowsText.join(' | '));
  await shot('12-scrap-by-coil-lineage');

  section('Scrap Movement');
  await go('/scrap-ims/movements');
  await waitText(/SCRAP|Scrap/);
  const plgConvs = [...convNo('E2E-FULL-COIL-001'), ...convNo('E2E-FULL-COIL-003')];
  // The screen pages at 25, so the ledger behind it is read in full through
  // its own endpoint, and then a sample is searched for on the screen itself.
  const mvAll = (await apiGet('/scrap-ims/movements?limit=200&page=1'))?.data || [];
  const inRefs = new Set(mvAll.filter((m) => m.txnType === 'SCRAP_IN').map((m) => m.refNumber));
  check('every PLG01 cut (coil 1 ×2, coil 3 ×3) has its SCRAP_IN in Scrap Movement', plgConvs.length === 5 && plgConvs.every((n) => inRefs.has(n)), plgConvs.filter((n) => !inRefs.has(n)).join(','));
  check('NO JW001 cut has a SCRAP_IN', convNo('E2E-FULL-COIL-002').every((n) => !inRefs.has(n)));
  const mvSearch = page.locator('[data-testid="scrap-mv-search"]');
  await mvSearch.fill(plgConvs[0]);
  check(`searching the screen for ${plgConvs[0]} shows its SCRAP_IN`, await waitText(new RegExp(`${rxEsc(plgConvs[0])}`), 8000));
  await shot('13-scrap-movements');
  await mvSearch.fill(convNo('E2E-FULL-COIL-002')[0] || '§');
  await page.waitForTimeout(1500);
  const jwRows = (await page.$$eval('table tbody tr', (rs) => rs.map((r) => r.innerText))).filter((x) => x.includes('RMC'));
  check('searching for a JW001 conversion shows no scrap movement', jwRows.length === 0, jwRows.join(' | '));
  await mvSearch.fill('');

  /* ══ Scrap Out ══ */
  section('Scrap Out — buyers, units, history');
  await go('/scrap-ims/scrap-out');
  await waitText(/Scrap Out History/);
  // The figure loads after the page; "0" is only the placeholder before it does.
  await waitText(/Available at PLG01: [1-9][\d,]* kg/);
  const avail = (await body()).match(/Available at PLG01: ([\d,]+) kg/)?.[1];
  check('Available at PLG01 = 3,690 kg (3,000 opening + 700 from PLG01 cuts − 10 disposed)', avail === '3,690', avail);
  const qtyBox = () => page.locator('[data-testid="scrap-out-qty"]');
  const issueBtn = () => page.getByRole('button', { name: /issue scrap/i });
  const pickUnit = async (label) => { await page.locator('[data-testid="scrap-out-uom"]').click(); await page.getByRole('option', { name: label, exact: true }).click(); await page.waitForTimeout(250); };
  const buyerBox = () => page.getByRole('combobox', { name: /Sold to \/ Buyer/ });
  const searchBuyer = async (term) => { await buyerBox().click(); await buyerBox().fill(term); await page.waitForTimeout(1000); };

  // 1) existing buyer, 500 KG
  await searchBuyer('E2E Existing');
  const ex = page.getByRole('option', { name: /E2E Existing Buyer/ });
  check('an existing buyer is selectable', (await ex.count()) > 0);
  await ex.first().click();
  await pickUnit('KG');
  await qtyBox().fill('500');
  await page.getByLabel(/^Reference/).fill('INV-E2E-FULL-1');
  await issueBtn().click();
  check('500 KG sold to E2E Existing Buyer', await toast(/500 kg issued from PLG01 to E2E Existing Buyer — now 3,190 kg/));
  await page.waitForTimeout(1000);

  // 2) new buyer, 5 Quintal
  await searchBuyer('E2E New Buyer Traders');
  const add = page.getByRole('option', { name: /\+ Add "E2E New Buyer Traders" as a new buyer/ });
  check('a new buyer can be added from the form', (await add.count()) > 0);
  await add.first().click();
  const bd = page.getByRole('dialog');
  await bd.waitFor({ state: 'visible', timeout: 5000 });
  await bd.getByLabel(/Contact person/).fill('Rakesh Mehta');
  await bd.getByLabel(/Mobile \/ phone/).fill('9727055555');
  await bd.getByRole('button', { name: /save & select/i }).click();
  check('the new buyer is saved to the master', await toast(/Scrap buyer added/));
  await page.waitForTimeout(600);
  check('…and selected', /E2E New Buyer Traders/.test(flat(await page.locator('[data-testid="selected-buyer"]').innerText().catch(() => ''))));
  await pickUnit('Quintal');
  await qtyBox().fill('5');
  await page.getByLabel(/^Reference/).fill('INV-E2E-FULL-2');
  await issueBtn().click();
  check('5 Quintal (500 kg) sold to the new buyer', await toast(/500 kg \(5 Quintal\) issued from PLG01 to E2E New Buyer Traders — now 2,690 kg/));
  await page.waitForTimeout(1000);

  // 3) over-stock blocked, then 2 Ton
  await searchBuyer('E2E Existing');
  await page.getByRole('option', { name: /E2E Existing Buyer/ }).first().click();
  await pickUnit('Ton');
  await qtyBox().fill('3');
  await page.waitForTimeout(400);
  check('3 Ton (3,000 kg) against 2,690 kg on hand: flagged and Issue disabled', /3,000 kg \(3 Ton\) is more than the 2,690 kg/.test(await body()) && await issueBtn().isDisabled());
  await qtyBox().fill('2');
  await page.getByLabel(/^Reference/).fill('INV-E2E-FULL-3');
  await issueBtn().click();
  check('2 Ton (2,000 kg) sold', await toast(/2,000 kg \(2 Ton\) issued from PLG01 to E2E Existing Buyer — now 690 kg/));
  await page.waitForTimeout(1200);

  // History
  const hist = page.locator('[data-testid="scrap-out-history"]');
  await hist.scrollIntoViewIfNeeded();
  // Headers are upper-cased by CSS, so compare without case.
  const heads = (await hist.locator('thead th').allInnerTexts()).map((h) => flat(h).toLowerCase());
  check('history columns are exactly S.No. · Date · Sold Weight · Sold To · Reason · Taken From · Status · Reference · Remarks',
    JSON.stringify(heads) === JSON.stringify(['s.no.', 'date', 'sold weight', 'sold to', 'reason', 'taken from', 'status', 'reference', 'remarks']), heads.join(' | '));
  check('…no separate Out KG / Quintal / Ton columns', !heads.some((h) => /^(Out KG|Quintal|Ton)$/i.test(h)));
  const rows = (await page.locator('[data-testid="scrap-out-history-row"]').allInnerTexts()).map(flat);
  check('newest first, S.No. 1-3: 2 Ton · 5 Quintal · 500 KG — as entered',
    /^1 .*2 Ton/.test(rows[0] || '') && /^2 .*5 Quintal/.test(rows[1] || '') && /^3 .*500 KG/.test(rows[2] || ''), rows.slice(0, 3).join(' | '));
  // Row: … Sold To (name + SB- code) · Reason "Sold" · Taken From "PLG01 — Plant" · Status "Sold" · Reference
  check('sales read Status "Sold", with the buyer (and its SB- code) and the reference',
    /E2E Existing Buyer SB-\d+ Sold PLG01 — Plant Sold INV-E2E-FULL-3/.test(rows[0] || '') && /E2E New Buyer Traders SB-\d+ Sold PLG01 — Plant Sold INV-E2E-FULL-2/.test(rows[1] || ''), rows[0]);
  check('the API disposal (10 KG) is row 4, status Active — not "Sold"', /^4 .*10 KG/.test(rows[3] || '') && /Disposed of/.test(rows[3] || '') && /Active/.test(rows[3] || ''), rows[3]);
  await page.locator('[data-testid="scrap-out-history-search"]').fill('New Buyer');
  await page.waitForTimeout(600);
  const filtered = (await page.locator('[data-testid="scrap-out-history-row"]').allInnerTexts()).map(flat);
  check('search narrows to the new buyer\'s sale', filtered.length === 1 && /E2E New Buyer Traders/.test(filtered[0]), filtered.join(' | '));
  await page.locator('[data-testid="scrap-out-history-search"]').fill('');
  await page.waitForTimeout(500);
  check('pagination counts every Scrap Out (4)', /1–4 of 4/.test(await body()));
  check('Available at PLG01 is now 690 kg', /Available at PLG01: 690 kg/.test(await body()));
  await shot('14-scrap-out-history');

  /* ══ errors ══ */
  await browser.close();
  // The ONLY expected 4xx in this run: the stale Full refusal (409) and the
  // batch-less GRN create (400) the UI was made to submit on purpose.
  const expected = (e) => /^409 POST \/rm-ims\/convert$/.test(e) || /^400 POST \/procurement\/grns$/.test(e);
  const unexpected = apiErrors.filter((e) => !expected(e));
  console.log(`\n  page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, API errors: ${apiErrors.length} (expected: ${apiErrors.length - unexpected.length})`);
  for (const e of [...pageErrors, ...consoleErrors.filter((c) => !/status of 40[09]/.test(c)), ...unexpected].slice(0, 8)) console.log(`    ${e}`);
  check('no uncaught page errors', pageErrors.length === 0);
  check('no console errors other than the two deliberate refusals', consoleErrors.filter((c) => !/status of 40[09]/.test(c)).length === 0);
  check('no unexpected API errors', unexpected.length === 0, unexpected.join(' | '));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} browser checks passed.`);
  if (failed.length) { console.log('\n  Failures:'); failed.forEach((x) => console.log(`   - ${x.name}: ${String(x.detail).slice(0, 200)}`)); }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nBrowser run failed:', e); process.exit(1); });
