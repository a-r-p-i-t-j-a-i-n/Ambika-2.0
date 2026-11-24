/**
 * PO lines ↔ indent items — which lines may name an indent item, and what a
 * PO must hold before it is submitted for approval.
 *
 * A line that names an indent item (`indentItemId`) must name one that really is on
 * its indent, and must be that item's SKU — otherwise it could be linked to (and
 * dodge the vendor rules of) an item it is not. The item-wise creation APIs
 * (create-from-items, revise) take ONLY indent-sourced lines, so every line there
 * must carry its `indentItemId`. A line without one on the older single-indent /
 * edit paths is a plain line (a manual extra, or a pre-`indentItemId` legacy line
 * that is still matched to its item by SKU code) — it is never silently treated as
 * an indent line.
 *
 * Pure: no DB access.
 */

const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : (v ? String(v) : ''));
const codeOf = (v) => String(v || '').trim().toUpperCase();

const lineLabel = (l, i) => `"${l?.itemName || l?.skuCode || `line ${i + 1}`}"`;

/** SKU of a PO line and an indent item agree (compared only when both name one). */
export const lineMatchesItemSku = (line, item) => {
  const lineHas = !!(idOf(line?.skuId) || codeOf(line?.skuCode));
  const itemHas = !!(idOf(item?.skuId) || codeOf(item?.skuCode));
  if (!lineHas || !itemHas) return true;
  if (idOf(line?.skuId) && idOf(item?.skuId)) return idOf(line.skuId) === idOf(item.skuId);
  const a = codeOf(line?.skuCode);
  const b = codeOf(item?.skuCode);
  return !a || !b || a === b;
};

/**
 * Problems with how `lines` refer to the PO's `indents` ([] = fine).
 * `requireItemId` — every line must name its indent item (item-wise creation).
 */
export const lineIndentProblems = (indents = [], lines = [], { requireItemId = false } = {}) => {
  const problems = [];
  const byId = new Map(indents.map((ind) => [idOf(ind), ind]));
  (lines || []).forEach((l, i) => {
    const label = lineLabel(l, i);
    const itemId = idOf(l?.indentItemId);
    if (!itemId) {
      if (requireItemId || l?.indentItemDisplayNumber) {
        problems.push(`${label} has no indent item (indentItemId) — every line of a PO raised from approved indent items must name its item`);
      }
      return;
    }
    const lineIndent = idOf(l?.indentId);
    const candidates = lineIndent ? [byId.get(lineIndent)].filter(Boolean) : indents;
    const owner = candidates.find((ind) => (ind.items || []).some((it) => idOf(it) === itemId));
    if (!owner) {
      const where = l?.indentNumber ? `indent ${l.indentNumber}` : 'its indent';
      problems.push(`${label} is not an item of ${where} — refresh and try again`);
      return;
    }
    const item = (owner.items || []).find((it) => idOf(it) === itemId);
    if (!lineMatchesItemSku(l, item)) {
      problems.push(`${label} does not match the SKU of its indent item (${item?.skuCode || 'no SKU'}) — refresh and try again`);
    }
  });
  return problems;
};

/** Quantity problems that stop a PO from being submitted ([] = fine): every line > 0. */
export const submitQuantityProblems = (lines = []) => {
  if (!(lines || []).length) return ['The PO has no items — edit the draft before submitting it'];
  const bad = lines.map((l, i) => ({ l, i })).filter(({ l }) => !(Number.isFinite(Number(l?.quantity)) && Number(l.quantity) > 0));
  return bad.map(({ l, i }) => `${lineLabel(l, i)} needs a quantity greater than zero`);
};
