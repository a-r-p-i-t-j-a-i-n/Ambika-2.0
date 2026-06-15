import React, { forwardRef, useCallback } from 'react';
import { SnackbarContent, useSnackbar } from 'notistack';
import { Box, Typography, IconButton } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

/**
 * Custom notistack toast cards for the Purchase FMS.
 *
 * Mirrors the app's card language (e.g. KPI cards): white surface, 14px radius,
 * 1px divider border, soft navy shadow, and a tinted icon square — no loud
 * accent rails or generic titles, so toasts read as part of the UI rather than
 * a bolt-on. The only colored flourish is a thin auto-dismiss progress bar.
 *
 * Registered against notistack variants via the `Components` prop in main.jsx,
 * so every existing enqueueSnackbar('…', { variant }) call is upgraded for free.
 */
const DURATION = 3500; // keep in sync with SnackbarProvider autoHideDuration

const VARIANTS = {
  success: { color: '#0f766e', Icon: CheckCircle2 },
  error:   { color: '#be123c', Icon: XCircle },
  warning: { color: '#b45309', Icon: AlertTriangle },
  info:    { color: '#0369a1', Icon: Info },
  default: { color: '#1d4ed8', Icon: Info },
};

const makeToast = (variant) =>
  forwardRef(function Toast(props, ref) {
    const { closeSnackbar } = useSnackbar();
    // Drop notistack-injected props so they aren't forwarded to the DOM node.
    const {
      id, message, persist, style, className,
      // eslint-disable-next-line no-unused-vars
      variant: _v, iconVariant, hideIconVariant, anchorOrigin, autoHideDuration, action,
    } = props;
    const { color, Icon } = VARIANTS[variant] || VARIANTS.default;
    const dismiss = useCallback(() => closeSnackbar(id), [id, closeSnackbar]);

    return (
      <SnackbarContent ref={ref} role="alert" style={style} className={className}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            width: '100%',
            minWidth: 300,
            maxWidth: 440,
            p: 1.5,
            pr: 1,
            bgcolor: 'background.paper',
            borderRadius: '14px',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 12px 32px rgba(11, 37, 69, 0.14)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Tinted icon square — same treatment as the app's KPI cards. */}
          <Box
            sx={{
              flexShrink: 0,
              width: 40, height: 40,
              borderRadius: '10px',
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(color, 0.1),
              color,
            }}
          >
            <Icon size={20} />
          </Box>

          <Typography
            sx={{
              flexGrow: 1,
              minWidth: 0,
              fontSize: '0.8125rem',
              fontWeight: 600,
              lineHeight: 1.45,
              color: 'text.primary',
              wordBreak: 'break-word',
            }}
          >
            {message}
          </Typography>

          <IconButton
            size="small"
            onClick={dismiss}
            sx={{ flexShrink: 0, color: 'text.disabled', '&:hover': { color: 'text.primary', bgcolor: alpha('#0b2545', 0.06) } }}
          >
            <X size={15} />
          </IconButton>

          {/* Auto-dismiss countdown — the lone colored flourish. */}
          {!persist && (
            <Box
              sx={{
                position: 'absolute',
                left: 0, bottom: 0,
                height: 3,
                bgcolor: alpha(color, 0.9),
                borderRadius: '0 999px 999px 0',
                '@keyframes toastCountdown': { from: { width: '100%' }, to: { width: '0%' } },
                animation: `toastCountdown ${DURATION}ms linear forwards`,
              }}
            />
          )}
        </Box>
      </SnackbarContent>
    );
  });

export const SuccessToast = makeToast('success');
export const ErrorToast   = makeToast('error');
export const WarningToast = makeToast('warning');
export const InfoToast    = makeToast('info');
export const DefaultToast = makeToast('default');

export const toastComponents = {
  success: SuccessToast,
  error: ErrorToast,
  warning: WarningToast,
  info: InfoToast,
  default: DefaultToast,
};

export default toastComponents;
