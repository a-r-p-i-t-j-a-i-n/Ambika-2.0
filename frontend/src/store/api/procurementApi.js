import { baseApi } from './baseApi';

/**
 * Purchase FMS — Procurement API.
 * Module 1: Purchase Indents.  Base: /api/v1/procurement/indents
 */

// Maps a Digital Approval documentType to the RTK tag its parent doc already
// uses, so signing/replacing/removing a signature also refreshes the GRN/
// Voucher detail query that mirrors approvalStatus — same invalidation
// convention used everywhere else in this file.
const APPROVAL_PARENT_TAG = { GRN: 'Grn', VOUCHER: 'Voucher', PROFORMA_INVOICE: 'ProformaInvoice' };
const approvalInvalidates = (documentType, documentId) => {
  const parentTag = APPROVAL_PARENT_TAG[documentType];
  return [
    { type: 'Approval', id: `${documentType}-${documentId}` },
    { type: 'Approval', id: 'LIST' },
    ...(parentTag ? [parentTag, { type: parentTag, id: documentId }] : []),
  ];
};
// A delete takes an id, or { id, reason } — a completed record says why it goes.
const deleteArgs = (arg) => (arg && typeof arg === 'object' ? arg : { id: arg });
const deleteRequest = (base) => (arg) => {
  const { id, reason } = deleteArgs(arg);
  return { url: `${base}/${id}`, method: 'DELETE', ...(reason ? { body: { reason } } : {}) };
};

