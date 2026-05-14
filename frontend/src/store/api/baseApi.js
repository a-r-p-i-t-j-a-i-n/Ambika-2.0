import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
    prepareHeaders: (headers) => {
      const token = localStorage.getItem('token');
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: ['Party', 'SKU', 'Order', 'DispatchControl', 'DispatchDashboard', 'Comparison', 'Challan', 'Invoice', 'Auth', 'PPC', 'Shipment', 'Payment', 'TransportBill', 'Employees'],
  endpoints: () => ({}),
});
