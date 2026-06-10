import { createTheme, alpha } from '@mui/material/styles';

// ─────────────────────────────────────────────────────────────────────────────
// Ambika Dispatch — Premium Blue Design System
// Principles:
//  • No pure black anywhere. Deepest tone is navy (#0b2545) reserved for canvas accents.
//  • All foreground text resolves to a blue family (deep → muted).
//  • Surfaces are layered (paper, raised, ghost) with soft borders, not shadows.
//  • Motion is restrained: subtle 180ms easings, no glow effects.
// ─────────────────────────────────────────────────────────────────────────────

const BLUE = {
  ink:        '#0b2545', // deepest readable navy — replaces black for headings
  body:       '#1e3a8a', // primary body text — strong indigo blue
  text:       '#1d4ed8', // standard text color (per requirement: text in blue)
  muted:      '#475a8a', // secondary blue-gray for captions
  faint:      '#7d8fb3', // disabled / hint
  line:       '#dbe4f3', // soft blue divider
  lineSoft:   '#eaf0fb',
  surface:    '#ffffff',
  surfaceAlt: '#f5f8ff', // canvas tint
  canvas:     '#eef3fc', // app background (cool, premium)
  primary:    '#1d4ed8',
  primaryDk:  '#1e3a8a',
  primaryLt:  '#3b82f6',
  accent:     '#2563eb',
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: BLUE.primary,
      light: BLUE.primaryLt,
      dark: BLUE.primaryDk,
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#5b6cff',
      light: '#8b97ff',
      dark: '#3b4bd6',
      contrastText: '#ffffff',
    },
    success: {
      main: '#0f766e',
      light: '#5eead4',
      dark: '#115e59',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#b45309',
      light: '#fcd34d',
      dark: '#92400e',
      contrastText: '#ffffff',
    },
    error: {
      main: '#be123c',
      light: '#fda4af',
      dark: '#9f1239',
      contrastText: '#ffffff',
    },
    info: {
      main: '#0369a1',
      light: '#7dd3fc',
      dark: '#075985',
      contrastText: '#ffffff',
    },
    background: {
      default: BLUE.canvas,
      paper: BLUE.surface,
    },
    text: {
      // Per requirement: text in blue. Avoid pure black.
      primary: BLUE.ink,
      secondary: BLUE.muted,
      disabled: BLUE.faint,
    },
    divider: BLUE.line,
    common: {
      // override common.black so any consumer that reads it picks a navy tone
      black: BLUE.ink,
      white: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Inter", "Outfit", "Plus Jakarta Sans", system-ui, sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em', color: BLUE.ink },
    h2: { fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.025em', color: BLUE.ink },
    h3: { fontSize: '1.5rem', fontWeight: 750, letterSpacing: '-0.02em', color: BLUE.ink },
    h4: { fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.015em', color: BLUE.ink },
    h5: { fontSize: '1.125rem', fontWeight: 700, color: BLUE.ink },
    h6: { fontSize: '1rem', fontWeight: 700, color: BLUE.ink },
    subtitle1: { fontWeight: 600, color: BLUE.body },
    subtitle2: { fontWeight: 600, color: BLUE.body },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    body1: { lineHeight: 1.6, color: BLUE.text },
    body2: { lineHeight: 1.55, color: BLUE.text },
    caption: { color: BLUE.muted, fontWeight: 500 },
    overline: { color: BLUE.muted, fontWeight: 700, letterSpacing: '0.08em' },
  },
  shape: {
    borderRadius: 14,
  },
  shadows: [
    'none',
    '0 1px 2px rgba(30, 58, 138, 0.06)',
    '0 2px 6px rgba(30, 58, 138, 0.07)',
    '0 4px 10px rgba(30, 58, 138, 0.08)',
    '0 6px 16px rgba(30, 58, 138, 0.08)',
    '0 8px 22px rgba(30, 58, 138, 0.09)',
    '0 10px 28px rgba(30, 58, 138, 0.10)',
    '0 12px 32px rgba(30, 58, 138, 0.10)',
    '0 14px 36px rgba(30, 58, 138, 0.11)',
    '0 16px 40px rgba(30, 58, 138, 0.11)',
    '0 18px 44px rgba(30, 58, 138, 0.12)',
    '0 20px 48px rgba(30, 58, 138, 0.12)',
    '0 22px 52px rgba(30, 58, 138, 0.13)',
    '0 24px 56px rgba(30, 58, 138, 0.13)',
    '0 26px 60px rgba(30, 58, 138, 0.14)',
    '0 28px 64px rgba(30, 58, 138, 0.14)',
    '0 30px 68px rgba(30, 58, 138, 0.15)',
    '0 32px 72px rgba(30, 58, 138, 0.15)',
    '0 34px 76px rgba(30, 58, 138, 0.16)',
    '0 36px 80px rgba(30, 58, 138, 0.16)',
    '0 38px 84px rgba(30, 58, 138, 0.17)',
    '0 40px 88px rgba(30, 58, 138, 0.17)',
    '0 42px 92px rgba(30, 58, 138, 0.18)',
    '0 44px 96px rgba(30, 58, 138, 0.18)',
    '0 46px 100px rgba(30, 58, 138, 0.19)',
  ],
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: BLUE.canvas,
          color: BLUE.ink,
          backgroundImage:
            'radial-gradient(at 0% 0%, rgba(59,130,246,0.06) 0px, transparent 50%),' +
            'radial-gradient(at 100% 100%, rgba(91,108,255,0.05) 0px, transparent 50%)',
          backgroundAttachment: 'fixed',
        },
        '*::selection': {
          backgroundColor: alpha(BLUE.primary, 0.18),
          color: BLUE.primaryDk,
        },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          background: alpha(BLUE.primary, 0.18),
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'padding-box',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          background: alpha(BLUE.primary, 0.32),
          backgroundClip: 'padding-box',
          border: '2px solid transparent',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: '8px 18px',
          fontWeight: 600,
          letterSpacing: '0.01em',
          transition: 'all 180ms cubic-bezier(0.4, 0, 0.2, 1)',
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${BLUE.primaryLt} 0%, ${BLUE.primary} 55%, ${BLUE.primaryDk} 100%)`,
          color: '#ffffff',
          boxShadow: `0 6px 16px ${alpha(BLUE.primary, 0.28)}`,
          '&:hover': {
            background: `linear-gradient(135deg, ${BLUE.primary} 0%, ${BLUE.primaryDk} 100%)`,
            boxShadow: `0 10px 22px ${alpha(BLUE.primary, 0.36)}`,
            transform: 'translateY(-1px)',
          },
          '&.Mui-disabled': {
            background: alpha(BLUE.primary, 0.35),
            color: '#ffffff',
          },
        },
        outlinedPrimary: {
          borderColor: alpha(BLUE.primary, 0.4),
          color: BLUE.primary,
          '&:hover': {
            borderColor: BLUE.primary,
            backgroundColor: alpha(BLUE.primary, 0.06),
          },
        },
        textPrimary: {
          color: BLUE.primary,
          '&:hover': { backgroundColor: alpha(BLUE.primary, 0.08) },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: BLUE.surface,
          border: `1px solid ${BLUE.line}`,
          boxShadow: '0 1px 2px rgba(30, 58, 138, 0.04)',
        },
        rounded: { borderRadius: 16 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${BLUE.line}`,
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(30, 58, 138, 0.04)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
          borderBottom: `1px solid ${BLUE.line}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: BLUE.surface,
          backgroundImage: 'none',
          borderRight: `1px solid ${BLUE.line}`,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: BLUE.line },
      },
    },
    // Clean row separators on every <Table> across the app.
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${BLUE.line}` },
        head: { borderBottom: `2px solid ${BLUE.line}` },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: `1px solid ${BLUE.line}`,
          borderRadius: 16,
          backgroundColor: BLUE.surface,
          fontSize: '0.8125rem',
          color: BLUE.text,
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: BLUE.surfaceAlt,
            borderBottom: `1px solid ${BLUE.line}`,
            color: BLUE.body,
            fontWeight: 700,
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          },
          '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700 },
          '& .MuiDataGrid-cell': {
            borderBottom: `1px solid ${BLUE.lineSoft}`,
            display: 'flex',
            alignItems: 'center',
            color: BLUE.text,
          },
          '& .MuiDataGrid-row': {
            backgroundColor: BLUE.surface,
            '&:nth-of-type(even)': { backgroundColor: '#fbfcff' },
            '&:hover': { backgroundColor: alpha(BLUE.primary, 0.05) },
            '&.Mui-selected': {
              backgroundColor: alpha(BLUE.primary, 0.08),
              '&:hover': { backgroundColor: alpha(BLUE.primary, 0.12) },
            },
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: `1px solid ${BLUE.line}`,
            backgroundColor: BLUE.surfaceAlt,
            color: BLUE.body,
          },
          '& .MuiDataGrid-virtualScroller': { backgroundColor: BLUE.surface },
          '& .MuiTablePagination-root': { color: BLUE.body },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: '0.72rem',
          borderRadius: 8,
          color: BLUE.body,
        },
        filledPrimary: {
          backgroundColor: alpha(BLUE.primary, 0.12),
          color: BLUE.primaryDk,
          border: `1px solid ${alpha(BLUE.primary, 0.18)}`,
        },
        outlined: { borderColor: BLUE.line },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            backgroundColor: BLUE.surface,
            color: BLUE.text,
            transition: 'all 180ms cubic-bezier(0.4, 0, 0.2, 1)',
            '& fieldset': { borderColor: BLUE.line },
            '&:hover fieldset': { borderColor: alpha(BLUE.primary, 0.4) },
            '&.Mui-focused fieldset': {
              borderColor: BLUE.primary,
              borderWidth: 1.5,
              boxShadow: `0 0 0 4px ${alpha(BLUE.primary, 0.12)}`,
            },
          },
          '& .MuiInputLabel-root': { color: BLUE.muted, fontWeight: 500 },
          '& .MuiInputLabel-root.Mui-focused': { color: BLUE.primary },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          color: BLUE.text,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: BLUE.line },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: { color: BLUE.text },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          color: BLUE.text,
          borderRadius: 8,
          margin: '2px 6px',
          '&:hover': { backgroundColor: alpha(BLUE.primary, 0.06) },
          '&.Mui-selected': {
            backgroundColor: alpha(BLUE.primary, 0.10),
            color: BLUE.primaryDk,
            fontWeight: 600,
            '&:hover': { backgroundColor: alpha(BLUE.primary, 0.14) },
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: BLUE.ink,
          color: '#ffffff',
          fontWeight: 500,
          fontSize: '0.72rem',
          borderRadius: 8,
          padding: '6px 10px',
        },
        arrow: { color: BLUE.ink },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          color: BLUE.muted,
          '&.Mui-selected': { color: BLUE.primary },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: BLUE.primary, height: 3, borderRadius: 3 },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-root': {
            backgroundColor: BLUE.surfaceAlt,
            color: BLUE.body,
            fontWeight: 700,
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            borderBottom: `1px solid ${BLUE.line}`,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${BLUE.lineSoft}`,
          color: BLUE.text,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: BLUE.body,
          borderRadius: 10,
          transition: 'all 160ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': { backgroundColor: alpha(BLUE.primary, 0.08), color: BLUE.primary },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          backgroundColor: alpha(BLUE.primary, 0.08),
        },
        bar: { borderRadius: 999 },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          '& .MuiSwitch-track': { backgroundColor: BLUE.line },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          color: BLUE.body,
          '&:hover': { backgroundColor: alpha(BLUE.primary, 0.08) },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 12, fontWeight: 500 },
        standardInfo: {
          backgroundColor: alpha(BLUE.primary, 0.08),
          color: BLUE.primaryDk,
          border: `1px solid ${alpha(BLUE.primary, 0.16)}`,
        },
      },
    },
  },
});

export default theme;
