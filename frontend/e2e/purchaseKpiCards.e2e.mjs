/**
 * PURCHASE FMS — KPI cards: every clickable summary card / Awaiting tile on the
 * 11 Purchase FMS steps filters its list to exactly what it counts.
 *
 *   node e2e/purchaseKpiCards.e2e.mjs
 *
 * For every card it checks, against the real list API:
 *   • the card is clickable and shows itself active once clicked;
 *   • the list request carries the card's filter, every returned record
 *     matches what the card counts, and the row count equals the card's number
 *     (where card and list count the same unit — see COUNT notes below);
 *   • clicking the active card again clears it, and Total restores the full list;
 *   • search typed beforehand is preserved by a card click and by Total;
 *   • (no Purchase FMS card is informational any more — GRN Pending Qty and
 *     Final Pending Amount open the PO / voucher lists of the same scope);
 *   • no uncaught page errors and no console errors.
 *
 * Read-only against the scratch DB: it opens pages and clicks filters (GETs).
 *
 * Expects (started separately):
 *   cd backend
 *   node src/scripts/e2eKpiFixture.js --seed            # always ambika_e2e_kpi
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_kpi node src/scripts/e2eServer.js
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
const USER = { email: 'kpi-e2e@test.local', password: 'E2e@12345' };
await assertE2ESetup(APP, API, 'purchaseKpiCards.e2e.mjs');

let passed = 0;
const failures = [];
const results = {}; // route → { pass, fail }
let current = '';
const check = (name, ok, detail = '') => {
  const r = (results[current] ||= { pass: 0, fail: 0 });
  if (ok) { passed += 1; r.pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { r.fail += 1; failures.push(`[${current}] ${name}: ${detail}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => { current = t; console.log(`\n── ${t} ──`); };

const NOW = Date.now();
const isIn = (field, values) => (d) => values.includes(d[field]);
const is = (field, value) => isIn(field, [value]);

// ── What each route's cards must do ─────────────────────────────────────────
// pred: every record the card's list returns must satisfy it.
// count: true when card and list count the same records (false = documented
// unit difference, e.g. Advance cards count PIs while rows are payments).
const ROUTES = [
  { name: '1. Purchase Indents', route: '/purchase-fms/purchase-indents', seg: 'indents', total: 'Total Indents',
    search: null,
    cards: [
      { label: 'Pending Approval', pred: is('approvalStatus', 'PENDING_APPROVAL'), count: true },
      { label: 'Approved', pred: is('approvalStatus', 'APPROVED'), count: true },
      { label: 'Quote Pending', pred: is('overallStatus', 'QUOTE_PENDING'), count: true },
      { label: 'Quotation Approved', pred: is('overallStatus', 'QUOTATION_APPROVED'), count: true },
    ] },
  { name: '4. Purchase Orders', route: '/purchase-fms/purchase-orders', seg: 'purchase-orders', total: 'Total POs',
    search: { sel: '#po-search', field: 'poNumber' },
    cards: [
      { label: 'Approved', pred: is('approvalStatus', 'APPROVED'), count: true, param: ['approvalStatus', 'APPROVED'] },
      { label: 'Released', pred: is('releaseStatus', 'RELEASED'), count: true, param: ['releaseStatus', 'RELEASED'] },
      { label: 'Partial Received', pred: is('poStatus', 'PARTIAL_RECEIVED'), count: true, param: ['poStatus', 'PARTIAL_RECEIVED'] },
      { label: 'Fully Received', pred: is('poStatus', 'FULLY_RECEIVED'), count: true, param: ['poStatus', 'FULLY_RECEIVED'] },
    ] },
  { name: '5. Follow-ups', route: '/purchase-fms/follow-ups?view=records', seg: 'follow-ups', total: 'Total Follow-ups',
    search: null,
    cards: [
      { label: 'Pending', pred: isIn('followUpStatus', ['PENDING', 'RESCHEDULED']), count: true, param: ['followUpStatus', 'PENDING,RESCHEDULED'] },
      { label: 'Done', pred: is('followUpStatus', 'DONE'), count: true },
      { label: 'Delayed', pred: (d) => ['PENDING', 'RESCHEDULED'].includes(d.followUpStatus) && new Date(d.plannedAt).getTime() <= NOW + 60000, count: true },
      { label: 'Ready For GRN', pred: is('followUpStatus', 'READY_FOR_GRN'), count: true },
    ] },
  { name: '6. Proforma Invoices', route: '/purchase-fms/pi-forms', seg: 'proforma-invoices', total: 'Total PI',
    search: null,
    cards: [
      // Pending approval and not cancelled — sent as every other PI status.
      { label: 'Pending Approval', pred: (d) => d.approvalStatus === 'PENDING' && d.piStatus !== 'CANCELLED', count: true,
        param: ['piStatus', 'DRAFT,RECEIVED,APPROVED,READY_FOR_ADVANCE_PAYMENT,PAYMENT_COMPLETED'] },
      { label: 'Approved', pred: is('approvalStatus', 'APPROVED'), count: true, param: ['approvalStatus', 'APPROVED'] },
      { label: 'Ready For Payment', pred: is('piStatus', 'READY_FOR_ADVANCE_PAYMENT'), count: true },
      { label: 'Cancelled', pred: is('piStatus', 'CANCELLED'), count: true },
    ] },
  { name: '7. Advance Payments', route: '/purchase-fms/advance-payments?view=records', seg: 'advance-payments', total: 'Total Advance Required',
    search: null,
    cards: [
      // COUNT: Total Paid is rupees; the rows are the non-cancelled payments it sums.
      { label: 'Total Paid', pred: (d) => d.paymentStatus !== 'CANCELLED', count: false, param: ['paymentStatus', 'PART_PAYMENT,FULL_PAYMENT,SHORT_PAYMENT_COMPLETED'] },
      // COUNT: these three count PIs; the list rows are payments of those PIs.
      { label: 'Partially Paid POs/PIs', pred: is('piPaymentState', 'PARTIALLY_PAID'), count: false, param: ['piPaymentState', 'PARTIALLY_PAID'] },
      { label: 'Fully Paid POs/PIs', pred: is('piPaymentState', 'FULLY_PAID'), count: false, param: ['piPaymentState', 'FULLY_PAID'] },
      { label: 'Outstanding (Short)', pred: is('piPaymentState', 'SHORT_CLOSED'), count: false, param: ['piPaymentState', 'SHORT_CLOSED'] },
      { label: 'Cancelled Entries', pred: is('paymentStatus', 'CANCELLED'), count: true, param: ['paymentStatus', 'CANCELLED'] },
    ] },
  { name: '8. GRN', route: '/purchase-fms/grn?view=grn', seg: 'grns', total: 'Total GRNs',
    search: { sel: '#grn-search', field: 'grnNumber' }, // Pending Qty opens Purchase Orders (?poStatus=RELEASED_TO_VENDOR,PARTIAL_RECEIVED) — a
    // navigation card, not a filter on this list, so it is not checked as one here.
   
    cards: [
      // COUNT: Received Qty is a quantity; the rows are the completed GRNs it sums.
      { label: 'Received Qty', pred: isIn('grnStatus', ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED']), count: false,
        param: ['grnStatus', 'RECEIVED,PARTIAL_RECEIVED,FULLY_RECEIVED'] },
      { label: 'Partial Received', pred: is('grnStatus', 'PARTIAL_RECEIVED'), count: true },
      { label: 'Fully Received', pred: is('grnStatus', 'FULLY_RECEIVED'), count: true },
    ] },
  { name: '9. Incoming QC', route: '/purchase-fms/grn?view=qc', seg: 'incoming-qc', total: 'Total QC',
    search: null,
    cards: [
      { label: 'Pending QC', pred: isIn('qcStatus', ['DRAFT', 'IN_PROGRESS']), count: true, param: ['qcStatus', 'DRAFT,IN_PROGRESS'] },
      { label: 'Passed', pred: is('qcStatus', 'PASSED'), count: true },
      { label: 'Failed', pred: is('qcStatus', 'FAILED'), count: true },
      { label: 'Partial', pred: is('qcStatus', 'PARTIAL'), count: true },
    ] },
  { name: '10. Vendor Invoices & Payments', route: '/purchase-fms/invoices-payments?view=records', seg: 'vendor-invoices', total: 'Total',
    search: null,
    cards: [
      { label: 'Approved', pred: isIn('invoiceStatus', ['APPROVED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED']), count: true,
        param: ['invoiceStatus', 'APPROVED,PAYMENT_PENDING,PAYMENT_COMPLETED'] },
      { label: 'Pending Approval', pred: isIn('invoiceStatus', ['DRAFT', 'RECEIVED']), count: true, param: ['workflow', 'AWAITING_INVOICE'] },
      { label: 'Payment Pending', pred: is('invoiceStatus', 'PAYMENT_PENDING'), count: true, param: ['invoiceStatus', 'PAYMENT_PENDING'] },
      { label: 'Payment Done', pred: is('invoiceStatus', 'PAYMENT_COMPLETED'), count: true, param: ['invoiceStatus', 'PAYMENT_COMPLETED'] },
    ] },
  { name: '11a. Tally Entries', route: '/purchase-fms/tally-entries?view=records', seg: 'tally-entries', total: 'Total',
    search: { sel: '#te-search', field: 'entryNumber' },
    cards: [
      { label: 'Pending', pred: is('tallyEntryStatus', 'PENDING'), count: true },
      { label: 'Completed', pred: is('tallyEntryStatus', 'COMPLETED'), count: true },
      { label: 'Cancelled', pred: is('tallyEntryStatus', 'CANCELLED'), count: true },
    ] },
  { name: '11b. Final Payments', route: '/purchase-fms/final-payments?view=records', seg: 'final-payments', total: 'Total Payments',
    // Pending Amount opens the voucher list (?finalPaymentStatus=PART_PAYMENT) — a
    // navigation card, not a filter on this list, so it is not checked as one here.
    search: null,
    cards: [
      // COUNT: Paid Amount is rupees; the rows are the non-cancelled payments it sums.
      { label: 'Paid Amount', pred: (d) => d.paymentStatus !== 'CANCELLED', count: false, param: ['paymentStatus', 'PART_PAYMENT,FULL_PAYMENT,SHORT_PAYMENT_COMPLETED'] },
      { label: 'Part Payments', pred: is('paymentStatus', 'PART_PAYMENT'), count: true },
      { label: 'Full Payments', pred: is('paymentStatus', 'FULL_PAYMENT'), count: true },
      { label: 'Short Closed', pred: is('paymentStatus', 'SHORT_PAYMENT_COMPLETED'), count: true },
    ] },
];

const QUEUES = [
  ['/purchase-fms/follow-ups?view=awaiting', 'FOLLOW_UP'],
  ['/purchase-fms/advance-payments?view=awaiting', 'ADVANCE_PAYMENT'],
  ['/purchase-fms/grn?view=awaiting-grn', 'GRN'],
  ['/purchase-fms/grn?view=awaiting-qc', 'INCOMING_QC'],
  ['/purchase-fms/invoices-payments?view=awaiting', 'VENDOR_INVOICE'],
  ['/purchase-fms/tally-entries?view=awaiting', 'TALLY_ENTRY'],
  ['/purchase-fms/final-payments?view=awaiting', 'FINAL_PAYMENT'],
];

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  // Tall enough that the grid renders every row of a page (DataGrid
  // virtualises rows outside the viewport, and the tests count rendered rows).
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
  page.setDefaultTimeout(20000); // never hang on a missing element
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`); });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  const isList = (seg) => (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/api/v1/procurement/${seg}`);
  // The card marks its label and value (PfmsKpiCard data-kpi-* attributes).
  const anyCard = (label) => page.locator(`[data-kpi-card]:has([data-kpi-label]:text-is("${label}"))`).first();
  const card = (label) => page.locator(`[data-kpi-clickable]:has([data-kpi-label]:text-is("${label}"))`).first();
  const cardValue = async (label) => Number((await anyCard(label).locator('[data-kpi-value]').innerText()).replace(/[^\d.-]/g, ''));
  const pressed = async (loc) => (await loc.getAttribute('aria-pressed')) === 'true';
  const gridRows = () => page.locator('.MuiDataGrid-row').count();
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('.MuiDataGrid-overlay .MuiCircularProgress-root, .MuiDataGrid-root .MuiLinearProgress-root'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  // Open a route fresh (no cached list), returning the unfiltered list response.
  const open = async (route, seg, firstLabel) => {
    let r = null;
    for (let attempt = 1; attempt <= 2 && !r; attempt += 1) {
      // Settle the wait whatever happens, so a timeout is reported, not thrown
      // as an unhandled rejection.
      const resp = page.waitForResponse(isList(seg), { timeout: 30000 }).catch((e) => e);
      await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
      await ready();
      const got = await resp;
      if (got instanceof Error) console.log(`  …list request for ${route} did not arrive (attempt ${attempt}): ${got.message.split('\n')[0]}`);
      else r = got;
    }
    if (!r) throw new Error(`list request for ${route} never arrived`);
    await (firstLabel ? anyCard(firstLabel) : page.locator('[data-kpi-clickable]').first()).waitFor();
    await settle();
    return r.json();
  };
  const clickCapture = async (seg, loc) => {
    const [resp] = await Promise.all([page.waitForResponse(isList(seg)), loc.click()]);
    const body = await resp.json();
    await settle();
    return { url: new URL(resp.url()), status: resp.status(), body };
  };

  for (const R of ROUTES) {
    section(R.name);
    const firstLabel = R.cards[0].label;

    for (const C of R.cards) {
      const initial = await open(R.route, R.seg, R.total);
      const fullTotal = initial?.meta?.total ?? 0;
      const c = card(C.label);
      check(`${C.label}: is clickable`, (await c.count()) === 1);
      if ((await c.count()) !== 1) continue;
      const value = await cardValue(C.label);
      const { url, status, body } = await clickCapture(R.seg, c);
      const docs = body?.data || [];
      const total = body?.meta?.total ?? docs.length;
      check(`${C.label}: list request succeeds`, status === 200, `HTTP ${status}`);
      if (C.param) check(`${C.label}: request carries ${C.param[0]}=${C.param[1]}`, url.searchParams.get(C.param[0]) === C.param[1], url.search);
      check(`${C.label}: card shows active`, await pressed(c));
      check(`${C.label}: every record matches the card`, docs.every(C.pred), `${docs.filter((d) => !C.pred(d)).length} of ${docs.length} do not`);
      if (C.count) check(`${C.label}: rows = card count`, total === value && (await gridRows()) === total, `card ${value}, api ${total}, rows ${await gridRows()}`);
      else check(`${C.label}: filtered — ${total} payment rows (card shows ${value}; it counts PIs or money, not payment rows)`, total <= fullTotal);
      if (R.total && R.total !== C.label) check(`${C.label}: Total no longer active`, !(await pressed(card(R.total))));
      // Click again → cleared (the unfiltered list may come from cache: count rows).
      await c.click();
      await settle();
      check(`${C.label}: second click clears it`, !(await pressed(c)) && (await gridRows()) === Math.min(fullTotal, 25), `rows ${await gridRows()} of ${fullTotal}`);
    }

    // Total restores the full list after a card filter.
    {
      const initial = await open(R.route, R.seg, R.total);
      const fullTotal = initial?.meta?.total ?? 0;
      await clickCapture(R.seg, card(firstLabel));
      const t = card(R.total);
      await t.click();
      await settle();
      check(`Total "${R.total}": active again and full list back`, (await pressed(t)) && !(await pressed(card(firstLabel))) && (await gridRows()) === Math.min(fullTotal, 25), `rows ${await gridRows()} of ${fullTotal}`);
    }

    for (const label of R.informational || []) {
      check(`"${label}" stays informational (not clickable)`, (await card(label).count()) === 0 && (await anyCard(label).count()) === 1);
    }

    // Search typed first is preserved by a card click and by Total. The term is
    // a real record's number that the card also matches, so neither step can
    // pass on an empty list.
    if (R.search) {
      const initial = await open(R.route, R.seg, R.total);
      const C = R.cards[R.cards.length - 1];
      const target = (initial?.data || []).find(C.pred);
      const term = target?.[R.search.field];
      check(`fixture has a "${C.label}" record to search for`, Boolean(term), term || 'none');
      if (term) {
        const searched = page.waitForResponse((r) => isList(R.seg)(r) && new URL(r.url()).searchParams.get('search') === term);
        await page.locator(R.search.sel).fill(term);
        const s = await (await searched).json();
        await settle();
        const { url, body } = await clickCapture(R.seg, card(C.label));
        const docs = body?.data || [];
        check(`search "${term}" kept on card click`, url.searchParams.get('search') === term && docs.length >= 1 && docs.every(C.pred) && docs.some((d) => d._id === target._id), `${url.search} → ${docs.length} rows`);
        await card(R.total).click();
        await settle();
        const searchOnly = s?.meta?.total ?? 0;
        check('search kept after Total', searchOnly >= 1 && (await page.locator(R.search.sel).inputValue()) === term && (await gridRows()) === Math.min(searchOnly, 25), `rows ${await gridRows()} vs search-only ${searchOnly}`);
      }
    }
  }

  // ── Advance: Remaining Advance opens the Awaiting Advance queue ──
  section('7. Advance Payments — Remaining Advance');
  await open('/purchase-fms/advance-payments?view=records', 'advance-payments', 'Total Advance Required');
  const remaining = await cardValue('Remaining Advance');
  const qResp = page.waitForResponse((r) => r.url().includes('/procurement/step-queues/ADVANCE_PAYMENT') && new URL(r.url()).searchParams.get('limit') !== '1');
  await card('Remaining Advance').click();
  await page.waitForURL(/view=awaiting/);
  const q = await (await qResp).json();
  await anyCard('All awaiting').waitFor();
  const owed = (q?.data?.rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  check('Remaining Advance opens the Awaiting Advance tab', /view=awaiting/.test(page.url()));
  check('…whose PIs\' balances add up to the card', q?.data?.unfilteredTotal >= 1 && Math.abs(owed - remaining) < 0.01, `${q?.data?.unfilteredTotal} PIs, ₹${owed} owed, card ₹${remaining}`);

  // ── Quotation steps (2, 3) ──
  for (const [name, route] of [['2. Receive Quotes', '/purchase-fms/receive-quotes'], ['3. Approved Quotations', '/purchase-fms/approved-quotations']]) {
    section(name);
    const tiles = page.locator('[data-kpi-clickable]');
    for (let i = 1; i < 4; i += 1) {
      await open(route, 'indents', null);
      const t = tiles.nth(i);
      const label = (await t.locator('[data-kpi-label]').innerText()).trim();
      const value = Number((await t.locator('[data-kpi-value]').innerText()).replace(/[^\d]/g, ''));
      const { url, body } = await clickCapture('indents', t);
      check(`${label}: active, filtered by stepState, rows = tile count`, (await pressed(t)) && Boolean(url.searchParams.get('stepState')) && body?.meta?.total === value, `tile ${value}, api ${body?.meta?.total}`);
      await t.click();
      await settle();
      check(`${label}: second click returns to All`, !(await pressed(t)) && (await pressed(tiles.first())));
    }
  }

  // ── Awaiting queues ──
  for (const [route, queue] of QUEUES) {
    section(`Awaiting ${queue}`);
    const seg = `step-queues/${queue}`;
    const tiles = page.locator('[data-kpi-clickable]');
    const n = await (async () => { await open(route, seg, 'All awaiting'); return tiles.count(); })();
    for (let i = 1; i < n; i += 1) {
      await open(route, seg, 'All awaiting');
      const t = tiles.nth(i);
      const label = (await t.locator('[data-kpi-label]').innerText()).trim();
      const value = Number((await t.locator('[data-kpi-value]').innerText()).replace(/[^\d]/g, ''));
      const { url, body } = await clickCapture(seg, t);
      const rows = body?.data?.rows || [];
      check(`${label}: active, state filter sent, rows = tile count`, (await pressed(t)) && Boolean(url.searchParams.get('state')) && body?.meta?.total === value && rows.every((r) => r.state === url.searchParams.get('state')), `tile ${value}, api ${body?.meta?.total}`);
      await t.click();
      await settle();
      check(`${label}: second click returns to All awaiting`, !(await pressed(t)) && (await pressed(tiles.first())));
    }
  }

  section('Page health');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
};

try {
  await run();
} catch (e) {
  failures.push(`run aborted: ${e.message.split('\n')[0]}`);
  console.error('\nKPI card e2e aborted:', e);
}
console.log('\n══ Summary by route ══');
for (const [k, v] of Object.entries(results)) console.log(`  ${v.fail ? 'FAIL' : 'ok  '}  ${k}: ${v.pass} passed${v.fail ? `, ${v.fail} failed` : ''}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(failures.length ? 1 : 0);
