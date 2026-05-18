import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { ShieldAlert } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermission';

/**
 * Route-level permission gate.
 *
 *   <RequirePermission slug="accessControl.manageUsers">
 *     <AccessControlPage />
 *   </RequirePermission>
 *
 * If the user lacks the permission and `fallback` is "redirect" (default),
 * they are sent to /dashboard. Otherwise an inline "Access denied" panel
 * is rendered.
 */
const RequirePermission = ({ slug, slugs, fallback = 'redirect', children }) => {
  const { can, canAny } = usePermissions();
  const allowed = slug ? can(slug) : canAny(...(slugs || []));
  if (allowed) return children;

  if (fallback === 'redirect') return <Navigate to="/dashboard" replace />;

  return (
    <Box
      sx={{
        minHeight: '70vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, p: 4, textAlign: 'center',
      }}
    >
      <Box sx={{
        width: 64, height: 64, borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        bgcolor: 'rgba(190, 18, 60, 0.08)', color: 'error.main',
      }}>
        <ShieldAlert size={28} />
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>You don't have access</Typography>
      <Typography sx={{ color: 'text.secondary', maxWidth: 480 }}>
        This area is restricted. Ask your Managing Director to grant the required permission
        from Access Control.
      </Typography>
      <Button variant="outlined" onClick={() => window.history.back()}>Go back</Button>
    </Box>
  );
};

export default RequirePermission;
