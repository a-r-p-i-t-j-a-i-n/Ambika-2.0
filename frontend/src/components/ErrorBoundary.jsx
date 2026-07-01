import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { AlertTriangle, RotateCcw, Home, RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────────
// Self-healing app ErrorBoundary
//
// Wraps the router so a runtime error in any screen renders a branded recovery
// surface instead of a blank white page — but, crucially, it RECOVERS on its
// own so users don't have to keep hard-reloading:
//
//  1. Auto-retry — transient render errors (e.g. a one-off "Maximum update depth"
//     from a focus-refetch race) self-heal once, silently, by remounting the
//     subtree. A genuine hard loop re-throws, hits the cap, and falls through to
//     the manual UI so we never spin forever.
//  2. Recover on navigation — when `resetKey` (the route) changes, the error is
//     cleared automatically, so clicking ANY nav link revives the app with no
//     browser reload. (Supplied by the RouteErrorBoundary wrapper below.)
//  3. Remount on retry — children are keyed by a generation counter, so a retry
//     gives the failed screen a completely fresh mount (no stale state to re-loop).
//
// Still offers manual "Try again", "Reload page" and "Back to dashboard".
// ─────────────────────────────────────────────────────────────────────────────

const MAX_AUTO_RETRIES = 1; // silent self-heal attempts before showing the manual UI

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, autoRetries: 0, generation: 0 };
    this._retryTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    // Route changed while showing the fallback → recover automatically. Also
    // refreshes the auto-retry budget so each new screen gets a fresh chance.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.reset(true);
    }
  }

  componentDidCatch(error, info) {
    // Production crash visibility — wire to a reporter later if desired.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
    // Silently self-heal a transient error once by remounting the subtree.
    if (this.state.autoRetries < MAX_AUTO_RETRIES) {
      if (this._retryTimer) clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(() => {
        this.setState((s) => ({
          hasError: false, error: null, autoRetries: s.autoRetries + 1, generation: s.generation + 1,
        }));
      }, 500);
    }
  }

  componentWillUnmount() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
  }

  // Clear the error and remount children. `freshBudget` resets the auto-retry
  // counter (used on navigation and on an explicit user "Try again").
  reset = (freshBudget = false) => {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this.setState((s) => ({
      hasError: false, error: null, generation: s.generation + 1,
      autoRetries: freshBudget ? 0 : s.autoRetries,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    window.location.assign('/dashboard');
  };

  render() {
    // Key by generation so a retry fully unmounts + remounts the subtree,
    // discarding any stale component state that caused the loop.
    if (!this.state.hasError) {
      return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
    }

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
              startIcon={<RefreshCw size={16} />}
              onClick={() => this.reset(true)}
              sx={{ fontWeight: 700, px: 3 }}
            >
              Try again
            </Button>
            <Button
              variant="outlined"
              startIcon={<RotateCcw size={16} />}
              onClick={this.handleReload}
              sx={{ fontWeight: 700, px: 3 }}
            >
              Reload page
            </Button>
            <Button
              variant="text"
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

/**
 * Route-aware boundary — mount INSIDE the Router. Feeds the current location as
 * `resetKey`, so any caught error clears itself the moment the user navigates
 * (clicking a nav link revives the app — no manual reload needed).
 */
export const RouteErrorBoundary = ({ children }) => {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname + location.search}>{children}</ErrorBoundary>;
};

export default ErrorBoundary;
