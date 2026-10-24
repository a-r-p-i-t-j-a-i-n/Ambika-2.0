import { useSyncExternalStore } from 'react';

/**
 * Embedded mode — the ERP shown inside the Delegation Suite.
 *
 * The Suite (VITE_SHELL_ORIGIN) frames this app and drives navigation from its
 * own sidebar. The two windows talk only through postMessage, using the
 * `{ ns: 'agl-embed', v: 1, type, ...payload }` envelope, always with an exact
 * target origin and with the sender's origin checked on receipt.
 *
 * Standalone use is untouched: with no VITE_SHELL_ORIGIN, or when the app is
 * not inside a frame, `isEmbedded` is false and nothing here does anything.
 */

const normalizeOrigin = (value) => {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

export const EMBED_NS = 'agl-embed';
export const EMBED_VERSION = 1;

export const SHELL_ORIGIN = normalizeOrigin(import.meta.env.VITE_SHELL_ORIGIN);

export const isEmbedded =
  typeof window !== 'undefined' && window.self !== window.top && !!SHELL_ORIGIN;

export const postToShell = (type, payload = {}) => {
  if (isEmbedded) {
    window.parent.postMessage({ ns: EMBED_NS, v: EMBED_VERSION, type, ...payload }, SHELL_ORIGIN);
  }
};

// True only for a message that really comes from the Suite window.
export const isShellMessage = (event) =>
  isEmbedded
  && event.origin === SHELL_ORIGIN
  && event.source === window.parent
  && event.data?.ns === EMBED_NS;

// ── Steps hidden for this employee (Suite → Employees → lock icon) ─────────
// The Suite sends them as `shell:prefs { hidden: { o2d: [...], purchase: [...] } }`
// using stepKey() of the O2D step code / Purchase step slug. Standalone (or
// before the Suite has said anything) nothing is hidden.
export const stepKey = (code) => String(code ?? '').replace(/[^A-Za-z0-9]/g, '_');

const EMPTY = new Set();
let hiddenSteps = { o2d: EMPTY, purchase: EMPTY };
const hiddenListeners = new Set();

export const setHiddenSteps = (hidden) => {
  const toSet = (list) => new Set(Array.isArray(list) ? list.filter((s) => typeof s === 'string') : []);
  const next = { o2d: toSet(hidden?.o2d), purchase: toSet(hidden?.purchase) };
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  if (same(next.o2d, hiddenSteps.o2d) && same(next.purchase, hiddenSteps.purchase)) return;
  hiddenSteps = next;
  hiddenListeners.forEach((listener) => listener());
};

const subscribeHidden = (listener) => {
  hiddenListeners.add(listener);
  return () => hiddenListeners.delete(listener);
};

/** The Set of hidden step keys for 'o2d' or 'purchase'. */
export const useHiddenSteps = (flow) =>
  useSyncExternalStore(subscribeHidden, () => hiddenSteps[flow] || EMPTY);

// Inside a cross-site frame some browsers (e.g. Chrome incognito, or with
// third-party cookies blocked) refuse access to localStorage and throw on the
// first read. The auth slice reads the token while the store is created, so
// that would leave a blank frame. In embedded mode only, fall back to an
// in-memory store: the session comes from a fresh Suite ticket on every load
// anyway, so nothing needs to outlive the frame. main.jsx imports this module
// first so the fallback is in place before the store is built.
const memoryStorage = () => {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (i) => Array.from(data.keys())[i] ?? null,
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => { data.set(String(k), String(v)); },
    removeItem: (k) => { data.delete(String(k)); },
    clear: () => { data.clear(); },
  };
};

const ensureStorage = (name) => {
  try {
    const store = window[name];
    const probe = '__agl_embed_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
  } catch {
    try {
      Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
    } catch {
      // Nothing more we can do; the app will surface its own error.
    }
  }
};

if (isEmbedded) {
  ensureStorage('localStorage');
  ensureStorage('sessionStorage');
}
