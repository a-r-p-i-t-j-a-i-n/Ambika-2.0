import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { logout } from '../slices/authSlice';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
  prepareHeaders: (headers) => {
    const token = localStorage.getItem('token');
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

// Wrap so an expired / invalid token (401) anywhere clears the session instead
// of leaving the user stuck in a half-loaded shell. The login call is exempt
// (a bad password is a normal 401, not a stale session).
const baseQueryWithAuthGuard = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === 'string' ? args : args?.url;
  const isLoginCall = String(url || '').includes('/auth/login');
  if (result.error && result.error.status === 401 && !isLoginCall) {
    api.dispatch(logout());
  }
  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuthGuard,
  tagTypes: [
    'Party', 'Vendor', 'SKU', 'Order', 'DispatchControl', 'DispatchDashboard', 'Comparison',
    'Schedule', 'Challan', 'Invoice', 'SalesInvoice', 'Auth', 'PPC', 'Shipment', 'Payment',
    'TransportBill', 'Employees',
    'AccessUsers', 'AccessRoles', 'AccessAudit',
    'Pricing', 'PriceHistory', 'PriceApprovals', 'Quote', 'CompanySettings',
    'PricingReviewers', 'PricingDocuments', 'PricingAnalytics',
    'O2DProcess', 'O2DStepDef', 'O2DMyTasks', 'O2DDashboard', 'O2DTemplate', 'Notification',
    'Indent', 'IndentStats','OrderIntake',
    'PurchaseOrder', 'PurchaseOrderStats',
    'FollowUp', 'FollowUpStats',
    'ProformaInvoice', 'ProformaInvoiceStats',
    'AdvancePayment', 'AdvancePaymentStats',

    'Grn', 'GrnStats', 'InventoryStock', 'InventoryMovement',
    'IncomingQc', 'IncomingQcStats',
    'VendorInvoice', 'VendorInvoiceStats', 'Voucher', 'VoucherStats',
    'TallyEntry', 'TallyEntryStats', 'FinalPayment', 'FinalPaymentStats',

  ],
  endpoints: () => ({}),
});
