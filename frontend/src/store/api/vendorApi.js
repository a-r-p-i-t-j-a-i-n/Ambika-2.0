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
      invalidatesTags: ['Vendor', 'Pricing'],
    }),
    updateVendor: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/vendors/${id}`, method: 'PUT', body }),
      invalidatesTags: (r, e, { id }) => ['Vendor', 'Pricing', { type: 'Vendor', id }, { type: 'Vendor', id: `pricing-${id}` }],
    }),
    deleteVendor: builder.mutation({
      query: (id) => ({ url: `/vendors/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Vendor'],
    }),
    // Vendor pricing history — audit of every SKU rate / GST change.
    getVendorPricingHistory: builder.query({
      query: ({ id, ...params }) => ({ url: `/vendors/${id}/pricing-history`, params }),
      providesTags: (r, e, { id }) => [{ type: 'Vendor', id: `pricing-${id}` }],
    }),
    addVendorPricingHistory: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/vendors/${id}/pricing-history`, method: 'POST', body }),
      invalidatesTags: (r, e, { id }) => ['Vendor', 'Pricing', { type: 'Vendor', id }, { type: 'Vendor', id: `pricing-${id}` }],
    }),
    // Add / upsert a product on a vendor's catalog (New PO "Add Vendor for this Item").
    addVendorProduct: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/vendors/${id}/products`, method: 'POST', body }),
      invalidatesTags: (r, e, { id }) => ['Vendor', 'Pricing', { type: 'Vendor', id }, { type: 'Vendor', id: `pricing-${id}` }],
    }),
  }),
});

export const {
  useGetVendorsQuery,
  useGetVendorByIdQuery,
  useCreateVendorMutation,
  useUpdateVendorMutation,
  useDeleteVendorMutation,
  useGetVendorPricingHistoryQuery,
  useAddVendorPricingHistoryMutation,
  useAddVendorProductMutation,
} = vendorApi;
