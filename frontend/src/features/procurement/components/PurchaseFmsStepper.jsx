import React, { useEffect, useRef } from 'react';
import { Box, Typography, ButtonBase, useTheme, alpha } from '@mui/material';
import { pfmsCardSx } from '../pfmsTheme';

const CIRCLE = 30;
const COMPLETED = '#16a34a';

// Horizontal, click-to-navigate step rail for the Purchase FMS workflow.
// A step's visual state is purely positional (index vs. activeIndex) — steps
// before the active one read as "completed", not as a record of actual data
// completeness, since each step is an independent, reorderable screen.
const PurchaseFmsStepper = ({ steps, activeIndex, onStepClick, counts }) => {
  const theme = useTheme();
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeIndex]);

  return (
    <Box
      sx={{
        ...pfmsCardSx,
        px: { xs: 1.25, md: 2 },
        py: 1.5,
        overflowX: 'auto',
        overflowY: 'hidden',
        '&::-webkit-scrollbar': { height: 6 },
        '&::-webkit-scrollbar-thumb': { background: alpha(theme.palette.primary.main, 0.18), borderRadius: 8 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', width: 'max-content' }}>
        {steps.map((step, i) => {
          const state = i < activeIndex ? 'completed' : i === activeIndex ? 'active' : 'upcoming';
          const isLast = i === steps.length - 1;
          return (
            <React.Fragment key={step.slug}>
              <ButtonBase
                ref={state === 'active' ? activeRef : undefined}
                onClick={() => onStepClick(step.slug)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  borderRadius: 2,
                  flexShrink: 0,
                  transition: 'background-color 150ms ease',
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                }}
              >
                <Box
                  sx={{
                    width: CIRCLE,
                    height: CIRCLE,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    bgcolor:
                      state === 'active' ? 'primary.main'
                      : state === 'completed' ? alpha(COMPLETED, 0.12)
                      : alpha(theme.palette.text.disabled, 0.10),
                    color:
                      state === 'active' ? '#fff'
                      : state === 'completed' ? COMPLETED
                      : 'text.disabled',
                    border: state === 'active'
                      ? 'none'
                      : `1.5px solid ${state === 'completed' ? alpha(COMPLETED, 0.4) : theme.palette.divider}`,
                    boxShadow: state === 'active' ? `0 3px 10px ${alpha(theme.palette.primary.main, 0.35)}` : 'none',
                  }}
                >
                  {i + 1}
                </Box>
                <Typography
                  sx={{
                    fontSize: '0.8rem',
                    fontWeight: state === 'active' ? 700 : 600,
                    color:
                      state === 'active' ? 'primary.dark'
                      : state === 'completed' ? 'text.primary'
                      : 'text.disabled',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {step.label}
                  {counts?.[step.slug] != null && (
                    <Box
                      component="span"
                      sx={{ ml: 0.5, fontWeight: 600, opacity: 0.65 }}
                    >
                      ({counts[step.slug]})
                    </Box>
                  )}
                </Typography>
              </ButtonBase>
              {!isLast && (
                <Box
                  sx={{
                    width: { xs: 18, md: 28 },
                    height: '2px',
                    mx: 0.5,
                    flexShrink: 0,
                    borderRadius: 1,
                    bgcolor: i < activeIndex ? COMPLETED : theme.palette.divider,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
};

export default PurchaseFmsStepper;
