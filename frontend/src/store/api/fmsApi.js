import { baseApi } from './baseApi';

export const fmsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Invoices
    getInvoices: builder.query({
      query: (params) => ({ url: '/fms/invoices', params }),
      providesTags: ['Invoice'],
    }),
    getInvoice: builder.query({
      query: (id) => `/fms/invoices/${id}`,
      providesTags: (result, error, id) => [{ type: 'Invoice', id }],
    }),
    createInvoice: builder.mutation({
      query: (body) => ({ url: '/fms/invoices', method: 'POST', body }),
      invalidatesTags: ['Invoice'],
    }),
    updateInvoice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/fms/invoices/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => ['Invoice', { type: 'Invoice', id }],
    }),

    // Shipments
    getShipments: builder.query({
      query: (params) => ({ url: '/fms/shipments', params }),
      providesTags: ['Shipment'],
    }),
    getShipment: builder.query({
      query: (id) => `/fms/shipments/${id}`,
      providesTags: (result, error, id) => [{ type: 'Shipment', id }],
    }),
    createShipment: builder.mutation({
      query: (body) => ({ url: '/fms/shipments', method: 'POST', body }),
      invalidatesTags: ['Shipment', 'Invoice'],
    }),
    updateShipment: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/fms/shipments/${id}`, method: 'PUT', body }),
      invalidatesTags: (result, error, { id }) => ['Shipment', { type: 'Shipment', id }],
    }),

    // Payments
    getPayments: builder.query({
      query: (params) => ({ url: '/fms/payments', params }),
      providesTags: ['Payment'],
    }),
    createPayment: builder.mutation({
      query: (body) => ({ url: '/fms/payments', method: 'POST', body }),
      invalidatesTags: ['Payment', 'Invoice'],
    }),
    updatePayment: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/fms/payments/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Payment', 'Invoice'],
    }),

    // Transport Bills
    getTransportBills: builder.query({
      query: (params) => ({ url: '/fms/transport-bills', params }),
      providesTags: ['TransportBill'],
    }),
    updateTransportBill: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/fms/transport-bills/${id}`, method: 'PUT', body }),
      invalidatesTags: ['TransportBill'],
    }),
  }),
});

export const {
  useGetInvoicesQuery,
  useGetInvoiceQuery,
  useCreateInvoiceMutation,
  useUpdateInvoiceMutation,
  useGetShipmentsQuery,
  useGetShipmentQuery,
  useCreateShipmentMutation,
  useUpdateShipmentMutation,
  useGetPaymentsQuery,
  useCreatePaymentMutation,
  useUpdatePaymentMutation,
  useGetTransportBillsQuery,
  useUpdateTransportBillMutation,
} = fmsApi;
