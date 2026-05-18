import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useGetMyAccessQuery } from '../store/api/accessControlApi';
import { setAccess } from '../store/slices/authSlice';

/**
 * Mounted inside ProtectedRoute. Whenever the user is authenticated,
 * fetch `/access-control/me` once and push permissions into the auth slice.
 * Components throughout the app then read permissions via `usePermission`.
 */
const AccessHydrator = ({ children }) => {
  const dispatch = useDispatch();
  const isAuthed = useSelector((s) => s.auth.isAuthenticated);
  const { data } = useGetMyAccessQuery(undefined, { skip: !isAuthed });

  useEffect(() => {
    if (!data?.data) return;
    dispatch(setAccess({
      permissions: data.data.permissions || [],
      isRoot:      !!data.data.isRoot,
      user:        data.data.user || null,
    }));
  }, [data, dispatch]);

  return children;
};

export default AccessHydrator;
