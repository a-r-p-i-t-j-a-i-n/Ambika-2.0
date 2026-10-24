import { baseApi } from './baseApi';

/**
 * FG IMS — Finished Goods Inventory.  Base: /api/v1/fg-ims
 * Built on the shared inventory stock engine. Stock rises via Production In
 * (Daily Production Report) and falls via Dispatch Out. Standalone for now —
 * not yet auto-wired to the Dispatch / DPR modules.
 */
export const fgImsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getFgOverview: builder.query({
      query: (params = {}) => ({ url: '/fg-ims/overview', params }),
      providesTags: ['FgOverview'],
    }),
    getFgDashboard: builder.query({
      query: () => '/fg-ims/dashboard',
      providesTags: ['FgDashboard'],
    }),
    getFgReplenish: builder.query({
      query: (params = {}) => ({ url: '/fg-ims/replenish', params }),
      providesTags: ['FgOverview'],
    }),
    getFgForecast: builder.query({
      query: ({ skuId, days = 30 }) => ({ url: `/fg-ims/forecast/${skuId}`, params: { days } }),
      providesTags: (_r, _e, { skuId }) => [{ type: 'FgOverview', id: skuId }],
    }),
    getFgHistory: builder.query({
      query: ({ skuId, ...params }) => ({ url: `/fg-ims/history/${skuId}`, params }),
      providesTags: (_r, _e, { skuId }) => ['FgMovement', { type: 'FgOverview', id: skuId }],
    }),
    getFgPolicy: builder.query({
      query: (skuId) => `/fg-ims/policy/${skuId}`,
      providesTags: (_r, _e, skuId) => [{ type: 'FgPolicy', id: skuId }],
    }),
    // One item's history, newest first, with its in/out totals.
    getFgItemLedger: builder.query({
      query: ({ skuId, ...params }) => ({ url: `/fg-ims/ledger/${skuId}`, params }),
      providesTags: ['FgMovement'],
    }),
    getFgMovements: builder.query({
      query: (params = {}) => ({ url: '/fg-ims/movements', params }),
      providesTags: ['FgMovement'],
    }),
    upsertFgPolicy: builder.mutation({
      query: ({ skuId, ...body }) => ({ url: `/fg-ims/policy/${skuId}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { skuId }) => ['FgOverview', 'FgDashboard', { type: 'FgPolicy', id: skuId }],
    }),
    fgProduce: builder.mutation({
      query: (body) => ({ url: '/fg-ims/produce', method: 'POST', body }),
      invalidatesTags: ['FgOverview', 'FgDashboard', 'FgMovement', 'InventoryStock', 'InventoryMovement'],
    }),
    fgDispatch: builder.mutation({
      query: (body) => ({ url: '/fg-ims/dispatch', method: 'POST', body }),
      invalidatesTags: ['FgOverview', 'FgDashboard', 'FgMovement', 'InventoryStock', 'InventoryMovement'],
    }),
  }),
});

export const {
  useGetFgOverviewQuery,
  useGetFgDashboardQuery,
  useGetFgReplenishQuery,
  useGetFgForecastQuery,
  useGetFgHistoryQuery,
  useGetFgPolicyQuery,
  useGetFgMovementsQuery,
  useGetFgItemLedgerQuery,
  useUpsertFgPolicyMutation,
  useFgProduceMutation,
  useFgDispatchMutation,
} = fgImsApi;
