/**
 * PO Rate Change Approvals, driven through the real UI in Chromium: the New PO
 * form (fetched vendor rate, "Needs approval", mandatory reason), the sidebar
 * Purchase Approval entry, the Requests / History tabs, the request drawer (approve,
 * stale-rate confirmation, reject with a reason) and the PO detail line status.
 *
 *   node e2e/rateChange.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eRateChangeFixture.js):
 *   backend  e2eServer.js against the ambika_e2e_ratechange scratch DB
 *   frontend Vite with VITE_API_URL pointing at that backend
 *   data     `--prep-ui` run just before (writes e2e/shots/rate-change-manifest.json;
 *            resets RC Alpha Fasteners / RC-SKU-A to 100 and raises one 100 → 108 request)
 * Ports default to :5096 / :3103; override with PROBE_API / PROBE_APP.
 * One run uses the prepped Pending-for-PO item and decides both requests —
 * run --prep-ui again before the next run.
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
await assertE2ESetup(APP, API, 'rateChange.e2e.mjs');
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/ratechange';
fs.mkdirSync(SHOTS, { recursive: true });
const m = JSON.parse(fs.readFileSync('e2e/shots/rate-change-manifest.json', 'utf8'));

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
  const api = (method, p, body) => page.evaluate(async ([base, mth, url, b]) => {
    const r = await fetch(`${base}${url}`, {
      method: mth,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }, [API, method, p, body]);
  await go('/');
  await page.locator('input[autocomplete="email"]').fill(m.users[who]);
  await page.locator('input[autocomplete="current-password"]').fill(m.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  return { ctx, page, go, api, ready };
};
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const snack = (page, re) => page.getByText(re).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);

// ═══ BUYER — New PO with a changed rate ═══
console.log('\n[BUYER] New PO — fetched rate, changed rate, reason');
let buyerRequest = null;
{
  const { ctx, page, go, api } = await session('BUYER');
  const items = (await api('GET', '/procurement/purchase-orders/approved-items')).data?.items || [];
  const item = items.find((o) => o.indentId === m.formIndent._id);
  check('B0 prepped Pending-for-PO item present (fixed to RC Alpha Fasteners)', item && item.vendorName === m.vendor.name, JSON.stringify(item));

  await go('/purchase-fms/purchase-orders');
  await page.getByRole('tab', { name: /Pending for PO/ }).click();
  const row = page.locator('.MuiDataGrid-row', { hasText: item.indentItemDisplayNumber });
  await row.waitFor({ timeout: 20000 });
  await row.getByRole('button', { name: 'Create PO' }).click();
  await page.getByText('New Purchase Order').waitFor();
  const rate = page.locator('input[placeholder="0.00"]').first();
  await page.waitForFunction(() => {
    const el = document.querySelector('input[placeholder="0.00"]');
    return el && el.value !== '';
  }, null, { timeout: 15000 }).catch(() => {});
  check('B1 the rate is fetched from the vendor (100)', Number(await rate.inputValue()) === 100, await rate.inputValue());
  check('B2 no "Needs approval" while the rate is the vendor\'s', await page.locator('[data-testid="po-rate-needs-approval"]').count() === 0);

  await rate.fill('104');
  await page.waitForTimeout(200);
  check('B3 changing it flags "Needs approval"', await page.locator('[data-testid="po-rate-needs-approval"]').isVisible());
  const hint = await page.locator('[data-testid="po-rate-change-hint"]').innerText();
  check('B4 the hint shows vendor rate → new rate and the difference', /₹100\.00 → ₹104\.00/.test(hint) && /\+₹4\.00 \(\+4%\)/.test(hint), hint);
  check('B5 the footer says it will go to Rate Change Approvals', /1 rate change will go to Rate Change Approvals/.test(await page.locator('[data-testid="po-rate-change-note"]').innerText()));
  const pageText = await page.locator('.MuiDialog-paper').innerText();
  check('B6 the line totals use the new rate (taxable 4 × 104 or qty × 104 shown)', pageText.includes((Number(item.approvedQuantity) * 104).toFixed(2)), `qty ${item.approvedQuantity}`);
  await page.locator('[data-testid="po-lead-time"]').fill('7');
  await page.waitForTimeout(300);
  await shot(page, 'po-form-needs-approval');

  const before = (await api('GET', '/procurement/rate-changes?limit=1')).data.summary.total;
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('B7 saving without a reason is stopped with a message', await snack(page, /Give a reason for changing the rate/));
  check('B8 …and raises nothing', (await api('GET', '/procurement/rate-changes?limit=1')).data.summary.total === before);
  await page.locator('[data-testid="po-rate-reason"]').fill('Vendor surcharge for urgent delivery');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('B9 saved — "sent to Rate Change Approvals"', await snack(page, /1 rate change sent to Rate Change Approvals/));
  const list = (await api('GET', '/procurement/rate-changes?status=PENDING&limit=200')).data;
  buyerRequest = list.rows.find((r) => r.reason === 'Vendor surcharge for urgent delivery');
  check('B10 a PENDING request 100 → 104 exists for the buyer', buyerRequest && buyerRequest.existingVendorRate === 100 && buyerRequest.requestedRate === 104, JSON.stringify(buyerRequest));
  const vr = (await api('GET', `/procurement/rate-changes/vendor-rate?vendorId=${m.vendor._id}&skuCode=${m.sku.code}&unit=PCS`)).data;
  check('B11 the vendor rate is still 100', vr.rate === 100);

  // Sidebar FMS → Purchase → Purchase Approval + list as a doer (the header
  // "Rate Changes" button was removed).
  await go('/purchase-fms/purchase-orders');
  const navItem = page.locator('.MuiDrawer-paper:visible').getByRole('button', { name: 'Purchase Approval', exact: true });
  await navItem.waitFor({ timeout: 10000 }).catch(() => {});
  check('B12 sidebar shows Purchase Approval under Purchase; no "Rate Changes" header button', await navItem.isVisible()
    && await page.locator('[data-testid="pfms-rate-changes"]').count() === 0);
  await navItem.click();
  await page.waitForURL(/rate-change-approvals/);
  await page.locator('.MuiDataGrid-row', { hasText: buyerRequest.requestNumber }).waitFor({ timeout: 15000 });
  check('B13 the doer sees their request in the list', true);
  check('B14 …with the "you can follow" note (no approve rights)', await page.getByText(/You can follow these requests here/).isVisible());
  await page.locator('.MuiDataGrid-row', { hasText: buyerRequest.requestNumber }).click();
  await page.locator('[data-testid="rate-change-drawer"]').waitFor();
  await page.waitForTimeout(600);
  check('B15 the drawer opens without Approve / Reject for the doer', await page.locator('[data-testid="rc-approve"]').count() === 0 && await page.locator('[data-testid="rc-reject"]').count() === 0);
  await shot(page, 'doer-drawer');
  await ctx.close();
}

// ═══ APPROVER — approve, stale confirmation, reject ═══
console.log('\n[APPROVER] Decide');
{
  const { ctx, page, go, api } = await session('APPROVER');
  await go(`/purchase-fms/rate-change-approvals?request=${m.pendingRequest._id}`);
  const drawer = page.locator('[data-testid="rate-change-drawer"]');
  await drawer.waitFor();
  await page.locator('[data-testid="rc-number"]', { hasText: m.pendingRequest.requestNumber }).waitFor({ timeout: 15000 });
  check('A1 ?request= opens that request', true);
  check('A2 rates: vendor 100, requested 108, +₹8.00 (+8%)', (await page.locator('[data-testid="rc-existing"]').innerText()) === '₹100.00'
    && (await page.locator('[data-testid="rc-requested"]').innerText()) === '₹108.00'
    && (await page.locator('[data-testid="rc-diff"]').innerText()) === '+₹8.00 (+8%)');
  check('A3 reason, PO and requester shown', (await page.locator('[data-testid="rc-reason"]').innerText()).includes('freight surcharge')
    && (await drawer.innerText()).includes(m.pendingRequest.poRef));
  await shot(page, 'approver-drawer');
  await page.locator('[data-testid="rc-remarks"]').fill('Checked with vendor');
  await page.locator('[data-testid="rc-approve"]').click();
  check('A4 approve → success message', await snack(page, /approved — vendor rate and PO updated/));
  await page.waitForTimeout(800);
  check('A5 the drawer now says Approved', (await drawer.innerText()).includes('Approved by'));
  const vr = (await api('GET', `/procurement/rate-changes/vendor-rate?vendorId=${m.vendor._id}&skuCode=${m.sku.code}&unit=PCS`)).data;
  check('A6 the vendor rate is now 108', vr.rate === 108);

  // The buyer's 100 → 104 request is now stale (vendor at 108).
  await go(`/purchase-fms/rate-change-approvals?request=${buyerRequest._id}`);
  await page.locator('[data-testid="rc-number"]', { hasText: buyerRequest.requestNumber }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check('A7 stale warning: vendor rate changed 100 → 108 since the request', /changed from ₹100\.00 to ₹108\.00/.test(await page.locator('[data-testid="rc-stale"]').innerText()));
  check('A8 Approve is disabled until the approver confirms the current rate', await page.locator('[data-testid="rc-approve"]').isDisabled());
  await page.locator('[data-testid="rc-ack"]').check();
  check('A9 …and enabled once confirmed', await page.locator('[data-testid="rc-approve"]').isEnabled());
  await page.locator('[data-testid="rc-ack"]').uncheck();
  await shot(page, 'approver-stale');
  await page.locator('[data-testid="rc-reject"]').click();
  const confirm = page.locator('[data-testid="rc-reject-confirm"]');
  check('A10 Reject needs a reason (button disabled while empty)', await confirm.isDisabled());
  await page.locator('[data-testid="rc-reject-reason"]').fill('Use the revised contract rate');
  await confirm.click();
  check('A11 reject → success message', await snack(page, /rejected/));
  await page.waitForTimeout(800);
  check('A12 the drawer shows the rejection and its reason', /Use the revised contract rate/.test(await page.locator('[data-testid="rc-rejected-note"]').innerText()));
  const after = (await api('GET', `/procurement/rate-changes/${buyerRequest._id}`)).data;
  check('A13 rejected: vendor still 108; the draft line went back to 108', after.status === 'REJECTED' && after.currentVendorRate === 108 && after.po?.line?.rate === 108, JSON.stringify({ s: after.status, v: after.currentVendorRate, l: after.po?.line?.rate }));

  // History.
  await page.locator('[data-testid="rc-view-history"]').click();
  await page.waitForURL(/tab=history/);
  await page.locator('[data-testid="rc-history-preset"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  // Chronological (oldest first) and only rendered rows are in the DOM — after
  // earlier --api runs this run's rows are out of view, so read newest first.
  // History now opens newest first by default.
  check('A14a History opens "Newest first" by default', (await page.locator('#rch-order').innerText()).trim() === 'Newest first');
  const rowsText = await page.locator('.MuiDataGrid-main').innerText();
  // Status is past the sideways scroll (MUI X renders only the visible columns).
  await page.locator('.MuiDataGrid-virtualScroller').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(600);
  const statusText = await page.locator('.MuiDataGrid-main').innerText();
  const presetText = await page.locator('[data-testid="rc-history-preset"]').innerText();
  const hist = (await api('GET', `/procurement/rate-changes/history?vendorId=${m.vendor._id}&skuCode=${m.sku.code}&limit=1`)).data;
  check('A14 "View history" opens the history for that vendor + SKU', presetText.includes(m.sku.code) && presetText.includes(m.vendor.name)
    && (await page.locator('.MuiDataGrid-row').count()) > 0 && hist.pagination.total > 0, presetText);
  check('A15 history rows: pending (requested), approved and rejected events with both request numbers', /Pending/.test(statusText) && /Approved/.test(statusText) && /Rejected/.test(statusText)
    && rowsText.includes(m.pendingRequest.requestNumber) && rowsText.includes(buyerRequest.requestNumber));
  await shot(page, 'history');

  // Requests tab + status filter.
  await page.locator('[data-testid="rc-tab-requests"]').click();
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^\s*\d+\s*Rejected\s*$/ }).click();
  await page.waitForTimeout(1500);
  // The Status column is past the sideways scroll (not rendered) — the row class carries it.
  const statuses = await page.locator('.MuiDataGrid-row').evaluateAll((els) => els.map((e) => (e.className.match(/rc-row-(\w+)/) || [])[1]?.toUpperCase()));
  check('A16 the Rejected card filters the list to rejected requests', statuses.length > 0 && statuses.every((s) => s === 'REJECTED'), `[${statuses.join(',')}]`);
  await shot(page, 'requests-rejected');

  // PO detail shows the line's rate change status.
  await go(`/procurement/purchase-orders/${after.po._id}`);
  const lineTag = page.locator('[data-testid="po-line-rate-change"]');
  await lineTag.waitFor({ timeout: 15000 });
  check('A17 PO detail line shows "Rejected · RC-…"', (await lineTag.innerText()).includes(`Rejected · ${buyerRequest.requestNumber}`));
  await go(`/procurement/purchase-orders/${m.pendingRequest.poId}`);
  await page.locator('[data-testid="po-line-rate-change"]').waitFor({ timeout: 15000 });
  check('A18 the approved PO line shows "Approved · RC-…" at 108.00', (await page.locator('[data-testid="po-line-rate-change"]').innerText()).includes('Approved')
    && (await page.locator('table').first().innerText()).includes('108.00'));
  await ctx.close();
}

// ═══ Phone width ═══
console.log('\n[VIEWER] 390px');
{
  const { ctx, page, go } = await session('VIEWER', { width: 390, height: 844 });
  await go('/purchase-fms/rate-change-approvals');
  await page.locator('.MuiDataGrid-row').first().waitFor({ timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('M1 the page does not scroll sideways at 390px', overflow <= 1, `overflow ${overflow}px`);
  await shot(page, 'mobile-390');
  await ctx.close();
}

await browser.close();
if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join('\n  ')}`);
check('no uncaught page errors', pageErrors.length === 0, pageErrors[0]);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
