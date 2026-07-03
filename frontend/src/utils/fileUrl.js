/**
 * Resolve an attachment to a URL that works in the CURRENT environment.
 *
 * Stored `fileUrl`s are absolute and baked at upload time (e.g.
 * `http://<backend-host>/api/v1/uploads/file?key=…` on the deployed server, or
 * `http://localhost:5000/…` during local testing). Opening those raw on the
 * HTTPS app breaks — the browser upgrades to https on a host that only serves
 * http, so the tab fails until you manually strip the “s”.
 *
 * So we NEVER trust the stored host. We rebuild every link against the current
 * API base:
 *   • stable S3 `key` (or a `?key=` in the stored URL) → our signing proxy on
 *     the current origin (relative in prod → same-origin https, never mixed);
 *   • a static `/uploads/…` path → the current origin's proxy;
 *   • any other absolute `http://` link on an https page → upgraded to https.
 */
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/+$/, '');
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, ''); // '' when VITE_API_URL is relative (prod proxy)

const proxyForKey = (key) => `${API_BASE}/uploads/file?key=${encodeURIComponent(key)}`;

export const resolveFileUrl = (att) => {
  if (!att) return '';
  if (typeof att === 'string') return resolveFileUrl({ fileUrl: att });

  // Preferred: stable S3 key → signing proxy on the current API host.
  const key = att.fileKey || att.key;
  if (key) return proxyForKey(key);

  const url = att.fileUrl || att.url || '';
  if (!url) return '';

  // Parse against a base so relative stored paths still resolve.
  const base = API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : undefined);
  let u;
  try { u = new URL(url, base); } catch { return url; }

  // Signing-proxy URL baked against another host → re-point at the current base by key.
  const keyParam = u.searchParams.get('key');
  if (keyParam) return proxyForKey(keyParam);

  // Static /uploads/<folder>/<file> → serve from the current origin (prod proxy
  // rewrites /uploads/*; dev hits the backend), never the baked-in host.
  const staticMatch = u.pathname.match(/\/uploads\/.+$/);
  if (staticMatch) return `${API_ORIGIN}${staticMatch[0]}${u.search}`;

  // Any other absolute http link on an https page → upgrade to dodge mixed-content
  // (S3 and most CDNs serve https fine).
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && u.protocol === 'http:') {
    u.protocol = 'https:';
    return u.href;
  }
  return u.href;
};

export default resolveFileUrl;
