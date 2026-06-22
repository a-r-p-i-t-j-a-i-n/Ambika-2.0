import { baseApi } from './baseApi';

// Transporter master (logistics partners) — base: /api/v1/transporters
export const transporterApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTransporters: builder.query({
      query: (params) => ({ url: '/transporters', params }),
      providesTags: ['Transporter'],
    }),
    getTransporterById: builder.query({
      query: (id) => `/transporters/${id}`,
      providesTags: (r, e, id) => [{ type: 'Transporter', id }],
    }),
    createTransporter: builder.mutation({
      query: (body) => ({ url: '/transporters', method: 'POST', body }),
      invalidatesTags: ['Transporter'],
    }),
    updateTransporter: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/transporters/${id}`, method: 'PUT', body }),
      invalidatesTags: (r, e, { id }) => ['Transporter', { type: 'Transporter', id }],
    }),
    deleteTransporter: builder.mutation({
      query: (id) => ({ url: `/transporters/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Transporter'],
    }),
  }),
});

export const {
  useGetTransportersQuery,
  useGetTransporterByIdQuery,
  useCreateTransporterMutation,
  useUpdateTransporterMutation,
  useDeleteTransporterMutation,
} = transporterApi;
