/**
 * Layout audit — no page may make the BROWSER WINDOW scroll sideways.
 *
 *   node e2e/layoutOverflow.e2e.mjs            every route, three desktop sizes
 *   ROUTES=/purchase-fms,/ims node e2e/…       only these
 *
 * Runs Chromium with real (non-overlay) scrollbars, as Windows draws them —
 * headless Chrome hides scrollbars by default, which hides exactly the bug this
 * looks for: a page whose content is wider than the window by the width of the
 * vertical scrollbar. For every route, at 1366×768, 1440×900 and 1920×1080 with
 * the sidebar expanded, and at 1366×768 collapsed, it checks:
 *
 *   • document.documentElement.scrollWidth ≤ clientWidth — the window does not
 *     scroll sideways; a wide table may scroll inside its own container;
 *   • which elements stick out past the window, if any (outermost only, and
 *     never one already contained by a scrolling / clipping ancestor);
 *   • the page still scrolls vertically when it is taller than the window;
 *   • the main content area stays inside the window beside the sidebar.
 *
 * Read-only: it opens pages and changes nothing. `:id` routes use real records
 * from the scratch database.
 *
 * Expects (started separately):
 *   backend  :5099  e2eServer.js on ambika_e2e_fullflow (seeded by e2eFullFlowFixture.js --seed)
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
await assertE2ESetup(APP, API, 'layoutOverflow.e2e.mjs');
const USER = { email: 'fullflow-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/layout';

// Every route in App.jsx (login and the catch-all aside); `:id` filled below.
const ROUTES = [
  '/dashboard', '/dispatch-control-tower', '/profile', '/employees', '/orders', '/dispatch-planning', '/dispatch-planning/calendar',
  '/dispatch-planning/plan-vs-actual', '/dispatch-planning/generate-pdf', '/ppc-planning', '/production-planning', '/challans',
  '/challans/generate-pdf', '/o2d/invoice-entry', '/o2d/invoice-email', '/o2d/dispatch-schedule-email', '/o2d/track-delivery',
  '/o2d/payments', '/o2d/transport-bill',
  '/ims', '/ims/stock', '/ims/stock-in', '/ims/stock-out', '/ims/reorder', '/ims/movements',
  '/rm-ims', '/rm-ims/stock', '/rm-ims/stock-in', '/rm-ims/stock-out', '/rm-ims/conversion', '/rm-ims/reorder', '/rm-ims/movements',
  '/scrap-ims', '/scrap-ims/records', '/scrap-ims/by-coil', '/scrap-ims/scrap-in', '/scrap-ims/scrap-out', '/scrap-ims/movements',
  '/fg-ims', '/fg-ims/stock', '/fg-ims/production-in', '/fg-ims/dispatch-out', '/fg-ims/planning', '/fg-ims/movements',
  '/ppc/dpr', '/ppc/dpr/register', '/ppc/dpr/new', '/ppc/dpr/machine', '/ppc/dpr/production', '/ppc/dpr/operator', '/ppc/dpr/mis', '/ppc/dpr/masters',
  '/invoices', '/skus', '/parties', '/machines', '/machine-operators', '/access-control',
  '/pricing', '/pricing/approvals', '/pricing/calculator', '/pricing/documents', '/pricing/analytics', '/quotes', '/quotes/drafts',
  '/o2d-fms', '/o2d-fms/all-tasks', '/o2d-fms/processes', '/o2d-fms/steps', '/o2d-fms/master', '/o2d-fms/master-data', '/o2d-fms/transporters',
  '/order-intake', '/o2d-fms/dashboard', '/o2d-fms/config', '/o2d-fms/templates', '/o2d-fms/scores',
  '/purchase-fms', '/fms/doer-assignment', '/fms/my-tasks',
  '/procurement/indents', '/procurement/purchase-orders', '/procurement/follow-ups', '/procurement/proforma-invoices',
  '/procurement/advance-payments', '/procurement/grns', '/procurement/service-completions', '/procurement/incoming-qc',
  '/procurement/vendor-invoices', '/procurement/vouchers', '/procurement/tally-entries', '/procurement/final-payments',
  '/procurement/master-data', '/procurement/vendors',
];
const SIZES = [[1366, 768], [1440, 900], [1920, 1080]];

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  if (!pass || process.env.VERBOSE) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];

const run = async () => {
  // No --hide-scrollbars: real 15–17 px scrollbars, as on Windows.
  const browser = await chromium.launch({ headless: true, executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
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

  // Real records for the `:id` routes.
  const api = (p) => page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }, `${API}${p}`);
  const firstId = async (p, pick = (d) => d?.data?.[0]?._id) => { const r = await api(p); return pick(r) || null; };
  const ids = {
    po: await firstId('/procurement/purchase-orders?limit=1'),
    grn: await firstId('/procurement/grns?limit=1'),
    sku: await firstId('/skus?limit=1'),
    coil: await firstId('/rm-ims/cutting-history?limit=1', (d) => d?.data?.[0]?.coilId),
    rmSku: await firstId('/rm-ims/overview', (d) => d?.data?.[0]?.skuId),
  };
  const routes = [...ROUTES];
  if (ids.po) routes.push(`/procurement/purchase-orders/${ids.po}`);
  if (ids.grn) routes.push(`/procurement/grns/${ids.grn}`);
  if (ids.coil) routes.push(`/rm-ims/coil/${ids.coil}`);
  if (ids.rmSku) routes.push(`/rm-ims/item/${ids.rmSku}`);
  if (ids.sku) routes.push(`/ims/item/${ids.sku}`);
  const only = (process.env.ROUTES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = only.length ? only : routes;

  // What sticks out past the window: the outermost element whose right edge is
  // beyond it and that no scrolling / clipping ancestor contains.
  const measure = () => page.evaluate(() => {
    const de = document.documentElement;
    const cw = de.clientWidth;
    const contained = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== 'visible') return a.getBoundingClientRect().right <= cw + 1;
      }
      return false;
    };
    const out = new Set();
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= cw + 1) continue;
      if (getComputedStyle(el).position === 'fixed' && r.left >= cw) continue; // parked off-screen on purpose (e.g. drawers)
      if (contained(el)) continue;
      out.add(el);
    }
    const outermost = [...out].filter((el) => !out.has(el.parentElement));
    const name = (el) => {
      const tid = el.getAttribute('data-testid');
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(/\s+/)
        .filter((c) => c && !/^css-/.test(c)).slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${tid ? `[data-testid=${tid}]` : ''}${cls ? `.${cls}` : ''} (right ${Math.round(el.getBoundingClientRect().right)}, width ${Math.round(el.getBoundingClientRect().width)})`;
    };
    const main = document.querySelector('main');
    return {
      overflow: de.scrollWidth - cw,
      clientWidth: cw,
      vScrollbar: window.innerWidth - cw,
      tall: de.scrollHeight > de.clientHeight + 1,
      mainRight: main ? Math.round(main.getBoundingClientRect().right) : null,
      offenders: outermost.slice(0, 4).map(name),
    };
  });
  const settle = async () => {
    await page.waitForTimeout(900);
    await page.waitForFunction(() => !document.querySelector('.MuiSkeleton-root, .MuiCircularProgress-root'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  // `inApp`: move as a user does — the router, not a page load — so in-memory
  // state such as a collapsed sidebar survives, and the switch itself is seen.
  const audit = async (route, label, inApp = false) => {
    if (inApp) {
      await page.evaluate((r) => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
    } else {
      await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
      await ready();
    }
    await settle();
    const m = await measure();
    let scrolls = true;
    if (m.tall) {
      scrolls = await page.evaluate(() => { window.scrollTo(0, 400); return window.scrollY > 0; });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    check(`${label} ${route}: the window does not scroll sideways${m.tall ? ', and still scrolls down' : ''}`,
      m.overflow <= 0 && scrolls && (m.mainRight == null || m.mainRight <= m.clientWidth + 1),
      m.overflow > 0 ? `+${m.overflow}px · ${m.offenders.join(' | ')}` : (!scrolls ? 'vertical scroll stuck' : ''));
    return m;
  };

  console.log(`\nLAYOUT AUDIT — ${list.length} routes, real scrollbars\n`);
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const r of list) await audit(r, `${w}×${h}`);
    const failed = results.filter((x) => !x.pass && x.name.startsWith(`${w}×${h}`)).length;
    console.log(`  ${w}×${h}: ${list.length - failed}/${list.length} routes fit the window`);
  }

  // Sidebar collapsed at the narrowest desktop size.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${APP}/purchase-fms`, { waitUntil: 'domcontentloaded' });
  await ready();
  await settle();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.waitForTimeout(600);
  const collapsedWidth = await page.evaluate(() => Math.round(document.querySelector('.MuiDrawer-paper')?.getBoundingClientRect().width || 0));
  check('the sidebar collapses (narrower drawer)', collapsedWidth > 0 && collapsedWidth < 120, `${collapsedWidth}px`);
  for (const r of list) await audit(r, '1366×768 collapsed', true);
  const stillCollapsed = await page.evaluate(() => Math.round(document.querySelector('.MuiDrawer-paper')?.getBoundingClientRect().width || 0));
  check('…and stays collapsed while moving between modules', stillCollapsed === collapsedWidth, `${stillCollapsed}px`);
  const fc = results.filter((x) => !x.pass && x.name.startsWith('1366×768 collapsed')).length;
  console.log(`  1366×768, sidebar collapsed: ${list.length - fc}/${list.length} routes fit the window`);

  // Expanding / collapsing does not push the page sideways mid-transition.
  const widths = [];
  for (const name of ['Expand sidebar', 'Collapse sidebar']) {
    await page.getByRole('button', { name }).click();
    for (let t = 0; t < 6; t += 1) { widths.push(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); await page.waitForTimeout(60); }
  }
  check('expanding and collapsing the sidebar never makes the window scroll sideways, even mid-transition', widths.every((x) => x <= 0), widths.join(','));

  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'layout-audit.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n  page errors: ${pageErrors.length}${pageErrors.length ? `\n    ${pageErrors.slice(0, 5).join('\n    ')}` : ''}`);
  console.log(`  ${results.length - failed.length}/${results.length} layout checks passed.\n`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('\nLayout audit failed:', e); process.exit(1); });
