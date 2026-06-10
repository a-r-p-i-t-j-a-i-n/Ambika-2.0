import { baseApi } from './baseApi';

// O2D FMS (Flow Management System) — process tracking, doer tasks, MD dashboard,
// and the admin-editable step catalog. Backend base: /o2d-fms
export const o2dFmsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── Doer + views ──────────────────────────────────────────
    getMyTasks: builder.query({
      query: () => '/o2d-fms/my-tasks',
      providesTags: ['O2DMyTasks'],
    }),
    getAllTasks: builder.query({
      query: () => '/o2d-fms/all-tasks',
      providesTags: ['O2DMyTasks', 'O2DProcess'],
    }),
    getFmsDashboard: builder.query({
      query: () => '/o2d-fms/dashboard',
      providesTags: ['O2DDashboard'],
    }),
    getFmsScores: builder.query({
      query: () => '/o2d-fms/scores',
      providesTags: ['O2DDashboard'],
    }),
    getProcesses: builder.query({
      query: (params) => ({ url: '/o2d-fms/processes', params }),
      providesTags: ['O2DProcess'],
    }),
    getProcessById: builder.query({
      query: (id) => `/o2d-fms/processes/${id}`,
      providesTags: (r, e, id) => [{ type: 'O2DProcess', id }],
    }),
    getProcessByOrder: builder.query({
      query: (orderId) => `/o2d-fms/processes/by-order/${orderId}`,
      providesTags: (r, e, orderId) => [{ type: 'O2DProcess', id: `order-${orderId}` }],
    }),
    completeStep: builder.mutation({
      query: ({ id, stepCode, ...body }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/complete`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: 'O2DProcess', id }, 'O2DProcess', 'O2DMyTasks', 'O2DDashboard',
      ],
    }),
    assignStep: builder.mutation({
      query: ({ id, stepCode, assignees = [], buddies = [] }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/assign`,
        method: 'PATCH',
        body: { assignees, buddies },
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: 'O2DProcess', id }, 'O2DProcess', 'O2DMyTasks', 'O2DDashboard',
      ],
    }),
    toggleChecklistItem: builder.mutation({
      query: ({ id, stepCode, itemId, done }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/checklist/${itemId}`,
        method: 'PATCH',
        body: { done },
      }),
      // Optimistic: flip the checkbox in the cached process instantly so the UI
      // feels immediate. No O2DProcess invalidation → no full refetch churn.
      async onQueryStarted({ id, stepCode, itemId, done }, { dispatch, queryFulfilled }) {
        const patch = dispatch(o2dFmsApi.util.updateQueryData('getProcessById', id, (draft) => {
          const step = draft?.data?.steps?.find((s) => s.stepCode === stepCode);
          const item = step?.checklist?.find((c) => c._id === itemId);
          if (item) { item.done = done; item.doneAt = done ? new Date().toISOString() : null; }
        }));
        try { await queryFulfilled; } catch { patch.undo(); }
      },
      invalidatesTags: ['O2DMyTasks'],
    }),
    addStepComment: builder.mutation({
      query: ({ id, stepCode, text }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/comment`,
        method: 'POST',
        body: { text },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: 'O2DProcess', id }],
    }),
    // Generic file upload → S3 (or local). Returns { data: { url, key, fileName, mimeType, sizeBytes } }.
    uploadFile: builder.mutation({
      query: ({ file, folder = 'o2d-fms' }) => {
        const fd = new FormData();
        fd.append('file', file);
        return { url: `/uploads?folder=${folder}`, method: 'POST', body: fd, formData: true };
      },
    }),
    addStepAttachments: builder.mutation({
      query: ({ id, stepCode, attachments }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/attachments`,
        method: 'POST',
        body: { attachments },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: 'O2DProcess', id }],
    }),
    removeStepAttachment: builder.mutation({
      query: ({ id, stepCode, attachmentId }) => ({
        url: `/o2d-fms/processes/${id}/steps/${stepCode}/attachments/${attachmentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (r, e, { id }) => [{ type: 'O2DProcess', id }],
    }),
    planOrder: builder.mutation({
      query: ({ id, steps }) => ({ url: `/o2d-fms/processes/${id}/plan`, method: 'PATCH', body: { steps } }),
      invalidatesTags: (r, e, { id }) => [{ type: 'O2DProcess', id }, 'O2DProcess', 'O2DMyTasks', 'O2DDashboard'],
    }),

    // ── Task templates ─────────────────────────────────────────
    getTaskTemplates: builder.query({
      query: () => '/o2d-fms/templates',
      providesTags: ['O2DTemplate'],
    }),
    getTaskTemplate: builder.query({
      query: (id) => `/o2d-fms/templates/${id}`,
      providesTags: (r, e, id) => [{ type: 'O2DTemplate', id }],
    }),
    createTaskTemplate: builder.mutation({
      query: (body) => ({ url: '/o2d-fms/templates', method: 'POST', body }),
      invalidatesTags: ['O2DTemplate'],
    }),
    updateTaskTemplate: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/o2d-fms/templates/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['O2DTemplate'],
    }),
    setDefaultTemplate: builder.mutation({
      query: (id) => ({ url: `/o2d-fms/templates/${id}/default`, method: 'PATCH' }),
      invalidatesTags: ['O2DTemplate'],
    }),
    deleteTaskTemplate: builder.mutation({
      query: (id) => ({ url: `/o2d-fms/templates/${id}`, method: 'DELETE' }),
      invalidatesTags: ['O2DTemplate'],
    }),

    // ── Step definitions (config) ─────────────────────────────
    getStepDefinitions: builder.query({
      query: () => '/o2d-fms/step-definitions',
      providesTags: ['O2DStepDef'],
    }),
    createStepDefinition: builder.mutation({
      query: (body) => ({ url: '/o2d-fms/step-definitions', method: 'POST', body }),
      invalidatesTags: ['O2DStepDef'],
    }),
    updateStepDefinition: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/o2d-fms/step-definitions/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['O2DStepDef'],
    }),
    reorderStepDefinitions: builder.mutation({
      query: (order) => ({ url: '/o2d-fms/step-definitions/reorder', method: 'PATCH', body: { order } }),
      invalidatesTags: ['O2DStepDef'],
    }),
    deleteStepDefinition: builder.mutation({
      query: (id) => ({ url: `/o2d-fms/step-definitions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['O2DStepDef'],
    }),
  }),
});

export const {
  useGetMyTasksQuery,
  useGetAllTasksQuery,
  useGetFmsDashboardQuery,
  useGetFmsScoresQuery,
  useGetProcessesQuery,
  useGetProcessByIdQuery,
  useGetProcessByOrderQuery,
  useCompleteStepMutation,
  useAssignStepMutation,
  useGetStepDefinitionsQuery,
  useCreateStepDefinitionMutation,
  useUpdateStepDefinitionMutation,
  useReorderStepDefinitionsMutation,
  useDeleteStepDefinitionMutation,
  useToggleChecklistItemMutation,
  useAddStepCommentMutation,
  useUploadFileMutation,
  useAddStepAttachmentsMutation,
  useRemoveStepAttachmentMutation,
  usePlanOrderMutation,
  useGetTaskTemplatesQuery,
  useGetTaskTemplateQuery,
  useCreateTaskTemplateMutation,
  useUpdateTaskTemplateMutation,
  useSetDefaultTemplateMutation,
  useDeleteTaskTemplateMutation,
} = o2dFmsApi;
