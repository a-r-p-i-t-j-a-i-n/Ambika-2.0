import { baseApi } from './baseApi';

/** Machine Operator master — the mirror image of machineApi. */
export const machineOperatorApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMachineOperatorList: builder.query({
      query: (params) => ({ url: '/machine-operators', params }),
      providesTags: ['MachineOperator'],
    }),
    getMachineOperator: builder.query({
      query: (id) => ({ url: `/machine-operators/${id}` }),
      providesTags: (r, e, id) => ['MachineOperator', { type: 'MachineOperator', id }],
    }),
    getMachineOperatorLookup: builder.query({
      query: (params) => ({ url: '/machine-operators/lookup/list', params }),
      providesTags: ['MachineOperator'],
    }),
    createMachineOperator: builder.mutation({
      query: (body) => ({ url: '/machine-operators', method: 'POST', body }),
      invalidatesTags: ['MachineOperator', 'Machine', 'DprMaster'],
    }),
    updateMachineOperator: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/machine-operators/${id}`, method: 'PATCH', body }),
      invalidatesTags: (r, e, { id }) => ['MachineOperator', { type: 'MachineOperator', id }, 'Machine', 'DprMaster'],
    }),
    deleteMachineOperator: builder.mutation({
      query: (id) => ({ url: `/machine-operators/${id}`, method: 'DELETE' }),
      invalidatesTags: ['MachineOperator', 'Machine', 'DprMaster'],
    }),

    // ── Assigned machines ─────────────────────────────────────
    getOperatorMachines: builder.query({
      query: (id) => ({ url: `/machine-operators/${id}/machines` }),
      providesTags: (r, e, id) => [{ type: 'MachineOperator', id }],
    }),
    assignMachineToOperator: builder.mutation({
      query: ({ id, machineId }) => ({ url: `/machine-operators/${id}/machines`, method: 'POST', body: { machineId } }),
      invalidatesTags: (r, e, { id }) => ['MachineOperator', { type: 'MachineOperator', id }, 'Machine', 'DprMaster'],
    }),
    unassignMachineFromOperator: builder.mutation({
      query: ({ id, machineId }) => ({ url: `/machine-operators/${id}/machines/${machineId}`, method: 'DELETE' }),
      invalidatesTags: (r, e, { id }) => ['MachineOperator', { type: 'MachineOperator', id }, 'Machine', 'DprMaster'],
    }),
  }),
});

export const {
  useGetMachineOperatorListQuery,
  useGetMachineOperatorQuery,
  useGetMachineOperatorLookupQuery,
  useCreateMachineOperatorMutation,
  useUpdateMachineOperatorMutation,
  useDeleteMachineOperatorMutation,
  useGetOperatorMachinesQuery,
  useAssignMachineToOperatorMutation,
  useUnassignMachineFromOperatorMutation,
} = machineOperatorApi;
