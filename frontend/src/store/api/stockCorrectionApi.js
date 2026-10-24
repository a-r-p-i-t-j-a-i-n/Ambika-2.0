import { baseApi } from './baseApi';

/**
 * Stock correction — set any Raw Material, Consumables & Packaging, Finished
 * Goods or Scrap item to its physical count. Base: /api/v1/inventory/stock-correction
 *
 * A correction moves real stock in whichever module the item belongs to, so
 * saving one refreshes every IMS stock list, dashboard and history.
 */
export const stockCorrectionApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // Items matching a search (code or name), each with its stock per location.
    getStockCorrectionSkus: builder.query({
      query: (params = {}) => ({ url: '/inventory/stock-correction/skus', params }),
      providesTags: ['InventoryStock'],
      keepUnusedDataFor: 30,
    }),
    correctStock: builder.mutation({
      query: (body) => ({ url: '/inventory/stock-correction', method: 'POST', body }),
      invalidatesTags: [
        'InventoryStock', 'InventoryMovement',
        'RmOverview', 'RmDashboard', 'RmMovement',
        'ImsOverview', 'ImsDashboard', 'ImsMovement',
        'FgOverview', 'FgDashboard', 'FgMovement',
        'ScrapOverview', 'ScrapDashboard', 'ScrapStock', 'ScrapMovement',
      ],
    }),
  }),
});

export const { useGetStockCorrectionSkusQuery, useCorrectStockMutation } = stockCorrectionApi;
