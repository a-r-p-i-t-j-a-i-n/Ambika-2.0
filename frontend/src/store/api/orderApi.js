import { baseApi } from './baseApi';

export const orderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getOrders: builder.query({
      query: (params) => ({
        url: '/orders',
        params,
      }),
      providesTags: ['Order'],
    }),
    getOrderById: builder.query({
      query: (id) => `/orders/${id}`,
      providesTags: (result, error, id) => [{ type: 'Order', id }],
    }),
    getOrdersByParty: builder.query({
      query: ({ partyId, ...params }) => ({
        url: `/orders/by-party/${partyId}`,
        params,
      }),
      providesTags: ['Order'],
    }),
    getOrderStats: builder.query({
      query: () => '/orders/stats',
      providesTags: ['Order'],
    }),
    createOrder: builder.mutation({
      query: (body) => ({
        url: '/orders',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Order'],
    }),
    updateOrder: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/orders/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Order', id }, 'Order'],
    }),
    deleteOrder: builder.mutation({
      query: (id) => ({
        url: `/orders/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Order'],
    }),
    updateWorkflowStep: builder.mutation({
      query: ({ id, step, body }) => ({
        url: `/orders/${id}/workflow/${step}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Order', id }, 'Order'],
    }),
  }),
});

export const { 
  useGetOrdersQuery, 
  useGetOrderByIdQuery,
  useGetOrdersByPartyQuery,
  useGetOrderStatsQuery,
  useCreateOrderMutation, 
  useUpdateOrderMutation,
  useDeleteOrderMutation,
  useUpdateWorkflowStepMutation 
} = orderApi;
