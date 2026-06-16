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
    createSalesInvoice: builder.mutation({
      query: (body) => ({ url: '/sales-invoices', method: 'POST', body }),
      invalidatesTags: ['SalesInvoice'],
    }),
    updateSalesInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/sales-invoices/${id}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { id }) => ['SalesInvoice', { type: 'SalesInvoice', id }],
    }),
    sendSalesInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/sales-invoices/${id}/send`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['SalesInvoice', { type: 'SalesInvoice', id }],
    }),
  }),
});

export const {
  useGetSalesInvoicesQuery,
  useGetSalesInvoiceQuery,
  useCreateSalesInvoiceMutation,
  useUpdateSalesInvoiceMutation,
  useSendSalesInvoiceMutation,
} = salesInvoiceApi;
