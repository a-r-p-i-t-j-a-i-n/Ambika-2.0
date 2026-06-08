import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './api/baseApi.js';
import authReducer from './slices/authSlice.js';

// Import all API slices to trigger endpoint injection
import './api/authApi';
import './api/orderApi';
import './api/partyApi';
import './api/skuApi';
import './api/ppcApi';
import './api/fmsApi';
import './api/dispatchControlApi';
import './api/accessControlApi';
import './api/pricingApi';
import './api/quoteApi';
import './api/o2dFmsApi';
import './api/notificationApi';

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: authReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
});
