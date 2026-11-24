import React from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import baseTheme from '../../theme';
import { PFMS } from './pfmsTheme';
import { GRID_SKELETON_OVERLAY } from '../o2d-fms/components/gridSkeleton';

// The O2D Master Data / Step Board table (fluentTableSx values).
const T = {
  headBg: '#f2f6fc', headInk: '#3b4a63', headRule: '#dfe7f2', rowRule: '#edf0f5', hover: '#f1f6fe',
};
const HEAD_TEXT = {
  fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: T.headInk,
};

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
    // Chips = the shared O2D pill geometry (22px, fully rounded, 0.7rem bold).
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999 },
        sizeSmall: { height: 22, fontSize: '0.7rem', fontWeight: 700 },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-root': {
            backgroundColor: T.headBg,
            ...HEAD_TEXT,
            whiteSpace: 'nowrap',
            borderBottom: `1px solid ${T.headRule}`,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${T.rowRule}` },
        body: { fontSize: '0.8rem', color: PFMS.body },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:hover': { backgroundColor: T.hover } },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        selectLabel: { fontSize: '0.74rem', color: PFMS.sub },
        displayedRows: { fontSize: '0.74rem', color: PFMS.sub },
        select: { fontSize: '0.74rem' },
      },
    },
    MuiDataGrid: {
      // While a list loads (a new step, a KPI card filter, a search) the grid shows
      // skeleton rows instead of the previous rows under a spinner. Merged per
      // slot, so a list's own slotProps (e.g. noRowsOverlay) still apply.
      defaultProps: { slotProps: { loadingOverlay: GRID_SKELETON_OVERLAY } },
      styleOverrides: {
        root: {
          border: `1px solid ${PFMS.line}`,
          borderRadius: 8,
          fontSize: '0.8rem',
          '--DataGrid-containerBackground': T.headBg,
          '--DataGrid-rowBorderColor': T.rowRule,
          // Header: soft-blue band, uppercase 0.68rem, the header rule colour.
          '& .MuiDataGrid-columnHeaders': { '--DataGrid-rowBorderColor': T.headRule },
          '& .MuiDataGrid-columnHeader': { backgroundColor: T.headBg },
          '& .MuiDataGrid-columnHeaderTitle': HEAD_TEXT,
          // Resize handles stay, shown on hover only — no grid lines in the header.
          '& .MuiDataGrid-columnSeparator': { opacity: 0 },
          '& .MuiDataGrid-columnHeader:hover .MuiDataGrid-columnSeparator': { opacity: 1 },
          '& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within, & .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          // One cell box for every list: content centred on the row. MUI X sets
          // the cell's line-height to the row height (49px on a 50px row), and
          // any span/Box wrapper in a cell inherits that strut, so a chip or
          // button inside it sits on a 49px line instead of the row's centre.
          '& .MuiDataGrid-cell': {
            borderBottom: `1px solid ${T.rowRule}`,
            display: 'flex',
            alignItems: 'center',
            lineHeight: 1.43,
            color: PFMS.body,
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
          '& .MuiDataGrid-row:hover': { backgroundColor: T.hover },
          // Footer + pagination: white, hairline, the O2D 0.74rem pager text.
          '& .MuiDataGrid-footerContainer': { borderTop: `1px solid ${T.rowRule}`, backgroundColor: PFMS.surface, minHeight: 52 },
          '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows, & .MuiTablePagination-select': { fontSize: '0.74rem', color: PFMS.sub },
          '& .MuiDataGrid-overlay': { color: PFMS.sub, fontSize: '0.8rem' },
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