export const procurementApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── Indents ──────────────────────────────────────────────
    getIndents: builder.query({
      query: (params = {}) => ({ url: '/procurement/indents', params }),
      providesTags: ['Indent'],
    }),
    getIndentStats: builder.query({
      query: () => '/procurement/indents/stats',
      providesTags: ['IndentStats'],
    }),
    getIndent: builder.query({
      query: (id) => `/procurement/indents/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Indent', id }],
    }),
    createIndent: builder.mutation({
      query: (body) => ({ url: '/procurement/indents', method: 'POST', body }),
      invalidatesTags: ['Indent', 'IndentStats'],
    }),
    updateIndent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    deleteIndent: builder.mutation({
      query: deleteRequest('/procurement/indents'),
      invalidatesTags: (_r, _e, arg) => ['Indent', 'IndentStats', 'FmsTasks', { type: 'Indent', id: deleteArgs(arg).id }],
    }),
    submitIndent: builder.mutation({
      query: (id) => ({ url: `/procurement/indents/${id}/submit`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    approveIndent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}/approve`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    rejectIndent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}/reject`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    bulkApproveIndents: builder.mutation({
      query: (body) => ({ url: '/procurement/indents/bulk-approve', method: 'POST', body }),
      invalidatesTags: ['Indent', 'IndentStats'],
    }),
    bulkRejectIndents: builder.mutation({
      query: (body) => ({ url: '/procurement/indents/bulk-reject', method: 'POST', body }),
      invalidatesTags: ['Indent', 'IndentStats'],
    }),
    receiveQuote: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}/receive-quote`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    // Step 1.2 — Receive Quote & Make Comparative (with quotation upload)
    quoteComparative: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}/quote-comparative`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),
    approveQuotation: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/indents/${id}/approve-quotation`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Indent', 'IndentStats', { type: 'Indent', id }],
    }),

    // ── Vendor Purchase Orders (Step 1.4) ────────────────────
    getPurchaseOrders: builder.query({
      query: (params = {}) => ({ url: '/procurement/purchase-orders', params }),
      providesTags: ['PurchaseOrder'],
    }),
    getPurchaseOrderStats: builder.query({
      query: () => '/procurement/purchase-orders/stats',
      providesTags: ['PurchaseOrderStats'],
    }),
    getPurchaseOrder: builder.query({
      query: (id) => `/procurement/purchase-orders/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'PurchaseOrder', id }],
    }),
    // Global approved-item picker for the New PO form — all PO-creatable indents,
    // one row per approved, not-yet-PO'd item (item-level references).
    getAllApprovedItems: builder.query({
      query: (params = {}) => ({ url: '/procurement/purchase-orders/approved-items', params }),
      providesTags: ['Indent', 'PurchaseOrder'],
    }),
    // "Awaiting this step" — upstream records waiting at a step that has no
    // record of its own yet (backend procurement/stepQueue.js). Read-only; it
    // refreshes whenever any record it is built from changes.
    getStepQueue: builder.query({
      query: ({ queue, ...params }) => ({ url: `/procurement/step-queues/${queue}`, params }),
      providesTags: ['Indent', 'PurchaseOrder', 'FollowUp', 'ProformaInvoice', 'AdvancePayment', 'Grn', 'IncomingQc', 'VendorInvoice', 'Voucher', 'TallyEntry', 'FinalPayment'],
    }),
    // Pending for PO — fix (or clear) the vendor of one approved indent item.
    setItemVendor: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders/approved-items/vendor', method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { indentId }) => ['Indent', { type: 'Indent', id: indentId }],
    }),
    createPurchaseOrder: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders', method: 'POST', body }),
      invalidatesTags: ['PurchaseOrder', 'RateChange', 'Vendor', 'Pricing', 'PurchaseOrderStats', 'Indent', 'IndentStats'],
    }),
    // New PO form item-picker → one vendor, hand-picked approved items.
    createPurchaseOrderFromItems: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders/create-from-items', method: 'POST', body }),
      invalidatesTags: ['PurchaseOrder', 'RateChange', 'Vendor', 'Pricing', 'PurchaseOrderStats', 'Indent', 'IndentStats'],
    }),
    // Returns a PDF Blob (no DB write). On error the backend sends JSON, so branch
    // the responseHandler on response.ok to surface a readable error message.
    previewPurchaseOrderPdf: builder.mutation({
      query: (body) => ({
        url: '/procurement/purchase-orders/preview-pdf',
        method: 'POST',
        body,
        responseHandler: async (response) => (response.ok ? response.blob() : response.json()),
      }),
    }),
    updatePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'RateChange', 'Vendor', 'Pricing', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
    }),
    // Terms & Conditions only (PO detail) — nothing else on the PO changes.
    updatePurchaseOrderTerms: builder.mutation({
      query: ({ id, termsAndConditions }) => ({ url: `/procurement/purchase-orders/${id}/terms`, method: 'PATCH', body: { termsAndConditions } }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', { type: 'PurchaseOrder', id }],
    }),
    // Default Terms & Conditions per PO format ({ JSL, OTHER }), edited in Company Settings.
    getPoTermsDefaults: builder.query({
      query: () => '/procurement/purchase-orders/terms-defaults',
      providesTags: ['CompanySettings'],
    }),
    deletePurchaseOrder: builder.mutation({
      query: deleteRequest('/procurement/purchase-orders'),
      invalidatesTags: (_r, _e, arg) => ['PurchaseOrder', 'RateChange', 'PurchaseOrderStats', 'Indent', 'IndentStats', 'FmsTasks', { type: 'PurchaseOrder', id: deleteArgs(arg).id }],
    }),
    approvePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/approve`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'RateChange', 'Vendor', 'Pricing', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
    }),
    releasePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/release`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
    }),
    // Generate/refresh a saved PO's PDF on demand — same generatePdf() release()
    // already uses, exposed so a PO can be previewed before it's released.
    generatePurchaseOrderPdf: builder.mutation({
      query: ({ id }) => ({ url: `/procurement/purchase-orders/${id}/pdf`, method: 'POST' }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', { type: 'PurchaseOrder', id }],
    }),
    bulkReleasePurchaseOrders: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders/bulk-release', method: 'POST', body }),
      invalidatesTags: ['PurchaseOrder', 'PurchaseOrderStats'],
    }),
    // Read-only — resolved To/CC/BCC/subject/attachment for a set of POs before
    // a bulk release actually sends anything.
    getPoReleasePreview: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders/release-preview', method: 'POST', body }),
    }),
    cancelPurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'RateChange', 'PurchaseOrderStats', 'Indent', 'IndentStats', { type: 'PurchaseOrder', id }],
    }),
    // Revise a cancelled PO → new draft PO (copied data, new number, linked back).
    revisePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/revise`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'RateChange', 'Vendor', 'Pricing', 'PurchaseOrderStats', 'Indent', 'IndentStats', { type: 'PurchaseOrder', id }],
    }),
    markPoPiNotRequired: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/pi-not-required`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', 'ProformaInvoice', { type: 'PurchaseOrder', id }],
    }),

    // ── Material Follow-ups (Step 1.5) ───────────────────────
    getFollowUps: builder.query({
      query: (params = {}) => ({ url: '/procurement/follow-ups', params }),
      providesTags: ['FollowUp'],
    }),
    getFollowUpStats: builder.query({
      query: () => '/procurement/follow-ups/stats',
      providesTags: ['FollowUpStats'],
    }),
    getFollowUpById: builder.query({
      query: (id) => `/procurement/follow-ups/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'FollowUp', id }],
    }),
    getFollowUpsByPo: builder.query({
      query: (poId) => `/procurement/follow-ups/by-po/${poId}`,
      providesTags: (_r, _e, poId) => [{ type: 'FollowUp', id: `po-${poId}` }, 'FollowUp'],
    }),
    createFollowUp: builder.mutation({
      query: (body) => ({ url: '/procurement/follow-ups', method: 'POST', body }),
      invalidatesTags: ['FollowUp', 'FollowUpStats', 'PurchaseOrder'],
    }),
    updateFollowUp: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/follow-ups/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['FollowUp', 'FollowUpStats', { type: 'FollowUp', id }],
    }),
    deleteFollowUp: builder.mutation({
      query: deleteRequest('/procurement/follow-ups'),
      invalidatesTags: (_r, _e, arg) => ['FollowUp', 'FollowUpStats', 'PurchaseOrder', 'FmsTasks', { type: 'FollowUp', id: deleteArgs(arg).id }],
    }),
    markFollowUpDone: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/follow-ups/${id}/mark-done`, method: 'POST', body }),
      // A final material date flips the PO's followUpStatus mirror to READY_FOR_GRN
      // server-side (see followUp.service.js markDone) — invalidate PurchaseOrder too,
      // so PurchaseOrderDetail's nextAction/canCreatePi recompute without a manual refresh.
      invalidatesTags: (_r, _e, { id }) => ['FollowUp', 'FollowUpStats', 'PurchaseOrder', 'PurchaseOrderStats', { type: 'FollowUp', id }],
    }),
    rescheduleFollowUp: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/follow-ups/${id}/reschedule`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['FollowUp', 'FollowUpStats', { type: 'FollowUp', id }],
    }),
    markReadyForGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/follow-ups/${id}/mark-ready-for-grn`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['FollowUp', 'FollowUpStats', 'PurchaseOrder', 'PurchaseOrderStats', { type: 'FollowUp', id }],
    }),

    // ── Proforma Invoices (Step 1.6) ─────────────────────────
    getProformaInvoices: builder.query({
      query: (params = {}) => ({ url: '/procurement/proforma-invoices', params }),
      providesTags: ['ProformaInvoice'],
    }),
    getProformaInvoiceStats: builder.query({
      query: () => '/procurement/proforma-invoices/stats',
      providesTags: ['ProformaInvoiceStats'],
    }),
    getProformaInvoiceById: builder.query({
      query: (id) => `/procurement/proforma-invoices/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'ProformaInvoice', id }],
    }),
    getProformaInvoicesByPo: builder.query({
      query: (poId) => `/procurement/proforma-invoices/by-po/${poId}`,
      providesTags: (_r, _e, poId) => [{ type: 'ProformaInvoice', id: `po-${poId}` }, 'ProformaInvoice'],
    }),
    createProformaInvoice: builder.mutation({
      query: (body) => ({ url: '/procurement/proforma-invoices', method: 'POST', body }),
      invalidatesTags: ['ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder'],
    }),
    updateProformaInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/proforma-invoices/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['ProformaInvoice', 'ProformaInvoiceStats', { type: 'ProformaInvoice', id }],
    }),
    deleteProformaInvoice: builder.mutation({
      query: deleteRequest('/procurement/proforma-invoices'),
      invalidatesTags: (_r, _e, arg) => ['ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder', 'FmsTasks', { type: 'ProformaInvoice', id: deleteArgs(arg).id }],
    }),
    approveProformaInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/proforma-invoices/${id}/approve`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder', { type: 'ProformaInvoice', id }],
    }),
    rejectProformaInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/proforma-invoices/${id}/reject`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['ProformaInvoice', 'ProformaInvoiceStats', { type: 'ProformaInvoice', id }],
    }),
    cancelProformaInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/proforma-invoices/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder', { type: 'ProformaInvoice', id }],
    }),

    // ── Advance Payments (Step 1.7) ──────────────────────────
    getAdvancePayments: builder.query({
      query: (params = {}) => ({ url: '/procurement/advance-payments', params }),
      providesTags: ['AdvancePayment'],
    }),
    getAdvancePaymentStats: builder.query({
      query: () => '/procurement/advance-payments/stats',
      providesTags: ['AdvancePaymentStats'],
    }),
    getAdvancePaymentsByPi: builder.query({
      query: (piId) => `/procurement/advance-payments/by-pi/${piId}`,
      providesTags: (_r, _e, piId) => [{ type: 'AdvancePayment', id: `pi-${piId}` }, 'AdvancePayment'],
    }),
    createAdvancePayment: builder.mutation({
      query: (body) => ({ url: '/procurement/advance-payments', method: 'POST', body }),
      invalidatesTags: ['AdvancePayment', 'AdvancePaymentStats', 'ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder'],
    }),
    deleteAdvancePayment: builder.mutation({
      query: (id) => ({ url: `/procurement/advance-payments/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['AdvancePayment', 'AdvancePaymentStats', 'ProformaInvoice', 'ProformaInvoiceStats', 'PurchaseOrder', { type: 'AdvancePayment', id }],
    }),


    // ── Goods Receipt Notes (Step 1.8) ───────────────────────
    getGrns: builder.query({
      query: (params = {}) => ({ url: '/procurement/grns', params }),
      providesTags: ['Grn'],
    }),
    getGrnStats: builder.query({
      query: () => '/procurement/grns/stats',
      providesTags: ['GrnStats'],
    }),
    getGrnById: builder.query({
      query: (id) => `/procurement/grns/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Grn', id }],
    }),
    getGrnsByPo: builder.query({
      query: (poId) => `/procurement/grns/by-po/${poId}`,
      providesTags: (_r, _e, poId) => [{ type: 'Grn', id: `po-${poId}` }, 'Grn'],
    }),
    createGrn: builder.mutation({
      query: (body) => ({ url: '/procurement/grns', method: 'POST', body }),
      invalidatesTags: ['Grn', 'GrnStats', 'PurchaseOrder', 'PurchaseOrderStats'],
    }),
    // Preview-only: returns the PDF as a Blob; persists nothing, invalidates nothing.
    previewGrnPdf: builder.mutation({
      query: (body) => ({
        url: '/procurement/grns/preview-pdf',
        method: 'POST',
        body,
        responseHandler: (response) => response.blob(),
        cache: 'no-store',
      }),
    }),
    updateGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', { type: 'Grn', id }],
    }),
    // A draft is deleted by id; a completed GRN sends { id, reason } — its
    // received qty comes off the PO / PI, so those reload too.
    deleteGrn: builder.mutation({
      query: (arg) => {
        const { id, reason } = typeof arg === 'object' ? arg : { id: arg };
        return { url: `/procurement/grns/${id}`, method: 'DELETE', ...(reason ? { body: { reason } } : {}) };
      },
      invalidatesTags: (_r, _e, arg) => ['Grn', 'GrnStats', 'PurchaseOrder', 'PurchaseOrderStats', 'ProformaInvoice', 'FmsTasks',
        { type: 'Grn', id: typeof arg === 'object' ? arg.id : arg }],
    }),
    // What correcting / deleting a GRN would touch (later steps, MD signature).
    getGrnChangeCheck: builder.query({
      query: (id) => `/procurement/grns/${id}/change-check`,
      providesTags: (_r, _e, id) => [{ type: 'Grn', id }],
    }),
    // Correct a completed GRN (procurement.editGrn).
    correctGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}/correct`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', 'PurchaseOrder', 'PurchaseOrderStats', 'ProformaInvoice', 'FmsTasks', 'Approval', { type: 'Grn', id }],
    }),
    completeGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', 'PurchaseOrder', 'PurchaseOrderStats', 'ProformaInvoice', 'InventoryStock', 'InventoryMovement', 'RmOverview', 'RmDashboard', 'ImsOverview', 'ImsDashboard', { type: 'Grn', id }],
    }),
    cancelGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', { type: 'Grn', id }],
    }),

    // ── Service Completions (former Step 1.8A — retired, history only; no create) ──
    getServiceCompletions: builder.query({
      query: (params = {}) => ({ url: '/procurement/service-completions', params }),
      providesTags: ['ServiceCompletion'],
    }),
    getServiceCompletionStats: builder.query({
      query: () => '/procurement/service-completions/stats',
      providesTags: ['ServiceCompletionStats'],
    }),
    getServiceCompletionById: builder.query({
      query: (id) => `/procurement/service-completions/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'ServiceCompletion', id }],
    }),
    updateServiceCompletion: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/service-completions/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['ServiceCompletion', 'ServiceCompletionStats', { type: 'ServiceCompletion', id }],
    }),
    completeServiceCompletion: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/service-completions/${id}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['ServiceCompletion', 'ServiceCompletionStats', 'Indent', 'IndentStats', { type: 'ServiceCompletion', id }],
    }),
    cancelServiceCompletion: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/service-completions/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['ServiceCompletion', 'ServiceCompletionStats', { type: 'ServiceCompletion', id }],
    }),

    // ── Incoming QC (Step 1.9) ───────────────────────────────
    getIncomingQcs: builder.query({
      query: (params = {}) => ({ url: '/procurement/incoming-qc', params }),
      providesTags: ['IncomingQc'],
    }),
    getIncomingQcStats: builder.query({
      query: () => '/procurement/incoming-qc/stats',
      providesTags: ['IncomingQcStats'],
    }),
    getIncomingQcById: builder.query({
      query: (id) => `/procurement/incoming-qc/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'IncomingQc', id }],
    }),
    getIncomingQcsByGrn: builder.query({
      query: (grnId) => `/procurement/incoming-qc/by-grn/${grnId}`,
      providesTags: (_r, _e, grnId) => [{ type: 'IncomingQc', id: `grn-${grnId}` }, 'IncomingQc'],
    }),
    createIncomingQc: builder.mutation({
      query: (body) => ({ url: '/procurement/incoming-qc', method: 'POST', body }),
      invalidatesTags: ['IncomingQc', 'IncomingQcStats', 'Grn', 'ServiceCompletion', 'ServiceCompletionStats'],
    }),
    updateIncomingQc: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/incoming-qc/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['IncomingQc', 'IncomingQcStats', { type: 'IncomingQc', id }],
    }),
    deleteIncomingQc: builder.mutation({
      query: (id) => ({ url: `/procurement/incoming-qc/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['IncomingQc', 'IncomingQcStats', { type: 'IncomingQc', id }],
    }),
    completeIncomingQc: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/incoming-qc/${id}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['IncomingQc', 'IncomingQcStats', 'Grn', 'GrnStats', 'InventoryStock', 'InventoryMovement', 'RmOverview', 'RmDashboard', 'ImsOverview', 'ImsDashboard', 'ServiceCompletion', 'ServiceCompletionStats', 'Indent', 'IndentStats', { type: 'IncomingQc', id }],
    }),
    cancelIncomingQc: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/incoming-qc/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['IncomingQc', 'IncomingQcStats', { type: 'IncomingQc', id }],
    }),

    // ── Vendor Invoices (Step 1.10) ──────────────────────────
    getVendorInvoices: builder.query({
      query: (params = {}) => ({ url: '/procurement/vendor-invoices', params }),
      providesTags: ['VendorInvoice'],
    }),
    getVendorInvoiceStats: builder.query({
      query: () => '/procurement/vendor-invoices/stats',
      providesTags: ['VendorInvoiceStats'],
    }),
    getVendorInvoiceById: builder.query({
      query: (id) => `/procurement/vendor-invoices/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'VendorInvoice', id }],
    }),
    getVendorInvoicesByQc: builder.query({
      query: (qcId) => `/procurement/vendor-invoices/by-qc/${qcId}`,
      providesTags: (_r, _e, qcId) => [{ type: 'VendorInvoice', id: `qc-${qcId}` }, 'VendorInvoice'],
    }),
    getInvoiceableQcs: builder.query({
      query: (params = {}) => ({ url: '/procurement/vendor-invoices/invoiceable-qcs', params }),
      providesTags: ['VendorInvoice', 'IncomingQc'],
    }),
    getInvoiceableGrns: builder.query({
      query: (params = {}) => ({ url: '/procurement/vendor-invoices/invoiceable-grns', params }),
      providesTags: ['VendorInvoice', 'IncomingQc'],
    }),
    // PI advance paid / already allocated to other invoices / still available.
    getInvoiceAdvancePosition: builder.query({
      query: (params) => ({ url: '/procurement/vendor-invoices/advance-position', params }),
      providesTags: ['VendorInvoice', 'AdvancePayment', 'ProformaInvoice'],
    }),
    createVendorInvoice: builder.mutation({
      query: (body) => ({ url: '/procurement/vendor-invoices', method: 'POST', body }),
      invalidatesTags: ['VendorInvoice', 'VendorInvoiceStats'],
    }),
    updateVendorInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vendor-invoices/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['VendorInvoice', 'VendorInvoiceStats', { type: 'VendorInvoice', id }],
    }),
    deleteVendorInvoice: builder.mutation({
      query: deleteRequest('/procurement/vendor-invoices'),
      invalidatesTags: (_r, _e, arg) => ['VendorInvoice', 'VendorInvoiceStats', 'IncomingQc', 'FmsTasks', { type: 'VendorInvoice', id: deleteArgs(arg).id }],
    }),
    approveVendorInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vendor-invoices/${id}/approve`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['VendorInvoice', 'VendorInvoiceStats', { type: 'VendorInvoice', id }],
    }),
    rejectVendorInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vendor-invoices/${id}/reject`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['VendorInvoice', 'VendorInvoiceStats', { type: 'VendorInvoice', id }],
    }),

    // ── Vouchers (Step 1.11) ─────────────────────────────────
    getVouchers: builder.query({
      query: (params = {}) => ({ url: '/procurement/vouchers', params }),
      providesTags: ['Voucher'],
    }),
    getVoucherStats: builder.query({
      query: () => '/procurement/vouchers/stats',
      providesTags: ['VoucherStats'],
    }),
    getVoucherById: builder.query({
      query: (id) => `/procurement/vouchers/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Voucher', id }],
    }),
    getVouchersByInvoice: builder.query({
      query: (invoiceId) => `/procurement/vouchers/by-invoice/${invoiceId}`,
      providesTags: (_r, _e, invoiceId) => [{ type: 'Voucher', id: `inv-${invoiceId}` }, 'Voucher'],
    }),
    // PO / GRN an expense voucher can be raised against right now ({ type: 'PO' | 'GRN' }).
    getVoucherExpenseLinks: builder.query({
      query: (params) => ({ url: '/procurement/vouchers/expense-links', params }),
      providesTags: ['Voucher', 'PurchaseOrder', 'Grn', 'VendorInvoice'],
    }),
    createVoucher: builder.mutation({
      query: (body) => ({ url: '/procurement/vouchers', method: 'POST', body }),
      invalidatesTags: ['Voucher', 'VoucherStats', 'VendorInvoice'],
    }),
    generateVoucherPdf: builder.mutation({
      query: ({ id }) => ({ url: `/procurement/vouchers/${id}/pdf`, method: 'POST' }),
      invalidatesTags: (_r, _e, { id }) => ['Voucher', { type: 'Voucher', id }],
    }),
    updateVoucher: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vouchers/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Voucher', 'VoucherStats', { type: 'Voucher', id }],
    }),
    deleteVoucher: builder.mutation({
      query: deleteRequest('/procurement/vouchers'),
      invalidatesTags: (_r, _e, arg) => ['Voucher', 'VoucherStats', 'VendorInvoice', 'VendorInvoiceStats', 'FmsTasks', { type: 'Voucher', id: deleteArgs(arg).id }],
    }),
    postVoucher: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vouchers/${id}/post`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Voucher', 'VoucherStats', 'VendorInvoice', 'VendorInvoiceStats', { type: 'Voucher', id }],
    }),
    cancelVoucher: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vouchers/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Voucher', 'VoucherStats', { type: 'Voucher', id }],
    }),

    // ── Tally Entries (Step 1.12) ────────────────────────────
    getTallyEntries: builder.query({
      query: (params = {}) => ({ url: '/procurement/tally-entries', params }),
      providesTags: ['TallyEntry'],
    }),
    getTallyEntryStats: builder.query({
      query: () => '/procurement/tally-entries/stats',
      providesTags: ['TallyEntryStats'],
    }),
    getTallyEntryById: builder.query({
      query: (id) => `/procurement/tally-entries/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'TallyEntry', id }],
    }),
    getTallyEntriesByVoucher: builder.query({
      query: (voucherId) => `/procurement/tally-entries/by-voucher/${voucherId}`,
      providesTags: (_r, _e, voucherId) => [{ type: 'TallyEntry', id: `vou-${voucherId}` }, 'TallyEntry'],
    }),
    createTallyEntry: builder.mutation({
      query: (body) => ({ url: '/procurement/tally-entries', method: 'POST', body }),
      invalidatesTags: ['TallyEntry', 'TallyEntryStats', 'Voucher'],
    }),
    updateTallyEntry: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/tally-entries/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['TallyEntry', 'TallyEntryStats', { type: 'TallyEntry', id }],
    }),
    deleteTallyEntry: builder.mutation({
      query: deleteRequest('/procurement/tally-entries'),
      invalidatesTags: (_r, _e, arg) => ['TallyEntry', 'TallyEntryStats', 'Voucher', 'VoucherStats', 'FmsTasks', { type: 'TallyEntry', id: deleteArgs(arg).id }],
    }),
    completeTallyEntry: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/tally-entries/${id}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['TallyEntry', 'TallyEntryStats', 'Voucher', 'VoucherStats', { type: 'TallyEntry', id }],
    }),
    cancelTallyEntry: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/tally-entries/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['TallyEntry', 'TallyEntryStats', { type: 'TallyEntry', id }],
    }),

    // ── Final Payments (Step 1.13) ───────────────────────────
    getFinalPayments: builder.query({
      query: (params = {}) => ({ url: '/procurement/final-payments', params }),
      providesTags: ['FinalPayment'],
    }),
    getFinalPaymentStats: builder.query({
      query: () => '/procurement/final-payments/stats',
      providesTags: ['FinalPaymentStats'],
    }),
    getFinalPaymentById: builder.query({
      query: (id) => `/procurement/final-payments/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'FinalPayment', id }],
    }),
    getFinalPaymentsByVoucher: builder.query({
      query: (voucherId) => `/procurement/final-payments/by-voucher/${voucherId}`,
      providesTags: (_r, _e, voucherId) => [{ type: 'FinalPayment', id: `vou-${voucherId}` }, 'FinalPayment'],
    }),
    createFinalPayment: builder.mutation({
      query: (body) => ({ url: '/procurement/final-payments', method: 'POST', body }),
      invalidatesTags: ['FinalPayment', 'FinalPaymentStats', 'Voucher', 'VoucherStats', 'VendorInvoice', 'VendorInvoiceStats'],
    }),
    updateFinalPayment: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/final-payments/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['FinalPayment', 'FinalPaymentStats', { type: 'FinalPayment', id }],
    }),
    deleteFinalPayment: builder.mutation({
      query: (id) => ({ url: `/procurement/final-payments/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['FinalPayment', 'FinalPaymentStats', 'Voucher', 'VoucherStats', 'VendorInvoice', 'VendorInvoiceStats', { type: 'FinalPayment', id }],
    }),
    generateFinalPaymentPdf: builder.mutation({
      query: ({ id }) => ({ url: `/procurement/final-payments/${id}/pdf`, method: 'POST' }),
      invalidatesTags: (_r, _e, { id }) => ['FinalPayment', { type: 'FinalPayment', id }],
    }),
    cancelFinalPayment: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/final-payments/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['FinalPayment', 'FinalPaymentStats', 'Voucher', 'VoucherStats', 'VendorInvoice', { type: 'FinalPayment', id }],
    }),

    // ── Digital Approval & Signature (generic engine) ────────
    // documentType is one of GRN | VOUCHER | PROFORMA_INVOICE — the same endpoints
    // work for any future document type the backend registers.
    // MD Approval screen (MD only) — every tracked approval with its
    // document's summary, plus the summary cards and vendor options.
    getMdApprovals: builder.query({
      query: (params = {}) => ({ url: '/approvals', params }),
      providesTags: [{ type: 'Approval', id: 'LIST' }],
    }),
    getApproval: builder.query({
      query: ({ documentType, documentId }) => `/approvals/${documentType}/${documentId}`,
      providesTags: (_r, _e, { documentType, documentId }) => [{ type: 'Approval', id: `${documentType}-${documentId}` }],
    }),
    signDocument: builder.mutation({
      query: ({ documentType, documentId, ...body }) => ({ url: `/approvals/${documentType}/${documentId}/sign`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { documentType, documentId }) => approvalInvalidates(documentType, documentId),
    }),
    replaceSignature: builder.mutation({
      query: ({ documentType, documentId, ...body }) => ({ url: `/approvals/${documentType}/${documentId}/replace`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { documentType, documentId }) => approvalInvalidates(documentType, documentId),
    }),
    removeSignature: builder.mutation({
      query: ({ documentType, documentId, ...body }) => ({ url: `/approvals/${documentType}/${documentId}/remove`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { documentType, documentId }) => approvalInvalidates(documentType, documentId),
    }),

    // ── Rate Change Approvals (PO rate ≠ vendor rate) ────────
    // Requests are raised by saving a PO; approving updates the vendor rate and
    // the PO line together, so it refreshes POs, vendors and pricing too.
    getRateChanges: builder.query({
      query: (params = {}) => ({ url: '/procurement/rate-changes', params }),
      providesTags: [{ type: 'RateChange', id: 'LIST' }],
    }),
    getRateChange: builder.query({
      query: (id) => `/procurement/rate-changes/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'RateChange', id }],
    }),
    getRateChangeHistory: builder.query({
      query: (params = {}) => ({ url: '/procurement/rate-changes/history', params }),
      providesTags: [{ type: 'RateChange', id: 'HISTORY' }],
    }),
    approveRateChange: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/rate-changes/${id}/approve`, method: 'POST', body }),
      invalidatesTags: ['RateChange', 'PurchaseOrder', 'PurchaseOrderStats', 'Vendor', 'Pricing'],
    }),
    rejectRateChange: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/rate-changes/${id}/reject`, method: 'POST', body }),
      invalidatesTags: ['RateChange', 'PurchaseOrder', 'PurchaseOrderStats'],
    }),

    // ── Inventory (shared foundation) ────────────────────────
    getInventoryMovementsByRef: builder.query({
      query: ({ refType, refId }) => `/inventory/movements/by-ref/${refType}/${refId}`,
      providesTags: ['InventoryMovement'],
    }),
  }),
});

export const {
  useGetIndentsQuery,
  useGetMdApprovalsQuery,
  useGetRateChangesQuery,
  useGetRateChangeQuery,
  useGetRateChangeHistoryQuery,
  useApproveRateChangeMutation,
  useRejectRateChangeMutation,
  useGetIndentStatsQuery,
  useGetIndentQuery,
  useCreateIndentMutation,
  useUpdateIndentMutation,
  useDeleteIndentMutation,
  useSubmitIndentMutation,
  useApproveIndentMutation,
  useRejectIndentMutation,
  useBulkApproveIndentsMutation,
  useBulkRejectIndentsMutation,
  useReceiveQuoteMutation,
  useQuoteComparativeMutation,
  useApproveQuotationMutation,
  useGetPurchaseOrdersQuery,
  useGetPurchaseOrderStatsQuery,
  useGetPurchaseOrderQuery,
  useGetAllApprovedItemsQuery,
  useGetStepQueueQuery,
  useSetItemVendorMutation,
  useCreatePurchaseOrderMutation,
  useCreatePurchaseOrderFromItemsMutation,
  usePreviewPurchaseOrderPdfMutation,
  useUpdatePurchaseOrderMutation,
  useUpdatePurchaseOrderTermsMutation,
  useGetPoTermsDefaultsQuery,
  useDeletePurchaseOrderMutation,
  useApprovePurchaseOrderMutation,
  useReleasePurchaseOrderMutation,
  useGeneratePurchaseOrderPdfMutation,
  useBulkReleasePurchaseOrdersMutation,
  useGetPoReleasePreviewMutation,
  useCancelPurchaseOrderMutation,
  useRevisePurchaseOrderMutation,
  useMarkPoPiNotRequiredMutation,
  useGetFollowUpsQuery,
  useGetFollowUpStatsQuery,
  useGetFollowUpByIdQuery,
  useGetFollowUpsByPoQuery,
  useCreateFollowUpMutation,
  useUpdateFollowUpMutation,
  useDeleteFollowUpMutation,
  useMarkFollowUpDoneMutation,
  useRescheduleFollowUpMutation,
  useMarkReadyForGrnMutation,
  useGetProformaInvoicesQuery,
  useGetProformaInvoiceStatsQuery,
  useGetProformaInvoiceByIdQuery,
  useGetProformaInvoicesByPoQuery,
  useCreateProformaInvoiceMutation,
  useUpdateProformaInvoiceMutation,
  useDeleteProformaInvoiceMutation,
  useApproveProformaInvoiceMutation,
  useRejectProformaInvoiceMutation,
  useCancelProformaInvoiceMutation,
  useGetAdvancePaymentsQuery,
  useGetAdvancePaymentStatsQuery,
  useGetAdvancePaymentsByPiQuery,
  useCreateAdvancePaymentMutation,
  useDeleteAdvancePaymentMutation,

  useGetServiceCompletionsQuery,
  useGetServiceCompletionStatsQuery,
  useGetServiceCompletionByIdQuery,
  useUpdateServiceCompletionMutation,
  useCompleteServiceCompletionMutation,
  useCancelServiceCompletionMutation,
  useGetGrnsQuery,
  useGetGrnStatsQuery,
  useGetGrnByIdQuery,
  useGetGrnsByPoQuery,
  useCreateGrnMutation,
  usePreviewGrnPdfMutation,
  useUpdateGrnMutation,
  useDeleteGrnMutation,
  useGetGrnChangeCheckQuery,
  useCorrectGrnMutation,
  useCompleteGrnMutation,
  useCancelGrnMutation,
  useGetInventoryMovementsByRefQuery,
  useGetIncomingQcsQuery,
  useGetIncomingQcStatsQuery,
  useGetIncomingQcByIdQuery,
  useGetIncomingQcsByGrnQuery,
  useCreateIncomingQcMutation,
  useUpdateIncomingQcMutation,
  useDeleteIncomingQcMutation,
  useCompleteIncomingQcMutation,
  useCancelIncomingQcMutation,
  useGetVendorInvoicesQuery,
  useGetVendorInvoiceStatsQuery,
  useGetVendorInvoiceByIdQuery,
  useGetVendorInvoicesByQcQuery,
  useGetInvoiceableQcsQuery,
  useGetInvoiceableGrnsQuery,
  useGetInvoiceAdvancePositionQuery,
  useCreateVendorInvoiceMutation,
  useUpdateVendorInvoiceMutation,
  useDeleteVendorInvoiceMutation,
  useApproveVendorInvoiceMutation,
  useRejectVendorInvoiceMutation,
  useGetVouchersQuery,
  useGetVoucherStatsQuery,
  useGetVoucherByIdQuery,
  useGetVouchersByInvoiceQuery,
  useGetVoucherExpenseLinksQuery,
  useCreateVoucherMutation,
  useGenerateVoucherPdfMutation,
  useUpdateVoucherMutation,
  useDeleteVoucherMutation,
  usePostVoucherMutation,
  useCancelVoucherMutation,
  useGetTallyEntriesQuery,
  useGetTallyEntryStatsQuery,
  useGetTallyEntryByIdQuery,
  useGetTallyEntriesByVoucherQuery,
  useCreateTallyEntryMutation,
  useUpdateTallyEntryMutation,
  useDeleteTallyEntryMutation,
  useCompleteTallyEntryMutation,
  useCancelTallyEntryMutation,
  useGetFinalPaymentsQuery,
  useGetFinalPaymentStatsQuery,
  useGetFinalPaymentByIdQuery,
  useGetFinalPaymentsByVoucherQuery,
  useCreateFinalPaymentMutation,
  useUpdateFinalPaymentMutation,
  useDeleteFinalPaymentMutation,
  useGenerateFinalPaymentPdfMutation,
  useCancelFinalPaymentMutation,

  useGetApprovalQuery,
  useSignDocumentMutation,
  useReplaceSignatureMutation,
  useRemoveSignatureMutation,
} = procurementApi;
