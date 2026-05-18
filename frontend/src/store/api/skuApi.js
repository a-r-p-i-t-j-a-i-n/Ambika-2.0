import { baseApi } from './baseApi';

export const skuApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSkus: builder.query({
      query: (params) => ({
        url: '/skus',
        params,
      }),
      providesTags: ['SKU'],
    }),
    getSkuLookup: builder.query({
      query: (params) => ({
        url: '/skus/lookup/list',
        params,
      }),
      providesTags: ['SKU'],
    }),
    createSku: builder.mutation({
      query: (body) => ({
        url: '/skus',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['SKU'],
    }),
    updateSku: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/skus/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['SKU'],
    }),
    bulkUpsertSkus: builder.mutation({
      query: (body) => ({
        url: '/skus/bulk-upsert',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['SKU'],
    }),
    deleteSku: builder.mutation({
      query: (id) => ({
        url: `/skus/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['SKU'],
    }),
  }),
});

export const {
  useGetSkusQuery,
  useGetSkuLookupQuery,
  useCreateSkuMutation,
  useUpdateSkuMutation,
  useBulkUpsertSkusMutation,
  useDeleteSkuMutation,
} = skuApi;
