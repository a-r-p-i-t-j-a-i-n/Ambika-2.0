/**
 * Permission Registry — single source of truth for every permission slug in the app.
 *
 * Why a code registry (and not a DB collection):
 *   Permissions are part of the application contract — the moment a new
 *   feature is shipped, its permission slug ships with it. Storing them
 *   in a DB collection would let a runtime config drift away from the
 *   capabilities the code actually checks. Roles, on the other hand,
 *   ARE data (MD can add/remove them) and live in Mongo.
 *
 * Slug grammar:  '<module>.<action>'  e.g. 'pricing.revise'
 * Risk levels:   'low' | 'medium' | 'high' | 'critical'
 *   - low      : read / view-style actions
 *   - medium   : routine writes that have an audit trail
 *   - high     : approvals, role assignments, bulk operations
 *   - critical : irreversible (delete, override safety guards)
 * The UI uses the risk tag to decide whether a permission grant needs
 * a double-confirm dialog.
 */

export const PERMISSIONS = Object.freeze({
  // ── Pricing & Revenue ────────────────────────────────────────────
  'pricing.view':                { module: 'Pricing',        label: 'View prices',                               risk: 'low' },
  'pricing.revise':              { module: 'Pricing',        label: 'Submit a price revision',                   risk: 'medium' },
  'pricing.reviseAutoApprove':   { module: 'Pricing',        label: 'Auto-approve revisions within threshold',   risk: 'high' },
  'pricing.approve':             { module: 'Pricing',        label: 'Approve / reject pending revisions',        risk: 'high' },
  'pricing.delete':              { module: 'Pricing',        label: 'Delete a revision',                         risk: 'critical' },
  'pricing.bulkUpload':          { module: 'Pricing',        label: 'Bulk-upload prices from Excel/CSV',         risk: 'high' },
  'pricing.overrideMargin':      { module: 'Pricing',        label: 'Override negative-margin block',            risk: 'critical' },

  // ── Quotes ──────────────────────────────────────────────────────
  'quotes.view':                 { module: 'Quotes',         label: 'View quotes',                               risk: 'low' },
  'quotes.create':               { module: 'Quotes',         label: 'Create / save a quote',                     risk: 'medium' },
  'quotes.edit':                 { module: 'Quotes',         label: 'Edit a draft quote',                        risk: 'medium' },
  'quotes.send':                 { module: 'Quotes',         label: 'Send a quote (lock it)',                    risk: 'medium' },
  'quotes.delete':               { module: 'Quotes',         label: 'Delete a quote',                            risk: 'high' },
  'quotes.convertToOrder':       { module: 'Quotes',         label: 'Convert a quote to a Sales Order',          risk: 'high' },
  'quotes.exportPdf':            { module: 'Quotes',         label: 'Export quote as PDF',                       risk: 'low' },

  // ── Sales Orders ────────────────────────────────────────────────
  'orders.view':                 { module: 'Orders',         label: 'View sales orders',                         risk: 'low' },
  'orders.create':               { module: 'Orders',         label: 'Create a sales order',                      risk: 'medium' },
  'orders.intake':               { module: 'Orders',         label: 'Log an order intake (call/email/WhatsApp)', risk: 'medium' },
  'orders.edit':                 { module: 'Orders',         label: 'Edit an existing sales order',              risk: 'medium' },
  'orders.delete':               { module: 'Orders',         label: 'Delete a sales order',                      risk: 'critical' },

  // ── Dispatch Planning ───────────────────────────────────────────
  'planning.view':               { module: 'Planning',       label: 'View dispatch plans',                       risk: 'low' },
  'planning.editPhases':         { module: 'Planning',       label: 'Add / edit phases',                         risk: 'medium' },
  'planning.reschedule':         { module: 'Planning',       label: 'Reschedule a phase',                        risk: 'medium' },
  'planning.deletePhase':        { module: 'Planning',       label: 'Delete a phase',                            risk: 'high' },

  // ── Execution (Actual Dispatch) ─────────────────────────────────
  'execution.view':              { module: 'Execution',      label: 'View challans / dispatches',                risk: 'low' },
  'execution.recordDispatch':    { module: 'Execution',      label: 'Record an actual dispatch (challan)',       risk: 'medium' },
  'execution.deleteDispatch':    { module: 'Execution',      label: 'Delete a recorded dispatch',                risk: 'critical' },

  // ── Master Data ─────────────────────────────────────────────────
  'masters.viewSku':             { module: 'Master Data',    label: 'View SKU master',                           risk: 'low' },
  'masters.editSku':             { module: 'Master Data',    label: 'Create / edit SKUs',                        risk: 'medium' },
  'masters.deleteSku':           { module: 'Master Data',    label: 'Delete an SKU',                             risk: 'high' },
  'masters.viewParty':           { module: 'Master Data',    label: 'View parties',                              risk: 'low' },
  'masters.editParty':           { module: 'Master Data',    label: 'Create / edit parties',                     risk: 'medium' },
  'masters.deleteParty':         { module: 'Master Data',    label: 'Delete a party',                            risk: 'high' },

  // ── Procurement (Purchase FMS) ──────────────────────────────────
  'procurement.approve':           { module: 'Procurement',    label: 'Approve procurement documents (PO / PI)',   risk: 'high' },
  'procurement.markPiNotRequired': { module: 'Procurement',    label: 'Mark a PO\'s PI as Not Required',            risk: 'high' },

  // ── Access Control ──────────────────────────────────────────────
  'accessControl.manageUsers':   { module: 'Access Control', label: 'Manage users (invite, suspend, assign)',    risk: 'high' },
  'accessControl.manageRoles':   { module: 'Access Control', label: 'Create / edit / delete roles',              risk: 'high' },
  'accessControl.viewAuditLog':  { module: 'Access Control', label: 'View access-control audit log',             risk: 'low' },

  // ── Settings ────────────────────────────────────────────────────
  'settings.view':               { module: 'Settings',       label: 'View company settings',                     risk: 'low' },
  'settings.edit':               { module: 'Settings',       label: 'Edit company settings (thresholds, GST)',   risk: 'high' },

  // ── O2D FMS (Flow Management System) ─────────────────────────────
  'o2dfms.view':                 { module: 'O2D FMS',        label: 'View processes, tasks & dashboard',         risk: 'low' },
  'o2dfms.act':                  { module: 'O2D FMS',        label: 'Complete a step (do the operation)',        risk: 'medium' },
  'o2dfms.manage':               { module: 'O2D FMS',        label: 'Reassign a step owner',                     risk: 'medium' },
  'o2dfms.config':               { module: 'O2D FMS',        label: 'Configure the step catalog (Who/What/When)',risk: 'high' },
});

/** Sentinel granted to root users (MD). Bypasses every permission check. */
export const ROOT_PERMISSION = '*';

/** All permission slugs as a Set, for O(1) validation. */
export const ALL_PERMISSION_SLUGS = new Set(Object.keys(PERMISSIONS));

/**
 * Group permissions by module, sorted by module name then slug.
 * Used by the Access Control UI to render the matrix and the per-user drawer.
 */
export const permissionsByModule = () => {
  const groups = new Map();
  for (const [slug, meta] of Object.entries(PERMISSIONS)) {
    const arr = groups.get(meta.module) || [];
    arr.push({ slug, ...meta });
    groups.set(meta.module, arr);
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.slug.localeCompare(b.slug));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, items]) => ({ module, items }));
};

/** Throws if a slug is not declared in the registry. Used during role create/edit. */
export const assertValidPermission = (slug) => {
  if (slug === ROOT_PERMISSION) return;
  if (!ALL_PERMISSION_SLUGS.has(slug)) {
    throw new Error(`Unknown permission slug: '${slug}'. See common/permissions/registry.js`);
  }
};

export default PERMISSIONS;
