/**
 * Automatic SKU-based routing + QC-gated stock posting, driven through the
 * real UI in Chromium.
 *
 *   node e2e/qcGatedGrn.e2e.mjs
 *
 * Expects (started separately, see backend/src/scripts/e2eQcGatedPostingFixture.js):
 *   backend  :5099  via e2eServer.js against the ambika_e2e_qcgated_ui scratch DB
 *                   (a local replica set, so transactions are real)
 *   frontend :3100  with VITE_API_URL pointing at :5099
 *
 * Seed first with `e2eQcGatedPostingFixture.js --seed-ui`; afterwards
 * `--verify-ui` reads the database and is the real oracle for the ledger. This
 * file checks what the operator sees and does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';
import { signGrnFromCard } from './_grnLifecycle.mjs';

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
await assertE2ESetup(APP, API, 'qcGatedGrn.e2e.mjs');
const USER = { email: 'e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/qcgated';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];

const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));

const ready = async () => {
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForTimeout(150);
};
const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
const dialogTitled = (re) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: re }) });
const snack = async (re) => {
  try { await page.getByText(re).first().waitFor({ timeout: 5000 }); return true; } catch { return false; }
};

/** Read the ledger through the API with the logged-in user's token (read-only). */
const api = (p) => page.evaluate(async ([base, url]) => {
  const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  return r.json();
}, [API, p]);
const stockOf = async (code) => {
  const res = await api(`/inventory/stock?limit=200&skuCode=${code}`);
  return (res.data || []).filter((r) => r.skuCode === code).reduce((s, r) => s + (r.qtyOnHand || 0), 0);
};

// ── login ─────────────────────────────────────────────────────────────────────
await go(APP);
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
check('login', true);

// ── 1. Create GRN: automatic destinations, no Inventory Type ─────────────────
console.log('\n── 1. Create and save a mixed GRN (coil + brush; a service line on the PO) ──');
await go(`${APP}/purchase-fms/grn`);
await page.getByRole('button', { name: /new grn/i }).first().waitFor({ timeout: 20000 });
await page.getByRole('button', { name: /new grn/i }).first().click();
const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
await form.waitFor();
await form.getByRole('combobox', { name: /purchase order/i }).first().click();
await page.waitForTimeout(800);
await page.getByRole('option', { name: /PO-QG-UI-MIX/ }).click();
await page.waitForTimeout(2000);

