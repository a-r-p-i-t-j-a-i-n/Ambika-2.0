/**
 * A read-only tour of every screen that holds the demo records — and a check
 * that each one actually SHOWS them.
 *
 *   node e2e/demoTour.e2e.mjs
 *
 * Run after the demo has been built (e2eDemoFlowFixture.js --purchase, then
 * fullFlow.e2e.mjs with BATCH_PREFIX=DEMO-COIL). It changes nothing: every
 * step opens a page, asserts the record numbers it should list are rendered,
 * and screenshots it — so no screenshot is a blank or still-loading page.
 *
 * Record ids are read from the app's own list endpoints, the same ones the
 * screens call, so the tour follows whatever numbers the flow produced.
 *
 * Expects: backend :5099 (ambika_e2e_fullflow), frontend :3100.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
const USER = { email: 'fullflow-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/demo-tour';
const BATCHES = ['DEMO-COIL-001', 'DEMO-COIL-002', 'DEMO-COIL-003'];
const COILS = ['JSL204-07', 'JSL204-08', 'JSL202-06'];

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
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.url().split('/api/v1')[1]}`); });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });

  /** GET through the app's own API, as the logged-in user. */
  const get = (p) => page.evaluate(async ({ api, p }) => {
    const r = await fetch(`${api}${p}`, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
    const j = await r.json();
    return j?.data ?? j;
  }, { api: API, p });

  const indents = await get('/procurement/indents?limit=50');
  const pos = await get('/procurement/purchase-orders?limit=50');
  const fus = await get('/procurement/follow-ups?limit=50');
  const grns = await get('/procurement/grns?limit=50');
  const byCoil = await get('/scrap-ims/by-coil?limit=50');
  const skus = await get('/skus?limit=100');
  const list = (x) => (Array.isArray(x) ? x : (x?.docs || x?.items || []));
  const skuId = Object.fromEntries(list(skus).map((s) => [s.code, s._id]));

  const indentNos = list(indents).map((i) => i.indentNumber);
  const poNos = list(pos).map((p) => p.poNumber);
  const fuNos = list(fus).map((f) => f.followUpNumber);
  const grnNos = list(grns).map((g) => g.grnNumber);
  console.log(`indents ${indentNos.join(', ')}\nPOs ${poNos.join(', ')}\nfollow-ups ${fuNos.join(', ')}\nGRNs ${grnNos.join(', ')}`);

  let n = 0;
  /** Open a page, wait until EVERY expected string is rendered, screenshot it. */
  const visit = async (name, url, mustShow = []) => {
    n += 1;
    const tag = `${String(n).padStart(2, '0')}-${name}`;
    await page.goto(`${APP}${url}`, { waitUntil: 'domcontentloaded' });
    await ready();
    const deadline = Date.now() + 25000;
    let missing = mustShow;
    while (Date.now() < deadline) {
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      missing = mustShow.filter((s) => !text.includes(s));
      if (!missing.length) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${tag}.png`, fullPage: true });
    check(`${tag}  ${url}`, missing.length === 0, missing.length ? `not shown: ${missing.join(', ')}` : '');
  };

  /* ── Purchase FMS ── */
  await visit('purchase-fms', '/purchase-fms', []);
  await visit('vendors', '/procurement/vendors', ['Demo Steel Traders', 'Demo Coil Suppliers', 'Demo Metals Co', 'Demo Alternate Supplier']);
  await visit('indents', '/procurement/indents', indentNos);
  for (const i of list(indents)) await visit(`indent-${i.indentNumber.replace(/\W+/g, '_')}`, `/procurement/indents/${i._id}`, [i.indentNumber]);
  await visit('purchase-orders', '/procurement/purchase-orders', poNos);
  for (const p of list(pos)) await visit(`po-${p.poNumber.replace(/\W+/g, '_')}`, `/procurement/purchase-orders/${p._id}`, [p.poNumber, p.vendorName]);
  await visit('follow-ups', '/procurement/follow-ups', fuNos);

  /* ── GRN ── */
  await visit('grns', '/procurement/grns', grnNos);
  for (const g of list(grns)) {
    await visit(`grn-${g.grnNumber.replace(/\W+/g, '_')}`, `/procurement/grns/${g._id}`,
      [g.grnNumber, g.poNumber, g.items?.[0]?.batchNo, g.rmReceivedAtLocation].filter(Boolean));
  }

  /* ── RM IMS ── */
  await visit('rm-dashboard', '/rm-ims', []);
  await visit('rm-stock', '/rm-ims/stock', COILS);
  for (const c of COILS) await visit(`rm-item-${c}`, `/rm-ims/item/${skuId[c]}`, [c]);
  await visit('rm-movements', '/rm-ims/movements', BATCHES);
  await visit('cut-coils-history', '/rm-ims/conversion', BATCHES);

  /* ── Circle stock ── */
  for (const c of ['JSL204-07-700', 'JSL204-07-750', 'JSL204-08-850', 'JSL202-06-700']) {
    await visit(`circle-${c}`, `/rm-ims/item/${skuId[c]}`, [c]);
  }

  /* ── Scrap IMS ── */
  await visit('scrap-dashboard', '/scrap-ims', []);
  await visit('scrap-register', '/scrap-ims/records', BATCHES);
  await visit('scrap-movements', '/scrap-ims/movements', ['285 kg']);
  await visit('scrap-by-physical-coil', '/scrap-ims/by-coil', BATCHES);
  for (const r of list(byCoil)) {
    await visit(`coil-lineage-${r.batchNo}`, `/rm-ims/coil/${r.coilReceiptId}`, [r.batchNo, r.grnNo].filter(Boolean));
  }

  await browser.close();
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} screens show their records.`);
  console.log(`pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length} apiErrors=${apiErrors.length}`);
  [...pageErrors, ...consoleErrors, ...apiErrors].slice(0, 8).forEach((e) => console.log(`  ! ${e}`));
  process.exit(failed.length || pageErrors.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
