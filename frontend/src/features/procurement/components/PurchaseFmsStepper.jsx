import React, { useEffect, useRef } from 'react';
import { Box, Typography, ButtonBase, useTheme, alpha } from '@mui/material';
import { ChevronRight } from 'lucide-react';
import { pfmsCardSx, PFMS } from '../pfmsTheme';

const CIRCLE = 26;
const COMPLETED = '#16a34a';

// Horizontal, click-to-navigate step rail for the Purchase FMS workflow.
// A step's visual state is purely positional (index vs. activeIndex) — steps
// before the active one read as "completed", not as a record of actual data
// completeness, since each step is an independent, reorderable screen.
//
// The rail scrolls sideways inside its own card rather than widening the page:
// with 8 steps it cannot fit a narrow viewport, and a page-level horizontal
// scrollbar is exactly what frontend/e2e/layoutOverflow.e2e.mjs forbids. The
// fading right edge signals there is more to scroll to.
const PurchaseFmsStepper = ({ steps, activeIndex, onStepClick, counts }) => {
  const theme = useTheme();
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeIndex]);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{
          ...pfmsCardSx,
          px: { xs: 1, md: 1.5 },
          py: 0.75,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': { height: 5 },
          '&::-webkit-scrollbar-thumb': { background: alpha(theme.palette.primary.main, 0.18), borderRadius: 8 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', width: 'max-content' }}>
          {steps.map((step, i) => {
            const state = i < activeIndex ? 'completed' : i === activeIndex ? 'active' : 'upcoming';
            const isLast = i === steps.length - 1;
            const count = counts?.[step.slug];
            return (
              <React.Fragment key={step.slug}>
                <ButtonBase
                  ref={state === 'active' ? activeRef : undefined}
                  onClick={() => onStepClick(step.slug)}
                  aria-current={state === 'active' ? 'step' : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.9,
                    px: 1.1,
                    py: 0.9,
                    borderRadius: '7px',
                    flexShrink: 0,
                    scrollSnapAlign: 'center',
                    position: 'relative',
                    transition: 'background-color 150ms ease',
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                    '&.Mui-focusVisible': {
                      outline: `2px solid ${theme.palette.primary.main}`,
                      outlineOffset: '-2px',
                    },
                    // Active step underline — the reference's tab-like marker.
                    '&::after': state === 'active' ? {
                      content: '""',
                      position: 'absolute',
                      left: 10,
                      right: 10,
                      bottom: 1,
                      height: 2,
                      borderRadius: 2,
                      bgcolor: 'primary.main',
                    } : undefined,
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
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      lineHeight: 1,
                      bgcolor:
                        state === 'active' ? 'primary.main'
                        : state === 'completed' ? alpha(COMPLETED, 0.12)
                        : PFMS.surfaceAlt,
                      color:
                        state === 'active' ? '#fff'
                        : state === 'completed' ? COMPLETED
                        : PFMS.sub,
                      border: state === 'active'
                        ? 'none'
                        : `1.5px solid ${state === 'completed' ? alpha(COMPLETED, 0.4) : PFMS.line}`,
                    }}
                  >
                    {i + 1}
                  </Box>
                  <Typography
                    sx={{
                      fontSize: '0.8rem',
                      fontWeight: state === 'active' ? 700 : 600,
                      color:
                        state === 'active' ? 'primary.main'
                        : state === 'completed' ? PFMS.ink
                        : PFMS.sub,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.label}
                    {count != null && (
                      <Box
                        component="span"
                        sx={{ ml: 0.5, fontWeight: 600, fontSize: '0.74rem', color: PFMS.faint }}
                      >
                        ({count})
                      </Box>
                    )}
                  </Typography>
                </ButtonBase>
                {!isLast && (
                  <ChevronRight
                    size={15}
                    color={PFMS.faint}
                    style={{ flexShrink: 0, margin: '0 1px' }}
                    aria-hidden="true"
                  />
                )}
              </React.Fragment>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

export default PurchaseFmsStepper;
