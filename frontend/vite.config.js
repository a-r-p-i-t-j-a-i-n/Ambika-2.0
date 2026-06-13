import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Unique id stamped into every build. It's both (a) baked into the running
// bundle as `__BUILD_ID__` and (b) written to dist/version.json. The app polls
// version.json and, when the served id differs from the baked-in one, knows a
// new deploy is live and offers a one-click refresh — so non-technical users
// never have to hard-refresh or clear cache after we deploy.
const BUILD_ID = String(Date.now());

// Emits a tiny, un-hashed version.json at the dist root for the update poller.
const emitVersionJson = () => ({
  name: 'emit-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildId: BUILD_ID }),
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Production build configuration
//
// Chunking strategy — fewer, larger chunks beats many tiny ones on CDNs:
//   • Each chunk costs an HTTP/2 stream + a round-trip. 40 parallel chunks
//     stress free-tier CDN edges (Render, Cloudflare, Netlify free) and can
//     trigger ERR_CONNECTION_RESET on the slow ones.
//   • So we keep ONLY the three genuinely-heavy libs as separate deferred
//     chunks (xlsx, charts, datagrid). Everything else (react, mui, redux,
//     router, icons, dayjs, notistack, emotion, etc.) collapses into a
//     single vendor chunk that's downloaded once and cached forever.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), emitVersionJson()],

  // Bake the build id into the bundle so the running app knows its own version.
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },

  server: {
    port: 3000,
    open: true,
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
    // Inline tiny assets to skip extra requests.
    assetsInlineLimit: 4096,
    reportCompressedSize: false,

    rollupOptions: {
      output: {
        // Stable filename pattern for long-lived asset caching.
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',

        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;

          // Heavy, route-specific deps — loaded on demand by lazy() routes.
          if (id.includes('xlsx'))                 return 'vendor-xlsx';
          if (id.includes('@react-pdf'))           return 'vendor-pdf';
          if (id.includes('recharts') ||
              id.includes('d3-'))                  return 'vendor-charts';
          if (id.includes('@mui/x-data-grid'))     return 'vendor-datagrid';

          // Everything else: one shared chunk. Big? Yes. But it's cached
          // forever after the first load and shaves dozens of requests.
          return 'vendor';
        },
      },
    },
  },

  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
});
