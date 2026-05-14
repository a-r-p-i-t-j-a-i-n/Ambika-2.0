import { baseApi } from './baseApi';

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
    }),
    getMe: builder.query({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),
    getEmployees: builder.query({
      query: () => '/auth/employees',
      providesTags: ['Employees'],
    }),
    createEmployee: builder.mutation({
      query: (employeeData) => ({
        url: '/auth/employees',
        method: 'POST',
        body: employeeData,
      }),
      invalidatesTags: ['Employees'],
    }),
  }),
});

export const { useLoginMutation, useGetMeQuery, useGetEmployeesQuery, useCreateEmployeeMutation } = authApi;
