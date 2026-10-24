import { useEffect, useRef, useState } from 'react';

/**
 * Shared debounced-search state for every Purchase FMS list screen. The
 * input updates on every keystroke (so the field feels responsive); the
 * value actually sent to the API lags by `delay` ms so a 12-character search
 * is one request, not twelve. The very first render is never debounced —
 * only CHANGES after that are, so mounting with an initial value (if a
 * screen ever passes one) doesn't incur a pointless delay.
 *
 * Every Purchase FMS list screen was either not debouncing search at all
 * (firing a request per keystroke) or reimplementing this by hand — this is
 * the one shared copy.
 *
 *   const [searchInput, setSearchInput, search] = useDebouncedSearch();
 *   <TextField value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
 *   // ...queryArgs: { search: search || undefined }
 */
export function useDebouncedSearch(initial = '', delay = 300) {
  const [input, setInput] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => setDebounced(input), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // For an explicit "Clear all" action — sets both the typed value and the
  // value sent to the API immediately, with no debounce lag.
  const resetSearch = (value = '') => { setInput(value); setDebounced(value); };

  return [input, setInput, debounced, resetSearch];
}

export default useDebouncedSearch;
