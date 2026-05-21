import { baseApi } from './baseApi';

export const ppcApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // The Production Board — rows (one per FG SKU with demand/plan) + KPIs + WIP.
    getPpcBoard: builder.query({
      query: ({ year, month }) => ({ url: '/ppc/board', params: { year, month } }),
      providesTags: ['PPC'],
    }),
    // Auto-create plans for every SKU that has open demand but no plan yet.
    generatePpcPlans: builder.mutation({
      query: (body) => ({ url: '/ppc/generate', method: 'POST', body }),
      invalidatesTags: ['PPC'],
    }),
    // Update a plan's demand inputs / daily targets.
    updatePpcPlan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/ppc/plan/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['PPC'],
    }),
    // Record what the floor produced on a date.
    savePpcDailyEntry: builder.mutation({
      query: (body) => ({ url: '/ppc/daily-entry', method: 'POST', body }),
      invalidatesTags: ['PPC'],
    }),
    // Move a batch between shop-floor stages.
    movePpcWip: builder.mutation({
      query: (body) => ({ url: '/ppc/wip/move', method: 'POST', body }),
      invalidatesTags: ['PPC'],
    }),
  }),
});

export const {
  useGetPpcBoardQuery,
  useGeneratePpcPlansMutation,
  useUpdatePpcPlanMutation,
  useSavePpcDailyEntryMutation,
  useMovePpcWipMutation,
} = ppcApi;
