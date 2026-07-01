import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useGetMyAccessQuery } from '../store/api/accessControlApi';
import { setAccess, logout } from '../store/slices/authSlice';
import AppLoader from './AppLoader';

/**
 * Mounted  inside ProtectedRoute. When authenticated, fetch `/access-control/me`
 * once and push the user + permissions into the auth slice.
 *
 * On a fresh page load the auth slice has a token but no `user` yet, so we hold
 * the app behind the loader until this resolves — otherwise the shell renders
 * with "Loading…"/"Member" placeholders. If the token is stale (401/403) we log
 * out cleanly so the user lands on /login instead of being stuck.
 */
const AccessHydrator = ({ children }) => {
  const dispatch = useDispatch();
  const isAuthed = useSelector((s) => s.auth.isAuthenticated);
  const hasUser = useSelector((s) => !!s.auth.user);
  const { data, error, isLoading } = useGetMyAccessQuery(undefined, { skip: !isAuthed });

  useEffect(() => {
    if (error) {
      const status = error.status;
      // 401 already triggers logout in the base query; cover 403 too.
      if (status === 401 || status === 403) dispatch(logout());
      return;
    }
    if (data?.data) {
      dispatch(setAccess({
        permissions: data.data.permissions || [],
        isRoot:      !!data.data.isRoot,
        user:        data.data.user || null,
      }));
    }
  }, [data, error, dispatch]);

  // First load with a token but no hydrated user yet → show the branded loader
  // rather than the half-populated shell.
  if (isAuthed && !hasUser && (isLoading || (!data && !error))) {
    return <AppLoader />;
  }

  return children;
};

export default AccessHydrator;
