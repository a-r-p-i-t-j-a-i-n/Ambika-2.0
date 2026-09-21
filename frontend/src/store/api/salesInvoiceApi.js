import { baseApi } from './baseApi';

// Sales invoices for O2D Step 2.7 (Create Invoice & Eway Bill) + 2.8 (email).
// Backend base: /sales-invoices
export const salesInvoiceApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSalesInvoices: builder.query({
      query: (params) => ({ url: '/sales-invoices', params }),
      providesTags: ['SalesInvoice'],
    }),
    getSalesInvoice: builder.query({
      query: (id) => `/sales-invoices/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'SalesInvoice', id }],
    }),
    // Creating / updating / emailing an invoice changes a challan's downstream state
    // (invoiced / emailed), so refresh the O2D consignment ledger + My Tasks too —
    // otherwise the tracker shows a stale "Pending / Not done" for that consignment.
    createSalesInvoice: builder.mutation({
      query: (body) => ({ url: '/sales-invoices', method: 'POST', body }),
      invalidatesTags: ['SalesInvoice', 'O2DProcess', 'O2DMyTasks'],
    }),
    updateSalesInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/sales-invoices/${id}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { id }) => ['SalesInvoice', { type: 'SalesInvoice', id }, 'O2DProcess', 'O2DMyTasks'],
    }),
    sendSalesInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/sales-invoices/${id}/send`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['SalesInvoice', { type: 'SalesInvoice', id }, 'O2DProcess', 'O2DMyTasks'],
    }),
    // Bulk step 2.08 — drafts built server-side so preview == what is sent.
    bulkInvoiceEmailPreview: builder.mutation({
      query: (body) => ({ url: '/sales-invoices/bulk-email-preview', method: 'POST', body }),
    }),
    bulkInvoiceEmail: builder.mutation({
      query: (body) => ({ url: '/sales-invoices/bulk-email', method: 'POST', body }),
      invalidatesTags: ['SalesInvoice', 'O2DProcess', 'O2DMyTasks'],
    }),
  }),
});

export const {
  useGetSalesInvoicesQuery,
  useGetSalesInvoiceQuery,
  useCreateSalesInvoiceMutation,
  useBulkInvoiceEmailPreviewMutation,
  useBulkInvoiceEmailMutation,
  useUpdateSalesInvoiceMutation,
  useSendSalesInvoiceMutation,
} = salesInvoiceApi;
