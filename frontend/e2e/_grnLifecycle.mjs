/**
 * Shared browser steps for the GRN → MD signature → Incoming QC lifecycle.
 *
 * Since QC-gated posting a GRN's stock is NOT posted when the GRN is completed:
 * the MD signs the GRN, Incoming QC is completed, and only then is the accepted
 * quantity posted (to the inventory module its SKU master Item Type decides).
 * Every GRN spec walks that same path through the real UI; these helpers are
 * the one copy of it. `scope` is the page or the Create / Edit GRN dialog — the
 * QC section is the same in both.
 */

export const dialogTitled = (page, re) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: re }) });
export const qcSection = (scope) => scope.locator('#grn-qc-section');
export const combinedBtn = (scope) => qcSection(scope).getByRole('button', { name: 'Complete GRN + QC' });
export const stageText = async (scope) => ((await scope.getByTestId('grn-qc-status').first().innerText().catch(() => '')) || '').trim();
export const nextActionText = async (scope) => ((await scope.getByTestId('grn-qc-next').first().innerText().catch(() => '')) || '').trim();

/** Confirm the Complete GRN dialog (optionally choosing Received At first). */
export const confirmCompleteGrn = async (page, { receivedAt = null, doubleClick = false } = {}) => {
  const dlg = dialogTitled(page, /^Complete GRN/);
  await dlg.waitFor({ timeout: 15000 });
  if (receivedAt) {
    await dlg.getByRole('combobox', { name: /Received At/ }).click();
    await page.getByRole('option', { name: new RegExp(receivedAt) }).click();
    await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  const btn = dlg.getByRole('button', { name: /^Complete GRN$/ });
  if (doubleClick) await btn.dblclick(); else await btn.click();
  await dlg.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(1500);
};

/** Draw on the signature pad and sign (MD) in the open signature dialog. */
export const signAsMd = async (page) => {
  const sdlg = dialogTitled(page, /sign/i);
  await sdlg.waitFor({ timeout: 15000 });
  const box = await sdlg.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + 30 + i * 18, box.y + box.height / 2 + (i % 2 ? -18 : 18));
  await page.mouse.up();
  await sdlg.getByRole('button', { name: 'Continue' }).click();
  await sdlg.getByRole('button', { name: 'Sign Document' }).click();
  await sdlg.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(2000);
};

/** Confirm the Complete QC dialog. */
export const confirmCompleteQc = async (page, { doubleClick = false } = {}) => {
  const dlg = dialogTitled(page, /^Complete QC/);
  await dlg.waitFor({ timeout: 15000 });
  const confirm = dlg.getByRole('button', { name: 'Complete QC' });
  if (doubleClick) await confirm.dblclick(); else await confirm.click();
  await dlg.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForTimeout(1500);
};

/** Accepted / Rejected inputs of one QC line. */
export const setQcSplit = async (scope, item, accepted, rejected) => {
  await qcSection(scope).getByLabel(`Accepted — ${item}`, { exact: true }).fill(String(accepted));
  await qcSection(scope).getByLabel(`Rejected — ${item}`, { exact: true }).fill(String(rejected));
};

/**
 * On a GRN whose receipt is completed and waiting for the MD: sign, then
 * complete the QC — accepting everything unless `split` is given as
 * [[itemName, accepted, rejected], …]. Returns the final stage text.
 */
export const signAndCompleteQc = async (page, scope = page, { split = [], doubleClick = false } = {}) => {
  await combinedBtn(scope).click();
  await signAsMd(page);
  for (const [item, acc, rej] of split) await setQcSplit(scope, item, acc, rej);
  await combinedBtn(scope).click();
  await confirmCompleteQc(page, { doubleClick });
  return stageText(scope);
};
