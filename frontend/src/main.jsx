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
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SnackbarProvider>
        </ThemeProvider>
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
