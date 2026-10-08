/**
 * Pricing service.
 *
 * The approval decision engine lives in `decideApproval()`. It runs server-side
 * for every revision submission and produces:
 *   { initialStatus, flags, marginSnapshot }
 *
 * Rules (configurable via CompanySettings):
 *   - LIVE immediately when:
 *       (a) actor has `pricing.reviseAutoApprove`, AND
 *       (b) |change%| ≤ approvalThresholdPercent, AND
 *       (c) no price-decrease, AND
 *       (d) effectiveFrom ≤ today + futureDateApprovalDays, AND
 *       (e) (SELLING only) margin ≥ marginFloor and not negative.
 *   - Negative margin (SELLING < RM_COST) is BLOCKED unless actor has
 *     `pricing.overrideMargin` AND they pass `acceptMarginBreach: true` in body.
 *   - Otherwise the revision is PENDING_APPROVAL.
 */

import mongoose from 'mongoose';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);
import SKU from '../skus/sku.model.js';
import Party from '../clients/party.model.js';
import PriceRevision from './price-revision.model.js';
import CompanySettings from './company-settings.model.js';
import Vendor from '../vendors/vendor.model.js';
import PricingHistory from '../vendors/pricingHistory.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

const ROOT = '*';
const hasPerm = (req, slug) => {
  const set = req.userPermissions;
  if (!set) return false;
  return set.has(ROOT) || set.has(slug);
};

// ── Helpers ─────────────────────────────────────────────────────────
const latestLiveRevision = async (skuId, priceType, asOfDate = new Date(), session = null) => {
  return PriceRevision
    .findOne({
      skuId, priceType, status: 'LIVE',
      // End-of-day bound so a price effective today (stored at UTC-midnight)
      // is matched regardless of the server's timezone.
      effectiveFrom: { $lte: dayjs(asOfDate).endOf('day').toDate() },
    })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .session(session)
    .lean();
};

const previousLiveRevision = async (skuId, priceType, beforeRevisionId, session = null) => {
  const target = await PriceRevision.findById(beforeRevisionId).session(session).lean();
  if (!target) return null;
  return PriceRevision
    .findOne({
      _id: { $ne: target._id },
      skuId, priceType, status: { $in: ['LIVE', 'SUPERSEDED'] },
      effectiveFrom: { $lt: target.effectiveFrom },
    })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .session(session)
    .lean();
};

const updateSkuPriceCache = async ({ skuId, priceType, newPrice, effectiveFrom }, session) => {
  // Only refresh cache if this revision is the active one (effectiveFrom <= today)
  if (dayjs(effectiveFrom).isAfter(dayjs(), 'day')) return;
  const set = priceType === 'SELLING'
    ? { sellingPrice: newPrice, sellingPriceFrom: effectiveFrom }
    : { rmCost: newPrice, rmCostFrom: effectiveFrom };
  await SKU.updateOne({ _id: skuId }, { $set: set }, { session });
};

const computeChangePercent = (oldP, newP) => {
  if (!oldP || oldP <= 0) return 0;
  return Math.round(((newP - oldP) / oldP) * 10000) / 100; // 2 decimals
};

// ── Approval engine ─────────────────────────────────────────────────
export const decideApproval = async ({ skuId, priceType, newPrice, effectiveFrom, acceptMarginBreach }, req) => {
  const settings = await CompanySettings.getSingleton();
  const sku = await SKU.findById(skuId).lean();
  if (!sku) throw new AppError('SKU not found', 404);

  const latest = await latestLiveRevision(skuId, priceType);
  const oldPrice = latest?.newPrice ?? null;
  const changePercent = computeChangePercent(oldPrice, newPrice);
  const absChange = Math.abs(changePercent);

  const today = dayjs().startOf('day');
  const effective = dayjs(effectiveFrom).startOf('day');
  const futureDays = Math.max(0, effective.diff(today, 'day'));

  // Margin (only relevant for SELLING)
  let marginSnapshot = null;
  if (priceType === 'SELLING') {
    const rmCost = sku.rmCost || 0;
    const margin = newPrice - rmCost;
    const marginPct = newPrice > 0 ? Math.round((margin / newPrice) * 10000) / 100 : 0;
    const floor = sku.marginFloor ?? settings.marginFloorDefault ?? 0;
    marginSnapshot = {
      rmCostAtSave: rmCost,
      marginAtSave: margin,
      marginPercent: marginPct,
      marginAlert:  margin < floor,
      isNegative:   margin < 0,
    };
  }

  const flags = {
    overThreshold:  absChange > (settings.approvalThresholdPercent || 5),
    priceDecrease:  oldPrice != null && newPrice < oldPrice,
    farFutureDated: futureDays > (settings.futureDateApprovalDays || 60),
    negativeMargin: marginSnapshot?.isNegative === true,
  };

  // Hard block on negative margin unless override perm + checkbox.
  if (flags.negativeMargin && !(hasPerm(req, 'pricing.overrideMargin') && acceptMarginBreach)) {
    throw new AppError(
      'This revision would result in a negative margin (selling price below RM cost). ' +
      'Either revise the price or use the margin-override on submission.',
      400,
    );
  }

  const canAutoApprove =
    hasPerm(req, 'pricing.reviseAutoApprove') &&
    !flags.overThreshold &&
    !flags.priceDecrease &&
    !flags.farFutureDated &&
    !(marginSnapshot?.marginAlert);

  return {
    initialStatus: canAutoApprove ? 'LIVE' : 'PENDING_APPROVAL',
    oldPrice,
    changePercent,
    flags,
    marginSnapshot,
  };
};

