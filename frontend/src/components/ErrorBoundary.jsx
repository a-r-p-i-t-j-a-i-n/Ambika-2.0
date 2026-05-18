import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// App-level ErrorBoundary
//
// Wraps the whole router so a runtime error in any screen renders a
// branded recovery surface instead of a blank white page. The fallback
// offers two paths: hard reload, or jump back to /dashboard.
// ─────────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Production crash visibility — wire to a reporter later if desired.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    window.location.assign('/dashboard');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
          background:
            'linear-gradient(135deg, #eef3fc 0%, #f5f8ff 100%)',
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 520,
            width: '100%',
            p: { xs: 3.5, sm: 5 },
            borderRadius: 4,
            border: '1px solid #dbe4f3',
            boxShadow: '0 24px 60px rgba(30, 58, 138, 0.10)',
            textAlign: 'center',
          }}
        >
          <Box
            sx={{
              width: 64,
              height: 64,
              mx: 'auto',
              mb: 2.5,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background:
                'linear-gradient(135deg, rgba(190,18,60,0.08) 0%, rgba(190,18,60,0.16) 100%)',
              border: '1px solid rgba(190,18,60,0.20)',
              color: '#be123c',
            }}
          >
            <AlertTriangle size={28} strokeWidth={2.2} />
          </Box>

          <Typography
            sx={{
              fontSize: '1.35rem',
              fontWeight: 800,
              color: '#0b2545',
              letterSpacing: '-0.015em',
              mb: 1,
            }}
          >
            Something went wrong
          </Typography>
          <Typography
            sx={{
              fontSize: '0.92rem',
              color: '#475a8a',
              mb: 3.5,
              lineHeight: 1.6,
            }}
          >
            We hit an unexpected error while rendering this page. Try a refresh
            — if it persists, head back to the dashboard.
          </Typography>

          {import.meta.env.DEV && this.state.error && (
            <Box
              sx={{
                textAlign: 'left',
                p: 1.5,
                mb: 3,
                borderRadius: 2,
                bgcolor: '#f5f8ff',
                border: '1px solid #dbe4f3',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.74rem',
                color: '#1e3a8a',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<RotateCcw size={16} />}
              onClick={this.handleReload}
              sx={{ fontWeight: 700, px: 3 }}
            >
              Reload page
            </Button>
            <Button
              variant="outlined"
              startIcon={<Home size={16} />}
              onClick={this.handleHome}
              sx={{ fontWeight: 700, px: 3 }}
            >
              Back to dashboard
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }
}

export default ErrorBoundary;
