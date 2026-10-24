/**
 * Shared meta for the MD Approval screen (GET /approvals).
 *
 * MD identity mirrors the backend's `requireApprovalRole('MD')`: the legacy
 * single `role` field OR the v2 `roles[]` array. Deliberately NOT `isRoot` —
 * root access can be granted as a permission, but approving cannot. Gating
 * here is a UX courtesy; the server is authoritative.
 */
export const isMdUser = (user) => user?.role === 'MD' || (Array.isArray(user?.roles) && user.roles.includes('MD'));

// Approval status on the screen — tracked independently of the document's workflow.
export const MD_VIEW_STATUS = {
  PENDING:   { label: 'Pending',   tone: 'amber', color: '#b45309' },
  APPROVED:  { label: 'Approved',  tone: 'blue',  color: '#1d4ed8' },
  COMPLETED: { label: 'Completed', tone: 'green', color: '#15803d' },
};
export const MD_VIEW_STATUSES = Object.keys(MD_VIEW_STATUS);

// Document types the approval engine tracks today → their Purchase FMS module.
export const MD_APPROVAL_MODULES = [
  { value: 'PROFORMA_INVOICE', label: 'Advance Payments' },
  { value: 'GRN',     label: 'GRN & QC' },
  { value: 'VOUCHER', label: 'Vendor Invoices & Payments' },
];

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