// ── Public service methods ──────────────────────────────────────────

export const submitRevision = async (body, req) => {
  const {
    skuId, priceType = 'SELLING', newPrice, effectiveFrom,
    reason = '', remarks = '', attachmentUrl = '', attachmentName = '',
    acceptMarginBreach = false,
  } = body;

  if (!skuId || newPrice == null || !effectiveFrom) {
    throw new AppError('skuId, newPrice and effectiveFrom are required.', 400);
  }

  const decision = await decideApproval(
    { skuId, priceType, newPrice, effectiveFrom, acceptMarginBreach },
    req,
  );

  const sku = await SKU.findById(skuId).lean();

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Find currently live revision so we can mark it SUPERSEDED when the new one goes live.
    const currentLive = await latestLiveRevision(skuId, priceType, new Date(), session);

    const [created] = await PriceRevision.create([{
      skuId,
      skuCode: sku.code,
      skuName: sku.name,
      priceType,
      oldPrice: decision.oldPrice,
      newPrice,
      effectiveFrom,
      reason, remarks,
      attachmentUrl, attachmentName,
      status: decision.initialStatus,
      changePercent: decision.changePercent,
      requestedBy: req.user._id,
      requestedByName: req.user.name,
      approvedBy: decision.initialStatus === 'LIVE' ? req.user._id : null,
      approvedByName: decision.initialStatus === 'LIVE' ? req.user.name : '',
      approvedAt: decision.initialStatus === 'LIVE' ? new Date() : null,
      supersedes: currentLive?._id || null,
      flags: decision.flags,
      rmCostAtSave: decision.marginSnapshot?.rmCostAtSave ?? null,
      marginAtSave: decision.marginSnapshot?.marginAtSave ?? null,
      marginPercent: decision.marginSnapshot?.marginPercent ?? null,
      marginAlert: !!decision.marginSnapshot?.marginAlert,
      createdBy: req.user._id,
    }], { session });

    // If LIVE and effective today/earlier — supersede the previous live, refresh cache.
    if (decision.initialStatus === 'LIVE' && dayjs(effectiveFrom).isSameOrBefore(dayjs(), 'day')) {
      if (currentLive?._id) {
        await PriceRevision.updateOne(
          { _id: currentLive._id },
          { status: 'SUPERSEDED' },
          { session },
        );
      }
      await updateSkuPriceCache({ skuId, priceType, newPrice, effectiveFrom }, session);
    }

    await session.commitTransaction();
    return created.toObject();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const approveRevision = async (revisionId, req) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const rev = await PriceRevision.findById(revisionId).session(session);
    if (!rev) throw new AppError('Revision not found', 404);
    if (rev.status !== 'PENDING_APPROVAL') {
      throw new AppError(`Revision is ${rev.status}, not PENDING_APPROVAL.`, 400);
    }

    rev.status = 'LIVE';
    rev.approvedBy = req.user._id;
    rev.approvedByName = req.user.name;
    rev.approvedAt = new Date();
    await rev.save({ session });

    // If effective today/earlier — supersede & refresh cache.
    if (dayjs(rev.effectiveFrom).isSameOrBefore(dayjs(), 'day')) {
      await PriceRevision.updateMany(
        {
          _id: { $ne: rev._id },
          skuId: rev.skuId, priceType: rev.priceType, status: 'LIVE',
          effectiveFrom: { $lte: rev.effectiveFrom },
        },
        { status: 'SUPERSEDED' },
        { session },
      );
      await updateSkuPriceCache({
        skuId: rev.skuId, priceType: rev.priceType,
        newPrice: rev.newPrice, effectiveFrom: rev.effectiveFrom,
      }, session);
    }

    await session.commitTransaction();
    return rev.toObject();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const rejectRevision = async (revisionId, reason, req) => {
  const rev = await PriceRevision.findById(revisionId);
  if (!rev) throw new AppError('Revision not found', 404);
  if (rev.status !== 'PENDING_APPROVAL') {
    throw new AppError(`Revision is ${rev.status}, not PENDING_APPROVAL.`, 400);
  }
  rev.status = 'REJECTED';
  rev.approvedBy = req.user._id;
  rev.approvedByName = req.user.name;
  rev.approvedAt = new Date();
  rev.rejectionReason = reason || '';
  await rev.save();
  return rev.toObject();
};

export const correctRevision = async (revisionId, body, req) => {
  const original = await PriceRevision.findById(revisionId);
  if (!original) throw new AppError('Revision not found', 404);

  // A correction is just a new revision flagged isCorrection.
  const newRev = await submitRevision({
    skuId: original.skuId,
    priceType: original.priceType,
    newPrice: body.correctedPrice,
    effectiveFrom: original.effectiveFrom,
    reason: `Correction of ${original._id}: ${body.note || ''}`,
    attachmentUrl: body.attachmentUrl || '',
    attachmentName: body.attachmentName || '',
  }, req);

  await PriceRevision.updateOne(
    { _id: newRev._id },
    { isCorrection: true, correctionOf: original._id },
  );

  return PriceRevision.findById(newRev._id).lean();
};

// ── Master / list views ─────────────────────────────────────────────

/**
 * Latest purchase rate per SKU across all vendors, read from the Vendor Master
 * (the source of truth for vendor rates; kept current by Vendor Master edits and
 * approved POs). Returns Map<skuId, { rate, gstRate, vendorId, vendorName,
 * updatedAt, source, referenceNumber }>, `source` taken from the matching
 * Pricing History row when one exists.
 */
const latestVendorRates = async (skus) => {
  if (!skus.length) return new Map();
  const idByCode = new Map(skus.map((s) => [String(s.code || '').toUpperCase(), String(s._id)]));
  const skuIdSet = new Set(skus.map((s) => String(s._id)));
  const products = await Vendor.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    { $unwind: '$products' },
    {
      $match: {
        $or: [
          { 'products.skuId': { $in: skus.map((s) => s._id) } },
          { 'products.skuCode': { $in: [...idByCode.keys()].filter(Boolean) } },
        ],
      },
    },
    {
      $project: {
        vendorId: '$_id', vendorName: '$name', updatedAt: { $ifNull: ['$products.lastUpdatedAt', '$updatedAt'] },
        skuId: '$products.skuId', skuCode: '$products.skuCode', rate: '$products.rate', gstRate: '$products.gstRate',
      },
    },
  ]);

  const best = new Map();
  for (const p of products) {
    const skuId = (p.skuId && skuIdSet.has(String(p.skuId))) ? String(p.skuId) : idByCode.get(String(p.skuCode || '').toUpperCase());
    if (!skuId) continue;
    const cur = best.get(skuId);
    if (!cur || new Date(p.updatedAt || 0) > new Date(cur.updatedAt || 0)) best.set(skuId, p);
  }
  if (!best.size) return new Map();

  // Where did each of those rates come from (Vendor Master edit vs PO)?
  const winners = [...best.values()];
  const history = await PricingHistory.aggregate([
    {
      $match: {
        vendorId: { $in: winners.map((w) => w.vendorId) },
        skuCode: { $in: winners.map((w) => String(w.skuCode || '').toUpperCase()).filter(Boolean) },
      },
    },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { vendorId: '$vendorId', skuCode: '$skuCode' }, source: { $first: '$source' }, referenceNumber: { $first: '$referenceNumber' } } },
  ]);
  const historyKey = (vendorId, skuCode) => `${vendorId}|${String(skuCode || '').toUpperCase()}`;
  const historyMap = new Map(history.map((h) => [historyKey(h._id.vendorId, h._id.skuCode), h]));

  const out = new Map();
  for (const [skuId, p] of best) {
    const h = historyMap.get(historyKey(p.vendorId, p.skuCode));
    out.set(skuId, {
      rate: p.rate ?? 0,
      gstRate: p.gstRate ?? 0,
      vendorId: p.vendorId,
      vendorName: p.vendorName || '',
      updatedAt: p.updatedAt || null,
      source: h?.source || 'VENDOR_MASTER',
      referenceNumber: h?.referenceNumber || '',
    });
  }
  return out;
};

