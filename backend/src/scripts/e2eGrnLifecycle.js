/**
 * Seeding helper for e2e fixtures: take a draft GRN all the way to usable stock
 * the way the application now does it.
 *
 * Since QC-gated posting, grnService.complete() posts NO stock — the accepted
 * qty is posted when the GRN's Incoming QC completes, after the MD signs.
 * Fixtures that used complete() to put coils into stock call this instead:
 *
 *   complete → MD signature (the approval mirror field, as the other fixtures
 *   stand it in) → one QC per PO → complete each QC accepting everything.
 *
 * Every write still goes through the real services, so the receipts written
 * are genuine GRN_IN movements referencing the GRN.
 */
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';

/**
 * @param {string} grnId
 * @param {object} user        the acting user
 * @param {object} [data]      passed to grnService.complete (e.g. { rmReceivedAtLocation })
 * @returns the GRN after its stock was posted
 */
export const completeGrnThroughQc = async (grnId, user, data = {}) => {
  const { grnService } = await import('../modules/procurement/grn/grn.service.js');
  const { incomingQcService } = await import('../modules/procurement/incoming-qc/incomingQc.service.js');
  await grnService.complete(String(grnId), data, user);
  await GoodsReceiptNote.updateOne({ _id: grnId }, { $set: { approvalStatus: 'MD_APPROVED' } });
  const grn = await GoodsReceiptNote.findById(grnId).lean();
  const poIds = (grn.poIds?.length > 1) ? grn.poIds.map(String) : [null];
  for (const poId of poIds) {
    const qc = await incomingQcService.create({ grnId: String(grnId), ...(poId ? { poId } : {}) }, user);
    await incomingQcService.complete(String(qc._id), {}, user);
  }
  return GoodsReceiptNote.findById(grnId).lean();
};

export default completeGrnThroughQc;
