/**
 * "Save PO Directly" — create a PO and approve it in one step — is the MD's
 * action only. Everyone else saves a draft, which stays a draft until it is
 * approved through PO Approval (Step 1.4A). Pure rules, no database.
 *
 * MD = holds the MD role in `roles[]` (access control v2), read from the user
 * record `protect` loaded for this request — never from anything the client
 * sends. The legacy single `role: 'MD'` field counts only for a pre-migration
 * user with no `roles[]` (the same rule the permission middleware uses for
 * root), because removing the MD role from a user leaves that field behind.
 * A permission grant (e.g. procurement.approve) never makes a user MD.
 */

export const DIRECT_SAVE_MD_ONLY =
  'Only the MD can save a PO directly — save it as a draft and submit it for approval';

export const isMdForDirectSave = (user) => {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.length) return roles.includes('MD');
  return user.role === 'MD';
};