export const getPriceMaster = async ({
  priceType = 'SELLING', itemType = '', category = '', search = '', status = '',
  effectiveFrom = null, effectiveTo = null, revisedBy = '', partyIds = '',
} = {}) => {
  const today = new Date();
  const fromDate = effectiveFrom ? new Date(effectiveFrom) : null;
  const toDate   = effectiveTo   ? new Date(effectiveTo)   : null;
  const revisedByQ = (revisedBy || '').trim().toLowerCase();

  // 1) Find all SKUs (optionally filtered by kind / sub-group / search / party).
  const skuFilter = {};
  if (itemType) skuFilter.itemType = itemType;
  if (category) skuFilter.category = category;
  // Combine search + party scope with $and so both constrain (each brings its own $or).
  const andClauses = [];
  if (search) {
    const rx = new RegExp(search.trim(), 'i');
    andClauses.push({ $or: [{ code: rx }, { name: rx }] });
  }
  // Party scope: only SKUs that any of the selected clients regularly order
  // (from Party.orderedSkus — the party↔SKU list learned from Sales Orders).
  // Built as a reusable match so the rows AND the nav counts (kind tabs / group
  // chips) all reflect the same party scope. Uses real ObjectIds because the
  // aggregation `$match` (unlike Mongoose `find`) does not auto-cast strings.
  const partyIdList = (Array.isArray(partyIds) ? partyIds : String(partyIds || '').split(','))
    .map((s) => String(s || '').trim()).filter(Boolean);
  let partyMatch = null;
  if (partyIdList.length) {
    const parties = await Party.find({ _id: { $in: partyIdList } })
      .select('orderedSkus.skuId orderedSkus.skuCode').lean();
    const pSkuIds = new Set();
    const pSkuCodes = new Set();
    parties.forEach((p) => (p.orderedSkus || []).forEach((o) => {
      if (o.skuId) pSkuIds.add(String(o.skuId));
      if (o.skuCode) pSkuCodes.add(String(o.skuCode).toUpperCase());
    }));
    const idArr = [...pSkuIds]
      .filter((x) => mongoose.Types.ObjectId.isValid(x))
      .map((x) => new mongoose.Types.ObjectId(x));
    // Match by linked SKU id OR by code (some ordered rows carry only a code).
    partyMatch = { $or: [{ _id: { $in: idArr } }, { code: { $in: [...pSkuCodes] } }] };
    andClauses.push(partyMatch);
  }
  if (andClauses.length) skuFilter.$and = andClauses;
  const skus = await SKU.find(skuFilter)
    .select('_id code name itemType category clientId sellingPrice rmCost gstRate marginFloor sellingPriceFrom rmCostFrom pricingRemarks')
    .lean();

  // 2) Fetch the most recent LIVE/SUPERSEDED revisions for these SKUs (capped at 2 per SKU).
  const skuIds = skus.map((s) => s._id);
  const recentRevs = await PriceRevision
    .find({
      skuId: { $in: skuIds },
      priceType,
      status: { $in: ['LIVE', 'SUPERSEDED'] },
    })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();

  const byId = new Map();
  for (const r of recentRevs) {
    const key = String(r.skuId);
    const arr = byId.get(key) || [];
    if (arr.length < 5) { arr.push(r); byId.set(key, arr); }
  }

  // 3) Fetch pending counts per SKU.
  const pending = await PriceRevision.aggregate([
    { $match: { skuId: { $in: skuIds }, priceType, status: 'PENDING_APPROVAL' } },
    { $group: { _id: '$skuId', count: { $sum: 1 } } },
  ]);
  const pendingMap = new Map(pending.map((p) => [String(p._id), p.count]));

  // 3b) Purchase stream only: the latest Vendor Master rate per SKU (read-only).
  //     Vendor rates stay in the Vendor Master / Pricing History; they are shown
  //     here for reference and never become PriceRevision rows.
  const vendorRateMap = priceType === 'RM_COST' ? await latestVendorRates(skus) : new Map();

  // 4) Build rows.
  const rows = skus.map((sku) => {
    const revs = byId.get(String(sku._id)) || [];
    // Compare at DAY granularity — effectiveFrom is stored at UTC-midnight of
    // the chosen date, so a raw millisecond compare wrongly treats a price
    // effective "today" as future for any server/timezone behind that instant.
    const live = revs.find((r) => r.status === 'LIVE' && dayjs(r.effectiveFrom).isSameOrBefore(today, 'day'));
    const prev = revs.find((r) => r._id !== live?._id && dayjs(r.effectiveFrom).isSameOrBefore(today, 'day'));
    const scheduled = revs.find((r) => r.status === 'LIVE' && dayjs(r.effectiveFrom).isAfter(today, 'day'));

    const currentPrice    = live?.newPrice ?? null;
    const previousPrice   = prev?.newPrice ?? live?.oldPrice ?? null;
    const effectiveFrom   = live?.effectiveFrom ?? null;
    const daysSinceChange = effectiveFrom ? Math.floor((today - new Date(effectiveFrom)) / 86400000) : null;
    const changePercent   = live?.changePercent ?? 0;

    const margin = (priceType === 'SELLING' && currentPrice != null && sku.rmCost > 0)
      ? currentPrice - sku.rmCost
      : null;
    const marginPercent = margin != null && currentPrice > 0
      ? Math.round((margin / currentPrice) * 10000) / 100
      : null;
    const marginAlert = margin != null && margin < (sku.marginFloor || 0);

    // Status tag
    let statusTag = 'unpriced';
    if (currentPrice == null) statusTag = 'unpriced';
    else if (daysSinceChange != null && daysSinceChange <= 7) statusTag = 'changed';
    else if (daysSinceChange != null && daysSinceChange > 60) statusTag = 'stale';
    else statusTag = 'stable';
    if ((pendingMap.get(String(sku._id)) || 0) > 0) statusTag = 'pending';

    return {
      skuId:           sku._id,
      code:            sku.code,
      name:            sku.name,
      // The client this finished good is linked to (via "Manage SKUs" per party) —
      // powers the "Group by client" view on the Selling Price screen.
      clientId:        sku.clientId ? String(sku.clientId) : null,
      itemType:        sku.itemType || 'FINISHED_GOOD',
      category:        sku.category,
      gstRate:         sku.gstRate,
      currentPrice,
      previousPrice,
      effectiveFrom,
      daysSinceChange,
      changePercent,
      rmCost:          sku.rmCost || 0,
      margin, marginPercent, marginAlert,
      revisedByName:   live?.requestedByName || null,
      pricingRemarks:  sku.pricingRemarks || '',
      pendingCount:    pendingMap.get(String(sku._id)) || 0,
      latestVendorRate: vendorRateMap.get(String(sku._id)) || null,
      scheduled:       scheduled ? {
        newPrice: scheduled.newPrice,
        effectiveFrom: scheduled.effectiveFrom,
      } : null,
      statusTag,
    };
  });

  // 5) Apply filters: status + effective-date range + revised-by.
  let filtered = rows;
  if (status)       filtered = filtered.filter((r) => r.statusTag === status);
  if (fromDate)     filtered = filtered.filter((r) => r.effectiveFrom && new Date(r.effectiveFrom) >= fromDate);
  if (toDate)       filtered = filtered.filter((r) => r.effectiveFrom && new Date(r.effectiveFrom) <= toDate);
  if (revisedByQ)   filtered = filtered.filter((r) => (r.revisedByName || '').toLowerCase().includes(revisedByQ));

  // 6) KPIs.
  const kpis = {
    total:        rows.length,
    changedThisWeek: rows.filter((r) => r.statusTag === 'changed').length,
    stable:       rows.filter((r) => r.statusTag === 'stable').length,
    stale:        rows.filter((r) => r.statusTag === 'stale').length,
    unpriced:     rows.filter((r) => r.statusTag === 'unpriced').length,
    pending:      rows.filter((r) => r.pendingCount > 0).length,
    marginBreach: rows.filter((r) => r.marginAlert).length,
  };

  // 7) Navigation chrome: item-kind counts (the top tabs) + sub-group chips
  //    for the active kind. Computed independently of search/status so the
  //    tabs and chips stay stable while the user filters the list below.
  const [itemTypeAgg, catAgg] = await Promise.all([
    SKU.aggregate([
      ...(partyMatch ? [{ $match: partyMatch }] : []),
      { $group: { _id: '$itemType', count: { $sum: 1 } } },
    ]),
    SKU.aggregate([
      ...(partyMatch ? [{ $match: partyMatch }] : []),
      ...(itemType ? [{ $match: { itemType } }] : []),
      { $group: { _id: { $ifNull: ['$category', ''] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const itemTypeCounts = itemTypeAgg.reduce((acc, r) => {
    acc[r._id || 'FINISHED_GOOD'] = r.count;
    return acc;
  }, {});
  const categories = catAgg
    .filter((c) => c._id)
    .map((c) => ({ name: c._id, count: c.count }));

  return { rows: filtered, kpis, itemTypeCounts, categories };
};

export const getSkuHistory = async (skuId, priceType = 'SELLING') => {
  const revs = await PriceRevision
    .find({ skuId, priceType })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
  return revs;
};

// ── Phase-1 additions ─────────────────────────────────────────────────

// Update the sticky "Remarks" note on an SKU.
// Does NOT create a revision — this is just metadata on the master row.
export const updateSkuRemarks = async (skuId, remarks) => {
  const sku = await SKU.findByIdAndUpdate(
    skuId,
    { $set: { pricingRemarks: (remarks || '').trim() } },
    { new: true, projection: { _id: 1, code: 1, pricingRemarks: 1 } },
  ).lean();
  if (!sku) throw new AppError('SKU not found', 404);
  return sku;
};

// Distinct list of users who have ever filed a revision.
// Used to populate the "Revised by" filter dropdown.
export const getReviewers = async () => {
  const names = await PriceRevision.distinct('requestedByName');
  return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
};

// ── Phase-2/3: Document tracker + Analytics ─────────────────────────

// Auto-categorise a revision into one or more of the three folders the
// client described:
//   CUSTOMER     — selling-price proofs (quotation, email confirm, customer PO)
//   SUPPLIER_RM  — RM cost proofs (supplier rate sheet, mill quote)
//   APPROVED     — fully-approved selling revisions (subset of CUSTOMER, but
//                  surfaced separately so MD can see "final" docs at a glance)
const categoriseRevision = (rev) => {
  const cats = [];
  if (!rev.attachmentUrl) return cats;
  if (rev.priceType === 'SELLING')  cats.push('CUSTOMER');
  if (rev.priceType === 'RM_COST')  cats.push('SUPPLIER_RM');
  if (rev.priceType === 'SELLING' && rev.status === 'LIVE' && rev.approvedAt) {
    cats.push('APPROVED');
  }
  return cats;
};

// Best-effort file-type sniff from the URL or filename.
const inferFileType = (name = '', url = '') => {
  const ext = String(name || url || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1] || '';
  if (['pdf'].includes(ext)) return 'PDF';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'IMAGE';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'SHEET';
  if (['doc', 'docx'].includes(ext)) return 'DOC';
  if (['eml', 'msg'].includes(ext)) return 'EMAIL';
  return 'OTHER';
};

export const listPricingDocuments = async ({
  category = '', search = '', from = null, to = null, uploader = '', priceType = '',
} = {}) => {
  const filter = { attachmentUrl: { $exists: true, $ne: '' } };

  // Narrow by stream up-front.
  if (priceType === 'SELLING' || category === 'CUSTOMER' || category === 'APPROVED') {
    filter.priceType = 'SELLING';
  } else if (priceType === 'RM_COST' || category === 'SUPPLIER_RM') {
    filter.priceType = 'RM_COST';
  }
  // For "Approved" — must be approved LIVE selling.
  if (category === 'APPROVED') {
    filter.status = 'LIVE';
    filter.approvedAt = { $ne: null };
  }
  if (from) {
    filter.createdAt = filter.createdAt || {};
    filter.createdAt.$gte = new Date(from);
  }
  if (to) {
    filter.createdAt = filter.createdAt || {};
    filter.createdAt.$lte = new Date(to);
  }
  if (uploader) {
    filter.requestedByName = new RegExp(uploader.trim(), 'i');
  }
  if (search) {
    const rx = new RegExp(search.trim(), 'i');
    filter.$or = [
      { skuCode: rx }, { skuName: rx },
      { attachmentName: rx }, { reason: rx },
      { requestedByName: rx },
    ];
  }

  const revs = await PriceRevision.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const items = revs.map((r) => ({
    _id: String(r._id),
    skuId: String(r.skuId),
    skuCode: r.skuCode,
    skuName: r.skuName,
    priceType: r.priceType,
    oldPrice: r.oldPrice,
    newPrice: r.newPrice,
    changePercent: r.changePercent,
    effectiveFrom: r.effectiveFrom,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
    status: r.status,
    reason: r.reason,
    requestedByName: r.requestedByName,
    approvedByName: r.approvedByName,
    attachmentName: r.attachmentName,
    attachmentUrl: r.attachmentUrl,
    fileType: inferFileType(r.attachmentName, r.attachmentUrl),
    categories: categoriseRevision(r),
  }));

  // Filter to the requested category in-memory (since a revision can sit in 2 buckets).
  const filtered = category
    ? items.filter((i) => i.categories.includes(category))
    : items;

  // Wider counts so the tab badges show *all* documents per category, ignoring
  // the active category filter (but still respecting search/date/uploader).
  const allForCounts = items;
  const categoryCounts = {
    CUSTOMER:    allForCounts.filter((i) => i.categories.includes('CUSTOMER')).length,
    SUPPLIER_RM: allForCounts.filter((i) => i.categories.includes('SUPPLIER_RM')).length,
    APPROVED:    allForCounts.filter((i) => i.categories.includes('APPROVED')).length,
  };

  return { items: filtered, total: filtered.length, categoryCounts };
};

// Analytics aggregation for the Trend dashboard. One round trip; all heavy
// lifting done in-memory after a single .find() so it stays fast on the
// modest revision volumes typical for an SME (< 50k rows).
//
// Returns:
//   kpis           — headline numbers
//   monthlyTimeline— per-month avg %, total revisions, RM-cost index
//   topMovers      — biggest increases / decreases in window
//   skuHeatmap     — SKU × month grid of average %-change per SKU per month
export const getPricingAnalytics = async ({
  priceType = 'SELLING', itemType = '', months = 12,
} = {}) => {
  const monthsBack = Math.max(3, Math.min(24, Number(months) || 12));
  const today = dayjs().endOf('day');
  const windowStart = today.subtract(monthsBack - 1, 'month').startOf('month').toDate();

  // Optional: narrow analytics to one item kind by resolving its SKU ids first.
  let skuIdFilter = null;
  if (itemType) {
    const ids = await SKU.find({ itemType }).select('_id').lean();
    skuIdFilter = ids.map((x) => x._id);
  }

  // Pull all LIVE-or-SUPERSEDED revisions in the window for the chosen stream.
  const revs = await PriceRevision.find({
    priceType,
    status: { $in: ['LIVE', 'SUPERSEDED'] },
    createdAt: { $gte: windowStart },
    ...(skuIdFilter ? { skuId: { $in: skuIdFilter } } : {}),
  })
    .sort({ createdAt: 1 })
    .lean();

  // Helper: build the empty month buckets so the chart axis is always continuous.
  const monthKeys = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    monthKeys.push(today.subtract(i, 'month').format('YYYY-MM'));
  }

  // Per-month aggregation
  const monthMap = new Map(monthKeys.map((k) => [k, {
    month: k,
    label: dayjs(`${k}-01`).format('MMM YY'),
    totalRevisions: 0,
    sumChange: 0,
    countWithChange: 0,
    avgPrice: 0,
    sumPrice: 0,
    sumPriceCount: 0,
  }]));

  // SKU × month heatmap accumulators
  const skuMap = new Map();
  for (const r of revs) {
    const mKey = dayjs(r.createdAt).format('YYYY-MM');
    const m = monthMap.get(mKey);
    if (!m) continue;

    m.totalRevisions += 1;
    if (typeof r.changePercent === 'number' && r.oldPrice != null) {
      m.sumChange += r.changePercent;
      m.countWithChange += 1;
    }
    if (typeof r.newPrice === 'number') {
      m.sumPrice += r.newPrice;
      m.sumPriceCount += 1;
    }

    if (!skuMap.has(String(r.skuId))) {
      skuMap.set(String(r.skuId), {
        skuId: String(r.skuId),
        code: r.skuCode,
        name: r.skuName,
        revisions: 0,
        totalChange: 0,
        monthlyChanges: {},
      });
    }
    const s = skuMap.get(String(r.skuId));
    s.revisions += 1;
    if (typeof r.changePercent === 'number') {
      s.totalChange += r.changePercent;
      const prev = s.monthlyChanges[mKey] || { sum: 0, count: 0 };
      prev.sum += r.changePercent;
      prev.count += 1;
      s.monthlyChanges[mKey] = prev;
    }
  }

  // Finalise monthly stats
  const monthlyTimeline = monthKeys.map((k) => {
    const m = monthMap.get(k);
    return {
      month: m.month,
      label: m.label,
      totalRevisions: m.totalRevisions,
      avgChangePercent: m.countWithChange ? Number((m.sumChange / m.countWithChange).toFixed(2)) : 0,
      avgPrice: m.sumPriceCount ? Number((m.sumPrice / m.sumPriceCount).toFixed(2)) : null,
    };
  });

  // Price index: rebased so first non-null month = 100
  const firstBase = monthlyTimeline.find((m) => m.avgPrice != null)?.avgPrice;
  const indexed = monthlyTimeline.map((m) => ({
    ...m,
    priceIndex: firstBase && m.avgPrice != null
      ? Number(((m.avgPrice / firstBase) * 100).toFixed(2))
      : null,
  }));

  // KPIs
  const thisMonthKey = today.format('YYYY-MM');
  const thisMonth   = monthlyTimeline.find((m) => m.month === thisMonthKey) || { avgChangePercent: 0, totalRevisions: 0 };
  const totalRevisionsWindow = monthlyTimeline.reduce((a, m) => a + m.totalRevisions, 0);
  const avgChangeWindow = (() => {
    const filtered = monthlyTimeline.filter((m) => m.avgChangePercent !== 0);
    if (!filtered.length) return 0;
    return Number((filtered.reduce((a, m) => a + m.avgChangePercent, 0) / filtered.length).toFixed(2));
  })();
  const volatileSkus = [...skuMap.values()].filter((s) => s.revisions >= 3).length;

  // Top movers across the window
  const movers = [...skuMap.values()].map((s) => ({
    skuId: s.skuId, code: s.code, name: s.name,
    revisions: s.revisions,
    totalChangePercent: Number(s.totalChange.toFixed(2)),
  }));
  const topIncreases = movers.filter((m) => m.totalChangePercent > 0)
    .sort((a, b) => b.totalChangePercent - a.totalChangePercent)
    .slice(0, 5);
  const topDecreases = movers.filter((m) => m.totalChangePercent < 0)
    .sort((a, b) => a.totalChangePercent - b.totalChangePercent)
    .slice(0, 5);

  // Heatmap rows: top 12 most active SKUs (so the grid stays readable)
  const heatmapSkus = [...skuMap.values()]
    .sort((a, b) => b.revisions - a.revisions)
    .slice(0, 12)
    .map((s) => ({
      skuId: s.skuId,
      code: s.code,
      name: s.name,
      revisions: s.revisions,
      monthlyChanges: monthKeys.reduce((acc, k) => {
        const cell = s.monthlyChanges[k];
        acc[k] = cell ? Number((cell.sum / cell.count).toFixed(2)) : null;
        return acc;
      }, {}),
    }));

  return {
    priceType,
    itemType: itemType || '',
    months: monthsBack,
    kpis: {
      thisMonthAvgChange:      thisMonth.avgChangePercent,
      thisMonthRevisions:      thisMonth.totalRevisions,
      windowAvgChange:         avgChangeWindow,
      windowTotalRevisions:    totalRevisionsWindow,
      volatileSkus,
      uniqueSkusRevised:       skuMap.size,
    },
    monthlyTimeline: indexed,
    topIncreases,
    topDecreases,
    heatmap: { months: monthKeys, monthLabels: monthlyTimeline.map((m) => m.label), skus: heatmapSkus },
  };
};

// Bulk data for the Excel export (one round trip).
// Returns the three views the client asked for:
//   current   → "Current SKU Prices" sheet
//   history   → "Price Revision History" sheet (all revisions)
//   documents → "Supporting Documents" sheet (revisions with attachments)
export const getExportData = async ({ priceType = 'SELLING', itemType = '' } = {}) => {
  const master = await getPriceMaster({ priceType, itemType });
  const revFilter = { priceType };
  if (itemType) {
    const ids = await SKU.find({ itemType }).select('_id').lean();
    revFilter.skuId = { $in: ids.map((x) => x._id) };
  }
  const allRevs = await PriceRevision
    .find(revFilter)
    .sort({ createdAt: -1 })
    .lean();

  const documents = allRevs.filter((r) => r.attachmentUrl);

  return {
    priceType,
    current: master.rows,
    history: allRevs,
    documents,
    kpis: master.kpis,
    exportedAt: new Date(),
  };
};

export const getPriceAsOf = async ({ skuId, date, priceType = 'SELLING' }) => {
  const asOf = date ? new Date(date) : new Date();
  const rev = await latestLiveRevision(skuId, priceType, asOf);
  if (!rev) {
    return { skuId, priceType, date: asOf, unitPrice: null, source: 'NONE', revisionId: null };
  }
  return {
    skuId, priceType, date: asOf,
    unitPrice: rev.newPrice,
    source:    'MASTER',
    revisionId: rev._id,
    effectiveFrom: rev.effectiveFrom,
  };
};

export const getPendingApprovals = async () => {
  const rows = await PriceRevision
    .find({ status: 'PENDING_APPROVAL' })
    .sort({ createdAt: -1 })
    .lean();
  return rows;
};

// ── Settings ────────────────────────────────────────────────────────
export const getSettings = async () => CompanySettings.getSingleton();
export const updateSettings = async (patch, actor) => {
  const s = await CompanySettings.getSingleton();
  Object.assign(s, patch);
  s.updatedBy = actor._id;
  await s.save();
  return s.toObject();
};
