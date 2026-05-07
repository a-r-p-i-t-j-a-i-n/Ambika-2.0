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
  }),
});

export const { useGetSkusQuery, useCreateSkuMutation, useUpdateSkuMutation } = skuApi;
