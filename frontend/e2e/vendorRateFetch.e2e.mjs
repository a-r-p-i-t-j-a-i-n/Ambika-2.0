/**
 * New PO: the vendor rate a line fetches, and the whole PO → Purchase Approval →
 * Vendor Master workflow, driven through the real UI in Chromium.
 *
 *   node e2e/vendorRateFetch.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eVendorRateFetchFixture.js):
 *   backend  e2eServer.js against the ambika_e2e_ratechange scratch DB (after e2eRateChangeFixture --seed)
 *   frontend Vite with VITE_API_URL pointing at that backend
 *   data     `e2eVendorRateFetchFixture.js --prep-ui` just before (seeds the VF- vendors /
 *            SKUs, resets their rates, writes e2e/shots/vendor-rate-fetch-manifest.json
 *            and makes fresh approved indents) — run it again before every run
 * Ports default to :5096 / :3100; override with PROBE_API / PROBE_APP.
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

const APP = process.env.PROBE_APP || 'http://127.0.0.1:3100';
const API = process.env.PROBE_API || 'http://127.0.0.1:5096/api/v1';
await assertE2ESetup(APP, API, 'vendorRateFetch.e2e.mjs');
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/vendorratefetch';
fs.mkdirSync(SHOTS, { recursive: true });
const m = JSON.parse(fs.readFileSync('e2e/shots/vendor-rate-fetch-manifest.json', 'utf8'));
const RUN = Date.now().toString(36).slice(-5);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};
const pageErrors = [];
const browser = chromium.launch
  ? await chromium.launch({ executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] }).catch(() => chromium.launch({ channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] }))
  : null;

const session = async (who, viewport = { width: 1500, height: 1050 }) => {
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
const snack = (page, re) => page.getByText(re).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);

// ── helpers on the New PO form ──
const openForm = async (page, go, indent) => {
  await go(`/procurement/indents/${indent._id}`);
  await page.getByRole('button', { name: 'Create Vendor PO' }).first().click();
  await page.getByText('New Purchase Order').waitFor();
  await page.waitForTimeout(1200);
};
const pickVendor = async (page, name) => {
  const v = page.getByRole('combobox', { name: 'Vendor *' });
  await v.click();
  await v.fill(name.replace(/^VF /, ''));
  await page.getByRole('option', { name: new RegExp(name) }).first().click();
};
const line = (page, sku) => page.locator(`[data-testid="po-line"][data-sku="${sku}"]`);
const rateOf = (page, sku) => line(page, sku).locator('[data-testid="po-line-rate"]');
// A line has "answered" once it shows a vendor rate or one of the messages.
const answered = (page, sku) => line(page, sku).locator('[data-testid="po-vendor-rate"], [data-testid="po-rate-missing"], [data-testid="po-rate-blocked"], [data-testid="po-rate-error"]')
  .first().waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
const rateNow = async (page, sku) => Number(await rateOf(page, sku).inputValue());
const fillLead = async (page) => { await page.locator('[data-testid="po-lead-time"]').fill('7'); await page.waitForTimeout(250); };
const pendingByReason = async (api, reason) => ((await api('GET', '/procurement/rate-changes?status=PENDING&limit=200')).data?.rows || []).filter((r) => r.reason === reason);
const vendorRate = async (api, vendorId, sku, unit) => (await api('GET', `/procurement/rate-changes/vendor-rate?vendorId=${vendorId}&skuCode=${sku}&unit=${unit}`)).data;

const SKU = { A: m.skus.A.code, BOX: m.skus.BOX.code, KG: m.skus.KG.code, WRONG: m.skus.WRONG.code, ZERO: m.skus.ZERO.code, LOOSE: m.skus.LOOSE.code };
const qtyOf = (indent, sku) => Number(indent.items.find((i) => i.skuCode === sku).qty);
let poId = null; let reqA = null; let reqBox = null; let vendors = {};
const REASON_A = `VF nuts surcharge ${RUN}`;
const REASON_BOX = `VF gloves price rise ${RUN}`;

// ═══ BUYER — the form fetches, per vendor, per unit ═══
console.log('\n[BUYER] New PO — what each line fetches');
{
  const { ctx, page, go, api } = await session('BUYER');
  const vl = (await api('GET', '/vendors?limit=200')).data || [];
  vendors = Object.fromEntries(Object.entries(m.vendors).map(([k, n]) => [k, vl.find((v) => v.name === n)?._id]));

  await openForm(page, go, m.main);
  check('F0 the three lines show, no rate fetched before a vendor is chosen',
    await line(page, SKU.A).count() === 1 && await rateOf(page, SKU.A).inputValue() === '' && await page.locator('[data-testid="po-vendor-rate"]').count() === 0);
  await pickVendor(page, m.vendors.V1);
  await answered(page, SKU.A); await answered(page, SKU.BOX); await answered(page, SKU.KG);
  check('F1 V1 Alpha: nuts fetch 50 (its Pcs row)', await rateNow(page, SKU.A) === 50, await rateOf(page, SKU.A).inputValue());
  check('F2 V1 Alpha: gloves in BOX fetch 250 — not the per-piece 10 listed before it', await rateNow(page, SKU.BOX) === 250, await rateOf(page, SKU.BOX).inputValue());
  check('F3 V1 Alpha: steel rod in KGS fetches its "Kg" row, 70', await rateNow(page, SKU.KG) === 70, await rateOf(page, SKU.KG).inputValue());
  const cap = await line(page, SKU.BOX).locator('[data-testid="po-vendor-rate"]').innerText();
  check('F4 the fetched rate is displayed clearly: "Vendor rate ₹250.00 / BOX — fetched from VF Alpha Supplies"', /Vendor rate ₹250\.00 \/ BOX/.test(cap) && /VF Alpha Supplies/.test(cap), cap);
  const boxTotal = (await line(page, SKU.BOX).innerText());
  check('F5 the gloves line total uses 250 (qty × 250, not × 10)', boxTotal.includes((qtyOf(m.main, SKU.BOX) * 250).toFixed(2)), boxTotal.replace(/\s+/g, ' ').slice(0, 200));
  check('F6 an unchanged fetched rate needs no approval (no "Needs approval", no reason box)',
    await page.locator('[data-testid="po-rate-needs-approval"]').count() === 0 && await page.locator('[data-testid="po-rate-reason"]').count() === 0);
  await shot(page, 'form-v1');

  await pickVendor(page, m.vendors.V2);
  await page.waitForFunction(() => document.querySelector('[data-testid="po-vendor-rate"]')?.textContent.includes('VF Beta Traders'), null, { timeout: 12000 }).catch(() => {});
  await answered(page, SKU.A); await answered(page, SKU.BOX); await answered(page, SKU.KG);
  check('F7 switching to V2 Beta: its own rates — 60 / 260 / 75 — with nothing left over from V1',
    await rateNow(page, SKU.A) === 60 && await rateNow(page, SKU.BOX) === 260 && await rateNow(page, SKU.KG) === 75,
    `${await rateOf(page, SKU.A).inputValue()} / ${await rateOf(page, SKU.BOX).inputValue()} / ${await rateOf(page, SKU.KG).inputValue()}`);
  await shot(page, 'form-v2');

  // Raise 50 → 55 on nuts and 250 → 270 on gloves at V1 in ONE PO.
  await pickVendor(page, m.vendors.V1);
  await page.waitForFunction(() => document.querySelector('[data-testid="po-vendor-rate"]')?.textContent.includes('VF Alpha Supplies'), null, { timeout: 12000 }).catch(() => {});
  await answered(page, SKU.A); await answered(page, SKU.BOX);
  check('F8 back on V1: 50 / 250 / 70 again', await rateNow(page, SKU.A) === 50 && await rateNow(page, SKU.BOX) === 250 && await rateNow(page, SKU.KG) === 70);
  await rateOf(page, SKU.A).fill('55');
  await rateOf(page, SKU.BOX).fill('270');
  await page.waitForTimeout(250);
  check('F9 changing a fetched rate flags exactly those two lines "Needs approval"',
    await line(page, SKU.A).locator('[data-testid="po-rate-needs-approval"]').isVisible() && await line(page, SKU.BOX).locator('[data-testid="po-rate-needs-approval"]').isVisible()
    && await line(page, SKU.KG).locator('[data-testid="po-rate-needs-approval"]').count() === 0);
  const hint = await line(page, SKU.A).locator('[data-testid="po-rate-change-hint"]').innerText();
  check('F10 the hint shows original vendor rate, proposed rate and the difference', /₹50\.00 → ₹55\.00/.test(hint) && /\+₹5\.00 \(\+10%\)/.test(hint), hint);
  await fillLead(page);
  const before = (await api('GET', '/procurement/rate-changes?limit=1')).data.summary.total;
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('F11 saving without reasons is stopped with a message and raises nothing', await snack(page, /Give a reason for changing the rate/)
    && (await api('GET', '/procurement/rate-changes?limit=1')).data.summary.total === before);
  await line(page, SKU.A).locator('[data-testid="po-rate-reason"]').fill(REASON_A);
  await line(page, SKU.BOX).locator('[data-testid="po-rate-reason"]').fill(REASON_BOX);
  await shot(page, 'form-two-changes');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('F12 saved as a DRAFT — "2 rate changes sent to Rate Change Approvals"', await snack(page, /2 rate changes sent to Rate Change Approvals/));
  const ra = (await pendingByReason(api, REASON_A))[0];
  const rb = (await pendingByReason(api, REASON_BOX))[0];
  reqA = ra; reqBox = rb;
  check('F13 two PENDING requests: nuts 50→55 and gloves 250→270, each with its reason, on the same PO',
    ra?.existingVendorRate === 50 && ra.requestedRate === 55 && rb?.existingVendorRate === 250 && rb.requestedRate === 270 && ra.poId === rb.poId, JSON.stringify([ra, rb]));
  poId = ra?.poId;
  const vr = await vendorRate(api, vendors.V1, SKU.A, 'PCS');
  check('F14 the Vendor Master is unchanged while they wait (nuts still 50)', vr.rate === 50);

  // PO detail as the doer.
  await go(`/procurement/purchase-orders/${poId}`);
  await page.locator('[data-testid="po-rate-changes-panel"]').waitFor({ timeout: 15000 });
  const rows = page.locator('[data-testid="po-rate-change-row"]');
  check('F15 the PO lists both requests with status "Rate Approval Pending"', await rows.count() === 2 && (await rows.allInnerTexts()).every((t) => /Rate Approval Pending/.test(t)));
  const firstRow = await rows.filter({ hasText: 'VF Hex Nut' }).first().innerText();
  check('F16 …with vendor rate → proposed rate, the difference and the doer\'s reason', /₹50\.00/.test(firstRow) && /₹55\.00/.test(firstRow) && /\+₹5\.00/.test(firstRow) && firstRow.includes(REASON_A), firstRow.replace(/\s+/g, ' '));
  const tagA = await page.locator('[data-testid="po-line-rate-change"]').first().innerText();
  const diffA = await page.locator('[data-testid="po-line-rate-diff"]').first().innerText();
  check('F17 the item line says "Rate Approval Pending · RC-…" and shows Vendor ₹ → proposed ₹', /Rate Approval Pending · RC-/.test(tagA) && /Vendor ₹\d+\.00 → ₹\d+\.00/.test(diffA), `${tagA} | ${diffA}`);
  check('F18 the PO banner says it is held for rate approval', /2 rate changes/.test(await page.locator('[data-testid="po-rate-change-banner"]').innerText()));
  await shot(page, 'po-detail-pending');
  await ctx.close();
}

// ═══ POAPPROVER — cannot approve the PO while the rates wait ═══
console.log('\n[PO APPROVER] PO approval is held');
{
  const { ctx, page, go, api } = await session('POAPPROVER');
  await go(`/procurement/purchase-orders/${poId}`);
  await page.getByRole('button', { name: /Approve \/ Reject/ }).first().click();
  const hold = page.locator('[data-testid="po-approval-rate-hold"]');
  await hold.waitFor({ timeout: 10000 });
  check('P1 the approval dialog says 2 rate changes await approval', /2 rate changes/.test(await hold.innerText()));
  check('P2 …and its Approve button is disabled', await page.locator('[data-testid="po-approve-confirm"]').isDisabled());
  const direct = await api('POST', `/procurement/purchase-orders/${poId}/approve`, { decision: 'APPROVED', remarks: 'direct API call' });
  check('P3 calling the API directly is refused too (400), the PO stays a draft', direct.status === 400 && /awaiting approval/.test(direct.message || ''), `${direct.status} ${direct.message}`);
  await ctx.close();
}

// ═══ APPROVER — approve one in the Purchase Approval page, reject the other ═══
console.log('\n[APPROVER] Purchase Approval');
{
  const { ctx, page, go, api } = await session('APPROVER');
  await go(`/purchase-fms/rate-change-approvals?request=${reqA._id}`);
  const drawer = page.locator('[data-testid="rate-change-drawer"]');
  await drawer.waitFor();
  await page.locator('[data-testid="rc-number"]', { hasText: reqA.requestNumber }).waitFor({ timeout: 15000 });
  const dt = await drawer.innerText();
  check('A1 the drawer shows vendor, SKU, original vendor rate, proposed rate, difference and the doer\'s reason',
    dt.includes('VF Alpha Supplies') && dt.includes(SKU.A) && (await page.locator('[data-testid="rc-existing"]').innerText()) === '₹50.00'
    && (await page.locator('[data-testid="rc-requested"]').innerText()) === '₹55.00' && (await page.locator('[data-testid="rc-diff"]').innerText()) === '+₹5.00 (+10%)'
    && (await page.locator('[data-testid="rc-reason"]').innerText()).includes(REASON_A));
  await page.locator('[data-testid="rc-remarks"]').fill('VF checked with the vendor');
  await page.locator('[data-testid="rc-approve"]').click();
  check('A2 approve → "approved — vendor rate and PO updated"', await snack(page, /approved — vendor rate and PO updated/));
  await page.waitForTimeout(700);
  const vr = await vendorRate(api, vendors.V1, SKU.A, 'PCS');
  check('A3 the Vendor Master now has 55 for V1 nuts', vr.rate === 55, JSON.stringify(vr));
  check('A4 V2 keeps its own 60 for the same SKU', (await vendorRate(api, vendors.V2, SKU.A, 'PCS')).rate === 60);
  let po = (await api('GET', `/procurement/purchase-orders/${poId}`)).data;
  const lA = po.items.find((i) => i.skuCode === SKU.A);
  check('A5 the PO line is APPROVED at 55, totals recalculated, the PO is still a DRAFT',
    lA.rate === 55 && lA.rateChangeStatus === 'APPROVED' && lA.taxableAmount === Math.round(Number(lA.quantity) * 55 * 100) / 100 && po.approvalStatus === 'DRAFT'
    && Math.abs(po.totalTaxableValue - po.items.reduce((s, i) => s + i.taxableAmount, 0)) < 0.01, JSON.stringify([lA.rate, lA.rateChangeStatus, po.approvalStatus]));

  // Reject the gloves.
  await go(`/purchase-fms/rate-change-approvals?request=${reqBox._id}`);
  await drawer.waitFor();
  await page.locator('[data-testid="rc-number"]', { hasText: reqBox.requestNumber }).waitFor({ timeout: 15000 });
  await page.locator('[data-testid="rc-reject"]').click();
  const confirm = page.locator('[data-testid="rc-reject-confirm"]');
  check('A6 Reject needs a reason (button disabled while empty)', await confirm.isDisabled());
  await page.locator('[data-testid="rc-reject-reason"]').fill('VF keep the contract rate');
  await confirm.click();
  check('A7 reject → success message', await snack(page, /rejected/));
  await page.waitForTimeout(700);
  check('A8 the Vendor Master keeps 250 for the gloves in BOX', (await vendorRate(api, vendors.V1, SKU.BOX, 'BOX')).rate === 250);
  po = (await api('GET', `/procurement/purchase-orders/${poId}`)).data;
  const lBox = po.items.find((i) => i.skuCode === SKU.BOX);
  check('A9 the rejected 270 is not left on the PO: the line is back at 250, REJECTED, still a DRAFT', lBox.rate === 250 && lBox.rateChangeStatus === 'REJECTED' && po.approvalStatus === 'DRAFT', JSON.stringify([lBox.rate, lBox.rateChangeStatus]));

  // History tab.
  await go('/purchase-fms/rate-change-approvals?tab=history');
  await page.waitForTimeout(1500);
  const histTxt = await page.locator('.MuiDataGrid-root').last().innerText();
  check('A10 Rate Change History lists both requests and both decisions (newest first)', histTxt.includes(reqA.requestNumber) && histTxt.includes(reqBox.requestNumber), histTxt.slice(0, 300).replace(/\s+/g, ' '));
  await shot(page, 'history');
  await ctx.close();
}

// ═══ BUYER again — sees the decisions, reopens the draft, PO then approves ═══
console.log('\n[BUYER] After the decisions');
{
  const { ctx, page, go, api } = await session('BUYER');
  await go(`/procurement/purchase-orders/${poId}`);
  await page.locator('[data-testid="po-rate-changes-panel"]').waitFor({ timeout: 15000 });
  const rows = page.locator('[data-testid="po-rate-change-row"]');
  const statuses = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-status')).sort());
  check('B1 the PO shows one APPROVED and one REJECTED request', statuses.join() === 'APPROVED,REJECTED', statuses.join());
  const rej = await rows.filter({ hasText: 'VF Nitrile Gloves' }).first().innerText();
  check('B2 the rejection shows its status, the approver\'s reason and the doer\'s original reason', /Rate Rejected/.test(rej) && /VF keep the contract rate/.test(rej) && rej.includes(REASON_BOX), rej.replace(/\s+/g, ' '));
  check('B3 no banner holds the PO any more', await page.locator('[data-testid="po-rate-change-banner"]').count() === 0);
  await shot(page, 'po-detail-decided');

  // Reopen the draft: the approved rate is there, the rejected line is back on the vendor rate.
  await page.getByRole('button', { name: /^Edit/ }).first().click().catch(async () => { await page.getByRole('button', { name: /Edit/ }).first().click(); });
  await page.getByText(/^Edit /).first().waitFor({ timeout: 10000 });
  await answered(page, SKU.A); await answered(page, SKU.BOX);
  check('B4 reopened: nuts at the approved 55, gloves back at 250', await rateNow(page, SKU.A) === 55 && await rateNow(page, SKU.BOX) === 250);
  check('B5 reopened: nuts show the vendor\'s NEW rate 55, so no further approval is asked', /₹55\.00/.test(await line(page, SKU.A).locator('[data-testid="po-vendor-rate"]').innerText())
    && await page.locator('[data-testid="po-rate-needs-approval"]').count() === 0);
  await shot(page, 'form-reopened');
  await page.keyboard.press('Escape');
  await ctx.close();
}
{
  const { ctx, api } = await session('POAPPROVER');
  const r = await api('POST', `/procurement/purchase-orders/${poId}/approve`, { decision: 'APPROVED', remarks: 'after rate decisions' });
  check('B6 the normal PO approval now goes through (the PO was a draft all along)', r.status === 200 && r.data?.approvalStatus === 'APPROVED' && r.data.poNumber, `${r.status} ${r.message}`);
  await ctx.close();
}

// ═══ BUYER — lines with no usable vendor rate ═══
console.log('\n[BUYER] No usable vendor rate');
{
  const { ctx, page, go, api } = await session('BUYER');
  // Unit: V1 prices the tape per Pcs only; the indent line is BOX.
  await openForm(page, go, m.wrong);
  await answered(page, SKU.WRONG);
  const blocked = await line(page, SKU.WRONG).locator('[data-testid="po-rate-blocked"]').innerText().catch(() => '');
  check('N1 a BOX line the vendor prices per Pcs fetches NOTHING and says why', await rateOf(page, SKU.WRONG).inputValue() === '' && /per Pcs/.test(blocked) && /BOX/.test(blocked), blocked);
  await rateOf(page, SKU.WRONG).fill('5');
  await fillLead(page);
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('N2 …and it cannot be saved, even at the vendor\'s Pcs rate', await snack(page, /per Pcs/));
  await ctx.close();
}
{
  const { ctx, page, go, api } = await session('BUYER');
  // Rate 0 row.
  await openForm(page, go, m.zero);
  await answered(page, SKU.ZERO);
  const missing = await line(page, SKU.ZERO).locator('[data-testid="po-rate-missing"]').innerText().catch(() => '');
  check('N3 a vendor row without a rate: "No vendor rate configured for this item." — nothing fetched', await rateOf(page, SKU.ZERO).inputValue() === '' && /No vendor rate configured for this item\./.test(missing), missing);
  await rateOf(page, SKU.ZERO).fill('20');
  await page.waitForTimeout(250);
  check('N4 a rate typed there is the vendor\'s FIRST rate: flagged "New vendor rate", no approval reason asked',
    await line(page, SKU.ZERO).locator('[data-testid="po-rate-new"]').isVisible() && await page.locator('[data-testid="po-rate-reason"]').count() === 0);
  await shot(page, 'form-no-rate');
  await fillLead(page);
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  check('N5 it saves as a draft without a rate change request', await snack(page, /saved as draft/));
  await ctx.close();
}
{
  const { ctx, page, go, api } = await session('BUYER');
  // Item with only a loosely similar vendor row (vendor fixed for the item).
  await openForm(page, go, m.loose);
  await answered(page, SKU.LOOSE);
  check('N6 "VF Bolt M10" does not borrow the vendor\'s "VF Bolt M10 Long" rate (33)', await rateOf(page, SKU.LOOSE).inputValue() === ''
    && await line(page, SKU.LOOSE).locator('[data-testid="po-rate-missing"]').isVisible());
  await ctx.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (pageErrors.length) console.log(`page errors (${pageErrors.length}):\n  ${pageErrors.slice(0, 8).join('\n  ')}`);
await browser.close();
process.exit(failed.length || pageErrors.length ? 1 : 0);
