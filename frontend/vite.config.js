import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ─────────────────────────────────────────────────────────────────────────────
// Production build configuration
//
// • Manual vendor splitting keeps the initial JS payload small. Heavy libs
//   (xlsx, @react-pdf, recharts, @mui/x-data-grid) only load when their pages
//   are visited (also paired with route-level React.lazy in App.jsx).
// • esbuild minifier drops `console.*` and `debugger` in production builds.
// • Source maps are emitted as hidden so crash reports remain decipherable
//   without exposing source to end users.
// • Modern browser target (es2020) keeps the bundle lean.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],

  server: {
    port: 3000,
    open: true,
    // Convenience: when running `npm run dev`, proxy /api to local backend
    // so the same code paths used in production (relative /api/v1) work locally.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 4173,
  },

  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: 'hidden',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,

    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;

          // Heavy, page-specific libs — let route-level lazy() decide
          // when these chunks load.
          if (id.includes('xlsx'))                 return 'vendor-xlsx';
          if (id.includes('@react-pdf'))           return 'vendor-pdf';
          if (id.includes('recharts') ||
              id.includes('d3-'))                  return 'vendor-charts';
          if (id.includes('@mui/x-data-grid'))     return 'vendor-datagrid';

          // Core UI lib — single shared chunk used by every screen.
          if (id.includes('@mui/material') ||
              id.includes('@mui/system') ||
              id.includes('@mui/utils') ||
              id.includes('@mui/private-theming') ||
              id.includes('@mui/styled-engine') ||
              id.includes('@mui/icons-material') ||
              id.includes('@emotion'))             return 'vendor-mui';

          // State / data layer
          if (id.includes('@reduxjs/toolkit') ||
              id.includes('react-redux') ||
              id.includes('immer') ||
              id.includes('reselect'))             return 'vendor-redux';

          // Routing + small UX libs
          if (id.includes('react-router'))         return 'vendor-router';
          if (id.includes('notistack'))            return 'vendor-notistack';
          if (id.includes('lucide-react'))         return 'vendor-icons';
          if (id.includes('dayjs'))                return 'vendor-dayjs';

          // React itself
          if (id.includes('node_modules/react/')   ||
              id.includes('node_modules/react-dom/') ||
              id.includes('scheduler'))            return 'vendor-react';

          return 'vendor';
        },
      },
    },
  },

  esbuild: {
    // Drop debug statements only in production builds.
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
});
