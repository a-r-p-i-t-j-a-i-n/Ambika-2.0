/**
 * New-vendor PO approvals in Purchase Approval.
 *
 * A PO for a NEW vendor (newVendorRule.js) is not a second approval object: its
 * request IS the PO, waiting for the decision it always needs — approve / reject
 * through the existing PO approval (purchaseOrder.service approve()), which
 * already flips DRAFT → APPROVED / REJECTED atomically, applies maker-checker,
 * records the decider and mints the PO number. This module only
 *   - lists / describes those POs for the Purchase Approval page (read-only),
 *   - notifies the two designated approvers when one is submitted, and settles
 *     the notification for both when either decides.
 * Because the list is one query over the same PO, a request the first approver
 * decided is no longer pending for the other — there is no second copy to clear.
 */
import mongoose from 'mongoose';
import VendorPurchaseOrder, { PO_APPROVAL_STATUS, PO_STATUS } from '../purchase-order/purchaseOrder.model.js';
import Vendor from '../../vendors/vendor.model.js';
import User from '../../auth/auth.model.js';
import { notificationsService } from '../../notifications/notification.service.js';
import { poApprovalBlock } from '../purchase-order/poApproval.js';
import { isPoSubmitted, SUBMITTED_FILTER } from '../purchase-order/poSubmission.js';
import { resolveDesignatedApprovers, isDesignatedApprover } from './purchaseApprovers.js';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';

const { ObjectId } = mongoose.Types;

export const PURCHASE_APPROVAL_LINK = '/purchase-fms/rate-change-approvals';
export const PO_APPROVAL_STATUS_VIEW = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };

const idStr = (v) => (v ? String(v._id || v) : '');
const poRefOf = (po) => po?.poNumber || po?.draftNumber || '';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const poApprovalRefKey = (poId) => `po-approval:${idStr(poId)}`;

/** The status the Purchase Approval page shows for a PO (PENDING = submitted, awaiting a decision). */
export const viewStatusOf = (po) => {
  if (po.approvalStatus === PO_APPROVAL_STATUS.APPROVED) return PO_APPROVAL_STATUS_VIEW.APPROVED;
  if (po.approvalStatus === PO_APPROVAL_STATUS.REJECTED) return PO_APPROVAL_STATUS_VIEW.REJECTED;
  return PO_APPROVAL_STATUS_VIEW.PENDING;
};

// The part of the Mongo filter every list / count shares: new-vendor POs that were submitted.
const baseFilter = () => ({
  isDeleted: { $ne: true },
  'newVendorApproval.isRequired': true,
  ...SUBMITTED_FILTER,
});

const statusFilter = (status) => {
  if (status === PO_APPROVAL_STATUS_VIEW.APPROVED) return { approvalStatus: PO_APPROVAL_STATUS.APPROVED };
  if (status === PO_APPROVAL_STATUS_VIEW.REJECTED) return { approvalStatus: PO_APPROVAL_STATUS.REJECTED };
  if (status === PO_APPROVAL_STATUS_VIEW.PENDING) {
    return { approvalStatus: PO_APPROVAL_STATUS.DRAFT, poStatus: { $ne: PO_STATUS.CANCELLED } };
  }
  return {};
};

/** What this viewer may do with one PO: { canDecide, block }. */
const viewerAccess = (user, po, permissions) => {
  if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) return { canDecide: false, block: '' };
  const block = poApprovalBlock(user, po, permissions, { newVendor: true, designated: isDesignatedApprover(user) });
  return { canDecide: !block, block: block?.message || '' };
};

