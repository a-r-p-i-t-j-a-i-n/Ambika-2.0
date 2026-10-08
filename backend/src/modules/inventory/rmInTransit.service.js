import VendorPurchaseOrder, {
  PO_STATUS, PO_APPROVAL_STATUS,
} from '../procurement/purchase-order/purchaseOrder.model.js';

/**
 * Material In Transit for Raw Material, derived from the procurement module.
 *
 * READ-ONLY. This owns no data and writes nothing: it reads the vendor POs that
 * Purchase FMS already maintains and answers one question per SKU — how much has
 * been ordered from a vendor and not yet received.
 *
 * Why it exists: RM's `InventoryPolicy.materialInTransit` was a number somebody
 * typed. Nothing kept it in step with the POs actually raised, so it went stale
 * the moment a GRN landed and the buying list then asked for material that was
 * already on a truck. The PO lines carry everything needed —
 * `skuId`/`skuCode`, `quantity`, `receivedQty` — and the GRN service keeps
 * `receivedQty` current (grn.service.js rolls it on every receipt), so the
 * answer is a query, not a field.
 *
 * WHAT COUNTS AS IN TRANSIT
 *   approvalStatus = APPROVED   — a draft or rejected PO is not a commitment
 *   poStatus ∈ APPROVED | RELEASED_TO_VENDOR | PARTIAL_RECEIVED
 *   pending = max(0, quantity − receivedQty) per LINE
 *
 * WHY APPROVAL IS THE LINE. The client's rule is "PO created → Material In
 * Transit", and in this system a PO is not really created until it is approved:
 * purchaseOrder.service only mints `poNumber` on approval, so a draft carries a
 * `draftNumber` and nothing else. Approval is therefore the first state in which
 * a real purchase order exists, and 14 POs currently sit at APPROVED without
 * having been released yet — material an earlier, narrower gate ignored
 * entirely. DRAFT is excluded because it may never be approved; FULLY_RECEIVED
 * and CANCELLED are excluded because that material is either already stock or
 * never coming.
 *
 * The client's own sheet gives no evidence either way — its Material in Transit
 * and In Transit columns are blank on all 30 rows — so this reflects the
 * procurement workflow's own definition of "created", confirmed with the user,
 * rather than anything read out of the workbook.
 *
 * The pending figure is recomputed from quantity − receivedQty rather than read
 * from the stored `pendingQty`, because that stored copy is written once when the
 * PO is created and only refreshed by the GRN path. Recomputing uses the same
 * formula grn.service.js does and cannot go stale.
 *
 * DOUBLE COUNTING: a received quantity has already become stock (GRN posts a
 * GRN_IN movement), so counting it here as well would inflate every projection.
 * Subtracting receivedQty per line is what prevents that.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * PO states where material is genuinely on its way. Kept as a named constant so
 * the rule can be widened or narrowed in one place if the client ever states a
 * different definition of "created".
 */
export const IN_TRANSIT_PO_STATUSES = [
  PO_STATUS.APPROVED,           // the PO number exists — the order is real
  PO_STATUS.RELEASED_TO_VENDOR,
  PO_STATUS.PARTIAL_RECEIVED,
];

