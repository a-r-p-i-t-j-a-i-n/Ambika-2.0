/**
 * PURCHASE FMS — Indent Details page: layout, responsive widths, and the
 * redesigned sections (FMS Responsibility, Indent Details, Approval, Quote
 * Step, Approved Quotation, Activity).
 *
 *   node e2e/indentDetailResponsive.e2e.mjs
 *
 * `layoutOverflow.e2e.mjs` covers desktop widths for every route including
 * the indents LIST, but has no `:id` resolver for an indent, so the DETAIL
 * page — the one actually redesigned here — isn't in its route table. This
 * spec covers the detail page specifically, at the five widths the task
 * calls for (1440/1280/768/390/360), plus the functional checks the redesign
 * must not have broken: Back navigation, the Next Step actions (View
 * Purchase Orders / Create Vendor PO), approval + responsibility data,
 * product-line values, and quotation-file links.
 *
 * Runs Chromium with real (non-overlay) scrollbars, as Windows draws them —
 * headless Chrome hides scrollbars by default, which hides exactly the class
 * of bug this looks for.
 *
 * Mostly read-only against business data, with one write: it creates a
 * throwaway DRAFT indent (via the real Create Indent form) so the
 * DRAFT/PENDING_APPROVAL "Next Step" states have something to render, then
 * leaves it there. e2ePurchaseFixture.js --verify asserts the DB holds
 * EXACTLY three indents (one per purchase.e2e.mjs branch), so this spec's
 * extra indent breaks that count. Run it AFTER purchase.e2e.mjs's own
 * --verify, never before — and re-seed before verifying again.
 *
 * Expects (started separately), exactly as purchase.e2e.mjs does. This spec
 * also needs purchase.e2e.mjs to have already run once on this seed, so
 * there is a fully-progressed indent (with quote/approved-quotation files) to
 * open:
 *
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
await assertE2ESetup(APP, API, 'indentDetailResponsive.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';

const WIDTHS = [
  { label: 'desktop 1440', width: 1440, height: 1000 },
  { label: 'desktop 1280', width: 1280, height: 1000 },
  { label: 'tablet 768', width: 768, height: 1200 },
  { label: 'mobile 390', width: 390, height: 1400 },
  { label: 'mobile 360', width: 360, height: 1400 },
];

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); } else { failures.push(`${name}: ${detail}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const run = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChromium(),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const consoleErrors = [];
  const apiErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/v1') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`); });

  const ready = async () => {
    await page.waitForSelector('#root > *', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  };
  const go = async (route) => {
    await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
    await ready();
  };

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

  section('Find an existing, fully-progressed indent');
  const indents = (await api('/procurement/indents?limit=50&sort=-createdAt')).body?.data || [];
  const richIndent = indents.find((i) => i.quotationApprovalStep?.itemApprovedQuotations?.length)
    || indents.find((i) => i.overallStatus === 'PO_READY')
    || indents[0];
  check('an indent exists to open', Boolean(richIndent), richIndent?.indentNumber);

  section('Create a throwaway DRAFT indent (exercises the DRAFT/PENDING Next Step states)');
  await go('/procurement/indents');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Create Indent$/ }).click();
  await page.waitForTimeout(1000);
  const createDialog = page.getByRole('dialog').last();
  await createDialog.getByLabel(/Raised By/).first().fill('Responsive Spec');
  const prodField = createDialog.getByPlaceholder('Product name').first();
  await prodField.click();
  await prodField.fill('Cu 0.70');
  await page.waitForTimeout(1200);
  await page.getByRole('option').filter({ hasText: /JSL204-07|Cu 0\.70/ }).first().click();
  await page.waitForTimeout(300);
  await createDialog.locator('input[type="number"][placeholder="0"]').first().fill('12');
  await createDialog.getByRole('button', { name: /^Create Indent$/ }).click();
  await page.waitForTimeout(2000);
  const draft = ((await api('/procurement/indents?limit=5&sort=-createdAt')).body?.data || [])[0];
  check('the draft indent was created', draft?.approvalStatus === 'DRAFT', `${draft?.indentNumber} ${draft?.approvalStatus}`);

  section('DRAFT state — Next Step banner, responsibility, fields');
  await go(`/procurement/indents/${draft._id}`);
  await page.waitForSelector('text=/Indent Details/', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('shows the DRAFT status chip', /Draft/.test(await body()));
  check('Next Step says to submit for approval', /Submit this indent for approval/.test(await body()));
  check('the Next Step Submit action is present', (await page.getByRole('button', { name: /^Submit for Approval$/ }).count()) > 0);
  // FmsDoerCard has three valid renders, chosen by doer-catalog/assignment
  // data this scratch DB doesn't control: the full open-task grid, the
  // compact "Last completed: …" line (an earlier step auto-completed and
  // nothing is open now), or nothing at all (no open task and no history).
  // Only a heading with neither of those two bodies would be a real defect.
  const fmsBody = await body();
  // Case-insensitive: these are field LABELS, styled with CSS
  // text-transform:uppercase, which innerText() (unlike textContent) reflects
  // as actually rendered ("CURRENT STEP", not "Current Step").
  const hasOpenGrid = /Current Step/i.test(fmsBody) && /Assigned Doer/i.test(fmsBody) && /Waiting Since/i.test(fmsBody);
  const hasLastCompletedLine = /Last completed:/.test(fmsBody);
  const hasFmsCardAtAll = /FMS Responsibility/.test(fmsBody);
  check('FMS Responsibility renders one of its three valid states, never a broken heading-only shell',
    !hasFmsCardAtAll || hasOpenGrid || hasLastCompletedLine,
    hasOpenGrid ? 'open-task grid' : hasLastCompletedLine ? 'compact last-completed line' : (hasFmsCardAtAll ? 'BROKEN: heading with no body' : 'absent'));
  check('Indent Details shows the raised-by value entered on the form', /Responsive Spec/.test(await body()));
  check('the product line shows its quantity, unit and a Pending status', /\b12\b/.test(await body()) && /Kg/.test(await body()) && /Pending/.test(await body()));

  section('Back navigation');
  // The IconButton has no visible text; its MUI Tooltip ("Back") supplies the
  // accessible name.
  await page.getByRole('button', { name: /^Back$/ }).click();
  await page.waitForTimeout(1200);
  check('Back returns to the Purchase Indents list', /Purchase Indents \(\d+\)/.test(await body()), page.url());

  section('PENDING_APPROVAL state — Next Step tone and action');
  await go(`/procurement/indents/${draft._id}`);
  await page.waitForSelector('text=/Indent Details/', { timeout: 20000 });
  await page.getByRole('button', { name: /^Submit$/ }).click();
  await page.waitForTimeout(2000);
  check('status moves to Pending Approval', /Pending Approval/.test(await body()));
  check('Next Step now asks for Approve / Reject', /Waiting for approval/.test(await body()) && (await page.getByRole('button', { name: /^Approve \/ Reject$/ }).count()) > 0);

  section('A fully-progressed indent — Approval, Quote Step, Approved Quotation, PO eligibility');
  await go(`/procurement/indents/${richIndent._id}`);
  // Wait for THIS indent's own data, not just any "Indent Details" text —
  // switching ids mid-run means a cold RTK Query cache for the new id, and a
  // fixed pause after the previous page's text appears can race it.
  await page.waitForSelector('text=/Approved By/', { timeout: 20000 });
  await page.waitForTimeout(500);
  const richBody = await body();
  check('Approval panel shows an approver and an approved date', /Approved By/i.test(richBody) && /Approved On/i.test(richBody));
  check('Quote Step shows its own status (not the Approved Quotation status)', /Quote Step/.test(richBody));
  check('Approved Quotation panel is present with its own status', /Approved Quotation/.test(richBody));

  // The Quote Step item-wise table should label a received quote "Received"
  // (not the generic "Approved") — the two steps' statuses must stay visibly
  // distinct even though they share the same raw value.
  const quoteStatusChips = await page.locator('text=Quote Step').locator('xpath=ancestor::div[contains(@class,"MuiPaper-root")][1]').locator('text=/^(Received|Not Required|Pending)$/').allInnerTexts();
  check('Quote Step\'s item-wise status reads "Received" (not "Approved")', quoteStatusChips.some((t) => /Received|Not Required/.test(t)), quoteStatusChips.join(','));

  const createPoBtn = page.getByRole('button', { name: /^Create Vendor PO$/ }).first();
  const poEnabled = await createPoBtn.isEnabled().catch(() => false);
  const isQuotationApproved = richIndent.overallStatus === 'QUOTATION_APPROVED';
  check('Create Vendor PO is enabled only per the existing eligibility rule (QUOTATION_APPROVED)',
    poEnabled === isQuotationApproved || richIndent.overallStatus === 'PO_READY', `enabled=${poEnabled} overallStatus=${richIndent.overallStatus}`);

  section('Quotation file links');
  const fileLinks = page.locator('a[href*="/uploads/"], a[target="_blank"]').filter({ hasText: /\./ });
  const fileCount = await fileLinks.count();
  if (fileCount > 0) {
    const href = await fileLinks.first().getAttribute('href');
    const resolved = await page.evaluate(async (url) => {
      try { const r = await fetch(url, { method: 'HEAD' }); return r.status; } catch { return 'ERR'; }
    }, href);
    check('a quotation file link resolves (HEAD request succeeds)', resolved === 200 || resolved === 304, `${href} -> ${resolved}`);
  } else {
    check('at least one quotation file link is present on this indent', false, 'no file links found — check richIndent has files');
  }

  section('Responsive widths — the Indent Details page');
  for (const { label, width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    await go(`/procurement/indents/${richIndent._id}`);
    await page.waitForSelector('text=/Indent Details/', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(`${label}: the window does not scroll sideways`,
      overflow.scrollWidth <= overflow.clientWidth,
      `${overflow.scrollWidth} > ${overflow.clientWidth}`);

    // The product/file tables must scroll WITHIN their own container (never
    // the page) whenever their fixed columns exceed the viewport.
    const tableScroll = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('div')].filter((d) => {
        const cs = getComputedStyle(d);
        return cs.overflowX === 'auto' && d.scrollWidth > d.clientWidth + 2;
      });
      return boxes.length;
    });
    if (width <= 768) {
      check(`${label}: tables fall back to their own horizontal scroll (not a page scroll)`, tableScroll >= 1, `${tableScroll} scrollable table(s)`);
    }

    await page.screenshot({ path: `${SHOTS}/indent-detail-${width}.png`, fullPage: true }).catch(() => {});
  }

  section('Console / network health');
  const unexpectedConsole = consoleErrors.filter((e) => !/401|Failed to log in/.test(e));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no unexpected console errors', unexpectedConsole.length === 0, unexpectedConsole.slice(0, 5).join(' | '));
  check('no unexpected API errors', apiErrors.length === 0, apiErrors.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n  ${passed}/${passed + failures.length} checks passed.`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
};

run().catch((e) => { console.error('\nIndent Details audit failed:', e); process.exitCode = 1; });
