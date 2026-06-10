import { baseApi } from './baseApi';

export const orderIntakeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getOrderIntakes: builder.query({
      query: (params) => ({ url: '/order-intake', params }),
      providesTags: ['OrderIntake'],
    }),
    getOrderIntake: builder.query({
      query: (id) => `/order-intake/${id}`,
      providesTags: (r, e, id) => [{ type: 'OrderIntake', id }],
    }),
    createOrderIntake: builder.mutation({
      query: (body) => ({ url: '/order-intake', method: 'POST', body }),
      invalidatesTags: ['OrderIntake', 'O2DProcess', 'O2DMyTasks', 'O2DDashboard'],
    }),
    convertOrderIntake: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/order-intake/${id}/convert`, method: 'POST', body }),
      invalidatesTags: ['OrderIntake', 'Order', 'O2DProcess', 'O2DMyTasks', 'O2DDashboard'],
    }),
    cancelOrderIntake: builder.mutation({
      query: (id) => ({ url: `/order-intake/${id}/cancel`, method: 'PATCH' }),
      invalidatesTags: ['OrderIntake'],
    }),
    // MD-only: removes the intake (any status) and its orphan FMS process.
    deleteOrderIntake: builder.mutation({
      query: (id) => ({ url: `/order-intake/${id}`, method: 'DELETE' }),
      invalidatesTags: ['OrderIntake', 'O2DProcess', 'O2DMyTasks', 'O2DDashboard'],
    }),
  }),
});

export const {
  useGetOrderIntakesQuery,
  useGetOrderIntakeQuery,
  useCreateOrderIntakeMutation,
  useConvertOrderIntakeMutation,
  useCancelOrderIntakeMutation,
  useDeleteOrderIntakeMutation,
} = orderIntakeApi;
