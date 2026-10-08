import { baseApi } from './baseApi';

/**
 * Machine master. Assignment mutations invalidate BOTH tags: assigning an
 * operator changes the operator's machine list too, and the DPR masters screen
 * reads the same collections.
 */
export const machineApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMachines: builder.query({
      query: (params) => ({ url: '/machines', params }),
      providesTags: ['Machine'],
    }),
    getMachine: builder.query({
      query: (id) => ({ url: `/machines/${id}` }),
      providesTags: (r, e, id) => ['Machine', { type: 'Machine', id }],
    }),
    getMachineLookup: builder.query({
      query: (params) => ({ url: '/machines/lookup/list', params }),
      providesTags: ['Machine'],
    }),
    createMachine: builder.mutation({
      query: (body) => ({ url: '/machines', method: 'POST', body }),
      invalidatesTags: ['Machine', 'MachineOperator', 'DprMaster'],
    }),
    updateMachine: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/machines/${id}`, method: 'PATCH', body }),
      invalidatesTags: (r, e, { id }) => ['Machine', { type: 'Machine', id }, 'MachineOperator', 'DprMaster'],
    }),
    deleteMachine: builder.mutation({
      query: (id) => ({ url: `/machines/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Machine', 'MachineOperator', 'DprMaster'],
    }),

    // ── Assigned operators ────────────────────────────────────
    getMachineOperators: builder.query({
      query: (id) => ({ url: `/machines/${id}/operators` }),
      providesTags: (r, e, id) => [{ type: 'Machine', id }],
    }),
    assignOperatorToMachine: builder.mutation({
      query: ({ id, operatorId }) => ({ url: `/machines/${id}/operators`, method: 'POST', body: { operatorId } }),
      invalidatesTags: (r, e, { id }) => ['Machine', { type: 'Machine', id }, 'MachineOperator', 'DprMaster'],
    }),
    unassignOperatorFromMachine: builder.mutation({
      query: ({ id, operatorId }) => ({ url: `/machines/${id}/operators/${operatorId}`, method: 'DELETE' }),
      invalidatesTags: (r, e, { id }) => ['Machine', { type: 'Machine', id }, 'MachineOperator', 'DprMaster'],
    }),
  }),
});

export const {
  useGetMachinesQuery,
  useGetMachineQuery,
  useGetMachineLookupQuery,
  useCreateMachineMutation,
  useUpdateMachineMutation,
  useDeleteMachineMutation,
  useGetMachineOperatorsQuery,
  useAssignOperatorToMachineMutation,
  useUnassignOperatorFromMachineMutation,
} = machineApi;
