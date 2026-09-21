import { baseApi } from './baseApi';

// O2D post-dispatch step entries (2.9–2.13). Backend base: /o2d-fulfillment
// Every mutation here also invalidates O2DProcess/O2DMyTasks: these forms are the
// connected action for steps 2.09-2.13, and the task the doer returns to reads its
// done-state from the process + per-challan ledger. Without it the step still says
// "Not done for this consignment yet" after the work was saved.
export const o2dFulfillmentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPayments: builder.query({
      query: () => '/o2d-fulfillment/payments',
      providesTags: ['Payment'],
    }),
    getTransportBills: builder.query({
      query: () => '/o2d-fulfillment/transport-bills',
      providesTags: ['TransportBill'],
    }),
    trackDelivery: builder.mutation({         // 2.9
      query: (body) => ({ url: '/o2d-fulfillment/track-delivery', method: 'POST', body }),
      invalidatesTags: ['Challan', 'O2DProcess', 'O2DMyTasks'],
    }),
    paymentFollowUp: builder.mutation({       // 2.10
      query: (body) => ({ url: '/o2d-fulfillment/payment-followup', method: 'POST', body }),
      invalidatesTags: ['Payment', 'SalesInvoice', 'O2DProcess', 'O2DMyTasks'],
    }),
    paymentReceipt: builder.mutation({        // 2.11
      query: (body) => ({ url: '/o2d-fulfillment/payment-receipt', method: 'POST', body }),
      invalidatesTags: ['Payment', 'SalesInvoice', 'O2DProcess', 'O2DMyTasks'],
    }),
    transportBillReceive: builder.mutation({  // 2.12
      query: (body) => ({ url: '/o2d-fulfillment/transport-bill-receive', method: 'POST', body }),
      invalidatesTags: ['TransportBill', 'O2DProcess', 'O2DMyTasks'],
    }),
    transportBillPayment: builder.mutation({  // 2.13
      query: (body) => ({ url: '/o2d-fulfillment/transport-bill-payment', method: 'POST', body }),
      invalidatesTags: ['TransportBill', 'O2DProcess', 'O2DMyTasks'],
    }),
  }),
});

export const {
  useGetPaymentsQuery,
  useGetTransportBillsQuery,
  useTrackDeliveryMutation,
  usePaymentFollowUpMutation,
  usePaymentReceiptMutation,
  useTransportBillReceiveMutation,
  useTransportBillPaymentMutation,
} = o2dFulfillmentApi;
