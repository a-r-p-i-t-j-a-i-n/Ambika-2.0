/**
 * PURCHASE FMS — direct PO preview actions.
 *
 *   node e2e/poDirectPreview.e2e.mjs
 *
 * Bulk Release PO dialog — per-row "Preview PDF" icon:
 *   - previews a PO without selecting it; selection count / checkboxes never change
 *   - consecutive previews of different POs, each PDF's own text names the clicked
 *     PO (number + quantity), a stale stored PDF (PVB) is not reused
 *   - loading spinner on the clicked icon while the PDF is prepared, other icons
 *     disabled meanwhile, and a click on a disabled icon does not toggle the row
 *   - a failed generation shows an error naming the PO and opens nothing
 *   - previewing never calls release / bulk-release
 *   - existing header Preview PDF, Download PDF, Email Preview and Release still work
 *   - the icon is on screen at phone width
 * Purchase Orders table — eye icon beside the PO number opens the ITEM QUICK VIEW popup:
 *   - every item cell + taxable / GST / grand totals match that exact PO (approved,
 *     released, cancelled, revised; two POs in a row), identical to the detail page table
 *   - no navigation / no writes; search, rows and grid scroll position kept on close
 *   - loading, API error + Retry, empty items, never the previous PO's items while loading
 *   - full PO page still on the three-dot View, row click and the popup's "Open full PO"
 *   - icon on screen at 1920 / 1366 / 768 / 390 / 360; popup full screen with a
 *     sideways-scrolling table on phones
 *
 * Expects (started separately):
 *   cd backend
 *   node src/scripts/e2ePoPreviewFixture.js --seed     # clones ambika_e2e_purchase → ambika_e2e_po_preview
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_po_preview node src/scripts/e2eServer.js
 *   cd frontend
 *   VITE_API_URL=http://127.0.0.1:5099/api/v1 npx vite --port 3100 --host 127.0.0.1 --strictPort
 * then `node src/scripts/e2ePoPreviewFixture.js --verify` for the DB-side checks.
 * The spec releases PVD, so re-seed before running it again.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
await assertE2ESetup(APP, API, 'poDirectPreview.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const manifest = JSON.parse(fs.readFileSync(path.join(SHOTS, 'po-preview-manifest.json'), 'utf8'));
const PO = manifest.pos;

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { failures.push(`${name}: ${detail}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Text of a pdfkit PDF: inflate every stream and decode the hex strings of its
// Tj/TJ operators (standard Helvetica fonts → one byte per character).
const pdfText = async (url) => {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const raw = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let body = buf.subarray(start, end);
    try { body = zlib.inflateSync(body); } catch { /* uncompressed */ }
    const s = body.toString('latin1');
    for (const op of s.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      const hexes = op[1] ? [...op[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]) : [op[2]];
      out += `${hexes.map((h) => Buffer.from(h, 'hex').toString('latin1')).join('')}\n`;
    }
    re.lastIndex = end;
  }
  return out;
};

