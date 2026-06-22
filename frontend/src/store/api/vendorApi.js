import { baseApi } from './baseApi';

// Purchase-FMS Vendors — a SEPARATE collection from Party (customers).
// Base: /api/v1/vendors
export const vendorApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getVendors: builder.query({
      query: (params) => ({ url: '/vendors', params }),
      providesTags: ['Vendor'],
    }),
    getVendorById: builder.query({
      query: (id) => `/vendors/${id}`,
      providesTags: (r, e, id) => [{ type: 'Vendor', id }],
    }),
    createVendor: builder.mutation({
      query: (body) => ({ url: '/vendors', method: 'POST', body }),
      invalidatesTags: ['Vendor'],
    }),
    updateVendor: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/vendors/${id}`, method: 'PUT', body }),
      invalidatesTags: (r, e, { id }) => ['Vendor', { type: 'Vendor', id }],
    }),
    deleteVendor: builder.mutation({
      query: (id) => ({ url: `/vendors/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Vendor'],
    }),
  }),
});

export const {
  useGetVendorsQuery,
  useGetVendorByIdQuery,
  useCreateVendorMutation,
  useUpdateVendorMutation,
  useDeleteVendorMutation,
} = vendorApi;
