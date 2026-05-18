import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  user: null,
  token: localStorage.getItem('token') || null,
  isAuthenticated: !!localStorage.getItem('token'),
  // Access-control v2
  permissions: [], // string[] of permission slugs
  isRoot: false,   // true for MD (root role)
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action) => {
      const { user, token } = action.payload;
      state.user = user;
      state.token = token;
      state.isAuthenticated = true;
      localStorage.setItem('token', token);
    },
    setAccess: (state, action) => {
      const { permissions, isRoot, user } = action.payload || {};
      state.permissions = Array.isArray(permissions) ? permissions : [];
      state.isRoot = !!isRoot;
      if (user) state.user = { ...(state.user || {}), ...user };
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.permissions = [];
      state.isRoot = false;
      localStorage.removeItem('token');
    },
  },
});

export const { setCredentials, setAccess, logout } = authSlice.actions;
export default authSlice.reducer;
