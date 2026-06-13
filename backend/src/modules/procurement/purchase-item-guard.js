/**
 * Purchase FMS item guard — shared by every procurement module.
 *
 * BUSINESS RULE: Finished Goods are produced internally and sold through
 * Sales / O2D. They must NEVER be indented, quoted, purchased, added to a PO,
 * PI, GRN or payment workflow. This guard is the server-side enforcement —
 * frontend pickers also filter, but the API blocks even if that is bypassed.
 *
 * Usage (any service that accepts items / sku references):
 *   await assertPurchasable([{ skuId, skuCode, itemName }, ...]);
 * Throws AppError 400 "Finished Goods cannot be processed through Purchase FMS."
 */
import SKU, { FG_BLOCKED_ITEM_TYPES } from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';

const FG_ERROR = 'Finished Goods cannot be processed through Purchase FMS.';
const BLOCKED = new Set(FG_BLOCKED_ITEM_TYPES.map((t) => String(t).toUpperCase()));

/** True when a SKU document belongs to a blocked (finished-good) class. */
export const isFinishedGood = (sku) => {
  if (!sku) return false;
  const candidates = [sku.inventoryType, sku.itemType, sku.category]
    .filter(Boolean)
    .map((v) => String(v).trim().toUpperCase());
  return candidates.some((v) => BLOCKED.has(v));
};

/**
 * Validate a list of item refs ({skuId?, skuCode?}) against the SKU master.
 * Free-typed items with no SKU match cannot be classified and are allowed
 * (the master is the source of truth for classification).
 */
export const assertPurchasable = async (items = []) => {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return;

  const ids = [...new Set(list.map((it) => it.skuId).filter(Boolean).map(String))];
  const codes = [...new Set(list.map((it) => (it.skuCode || '').trim().toUpperCase()).filter(Boolean))];
  if (!ids.length && !codes.length) return;

  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (codes.length) or.push({ code: { $in: codes } });

  const skus = await SKU.find({ $or: or }).select('itemType category code name').lean();
  const offender = skus.find(isFinishedGood);
  if (offender) {
    throw new AppError(FG_ERROR, 400);
  }
};
