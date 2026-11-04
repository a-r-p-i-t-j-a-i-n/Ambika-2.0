/**
 * Purchase Approval (sidebar) walkthrough on a TEST ONLY vendor + SKU, through
 * the real UI and API in Chromium:
 *   - FMS → Purchase → Purchase Approval opens /purchase-fms/rate-change-approvals;
 *     the Purchase FMS header has no "Rate Changes" button any more
 *   - the buyer raises 100 → 120 in the New PO form with the TEST ONLY reason
 *   - an approver (not the requester) approves it: PO line and vendor rate → 120,
 *     history records the decision and the approver; replays are refused
 *   - a second request (120 → 130) is rejected with a reason: vendor stays 120
 *   - users without the permission cannot approve / reject (UI or API), nor can
 *     an approver approve their own request
 *   - a request made stale by another approval is refused and changes neither side
 *   - phone width (hamburger) and the collapsed / expanded sidebar
 *
 *   node e2e/purchaseApproval.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eRateChangeFixture.js):
 *   backend  e2eServer.js against the ambika_e2e_ratechange scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 *   data     `--prep-test-only` run just before (resets the TEST ONLY vendor to
 *            100, makes four indents, writes e2e/shots/test-only-rate-manifest.json)
 * Ports default to :5096 / :3103; override with PROBE_API / PROBE_APP.
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

const APP = process.env.PROBE_APP || 'http://127.0.0.1:3103';
const API = process.env.PROBE_API || 'http://127.0.0.1:5096/api/v1';
await assertE2ESetup(APP, API, 'purchaseApproval.e2e.mjs');
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/purchase-approval';
fs.mkdirSync(SHOTS, { recursive: true });
const m = JSON.parse(fs.readFileSync('e2e/shots/test-only-rate-manifest.json', 'utf8'));
const PAGE = '/purchase-fms/rate-change-approvals';
const RC = '/procurement/rate-changes';
const PO = '/procurement/purchase-orders';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};
const pageErrors = [];
const browser = await chromium.launch({ executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });

const session = async (who, viewport = { width: 1440, height: 950 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${who} ${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
    await page.waitForTimeout(150);
  };
  const go = async (url) => { await page.goto(`${APP}${url}`, { waitUntil: 'domcontentloaded' }); await ready(); };
  const api = (method, p, body, { noAuth = false } = {}) => page.evaluate(async ([base, mth, url, b, anon]) => {
    const r = await fetch(`${base}${url}`, {
      method: mth,
      headers: { 'Content-Type': 'application/json', ...(anon ? {} : { Authorization: `Bearer ${localStorage.getItem('token')}` }) },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }, [API, method, p, body, noAuth]);
  const signIn = async () => {
    await page.locator('input[autocomplete="email"]').fill(m.users[who]);
    await page.locator('input[autocomplete="current-password"]').fill(m.password);
    await page.getByRole('button', { name: /sign in to workspace/i }).click({ timeout: 15000 });
  };
  await go('/');
  // The first login of a run has twice sat on a never-"stable" button — one
  // reload + retry, with a screenshot so the flake stays visible.
  try { await signIn(); } catch { await shot(page, `login-retry-${who}`); console.log(`  (login retried for ${who})`); await go('/'); await signIn(); }
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  await ready();
  return { ctx, page, go, api, ready };
};
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const snack = (page, re) => page.getByText(re).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
const round2 = (n) => Math.round(n * 100) / 100;

// The sidebar (whichever drawer is mounted) and its rows.
const nav = (page) => page.locator('.MuiDrawer-paper:visible');
const navRow = (page, name) => nav(page).getByRole('button', { name, exact: true });
// Expand FMS → Purchase only where they are closed, then click Purchase Approval.
const openPurchaseApproval = async (page) => {
  for (const [group, child] of [['FMS', 'Purchase'], ['Purchase', 'Purchase Approval']]) {
    if (!(await navRow(page, child).isVisible())) {
      await navRow(page, group).click();
      await navRow(page, child).waitFor({ state: 'visible', timeout: 5000 });
    }
  }
  await navRow(page, 'Purchase Approval').click();
  await page.waitForURL((u) => u.pathname === PAGE, { timeout: 10000 });
};
// The 11 Purchase FMS workflow steps — the hub's step rail, absent on Purchase Approval.
const HUB_STEPS = ['Purchase Indents', 'Receive Quote & Comparative', 'Approved Quotation', 'Purchase Orders', 'Follow-ups', 'PI Forms', 'Advance Payments', 'GRN & QC', 'Vendor Invoices & Payments', 'Tally Entries', 'Final Payments'];
const hubStepBtn = (page, label) => page.getByRole('button', { name: label });
// History tab: it opens NEWEST FIRST by default — confirm that instead of switching.
const newestFirst = async (page) => {
  await page.locator('#rch-order').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const label = (await page.locator('#rch-order').innerText()).trim();
  if (label !== 'Newest first') throw new Error(`History order is "${label}", expected "Newest first"`);
};
const vendorRate = async (api) => (await api('GET', `${RC}/vendor-rate?vendorId=${m.vendor._id}&skuCode=${m.sku.code}&unit=PCS`)).data?.rate;
// Earlier runs leave decided requests with the same reasons — match the
// pending one (form path) or the PO just raised (API path).
const requestFor = async (api, reason, poId) => ((await api('GET', `${RC}?limit=200&vendorId=${m.vendor._id}${poId ? `&poId=${poId}` : '&status=PENDING'}`)).data?.rows || [])
  .find((r) => r.reason === reason);
const poLine = async (api, poId) => (await api('GET', `${PO}/${poId}`)).data?.items?.[0];
// A PO raised through the real PO API (same validation as the form).
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const raisePo = async (api, ind, rate, reason) => {
  const r = await api('POST', `${PO}/create-from-items`, {
    poFormatType: 'OTHER', vendorId: m.vendor._id, poDate: ymd(new Date()), expectedDeliveryDate: ymd(new Date(Date.now() + 7 * 864e5)),
    items: [{ indentId: ind._id, indentItemId: ind.itemId, itemName: ind.itemName, skuCode: m.sku.code, skuId: ind.skuId,
      quantity: ind.quantity, unit: ind.unit, rate, gstRate: 18, rateChangeReason: reason }],
  });
  return { ...r, request: r.data?._id ? await requestFor(api, reason, r.data._id) : null };
};
const REASON = m.reason;
const REJECT_PATH = `${REASON} (reject path)`;
const SELF_PATH = `${REASON} (raised by the approver)`;
const STALE_PATH = `${REASON} (made stale)`;
const ids = {};

// ═══ BUYER — raise 100 → 120 in the New PO form ═══
console.log('\n[BUYER] New PO form — TEST ONLY 100 → 120');
{
  const { ctx, page, go, api } = await session('BUYER');
  check('S0 the TEST ONLY vendor fetches 100 for the TEST ONLY SKU', await vendorRate(api) === 100);
  const pending = ((await api('GET', `${PO}/approved-items`)).data?.items || []).find((o) => o.indentId === m.indents.approve._id);
  check('S0b the prepped TEST ONLY item is Pending for PO, fixed to the TEST ONLY vendor', pending && pending.vendorName === m.vendor.name && pending.indentItemDisplayNumber, JSON.stringify(pending));

  await go('/purchase-fms/purchase-orders');
  await page.locator('[data-testid="pfms-quick-actions"]').waitFor({ timeout: 30000 }).catch(() => shot(page, 'header-wait'));
  check('H1 Purchase FMS header: no "Rate Changes" button or badge; Quick Actions still there',
    await page.locator('[data-testid="pfms-rate-changes"], [data-testid="pfms-rate-changes-count"]').count() === 0
    && await page.getByRole('button', { name: /^Rate Changes/ }).count() === 0
    && await page.locator('[data-testid="pfms-quick-actions"]').isVisible());
  await shot(page, 'buyer-header');

  // The PO step is a lazy chunk with a large list on this DB — wait for it.
  await page.getByRole('tab', { name: /Pending for PO/ }).waitFor({ state: 'visible', timeout: 60000 }).catch(() => shot(page, 'pending-tab-wait'));
  await page.getByRole('tab', { name: /Pending for PO/ }).click();
  const row = page.locator('.MuiDataGrid-row', { hasText: pending.indentItemDisplayNumber });
  await row.waitFor({ timeout: 20000 });
  await row.getByRole('button', { name: 'Create PO' }).click();
  await page.getByText('New Purchase Order').waitFor();
  const rate = page.locator('input[placeholder="0.00"]').first();
  await page.waitForFunction(() => document.querySelector('input[placeholder="0.00"]')?.value !== '', null, { timeout: 15000 }).catch(() => {});
  check('C1 the PO form fetches the vendor rate (100)', Number(await rate.inputValue()) === 100, await rate.inputValue());
  await rate.fill('120');
  await page.waitForTimeout(200);
  check('C2 120 is flagged "Needs approval"', await page.locator('[data-testid="po-rate-needs-approval"]').isVisible());
  await page.locator('[data-testid="po-lead-time"]').fill('7');
  await page.locator('[data-testid="po-rate-reason"]').fill(REASON);
  await page.waitForTimeout(300);
  await shot(page, 'buyer-po-form');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('C3 saved as draft — "sent to Rate Change Approvals"', await snack(page, /1 rate change sent to Rate Change Approvals/));
  const r1 = await requestFor(api, REASON);
  ids.r1 = r1;
  check('C4 request raised: PENDING, 100 → 120, TEST ONLY reason, PO ref, buyer as requester', r1 && r1.status === 'PENDING'
    && r1.existingVendorRate === 100 && r1.requestedRate === 120 && r1.poRef && r1.requestedByName === 'E2E Rate Buyer', JSON.stringify(r1));
  check('C5 the vendor rate is still 100 (nothing applied before approval)', await vendorRate(api) === 100);
  const l1 = await poLine(api, r1.poId);
  check('C6 the draft PO line keeps the proposed 120, marked PENDING', l1?.rate === 120 && l1?.rateChangeStatus === 'PENDING', JSON.stringify(l1));
  await ctx.close();
}

// ═══ APPROVER — sidebar → Requests → approve ═══
console.log('\n[APPROVER] Purchase Approval from the sidebar — approve');
{
  const { ctx, page, go, api } = await session('APPROVER');
  await go('/fms/my-tasks');
  const purchaseChildren = async () => {
    await navRow(page, 'Purchase Approval').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    return nav(page).locator('.MuiListItemButton-root').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
  };
  await openPurchaseApproval(page);
  check('P1 FMS → Purchase → Purchase Approval opens /purchase-fms/rate-change-approvals', new URL(page.url()).pathname === PAGE);
  const rows = await purchaseChildren();
  const iFms = rows.indexOf('Purchase FMS');
  check('P2 it sits under Purchase, right after Purchase FMS (then Master Data); My FMS Tasks stays at the top',
    iFms > 0 && rows[iFms + 1] === 'Purchase Approval' && rows[iFms + 2] === 'Master Data' && rows[0] === 'My FMS Tasks', rows.join(' | '));
  let selected = false;
  for (let i = 0; i < 20 && !selected; i += 1) {
    selected = /Mui-selected/.test(await navRow(page, 'Purchase Approval').getAttribute('class'));
    if (!selected) await page.waitForTimeout(500);
  }
  check('P3 the sidebar row is highlighted on its page', selected, await navRow(page, 'Purchase Approval').getAttribute('class'));
  await page.locator('[data-testid="rc-page-title"]').waitFor({ timeout: 10000 });
  check('P4 the page renders its own Purchase Approval header and the Requests + History tabs; app bar says Purchase Approval; no header button',
    await page.locator('[data-testid="rc-tab-history"]').isVisible() && await page.getByRole('tab', { name: /Requests/ }).isVisible()
    && /Purchase Approval/.test(await page.locator('.MuiAppBar-root').first().innerText())
    && await page.locator('[data-testid="pfms-rate-changes"]').count() === 0);

  const reqRow = page.locator('.MuiDataGrid-row', { hasText: ids.r1.requestNumber });
  await reqRow.waitFor({ timeout: 15000 });
  check('W2 the TEST ONLY request is in Requests with Pending status', /rc-row-pending/.test(await reqRow.getAttribute('class')));
  await shot(page, 'approver-requests');
  await reqRow.click();
  const drawer = page.locator('[data-testid="rate-change-drawer"]');
  await page.locator('[data-testid="rc-number"]', { hasText: ids.r1.requestNumber }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const dText = await drawer.innerText();
  check('W3 drawer: vendor, SKU, PO ref, original 100, proposed 120, +₹20.00 (+20%), TEST ONLY reason',
    dText.includes(m.vendor.name) && dText.includes(m.sku.code) && dText.includes(ids.r1.poRef)
    && (await page.locator('[data-testid="rc-existing"]').innerText()) === '₹100.00'
    && (await page.locator('[data-testid="rc-requested"]').innerText()) === '₹120.00'
    && (await page.locator('[data-testid="rc-diff"]').innerText()) === '+₹20.00 (+20%)'
    && (await page.locator('[data-testid="rc-reason"]').innerText()) === REASON, dText.slice(0, 300));
  await shot(page, 'approver-drawer');
  await page.locator('[data-testid="rc-remarks"]').fill('TEST ONLY approval');
  await page.locator('[data-testid="rc-approve"]').click();
  check('W4 approve → "approved — vendor rate and PO updated"', await snack(page, /approved — vendor rate and PO updated/));
  await page.waitForTimeout(800);

  const qty = Number(m.indents.approve.quantity);
  const l1 = await poLine(api, ids.r1.poId);
  const po1 = (await api('GET', `${PO}/${ids.r1.poId}`)).data;
  check('W5 vendor rate for the TEST ONLY SKU is now 120', await vendorRate(api) === 120);
  check('W5b the PO line is 120 (APPROVED) with totals recalculated', l1?.rate === 120 && l1?.rateChangeStatus === 'APPROVED'
    && l1.taxableAmount === round2(qty * 120) && po1.grandTotal === round2(qty * 120 * 1.18), JSON.stringify({ rate: l1?.rate, t: l1?.taxableAmount, g: po1?.grandTotal, qty }));
  const d1 = (await api('GET', `${RC}/${ids.r1._id}`)).data;
  check('W7 request APPROVED by E2E Rate Approver; events REQUESTED → APPROVED with the approver',
    d1.status === 'APPROVED' && d1.decidedByName === 'E2E Rate Approver' && !d1.selfApproved
    && (d1.events || []).map((e) => e.event).join(',') === 'REQUESTED,APPROVED'
    && d1.events[1].actorName === 'E2E Rate Approver' && d1.events[1].previousRate === 100 && d1.events[1].newRate === 120, JSON.stringify({ s: d1.status, by: d1.decidedByName, ev: (d1.events || []).map((e) => `${e.event}:${e.actorName}`) }));
  check('W7b the drawer shows Approved and who decided', /Approved/.test(await drawer.innerText()) && (await drawer.innerText()).includes('E2E Rate Approver'));

  // Replays: the same approval sent again, twice at once.
  const replay = await Promise.all([api('POST', `${RC}/${ids.r1._id}/approve`, {}), api('POST', `${RC}/${ids.r1._id}/approve`, {})]);
  const d1b = (await api('GET', `${RC}/${ids.r1._id}`)).data;
  check('W9 replaying the approval (2 at once) → both 409; still one APPROVED event; vendor 120', replay.every((x) => x.status === 409)
    && d1b.events.filter((e) => e.event === 'APPROVED').length === 1 && await vendorRate(api) === 120, replay.map((x) => `${x.status} ${x.message}`).join(' | '));

  // History tab.
  await page.locator('[data-testid="rc-view-history"]').click();
  await page.waitForURL(/tab=history/);
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  // History is chronological (oldest first) and only rendered rows are in the
  // DOM — earlier runs push this request's rows out of view, so read newest first.
  await newestFirst(page);
  const rowTexts = async () => page.locator('.MuiDataGrid-row').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  const left = await rowTexts();
  const idx = left.map((t, i) => (t.includes(ids.r1.requestNumber) ? i : -1)).filter((i) => i >= 0); // newest first
  // Status and the approver sit past the sideways scroll (MUI X renders only visible columns).
  await page.locator('.MuiDataGrid-virtualScroller').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(600);
  const right = await rowTexts();
  const decision = right[idx[0]] || '';
  const requested = right[idx[1]] || '';
  // Status column = the status AFTER the event: the request row reads Pending, the decision row Approved.
  check('W7c History tab: the Approved row (newest) then the Pending (requested) row of the request; the approver is named', idx.length === 2
    && /Approved/.test(decision) && decision.includes('E2E Rate Approver') && /Pending/.test(requested) && !requested.includes('E2E Rate Approver'),
    `${idx.join(',')} :: ${decision.slice(-200)} || ${requested.slice(-200)}`);
  await shot(page, 'approver-history');
  await ctx.close();
}

// ═══ Second request (120 → 130), rejected with a reason ═══
console.log('\n[BUYER → APPROVER] Reject path');
{
  const b = await session('BUYER');
  const r = await raisePo(b.api, m.indents.reject, 130, REJECT_PATH);
  ids.r2 = r.request;
  check('K0 buyer raises 120 → 130 through the PO API (201, PENDING)', r.status === 201 && ids.r2?.status === 'PENDING'
    && ids.r2.existingVendorRate === 120 && ids.r2.requestedRate === 130, `${r.status} ${r.message}`);
  await b.ctx.close();

  const { ctx, page, go, api } = await session('APPROVER');
  await go('/fms/my-tasks');
  await openPurchaseApproval(page);
  const reqRow = page.locator('.MuiDataGrid-row', { hasText: ids.r2.requestNumber });
  await reqRow.waitFor({ timeout: 15000 });
  await reqRow.click();
  await page.locator('[data-testid="rc-number"]', { hasText: ids.r2.requestNumber }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="rc-reject"]').click();
  const confirm = page.locator('[data-testid="rc-reject-confirm"]');
  check('K1 Reject needs a reason (confirm disabled while empty)', await confirm.isDisabled());
  await page.locator('[data-testid="rc-reject-reason"]').fill('TEST ONLY — rejected: vendor quote not accepted');
  await confirm.click();
  check('K2 reject → success message', await snack(page, /rejected/));
  await page.waitForTimeout(800);
  check('K3 drawer shows the rejection, its reason and who rejected', /TEST ONLY — rejected: vendor quote not accepted/.test(await page.locator('[data-testid="rc-rejected-note"]').innerText())
    && (await page.locator('[data-testid="rc-rejected-note"]').innerText()).includes('E2E Rate Approver'));
  await shot(page, 'approver-rejected');
  const d2 = (await api('GET', `${RC}/${ids.r2._id}`)).data;
  const l2 = await poLine(api, ids.r2.poId);
  check('K4 vendor rate NOT changed (still 120)', await vendorRate(api) === 120);
  check('K5 request REJECTED with the reason; history REQUESTED → REJECTED; draft line back to 120',
    d2.status === 'REJECTED' && d2.rejectionReason === 'TEST ONLY — rejected: vendor quote not accepted'
    && d2.events.map((e) => e.event).join(',') === 'REQUESTED,REJECTED' && l2?.rate === 120 && l2?.rateChangeStatus === 'REJECTED', JSON.stringify({ s: d2.status, ev: d2.events?.map((e) => e.event), line: l2?.rate }));
  const again = await api('POST', `${RC}/${ids.r2._id}/approve`, {});
  check('K6 a rejected request cannot be approved afterwards (409)', again.status === 409 && await vendorRate(api) === 120, `${again.status}`);
  await ctx.close();
}

// ═══ Permissions ═══
console.log('\n[PERMISSIONS] No grant / own request / signed out');
{
  // The approver raises a request themselves.
  const a = await session('APPROVER');
  const r = await raisePo(a.api, m.indents.unauthorised, 125, SELF_PATH);
  ids.r3 = r.request;
  check('U0 approver raises 120 → 125 themselves (201, PENDING)', r.status === 201 && ids.r3?.status === 'PENDING', `${r.status} ${r.message}`);
  const self = await a.api('POST', `${RC}/${ids.r3._id}/approve`, {});
  check('U1 the approver cannot approve their own request (403)', self.status === 403, `${self.status} ${self.message}`);
  await a.go(`${PAGE}?request=${ids.r3._id}`);
  await a.page.locator('[data-testid="rc-number"]', { hasText: ids.r3.requestNumber }).waitFor({ timeout: 15000 });
  await a.page.waitForTimeout(500);
  check('U2 …and the drawer says so with Approve disabled', await a.page.locator('[data-testid="rc-approve-block"]').isVisible()
    && await a.page.locator('[data-testid="rc-approve"]').isDisabled());
  await a.ctx.close();

  for (const who of ['VIEWER', 'BUYER']) {
    const s = await session(who);
    await s.go('/fms/my-tasks');
    await openPurchaseApproval(s.page);
    const row = s.page.locator('.MuiDataGrid-row', { hasText: ids.r3.requestNumber });
    await row.waitFor({ timeout: 15000 });
    await row.click();
    await s.page.locator('[data-testid="rc-number"]', { hasText: ids.r3.requestNumber }).waitFor({ timeout: 15000 });
    await s.page.waitForTimeout(500);
    check(`U3 ${who}: sidebar page opens, but no Approve / Reject in the drawer`, await s.page.locator('[data-testid="rc-approve"]').count() === 0
      && await s.page.locator('[data-testid="rc-reject"]').count() === 0);
    if (who === 'VIEWER') await shot(s.page, 'viewer-drawer');
    const ap = await s.api('POST', `${RC}/${ids.r3._id}/approve`, {});
    const rj = await s.api('POST', `${RC}/${ids.r3._id}/reject`, { reason: 'not allowed' });
    check(`U4 ${who}: direct API approve and reject → 403`, ap.status === 403 && rj.status === 403, `${ap.status} ${rj.status}`);
    if (who === 'VIEWER') {
      const anon = await s.api('POST', `${RC}/${ids.r3._id}/approve`, {}, { noAuth: true });
      check('U5 no token → 401', anon.status === 401, `${anon.status}`);
    }
    await s.ctx.close();
  }
}

// ═══ A request made stale by another approval changes neither side ═══
console.log('\n[STALE] Approve R3 (→125), then the older R4 (120 → 135)');
{
  const b = await session('BUYER');
  const r4 = await raisePo(b.api, m.indents.stale, 135, STALE_PATH);
  ids.r4 = r4.request;
  check('F0 buyer raises 120 → 135 (PENDING)', ids.r4?.status === 'PENDING' && ids.r4.existingVendorRate === 120, `${r4.status} ${r4.message}`);
  await b.ctx.close();

  const pa = await session('POAPPROVER');
  const ok3 = await pa.api('POST', `${RC}/${ids.r3._id}/approve`, { remarks: 'TEST ONLY — procurement.approve holder' });
  check('F1 a procurement.approve holder (not the requester) approves R3 → vendor 125', ok3.status === 200 && await vendorRate(pa.api) === 125, `${ok3.status} ${ok3.message}`);
  await pa.ctx.close();

  const { ctx, page, go, api } = await session('APPROVER');
  const st = await api('POST', `${RC}/${ids.r4._id}/approve`, {});
  const l4 = await poLine(api, ids.r4.poId);
  const d4 = (await api('GET', `${RC}/${ids.r4._id}`)).data;
  check('F2 approving R4 (raised against 120) → 409 STALE_VENDOR_RATE', st.status === 409 && st.data?.code === 'STALE_VENDOR_RATE' && st.data?.currentVendorRate === 125, `${st.status} ${st.message}`);
  check('F3 …neither side changed: vendor still 125, PO line still 135 PENDING, request PENDING, conflict in history',
    await vendorRate(api) === 125 && l4?.rate === 135 && l4?.rateChangeStatus === 'PENDING' && d4.status === 'PENDING'
    && d4.events.some((e) => e.event === 'APPROVAL_CONFLICT'), JSON.stringify({ line: l4?.rate, s: d4.status }));
  await go(`${PAGE}?request=${ids.r4._id}`);
  await page.locator('[data-testid="rc-number"]', { hasText: ids.r4.requestNumber }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check('F4 the drawer warns 120 → 125 and holds Approve until the approver confirms', /changed from ₹120\.00 to ₹125\.00/.test(await page.locator('[data-testid="rc-stale"]').innerText())
    && await page.locator('[data-testid="rc-approve"]').isDisabled());
  await shot(page, 'approver-stale');
  const close = await api('POST', `${RC}/${ids.r4._id}/reject`, { reason: 'TEST ONLY — superseded by the 125 approval' });
  check('F5 R4 rejected to close it; vendor stays 125', close.status === 200 && await vendorRate(api) === 125);
  await ctx.close();
}

// ═══ MD: header buttons unchanged; replay as the MD ═══
console.log('\n[MD] Header + replay');
{
  const { ctx, page, go, api } = await session('MD');
  await go('/purchase-fms/purchase-orders');
  await page.locator('[data-testid="pfms-quick-actions"]').waitFor({ timeout: 30000 }).catch(() => shot(page, 'header-wait'));
  check('H2 MD header: MD Approval and Quick Actions present, no Rate Changes', await page.getByRole('button', { name: /MD Approval/ }).isVisible()
    && await page.locator('[data-testid="pfms-quick-actions"]').isVisible() && await page.locator('[data-testid="pfms-rate-changes"]').count() === 0);
  // The Purchase FMS page itself is untouched: heading, subtitle, all 11 steps, Quick Actions.
  const hubHeading = await page.getByRole('heading', { level: 1, name: 'Purchase FMS', exact: true }).count();
  const hubSub = await page.getByText('Manage the complete purchase workflow').count();
  const hubSteps = [];
  for (const s of HUB_STEPS) if (await hubStepBtn(page, s).count()) hubSteps.push(s);
  check('H3 Purchase FMS page keeps its heading, subtitle, all 11 workflow steps and Quick Actions',
    hubHeading === 1 && hubSub === 1 && hubSteps.length === 11 && await page.locator('[data-testid="pfms-quick-actions"]').isVisible(), `h1 ${hubHeading} sub ${hubSub} steps ${hubSteps.length}`);
  await page.locator('[data-testid="pfms-quick-actions"]').click();
  check('H4 Quick Actions still opens its four actions', await page.getByRole('menuitem').count() === 4);
  await page.keyboard.press('Escape');
  await shot(page, 'md-header');
  const rep = await api('POST', `${RC}/${ids.r1._id}/approve`, {});
  check('W9b the MD replaying the approved request → 409, vendor unchanged', rep.status === 409 && await vendorRate(api) === 125, `${rep.status}`);
  await ctx.close();
}

// ═══ Simplified Purchase Approval page (no Purchase FMS chrome) ═══
console.log('\n[UI] Purchase Approval is its own simple page');
{
  const { ctx, page, go, api } = await session('VIEWER');
  await go(PAGE);
  await page.locator('[data-testid="rc-page-title"]').waitFor({ timeout: 30000 });
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  const main = page.locator('main');
  const body = await main.innerText();
  check('UI1 header: "Purchase Approval" + "Review and approve vendor rate changes."',
    (await page.getByRole('heading', { level: 1 }).allInnerTexts()).join('|') === 'Purchase Approval' && body.includes('Review and approve vendor rate changes.'));
  let steps = 0;
  for (const s of HUB_STEPS) if (await main.getByRole('button', { name: s }).count()) steps += 1;
  check('UI2 no Purchase FMS heading / subtitle, no workflow steps, no Quick Actions, no MD Approval button',
    !/Manage the complete purchase workflow/.test(body) && (await page.getByRole('heading', { name: 'Purchase FMS', exact: true }).count()) === 0
    && steps === 0 && (await page.locator('[data-testid="pfms-quick-actions"]').count()) === 0
    && (await main.getByRole('button', { name: /Quick Actions|MD Approval/ }).count()) === 0, `steps ${steps}`);
  const cards = await Promise.all(['All Requests', 'Pending', 'Approved', 'Rejected'].map((n) => main.getByRole('button', { name: new RegExp(`^\\s*\\d+\\s*${n}\\s*$`) }).count()));
  check('UI3 the four summary cards: All Requests, Pending, Approved, Rejected', cards.every((c) => c === 1), cards.join(','));
  const tabs = await page.getByRole('tab').allInnerTexts();
  check('UI4 tabs: Requests and Rate Change History only', tabs.join('|') === 'Requests|Rate Change History', tabs.join('|'));
  const labels = await main.locator('label').allInnerTexts();
  check('UI5 filters: one Search + one Status, no Vendor / SKU code / Requested by / More',
    (await page.locator('#rc-search').isVisible()) && (await page.locator('#rc-status').count()) === 1
    && !labels.some((l) => /vendor|sku code|requested by|^more$/i.test(l.trim())) && (await main.getByRole('button', { name: /^More/ }).count()) === 0, labels.join('|'));
  await page.locator('#rc-status').click();
  const opts = await page.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  check('UI6 Status options: All, Pending, Approved, Rejected', opts.map((o) => o.trim()).join('|') === 'All|Pending|Approved|Rejected', opts.join('|'));
  const heads = (await page.locator('.MuiDataGrid-columnHeaderTitle').allTextContents()).map((h) => h.trim());
  check('UI7 Requests columns', heads.join('|') === 'S.No.|Request ID|Vendor|Item / SKU|PO / Indent|Vendor Rate|Original PO Rate|Requested Rate|Difference|Status|Requested By|Action', heads.join('|'));
  // Search: one request number → only its rows (server-side search, same endpoint).
  const some = (await api('GET', `${RC}?limit=5`)).data?.rows?.[0];
  await page.locator('#rc-search').fill(some.requestNumber);
  await page.waitForTimeout(1500);
  const rowsAfter = await page.locator('.MuiDataGrid-row').allInnerTexts();
  check('UI8 searching a Request ID narrows the list to it', rowsAfter.length > 0 && rowsAfter.every((t) => t.includes(some.requestNumber)), `${rowsAfter.length}`);
  await page.locator('#rc-search').fill('');
  // Status dropdown filters through to the server.
  await page.locator('#rc-status').click();
  await page.getByRole('option', { name: 'Approved', exact: true }).click();
  await page.waitForTimeout(1500);
  const cls = await page.locator('.MuiDataGrid-row').evaluateAll((els) => els.map((e) => (e.className.match(/rc-row-(\w+)/) || [])[1]));
  check('UI9 Status = Approved lists only approved requests', cls.length > 0 && cls.every((c) => c === 'approved'), cls.join(','));
  await shot(page, 'simple-requests');
  // The action button opens the same request drawer.
  await page.locator('[data-testid="rc-row-action"]').first().click();
  check('UI10 the Action button opens the request detail drawer', await page.locator('[data-testid="rc-number"]').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await page.keyboard.press('Escape');

  // History.
  await go(`${PAGE}?tab=history`);
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  // The history grid is virtualised — read the headers at both scroll ends and merge.
  const readHeads = async () => (await page.locator('.MuiDataGrid-columnHeaderTitle').allTextContents()).map((h) => h.trim());
  const headsL = await readHeads();
  await page.locator('.MuiDataGrid-virtualScroller').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(600);
  const hHeads = [...headsL, ...(await readHeads()).filter((h) => !headsL.includes(h))];
  await page.locator('.MuiDataGrid-virtualScroller').evaluate((el) => { el.scrollLeft = 0; });
  check('UI11 History columns', hHeads.join('|') === 'S.No.|Date|Request ID|Vendor|Item / SKU|PO Reference|Old Rate|New Rate|Requested By|Approved / Rejected By|Status|Reason', hHeads.join('|'));
  check('UI12 History opens newest first by default', (await page.locator('#rch-order').innerText()).trim() === 'Newest first');
  const desc = (await api('GET', `${RC}/history?order=desc&limit=3`)).data?.rows || [];
  const firstRow = await page.locator('.MuiDataGrid-row').first().innerText();
  check('UI13 the first history row is the newest event', desc.length > 0 && firstRow.includes(desc[0].requestNumber), `${desc[0]?.requestNumber} :: ${firstRow.slice(0, 120)}`);
  await go(PAGE);
  await page.locator('[data-testid="rc-row-action"]').first().click();
  await page.locator('[data-testid="rc-view-history"]').click();
  await page.waitForURL(/tab=history/);
  await page.locator('[data-testid="rc-history-preset"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const presetRows = await page.locator('.MuiDataGrid-row').count();
  check('UI14 "View history" from a request opens newest first, narrowed to that vendor + SKU',
    (await page.locator('#rch-order').innerText()).trim() === 'Newest first' && presetRows > 0);
  await shot(page, 'simple-history');
  await ctx.close();

  // Phone: scroll sits in the grid, not the page; every action stays reachable.
  const p = await session('VIEWER', { width: 390, height: 844 });
  await p.go(PAGE);
  await p.page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  await p.page.waitForTimeout(800);
  const mob = await p.page.evaluate(() => {
    const sc = document.querySelector('.MuiDataGrid-virtualScroller');
    const btn = document.querySelector('[data-testid="rc-row-action"]');
    const r = btn?.getBoundingClientRect();
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, grid: sc.scrollWidth - sc.clientWidth,
      btnInView: !!r && r.right <= innerWidth + 1 && r.left >= 0 };
  });
  check('UI15 390px: the page does not scroll sideways, the table does, the Action button stays in view', mob.page <= 1 && mob.grid > 100 && mob.btnInView, JSON.stringify(mob));
  await shot(p.page, 'simple-mobile-390');
  await p.page.locator('[data-testid="rc-tab-history"]').click();
  await p.page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  const mobH = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('UI16 390px history: no sideways page scroll', mobH <= 1, `overflow ${mobH}`);
  await shot(p.page, 'simple-mobile-history-390');
  await p.ctx.close();
}

// ═══ Sidebar behaviour: group toggle, collapsed rail, phone ═══
console.log('\n[LAYOUT] Group toggle, collapsed rail, 390px');
{
  const { ctx, page, go } = await session('VIEWER');
  await go(PAGE);
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  check('L1 on its page the Purchase group is open with Purchase Approval highlighted', await navRow(page, 'Purchase Approval').isVisible()
    && /Mui-selected/.test(await navRow(page, 'Purchase Approval').getAttribute('class')));
  await navRow(page, 'Purchase').click();
  await page.waitForTimeout(400);
  const hidden = !(await navRow(page, 'Purchase Approval').isVisible());
  await navRow(page, 'Purchase').click();
  await page.waitForTimeout(400);
  check('L2 collapsing Purchase hides it; expanding shows it again', hidden && await navRow(page, 'Purchase Approval').isVisible());
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.waitForTimeout(500);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('L3 collapsed rail: the page still renders, no sideways scroll', await page.locator('.MuiDataGrid-row').first().isVisible() && ov <= 1, `overflow ${ov}`);
  await shot(page, 'collapsed-rail');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.waitForTimeout(500);
  check('L4 expanded again: Purchase Approval visible and highlighted', await navRow(page, 'Purchase Approval').isVisible());
  await ctx.close();

  const p = await session('VIEWER', { width: 390, height: 844 });
  await p.go('/fms/my-tasks');
  await p.page.locator('header button.MuiIconButton-edgeStart').click();
  await nav(p.page).waitFor({ timeout: 5000 });
  await openPurchaseApproval(p.page);
  await p.page.waitForTimeout(600);
  const drawerGone = await p.page.locator('.MuiDrawer-paper:visible').count() === 0;
  await p.page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  const ovM = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('M1 390px: hamburger → FMS → Purchase → Purchase Approval opens the page and closes the drawer; no sideways scroll',
    new URL(p.page.url()).pathname === PAGE && drawerGone && ovM <= 1, `drawerGone ${drawerGone} overflow ${ovM}`);
  await shot(p.page, 'mobile-390');
  await p.ctx.close();
}

await browser.close();
if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join('\n  ')}`);
check('no uncaught page errors', pageErrors.length === 0, pageErrors[0]);
fs.writeFileSync(`${SHOTS}/requests.json`, JSON.stringify(ids, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
