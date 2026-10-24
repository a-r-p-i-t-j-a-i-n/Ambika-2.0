// Must stay the FIRST import: when the ERP runs inside the Delegation Suite it
// puts a storage fallback in place before the store below reads localStorage.
import './utils/embed';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router-dom';
import { SnackbarProvider } from 'notistack';
import { store } from './store';
import theme from './theme/index';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary';
import EmbedBridge from './components/EmbedBridge';
import { toastComponents } from './components/Toast';

// ─── Local Inter font weights (replaces blocking Google Fonts CDN call) ───
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SnackbarProvider
            maxSnack={3}
            autoHideDuration={3500}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            Components={toastComponents}
          >
            {/* Opt in to the v7 behaviors early — silences the console's
                "React Router Future Flag" warnings and eases the v7 upgrade. */}
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              {/* Inside the Delegation Suite: sign-in by Suite ticket + route
                  sync. Standalone: renders <App /> exactly as before. */}
              <EmbedBridge>
                <App />
              </EmbedBridge>
            </BrowserRouter>
          </SnackbarProvider>
        </ThemeProvider>
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
