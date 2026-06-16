import { baseApi } from './baseApi';

// O2D post-dispatch step entries (2.9–2.13). Backend base: /o2d-fulfillment
export const o2dFulfillmentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    trackDelivery: builder.mutation({         // 2.9
      query: (body) => ({ url: '/o2d-fulfillment/track-delivery', method: 'POST', body }),
      invalidatesTags: ['Challan'],
    }),
    paymentFollowUp: builder.mutation({       // 2.10
      query: (body) => ({ url: '/o2d-fulfillment/payment-followup', method: 'POST', body }),
      invalidatesTags: ['Payment', 'SalesInvoice'],
    }),
    paymentReceipt: builder.mutation({        // 2.11
      query: (body) => ({ url: '/o2d-fulfillment/payment-receipt', method: 'POST', body }),
      invalidatesTags: ['Payment', 'SalesInvoice'],
    }),
    transportBillReceive: builder.mutation({  // 2.12
      query: (body) => ({ url: '/o2d-fulfillment/transport-bill-receive', method: 'POST', body }),
      invalidatesTags: ['TransportBill'],
    }),
    transportBillPayment: builder.mutation({  // 2.13
      query: (body) => ({ url: '/o2d-fulfillment/transport-bill-payment', method: 'POST', body }),
      invalidatesTags: ['TransportBill'],
    }),
  }),
});

export const {
  useTrackDeliveryMutation,
  usePaymentFollowUpMutation,
  usePaymentReceiptMutation,
  useTransportBillReceiveMutation,
  useTransportBillPaymentMutation,
} = o2dFulfillmentApi;
