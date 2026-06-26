import { baseApi } from './baseApi';

/**
 * RM IMS — Raw Material (Coil + Circle) inventory.  Base: /api/v1/rm-ims
 * Built on the shared inventory engine (Purchase→GRN→QC receipts flow into the
 * same stock, so bought raw material shows up here automatically).
 */
export const rmImsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getRmOverview: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/overview', params }),
      providesTags: ['RmOverview'],
    }),
    getRmDashboard: builder.query({
      query: () => '/rm-ims/dashboard',
      providesTags: ['RmDashboard'],
    }),
    getRmReorder: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/reorder', params }),
      providesTags: ['RmOverview'],
    }),
    getRmForecast: builder.query({
      query: ({ skuId, days = 30 }) => ({ url: `/rm-ims/forecast/${skuId}`, params: { days } }),
      providesTags: (_r, _e, { skuId }) => [{ type: 'RmOverview', id: skuId }],
    }),
    getRmPolicy: builder.query({
      query: (skuId) => `/rm-ims/policy/${skuId}`,
      providesTags: (_r, _e, skuId) => [{ type: 'RmPolicy', id: skuId }],
    }),
    getRmMovements: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/movements', params }),
      providesTags: ['RmMovement'],
    }),
    getRmConversions: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/conversions', params }),
      providesTags: ['RmConversion'],
    }),
    upsertRmPolicy: builder.mutation({
      query: ({ skuId, ...body }) => ({ url: `/rm-ims/policy/${skuId}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { skuId }) => ['RmOverview', 'RmDashboard', { type: 'RmPolicy', id: skuId }],
    }),
    rmReceive: builder.mutation({
      query: (body) => ({ url: '/rm-ims/receive', method: 'POST', body }),
      invalidatesTags: ['RmOverview', 'RmDashboard', 'RmMovement', 'InventoryStock', 'InventoryMovement'],
    }),
    rmIssue: builder.mutation({
      query: (body) => ({ url: '/rm-ims/issue', method: 'POST', body }),
      invalidatesTags: ['RmOverview', 'RmDashboard', 'RmMovement', 'InventoryStock', 'InventoryMovement'],
    }),
    rmConvert: builder.mutation({
      query: (body) => ({ url: '/rm-ims/convert', method: 'POST', body }),
      invalidatesTags: ['RmOverview', 'RmDashboard', 'RmMovement', 'RmConversion', 'InventoryStock', 'InventoryMovement'],
    }),
  }),
});

export const {
  useGetRmOverviewQuery,
  useGetRmDashboardQuery,
  useGetRmReorderQuery,
  useGetRmForecastQuery,
  useGetRmPolicyQuery,
  useGetRmMovementsQuery,
  useGetRmConversionsQuery,
  useUpsertRmPolicyMutation,
  useRmReceiveMutation,
  useRmIssueMutation,
  useRmConvertMutation,
} = rmImsApi;