const userNames = async (ids) => {
  const unique = [...new Set(ids.map(idStr).filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('name').lean();
  return new Map(users.map((u) => [idStr(u), u.name]));
};

const rowOf = (po, names, access) => ({
  _id: po._id,
  poRef: poRefOf(po),
  draftNumber: po.draftNumber || '',
  poNumber: po.poNumber || '',
  status: viewStatusOf(po),
  vendorId: po.vendorId,
  vendorName: po.vendorName || '',
  vendorCreatedAt: po.newVendorApproval?.vendorCreatedAt || null,
  grandTotal: po.grandTotal || 0,
  itemCount: (po.items || []).length,
  indentNumbers: po.indentNumbers?.length ? po.indentNumbers : [po.indentNumber].filter(Boolean),
  poDate: po.poDate || null,
  submittedBy: po.submittedBy || names.get(idStr(po.createdBy)) || '',
  submittedAt: po.submittedAt || po.createdAt || null,
  decidedBy: po.approval?.decidedBy || '',
  decidedAt: po.approval?.decidedAt || null,
  remarks: po.approval?.remarks || '',
  ...access,
});

export const newVendorPoApprovalService = {
  /** The Purchase Approval "New Vendor POs" list: rows, counts, pagination. */
  async list(query = {}, user, permissions) {
    const filter = baseFilter();
    if (query.search) {
      const re = new RegExp(escapeRegex(String(query.search).trim()), 'i');
      filter.$or = [{ poNumber: re }, { draftNumber: re }, { vendorName: re }, { indentNumber: re }, { indentNumbers: re }, { submittedBy: re }];
    }
    const listFilter = { ...filter, ...statusFilter(query.status) };
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));

    const [rows, total, pending, approved, rejected] = await Promise.all([
      VendorPurchaseOrder.find(listFilter)
        .select('poNumber draftNumber vendorId vendorName grandTotal items.itemName indentNumber indentNumbers poDate createdAt createdBy submittedBy submittedById submittedAt approvalStatus poStatus approval newVendorApproval activityTimeline')
        .sort({ submittedAt: -1, createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorPurchaseOrder.countDocuments(listFilter),
      VendorPurchaseOrder.countDocuments({ ...filter, ...statusFilter('PENDING') }),
      VendorPurchaseOrder.countDocuments({ ...filter, ...statusFilter('APPROVED') }),
      VendorPurchaseOrder.countDocuments({ ...filter, ...statusFilter('REJECTED') }),
    ]);
    const names = await userNames(rows.map((r) => r.createdBy));
    return {
      rows: rows.map((po) => rowOf(po, names, viewerAccess(user, po, permissions))),
      summary: { total: pending + approved + rejected, PENDING: pending, APPROVED: approved, REJECTED: rejected },
      canApprove: isDesignatedApprover(user),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  },

  /** One new-vendor PO as the approver reviews it (the Vendor Master record, the lines, who did what). */
  async getById(id, user, permissions) {
    const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!po) throw new AppError('Purchase order not found', 404);
    if (po.newVendorApproval?.isRequired !== true || !isPoSubmitted(po)) {
      throw new AppError('This PO is not a new-vendor approval request', 404);
    }
    const vendor = await Vendor.findOne({ _id: po.vendorId }).select('name code gstNo phone email createdAt createdBy isDeleted').lean();
    const timeline = (po.activityTimeline || []);
    const names = await userNames([po.createdBy, vendor?.createdBy, ...timeline.map((t) => t.actorId)]);
    return {
      ...rowOf(po, names, viewerAccess(user, po, permissions)),
      vendor: vendor ? {
        _id: vendor._id, name: vendor.name, code: vendor.code || '', gstNo: vendor.gstNo || '', phone: vendor.phone || '', email: vendor.email || '',
        createdAt: vendor.createdAt, createdByName: names.get(idStr(vendor.createdBy)) || '',
      } : null,
      newVendorReason: po.newVendorApproval?.reason || '',
      totals: { taxable: po.totalTaxableValue || 0, gst: po.totalGSTAmount || 0, grandTotal: po.grandTotal || 0 },
      items: (po.items || []).map((l) => ({
        _id: l._id, itemName: l.itemName, skuCode: l.skuCode, quantity: l.quantity, unit: l.unit, rate: l.rate, gstRate: l.gstRate,
        totalAmount: l.totalAmount, rateChangeStatus: l.rateChangeStatus || '', rateChangeRequestNumber: l.rateChangeRequestNumber || '',
      })),
      events: timeline
        .filter((t) => ['CREATE', 'UPDATE', 'SUBMIT', 'APPROVE', 'REJECT'].includes(t.action))
        .map((t) => ({ _id: t._id, action: t.action, description: t.description, actorName: names.get(idStr(t.actorId)) || '', at: t.timestamp })),
      remarks: po.approval?.remarks || '',
    };
  },

  /**
   * After a PO is saved / submitted: if it is a submitted, still-undecided
   * new-vendor PO, tell the MD and the purchase approver (not the person who
   * submitted it). Anything else that was announced for this PO and no longer
   * applies (the vendor was changed to an ordinary one) is settled. Non-fatal.
   */
  async notifyApprovers(po, actor) {
    try {
      if (!po) return;
      const refKey = poApprovalRefKey(po._id);
      const pending = po.newVendorApproval?.isRequired === true
        && po.approvalStatus === PO_APPROVAL_STATUS.DRAFT && isPoSubmitted(po);
      if (!pending) {
        if (po.newVendorApproval?.isRequired !== true) await notificationsService.settleByRef(refKey);
        return;
      }
      const { approvers } = await resolveDesignatedApprovers();
      const ref = poRefOf(po);
      const title = `New-vendor PO ${ref} awaits approval`;
      const body = `${po.vendorName || 'A new vendor'} is a new vendor in the Vendor Master · ${inr(po.grandTotal)} · submitted by ${po.submittedBy || actor?.name || 'someone'}`;
      const link = `${PURCHASE_APPROVAL_LINK}?tab=new-vendor&po=${idStr(po._id)}`;
      for (const a of approvers) {
        if (idStr(a._id) === idStr(actor?._id)) continue;
        await notificationsService.notifyOnce(a._id, { type: 'APPROVAL_REQUIRED', title, body, link, refKey });
      }
    } catch (err) {
      logger.error(`[new-vendor-po] approver notification failed: ${err.message}`);
    }
  },

  /** A new-vendor PO was decided: tell whoever prepared it (not the decider). Non-fatal. */
  async notifyDecision(po, approved, decider) {
    try {
      const ref = poRefOf(po);
      const targets = [...new Set([idStr(po.submittedById), idStr(po.createdBy)].filter(Boolean))]
        .filter((id) => id !== idStr(decider?._id));
      for (const uid of targets) {
        await notificationsService.notify(new ObjectId(uid), {
          type: 'INFO',
          title: `PO ${ref} ${approved ? 'approved' : 'rejected'}`,
          body: `${po.vendorName || 'New vendor'} PO ${approved ? 'approved' : 'rejected'} by ${decider?.name || 'the approver'}.`,
          link: `/procurement/purchase-orders/${idStr(po._id)}`,
        });
      }
    } catch (err) {
      logger.error(`[new-vendor-po] decision notification failed: ${err.message}`);
    }
  },
};
