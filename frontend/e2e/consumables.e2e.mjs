/**
 * Consumables & Packing — Stock List, Item Detail and Dashboard, read in a real
 * browser and checked against the documented formulas.
 *
 *   node e2e/consumables.e2e.mjs
 *
 * The fixture (backend/src/scripts/e2eConsumablesFixture.js) seeds six SKUs that
 * between them hit every planning branch — steady consumption, consumed to
 * zero, never consumed (ADC 0), overstocked, at the reorder point, and one with
 * no policy row at all. Every expected number is hand-computable from the
 * formulas, so this checks what the OPERATOR sees, not merely that the API
 * agrees with itself.
 *
 * Expects (started separately):
 *   backend  :5099  against the ambika_cp_e2e scratch database
 *   frontend :3100  with VITE_API_URL pointing at :5099
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertE2ESetup } from './_e2eSafety.mjs';

const APP = 'http://127.0.0.1:3100';
// Guarded e2e backend (scratch DB, S3 + email off) and a frontend pointed at it — or stop.
await assertE2ESetup(APP, 'http://127.0.0.1:5099/api/v1', 'consumables.e2e.mjs');
const USER = { email: 'cp-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

/** Hand-computed from the documented formulas; mirrors the fixture. */
const EXPECT = {
  'CPE-STEADY': { onHand: 100, adc: 10, maxLevel: 400, reorder: 160, status: 'REORDER' },
  'CPE-EMPTY': { onHand: 0, adc: 5.56, maxLevel: 222.4, reorder: 88.96, status: 'OUT_OF_STOCK' },
  'CPE-NOCONS': { onHand: 250, adc: 0, maxLevel: 0, reorder: 0, status: 'OK' },
  'CPE-OVER': { onHand: 8910, adc: 1, maxLevel: 40, reorder: 16, status: 'OVERSTOCK' },
  'CPE-REORDER': { onHand: 100, adc: 10, maxLevel: 400, reorder: 160, status: 'REORDER' },
  // No policy row ⇒ Consumables plans on CONSUMABLES_DEFAULT_LEAD_DAYS (16):
  // 5 × 16 × 1.5 = 120 max, 5 × 16 = 80 reorder. On-hand 150 is above the
  // reorder point and not past max × 1.25 (=150), so it reads Healthy.
  'CPE-NOPOLICY': { onHand: 150, adc: 5, maxLevel: 120, reorder: 80, status: 'OK' },
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = []; const consoleErrors = []; const apiErrors = [];

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

/** Numbers render grouped ("8,910") and sometimes with a unit. */
const hasNumber = (text, n) => {
  const plain = String(n);
  const grouped = Number(n).toLocaleString('en-IN');
  const grouped2 = Number(n).toLocaleString('en-US');
  return [plain, grouped, grouped2].some((v) => text.includes(v));
};

const main = async () => {
  const exe = findChromium();
  console.log(`Chromium: ${exe || '(playwright default)'}`);
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url().replace(APP, '')} :: ${m.text().slice(0, 180)}`); });
  page.on('pageerror', (e) => pageErrors.push(`${page.url().replace(APP, '')} :: ${e.message.slice(0, 180)}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
  });

  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
  // index.html drops its boot splash from a MutationObserver attached on
  // DOMContentLoaded; when React mounts first the observer never fires and the
  // overlay swallows clicks. Pre-existing — cleared here, not patched.
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };

  console.log('\n── Login ──');
  await go(APP);
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  check('login succeeds', true);

  // ── Stock List ─────────────────────────────────────────────────────────────
  console.log('\n── Stock List (/ims/stock) ──');
  await go(`${APP}/ims/stock`);
  await page.waitForTimeout(2500);
  await shot('cp-01-stock-list');

  for (const col of ['Available Qty', 'Reorder at', 'Max Level', 'Status']) {
    check(`column "${col}" is present`, (await page.getByText(col, { exact: true }).count()) > 0);
  }

  for (const [code, e] of Object.entries(EXPECT)) {
    const row = page.locator('tr', { hasText: code }).first();
    if (!(await row.count())) { check(`${code} appears in the stock list`, false, 'row not found'); continue; }
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    check(`${code} on-hand ${e.onHand}`, hasNumber(text, e.onHand), text.slice(0, 90));
    check(`${code} Max Level ${e.maxLevel}`, hasNumber(text, e.maxLevel), '');
    check(`${code} Reorder at ${e.reorder}`, hasNumber(text, e.reorder), '');
  }

  // The words the UI actually prints, from STOCK_TOKENS in imsTheme.js — not
  // the enum names. The SKU code is stripped out of the row text first, because
  // "CPE-REORDER" contains "REORDER" and would match its own name rather than
  // the status chip.
  const STATUS_TEXT = {
    OK: 'Healthy', LOW: 'Running low', REORDER: 'Order now',
    OUT_OF_STOCK: 'Out of stock', OVERSTOCK: 'Overstocked',
  };
  for (const [code, e] of Object.entries(EXPECT)) {
    const row = page.locator('tr', { hasText: code }).first();
    if (!(await row.count())) continue;
    const text = (await row.innerText()).split(code).join(' ').replace(/\s+/g, ' ');
    check(`${code} status reads "${STATUS_TEXT[e.status]}"`,
      text.toLowerCase().includes(STATUS_TEXT[e.status].toLowerCase()), text.slice(0, 80));
  }

  // ── Item Detail ────────────────────────────────────────────────────────────
  console.log('\n── Item Detail (/ims/item/:skuId) ──');
  // The ADC-0 item is the interesting one: Days Cover must read as unknown.
  for (const code of ['CPE-STEADY', 'CPE-NOCONS']) {
    await go(`${APP}/ims/stock`);
    await page.waitForTimeout(2000);
    await page.locator('tr', { hasText: code }).first().click();
    await page.waitForTimeout(2500);
    const onDetail = /\/ims\/item\//.test(page.url());
    check(`${code} opens its detail page`, onDetail, page.url().replace(APP, ''));
    if (!onDetail) continue;
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const e = EXPECT[code];
    check(`${code} detail shows Max Level ${e.maxLevel}`, hasNumber(body, e.maxLevel));
    check(`${code} detail shows on-hand ${e.onHand}`, hasNumber(body, e.onHand));
    if (code === 'CPE-NOCONS') {
      // ADC 0 ⇒ Days Cover is unknown, and must not be rendered as "0 days".
      check('ADC-0 item does not claim 0 days of cover', !/\b0\s*days?\s*(of\s*)?cover/i.test(body));
    }
    await shot(`cp-02-detail-${code}`);
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  console.log('\n── Dashboard (/ims) ──');
  await go(`${APP}/ims`);
  await page.waitForTimeout(3000);
  await shot('cp-03-dashboard');
  // KpiTile prints its label with textTransform: uppercase, so innerText gives
  // "ITEMS TRACKED". Match case-insensitively rather than against the JSX text.
  const dash = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const dashLower = dash.toLowerCase();
  for (const tile of ['Items tracked', 'Closing Stock', 'Value in store', 'To order now', 'Running low']) {
    check(`dashboard tile "${tile}"`, dashLower.includes(tile.toLowerCase()));
  }
  check('dashboard counts all 6 fixture items', hasNumber(dash, 6), '');
  // Closing Stock total = 100 + 0 + 250 + 8910 + 100 + 150 = 9510
  check('dashboard Closing Stock totals 9,510', hasNumber(dash, 9510), '');
  // needBuying = reorder (CPE-STEADY, CPE-REORDER) + outOfStock (CPE-EMPTY) = 3.
  // The tile renders value then label, so look either side of the label.
  check('dashboard "To order now" counts 3',
    /3[\s\S]{0,60}to order now|to order now[\s\S]{0,60}\b3\b/.test(dashLower), '');

  await browser.close();

  console.log('\n────────────────────────────────────────');
  console.log(`page errors : ${pageErrors.length}`); pageErrors.slice(0, 6).forEach((e) => console.log('   ' + e));
  console.log(`console errs: ${consoleErrors.length}`); consoleErrors.slice(0, 6).forEach((e) => console.log('   ' + e));
  console.log(`api >=400   : ${apiErrors.length}`); [...new Set(apiErrors)].slice(0, 6).forEach((e) => console.log('   ' + e));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.error('\nDriver crashed:', e.message); console.error(e.stack); process.exit(1); });
