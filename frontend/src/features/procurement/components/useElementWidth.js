import { useLayoutEffect, useState } from 'react';

/**
 * Width of an element, kept current with a ResizeObserver. Used where a layout
 * must follow the space a component actually has rather than the viewport —
 * e.g. a form table inside a dialog that sits beside an expanded or collapsed
 * sidebar. Pass the element itself (a callback-ref state), not a ref object,
 * so the hook re-attaches when the element mounts.
 */
export const useElementWidth = (el) => {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    // The observer reports the current size as soon as it starts observing,
    // before the next paint, so there is no first frame at width 0.
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
};