let browser;
const run = async () => {
  browser = await chromium.launch({ headless: true, executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('/api/v1/')) requests.push({ method: r.method(), url: r.url(), body: r.postData() }); });
  const releaseCalls = () => requests.filter((r) => r.method === 'POST' && /\/purchase-orders\/(bulk-release|[0-9a-f]{24}\/release)$/.test(new URL(r.url).pathname));
  const pdfCalls = (id) => requests.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(`/purchase-orders/${id}/pdf`));

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };
  const go = async (route) => {
    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
    await ready();
  };

  // ── Login ──
  await go('/');
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  // ════════════════════════ Bulk Release PO ════════════════════════
  section('Bulk Release PO — per-row Preview PDF');
  await go('/procurement/purchase-orders');
  await page.getByRole('button', { name: 'Bulk Release PO' }).click();
  const bulk = page.getByRole('dialog').filter({ hasText: 'Bulk Release PO' });
  const rowBtnSel = (tag) => `[data-testid="bulk-release-row-preview"][data-po-id="${PO[tag].id}"]`;
  const rowBtn = (tag) => bulk.locator(rowBtnSel(tag));
  const rowOf = (tag) => bulk.locator('tbody tr', { has: page.locator(rowBtnSel(tag)) });
  const isChecked = (tag) => rowOf(tag).locator('input[type="checkbox"]').isChecked();
  const selectedChip = () => bulk.getByText(/^\d+ selected$/).innerText();
  const pdfDialog = page.getByRole('dialog').filter({ has: page.locator('iframe[title="PO PDF"]') });
  // Park the mouse afterwards: the pointer still rests on the icon that was
  // clicked, so its tooltip re-opens over the next row's icon.
  const closePdf = async () => {
    await page.keyboard.press('Escape');
    await pdfDialog.waitFor({ state: 'hidden', timeout: 5000 });
    await page.mouse.move(0, 0);
    await page.getByRole('tooltip').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  };

  await rowBtn('PVREV').waitFor({ state: 'visible', timeout: 30000 });
  // let the recipient preview settle so later counts are stable
  await bulk.getByText('Ready').first().waitFor({ timeout: 15000 }).catch(() => {});
  for (const tag of ['PVA', 'PVB', 'PVC', 'PVD', 'PVREV']) check(`${tag} has a preview icon`, await rowBtn(tag).isVisible());
  check('icon has an accessible name', (await rowBtn('PVA').getAttribute('aria-label')) === `Preview PO PDF for ${PO.PVA.poNumber}`);
  const rowCounts = await bulk.locator('tbody tr').evaluateAll((trs) => ({
    rows: trs.length, withIcon: trs.filter((tr) => tr.querySelector('[data-testid="bulk-release-row-preview"]')).length,
  }));
  check('every rendered PO row has its own preview icon', rowCounts.rows > 1 && rowCounts.withIcon === rowCounts.rows, JSON.stringify(rowCounts));
  await rowBtn('PVA').hover();
  const rowTip = page.getByRole('tooltip', { name: 'Preview PO PDF' });
  await rowTip.waitFor({ timeout: 5000 }).catch(() => {});
  check('icon tooltip "Preview PO PDF"', await rowTip.isVisible());
  await page.mouse.move(0, 0);
  check('nothing selected at start', (await selectedChip()) === '0 selected', await selectedChip());
  check('header Preview PDF disabled with nothing selected (unchanged rule)', await bulk.getByRole('button', { name: 'Preview PDF', exact: true }).isDisabled());

  // PDF content must be the clicked PO's: number, vendor, every line (item,
  // SKU, qty, rate, line total) and the grand total — compared with the API.
  const bulkLogin = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(USER) })).json();
  const apiPo = async (id) => (await (await fetch(`${API}/procurement/purchase-orders/${id}`, { headers: { authorization: `Bearer ${bulkLogin.data.token}` } })).json()).data;
  const rs = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pdfMatchesPo = async (label, text, id) => {
    const po = await apiPo(id);
    const missing = [po.poNumber, po.vendorName, rs(po.grandTotal)]
      .concat((po.items || []).flatMap((it) => [it.itemName, it.skuCode, String(it.quantity), Number(it.rate).toFixed(2), Number(it.totalAmount).toFixed(2)]))
      .filter((s) => s && !text.includes(s));
    check(`${label}: PDF shows ${po.poNumber}, its vendor, ${po.items.length} line(s) (item/SKU/qty/rate/total) and grand total`, missing.length === 0, `missing: ${missing.join(' | ')}`);
  };

  // 1–4: preview without selecting, consecutive previews, PDF text per PO.
  const previewAndRead = async (tag, { delay = 0 } = {}) => {
    const matcher = (u) => u.pathname.endsWith(`/purchase-orders/${PO[tag].id}/pdf`);
    if (delay) await page.route(matcher, async (route) => { await sleep(delay); await route.continue(); });
    await rowBtn(tag).click();
    let spinner = false;
    let othersDisabled = false;
    if (delay) {
      await sleep(250);
      spinner = await rowBtn(tag).locator('.MuiCircularProgress-root').isVisible();
      othersDisabled = await rowBtn(tag === 'PVA' ? 'PVC' : 'PVA').isDisabled();
      // a click on a disabled icon lands on its wrapper — must not toggle the row
      const other = tag === 'PVA' ? 'PVC' : 'PVA';
      const before = await isChecked(other);
      await rowBtn(other).locator('xpath=..').click({ force: true });
      check(`click on a disabled icon (${other}) leaves its checkbox alone`, (await isChecked(other)) === before);
    }
    await pdfDialog.waitFor({ state: 'visible', timeout: 30000 });
    if (delay) await page.unroute(matcher);
    const title = await pdfDialog.locator('h2').innerText();
    const src = await pdfDialog.locator('iframe').getAttribute('src');
    return { title, src, spinner, othersDisabled };
  };

  const a = await previewAndRead('PVA', { delay: 1500 });
  check('loading spinner on the clicked icon while the PDF is prepared', a.spinner);
  check('other preview icons disabled meanwhile', a.othersDisabled);
  check('PDF dialog titled with the clicked PO', a.title.includes(PO.PVA.poNumber), a.title);
  check('PDF file is the clicked PO\'s', /AGL_PO-PVA_26-27\.pdf$/.test(a.src || ''), a.src);
  const aText = await pdfText(a.src);
  check('PDF text names PVA and its quantity 111', aText.includes(PO.PVA.poNumber) && /\b111\b/.test(aText), aText.slice(0, 120).replace(/\n/g, ' | '));
  await pdfMatchesPo('PVA', aText, PO.PVA.id);
  await closePdf();
  // MUI keeps the lower dialog aria-hidden until the upper one finishes closing.
  check('Bulk Release dialog still open after closing the PDF', await bulk.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false));
  check('PVA not selected by previewing it', !(await isChecked('PVA')));
  check('selection still 0 after a preview', (await selectedChip()) === '0 selected', await selectedChip());
  check('bulk table kept its rows after the PDF refreshed the PO list', await rowBtn('PVD').isVisible());

  const b = await previewAndRead('PVB');
  check('PVB: stale stored PDF NOT reused', b.src !== manifest.stalePdfUrl && /AGL_PO-PVB_26-27\.pdf$/.test(b.src || ''), b.src);
  const bText = await pdfText(b.src);
  check('PDF text names PVB and 222, not the stale PO', bText.includes(PO.PVB.poNumber) && /\b222\b/.test(bText) && !bText.includes('AGL/PO-002/26-27'));
  await pdfMatchesPo('PVB', bText, PO.PVB.id);
  await closePdf();

  const c = await previewAndRead('PVC');
  const cText = await pdfText(c.src);
  check('consecutive preview: PVC opens PVC', c.title.includes(PO.PVC.poNumber) && cText.includes(PO.PVC.poNumber) && /\b333\b/.test(cText));
  await pdfMatchesPo('PVC', cText, PO.PVC.id);
  await closePdf();

  const pdfCountA = pdfCalls(PO.PVA.id).length;
  const a2 = await previewAndRead('PVA');
  check('re-preview of PVA uses the PDF generated in this session (no new request)', pdfCalls(PO.PVA.id).length === pdfCountA && a2.src === a.src);
  await closePdf();

  // Preview while something else is selected — selection untouched.
  await rowOf('PVC').locator('input[type="checkbox"]').check();
  check('selecting PVC → 1 selected', (await selectedChip()) === '1 selected');
  const r = await previewAndRead('PVREV');
  const rText = await pdfText(r.src);
  check('revised PO previews its own PDF', rText.includes(PO.PVREV.poNumber) && /\b50\b/.test(rText));
  await closePdf();
  check('after previewing PVREV: still 1 selected, PVC checked, PVREV not', (await selectedChip()) === '1 selected' && await isChecked('PVC') && !(await isChecked('PVREV')));
  await pdfMatchesPo('PVREV', rText, PO.PVREV.id);
  const emailBox = bulk.getByText('Email Preview').locator('xpath=../..');
  check('row previews leave the Email Preview on the selected PO (PVC)', (await emailBox.innerText()).includes(`Purchase Order ${PO.PVC.poNumber}`));

  // Rows 1 and 2 by on-screen position, whatever POs they hold.
  for (const n of [0, 1]) {
    const tr = bulk.locator('tbody tr').nth(n);
    const id = await tr.getByTestId('bulk-release-row-preview').getAttribute('data-po-id');
    const shownNo = (await tr.locator('td').nth(1).innerText()).trim();
    const checkedBefore = await tr.locator('input[type="checkbox"]').isChecked();
    await tr.getByTestId('bulk-release-row-preview').click();
    await pdfDialog.waitFor({ state: 'visible', timeout: 30000 });
    const title = await pdfDialog.locator('h2').innerText();
    const text = await pdfText(await pdfDialog.locator('iframe').getAttribute('src'));
    check(`row ${n + 1} (${shownNo}): preview opens row ${n + 1}'s PDF`, title.includes(shownNo) && text.includes(shownNo), title);
    await pdfMatchesPo(`row ${n + 1}`, text, id);
    await closePdf();
    check(`row ${n + 1}: its checkbox unchanged`, (await tr.locator('input[type="checkbox"]').isChecked()) === checkedBefore);
  }
  check('selection still exactly PVC after the row previews', (await selectedChip()) === '1 selected' && await isChecked('PVC'));

  // Error state.
  section('Bulk Release PO — preview error');
  const failMatcher = (u) => u.pathname.endsWith(`/purchase-orders/${PO.PVD.id}/pdf`);
  await page.route(failMatcher, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated PDF failure' }) }));
  await rowBtn('PVD').click();
  const err = page.getByText(`${PO.PVD.poNumber}: Simulated PDF failure`);
  await err.waitFor({ timeout: 10000 }).catch(() => {});
  check('failed generation shows an error naming the PO', await err.isVisible());
  check('no PDF dialog opened on failure', !(await pdfDialog.isVisible()));
  check('icon usable again after the failure', await rowBtn('PVD').isEnabled());
  check('selection unchanged after the failure', (await selectedChip()) === '1 selected' && !(await isChecked('PVD')));
  await page.unroute(failMatcher);

  // Repeated clicks while PVD's PDF is loading → one request, PVD's PDF.
  const slowMatcher = (u) => u.pathname.endsWith(`/purchase-orders/${PO.PVD.id}/pdf`);
  await page.route(slowMatcher, async (route) => { await sleep(1200); await route.continue(); });
  const pvdCallsBefore = pdfCalls(PO.PVD.id).length;
  await rowBtn('PVD').dblclick();
  await rowBtn('PVD').click({ force: true }).catch(() => {});
  await pdfDialog.waitFor({ state: 'visible', timeout: 30000 });
  check('double/triple click while loading → exactly one PDF request', pdfCalls(PO.PVD.id).length - pvdCallsBefore === 1, String(pdfCalls(PO.PVD.id).length - pvdCallsBefore));
  check('…and it opens PVD\'s PDF', (await pdfDialog.locator('h2').innerText()).includes(PO.PVD.poNumber));
  await page.unroute(slowMatcher);
  await closePdf();
  check('PVD still unselected after its preview', !(await isChecked('PVD')) && (await selectedChip()) === '1 selected');

  check('no release / bulk-release request made by any preview', releaseCalls().length === 0, JSON.stringify(releaseCalls()));

  // Existing actions.
  section('Bulk Release PO — existing actions');
  const emailPreview = bulk.getByText('Email Preview').locator('xpath=../..');
  check('Email Preview shows the selected PO (PVC)', (await emailPreview.innerText()).includes(`Purchase Order ${PO.PVC.poNumber}`), (await emailPreview.innerText()).slice(0, 200));
  check('Email Preview resolves the vendor To address', (await emailPreview.innerText()).includes('pv-vendor@test.local'));
  await bulk.getByRole('button', { name: 'Preview PDF', exact: true }).click();
  await pdfDialog.waitFor({ state: 'visible', timeout: 30000 });
  check('header Preview PDF still previews the Email Preview PO', (await pdfDialog.locator('h2').innerText()).includes(PO.PVC.poNumber));
  await closePdf();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    bulk.getByRole('button', { name: 'Download PDF', exact: true }).click(),
  ]);
  check('Download PDF still downloads the selected PO', download.suggestedFilename() === 'AGL_PO-PVC_26-27.pdf', download.suggestedFilename());

  // Phone width: the icon sits beside the PO number, on screen.
  await page.setViewportSize({ width: 390, height: 800 });
  await sleep(400);
  // Real visibility, not just a bounding box: the table must not collapse,
  // and the icon must be the topmost element at its centre.
  const phone = await bulk.evaluate((d, sel) => {
    const table = d.querySelector('table')?.parentElement;
    const icon = d.querySelector(sel);
    icon.scrollIntoView({ block: 'center' });
    const r = icon.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tableHeight: Math.round(table.getBoundingClientRect().height), x: r.left, right: r.right, topmost: hit === icon || icon.contains(hit) };
  }, rowBtnSel('PVB'));
  check('390px: PO table keeps a usable height', phone.tableHeight >= 200, JSON.stringify(phone));
  check('390px: PVB\'s preview icon is actually visible (topmost at its centre, inside the screen)', phone.topmost && phone.x >= 0 && phone.right <= 390, JSON.stringify(phone));
  await page.screenshot({ path: path.join(SHOTS, 'po-preview-bulk-390.png') });
  await rowBtn('PVB').click();
  await pdfDialog.waitFor({ state: 'visible', timeout: 30000 });
  const mobilePdf = await pdfDialog.evaluate((d) => { const r = (d.querySelector('.MuiDialog-paper') || d).getBoundingClientRect(); return { left: r.left, right: r.right }; });
  check('390px: tapping PVB\'s icon opens PVB\'s PDF inside the screen', (await pdfDialog.locator('h2').innerText()).includes(PO.PVB.poNumber) && mobilePdf.left >= 0 && mobilePdf.right <= 390.5, JSON.stringify(mobilePdf));
  await page.screenshot({ path: path.join(SHOTS, 'po-preview-bulk-390-pdf.png') });
  await closePdf();
  check('390px: selection unchanged after the phone preview', (await selectedChip()) === '1 selected' && !(await isChecked('PVB')));
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'po-preview-bulk-1440.png') });

  // Release still works (PVD only).
  await rowOf('PVC').locator('input[type="checkbox"]').uncheck();
  await rowOf('PVD').locator('input[type="checkbox"]').check();
  check('PVD selected for release', (await selectedChip()) === '1 selected' && await isChecked('PVD'));
  await bulk.getByRole('button', { name: 'Release Selected' }).click();
  await page.getByRole('button', { name: 'Send Emails' }).click();
  const resultLine = page.getByText(/1 of 1 PO\(s\) released successfully/);
  await resultLine.waitFor({ timeout: 30000 }).catch(() => {});
  check('Bulk release still releases the selected PO', await resultLine.isVisible());
  const rel = releaseCalls();
  check('exactly one bulk-release call, for PVD only', rel.length === 1 && JSON.parse(rel[0].body || '{}').poIds?.join(',') === PO.PVD.id, JSON.stringify(rel.map((x) => x.body)));
  await page.getByRole('button', { name: 'Close' }).click();

  // ════════════════════════ Purchase Orders table ════════════════════════
  section('Purchase Orders table — eye icon opens the item quick view');
  const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(USER) })).json();
  const auth = { authorization: `Bearer ${login.data.token}` };
  const getPo = async (id) => (await (await fetch(`${API}/procurement/purchase-orders/${id}`, { headers: auth })).json()).data;
  const displayNo = (po) => po?.poNumber || po?.draftNumber || 'Pending Approval';
  const f2 = (n) => Number(n || 0).toFixed(2);
  const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const viewIcon = (id) => page.locator(`.MuiDataGrid-row[data-id="${id}"] [data-testid="po-row-view"]`);
  const quick = page.getByRole('dialog').filter({ has: page.locator('#po-items-quick-view-title') });
  const quickRows = () => quick.locator('tbody tr');
  const searchFor = async (text) => { await page.locator('#po-search').fill(text); await sleep(800); };
  const trackPushes = () => page.evaluate(() => {
    window.__pushes = 0;
    const orig = history.pushState.bind(history);
    history.pushState = (...args) => { window.__pushes += 1; return orig(...args); };
  });
  const pushes = () => page.evaluate(() => window.__pushes);
  const sideEffects = () => requests.filter((r) => r.method !== 'GET' && /purchase-orders/.test(r.url)).length;

  const tableText = async (scope) => (await scope.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()))));
  const expectRows = (po) => (po.items || []).map((it, i) => [
    String(i + 1), it.indentItemDisplayNumber || it.indentNumber || '—', it.itemName, it.skuCode || '—',
    String(it.quantity), it.unit, f2(it.rate), f2(it.taxableAmount), `${it.gstRate || 0}%`, f2(it.taxAmount), f2(it.totalAmount),
    String(it.receivedQty || 0), String(it.pendingQty || 0),
  ]);
  // Opens the quick view from the row's eye icon and checks it against the API.
  const checkQuickView = async (label, id) => {
    const po = await getPo(id);
    await viewIcon(id).click();
    await quick.waitFor({ state: 'visible', timeout: 15000 });
    await quickRows().first().waitFor({ timeout: 15000 });
    const head = await quick.locator('#po-items-quick-view-title').innerText();
    check(`${label}: popup titled with ${displayNo(po)} + vendor`, head.includes('Item Details') && head.includes(displayNo(po)) && head.includes(po.vendorName), head.replace(/\n/g, ' | '));
    const got = await tableText(quick);
    const want = expectRows(po);
    check(`${label}: ${want.length} item row(s), every cell matches the PO`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    const body = await quick.innerText();
    check(`${label}: taxable / GST / grand totals shown`, body.includes(inr(po.totalTaxableValue)) && body.includes(inr(po.totalGSTAmount)) && body.includes(inr(po.grandTotal)),
      `${inr(po.totalTaxableValue)} ${inr(po.totalGSTAmount)} ${inr(po.grandTotal)}`);
    return { po, got, head };
  };
  const closeQuick = async (how) => {
    if (how === 'escape') await page.keyboard.press('Escape');
    else if (how === 'x') await quick.getByRole('button', { name: 'Close' }).first().click();
    else await quick.getByRole('button', { name: 'Close', exact: true }).last().click();
    await quick.waitFor({ state: 'hidden', timeout: 5000 });
    await page.mouse.move(0, 0);
  };

  const listUrl = `${APP}/procurement/purchase-orders`;
  await go('/procurement/purchase-orders');
  await trackPushes();
  const sideBefore = sideEffects();

  // Search + two different POs; the list (URL, search, rows) is untouched.
  await searchFor('PV Vendor');
  await viewIcon(PO.PVA.id).waitFor({ state: 'visible', timeout: 20000 });
  // wait for the debounced search to settle before snapshotting the rows
  await page.waitForFunction(() => {
    const rs = [...document.querySelectorAll('.MuiDataGrid-row')];
    return rs.length > 0 && rs.every((r) => r.textContent.includes('PV Vendor'));
  }, null, { timeout: 15000 });
  const rowIds = () => page.locator('.MuiDataGrid-row').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-id')).join(','));
  const rowsBefore = await rowIds();
  check('icon tooltip label / aria-label', (await viewIcon(PO.PVA.id).getAttribute('aria-label')) === `View item details for ${PO.PVA.poNumber}`);
  await viewIcon(PO.PVA.id).hover();
  const tip = page.getByRole('tooltip', { name: 'View Item Details' });
  await tip.waitFor({ timeout: 5000 }).catch(() => {});
  check('tooltip "View Item Details"', await tip.isVisible());
  const a1 = await checkQuickView('approved PVA', PO.PVA.id);
  check('PVA popup shows quantity 111', a1.got[0]?.[4] === '111');
  await page.screenshot({ path: path.join(SHOTS, 'po-quick-view-1440.png') });
  await closeQuick('escape');
  const b1 = await checkQuickView('approved PVB (second PO)', PO.PVB.id);
  check('PVB popup shows PVB\'s own item (222), not PVA\'s', b1.got[0]?.[4] === '222' && !b1.head.includes(PO.PVA.poNumber));
  await closeQuick('x');
  check('still on the list (URL unchanged, no navigation)', page.url() === listUrl && (await pushes()) === 0, `${page.url()} pushes=${await pushes()}`);
  check('search kept after closing', (await page.locator('#po-search').inputValue()) === 'PV Vendor');
  check('same rows after closing', (await rowIds()) === rowsBefore, `${rowsBefore.split(',').length} rows`);

  for (const [label, tag] of [['released PVD', 'PVD'], ['cancelled PVCAN', 'PVCAN'], ['revised PVREV', 'PVREV']]) {
    const r = await checkQuickView(label, PO[tag].id);
    const chip = { PVD: 'Released to Vendor', PVCAN: 'Cancelled', PVREV: 'Approved' }[tag];
    check(`${label}: status chip "${chip}" in the popup`, r.head.includes(chip), r.head.replace(/\n/g, ' | '));
    await closeQuick('button');
  }

  // Scroll position: the PAGE scrolls here (the grid shows all of its rows),
  // so scroll the window and open a row that is only on screen after that.
  await searchFor('');
  await page.locator('.MuiDataGrid-row').nth(10).waitFor({ timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 500));
  await sleep(500);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const lowRowId = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.MuiDataGrid-row')].find((r) => r.getBoundingClientRect().top > 300);
    return row?.getAttribute('data-id');
  });
  await checkQuickView('row further down the list', lowRowId);
  await closeQuick('escape');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('page scroll position kept after closing', scrollBefore > 0 && scrollAfter === scrollBefore, `${scrollBefore} → ${scrollAfter}`);
  check('quick views made no write requests', sideEffects() === sideBefore);
  check('quick views made no navigation', (await pushes()) === 0 && page.url() === listUrl);

  // Popup table === the detail page's table for the same PO.
  await searchFor(PO.PVC.poNumber);
  await checkQuickView('approved PVC', PO.PVC.id);
  const popupText = await tableText(quick);
  await closeQuick('escape');
  await go(`/procurement/purchase-orders/${PO.PVC.id}`);
  await page.getByText('Items (1)').waitFor({ timeout: 15000 });
  const detailCard = page.locator('table').filter({ hasText: 'Pending' }).filter({ hasText: 'GST %' }).first();
  check('popup rows identical to the detail page\'s Items table', JSON.stringify(await tableText(detailCard)) === JSON.stringify(popupText));

  // Full page stays on the menu's View, row click, and "Open full PO".
  section('Full PO page — unchanged routes');
  await go('/procurement/purchase-orders');
  await searchFor(PO.PVA.poNumber);
  await viewIcon(PO.PVA.id).waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => { const s = document.querySelector('.MuiDataGrid-virtualScroller'); if (s) s.scrollLeft = s.scrollWidth; });
  await sleep(400);
  await page.locator(`.MuiDataGrid-row[data-id="${PO.PVA.id}"]`).getByRole('button', { name: 'Actions' }).click();
  const items = await page.getByRole('menuitem').allInnerTexts();
  check('three-dot menu keeps its actions', ['View', 'Release to Supplier', 'Cancel'].every((x) => items.includes(x)) && items.some((x) => /PDF/.test(x)), items.join(', '));
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.waitForURL((u) => u.pathname === `/procurement/purchase-orders/${PO.PVA.id}`, { timeout: 15000 }).catch(() => {});
  check('menu View still opens the full PO page', new URL(page.url()).pathname === `/procurement/purchase-orders/${PO.PVA.id}`);

  await go('/procurement/purchase-orders');
  await searchFor(PO.PVA.poNumber);
  await page.locator(`.MuiDataGrid-row[data-id="${PO.PVA.id}"] [data-field="vendorName"]`).click();
  await page.waitForURL((u) => u.pathname === `/procurement/purchase-orders/${PO.PVA.id}`, { timeout: 15000 }).catch(() => {});
  check('row click still opens the full PO page', new URL(page.url()).pathname === `/procurement/purchase-orders/${PO.PVA.id}`);

  await go('/procurement/purchase-orders');
  await searchFor(PO.PVA.poNumber);
  await checkQuickView('PVA again', PO.PVA.id);
  await quick.getByRole('button', { name: 'Open full PO' }).click();
  await page.waitForURL((u) => u.pathname === `/procurement/purchase-orders/${PO.PVA.id}`, { timeout: 15000 }).catch(() => {});
  // the URL changes a tick before React unmounts the list (and its popup)
  const quickGone = await quick.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
  check('"Open full PO" in the popup opens that PO\'s page and closes the popup', new URL(page.url()).pathname === `/procurement/purchase-orders/${PO.PVA.id}` && quickGone);

  // Loading / error / empty / no stale items while the next PO loads.
  section('Quick view — loading, error, empty');
  const detailMatcher = (tag) => (u) => u.pathname.endsWith(`/api/v1/procurement/purchase-orders/${PO[tag].id}`);
  await go('/procurement/purchase-orders');
  await searchFor('PV Vendor');
  await checkQuickView('PVA (primes the cache)', PO.PVA.id);
  await closeQuick('escape');
  await page.route(detailMatcher('PVREV'), async (route) => { await sleep(1500); await route.continue(); });
  await viewIcon(PO.PVREV.id).click();
  await quick.waitFor({ state: 'visible', timeout: 10000 });
  await sleep(300);
  const loadingShown = await quick.getByText('Loading items…').isVisible();
  const staleRows = await quickRows().count();
  // PVREV may already be cached from the status pass — then it shows at once, which is fine too.
  const cachedPvrev = staleRows > 0 && (await tableText(quick))[0]?.[4] === '50';
  check('while loading: spinner (or the cached PVREV), never the previous PO\'s items', (loadingShown && staleRows === 0) || cachedPvrev, `loading=${loadingShown} rows=${staleRows}`);
  await quickRows().first().waitFor({ timeout: 15000 });
  check('then PVREV\'s own item (50)', (await tableText(quick))[0]?.[4] === '50');
  await closeQuick('escape');
  await page.unroute(detailMatcher('PVREV'));

  // Fresh page so nothing is cached for the error / empty / loading checks.
  await go('/procurement/purchase-orders');
  await searchFor('PV Vendor');
  await viewIcon(PO.PVC.id).waitFor({ state: 'visible', timeout: 20000 });
  await page.route(detailMatcher('PVC'), async (route) => { await sleep(1500); await route.continue(); });
  await viewIcon(PO.PVC.id).click();
  await quick.waitFor({ state: 'visible', timeout: 10000 });
  await sleep(300);
  check('loading state while the PO loads', await quick.getByText('Loading items…').isVisible() && (await quickRows().count()) === 0);
  await quickRows().first().waitFor({ timeout: 15000 });
  await closeQuick('escape');
  await page.unroute(detailMatcher('PVC'));

  let failNext = true;
  await page.route(detailMatcher('PVA'), async (route) => {
    if (failNext) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated load failure' }) });
    return route.continue();
  });
  await viewIcon(PO.PVA.id).click();
  await quick.waitFor({ state: 'visible', timeout: 10000 });
  const errText = quick.getByText('Could not load this PO\'s items');
  await errText.waitFor({ timeout: 15000 }).catch(() => {});
  check('API error: message + server reason + Retry', await errText.isVisible() && await quick.getByText('Simulated load failure').isVisible() && await quick.getByRole('button', { name: 'Retry' }).isVisible());
  failNext = false;
  await quick.getByRole('button', { name: 'Retry' }).click();
  await quickRows().first().waitFor({ timeout: 15000 }).catch(() => {});
  check('Retry loads the items', (await tableText(quick))[0]?.[4] === '111');
  await closeQuick('escape');
  await page.unroute(detailMatcher('PVA'));

  await page.route(detailMatcher('PVB'), async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.data.items = [];
    return route.fulfill({ response: res, json });
  });
  await go('/procurement/purchase-orders');
  await searchFor('PV Vendor');
  await viewIcon(PO.PVB.id).click();
  await quick.waitFor({ state: 'visible', timeout: 10000 });
  const emptyText = quick.getByText('This PO has no items.');
  await emptyText.waitFor({ timeout: 15000 }).catch(() => {});
  check('PO without items: empty state', await emptyText.isVisible() && (await quickRows().count()) === 0);
  await closeQuick('escape');
  await page.unroute(detailMatcher('PVB'));

  // Widths: icon beside the number, popup usable.
  section('Eye icon + popup — desktop and mobile');
  for (const w of [1920, 1366, 768, 390, 360]) {
    await page.setViewportSize({ width: w, height: 900 });
    await go('/procurement/purchase-orders');
    await searchFor(PO.PVA.poNumber);
    const icon = viewIcon(PO.PVA.id);
    await icon.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    await icon.scrollIntoViewIfNeeded().catch(() => {});
    const scrollLeft = await page.evaluate(() => document.querySelector('.MuiDataGrid-virtualScroller')?.scrollLeft || 0);
    const bb = await icon.boundingBox();
    check(`${w}px: icon on screen without scrolling the grid sideways`, Boolean(bb) && bb.x >= 0 && bb.x + bb.width <= w && scrollLeft === 0, `${JSON.stringify(bb)} scrollLeft=${scrollLeft}`);
    const num = await page.locator(`.MuiDataGrid-row[data-id="${PO.PVA.id}"] [data-field="poNumber"] p`).first()
      .evaluate((el) => ({ text: el.textContent, clipped: el.scrollWidth > el.clientWidth }));
    check(`${w}px: PO number shown in full (not ellipsised)`, num.text === PO.PVA.poNumber && !num.clipped, JSON.stringify(num));
    await icon.click();
    await quick.waitFor({ state: 'visible', timeout: 10000 });
    await quickRows().first().waitFor({ timeout: 15000 });
    const geo = await quick.evaluate((d) => {
      const paper = d.querySelector('.MuiDialog-paper') || d;
      const tc = d.querySelector('.MuiTableContainer-root');
      const r = paper.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, tableScroll: tc.scrollWidth - tc.clientWidth, tcOverflow: getComputedStyle(tc).overflowX };
    });
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${w}px: popup inside the viewport, no page-level horizontal scroll`, geo.left >= 0 && geo.right <= w + 0.5 && pageOverflow <= 0, JSON.stringify({ ...geo, pageOverflow }));
    if (w < 600) check(`${w}px: popup is full screen and its table scrolls sideways`, Math.round(geo.width) === w && geo.tableScroll > 0 && geo.tcOverflow === 'auto', JSON.stringify(geo));
    if (w === 390 || w === 1366) await page.screenshot({ path: path.join(SHOTS, `po-quick-view-${w}.png`) });
    await closeQuick('escape');
  }

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
};

try {
  await run();
} catch (e) {
  failures.push(`crashed: ${e.stack || e.message}`);
  console.log(`  CRASH ${e.stack || e.message}`);
} finally {
  await browser?.close().catch(() => {});
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1; }
