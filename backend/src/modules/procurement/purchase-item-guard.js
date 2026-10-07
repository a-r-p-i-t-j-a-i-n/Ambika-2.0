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

/**
 * Scrap is the second thing that must never be bought.
 *
 * It arrives as a by-product of cutting and leaves by sale or disposal; there
 * is no supplier for it. It is listed separately from the finished-goods set
 * because the reason is different and the operator deserves to be told which
 * rule they hit — not "Finished Goods cannot be purchased" about a heap of
 * offcuts.
 */
const SCRAP_ERROR = 'Scrap cannot be purchased — it is created by cutting and leaves through Scrap Out.';
const BLOCKED_SCRAP = new Set(['SCRAP']);

/** True when a SKU document belongs to a blocked (finished-good) class. */
export const isFinishedGood = (sku) => {
  if (!sku) return false;
  const candidates = [sku.inventoryType, sku.itemType, sku.category]
    .filter(Boolean)
    .map((v) => String(v).trim().toUpperCase());
  return candidates.some((v) => BLOCKED.has(v));
};

/** True when a SKU is scrap. Matched on itemType only — unlike the
 *  finished-goods check, which also sniffs `category`, because plenty of
 *  legitimate purchasables could carry the word "scrap" in a free-text
 *  category and must not be blocked by accident. */
export const isScrap = (sku) => !!sku
  && BLOCKED_SCRAP.has(String(sku.itemType || '').trim().toUpperCase());

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
  const scrap = skus.find(isScrap);
  if (scrap) {
    throw new AppError(SCRAP_ERROR, 400);
  }
};
