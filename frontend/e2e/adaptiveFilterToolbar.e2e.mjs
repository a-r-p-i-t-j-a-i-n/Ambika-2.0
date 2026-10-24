/**
 * PURCHASE FMS — single-row adaptive filter toolbar (AdaptiveFilterBar).
 *
 *   node e2e/adaptiveFilterToolbar.e2e.mjs
 *
 * Secondary filters render inline while they fit; only the ones that don't
 * move into the "More filters" panel, recomputed live as the row resizes.
 *
 * Checks, on the 11 Purchase FMS list screens:
 *   - a live resize 1920 → 1440 → 1280 → 768 → 390 → 360 → 768 → 1920:
 *     one row, nothing clipped past the row's edge, no page-level horizontal
 *     scroll, Search + the pinned primary filter visible and never duplicated
 *   - GRN: a Vendor value set inline survives a resize that moves the field
 *     into the panel and back; the trigger's badge counts it while hidden
 *   - Vouchers: Category is gated on Type = Expense inline and in the panel,
 *     and is gone entirely once Type is cleared
 *   - Vendor Invoices: Workflow Chip → Status (precise) sync, and a precise
 *     status picked inside the panel resets the chips to "All"
 *
 * Seeds one throwaway Party (the scratch DB's parties master starts empty —
 * parties are normally auto-created by order entry), so the Vendor
 * Autocomplete has an option to pick.
 *
 * Expects (started separately), exactly as purchase.e2e.mjs does:
 *   cd backend
 *   node src/scripts/e2ePurchaseFixture.js --seed       # always ambika_e2e_purchase
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_purchase node src/scripts/e2eServer.js
 *   cd frontend
 *   VITE_API_URL=http://127.0.0.1:5099/api/v1 npx vite --port 3100 --host 127.0.0.1
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
await assertE2ESetup(APP, API, 'adaptiveFilterToolbar.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const VENDOR = 'E2E Adaptive Filter Vendor';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { failures.push(`${name}: ${detail}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const SCREENS = [
  { route: '/procurement/indents', searchId: 'indent-search', pinnedId: 'indent-approval' },
  { route: '/procurement/purchase-orders', searchId: 'po-search', pinnedId: 'po-status' },
  { route: '/procurement/proforma-invoices', searchId: 'pi-search', pinnedId: 'pi-status' },
  { route: '/procurement/advance-payments', searchId: 'ap-search', pinnedId: 'ap-status' },
  { route: '/procurement/grns', searchId: 'grn-search', pinnedId: 'grn-status' },
  { route: '/procurement/incoming-qc', searchId: 'qc-search', pinnedId: 'qc-status' },
  { route: '/procurement/vendor-invoices', searchId: 'vi-search', pinnedId: null },
  { route: '/procurement/vouchers', searchId: 'vo-search', pinnedId: 'vo-status' },
  { route: '/procurement/tally-entries', searchId: 'te-search', pinnedId: 'te-status' },
  { route: '/procurement/final-payments', searchId: 'fp-search', pinnedId: 'fp-status' },
  { route: '/procurement/follow-ups', searchId: 'fu-search', pinnedId: 'fu-status' },
];
const RESIZE_SEQUENCE = [1920, 1440, 1280, 768, 390, 360, 768, 1920];

const run = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChromium(),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`); });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };
  const go = async (route) => {
    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
    await ready();
    await page.getByTestId('pfms-filter-row').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(800);
  };
  const resize = async (width) => { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(450); };
  const moreButton = () => page.getByRole('button', { name: 'More filters' });
  const moreBadge = async () => (await page.getByTestId('pfms-filter-more-badge').locator('.MuiBadge-badge').innerText().catch(() => '')).trim();
  const closePanel = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(350); };
  const combo = (name) => page.getByRole('combobox', { name });

  // Every direct child of the filter row must end inside the row — the row
  // clips with overflow:hidden, so a field pushed past its edge would never
  // show up as page-level horizontal scroll.
  const rowGeometry = () => page.evaluate(() => {
    const row = document.querySelector('[data-testid="pfms-filter-row"]');
    const r = row.getBoundingClientRect();
    const kids = [...row.children].map((c) => c.getBoundingClientRect());
    return {
      clipped: kids.filter((k) => k.right > r.right + 1 || k.left < r.left - 1).length,
      oneRow: kids.every((k) => Math.abs(k.bottom - kids[0].bottom) < 2),
      children: kids.length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  // ── Login ──
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  const api = (p, init) => page.evaluate(async ([url, opts]) => {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts?.headers || {}) },
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  }, [`${API}${p}`, init]);
  const existing = await api(`/parties?search=${encodeURIComponent(VENDOR)}&limit=1`);
  if (!(existing.body?.meta?.total > 0)) {
    const created = await api('/parties', { method: 'POST', body: JSON.stringify({ name: VENDOR }) });
    check('fixture: throwaway vendor party created', created.ok, String(created.status));
  }

  // ── Live resize sweep on every screen ──
  section(`Live resize sweep — ${RESIZE_SEQUENCE.join(' → ')}`);
  for (const s of SCREENS) {
    await resize(RESIZE_SEQUENCE[0]);
    await go(s.route);
    const problems = [];
    let sawTrigger = false;
    let sawAllInline = false;
    for (const width of RESIZE_SEQUENCE) {
      await resize(width);
      const g = await rowGeometry();
      const trigger = (await moreButton().count()) > 0;
      if (trigger) sawTrigger = true; else sawAllInline = true;
      if (g.clipped) problems.push(`${width}: ${g.clipped} control(s) clipped`);
      if (!g.oneRow) problems.push(`${width}: wrapped`);
      if (g.scrollWidth > g.clientWidth + 1) problems.push(`${width}: page scrolls ${g.scrollWidth}>${g.clientWidth}`);
      if (!(await page.locator(`#${s.searchId}`).isVisible())) problems.push(`${width}: Search hidden`);
      if ((await page.locator(`#${s.searchId}`).count()) !== 1) problems.push(`${width}: Search duplicated`);
      if (s.pinnedId && !(await page.locator(`#${s.pinnedId}`).isVisible())) problems.push(`${width}: primary filter hidden`);
      if (width === 360) await page.screenshot({ path: `${SHOTS}/adaptive${s.route.replace(/\//g, '_')}-360.png` }).catch(() => {});
    }
    check(`${s.route}: one clean row at every width, both directions`, problems.length === 0, problems.join('; '));
    check(`${s.route}: everything inline when wide, overflow trigger when narrow`, sawTrigger && sawAllInline,
      `trigger seen=${sawTrigger}, all-inline seen=${sawAllInline}`);
  }

  // ── GRN: Vendor value survives inline ↔ overflow ──
  section('GRN — Vendor value survives moving between the row and the panel');
  await resize(1920);
  await go('/procurement/grns');
  check('wide: no overflow trigger, Vendor is inline', (await moreButton().count()) === 0 && await combo('Vendor').isVisible());
  await combo('Vendor').click();
  await page.getByRole('option', { name: VENDOR }).click();
  await page.waitForTimeout(800);
  check('wide: Vendor shows the chosen value', (await combo('Vendor').inputValue()) === VENDOR, await combo('Vendor').inputValue());

  await resize(390);
  check('narrow: the overflow trigger appears', await moreButton().isVisible());
  check('narrow: Vendor is no longer in the row', (await combo('Vendor').count()) === 0);
  check('narrow: the trigger badge counts the hidden active filter', (await moreBadge()) === '1', await moreBadge());
  await moreButton().click();
  await page.waitForTimeout(400);
  check('narrow: Vendor kept its value inside the panel', (await combo('Vendor').inputValue()) === VENDOR, await combo('Vendor').inputValue());
  check('narrow: Clear all is offered (inside the panel when the row is full)',
    (await page.getByRole('button', { name: 'Clear all' }).count()) === 1);
  await closePanel();

  await resize(1920);
  check('wide again: Vendor back inline with its value', (await combo('Vendor').inputValue()) === VENDOR, await combo('Vendor').inputValue());
  check('wide again: exactly one Vendor control', (await combo('Vendor').count()) === 1);
  check('wide again: overflow trigger gone', (await moreButton().count()) === 0);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.waitForTimeout(600);
  check('Clear all empties Vendor', (await combo('Vendor').inputValue()) === '', await combo('Vendor').inputValue());

  // ── Vouchers: Type → Category gating ──
  section('Vouchers — Category gated on Type = Expense, inline and in the panel');
  await resize(1920);
  await go('/procurement/vouchers');
  check('wide: no Category before Type is set', (await combo(/^Category/).count()) === 0);
  await combo(/^Type/).click();
  await page.getByRole('option', { name: 'Expense / Direct Bill' }).click();
  await page.waitForTimeout(700);
  check('wide: Category appears inline once Type = Expense', await combo(/^Category/).isVisible());

  await resize(390);
  check('narrow: Category moved out of the row', (await combo(/^Category/).count()) === 0);
  await moreButton().click();
  await page.waitForTimeout(400);
  check('narrow: Category is in the panel', await combo(/^Category/).isVisible());
  await combo(/^Type/).click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  await page.waitForTimeout(700);
  check('narrow: clearing Type removes Category entirely', (await combo(/^Category/).count()) === 0);
  await closePanel();
  await resize(1920);
  check('wide again: Category still absent', (await combo(/^Category/).count()) === 0);

  // ── Vendor Invoices: chip ↔ Status (precise) ──
  section('Vendor Invoices — Workflow Chips ↔ Status (precise), inline and in the panel');
  await resize(1920);
  await go('/procurement/vendor-invoices');
  const chip = (name) => page.getByRole('button', { name, exact: true });
  const precise = async () => (await combo(/^Status \(precise\)/).innerText()).trim();
  await chip('Paid / Short Closed').click();
  await page.waitForTimeout(800);
  check('wide: the chip sets Status (precise)', (await precise()) === 'PAYMENT COMPLETED', await precise());

  await resize(390);
  check('narrow: the chip stays selected', ((await chip('Paid / Short Closed').getAttribute('class')) || '').includes('MuiChip-filled'));
  await moreButton().click();
  await page.waitForTimeout(400);
  check('narrow: Status (precise) in the panel shows the chip\'s status', (await precise()) === 'PAYMENT COMPLETED', await precise());
  await combo(/^Status \(precise\)/).click();
  await page.getByRole('option', { name: 'DRAFT', exact: true }).click();
  await page.waitForTimeout(700);
  check('narrow: picking a precise status in the panel applies it', (await precise()) === 'DRAFT', await precise());
  await closePanel();
  check('narrow: …and resets the Workflow Chips to "All"', ((await chip('All').getAttribute('class')) || '').includes('MuiChip-filled'));
  await resize(1920);
  check('wide again: Status (precise) inline keeps DRAFT', (await precise()) === 'DRAFT', await precise());

  section('Console health');
  const unexpected = consoleErrors.filter((e) => !/401|Failed to log in/.test(e));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n  ${passed}/${passed + failures.length} checks passed.`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
};

run().catch((e) => { console.error('\nAdaptive filter toolbar audit failed:', e); process.exitCode = 1; });
