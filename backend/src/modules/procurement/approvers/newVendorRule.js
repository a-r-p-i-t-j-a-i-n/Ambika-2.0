/**
 * "New vendor" — when does a PO need the MD's / purchase approver's approval?
 *
 * A vendor is NEW for a PO when ALL of these hold:
 *   1. it is a Vendor Master record (a legacy Party id is never new);
 *   2. its Vendor Master record was CREATED on or after the day this rule went
 *      live (`PurchaseApprovalConfig.newVendorRuleFrom`, stamped once, at the
 *      first boot of this code) — so no vendor that already existed is ever
 *      treated as new, whatever its purchase history looks like; and
 *   3. no PO of the vendor has been approved yet — the first approved PO vets
 *      the vendor, after which it is an ordinary vendor.
 *
 * "No purchase history" alone never makes a vendor new (rule 2 is the creation
 * record), and neither does picking it through "Add New Vendor" in the PO form
 * (that only means "any active vendor").
 *
 * The verdict is STAMPED on the PO (`newVendorApproval`) when it is saved /
 * submitted, so a PO raised while the vendor was new keeps needing that
 * approval even if another PO of the vendor is approved first.
 */
import mongoose from 'mongoose';
import Vendor from '../../vendors/vendor.model.js';
import VendorPurchaseOrder, { PO_APPROVAL_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { logger } from '../../../utils/logger.js';

const { Schema, model } = mongoose;

const CONFIG_KEY = 'DEFAULT';
const configSchema = new Schema({
  key: { type: String, required: true, unique: true },
  // The moment this rule went live — vendors created before it are never "new".
  newVendorRuleFrom: { type: Date, required: true },
}, { timestamps: true });
const PurchaseApprovalConfig = mongoose.models.PurchaseApprovalConfig || model('PurchaseApprovalConfig', configSchema);

export const NEW_VENDOR_REASON = {
  NEW_VENDOR:            'NEW_VENDOR',
  NOT_IN_VENDOR_MASTER:  'NOT_IN_VENDOR_MASTER',
  NO_CREATION_RECORD:    'NO_CREATION_RECORD',
  CREATED_BEFORE_RULE:   'CREATED_BEFORE_RULE',
  ALREADY_APPROVED_PO:   'ALREADY_APPROVED_PO',
};

/** Pure decision (unit-tested): the three rules above on already-loaded facts. */
export const newVendorVerdict = ({ vendor, ruleFrom, approvedPoCount = 0 } = {}) => {
  if (!vendor) return { isNew: false, reason: NEW_VENDOR_REASON.NOT_IN_VENDOR_MASTER };
  if (!vendor.createdAt || Number.isNaN(new Date(vendor.createdAt).getTime())) {
    return { isNew: false, reason: NEW_VENDOR_REASON.NO_CREATION_RECORD };
  }
  if (!ruleFrom || new Date(vendor.createdAt) < new Date(ruleFrom)) {
    return { isNew: false, reason: NEW_VENDOR_REASON.CREATED_BEFORE_RULE };
  }
  if (approvedPoCount > 0) return { isNew: false, reason: NEW_VENDOR_REASON.ALREADY_APPROVED_PO };
  return { isNew: true, reason: NEW_VENDOR_REASON.NEW_VENDOR };
};

/**
 * Stamp the rule's start (once). Called at boot; also the lazy fallback of
 * `getRuleStart`. A concurrent first boot loses the unique-key race harmlessly.
 */
export const ensureNewVendorRuleStart = async (now = new Date()) => {
  try {
    const doc = await PurchaseApprovalConfig.findOneAndUpdate(
      { key: CONFIG_KEY },
      { $setOnInsert: { newVendorRuleFrom: now } },
      { upsert: true, new: true },
    ).lean();
    return doc.newVendorRuleFrom;
  } catch (err) {
    if (err?.code === 11000) {
      const doc = await PurchaseApprovalConfig.findOne({ key: CONFIG_KEY }).lean();
      if (doc) return doc.newVendorRuleFrom;
    }
    logger.error(`[new-vendor-rule] could not read the rule start: ${err.message}`);
    throw err;
  }
};

const getRuleStart = async (session = null) => {
  const doc = await PurchaseApprovalConfig.findOne({ key: CONFIG_KEY }).session(session).lean();
  return doc ? doc.newVendorRuleFrom : ensureNewVendorRuleStart();
};

/** Evaluate a vendor against the live Vendor Master and PO history. */
export const evaluateNewVendor = async (vendorId, { session = null } = {}) => {
  if (!vendorId) return { ...newVendorVerdict({}), vendorCreatedAt: null };
  const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).select('createdAt name').session(session).lean();
  if (!vendor) return { ...newVendorVerdict({}), vendorCreatedAt: null };
  const ruleFrom = await getRuleStart(session);
  // Only worth counting when the creation rule already says "new".
  const created = vendor.createdAt && new Date(vendor.createdAt) >= new Date(ruleFrom);
  const approvedPoCount = created
    ? await VendorPurchaseOrder.countDocuments({
      vendorId, isDeleted: { $ne: true }, approvalStatus: PO_APPROVAL_STATUS.APPROVED,
    }).session(session)
    : 0;
  return { ...newVendorVerdict({ vendor, ruleFrom, approvedPoCount }), vendorCreatedAt: vendor.createdAt || null, ruleFrom };
};

/** What a PO stores (`newVendorApproval`) for a verdict. */
export const newVendorStamp = (verdict, now = new Date()) => ({
  isRequired: Boolean(verdict?.isNew),
  reason: verdict?.reason || '',
  vendorCreatedAt: verdict?.vendorCreatedAt || null,
  evaluatedAt: now,
});

/**
 * Does this PO need the new-vendor approval? The stamp wins (set when the PO
 * was saved / submitted); a PO with no stamp at all (saved before this rule)
 * is judged on the live record.
 */
export const poNeedsNewVendorApproval = async (po, { session = null } = {}) => {
  const stamped = po?.newVendorApproval;
  if (stamped && typeof stamped.isRequired === 'boolean') return stamped.isRequired;
  return (await evaluateNewVendor(po?.vendorId, { session })).isNew;
};
