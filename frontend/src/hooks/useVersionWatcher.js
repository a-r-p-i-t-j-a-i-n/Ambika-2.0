import { useEffect, useRef, useState } from 'react';

// The build id baked into THIS bundle at build time (see vite.config.js).
// Falls back to 'dev' when running the dev server (define still injects it,
// but the guard keeps this safe in any environment).
// eslint-disable-next-line no-undef
const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

// How often to check for a newer deploy while the tab is open.
const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * useVersionWatcher
 * -----------------
 * Detects when a newer build has been deployed while the user has the app open.
 *
 * Mechanism: every build writes /version.json containing its build id, served
 * with no-cache. We compare the freshly-fetched id against the id baked into
 * the running bundle. If they differ, a new version is live — we flag it so the
 * UI can offer a one-click refresh. This removes the need for users to ever
 * hard-refresh or clear their cache after a deploy.
 *
 * Checks run: on mount, every few minutes, and whenever the tab regains focus
 * (covers the common case of a tab left open overnight). Network errors are
 * swallowed — going briefly offline must never disrupt the app.
 *
 * @returns {boolean} updateReady — true once a newer deploy is detected.
 */
export function useVersionWatcher() {
  const [updateReady, setUpdateReady] = useState(false);
  const settledRef = useRef(false); // once true, stop polling — the flag is sticky

  useEffect(() => {
    // Only meaningful in a deployed build; the dev server has no version.json.
    if (!import.meta.env.PROD) return undefined;

    let timer;

    const check = async () => {
      if (settledRef.current) return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.buildId && data.buildId !== CURRENT_BUILD) {
          settledRef.current = true;
          setUpdateReady(true);
          clearInterval(timer);
        }
      } catch {
        /* offline or transient network blip — ignore and retry next tick */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    timer = setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return updateReady;
}
