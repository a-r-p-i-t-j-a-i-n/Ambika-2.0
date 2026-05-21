import { baseApi } from './baseApi';

export const pricingApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── Master & history ───────────────────────────────────────
    getPriceMaster: builder.query({
      query: (params = {}) => ({ url: '/pricing/master', params }),
      providesTags: ['Pricing'],
    }),
    getSkuPriceHistory: builder.query({
      query: ({ skuId, priceType = 'SELLING' }) => ({
        url: `/pricing/skus/${skuId}/history`, params: { priceType },
      }),
      providesTags: (_r, _e, { skuId }) => [{ type: 'PriceHistory', id: skuId }],
    }),
    getPriceAsOf: builder.query({
      query: ({ skuId, date, priceType = 'SELLING' }) => ({
        url: `/pricing/skus/${skuId}/price-as-of`, params: { date, priceType },
      }),
    }),

    // ── Submission & approval ──────────────────────────────────
    submitRevision: builder.mutation({
      query: (body) => ({ url: '/pricing/revisions', method: 'POST', body }),
      invalidatesTags: (_r, _e, body) => [
        'Pricing',
        { type: 'PriceHistory', id: body.skuId },
        'PriceApprovals',
        'SKU', // refresh SKU lookups — the price cache the calculator reads
      ],
    }),
    correctRevision: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/pricing/revisions/${id}/correct`, method: 'POST', body,
      }),
      invalidatesTags: ['Pricing', 'PriceHistory', 'PriceApprovals', 'SKU'],
    }),
    getPendingRevisions: builder.query({
      query: () => '/pricing/revisions',
      providesTags: ['PriceApprovals'],
    }),
    approveRevision: builder.mutation({
      query: (id) => ({ url: `/pricing/revisions/${id}/approve`, method: 'POST' }),
      invalidatesTags: ['PriceApprovals', 'Pricing', 'PriceHistory', 'SKU'],
    }),
    rejectRevision: builder.mutation({
      query: ({ id, reason }) => ({
        url: `/pricing/revisions/${id}/reject`, method: 'POST', body: { reason },
      }),
      invalidatesTags: ['PriceApprovals', 'Pricing'],
    }),

    // ── Phase-1: remarks / reviewers / export ──────────────────
    updateSkuRemarks: builder.mutation({
      query: ({ skuId, remarks }) => ({
        url: `/pricing/skus/${skuId}/remarks`, method: 'PATCH', body: { remarks },
      }),
      invalidatesTags: ['Pricing'],
    }),
    getPricingReviewers: builder.query({
      query: () => '/pricing/reviewers',
      providesTags: ['PricingReviewers'],
    }),
    getPricingExport: builder.query({
      query: (params = {}) => ({ url: '/pricing/export', params }),
    }),

    // ── Phase-2: Document Tracker ──────────────────────────────
    getPricingDocuments: builder.query({
      query: (params = {}) => ({ url: '/pricing/documents', params }),
      providesTags: ['PricingDocuments'],
    }),

    // ── Phase-3: Analytics ─────────────────────────────────────
    getPricingAnalytics: builder.query({
      query: (params = {}) => ({ url: '/pricing/analytics', params }),
      providesTags: ['PricingAnalytics'],
    }),

    // ── Calculator ─────────────────────────────────────────────
    previewCalculator: builder.mutation({
      query: (body) => ({ url: '/pricing/calculator/preview', method: 'POST', body }),
    }),

    // ── Settings ───────────────────────────────────────────────
    getCompanySettings: builder.query({
      query: () => '/pricing/settings',
      providesTags: ['CompanySettings'],
    }),
    updateCompanySettings: builder.mutation({
      query: (body) => ({ url: '/pricing/settings', method: 'PATCH', body }),
      invalidatesTags: ['CompanySettings'],
    }),
  }),
});

export const {
  useGetPriceMasterQuery,
  useGetSkuPriceHistoryQuery,
  useGetPriceAsOfQuery,
  useLazyGetPriceAsOfQuery,
  useSubmitRevisionMutation,
  useCorrectRevisionMutation,
  useGetPendingRevisionsQuery,
  useApproveRevisionMutation,
  useRejectRevisionMutation,
  useGetCompanySettingsQuery,
  useUpdateCompanySettingsMutation,
  usePreviewCalculatorMutation,
  useUpdateSkuRemarksMutation,
  useGetPricingReviewersQuery,
  useLazyGetPricingExportQuery,
  useGetPricingDocumentsQuery,
  useGetPricingAnalyticsQuery,
} = pricingApi;
