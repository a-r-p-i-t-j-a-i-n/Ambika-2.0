import { baseApi } from './baseApi';

/**
 * IMS — Packaging & Consumables Inventory.  Base: /api/v1/ims
 * Built on the shared inventory stock engine (GRN receipts already flow into the
 * same stock, so purchases show up here automatically).
 */
export const imsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getImsOverview: builder.query({
      query: (params = {}) => ({ url: '/ims/overview', params }),
      providesTags: ['ImsOverview'],
    }),
    getImsDashboard: builder.query({
      query: () => '/ims/dashboard',
      providesTags: ['ImsDashboard'],
    }),
    getImsReorder: builder.query({
      query: (params = {}) => ({ url: '/ims/reorder', params }),
      providesTags: ['ImsOverview'],
    }),
    getImsForecast: builder.query({
      query: ({ skuId, days = 30 }) => ({ url: `/ims/forecast/${skuId}`, params: { days } }),
      providesTags: (_r, _e, { skuId }) => [{ type: 'ImsOverview', id: skuId }],
    }),
    getImsHistory: builder.query({
      query: ({ skuId, ...params }) => ({ url: `/ims/history/${skuId}`, params }),
      providesTags: (_r, _e, { skuId }) => ['ImsMovement', { type: 'ImsOverview', id: skuId }],
    }),
    getImsPolicy: builder.query({
      query: (skuId) => `/ims/policy/${skuId}`,
      providesTags: (_r, _e, skuId) => [{ type: 'ImsPolicy', id: skuId }],
    }),
    getImsMovements: builder.query({
      query: (params = {}) => ({ url: '/ims/movements', params }),
      providesTags: ['ImsMovement'],
    }),
    // One item's history, newest first, with its in/out totals.
    getImsItemLedger: builder.query({
      query: ({ skuId, ...params }) => ({ url: `/ims/ledger/${skuId}`, params }),
      providesTags: ['ImsMovement'],
    }),
    upsertImsPolicy: builder.mutation({
      query: ({ skuId, ...body }) => ({ url: `/ims/policy/${skuId}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { skuId }) => ['ImsOverview', 'ImsDashboard', { type: 'ImsPolicy', id: skuId }],
    }),
    imsReceive: builder.mutation({
      query: (body) => ({ url: '/ims/receive', method: 'POST', body }),
      invalidatesTags: ['ImsOverview', 'ImsDashboard', 'ImsMovement', 'InventoryStock', 'InventoryMovement'],
    }),
    imsIssue: builder.mutation({
      query: (body) => ({ url: '/ims/issue', method: 'POST', body }),
      invalidatesTags: ['ImsOverview', 'ImsDashboard', 'ImsMovement', 'InventoryStock', 'InventoryMovement'],
    }),
  }),
});

export const {
  useGetImsOverviewQuery,
  useGetImsDashboardQuery,
  useGetImsReorderQuery,
  useGetImsForecastQuery,
  useGetImsHistoryQuery,
  useGetImsPolicyQuery,
  useGetImsMovementsQuery,
  useGetImsItemLedgerQuery,
  useUpsertImsPolicyMutation,
  useImsReceiveMutation,
  useImsIssueMutation,
} = imsApi;
