import mongoose from 'mongoose';
import GoodsReceiptNote, {
  GRN_STATUS, GRN_STOCK_POSTING_STAGE, GRN_LINE_STOCK_STATUS,
} from '../procurement/grn/grn.model.js';

/**
 * Awaiting QC — material that has been received on a completed GRN but whose
 * Incoming QC has not completed yet. READ-ONLY; owns no data.
 *
 * Why it exists: since QC-gated posting, a GRN completion rolls the PO's
 * received qty (so the material leaves "In Transit", which is ordered −
 * received) but posts no stock until QC accepts it. Without this figure the
 * material would vanish from every screen between the two steps.
 *
 * WHAT COUNTS: a line of a QC_COMPLETION-stage GRN (completed, not deleted)
 * whose stockStatus is still AWAITING_QC. Once its QC completes the line is
 * POSTED (accepted qty now on hand) or NOT_POSTED, and drops out of here, so
 * nothing is ever counted in two places:
 *
 *   in transit   = ordered − received          (rmInTransit.service)
 *   awaiting QC  = received, QC not completed  (here)
 *   on hand      = posted movements            (InventoryStock)
 *
 * Legacy GRNs never appear: they posted their stock at completion, so it is
 * already on hand.
 */
const COMPLETED = [GRN_STATUS.RECEIVED, GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {Array} skuIds  SKU ids to report (omit / empty = every SKU)
 * @returns {Promise<Map<string, { qty: number, lineCount: number, grnNumbers: string[] }>>}
 */
export const awaitingQcBySku = async (skuIds = null) => {
  const ids = (skuIds || []).filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
  const lineMatch = { 'items.stockStatus': GRN_LINE_STOCK_STATUS.AWAITING_QC };
  if (skuIds && skuIds.length) lineMatch['items.skuId'] = { $in: ids };
  if (skuIds && !skuIds.length) return new Map();

  const rows = await GoodsReceiptNote.aggregate([
    {
      $match: {
        stockPostingStage: GRN_STOCK_POSTING_STAGE.QC_COMPLETION,
        isDeleted: { $ne: true },
        grnStatus: { $in: COMPLETED },
        'items.stockStatus': GRN_LINE_STOCK_STATUS.AWAITING_QC,
      },
    },
    { $unwind: '$items' },
    { $match: lineMatch },
    {
      $group: {
        _id: '$items.skuId',
        qty: { $sum: '$items.receivedQty' },
        lineCount: { $sum: 1 },
        grnNumbers: { $addToSet: '$grnNumber' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { qty: round2(r.qty), lineCount: r.lineCount, grnNumbers: r.grnNumbers.sort() }]));
};

export default { awaitingQcBySku };
