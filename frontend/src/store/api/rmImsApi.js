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
    getRmItemDetail: builder.query({
      query: (skuId) => `/rm-ims/item/${skuId}`,
      providesTags: (_r, _e, skuId) => [{ type: 'RmOverview', id: skuId }],
    }),
    getRmStockHistory: builder.query({
      query: ({ skuId, from, to }) => ({ url: `/rm-ims/history/${skuId}`, params: { from, to } }),
      providesTags: (_r, _e, { skuId }) => [{ type: 'RmMovement', id: skuId }],
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
    /**
     * The physical coils on the floor, for the Cut Coils picker.
     *
     * Tagged RmMovement because that is literally what it reads: a coil's
     * remaining weight is derived from its movements, so a conversion — which
     * invalidates RmMovement — must make this list recount.
     */
    getRmReceivedCoils: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/received-coils', params }),
      providesTags: ['RmMovement'],
    }),
    /**
     * One physical coil's whole cutting history — every round, in order.
     *
     * Tagged with BOTH ledger tags because that is what it is derived from: the
     * rounds come from the conversions and the remaining weight from the
     * movements, so a cut anywhere must make this recount. Nothing is cached
     * server-side, so a stale page here is purely an RTK Query concern.
     */
    getRmCoilLineage: builder.query({
      query: (receiptId) => `/rm-ims/coil/${receiptId}/lineage`,
      providesTags: (_r, _e, receiptId) => [
        { type: 'RmConversion', id: receiptId }, 'RmMovement',
      ],
    }),
    /**
     * Cutting History — one row per physical coil, under the Cut Coils form.
     *
     * Tagged like the lineage it summarises: a cut invalidates RmConversion and
     * RmMovement, so a saved round shows up here (rounds +1, remaining down,
     * status recomputed) without a reload.
     */
    getRmCuttingHistory: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/cutting-history', params }),
      providesTags: ['RmConversion', 'RmMovement'],
    }),
    /**
     * The Coil to Circle page's one table — every recorded cut: a row per
     * physical coil (its rounds on expand) and a row per cut that names no
     * coil. Tagged like the history: a cut changes both its rows and the
     * coil's remaining weight.
     */
    getRmConversionLedger: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/conversion-ledger', params }),
      providesTags: ['RmConversion', 'RmMovement'],
    }),
    /**
     * The circle SKUs the Cutting History's rounds actually produced — the
     * options of its "Circle SKU" filter. A new cut can add a size, so it is
     * tagged like the history itself.
     */
    getRmCuttingHistoryCircles: builder.query({
      // `{ scope: 'all' }` — every recorded cut's circles (All conversions).
      query: (params) => ({ url: '/rm-ims/cutting-history/circles', params: params || undefined }),
      providesTags: ['RmConversion'],
    }),
    /**
     * The circle sizes the identified coil is approved to produce.
     *
     * The client's mapping lives on the server and is asked for per coil, so
     * this screen holds no copy of it — a copy here would be the one thing that
     * still said "8.25 inch" the day the client dropped that size.
     *
     * Tagged RmOverview because it reads the SKU master, not the ledger: the
     * answer changes when a circle SKU is added or deactivated, and NOT when a
     * coil is cut. So cutting a coil does not refetch it.
     */
    /**
     * Manual Entry — No GRN: what a typed batch number already names — a
     * manual coil to continue (data), or a goods receipt that must be cut from
     * its GRN instead (meta.grnReceipt). Tagged like the lineage: a saved round
     * changes the manual coil's remaining weight.
     */
    lookupRmManualCoil: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/manual-coils/lookup', params }),
      providesTags: ['RmConversion', 'RmMovement'],
    }),
    getRmCircleOptions: builder.query({
      query: (params = {}) => ({ url: '/rm-ims/circle-options', params }),
      providesTags: ['RmOverview'],
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
      // A cut also writes a scrap record, and an in-house cut moves scrap
      // stock, so every scrap screen is stale the moment this succeeds.
      invalidatesTags: [
        'RmOverview', 'RmDashboard', 'RmMovement', 'RmConversion',
        'InventoryStock', 'InventoryMovement',
        'ScrapOverview', 'ScrapDashboard', 'ScrapStock', 'ScrapMovement',
      ],
    }),
  }),
});

export const {
  useGetRmOverviewQuery,
  useGetRmDashboardQuery,
  useGetRmReorderQuery,
  useGetRmItemDetailQuery,
  useGetRmStockHistoryQuery,
  useGetRmForecastQuery,
  useGetRmPolicyQuery,
  useGetRmMovementsQuery,
  useGetRmConversionsQuery,
  useGetRmReceivedCoilsQuery,
  useGetRmCoilLineageQuery,
  useGetRmCuttingHistoryQuery,
  useGetRmCuttingHistoryCirclesQuery,
  useGetRmConversionLedgerQuery,
  useGetRmCircleOptionsQuery,
  useLookupRmManualCoilQuery,
  useUpsertRmPolicyMutation,
  useRmReceiveMutation,
  useRmIssueMutation,
  useRmConvertMutation,
} = rmImsApi;
