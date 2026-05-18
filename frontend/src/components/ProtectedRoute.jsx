import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AccessHydrator from './AccessHydrator';

const ProtectedRoute = () => {
  const { isAuthenticated } = useSelector((state) => state.auth);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AccessHydrator>
      <Outlet />
    </AccessHydrator>
  );
};

export default ProtectedRoute;
