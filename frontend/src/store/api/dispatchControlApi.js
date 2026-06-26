import { baseApi } from './baseApi';

export const dispatchControlApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDispatchDashboard: builder.query({
      query: (params) => ({ url: '/dispatch-control/dashboard', params }),
      providesTags: ['DispatchDashboard'],
    }),
    // Flat plan-vs-actual matrix: one row per phase across all live orders.
    getPhaseMatrix: builder.query({
      query: () => ({ url: '/dispatch-control/phase-matrix' }),
      providesTags: ['DispatchDashboard', 'Schedule'],
    }),
    createOrderEntry: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/order-entry', method: 'POST', body }),
      invalidatesTags: ['Order', 'DispatchDashboard', 'Party', 'OrderIntake', 'O2DProcess', 'O2DMyTasks'],
    }),
    createDispatchPlan: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/dispatch-plans', method: 'POST', body }),
      invalidatesTags: ['Order', 'PPC', 'Comparison', 'DispatchDashboard', 'Schedule'],
    }),
    createActualDispatch: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/actual-dispatches', method: 'POST', body }),
      invalidatesTags: ['Order', 'Challan', 'PPC', 'Comparison', 'DispatchDashboard', 'Schedule'],
    }),
    // Step 2.5 — email the dispatch schedule to the client via SMTP.
    emailDispatchSchedule: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/email-schedule', method: 'POST', body }),
    }),
    getOrderComparison: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/comparison`,
      providesTags: (_r, _e, soNumber) => [{ type: 'Comparison', id: soNumber }],
    }),
    getOrderSummary: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/summary`,
      providesTags: (_r, _e, soNumber) => [{ type: 'Comparison', id: soNumber }],
    }),
    getSchedule: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/schedule`,
      providesTags: (_r, _e, soNumber) => [{ type: 'Schedule', id: soNumber }],
    }),
    getDispatchablePhases: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/dispatchable-phases`,
      providesTags: (_r, _e, soNumber) => [{ type: 'Schedule', id: soNumber }],
    }),
    createPhase: builder.mutation({
      query: ({ soNumber, ...body }) => ({
        url: `/dispatch-control/orders/${encodeURIComponent(soNumber)}/phases`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { soNumber }) => [
        { type: 'Schedule', id: soNumber },
        'Schedule', // general list tag → refreshes the Dispatch Calendar
        { type: 'Comparison', id: soNumber },
        'Order', 'PPC', 'DispatchDashboard',
      ],
    }),
    updatePhase: builder.mutation({
      query: ({ soNumber, phaseId, ...body }) => ({
        url: `/dispatch-control/orders/${encodeURIComponent(soNumber)}/phases/${phaseId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_r, _e, { soNumber }) => [
        { type: 'Schedule', id: soNumber },
        'Schedule', // general list tag → refreshes the Dispatch Calendar
        { type: 'Comparison', id: soNumber },
        'DispatchDashboard',
      ],
    }),
    deletePhase: builder.mutation({
      query: ({ soNumber, phaseId }) => ({
        url: `/dispatch-control/orders/${encodeURIComponent(soNumber)}/phases/${phaseId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { soNumber }) => [
        { type: 'Schedule', id: soNumber },
        'Schedule', // general list tag → refreshes the Dispatch Calendar
        { type: 'Comparison', id: soNumber },
        'DispatchDashboard',
      ],
    }),
    normalizeSheetRows: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/sheet-rows/normalize', method: 'POST', body }),
    }),
    getChallans: builder.query({
      query: (params) => ({ url: '/challans', params }),
      providesTags: ['Challan'],
    }),
    // All dispatch schedules (plans) — for the O2D Master Data view.
    getSchedules: builder.query({
      query: (params) => ({ url: '/schedules', params }),
      providesTags: ['Schedule'],
    }),
    getChallanById: builder.query({
      query: (id) => `/challans/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Challan', id }],
    }),
    generateChallanPdf: builder.mutation({
      query: (id) => ({ url: `/challans/${id}/pdf`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Challan', id }, 'Challan'],
    }),
    updateChallan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/challans/${id}`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Challan', id }, 'Challan'],
    }),
    // Upload — `file` is a single File from a drop / input.
    uploadOrderDocument: builder.mutation({
      query: (file) => {
        const fd = new FormData();
        fd.append('file', file);
        return {
          url: '/uploads/order-document',
          method: 'POST',
          body: fd,
          // Let browser set the Content-Type with the multipart boundary.
          formData: true,
        };
      },
    }),
  }),
});

export const {
  useGetDispatchDashboardQuery,
  useGetPhaseMatrixQuery,
  useCreateOrderEntryMutation,
  useCreateDispatchPlanMutation,
  useCreateActualDispatchMutation,
  useEmailDispatchScheduleMutation,
  useGetOrderComparisonQuery,
  useGetOrderSummaryQuery,
  useGetScheduleQuery,
  useGetDispatchablePhasesQuery,
  useCreatePhaseMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  useNormalizeSheetRowsMutation,
  useGetChallansQuery,
  useGetSchedulesQuery,
  useGetChallanByIdQuery,
  useGenerateChallanPdfMutation,
  useUpdateChallanMutation,
  useUploadOrderDocumentMutation,
} = dispatchControlApi;
