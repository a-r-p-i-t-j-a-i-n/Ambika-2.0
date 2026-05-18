import { baseApi } from './baseApi';

export const quoteApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listQuotes: builder.query({
      query: (params = {}) => ({ url: '/quotes', params }),
      providesTags: ['Quote'],
    }),
    getQuote: builder.query({
      query: (id) => `/quotes/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Quote', id }],
    }),
    createQuote: builder.mutation({
      query: (body) => ({ url: '/quotes', method: 'POST', body }),
      invalidatesTags: ['Quote'],
    }),
    updateQuote: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/quotes/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => ['Quote', { type: 'Quote', id }],
    }),
    sendQuote: builder.mutation({
      query: (id) => ({ url: `/quotes/${id}/send`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => ['Quote', { type: 'Quote', id }],
    }),
    acceptQuote: builder.mutation({
      query: (id) => ({ url: `/quotes/${id}/accept`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => ['Quote', { type: 'Quote', id }],
    }),
    rejectQuote: builder.mutation({
      query: ({ id, reason }) => ({ url: `/quotes/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: (_r, _e, { id }) => ['Quote', { type: 'Quote', id }],
    }),
    deleteQuote: builder.mutation({
      query: (id) => ({ url: `/quotes/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Quote'],
    }),
  }),
});

export const {
  useListQuotesQuery,
  useGetQuoteQuery,
  useCreateQuoteMutation,
  useUpdateQuoteMutation,
  useSendQuoteMutation,
  useAcceptQuoteMutation,
  useRejectQuoteMutation,
  useDeleteQuoteMutation,
} = quoteApi;
