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
      // Creating an order also spawns its O2D FMS process — refresh both.
      invalidatesTags: ['Order', 'O2DProcess'],
    }),
    updateOrder: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/orders/${id}`,
        method: 'PUT',
        body,
      }),
      // O2DProcess included so the Step Board picks up edits (PO number etc.).
      invalidatesTags: (result, error, { id }) => [{ type: 'Order', id }, 'Order', 'O2DProcess'],
    }),
    deleteOrder: builder.mutation({
      query: (id) => ({
        url: `/orders/${id}`,
        method: 'DELETE',
      }),
      // Deleting an order cascades to its O2D FMS process server-side — refresh both.
      invalidatesTags: ['Order', 'O2DProcess'],
    }),
    updateWorkflowStep: builder.mutation({
      query: ({ id, step, body }) => ({
        url: `/orders/${id}/workflow/${step}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Order', id }, 'Order'],
    }),
    getOrderSchedule: builder.query({
      query: (soNumber) => `/schedules/by-so/${encodeURIComponent(soNumber)}`,
      providesTags: (result, error, soNumber) => [{ type: 'Order', id: soNumber }],
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
  useUpdateWorkflowStepMutation,
  useGetOrderScheduleQuery
} = orderApi;
