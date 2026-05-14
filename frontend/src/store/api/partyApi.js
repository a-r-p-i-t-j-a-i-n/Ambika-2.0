import { baseApi } from './baseApi';

export const partyApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getParties: builder.query({
      query: (params) => ({
        url: '/parties',
        params,
      }),
      providesTags: ['Party'],
    }),
    getPartyById: builder.query({
      query: (id) => `/parties/${id}`,
      providesTags: (result, error, id) => [{ type: 'Party', id }],
    }),
    createParty: builder.mutation({
      query: (body) => ({
        url: '/parties',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Party'],
    }),
    updateParty: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/parties/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Party'],
    }),
  }),
});

export const { 
  useGetPartiesQuery, 
  useGetPartyByIdQuery,
  useCreatePartyMutation, 
  useUpdatePartyMutation 
} = partyApi;
