import { baseApi } from './baseApi';

/**
 * Party-wise production plans — the ones that do NOT need a purchase order.
 * The dispatch calendar reads order-anchored phases; this reads plans the
 * planner typed in directly, so both calendars can sit side by side.
 */
export const productionPlanApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProductionPlans: builder.query({
      query: (params) => ({ url: '/production-plans', params }),
      providesTags: ['ProductionPlan'],
    }),
    getProductionPlanPartySummary: builder.query({
      query: (params) => ({ url: '/production-plans/party-summary', params }),
      providesTags: ['ProductionPlan'],
    }),
    createProductionPlan: builder.mutation({
      query: (body) => ({ url: '/production-plans', method: 'POST', body }),
      invalidatesTags: ['ProductionPlan'],
    }),
    updateProductionPlan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/production-plans/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ProductionPlan'],
    }),
    deleteProductionPlan: builder.mutation({
      query: (id) => ({ url: `/production-plans/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ProductionPlan'],
    }),
  }),
});

export const {
  useGetProductionPlansQuery,
  useGetProductionPlanPartySummaryQuery,
  useCreateProductionPlanMutation,
  useUpdateProductionPlanMutation,
  useDeleteProductionPlanMutation,
} = productionPlanApi;
