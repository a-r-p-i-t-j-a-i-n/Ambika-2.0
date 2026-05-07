import { baseApi } from './baseApi';

export const ppcApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPpcMonthData: builder.query({
      query: ({ year, month }) => `/ppc/month/${year}/${month}`,
      providesTags: (result, error, { year, month }) => [{ type: 'PPC', id: `${year}-${month}` }],
    }),
    updatePpcDailyPlan: builder.mutation({
      query: (body) => ({
        url: '/ppc/plan/daily',
        method: 'POST',
        body, // { orderId, skuId, date, planType, quantity }
      }),
      invalidatesTags: ['PPC'],
    }),
  }),
});

export const { useGetPpcMonthDataQuery, useUpdatePpcDailyPlanMutation } = ppcApi;
