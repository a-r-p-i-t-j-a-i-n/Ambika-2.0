/**
 * "Save PO Directly" (create + approve in one step) is the MD's action only.
 * Mirrors backend/src/modules/procurement/purchase-order/poDirectSave.js — the
 * server enforces it; this only decides which save button the form offers.
 *
 * MD = holds the MD role in `roles[]`; the legacy `role: 'MD'` counts only when
 * the user has no `roles[]` (a removed MD role leaves that field behind).
 */
export const isMdForDirectSave = (user) => {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.length) return roles.includes('MD');
  return user.role === 'MD';
};
