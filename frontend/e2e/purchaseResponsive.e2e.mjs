/**
 * PURCHASE FMS — responsive layout, Quick Actions dropdown, serial numbering,
 * filters and row selection.
 *
 *   node e2e/purchaseResponsive.e2e.mjs
 *
 * Covers what layoutOverflow.e2e.mjs deliberately does not: TABLET and MOBILE
 * widths, and the behaviour of the controls this screen gained — the Create
 * dropdown, the S.No column across pagination, the Type filter, the column
 * chooser and grid row selection feeding Bulk Approve.
 *
 * Runs Chromium with real (non-overlay) scrollbars, as Windows draws them —
 * headless Chrome hides scrollbars by default, which hides exactly the class of
 * bug this looks for.
 *
 * It seeds its OWN indents through the API (topping the list up to 14) so
 * pagination has more than one page. That means it ADDS rows to the scratch
 * database, so run it AFTER e2ePurchaseFixture.js --verify — the oracle counts
 * indents and will object to the extra ones. Re-seed before running the oracle
 * again.
 *
 * Expects (started separately), exactly as purchase.e2e.mjs does:
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
await assertE2ESetup(APP, API, 'purchaseResponsive.e2e.mjs');
const USER = { email: 'purchase-e2e@test.local', password: 'E2e@12345' };
const SHOTS = process.env.SHOT_DIR || 'e2e/shots';
const INDENTS_ROUTE = '/purchase-fms/purchase-indents';

// Enough indents that a 10-row page is not the whole list.
const SEED_COUNT = 14;
const PAGE_SIZE = 10;

const WIDTHS = [
  { label: 'desktop 1440', width: 1440, height: 900 },
  { label: 'desktop 1280', width: 1280, height: 800 },
  { label: 'tablet 768', width: 768, height: 1024 },
  { label: 'mobile 390', width: 390, height: 844 },
  { label: 'mobile 360', width: 360, height: 800 },
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  };

  // ── Login ──
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready();
  await page.locator('input[autocomplete="email"]').fill(USER.email);
  await page.locator('input[autocomplete="current-password"]').fill(USER.password);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30000 });

  // ── Seed indents through the real API ──
  const api = (p, init) => page.evaluate(async ([url, opts]) => {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${localStorage.getItem('token')}`, ...(opts?.headers || {}) },
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  }, [`${API}${p}`, init]);

  const before = await api('/procurement/indents?limit=1');
  const existing = before.body?.meta?.total || 0;
  const need = Math.max(0, SEED_COUNT - existing);
  for (let i = 0; i < need; i += 1) {
    // Alternate the request type so the Type filter has both kinds to sort out.
    const isService = i % 3 === 2;
    await api('/procurement/indents', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ itemName: `UI Fixture Item ${i + 1}`, quantity: 10 + i, unit: 'Pcs' }],
        department: ['Stores', 'Production', 'QC'][i % 3],
        requestType: isService ? 'INTERNAL_SERVICE' : 'MATERIAL_PURCHASE',
        raisedBy: 'UI Fixture',
      }),
    });
  }
  const after = await api('/procurement/indents?limit=1');
  const total = after.body?.meta?.total || 0;
  check('fixture: at least two pages of indents exist', total >= SEED_COUNT, `${total} indents`);

  // ── Desktop behaviour ──
  section('Quick Actions dropdown');
  await go(INDENTS_ROUTE);
  await page.waitForTimeout(1500);

  const createBtn = page.getByTestId('pfms-quick-actions');
  // Wait for it rather than trusting a fixed pause: the first navigation after
  // a source change is slow while Vite compiles the chunk.
  await createBtn.first().waitFor({ state: 'visible', timeout: 30000 });
  check('the header carries a single "Quick Actions" dropdown trigger', (await createBtn.count()) === 1);
  check('…it is a real button, collapsed by default', (await createBtn.getAttribute('aria-haspopup')) === 'menu' && !(await createBtn.getAttribute('aria-expanded')));

  await createBtn.click();
  await page.waitForTimeout(400);
  const menuItems = page.getByRole('menuitem');
  const labels = (await menuItems.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  check('…opening it lists all four Quick Actions', labels.length === 4, labels.join(' | '));
  check('…Create Indent is one of them', labels.some((l) => /^Create Indent$/.test(l)));
  check('…Create Purchase Order is one of them', labels.some((l) => /^Create Purchase Order$/.test(l)));
  check('…Create GRN is one of them', labels.some((l) => /^Create GRN$/.test(l)));
  check('…Create Passing Voucher is one of them', labels.some((l) => /^Create Passing Voucher$/.test(l)));
  check('…and it reports itself expanded while open', (await createBtn.getAttribute('aria-expanded')) === 'true');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('…Escape closes it', (await page.getByRole('menuitem').count()) === 0);

  // The menu must actually open the module's own dialog, not just look like it.
  await createBtn.click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem').filter({ hasText: /^Create Indent$/ }).click();
  await page.waitForTimeout(1200);
  check('…"Create Indent" opens the real indent form', (await page.getByRole('button', { name: /^Create Indent$/ }).count()) > 0);
  await page.getByRole('button', { name: /^Cancel$/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  // The list's own primary button must stay uniquely named, so neither a user
  // nor an existing spec can confuse it with the dropdown trigger.
  check('the list keeps exactly one button named "Create Indent"',
    (await page.getByRole('button', { name: /^Create Indent$/ }).count()) === 1);

  section('Serial numbers across pagination');
  // Drop to 10 rows a page so there is definitely a second page.
  await page.getByLabel('Rows per page').click();
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: `${PAGE_SIZE} / page` }).click();
  await page.waitForTimeout(1500);

  const serials = async () => page.$$eval('.MuiDataGrid-row [data-field="serial"]', (els) => els.map((e) => e.textContent.trim()));
  const firstPage = await serials();
  check('page 1 is numbered 1..N from the top',
    firstPage.length === PAGE_SIZE && firstPage.join(',') === Array.from({ length: PAGE_SIZE }, (_, i) => String(i + 1)).join(','),
    firstPage.join(','));

  const footerText = async () => (await page.locator('text=/Showing \\d+ to \\d+ of \\d+ indent/').first().innerText()).trim();
  check('…and the footer counts the same page', /^Showing 1 to 10 of \d+ indents$/.test(await footerText()), await footerText());

  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await page.waitForTimeout(1500);
  const secondPage = await serials();
  check('page 2 CONTINUES the numbering instead of restarting',
    secondPage[0] === String(PAGE_SIZE + 1), `starts at ${secondPage[0]}`);
  check('…and the footer follows', /^Showing 11 to \d+ of \d+ indents$/.test(await footerText()), await footerText());

  section('Filters, counts and serials together');
  // Unfiltered must READ as unfiltered. '' is both our "no filter" value and
  // MUI's "empty field" sentinel, so without displayEmpty the selected "All"
  // option is never rendered and the control looks blank.
  const selectText = async (id) => (await page.locator(`#${id}`).innerText()).replace(/s+/g, ' ').trim();
  check('Approval Status shows "All" when nothing is filtered', (await selectText('indent-approval')) === 'All', await selectText('indent-approval'));
  check('Department shows "All" when nothing is filtered', (await selectText('indent-department')) === 'All', await selectText('indent-department'));
  check('Type shows "All" when nothing is filtered', (await selectText('indent-type')) === 'All', await selectText('indent-type'));
  const headerCount = async () => {
    const t = await page.locator('text=/^Purchase Indents \\(\\d+\\)$/').first().innerText();
    return Number(t.match(/\((\d+)\)/)[1]);
  };
  const fullCount = await headerCount();
  check('the section heading counts the unfiltered list', fullCount === total, `${fullCount} vs ${total}`);

  // Type filter — the values are the real enum, not invented categories.
  await page.locator('#indent-type').click();
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: 'Service', exact: true }).click();
  await page.waitForTimeout(1800);
  const serviceCount = await headerCount();
  const typeCells = await page.$$eval('.MuiDataGrid-row [data-field="requestType"]', (els) => els.map((e) => e.textContent.trim()));
  check('filtering Type=Service narrows the list', serviceCount > 0 && serviceCount < fullCount, `${serviceCount} of ${fullCount}`);
  check('…every visible row really is a Service indent', typeCells.length > 0 && typeCells.every((t) => /Service/.test(t)), typeCells.join(','));
  check('…and the heading count tracks the FILTER, not the global total', serviceCount !== total);
  const filteredSerials = await serials();
  check('…serial numbers restart at 1 for the filtered set', filteredSerials[0] === '1', filteredSerials.join(','));
  check('…and the Type control now displays the chosen value, not a blank', (await selectText('indent-type')) === 'Service', await selectText('indent-type'));

  // Clear it again.
  await page.locator('#indent-type').click();
  await page.waitForTimeout(300);
  await page.getByRole('option', { name: 'All', exact: true }).first().click();
  await page.waitForTimeout(1500);
  check('clearing Type restores the full count', (await headerCount()) === fullCount);
  check('…and the Type control returns to "All"', (await selectText('indent-type')) === 'All', await selectText('indent-type'));

  // The KPI tiles and the dropdowns drive the SAME state, so a tile click must
  // be visible in the matching control — otherwise the list is filtered in a
  // way the toolbar does not admit to.
  await page.getByRole('button', { name: /Pending Approval/ }).click();
  await page.waitForTimeout(1800);
  check('clicking the Pending Approval tile updates the Approval Status control',
    (await selectText('indent-approval')) === 'PENDING APPROVAL', await selectText('indent-approval'));
  await page.getByRole('button', { name: /Total Indents/ }).click();
  await page.waitForTimeout(1800);
  check('…and the Total Indents tile clears it back to "All"',
    (await selectText('indent-approval')) === 'All', await selectText('indent-approval'));
  check('…restoring the unfiltered count', (await headerCount()) === fullCount);

  section('Column chooser');
  const headerTexts = async () => (await page.$$eval('.MuiDataGrid-columnHeader', (els) => els.map((e) => e.textContent.trim())));
  const defaultHeaders = await headerTexts();
  check('the quote-workflow columns are off by default', !defaultHeaders.some((h) => /QUOTATION UPLOADED/i.test(h)), defaultHeaders.join(' | '));
  check('…while S.No and the core business columns are on',
    defaultHeaders.some((h) => /S\.NO/i.test(h)) && defaultHeaders.some((h) => /INDENT NO/i.test(h)) && defaultHeaders.some((h) => /APPROVED QTY/i.test(h)));

  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem').filter({ hasText: /^Quotation Uploaded$/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check('…and a hidden column can be brought back — no field was deleted',
    (await headerTexts()).some((h) => /QUOTATION UPLOADED/i.test(h)));

  // Put it back so the persisted choice does not leak into later assertions.
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem').filter({ hasText: /^Reset to default$/ }).click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  section('Row selection feeds Bulk Approve');
  const rowBoxes = page.locator('.MuiDataGrid-row input[type="checkbox"]');
  const boxCount = await rowBoxes.count();
  check('the grid offers row selection', boxCount > 0, `${boxCount} checkboxes`);
  await rowBoxes.nth(0).check();
  await rowBoxes.nth(1).check();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Bulk Approve$/ }).click();
  await page.waitForTimeout(2500);
  const dialogBody = (await page.getByRole('dialog').last().innerText()).replace(/\s+/g, ' ');
  check('…the selected rows arrive pre-selected in the Bulk Approve dialog',
    /\b2 selected\b/.test(dialogBody) || /\b2 indent\(s\) selected\b/.test(dialogBody),
    (dialogBody.match(/\d+ selected/) || ['no count'])[0]);
  await page.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);

  // ── Responsive sweep ──
  section('Responsive widths');
  for (const { label, width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    await go(INDENTS_ROUTE);
    await page.waitForTimeout(1800);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    check(`${label}: the window does not scroll sideways`,
      overflow.scrollWidth <= overflow.clientWidth,
      `${overflow.scrollWidth} > ${overflow.clientWidth}`);

    // The step rail must scroll INSIDE its own card, not widen the page.
    const railScrolls = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 4 && /Purchase Indents/.test(d.textContent || '') && /Final Payments/.test(d.textContent || ''));
      return Boolean(el);
    });
    check(`${label}: the workflow rail stays scrollable in place`, railScrolls || width >= 1440, railScrolls ? 'scrolls internally' : 'fits without scrolling');

    // Quick Actions must remain reachable and must not spill off-screen.
    const btn = page.getByTestId('pfms-quick-actions');
    check(`${label}: the Quick Actions dropdown is still visible`, await btn.isVisible());
    await btn.click();
    await page.waitForTimeout(500);
    const menuBox = await page.locator('#pfms-create-menu .MuiPaper-root').first().boundingBox();
    check(`${label}: its menu opens fully inside the viewport`,
      Boolean(menuBox) && menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= width + 1 && menuBox.y + menuBox.height <= height + 1,
      menuBox ? `x=${Math.round(menuBox.x)} w=${Math.round(menuBox.width)} vs ${width}` : 'no menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.screenshot({ path: `${SHOTS}/pfms-responsive-${width}.png`, fullPage: false }).catch(() => {});
  }

  section('Console health');
  const unexpected = consoleErrors.filter((e) => !/401|Failed to log in/.test(e));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n  ${passed}/${passed + failures.length} checks passed.`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
};

run().catch((e) => { console.error('\nResponsive audit failed:', e); process.exitCode = 1; });
