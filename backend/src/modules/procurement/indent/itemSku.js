/**
 * Purchase Indent items come from the SKU Master.
 *
 * The SKU Master (`skus`) is the product catalogue; the Vendor Master only
 * describes vendors. Every item on a new or edited indent must therefore point
 * at an ACTIVE SKU, and its Item Name / SKU Code are taken from that SKU record
 * — never from free text the client typed. Quantity, unit and remarks stay as
 * the user entered them (the unit defaults to the SKU's unit in the form).
 *
 * Matching: by skuId when one is sent (an id that no longer resolves is refused,
 * never re-matched by code, so a line can't silently move to another SKU); by
 * the exact SKU code otherwise (codes are unique and uppercase in the master).
 *
 * Only create / draft edit go through this. Indents already past DRAFT keep
 * their items exactly as they were saved.
 */
import SKU from '../../skus/sku.model.js';
import { AppError } from '../../../utils/apiResponse.js';

const up = (v) => String(v || '').trim().toUpperCase();
const label = (it) => `"${it.itemName || it.skuCode || 'item'}"`;

/**
 * Pure rule: bind each item to its SKU record.
 * @param {object[]} items  indent items ({ skuId?, skuCode?, itemName, ... })
 * @param {object[]} skus   active SKU docs found for those items
 * @returns {{ items: object[], problems: string[] }}
 */
export const bindItemsToSkus = (items = [], skus = []) => {
  const byId = new Map(skus.map((s) => [String(s._id), s]));
  const byCode = new Map(skus.map((s) => [up(s.code), s]));
  const problems = [];
  const bound = items.map((it) => {
    let sku = null;
    if (it.skuId) {
      sku = byId.get(String(it.skuId)) || null;
      if (!sku) problems.push(`${label(it)} is not an active item in SKU Master — pick it again from the SKU list.`);
    } else if (up(it.skuCode)) {
      sku = byCode.get(up(it.skuCode)) || null;
      if (!sku) problems.push(`${label(it)} (SKU ${up(it.skuCode)}) is not an active item in SKU Master — pick it from the SKU list.`);
    } else {
      problems.push(`${label(it)} is not linked to SKU Master — pick the item from the SKU list.`);
    }
    if (!sku) return it;
    return { ...it, skuId: sku._id, skuCode: up(sku.code), itemName: String(sku.name || '').trim() || it.itemName };
  });
  return { items: bound, problems };
};

/** Load the SKUs the items name and bind them; 400 listing every item that can't be bound. */
export const bindIndentItemsToSkuMaster = async (items = []) => {
  const ids = [...new Set(items.map((it) => it.skuId).filter(Boolean).map(String))]
    .filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  const codes = [...new Set(items.filter((it) => !it.skuId).map((it) => up(it.skuCode)).filter(Boolean))];
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (codes.length) or.push({ code: { $in: codes } });
  const skus = or.length
    ? await SKU.find({ $or: or, isDeleted: { $ne: true }, isActive: { $ne: false } }).select('_id code name unit').lean()
    : [];
  const { items: bound, problems } = bindItemsToSkus(items, skus);
  if (problems.length) throw new AppError(problems.join(' '), 400);
  return bound;
};
