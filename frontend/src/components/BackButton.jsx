import React from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Reusable "Back" control. Goes to the PREVIOUS page in history (navigate(-1));
 * if there's no history (e.g. the user deep-linked in), it falls back to `to`
 * (default: dashboard) so the button never dead-ends.
 *
 * Props:
 *   to        — fallback route when there's no history (default '/dashboard')
 *   label     — button text (default 'Back'); ignored when `iconOnly`
 *   iconOnly  — render a compact icon button (for tight headers / dark heroes)
 *   color     — MUI colour ('inherit' works well on dark hero backgrounds)
 */
const BackButton = ({ to = '/dashboard', label = 'Back', iconOnly = false, color = 'inherit', variant = 'outlined', sx }) => {
  const navigate = useNavigate();
  const goBack = () => {
    // window.history.state.idx > 0 means there IS a previous entry to go back to.
    const canGoBack = typeof window !== 'undefined' && window.history.state && window.history.state.idx > 0;
    if (canGoBack) navigate(-1);
    else navigate(to);
  };

  if (iconOnly) {
    return (
      <Tooltip title="Back">
        <IconButton onClick={goBack} size="small" sx={{ color, ...sx }} aria-label="Back">
          <ArrowLeft size={18} />
        </IconButton>
      </Tooltip>
    );
  }
  return (
    <Button onClick={goBack} startIcon={<ArrowLeft size={16} />} size="small" variant={variant} color={color} sx={sx}>
      {label}
    </Button>
  );
};

export default BackButton;