check('no manual Inventory Type dropdown', (await form.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0
  && (await form.getByText('Add to RM Stock').count()) === 0);
const tags = (await form.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim());
check('each line shows its destination from the SKU master', tags.includes('→ RM IMS · Received At?') && tags.includes('→ C&P IMS · MAIN')
  && tags.some((t) => /Service \/ Job Work/.test(t)), tags.join(' | '));
const recvAt = form.getByRole('combobox', { name: /Received At/ });
check('Received At is asked for (the GRN has Raw Material) and is not pre-filled',
  (await recvAt.count()) === 1 && !/PLG01|JW001/.test(await recvAt.innerText()), await recvAt.innerText().catch(() => ''));
await shot('01-create-destinations');

await form.getByRole('textbox', { name: /Batch No \*/ }).fill('C-UI-1');
await form.getByRole('button', { name: 'Save as Draft' }).click();
check('a received Service line is refused before saving', await snack(/E2E Polishing Service.*Service \/ Job Work/));
await form.getByRole('spinbutton', { name: 'Received Qty' }).nth(2).fill('0');
await page.waitForTimeout(300);
await form.getByRole('button', { name: 'Save as Draft' }).click();
check('saving without Received At is refused', await snack(/Select Received At/));
await recvAt.click();
await page.getByRole('option', { name: /JW001/ }).click();
await page.waitForTimeout(400);
check('the coil line now reads RM IMS · JW001',
  (await form.getByTestId('grn-line-destination').allInnerTexts()).map((t) => t.trim()).includes('→ RM IMS · JW001'));
await form.getByRole('button', { name: 'Save as Draft' }).click();
const summary = form.getByTestId('grn-form-saved-summary');
await summary.waitFor({ timeout: 15000 });
const summaryText = (await summary.innerText()).replace(/\s+/g, ' ');
const grnNo = (summaryText.match(/AGL\/GRN-\d+\/\d+-\d+/) || [''])[0];
check('GRN saved as a draft', /Draft/.test(summaryText) && !!grnNo, grnNo);
check('2. saving posts no stock (coil 0, brush 0)', (await stockOf('E2E-COIL')) === 0 && (await stockOf('E2E-BRUSH')) === 0);
await shot('02-saved');

// ── 3. Complete GRN: still no stock ──────────────────────────────────────────
console.log('\n── 3. Complete GRN ──');
const section = form.locator('#grn-qc-section');
const nextText = async () => ((await form.getByTestId('grn-qc-next').first().innerText().catch(() => '')) || '').trim();
check('next action spelled out: Complete GRN', /^Next action: Complete GRN/.test(await nextText()), await nextText());
await section.getByRole('button', { name: 'Complete GRN + QC' }).click();
const cdlg = dialogTitled(/^Complete GRN/);
await cdlg.waitFor({ timeout: 10000 });
check('Complete GRN dialog: no Inventory Type, Received At carried (JW001), destinations listed',
  (await cdlg.getByRole('combobox', { name: /Inventory Type/ }).count()) === 0
  && /JW001/.test(await cdlg.getByRole('combobox', { name: /Received At/ }).innerText())
  && /RM IMS: 1 · C&P IMS: 1/.test(await cdlg.getByTestId('grn-complete-destinations').innerText()));
check('…and says stock is NOT usable yet', /not<\/b>|not usable yet/i.test(await cdlg.innerHTML()));
await cdlg.getByRole('button', { name: 'Complete GRN' }).dblclick();
await cdlg.waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(2000);
const qcStatus = async () => ((await form.getByTestId('grn-qc-status').first().innerText().catch(() => '')) || '').trim();
check('GRN completed → QC open at once (no MD signature awaited)', (await qcStatus()) === 'QC Pending', await qcStatus());
check('completing the GRN posts no stock (coil 0, brush 0)', (await stockOf('E2E-COIL')) === 0 && (await stockOf('E2E-BRUSH')) === 0);

// ── 3b. Awaiting QC on the IMS screens and in their CSV exports ──────────────
// This is the one moment the material is received but not yet usable, so it is
// where Awaiting QC has to be visible — and where the downloaded file has to
// agree with the screen and with the API. Run in a second tab so the GRN form
// below stays open.
console.log('\n── 3b. Awaiting QC: screen, export and API agree ──');
{
  const t = await ctx.newPage();
  // A fresh tab starts on about:blank, where localStorage (and so the token)
  // cannot be read — land it on the app first.
  await t.goto(`${APP}/ims/stock`, { waitUntil: 'domcontentloaded' });
  await t.waitForSelector('#root > *', { timeout: 30000 });
  const tApi = (u) => t.evaluate(async ([base, url]) => {
    const r = await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return r.json();
  }, [API, u]);
  /** Click Export and read the file the browser actually downloaded. */
  const csvRows = async (url, rowFilter) => {
    await t.goto(url, { waitUntil: 'domcontentloaded' });
    await t.waitForSelector('#root > *', { timeout: 30000 });
    await t.getByRole('row').filter({ hasText: rowFilter }).first().waitFor({ timeout: 25000 });
    const [download] = await Promise.all([
      t.waitForEvent('download', { timeout: 20000 }),
      t.getByRole('button', { name: /export/i }).first().click(),
    ]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    // Quoted CSV, one record per line, no embedded newlines in these fields.
    const cells = (line) => line.split('","').map((c) => c.replace(/^"|"$/g, ''));
    const [head, ...rest] = text.split(/\r?\n/).filter(Boolean).map(cells);
    return { head, rows: rest.map((r) => Object.fromEntries(r.map((v, i) => [head[i], v]))) };
  };

  // C&P: the brush was received on the GRN and is waiting for QC.
  const cpApi = ((await tApi('/ims/overview?limit=200')).data || []).find((r) => r.skuCode === 'E2E-BRUSH');
  const cpRowText = (await t.getByRole('row').filter({ hasText: 'E2E-BRUSH' }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const cp = await csvRows(`${APP}/ims/stock`, 'E2E-BRUSH');
  const cpCsv = cp.rows.find((r) => r['SKU Code'] === 'E2E-BRUSH');
  check('11a. C&P: the API reports the received qty as Awaiting QC, not as stock',
    cpApi?.awaitingQc > 0 && cpApi.onHand === 0, `awaitingQc ${cpApi?.awaitingQc} · onHand ${cpApi?.onHand}`);
  check('11b. C&P CSV keeps its existing columns and ends with Awaiting QC',
    cp.head[0] === 'S.No.' && cp.head[4] === 'Available Qty' && cp.head[cp.head.length - 1] === 'Awaiting QC',
    cp.head.join(' | '));
  check('11c. C&P CSV reconciles with the API row (Awaiting QC and Available Qty)',
    Number(cpCsv['Awaiting QC']) === cpApi.awaitingQc && Number(cpCsv['Available Qty']) === cpApi.onHand,
    `csv awaiting ${cpCsv?.['Awaiting QC']} / avail ${cpCsv?.['Available Qty']} vs api ${cpApi?.awaitingQc} / ${cpApi?.onHand}`);
  check('11d. …and the same number is on screen', new RegExp(`\\b${cpApi.awaitingQc}\\b`).test(cpRowText), cpRowText.slice(0, 160));

  // RM: the coil was received at JW001 and is waiting for QC there.
  const rmApi = ((await tApi('/rm-ims/overview?limit=200')).data || []).find((r) => r.skuCode === 'E2E-COIL');
  const rm = await csvRows(`${APP}/rm-ims/stock`, 'E2E-COIL');
  const rmCsv = rm.rows.find((r) => r['SKU Code'] === 'E2E-COIL');
  check('11e. RM CSV ends with Awaiting QC too, and reconciles with the API row',
    rm.head[rm.head.length - 1] === 'Awaiting QC' && Number(rmCsv['Awaiting QC']) === rmApi.awaitingQc
    && rmApi.awaitingQc > 0 && rmApi.onHand === 0,
    `csv ${rmCsv?.['Awaiting QC']} vs api ${rmApi?.awaitingQc} · onHand ${rmApi?.onHand}`);
  await t.close();
}

// ── 4. MD approval is recorded, never awaited ────────────────────────────────
console.log('\n── 4. MD approval: recorded, not blocking ──');
const grnRes = (await api(`/procurement/grns?search=${encodeURIComponent(grnNo)}`)).data?.[0];
check('the GRN\'s MD approval is raised and pending', grnRes?.approvalStatus === 'READY_FOR_MD_APPROVAL', grnRes?.approvalStatus);
check('QC can be saved before the MD signs', !(await section.getByRole('button', { name: 'Save QC Draft' }).isDisabled()));
await shot('03-qc-open-unsigned');

// ── 5. QC open without any MD signature ──────────────────────────────────────
check('5. QC open without an MD signature', (await qcStatus()) === 'QC Pending', await qcStatus());
check('…next action: Complete QC, accepted qty posts then', /^Next action: Complete QC — accepted quantities are then posted/.test(await nextText()), await nextText());
check('…still no stock before the QC', (await stockOf('E2E-COIL')) === 0);

// ── 6. Complete QC (double click) ─────────────────────────────────────────────
console.log('\n── 6. Complete QC ──');
const qty = (field, item) => section.getByLabel(`${field} — ${item}`, { exact: true });
await qty('Accepted', 'E2E Coil 1250mm').fill('480');
await qty('Rejected', 'E2E Coil 1250mm').fill('20');
await qty('Accepted', 'E2E Brush 5in').fill('36');
await qty('Rejected', 'E2E Brush 5in').fill('4');
await section.getByRole('button', { name: 'Save QC Draft' }).click();
await page.waitForTimeout(2000);
await section.getByRole('button', { name: 'Complete GRN + QC' }).click();
const qdlg = dialogTitled(/^Complete QC/);
await qdlg.waitFor({ timeout: 10000 });
const note = (await qdlg.getByTestId('qc-complete-stock-note').innerText()).replace(/\s+/g, ' ');
check('QC dialog: accepted 516 posts now, rejected 24 never enters stock', /Accepted 516 will be posted to stock now/.test(note) && /Rejected 24 will not enter stock/.test(note), note);
await shot('04-qc-confirm');
await qdlg.getByRole('button', { name: 'Complete QC' }).dblclick();
await qdlg.waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(2500);
check('QC Completed · Partial', (await qcStatus()) === 'QC Completed · Partial', await qcStatus());
check('7. accepted stock now in inventory: coil 480, brush 36 (rejected not usable)',
  (await stockOf('E2E-COIL')) === 480 && (await stockOf('E2E-BRUSH')) === 36, `coil ${await stockOf('E2E-COIL')} brush ${await stockOf('E2E-BRUSH')}`);
check('completed QC is read-only', (await section.locator('input[type=number]').count()) === 0);

// ── 7/8/9. GRN page: destinations, statuses, movements ───────────────────────
console.log('\n── GRN page after QC ──');
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(2000);
const stockCells = (await page.getByTestId('grn-line-stock').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
check('line Stock column: coil RM IMS · JW001 Posted 480, brush C&P IMS · MAIN Posted 36, service not received',
  stockCells.some((t) => /RM IMS · JW001 Posted 480 MOV-/.test(t)) && stockCells.some((t) => /C&P IMS · MAIN Posted 36 MOV-/.test(t)), stockCells.join(' | '));
const body = await page.locator('body').innerText();
check('GRN page: Stock Posting after QC — no MD signature in it (no manual Inventory Type)', /Stock Posting\s*After QC/i.test(body) && !/After MD signature/i.test(body) && !/Inventory Type \(earlier GRN\)/i.test(body));
const mov = (await api(`/inventory/movements/by-ref/GRN/${grnRes._id}`)).data || [];
check('9. two GRN_IN movements, dated today (QC completion), referencing the GRN',
  mov.length === 2 && mov.every((m) => m.txnType === 'GRN_IN' && m.refNumber === grnNo && new Date(m.movementDate).toDateString() === new Date().toDateString()),
  mov.map((m) => `${m.skuCode}:${m.quantity}@${m.warehouse}`).join(', '));
check('10. double clicks did not duplicate anything', mov.length === 2);
check('…all of it posted while the GRN was still awaiting the MD', (await api(`/procurement/grns/${grnRes._id}`)).data?.approvalStatus === 'READY_FOR_MD_APPROVAL');
await signGrnFromCard(page);
check('the MD signs afterwards from the GRN page — QC result and stock unchanged',
  (await api(`/procurement/grns/${grnRes._id}`)).data?.approvalStatus === 'MD_APPROVED' && ((await api(`/inventory/movements/by-ref/GRN/${grnRes._id}`)).data || []).length === 2);
await shot('05-grn-page-after-qc');

// ── 13. RM IMS and C&P IMS ───────────────────────────────────────────────────
console.log('\n── IMS screens ──');
await go(`${APP}/rm-ims/stock`);
await page.getByRole('row').filter({ hasText: 'E2E-COIL' }).first().waitFor({ timeout: 20000 });
const coilRow = (await page.getByRole('row').filter({ hasText: 'E2E-COIL' }).first().innerText()).replace(/\s+/g, ' ');
check('RM IMS lists the coil with 480 on hand and nothing awaiting QC', /480/.test(coilRow) && !/awaiting QC/.test(coilRow), coilRow.slice(0, 160));
await go(`${APP}/ims/stock`);
await page.getByRole('row').filter({ hasText: 'E2E-BRUSH' }).first().waitFor({ timeout: 20000 });
const brushRow = (await page.getByRole('row').filter({ hasText: 'E2E-BRUSH' }).first().innerText()).replace(/\s+/g, ' ');
check('C&P IMS lists the brush with 36', /\b36\b/.test(brushRow), brushRow.slice(0, 160));
await shot('06-ims');

// ── 12. Legacy GRN still accessible ──────────────────────────────────────────
console.log('\n── Legacy GRN ──');
await go(`${APP}/procurement/grns`);
await page.getByText('GRN-QG-UI-LEGACY', { exact: true }).first().click({ timeout: 15000 });
await page.waitForSelector('#grn-qc-section', { timeout: 15000 });
await page.waitForTimeout(1200);
const legacyBody = await page.locator('body').innerText();
check('legacy GRN opens, shows its earlier Inventory Type field and its completed QC',
  // Field labels are upper-cased by CSS, and innerText returns them as rendered.
  /Inventory Type \(earlier GRN\)/i.test(legacyBody) && /QC Completed/i.test(legacyBody));
await shot('07-legacy');

// ── responsive: the GRN page at phone width ──────────────────────────────────
await page.setViewportSize({ width: 390, height: 844 });
await go(page.url());
await page.waitForTimeout(1200);
check('GRN page has no horizontal page scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n[qcGatedGrn] ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
