import { baseApi } from './baseApi';

export const accessControlApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    // ── My own permissions (used on boot to hydrate the auth slice) ──
    getMyAccess: builder.query({
      query: () => '/access-control/me',
      providesTags: ['Auth'],
    }),

    // ── Permission registry (for matrix + drawer) ────────────────────
    getPermissionRegistry: builder.query({
      query: () => '/access-control/registry',
    }),

    // ── Users ────────────────────────────────────────────────────────
    listAccessUsers: builder.query({
      query: (params = {}) => ({ url: '/access-control/users', params }),
      providesTags: ['AccessUsers'],
    }),
    getAccessUser: builder.query({
      query: (id) => `/access-control/users/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'AccessUsers', id }],
    }),
    inviteUser: builder.mutation({
      query: (body) => ({ url: '/access-control/users', method: 'POST', body }),
      invalidatesTags: ['AccessUsers', 'AccessAudit'],
    }),
    updateAccessUser: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/access-control/users/${id}`, method: 'PATCH', body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        'AccessUsers',
        { type: 'AccessUsers', id },
        'AccessAudit',
      ],
    }),
    resetUserPassword: builder.mutation({
      query: ({ id, newPassword }) => ({
        url: `/access-control/users/${id}/reset-password`, method: 'POST',
        body: { newPassword },
      }),
      invalidatesTags: ['AccessAudit'],
    }),

    // ── Roles ────────────────────────────────────────────────────────
    listRoles: builder.query({
      query: () => '/access-control/roles',
      providesTags: ['AccessRoles'],
    }),
    getRole: builder.query({
      query: (id) => `/access-control/roles/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'AccessRoles', id }],
    }),
    createRole: builder.mutation({
      query: (body) => ({ url: '/access-control/roles', method: 'POST', body }),
      invalidatesTags: ['AccessRoles', 'AccessAudit'],
    }),
    updateRole: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/access-control/roles/${id}`, method: 'PATCH', body,
      }),
      invalidatesTags: (_r, _e, { id }) => [
        'AccessRoles',
        { type: 'AccessRoles', id },
        'AccessUsers',
        'AccessAudit',
      ],
    }),
    deleteRole: builder.mutation({
      query: (id) => ({ url: `/access-control/roles/${id}`, method: 'DELETE' }),
      invalidatesTags: ['AccessRoles', 'AccessAudit'],
    }),

    // ── Audit Log ────────────────────────────────────────────────────
    getAccessAuditLog: builder.query({
      query: (params = {}) => ({ url: '/access-control/audit-log', params }),
      providesTags: ['AccessAudit'],
    }),
  }),
});

export const {
  useGetMyAccessQuery,
  useGetPermissionRegistryQuery,
  useListAccessUsersQuery,
  useGetAccessUserQuery,
  useInviteUserMutation,
  useUpdateAccessUserMutation,
  useResetUserPasswordMutation,
  useListRolesQuery,
  useGetRoleQuery,
  useCreateRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useGetAccessAuditLogQuery,
} = accessControlApi;
