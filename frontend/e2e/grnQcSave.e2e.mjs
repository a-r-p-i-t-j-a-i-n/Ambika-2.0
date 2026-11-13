// Browser spec — the combined GRN + Incoming QC form with ONE Save.
//
//   backend:  node src/scripts/e2eGrnQcSaveFixture.js --seed, then e2eServer on ambika_e2e_grn_qc_save
//   this:     node e2e/grnQcSave.e2e.mjs        (PROBE_APP / PROBE_API env, default :3100 / :5099)
//   after:    node src/scripts/e2eGrnQcSaveFixture.js --verify
//
// Covers: QC entered beside the GRN before anything is saved; Save as Draft
// keeps both (reopen restores them); Save & Complete finishes both with no
// extra dialog; the over-receipt tick only while received > pending (and
// cleared when it drops back), the affected item named; old buttons gone from
// the form and the GRN page; sidebar-aware layout at 1440 / 1024 / 768 / 390.
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = process.env.PROBE_APP || 'http://127.0.0.1:3100';
const API = process.env.PROBE_API || 'http://127.0.0.1:5099/api/v1';
const SHOTS = process.env.SHOTS || 'e2e/shots/grn-qc-save';
fs.mkdirSync(SHOTS, { recursive: true });
const USER = { email: 'grn-qc-save-e2e@test.local', password: 'E2e@12345' };

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const ready = async () => {
  await page.waitForSelector('#root > *', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('initial-boot')?.remove());
  await page.waitForTimeout(250);
};
const go = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }).catch(() => {});
const snack = async (re) => { try { await page.getByText(re).first().waitFor({ timeout: 10000 }); return true; } catch { return false; } };
const api = (p) => page.evaluate(async ([base, url]) => (await fetch(`${base}${url}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).json(), [API, p]);

const audit = (dlg) => dlg.evaluate((paper) => {
  const p = paper.getBoundingClientRect();
  const nav = document.querySelector('nav .MuiDrawer-paper');
  const n = nav ? nav.getBoundingClientRect() : null;
  const sidebarShown = !!n && n.width > 0 && n.right > 0;
  const hitS = sidebarShown ? document.elementFromPoint(n.left + n.width / 2, n.top + 240) : null;
  const body = [...paper.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto');
  const btns = [...paper.querySelectorAll('button')].filter((b) => /Save as Draft|Save & Complete|Close|Cancel/.test(b.textContent) && b.getBoundingClientRect().width > 0);
  const footerOk = btns.length > 0 && btns.every((b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.bottom <= window.innerHeight && r.top >= 0 && (b.disabled || hit === b || b.contains(hit));
  });
  return {
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bodyOverflow: body ? body.scrollWidth > body.clientWidth + 1 : true,
    sidebarShown, sidebarClickable: sidebarShown && !!hitS && nav.contains(hitS), overlaps: sidebarShown && p.left < n.right - 1, footerOk,
  };
});

// ── login ──
await go(APP);
await page.locator('input[autocomplete="email"]').fill(USER.email);
await page.locator('input[autocomplete="current-password"]').fill(USER.password);
await page.getByRole('button', { name: /sign in to workspace/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 });
await ready();

const openNew = async () => {
  await go(`${APP}/purchase-fms/grn?view=grn`);
  await page.getByRole('button', { name: /new grn/i }).first().waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /new grn/i }).first().click();
  const form = page.getByRole('dialog').filter({ hasText: 'Create GRN' });
  await form.waitFor();
  await page.waitForTimeout(500);
  return form;
};
const pickPo = async (form, re) => {
  await form.getByRole('combobox', { name: /purchase order/i }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('option', { name: re }).first().click();
  await page.waitForTimeout(1200);
  await form.getByText('Material Receipt', { exact: true }).click();
  await page.waitForTimeout(300);
};
const recv = (form, i) => form.getByRole('spinbutton', { name: 'Received Qty' }).nth(i);
const overShown = async (form) => form.getByTestId('grn-over-receipt').count();
const qty = (form, kind, item) => form.getByRole('spinbutton', { name: `${kind} — ${item}`, exact: true });

// ── 1. Over-receipt option only when received > pending (PO-QS-UI2: A 40, B 30) ──
console.log('\n── 1. Conditional over-receipt ──');
let form = await openNew();
check('before any save: QC part is on the form (no "save GRN first")', (await form.getByText('Save GRN first to enter QC details.').count()) === 0
  && await form.locator('#grn-form-qc').isVisible());
check('footer: Cancel · Preview PDF · Save as Draft · Save & Complete GRN + QC — nothing else',
  await form.getByTestId('grn-save-draft').isVisible() && await form.getByTestId('grn-save-complete').isVisible()
  && (await form.getByRole('button', { name: 'Save QC Draft' }).count()) === 0 && (await form.getByRole('button', { name: 'Complete GRN + QC', exact: true }).count()) === 0);
await pickPo(form, /^PO-QS-UI2 /);
for (const [v, want] of [[30, 0], [40, 0], [42, 1], [48, 1], [35, 0]]) {
  await recv(form, 0).fill(String(v));
  await page.waitForTimeout(200);
  check(`A pending 40, received ${v}: option ${want ? 'visible' : 'hidden'}`, (await overShown(form)) === want);
}
await recv(form, 0).fill('48');
await form.getByTestId('grn-allow-over-receipt').first().check();
await recv(form, 0).fill('40');
await page.waitForTimeout(200);
await recv(form, 0).fill('44');
await page.waitForTimeout(200);
check('reduce back to pending clears the tick (re-raised → shown unticked)', (await overShown(form)) === 1 && !(await form.getByTestId('grn-allow-over-receipt').first().isChecked()));
await recv(form, 0).fill('40');
await recv(form, 1).fill('35');
await page.waitForTimeout(300);
const banner = (await form.getByTestId('grn-over-receipt-summary').innerText().catch(() => '')).replace(/\s+/g, ' ');
check('two lines, only B over: one option, banner names B with pending / received / excess', (await overShown(form)) === 1
  && /QS Nut M8/.test(banner) && /pending 30 · received 35 · excess 5/.test(banner) && !/QS Bolt M8/.test(banner), banner);
await form.getByTestId('grn-save-draft').click();
check('save without the tick refused (names the item)', await snack(/QS Nut M8.*Allow Over-Receipt/));
await form.getByPlaceholder('required (extra)').first().fill('vendor sent 5 extra');
await form.getByTestId('grn-allow-over-receipt').first().check();
await shot('01-over-receipt-1440');
for (const w of [1440, 1024, 768, 390]) {
  await page.setViewportSize({ width: w, height: w <= 390 ? 844 : 900 });
  await page.waitForTimeout(450);
  const a = await audit(form);
  const sideOk = w < 600 ? !a.overlaps : a.sidebarShown && !a.overlaps && a.sidebarClickable;
  check(`@${w}: sidebar ${w < 600 ? 'drawer' : 'visible + clickable'}, no overflow, footer reachable`, sideOk && !a.pageOverflow && !a.bodyOverflow && a.footerOk, JSON.stringify(a));
  await shot(`02-form-${w}`);
  await form.locator('#grn-form-qc').scrollIntoViewIfNeeded();
  await shot(`03-form-qc-${w}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await form.getByTestId('grn-save-draft').click();
check('draft with the consent ticked saves', await snack(/created \(draft\)/));
await page.waitForTimeout(1200);
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(800);

// ── 2. GRN + QC together, one Save as draft, reopen, Save & Complete (PO-QS-UI: A 100, B 50) ──
console.log('\n── 2. One form, one Save ──');
form = await openNew();
await pickPo(form, /^PO-QS-UI /);
await form.locator('#grn-f-challan').fill('CH-UI-1');
await form.locator('#grn-form-qc').scrollIntoViewIfNeeded();
await qty(form, 'Accepted', 'QS Bolt M8').fill('98');
await qty(form, 'Rejected', 'QS Bolt M8').fill('2');
await form.getByRole('textbox', { name: 'QC Remarks' }).fill('2 bolts bent');
await form.getByRole('textbox', { name: 'Checked By' }).first().fill('QC Asha').catch(() => {});
await page.waitForTimeout(300);
const foot = (await form.evaluate((d) => d.lastElementChild.innerText)).replace(/\s+/g, ' ');
check('footer summary carries GRN and QC totals', /received 150/.test(foot) && /accepted 148 · rejected 2/.test(foot), foot);
await shot('04-together-before-save');
await form.getByTestId('grn-save-draft').click();
check('Save as Draft → GRN created with its QC', await snack(/created \(draft\) — GRN and QC saved/));
await page.waitForTimeout(1500);
const grns = (await api('/procurement/grns?limit=50')).data || [];
const ui = grns.find((g) => (g.poNumbers || []).includes('PO-QS-UI'));
check('…server: draft GRN, QC split kept on it', ui?.grnStatus === 'DRAFT' && JSON.stringify(ui?.qcDraft || []).includes('"rejectedQty":2'), ui?.grnStatus);
await form.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(800);

await go(`${APP}/procurement/grns/${ui._id}`);
await page.getByTestId('grn-qc-open-form').first().waitFor({ timeout: 15000 }).catch(() => {});
check('GRN page (draft): no separate Complete GRN button', (await page.getByRole('button', { name: /^Complete GRN$/ }).count()) === 0);
check('…its QC section opens the GRN + QC form instead of saving on its own',
  await page.getByTestId('grn-qc-open-form').isVisible() && (await page.getByRole('button', { name: 'Save QC Draft' }).count()) === 0);
await shot('05-grn-page-draft');
await page.getByRole('button', { name: 'Edit' }).first().click();
const edit = page.getByRole('dialog').filter({ hasText: 'Edit GRN' });
await edit.waitFor();
await page.waitForTimeout(1500);
check('3. reopened: GRN field and QC split + remarks restored',
  (await edit.locator('#grn-f-challan').inputValue()) === 'CH-UI-1'
  && (await qty(edit, 'Rejected', 'QS Bolt M8').inputValue()) === '2'
  && (await edit.getByRole('textbox', { name: 'QC Remarks' }).inputValue()) === '2 bolts bent');
await qty(edit, 'Accepted', 'QS Bolt M8').fill('97');
await edit.getByTestId('grn-save-complete').click();
check('unbalanced QC → Save & Complete refused on the form', await snack(/Accepted \+ Rejected must equal Received/));
await qty(edit, 'Accepted', 'QS Bolt M8').fill('98');
await page.waitForTimeout(300);
await edit.getByTestId('grn-save-complete').click();
check('Save & Complete → done in one click, no confirmation dialog', await snack(/completed — accepted 148 posted to stock, rejected 2 kept out/));
check('…the old Complete GRN / Complete QC dialogs never appeared',
  (await page.getByRole('dialog').filter({ hasText: 'This finalises the receipt' }).count()) === 0
  && (await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Complete QC/ }) }).count()) === 0);
await page.waitForTimeout(2000);
const st = (await edit.getByTestId('grn-qc-status').first().innerText().catch(() => '')).trim();
check('…form shows QC Completed · Partial, read-only; only Close left', /QC Completed · Partial/.test(st)
  && (await edit.getByTestId('grn-save-draft').count()) === 0 && (await edit.getByTestId('grn-save-complete').count()) === 0, st);
await shot('06-completed-1440');
await edit.getByRole('button', { name: /^Cancel$|^Close$/ }).click();
await page.waitForTimeout(800);
await go(`${APP}/procurement/grns/${ui._id}`);
await page.locator('#grn-qc-section').waitFor({ timeout: 15000 });
check('GRN page (completed): QC read-only, no QC buttons', (await page.getByTestId('grn-qc-open-form').count()) === 0
  && (await page.getByRole('button', { name: /Complete (GRN|QC)/ }).count()) === 0);
await shot('07-grn-page-completed');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
