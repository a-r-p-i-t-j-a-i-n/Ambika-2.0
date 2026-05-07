import { createTheme, alpha } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb',
      light: '#60a5fa',
      dark: '#1d4ed8',
      contrastText: '#fff',
    },
    secondary: {
      main: '#7c3aed',
      light: '#a78bfa',
      dark: '#5b21b6',
      contrastText: '#fff',
    },
    success: {
      main: '#059669',
      light: '#6ee7b7',
      dark: '#047857',
      contrastText: '#fff',
    },
    warning: {
      main: '#d97706',
      light: '#fcd34d',
      dark: '#b45309',
      contrastText: '#fff',
    },
    error: {
      main: '#dc2626',
      light: '#fca5a5',
      dark: '#b91c1c',
      contrastText: '#fff',
    },
    info: {
      main: '#0891b2',
      light: '#67e8f9',
      dark: '#0e7490',
      contrastText: '#fff',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
    divider: '#e2e8f0',
  },
  typography: {
    fontFamily: '"Inter", "Outfit", system-ui, sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.025em', color: '#0f172a' },
    h2: { fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.025em', color: '#0f172a' },
    h3: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#0f172a' },
    h4: { fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' },
    h5: { fontSize: '1.125rem', fontWeight: 600, color: '#0f172a' },
    h6: { fontSize: '1rem', fontWeight: 600, color: '#0f172a' },
    button: { textTransform: 'none', fontWeight: 600 },
    body1: { lineHeight: 1.6, color: '#334155' },
    body2: { lineHeight: 1.5, color: '#334155' },
    caption: { color: '#64748b' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: '8px 20px',
          fontWeight: 600,
          transition: 'all 0.2s ease-in-out',
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.35)',
          '&:hover': {
            background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
            boxShadow: '0 6px 20px rgba(37, 99, 235, 0.4)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
          border: '1px solid #e2e8f0',
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: 'none',
          borderRadius: 16,
          backgroundColor: '#fff',
          fontSize: '0.8125rem',
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: '#f8fafc',
            borderBottom: '2px solid #e2e8f0',
            color: '#475569',
            fontWeight: 700,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          },
          '& .MuiDataGrid-columnHeaderTitle': {
            fontWeight: 700,
          },
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
          },
          '& .MuiDataGrid-row': {
            backgroundColor: '#fff',
            '&:nth-of-type(even)': {
              backgroundColor: '#fafbfc',
            },
            '&:hover': {
              backgroundColor: alpha('#2563eb', 0.04),
            },
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: '2px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          },
          '& .MuiDataGrid-virtualScroller': {
            backgroundColor: '#fff',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: '0.7rem',
          borderRadius: 8,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
          },
        },
      },
    },
  },
});

export default theme;
