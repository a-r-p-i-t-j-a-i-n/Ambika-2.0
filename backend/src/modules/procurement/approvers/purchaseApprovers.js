/**
 * Designated Purchase approvers — the two people who decide, between them, the
 * approvals that go to "Purchase Approval":
 *
 *   - the MD (the user holding the MD role — `isMdForDirectSave`, the same
 *     strict identity "Save PO Directly" uses), and
 *   - the purchase approver, found BY E-MAIL in the user records
 *     (PURCHASE_APPROVER_EMAILS, default imp@msambikaglobal.in). No user id is
 *     ever written down: the user is looked up at request time, so a re-created
 *     account or a different database just works, and a missing account is
 *     reported (logged) instead of silently dropping the approver.
 *
 * Either one may decide a request on their own — one decision is enough; who
 * wins a race is settled by the atomic claim in each service, not here.
 *
 * Existing approval permissions are NOT replaced: holders of
 * procurement.approveRateChange / procurement.approve keep deciding rate / unit
 * changes exactly as before. The e-mail approver is simply added to that set.
 * (A PO for a NEW vendor is stricter — only these two may decide it; see
 * poApproval.js.)
 */
import User from '../../auth/auth.model.js';
import asyncHandler from '../../../middleware/asyncHandler.js';
import { requirePermission, userHasPermission } from '../../../middleware/permission.middleware.js';
import { isMdForDirectSave } from '../purchase-order/poDirectSave.js';
import { logger } from '../../../utils/logger.js';

export const DEFAULT_APPROVER_EMAILS = ['imp@msambikaglobal.in'];

/** The configured purchase-approver e-mails (lower-case, de-duplicated). `raw` is for tests. */
export const approverEmails = (raw = process.env.PURCHASE_APPROVER_EMAILS) => {
  const list = String(raw ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length ? [...new Set(list)] : [...DEFAULT_APPROVER_EMAILS];
};

/**
 * Is `user` one of the designated approvers — the MD, or the account with a
 * configured approver e-mail? Reads the user record `protect` loaded for the
 * request (never anything the client sends); a deactivated user never is.
 */
export const isDesignatedApprover = (user, emails = approverEmails()) => {
  if (!user || user.isActive === false) return false;
  if (isMdForDirectSave(user)) return true;
  const email = String(user.email || '').trim().toLowerCase();
  return Boolean(email) && emails.includes(email);
};

/** Can this request's user decide, by the designation or by one of `slugs`? */
export const canDecideAs = (req, slugs = []) => isDesignatedApprover(req.user)
  || slugs.some((s) => userHasPermission(req, s));

/**
 * Route gate: a designated approver passes; everyone else needs one of `slugs`
 * (same OR rule as requirePermission). The service re-checks what it must.
 */
export const requirePermissionOrDesignated = (...slugs) => {
  const byPermission = requirePermission(...slugs);
  return asyncHandler(async (req, res, next) => {
    if (isDesignatedApprover(req.user)) return next();
    return byPermission(req, res, next);
  });
};

/**
 * The active user records of the designated approvers: every MD, plus the
 * account of each configured e-mail. `missingEmails` = configured addresses with
 * no active user (logged — a request is then routed to the MD only).
 */
export const resolveDesignatedApprovers = async () => {
  const emails = approverEmails();
  const users = await User.find({
    isActive: { $ne: false },
    $or: [{ roles: 'MD' }, { roles: { $size: 0 }, role: 'MD' }, { email: { $in: emails } }],
  }).select('_id name email role roles isActive').lean();
  const approvers = users.filter((u) => isDesignatedApprover(u, emails));
  const have = new Set(approvers.map((u) => String(u.email || '').toLowerCase()));
  const missingEmails = emails.filter((e) => !have.has(e));
  if (missingEmails.length) {
    logger.warn(`[purchase-approvers] no active user for ${missingEmails.join(', ')} — approvals go to the MD only`);
  }
  return { approvers, md: approvers.filter(isMdForDirectSave), missingEmails };
};
