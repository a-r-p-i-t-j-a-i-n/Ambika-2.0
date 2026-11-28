/**
 * Who may approve / reject a submitted PO (PO Approval, doer step 1.4A).
 *
 *   Permission    procurement.approve (via a role, a grant or a Delegation Suite
 *                 session) — the MD's root role always has it. Checked on the
 *                 route AND again in purchaseOrder.service approve().
 *   Maker-checker the people who prepared the PO cannot decide it: whoever
 *                 created it, submitted it, or edited the draft (lines, terms).
 *                 The MD is exempt — the MD's "Save PO Directly" already
 *                 creates and approves in one step (poDirectSave.js), and the
 *                 same MD exemption applies to rate changes (rateChange.rules.js).
 *
 * Pure: no DB access.
 */
import { isMdForDirectSave } from './poDirectSave.js';

export const PO_APPROVE_PERMISSION = 'procurement.approve';
const ROOT_PERMISSION = '*';

/** Timeline actions by which a user takes part in preparing the PO. */
export const PO_MAKER_ACTIONS = ['CREATE', 'UPDATE', 'UPDATE_TERMS', 'SUBMIT', 'REVISE'];

export const PO_APPROVE_FORBIDDEN = 'You do not have permission to approve or reject purchase orders (procurement.approve)';
// A PO for a NEW vendor (approvers/newVendorRule.js) is decided by the MD or the
// purchase approver only — the procurement.approve permission does not reach it.
export const NEW_VENDOR_APPROVE_FORBIDDEN = 'This PO is for a new vendor — only the MD or the purchase approver can approve or reject it';
export const PO_MAKER_CHECKER_MESSAGE = 'You prepared this PO (created, edited or submitted it) — another approver has to approve or reject it';

const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : (v ? String(v) : ''));

/** Ids of everyone who prepared the PO. */
export const poMakerIds = (po) => {
  const ids = new Set();
  [po?.createdBy, po?.submittedById].map(idOf).filter(Boolean).forEach((id) => ids.add(id));
  (po?.activityTimeline || []).forEach((t) => {
    if (PO_MAKER_ACTIONS.includes(t?.action) && t?.actorId) ids.add(idOf(t.actorId));
  });
  return ids;
};

/** Whether a permission set allows deciding a PO. */
export const canApprovePos = (permissions) => Boolean(permissions
  && (permissions.has(ROOT_PERMISSION) || permissions.has(PO_APPROVE_PERMISSION)));

/**
 * Why `user` (holding `permissions`) may not approve / reject `po` ('' = they may).
 * Returns { status, message } for the refusal.
 *   newVendor   the PO needs the new-vendor approval (poNeedsNewVendorApproval)
 *   designated  `user` is the MD or the purchase approver (isDesignatedApprover)
 * A new-vendor PO is decided by a designated approver ONLY; every other PO by
 * anyone holding procurement.approve, as before. Maker-checker applies to both.
 */
export const poApprovalBlock = (user, po, permissions, { newVendor = false, designated = false } = {}) => {
  if (newVendor) {
    if (!designated) return { status: 403, message: NEW_VENDOR_APPROVE_FORBIDDEN };
  } else if (!canApprovePos(permissions)) {
    return { status: 403, message: PO_APPROVE_FORBIDDEN };
  }
  if (user?._id && !isMdForDirectSave(user) && poMakerIds(po).has(String(user._id))) {
    return { status: 403, message: PO_MAKER_CHECKER_MESSAGE };
  }
  return null;
};
