import React from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import baseTheme from '../../theme';
import { PFMS } from './pfmsTheme';

// Applies O2D FMS's structural design language (surfaces, hairline borders,
// compact table header, tighter corner radius) to every Purchase FMS screen —
// list, detail, drawer and dialog alike, since MUI theme context reaches
// Dialog/Drawer/Menu portals too. This is additive to the app's base theme
// (palette.primary, typography font, shadows, etc. are untouched); it only
// overrides the handful of tokens O2D FMS itself overrides locally.
const pfmsTheme = createTheme(baseTheme, {
  palette: {
    divider: PFMS.line,
    background: { default: PFMS.canvas, paper: PFMS.surface },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { border: `1px solid ${PFMS.line}` },
        rounded: { borderRadius: 8 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: `1px solid ${PFMS.line}`, borderRadius: 8 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-root': {
            backgroundColor: PFMS.surfaceAlt,
            color: PFMS.sub,
            fontWeight: 800,
            fontSize: '0.66rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: `1px solid ${PFMS.line}`,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${PFMS.lineSoft}` },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: PFMS.surfaceAlt } },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: `1px solid ${PFMS.line}`,
          borderRadius: 8,
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: PFMS.surfaceAlt,
            color: PFMS.sub,
            fontWeight: 800,
            fontSize: '0.66rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: `1px solid ${PFMS.line}`,
          },
          // One cell box for every list: content centred on the row. MUI X sets
          // the cell's line-height to the row height (49px on a 50px row), and
          // any span/Box wrapper in a cell inherits that strut, so a chip or
          // button inside it sits on a 49px line instead of the row's centre.
          '& .MuiDataGrid-cell': {
            borderBottom: `1px solid ${PFMS.lineSoft}`,
            display: 'flex',
            alignItems: 'center',
            lineHeight: 1.43,
          },
          // A plain text value is one line, ellipsised: without minWidth 0 a flex
          // item never shrinks, so a long value was clipped mid-glyph (or, in the
          // auto-height grids, wrapped and grew the row).
          '& .MuiDataGrid-cell > .MuiTypography-root': {
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          '& .MuiDataGrid-row:hover': { backgroundColor: PFMS.surfaceAlt },
          '& .MuiDataGrid-footerContainer': { borderTop: `1px solid ${PFMS.line}`, backgroundColor: PFMS.surfaceAlt },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: PFMS.surface, backgroundImage: 'none' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 8, border: `1px solid ${PFMS.line}` },
      },
    },
  },
});

const PurchaseFmsThemeScope = () => (
  <ThemeProvider theme={pfmsTheme}>
    <Outlet />
  </ThemeProvider>
);

export default PurchaseFmsThemeScope;
