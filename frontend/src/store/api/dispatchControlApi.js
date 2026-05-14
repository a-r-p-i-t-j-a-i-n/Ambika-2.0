import { baseApi } from './baseApi';

export const dispatchControlApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDispatchDashboard: builder.query({
      query: (params) => ({ url: '/dispatch-control/dashboard', params }),
      providesTags: ['DispatchDashboard'],
    }),
    createOrderEntry: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/order-entry', method: 'POST', body }),
      invalidatesTags: ['Order', 'DispatchDashboard', 'Party'],
    }),
    createDispatchPlan: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/dispatch-plans', method: 'POST', body }),
      invalidatesTags: ['Order', 'PPC', 'Comparison', 'DispatchDashboard'],
    }),
    createActualDispatch: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/actual-dispatches', method: 'POST', body }),
      invalidatesTags: ['Order', 'Challan', 'PPC', 'Comparison', 'DispatchDashboard'],
    }),
    getOrderComparison: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/comparison`,
      providesTags: (result, error, soNumber) => [{ type: 'Comparison', id: soNumber }],
    }),
    getOrderSummary: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/summary`,
      providesTags: (result, error, soNumber) => [{ type: 'Comparison', id: soNumber }],
    }),
    normalizeSheetRows: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/sheet-rows/normalize', method: 'POST', body }),
    }),
    getChallans: builder.query({
      query: (params) => ({ url: '/challans', params }),
      providesTags: ['Challan'],
    }),
  }),
});

export const {
  useGetDispatchDashboardQuery,
  useCreateOrderEntryMutation,
  useCreateDispatchPlanMutation,
  useCreateActualDispatchMutation,
  useGetOrderComparisonQuery,
  useGetOrderSummaryQuery,
  useNormalizeSheetRowsMutation,
  useGetChallansQuery,
} = dispatchControlApi;
