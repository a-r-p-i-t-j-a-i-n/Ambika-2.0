import { baseApi } from './baseApi';

/**
 * DPR / OEE API — the shop-floor Daily Production Report + its dashboards.
 * Base: /api/v1/dpr. Every response is the standard { success, message, data,
 * meta } envelope, so components read `res.data` (and `res.meta` for the
 * register's pagination + roll-up summary).
 */
export const dprApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── Form dropdown data ────────────────────────────────────────────────
    getDprOptions: builder.query({
      query: () => '/dpr/options',
      providesTags: ['DprMaster'],
    }),
    getDprOperations: builder.query({
      query: (skuCode) => ({ url: '/dpr/operations', params: { skuCode } }),
    }),
    getDprDies: builder.query({
      query: ({ skuCode, operationDesc }) => ({ url: '/dpr/dies', params: { skuCode, operationDesc } }),
    }),

    // ── DPR entries ───────────────────────────────────────────────────────
    getDprEntries: builder.query({
      query: (params = {}) => ({ url: '/dpr/entries', params }),
      providesTags: ['Dpr'],
    }),
    getDprEntry: builder.query({
      query: (id) => `/dpr/entries/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Dpr', id }],
    }),
    createDprEntry: builder.mutation({
      query: (body) => ({ url: '/dpr/entries', method: 'POST', body }),
      invalidatesTags: ['Dpr', 'DprBoard'],
    }),
    updateDprEntry: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/dpr/entries/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Dpr', 'DprBoard', { type: 'Dpr', id }],
    }),
    deleteDprEntry: builder.mutation({
      query: (id) => ({ url: `/dpr/entries/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Dpr', 'DprBoard'],
    }),

    // ── Dashboards ────────────────────────────────────────────────────────
    getMachineDashboard: builder.query({
      query: (params = {}) => ({ url: '/dpr/dashboard/machine', params }),
      providesTags: ['DprBoard'],
    }),
    getProductionDashboard: builder.query({
      query: (params = {}) => ({ url: '/dpr/dashboard/production', params }),
      providesTags: ['DprBoard'],
    }),
    getOperatorDashboard: builder.query({
      query: (params = {}) => ({ url: '/dpr/dashboard/operator', params }),
      providesTags: ['DprBoard'],
    }),
    getMisScoring: builder.query({
      query: (params = {}) => ({ url: '/dpr/dashboard/mis', params }),
      providesTags: ['DprBoard'],
    }),

    // ── Masters management ────────────────────────────────────────────────
    getMasterStats: builder.query({
      query: () => '/dpr/masters/stats',
      providesTags: ['DprMaster'],
    }),
    getMasterList: builder.query({
      query: ({ kind, ...params }) => ({ url: `/dpr/masters/${kind}`, params }),
      providesTags: ['DprMaster'],
    }),
    createMaster: builder.mutation({
      query: ({ kind, ...body }) => ({ url: `/dpr/masters/${kind}`, method: 'POST', body }),
      invalidatesTags: ['DprMaster'],
    }),
    updateMaster: builder.mutation({
      query: ({ kind, id, ...body }) => ({ url: `/dpr/masters/${kind}/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['DprMaster'],
    }),
    deleteMaster: builder.mutation({
      query: ({ kind, id }) => ({ url: `/dpr/masters/${kind}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['DprMaster'],
    }),
  }),
});

export const {
  useGetDprOptionsQuery,
  useLazyGetDprOperationsQuery,
  useGetDprOperationsQuery,
  useLazyGetDprDiesQuery,
  useGetDprDiesQuery,
  useGetDprEntriesQuery,
  useGetDprEntryQuery,
  useCreateDprEntryMutation,
  useUpdateDprEntryMutation,
  useDeleteDprEntryMutation,
  useGetMachineDashboardQuery,
  useGetProductionDashboardQuery,
  useGetOperatorDashboardQuery,
  useGetMisScoringQuery,
  useGetMasterStatsQuery,
  useGetMasterListQuery,
  useCreateMasterMutation,
  useUpdateMasterMutation,
  useDeleteMasterMutation,
} = dprApi;
