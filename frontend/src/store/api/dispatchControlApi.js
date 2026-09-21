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
      // Step 2.04's row reads the plan's phases straight off the process.
      invalidatesTags: ['Order', 'PPC', 'Comparison', 'DispatchDashboard', 'Schedule', 'O2DProcess'],
    }),
    createActualDispatch: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/actual-dispatches', method: 'POST', body }),
      // 'O2DProcess' covers the FMS tracker too: a new dispatch spawns a new delivery
      // challan, and the Step View's 2.06–2.13 rows are one PER challan — so the new
      // row (and its own 2.07→2.13 chain) must appear without a manual refresh.
      invalidatesTags: ['Order', 'Challan', 'PPC', 'Comparison', 'DispatchDashboard', 'Schedule', 'O2DProcess', 'O2DMyTasks'],
    }),
    // Step 2.5 — email the dispatch schedule to the client via SMTP.
    emailDispatchSchedule: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/email-schedule', method: 'POST', body }),
    }),
    // Bulk 2.05: drafts are built SERVER-side by the same code the single compose
    // screen uses, so what a reviewer reads in the preview is what actually goes out.
    bulkEmailPreview: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/email-schedule/bulk-preview', method: 'POST', body }),
    }),
    bulkEmailSchedule: builder.mutation({
      query: (body) => ({ url: '/dispatch-control/email-schedule/bulk', method: 'POST', body }),
      invalidatesTags: ['O2DProcess', 'O2DMyTasks', 'Order'],
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
    // Production plan -> dispatch plan. The preview is a pure read; apply is what
    // creates phases AND marks the plan capacity spent.
    previewInheritPlan: builder.query({
      query: (soNumber) => `/dispatch-control/orders/${encodeURIComponent(soNumber)}/inherit-production-plan`,
      providesTags: (_r, _e, soNumber) => [{ type: 'Schedule', id: soNumber }, 'ProductionPlan'],
    }),
    applyInheritPlan: builder.mutation({
      query: ({ soNumber, days }) => ({
        url: `/dispatch-control/orders/${encodeURIComponent(soNumber)}/inherit-production-plan`,
        method: 'POST',
        body: { days },
      }),
      invalidatesTags: (_r, _e, { soNumber }) => [
        { type: 'Schedule', id: soNumber }, 'Schedule', 'Order', 'PPC',
        'DispatchDashboard', 'O2DProcess', 'ProductionPlan',
      ],
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
    // Read-only preview of the DC number a new dispatch (on `date`) would get.
    getNextDcNumber: builder.query({
      query: (params) => ({ url: '/challans/next-number', params }),
      // Tie to Challan so creating a dispatch refreshes the previewed number.
      providesTags: ['Challan'],
    }),
    generateChallanPdf: builder.mutation({
      query: (id) => ({ url: `/challans/${id}/pdf`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Challan', id }, 'Challan'],
    }),
    // Delete ONE delivery challan. On a per-challan step the board's delete acts
    // on the row you clicked — the challan — not the whole sales order.
    // Cancel a dispatch: the row survives, its quantity is returned to the plan,
    // and every downstream step for that challan is marked cancelled.
    cancelChallan: builder.mutation({
      query: ({ id, reason }) => ({ url: `/dispatch-control/challans/${id}/cancel`, method: 'PATCH', body: { reason } }),
      invalidatesTags: ['Challan', 'Order', 'Schedule', 'Comparison', 'DispatchDashboard', 'PPC', 'O2DProcess', 'O2DMyTasks'],
    }),
    // Exact inverse of cancelChallan — puts the quantity back on the plan.
    restoreChallan: builder.mutation({
      query: (id) => ({ url: `/dispatch-control/challans/${id}/restore`, method: 'PATCH' }),
      invalidatesTags: ['Challan', 'Order', 'Schedule', 'Comparison', 'DispatchDashboard', 'PPC', 'O2DProcess', 'O2DMyTasks'],
    }),
    deleteChallan: builder.mutation({
      query: (id) => ({ url: `/challans/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Challan', 'Order', 'Schedule', 'Comparison', 'DispatchDashboard', 'O2DProcess', 'O2DMyTasks'],
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
  useBulkEmailPreviewMutation,
  useBulkEmailScheduleMutation,
  useGetOrderComparisonQuery,
  useGetOrderSummaryQuery,
  useGetScheduleQuery,
  useGetDispatchablePhasesQuery,
  useCreatePhaseMutation,
  usePreviewInheritPlanQuery,
  useApplyInheritPlanMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  useNormalizeSheetRowsMutation,
  useGetChallansQuery,
  useGetNextDcNumberQuery,
  useGetSchedulesQuery,
  useGetChallanByIdQuery,
  useGenerateChallanPdfMutation,
  useUpdateChallanMutation,
  useDeleteChallanMutation,
  useCancelChallanMutation,
  useRestoreChallanMutation,
  useUploadOrderDocumentMutation,
} = dispatchControlApi;
