import { lazy } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// lazyWithRetry
//
// React.lazy() rejects permanently on a single chunk-load failure, which then
// trips the ErrorBoundary even for transient network blips (ERR_CONNECTION_RESET,
// CDN hiccups) or after a redeploy where the cached index.html still references
// chunk hashes that no longer exist.
//
// This wrapper:
//   1. Retries the import a few times with exponential backoff.
//   2. If every retry fails AND the user hasn't been reloaded yet, forces a
//      hard reload (clears the stale index reference and pulls the new one).
//   3. If even *that* fails, surfaces the original error so ErrorBoundary
//      can render its branded fallback.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = '__chunk_reload_attempted__';

export function lazyWithRetry(factory, { retries = 2, delayMs = 500 } = {}) {
  return lazy(async () => {
    let lastErr;

    for (let i = 0; i <= retries; i++) {
      try {
        const mod = await factory();
        // Success — clear the reload-attempt flag so future failures can reload again.
        try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        return mod;
      } catch (err) {
        lastErr = err;
        if (i < retries) {
          await sleep(delayMs * Math.pow(2, i));
        }
      }
    }

    // All retries exhausted. Try a one-shot hard reload to recover from a
    // stale-deploy hash mismatch — but only once per session, so we don't
    // trap the user in an infinite reload loop if the chunk is truly gone.
    try {
      const alreadyReloaded = sessionStorage.getItem(SESSION_KEY);
      if (!alreadyReloaded) {
        sessionStorage.setItem(SESSION_KEY, '1');
        window.location.reload();
        // Return a never-resolving promise so React doesn't try to render
        // anything before the reload completes.
        return new Promise(() => {});
      }
    } catch { /* sessionStorage may be unavailable */ }

    throw lastErr;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
