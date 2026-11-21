/**
 * Who may approve / reject a submitted PO — mirrors backend
 * purchase-order/poApproval.js. The server enforces it (route + service); this
 * only decides whether Approve / Reject is offered and what the screen says.
 *
 *   Permission     procurement.approve (the MD's root role always has it).
 *   Maker-checker  whoever created, edited or submitted the PO cannot decide it;
 *                  the MD is exempt (as with "Save PO Directly").
 */
import { isMdForDirectSave } from './poDirectSave';

export const PO_APPROVE_PERMISSION = 'procurement.approve';
const MAKER_ACTIONS = ['CREATE', 'UPDATE', 'UPDATE_TERMS', 'SUBMIT', 'REVISE'];
const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : (v ? String(v) : ''));

/** Ids of everyone who prepared the PO. */
export const poMakerIds = (po) => {
  const ids = new Set();
  [po?.createdBy, po?.submittedById].map(idOf).filter(Boolean).forEach((id) => ids.add(id));
  (po?.activityTimeline || []).forEach((t) => {
    if (MAKER_ACTIONS.includes(t?.action) && t?.actorId) ids.add(idOf(t.actorId));
  });
  return ids;
};

/**
 * Why `user` may not decide `po` ('' = they may). `can` = usePermissions().can.
 */
export const poApprovalBlockReason = (po, user, can) => {
  if (!can?.(PO_APPROVE_PERMISSION)) return 'Waiting for an approver — you do not have PO approval permission.';
  if (user?._id && !isMdForDirectSave(user) && poMakerIds(po).has(String(user._id))) {
    return 'Waiting for another approver — you prepared this PO, so you cannot approve or reject it yourself.';
  }
  return '';
};
