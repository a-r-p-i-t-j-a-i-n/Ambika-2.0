/**
 * Purchase FMS Doer Assignment working like O2D's, driven through the real UI
 * in Chromium:
 *   - FMS → Doer Assignment → Purchase: the O2D-style grid (lead time · main
 *     doers · buddies), save / undo / validation / permission confirm, and the
 *     setup surviving a reload; the O2D tab still renders its own grid.
 *   - My FMS Tasks (a doer): filters, search, buddy rows, a row opening the
 *     exact record with the task context shown there, a deleted record handled.
 *   - All FMS Tasks (manager): stat strip, reassign, persisted after reload.
 *   - 390px: no page-level sideways scroll.
 *
 *   node e2e/fmsDoerPlan.e2e.mjs
 *
 * Expects (see backend/src/scripts/e2eFmsDoerPlanFixture.js): backend via
 * e2eServer.js on the ambika_e2e_fmsdoerplan scratch DB after `--seed` and
 * `--api`, and Vite with VITE_API_URL pointing at it. Ports default to
 * :5099 / :3100; override with PROBE_API / PROBE_APP.
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
const API = process.env.PROBE_API || 'http://127.0.0.1:5099/api/v1';
await assertE2ESetup(APP, API, 'fmsDoerPlan.e2e.mjs');
const PASSWORD = 'E2e@12345';
const MANAGER = 'fmsplan-e2e@test.local';
const DOER_A = 'fp-asha@test.local';
const BUDDY_C = 'fp-chitra@test.local';
const SHOTS = process.env.SHOT_DIR || 'e2e/shots/fmsdoerplan';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const pageErrors = [];
const browser = await chromium.launch({ executablePath: findChromium(), ignoreDefaultArgs: ['--hide-scrollbars'] });

const session = async (email, viewport = { width: 1440, height: 950 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${email} ${page.url().replace(APP, '')} :: ${e.message.slice(0, 200)}`));
  const s = {
    page, ctx,
    async ready() {
      await page.waitForSelector('#root > *', { timeout: 30000 });
      await page.evaluate(() => document.getElementById('initial-boot')?.remove());
      await page.waitForTimeout(150);
    },
    async go(url) { await page.goto(`${APP}${url}`, { waitUntil: 'domcontentloaded' }); await s.ready(); },
    api: (p, method = 'GET', body) => page.evaluate(async ([base, url, m, b]) => {
      const r = await fetch(`${base}${url}`, {
        method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: b ? JSON.stringify(b) : undefined,
      });
      return r.json();
    }, [API, p, method, body]),
    shot: (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {}),
    async snack(re) { try { await page.getByText(re).first().waitFor({ timeout: 8000 }); return true; } catch { return false; } },
  };
  await s.go('/');
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in to workspace/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
  return s;
};

const m = await session(MANAGER);
check('manager logs in', true);
const people = (await m.api('/fms-doers/plan/PURCHASE/users')).data || [];
const idOf = (email) => people.find((p) => p.email === email)?.id;

// ── 1. Doer Assignment ───────────────────────────────────────────────────────
console.log('\n── 1. Doer Assignment ──');
const openPurchaseGrid = async () => {
  await m.go('/fms/doer-assignment');
  await m.page.getByRole('button', { name: 'Purchase FMS' }).click();
  await m.page.getByTestId('purchase-doer-plan').waitFor({ timeout: 15000 });
  await m.page.getByTestId('plan-row').first().waitFor();
};
await m.go('/fms/doer-assignment');
await m.page.getByText(/Lead time, main doer, buddy and mandatory for every O2D step/).waitFor({ timeout: 15000 });
const o2dShown = await m.page.getByText(/O2D steps|No O2D steps are set up yet|Could not load the O2D steps/).first()
  .waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
check('O2D is the default tab and still shows its own grid', o2dShown && (await m.page.getByTestId('purchase-doer-plan').count()) === 0);

await openPurchaseGrid();
const rows = m.page.getByTestId('plan-row');
check('Purchase grid: one row per step', (await rows.count()) === 16, String(await rows.count()));
const headers = await m.page.locator('[data-testid="purchase-doer-plan"] thead th').allInnerTexts();
check('same columns as O2D (lead time, main doers, buddies)', ['Lead time', 'Main doers', 'Buddies'].every((h) => headers.some((x) => x.toLowerCase() === h.toLowerCase())), headers.join(' | '));
const rowOf = (key) => m.page.locator(`[data-testid="plan-row"][data-step="${key}"]`);
const createText = await rowOf('INDENT_CREATE').innerText();
check('saved doers and buddy show as chips', /FP Asha/.test(createText) && /FP Bala/.test(createText) && /FP Chitra/.test(createText));
check('step without a doer says so', /No main doer set/.test(await rowOf('TALLY_ENTRY').innerText()));
await m.shot('1-grid');

const addPerson = async (row, testId, name) => {
  const input = row.getByTestId(testId);
  await input.click();
  await input.fill(name.split(' ')[1]);
  const opt = m.page.getByRole('option').filter({ hasText: name }).first();
  await opt.waitFor({ timeout: 8000 });
  await opt.click();
  await m.page.keyboard.press('Escape');
  await m.page.waitForTimeout(150);
};
const grn = rowOf('GRN');
// Reset GRN to a known state first (the spec is re-runnable).
await m.api('/fms-doers/plan/PURCHASE', 'PUT', { steps: [{ stepKey: 'GRN', doerIds: [], buddyIds: [], leadTime: null }] });
await openPurchaseGrid();
await addPerson(grn, 'plan-doers-input', 'FP Asha');
await addPerson(grn, 'plan-buddies-input', 'FP Bala');
await grn.getByTestId('plan-lead-value').fill('4');
await grn.getByTestId('plan-lead-unit').click();
await m.page.getByRole('option', { name: 'Days' }).click();
check('an edited row is counted as changed', /1 step changed/.test(await m.page.getByTestId('plan-changed-count').innerText()));
await addPerson(grn, 'plan-buddies-input', 'FP Asha');
check('main doer also as buddy is flagged', await grn.getByText('Someone is both a main doer and a buddy').isVisible());
await grn.locator('.MuiChip-root').filter({ hasText: 'FP Asha' }).last().locator('.MuiChip-deleteIcon').click();
await m.page.getByTestId('plan-save').click();
check('Save', await m.snack(/Saved — new items follow this setup/));
await openPurchaseGrid();
const grnText = await rowOf('GRN').innerText();
check('after reload: GRN keeps its doer, buddy and lead time', /FP Asha/.test(grnText) && /FP Bala/.test(grnText)
  && (await rowOf('GRN').getByTestId('plan-lead-value').inputValue()) === '4' && /Days/.test(grnText));

await addPerson(rowOf('TALLY_ENTRY'), 'plan-doers-input', 'FP Dev');
await m.page.getByRole('button', { name: 'Undo' }).click();
check('Undo drops unsaved edits', (await m.page.getByTestId('plan-changed-count').count()) === 0 && /No main doer set/.test(await rowOf('TALLY_ENTRY').innerText()));

check('someone lacking the step permission is flagged', /lacks this step's permission/.test(await rowOf('PO_APPROVAL').innerText()));
// Re-runnable: PO Approval back to just FP Dev before adding FP Bala through the UI.
await m.api('/fms-doers/plan/PURCHASE', 'PUT', {
  steps: [{ stepKey: 'PO_APPROVAL', doerIds: [idOf('fp-dev@test.local')], buddyIds: [] }], acknowledgeMissingPermission: true,
});
await openPurchaseGrid();
let confirmText = '';
m.page.once('dialog', (dlg) => { confirmText = dlg.message(); dlg.dismiss(); });
await addPerson(rowOf('PO_APPROVAL'), 'plan-doers-input', 'FP Bala');
await m.page.getByTestId('plan-save').click();
await m.page.waitForTimeout(1200);
check('saving such a pick asks first; cancel keeps it unsaved', /procurement\.approve/.test(confirmText)
  && (await m.page.getByTestId('plan-changed-count').count()) === 1, confirmText.slice(0, 80));
m.page.once('dialog', (dlg) => dlg.accept());
await m.page.getByTestId('plan-save').click();
check('…and saves when confirmed', await m.snack(/Saved — /));

await rowOf('INDENT_CREATE').getByRole('button', { name: /Doer history for 1\.1$/ }).click();
const hist = m.page.getByRole('dialog').filter({ hasText: 'Doer history' });
await hist.waitFor();
check('step history shows the whole setup', /Main doers: FP Asha, FP Bala/.test(await hist.innerText()));
await m.shot('1-history');
await hist.getByRole('button', { name: 'Close' }).click();

// ── 2. My FMS Tasks (doer) ───────────────────────────────────────────────────
console.log('\n── 2. My FMS Tasks ──');
// A fresh draft indent → a 1.1 task for FP Asha + FP Bala, buddy FP Chitra (set by --api).
const skuRes = await m.api('/skus/lookup/list?search=FP-BOLT&limit=5');
const sku = (skuRes.data?.docs || skuRes.data || []).find((s) => s.code === 'FP-BOLT');
const made = await m.api('/procurement/indents', 'POST', {
  department: 'Stores', remarks: 'fmsDoerPlan spec', items: [{ skuId: sku?._id, skuCode: sku?.code, itemName: sku?.name, quantity: 2 }],
});
const newRef = made.data?.indentNumber;
for (let i = 0; i < 40; i += 1) {
  const r = await m.api(`/fms-doers/tasks?stepKey=INDENT_CREATE&search=${encodeURIComponent(newRef || 'x')}`);
  if ((r.data || []).some((t) => t.entityRef === newRef)) break;
  if (i === 5) await m.api('/fms-doers/sync', 'POST');
  await m.page.waitForTimeout(250);
}
check('a new draft indent is waiting at 1.1', !!newRef, newRef);
const a = await session(DOER_A);
await a.go('/fms/my-tasks');
await a.page.getByTestId('my-tasks-todo').waitFor({ timeout: 15000 });
const mine = (await a.api('/fms-doers/tasks/mine')).data || [];
const openTask = mine.find((t) => t.status === 'OPEN' && t.entityRef === newRef && !t.asBuddy && t.link);
const doneTask = mine.find((t) => t.status === 'DONE' && t.link);
const ghost = mine.find((t) => !t.link);
check('fixture data present (open, done and deleted-record tasks)', openTask && doneTask && ghost);
check('no Doer Assignment for a doer', (await a.page.getByRole('tab', { name: 'All FMS Tasks' }).count()) === 0);
const rowsA = a.page.getByTestId('my-task-row');
check('To do lists open tasks only', (await rowsA.count()) > 0
  && (await a.page.locator('[data-testid="my-task-row"]').allInnerTexts()).every((t) => !/Completed/.test(t)));
await a.page.getByTestId('my-tasks-search').fill(openTask.entityRef);
await a.page.waitForTimeout(300);
const refs = await rowsA.evaluateAll((els) => els.map((e) => e.dataset.ref));
check('search narrows to that item', refs.length > 0 && refs.every((r) => r === openTask.entityRef), refs.join(','));
await a.shot('2-my-tasks');
await a.page.locator(`[data-testid="my-task-row"][data-step="${openTask.stepKey}"][data-ref="${openTask.entityRef}"]`).first().click();
await a.page.waitForURL(/\/procurement\/indents\//, { timeout: 15000 });
const url = new URL(a.page.url());
check('row opens that exact record with the task id', `${url.pathname}${url.search}` === openTask.link, `${url.pathname}${url.search}`);
const ctxBox = a.page.getByTestId('fms-task-context');
await ctxBox.waitFor({ timeout: 15000 }).catch(() => {});
check('record page says which task sent you', (await ctxBox.getAttribute('data-state')) === 'open'
  && (await ctxBox.innerText()).includes(openTask.stepLabel));
check('…on the right record', (await a.page.getByText(openTask.entityRef).count()) > 0);
await a.shot('2-record');
await ctxBox.getByRole('button', { name: 'My FMS Tasks' }).click();
await a.page.waitForURL(/\/fms\/my-tasks/);
check('"My FMS Tasks" goes back', true);

await a.page.getByTestId('my-filter-done').click();
const doneRow = a.page.locator(`[data-testid="my-task-row"][data-link="${doneTask.link}"]`).first();
check('Completed filter shows done work', await doneRow.isVisible());
await doneRow.click();
await a.page.waitForURL(/\/procurement\//, { timeout: 15000 });
await a.page.getByTestId('fms-task-context').waitFor({ timeout: 15000 }).catch(() => {});
check('a done task opens its record and says it is already done',
  (await a.page.getByTestId('fms-task-context').getAttribute('data-state').catch(() => '')) === 'finished');
await a.go('/fms/my-tasks');
await a.page.getByTestId('my-filter-done').click();
const ghostRow = a.page.locator(`[data-testid="my-task-row"][data-ref="${ghost.entityRef}"]`).first();
check('deleted record: row says so', /deleted/i.test(await ghostRow.innerText()));
const before = a.page.url();
await ghostRow.click();
check('…and clicking it stays put with a message', await a.snack(/This record was deleted/) && a.page.url() === before);

// Buddy view
const c = await session(BUDDY_C);
await c.go('/fms/my-tasks');
await c.page.getByTestId('my-tasks-todo').waitFor({ timeout: 15000 });
const buddyCount = Number(((await c.page.getByTestId('my-filter-buddy').innerText()).match(/\((\d+)\)/) || [])[1] || 0);
await c.page.getByTestId('my-filter-buddy').click();
check('buddy sees "As buddy" rows', buddyCount > 0 && (await c.page.getByTestId('my-task-row').count()) > 0, String(buddyCount));
check('buddy rows are explained', await c.page.getByText(/you're the backup \(buddy\)/).isVisible());

// ── 3. All FMS Tasks (manager) ───────────────────────────────────────────────
console.log('\n── 3. All FMS Tasks ──');
await m.go('/fms/my-tasks');
await m.page.getByRole('tab', { name: 'All FMS Tasks' }).click();
await m.page.getByTestId('all-tasks-table').waitFor({ timeout: 15000 });
check('stat strip like O2D', (await m.page.getByTestId('all-stat-overdue').count()) === 1 && (await m.page.getByTestId('all-stat-unassigned').count()) === 1);
await m.page.getByTestId('all-tasks-search').fill(openTask.entityRef);
await m.page.waitForTimeout(900);
const target = m.page.locator(`[data-testid="all-task-row"][data-step="${openTask.stepKey}"][data-ref="${openTask.entityRef}"]`).first();
await target.waitFor({ timeout: 10000 });
await target.getByRole('button', { name: 'Reassign' }).click();
const dlg = m.page.getByRole('dialog').filter({ hasText: 'Reassign task' });
await dlg.waitFor();
const pickFrom = (await target.getByTestId('all-task-doers').innerText()).includes('FP Bala') ? 'FP Chitra' : 'FP Bala';
await dlg.getByLabel(/Doer/).fill(pickFrom.split(' ')[1]);
await m.page.getByRole('option').filter({ hasText: pickFrom }).first().click();
await dlg.getByRole('button', { name: 'Reassign' }).click();
check('reassign', await m.snack(/Task reassigned|Reassigned/));
await m.page.reload({ waitUntil: 'domcontentloaded' }); await m.ready();
await m.page.getByRole('tab', { name: 'All FMS Tasks' }).click();
await m.page.getByTestId('all-tasks-search').fill(openTask.entityRef);
await m.page.waitForTimeout(900);
const after = m.page.locator(`[data-testid="all-task-row"][data-step="${openTask.stepKey}"][data-ref="${openTask.entityRef}"]`).first();
check('reassignment persists after reload', (await after.getByTestId('all-task-doers').innerText()).includes(pickFrom));
await m.shot('3-all-tasks');
// Clicking the row (not the button) opens the record.
await after.locator('td').nth(2).click();
await m.page.waitForURL(/\/procurement\/indents\//, { timeout: 15000 });
check('All Tasks row opens the record too', m.page.url().includes(openTask.link.split('?')[0]));

// ── 4. Mobile ────────────────────────────────────────────────────────────────
console.log('\n── 4. 390px ──');
const narrow = async (s, route, ready) => {
  await s.page.setViewportSize({ width: 390, height: 844 });
  await s.go(route);
  await ready();
  return s.page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
};
const overA = await narrow(a, '/fms/my-tasks', () => a.page.getByTestId('my-tasks-todo').waitFor());
check('My FMS Tasks fits 390px (table scrolls inside)', overA <= 1, `${overA}px`);
await a.shot('4-mobile-my-tasks');
const overM = await narrow(m, '/fms/doer-assignment', async () => {
  await m.page.getByRole('button', { name: 'Purchase FMS' }).click();
  await m.page.getByTestId('plan-row').first().waitFor();
});
check('Doer Assignment grid fits 390px (table scrolls inside)', overM <= 1, `${overM}px`);
await m.shot('4-mobile-plan');

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
