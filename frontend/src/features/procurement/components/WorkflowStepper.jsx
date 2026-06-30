import React from 'react';
import { Box, Typography } from '@mui/material';
import { Check, X, AlertTriangle } from 'lucide-react';
import { alpha } from '@mui/material/styles';

const STATE_COLOR = {
  completed: '#16a34a',
  active:    '#2563eb',
  error:     '#dc2626',
  warning:   '#d97706',
  pending:   '#94a3b8',
};

const StepIcon = ({ state }) => {
  const color = STATE_COLOR[state] || STATE_COLOR.pending;
  return (
    <Box sx={{
      width: 28, height: 28, borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      bgcolor: state === 'pending' ? 'transparent' : alpha(color, 0.12),
      border: `2px solid ${color}`,
      color,
      flexShrink: 0,
    }}>
      {state === 'completed' && <Check size={13} strokeWidth={2.5} />}
      {state === 'error'     && <X size={13} strokeWidth={2.5} />}
      {state === 'warning'   && <AlertTriangle size={11} strokeWidth={2.5} />}
      {state === 'active'    && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />}
    </Box>
  );
};

const WorkflowStepper = ({ steps = [], sx = {} }) => {
  if (!steps.length) return null;

  return (
    <Box sx={{
      bgcolor: '#fff', borderRadius: '16px', p: 2.5,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      ...sx,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {steps.map((step, i) => (
          <React.Fragment key={step.key}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0, px: 0.5 }}>
              <StepIcon state={step.state} />
              <Typography sx={{
                mt: 0.75,
                fontSize: '0.7rem',
                fontWeight: step.state === 'active' ? 700 : 600,
                color: step.state === 'active'    ? 'primary.main'
                     : step.state === 'error'     ? 'error.main'
                     : step.state === 'warning'   ? 'warning.main'
                     : step.state === 'completed' ? 'text.primary'
                     : 'text.disabled',
                textAlign: 'center',
                lineHeight: 1.3,
              }}>
                {step.label}
              </Typography>
              {step.sublabel && (
                <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', textAlign: 'center', mt: 0.25, lineHeight: 1.2 }}>
                  {step.sublabel}
                </Typography>
              )}
            </Box>
            {i < steps.length - 1 && (
              <Box sx={{
                height: '2px',
                flex: '1 1 0',
                mt: '13px',
                minWidth: 12,
                bgcolor: step.state === 'completed' ? '#16a34a' : '#e2e8f0',
              }} />
            )}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};

export default WorkflowStepper;
