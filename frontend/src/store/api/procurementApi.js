import { baseApi } from './baseApi';

/**
 * Purchase FMS — Procurement API.
 * Module 1: Purchase Indents.  Base: /api/v1/procurement/indents
 */

// Maps a Digital Approval documentType to the RTK tag its parent doc already
// uses, so signing/replacing/removing a signature also refreshes the GRN/
// Voucher detail query that mirrors approvalStatus — same invalidation
// convention used everywhere else in this file.
const APPROVAL_PARENT_TAG = { GRN: 'Grn', VOUCHER: 'Voucher' };
const approvalInvalidates = (documentType, documentId) => {
  const parentTag = APPROVAL_PARENT_TAG[documentType];
  return [
    { type: 'Approval', id: `${documentType}-${documentId}` },
    ...(parentTag ? [parentTag, { type: parentTag, id: documentId }] : []),
  ];
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
      query: (id) => ({ url: `/procurement/indents/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['Indent', 'IndentStats', { type: 'Indent', id }],
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
    createPurchaseOrder: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders', method: 'POST', body }),
      invalidatesTags: ['PurchaseOrder', 'PurchaseOrderStats', 'Indent', 'IndentStats'],
    }),
    // New PO form item-picker → one vendor, hand-picked approved items.
    createPurchaseOrderFromItems: builder.mutation({
      query: (body) => ({ url: '/procurement/purchase-orders/create-from-items', method: 'POST', body }),
      invalidatesTags: ['PurchaseOrder', 'PurchaseOrderStats', 'Indent', 'IndentStats'],
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
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
    }),
    deletePurchaseOrder: builder.mutation({
      query: (id) => ({ url: `/procurement/purchase-orders/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['PurchaseOrder', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
    }),
    approvePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/approve`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', { type: 'PurchaseOrder', id }],
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
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', 'Indent', 'IndentStats', { type: 'PurchaseOrder', id }],
    }),
    // Revise a cancelled PO → new draft PO (copied data, new number, linked back).
    revisePurchaseOrder: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/purchase-orders/${id}/revise`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['PurchaseOrder', 'PurchaseOrderStats', 'Indent', 'IndentStats', { type: 'PurchaseOrder', id }],
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
      query: (id) => ({ url: `/procurement/follow-ups/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['FollowUp', 'FollowUpStats', { type: 'FollowUp', id }],
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
      query: (id) => ({ url: `/procurement/proforma-invoices/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['ProformaInvoice', 'ProformaInvoiceStats', { type: 'ProformaInvoice', id }],
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
    deleteGrn: builder.mutation({
      query: (id) => ({ url: `/procurement/grns/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['Grn', 'GrnStats', { type: 'Grn', id }],
    }),
    completeGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}/complete`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', 'PurchaseOrder', 'PurchaseOrderStats', 'ProformaInvoice', 'InventoryStock', 'InventoryMovement', { type: 'Grn', id }],
    }),
    cancelGrn: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/grns/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Grn', 'GrnStats', { type: 'Grn', id }],
    }),

    // ── Service Completions (Step 1.8A — internal-service indents) ──
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
    createServiceCompletion: builder.mutation({
      query: (body) => ({ url: '/procurement/service-completions', method: 'POST', body }),
      invalidatesTags: ['ServiceCompletion', 'ServiceCompletionStats', 'Indent', 'IndentStats'],
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
      invalidatesTags: (_r, _e, { id }) => ['IncomingQc', 'IncomingQcStats', 'Grn', 'GrnStats', 'InventoryStock', 'InventoryMovement', 'ServiceCompletion', 'ServiceCompletionStats', 'Indent', 'IndentStats', { type: 'IncomingQc', id }],
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
    createVendorInvoice: builder.mutation({
      query: (body) => ({ url: '/procurement/vendor-invoices', method: 'POST', body }),
      invalidatesTags: ['VendorInvoice', 'VendorInvoiceStats'],
    }),
    updateVendorInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/procurement/vendor-invoices/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['VendorInvoice', 'VendorInvoiceStats', { type: 'VendorInvoice', id }],
    }),
    deleteVendorInvoice: builder.mutation({
      query: (id) => ({ url: `/procurement/vendor-invoices/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['VendorInvoice', 'VendorInvoiceStats', { type: 'VendorInvoice', id }],
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
      query: (id) => ({ url: `/procurement/vouchers/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['Voucher', 'VoucherStats', { type: 'Voucher', id }],
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
      query: (id) => ({ url: `/procurement/tally-entries/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => ['TallyEntry', 'TallyEntryStats', { type: 'TallyEntry', id }],
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
    // documentType is one of GRN | VOUCHER (today) — the same 4 endpoints
    // work for any future document type the backend registers.
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

    // ── Inventory (shared foundation) ────────────────────────
    getInventoryMovementsByRef: builder.query({
      query: ({ refType, refId }) => `/inventory/movements/by-ref/${refType}/${refId}`,
      providesTags: ['InventoryMovement'],
    }),
  }),
});

export const {
  useGetIndentsQuery,
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
  useCreatePurchaseOrderMutation,
  useCreatePurchaseOrderFromItemsMutation,
  usePreviewPurchaseOrderPdfMutation,
  useUpdatePurchaseOrderMutation,
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
  useCreateServiceCompletionMutation,
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
  useCreateVendorInvoiceMutation,
  useUpdateVendorInvoiceMutation,
  useDeleteVendorInvoiceMutation,
  useApproveVendorInvoiceMutation,
  useRejectVendorInvoiceMutation,
  useGetVouchersQuery,
  useGetVoucherStatsQuery,
  useGetVoucherByIdQuery,
  useGetVouchersByInvoiceQuery,
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
