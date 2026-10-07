import { baseApi } from './baseApi';

/**
 * Scrap IMS — what each coil cut left behind, and the scrap the company holds.
 * Base: /api/v1/scrap-ims
 *
 * Two different things live here, and the tags keep them apart:
 *   • the REGISTER (overview / dashboard / record) — one row per cut, a
 *     production measure. Manual entries never touch it, so a Scrap In does
 *     not invalidate it.
 *   • the STOCK (stock / movements) — the balance, moved by Scrap In/Out and
 *     by in-house cuts.
 *
 * A cut moves both, which is why the RM conversion also has to invalidate the
 * scrap tags (see rmImsApi).
 */
export const scrapImsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getScrapOverview: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/overview', params }),
      providesTags: ['ScrapOverview'],
    }),
    getScrapDashboard: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/dashboard', params }),
      providesTags: ['ScrapDashboard'],
    }),
    /**
     * Scrap grouped by the PHYSICAL coil it came off.
     *
     * Part of the REGISTER, not the stock, so it carries the register's tag: a
     * manual Scrap In is not a cut and must not make this refetch, while a coil
     * cut must. That is the same split the two halves of this file already
     * follow — see the header.
     */
    getScrapByCoil: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/by-coil', params }),
      providesTags: ['ScrapOverview'],
    }),
    getScrapRecord: builder.query({
      query: (id) => `/scrap-ims/record/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'ScrapRecord', id }],
    }),

    // ── Scrap stock ──
    getScrapStock: builder.query({
      query: () => '/scrap-ims/stock',
      providesTags: ['ScrapStock'],
    }),
    getScrapMovements: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/movements', params }),
      providesTags: ['ScrapMovement'],
    }),
    // The Scrap Out rows of that same ledger, for the table under the form.
    // Same tag, so a saved Scrap Out refetches it with no extra wiring.
    getScrapOutHistory: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/scrap-out/history', params }),
      providesTags: ['ScrapMovement'],
    }),

    // Both also invalidate the shared inventory tags, because scrap is a real
    // item in the shared ledger and any ledger screen showing it must refetch.
    scrapIn: builder.mutation({
      query: (body) => ({ url: '/scrap-ims/scrap-in', method: 'POST', body }),
      invalidatesTags: ['ScrapStock', 'ScrapMovement', 'ScrapDashboard', 'InventoryStock', 'InventoryMovement'],
    }),
    scrapOut: builder.mutation({
      query: (body) => ({ url: '/scrap-ims/scrap-out', method: 'POST', body }),
      invalidatesTags: ['ScrapStock', 'ScrapMovement', 'ScrapDashboard', 'InventoryStock', 'InventoryMovement'],
    }),

    // ── Scrap Buyer master (who scrap is sold to) ──
    getScrapBuyers: builder.query({
      query: (params = {}) => ({ url: '/scrap-ims/buyers', params }),
      providesTags: ['ScrapBuyer'],
    }),
    // Find-or-create: answers 201 for a new buyer, 200 + created:false when the
    // same buyer (by name or GSTIN) was already in the master.
    createScrapBuyer: builder.mutation({
      query: (body) => ({ url: '/scrap-ims/buyers', method: 'POST', body }),
      invalidatesTags: ['ScrapBuyer'],
    }),
  }),
});

export const {
  useGetScrapOverviewQuery,
  useGetScrapDashboardQuery,
  useGetScrapByCoilQuery,
  useGetScrapRecordQuery,
  useGetScrapStockQuery,
  useGetScrapMovementsQuery,
  useGetScrapOutHistoryQuery,
  useScrapInMutation,
  useScrapOutMutation,
  useGetScrapBuyersQuery,
  useCreateScrapBuyerMutation,
} = scrapImsApi;