export const rmInTransitService = {
  IN_TRANSIT_PO_STATUSES,

  /**
   * Open-PO quantities per RM SKU.
   *
   * ONE query for the whole page — never a query per row.
   *
   * Matching is by `skuId` first and `skuCode` second, exactly as the brief
   * requires. A line that matches neither is NOT silently dropped: it is
   * returned in `unmatched` so a buyer can see that a PO exists which this
   * screen could not attribute to an item. That matters here because the JSL PO
   * format describes steel by grade/width/finish and may carry no SKU at all.
   *
   * @param {Array} skus  RM SKUs as {_id, code}
   * @returns {Promise<{ bySkuId: Map<string, object>, unmatched: object[], summary: object }>}
   */
  async getOpenPoBySku(skus = []) {
    const empty = { bySkuId: new Map(), unmatched: [], summary: { poCount: 0, lineCount: 0, matchedLines: 0, unmatchedLines: 0, totalPending: 0 } };
    if (!skus.length) return empty;

    const pos = await VendorPurchaseOrder.find({
      approvalStatus: PO_APPROVAL_STATUS.APPROVED,
      poStatus: { $in: IN_TRANSIT_PO_STATUSES },
      isDeleted: { $ne: true },
    })
      .select('poNumber poDate poStatus vendorId vendorName expectedDeliveryDate finalMaterialDate items')
      .lean();
    if (!pos.length) return empty;

    const byId = new Map(skus.map((s) => [String(s._id), s]));
    const byCode = new Map(skus.filter((s) => s.code).map((s) => [String(s.code).trim().toUpperCase(), s]));

    const acc = new Map();
    const unmatched = [];
    let lineCount = 0;
    let matchedLines = 0;
    const today = new Date();

    for (const po of pos) {
      // The date the material is actually expected. The confirmed date from
      // follow-up wins over the one computed from the lead time at release.
      const expectedAt = po.finalMaterialDate || po.expectedDeliveryDate || null;
      const overdue = !!expectedAt && new Date(expectedAt) < today;

      for (const it of po.items || []) {
        const ordered = round2(it.quantity);
        const received = round2(it.receivedQty);
        const pending = Math.max(0, round2(ordered - received));
        lineCount += 1;

        // 1) skuId, 2) skuCode. Nothing is inferred from the item name.
        const sku = (it.skuId && byId.get(String(it.skuId)))
          || (it.skuCode && byCode.get(String(it.skuCode).trim().toUpperCase()))
          || null;

        if (!sku) {
          // Only report lines that would have mattered — a fully received line
          // contributes nothing to in-transit whether it matched or not.
          if (pending > 0) {
            unmatched.push({
              poNumber: po.poNumber || '',
              poStatus: po.poStatus,
              vendorName: po.vendorName || '',
              skuCode: it.skuCode || '',
              itemName: it.itemName || it.itemDescription || '',
              grade: it.grade || '', width: it.width || '', finish: it.finish || '',
              orderedQty: ordered, receivedQty: received, pendingQty: pending,
              unit: it.unit || '',
              reason: it.skuCode ? 'SKU code is not a raw-material item' : 'PO line carries no SKU',
            });
          }
          continue;
        }

        matchedLines += 1;
        if (pending <= 0) continue; // fully received — already in stock as a GRN_IN

        const key = String(sku._id);
        const row = acc.get(key) || {
          skuId: sku._id,
          pendingQty: 0, orderedQty: 0, receivedQty: 0,
          poCount: 0, poNumbers: [], expectedDates: [],
          earliestExpectedAt: null, overduePoCount: 0, overduePendingQty: 0,
        };
        row.pendingQty = round2(row.pendingQty + pending);
        row.orderedQty = round2(row.orderedQty + ordered);
        row.receivedQty = round2(row.receivedQty + received);
        if (!row.poNumbers.includes(po.poNumber)) {
          row.poNumbers.push(po.poNumber || '');
          row.poCount += 1;
          if (expectedAt) row.expectedDates.push(expectedAt);
        }
        if (overdue) {
          row.overduePoCount += 1;
          row.overduePendingQty = round2(row.overduePendingQty + pending);
        }
        acc.set(key, row);
      }
    }

    for (const row of acc.values()) {
      row.earliestExpectedAt = row.expectedDates.length
        ? new Date(Math.min(...row.expectedDates.map((d) => new Date(d).getTime())))
        : null;
    }

    const totalPending = round2([...acc.values()].reduce((s, r) => s + r.pendingQty, 0));
    return {
      bySkuId: acc,
      unmatched,
      summary: {
        poCount: pos.length,
        lineCount,
        matchedLines,
        unmatchedLines: unmatched.length,
        totalPending,
      },
    };
  },
};

export default rmInTransitService;
