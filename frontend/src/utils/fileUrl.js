/**
 * Resolve an attachment to a URL that works in the CURRENT environment.
 *
 * Stored `fileUrl`s are absolute and baked at upload time (e.g.
 * `http://localhost:5000/...` when uploaded during local testing), so on the
 * deployed app they point at the wrong host. Instead of trusting the stored
 * host, we rebuild the link from the stable `fileKey` against the configured
 * API base; legacy attachments without a key get their localhost origin
 * swapped for the live API origin.
 */
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/+$/, '');
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '');

export const resolveFileUrl = (att) => {
  if (!att) return '';
  if (typeof att === 'string') return resolveFileUrl({ fileUrl: att });

  // Preferred: stable S3 key → our signing proxy on the current API host.
  const key = att.fileKey || att.key;
  if (key) return `${API_BASE}/uploads/file?key=${encodeURIComponent(key)}`;

  const url = att.fileUrl || att.url || '';
  if (!url) return '';
  try {
    const u = new URL(url, API_ORIGIN);
    // Repair links uploaded against a different environment (localhost / old host).
    if (u.origin !== API_ORIGIN && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) {
      return `${API_ORIGIN}${u.pathname}${u.search}`;
    }
    return u.href;
  } catch {
    return url;
  }
};

export default resolveFileUrl;
