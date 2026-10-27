import { baseApi } from './baseApi';

// FMS step-wise Doer Assignment — config (who does each step) + doer tasks.
// Backend base: /fms-doers
export const fmsDoerApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getFmsCatalogs: builder.query({
      query: () => '/fms-doers/catalogs',
    }),
    getDoerAssignments: builder.query({
      query: (fmsKey) => `/fms-doers/assignments/${fmsKey}`,
      providesTags: ['FmsDoerAssignments'],
    }),
    getAssignableUsers: builder.query({
      query: ({ fmsKey, stepKey }) => `/fms-doers/assignments/${fmsKey}/${stepKey}/users`,
    }),
    getAssignmentHistory: builder.query({
      query: ({ fmsKey, stepKey }) => `/fms-doers/assignments/${fmsKey}/${stepKey}/history`,
      providesTags: ['FmsDoerAssignments'],
    }),
    setDoerAssignment: builder.mutation({
      query: ({ fmsKey, stepKey, ...body }) => ({ url: `/fms-doers/assignments/${fmsKey}/${stepKey}`, method: 'PUT', body }),
      invalidatesTags: ['FmsDoerAssignments'],
    }),
    applyDoerToOpenTasks: builder.mutation({
      query: ({ fmsKey, stepKey, ...body }) => ({ url: `/fms-doers/assignments/${fmsKey}/${stepKey}/apply-to-open-tasks`, method: 'POST', body }),
      invalidatesTags: ['FmsDoerAssignments', 'FmsTasks'],
    }),
    // O2D-style plan grid (lead time · main doers · buddies per step).
    getFmsDoerPlan: builder.query({
      query: (fmsKey) => `/fms-doers/plan/${fmsKey}`,
      providesTags: ['FmsDoerAssignments'],
    }),
    getFmsDoerPlanUsers: builder.query({
      query: (fmsKey) => `/fms-doers/plan/${fmsKey}/users`,
    }),
    saveFmsDoerPlan: builder.mutation({
      query: ({ fmsKey, ...body }) => ({ url: `/fms-doers/plan/${fmsKey}`, method: 'PUT', body }),
      invalidatesTags: ['FmsDoerAssignments', 'FmsTasks'],
    }),
    applyFmsDoerPlanToOpen: builder.mutation({
      query: ({ fmsKey, ...body }) => ({ url: `/fms-doers/plan/${fmsKey}/apply-open`, method: 'POST', body }),
      invalidatesTags: ['FmsDoerAssignments', 'FmsTasks'],
    }),
    getMyFmsTasks: builder.query({
      query: () => '/fms-doers/tasks/mine',
      providesTags: ['FmsTasks'],
    }),
    getFmsTasks: builder.query({
      query: (params = {}) => ({ url: '/fms-doers/tasks', params }),
      providesTags: ['FmsTasks'],
    }),
    getFmsTasksByEntity: builder.query({
      query: ({ entityType, entityId }) => ({ url: '/fms-doers/tasks/by-entity', params: { entityType, entityId } }),
      providesTags: ['FmsTasks'],
    }),
    reassignFmsTask: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/fms-doers/tasks/${id}/reassign`, method: 'PATCH', body }),
      invalidatesTags: ['FmsTasks', 'FmsDoerAssignments'],
    }),
    syncFmsTasks: builder.mutation({
      query: () => ({ url: '/fms-doers/sync', method: 'POST' }),
      invalidatesTags: ['FmsTasks', 'FmsDoerAssignments'],
    }),
  }),
});

export const {
  useGetFmsCatalogsQuery,
  useGetDoerAssignmentsQuery,
  useGetAssignableUsersQuery,
  useGetAssignmentHistoryQuery,
  useSetDoerAssignmentMutation,
  useApplyDoerToOpenTasksMutation,
  useGetFmsDoerPlanQuery,
  useGetFmsDoerPlanUsersQuery,
  useSaveFmsDoerPlanMutation,
  useApplyFmsDoerPlanToOpenMutation,
  useGetMyFmsTasksQuery,
  useGetFmsTasksQuery,
  useGetFmsTasksByEntityQuery,
  useReassignFmsTaskMutation,
  useSyncFmsTasksMutation,
} = fmsDoerApi;
