/**
 * Absolute front-end (app) URL builder — use this anywhere a link will leave the
 * app (email, WhatsApp, SMS, push). In-app SPA navigation should keep using the
 * relative path; only external channels need the full origin.
 *
 * Configure via env CLIENT_URL (preferred) or FRONTEND_URL. Falls back to the
 * local dev origin so nothing breaks before it's set.
 *
 *   frontendUrl('/o2d-fms/process/123')  ->  https://app.example.com/o2d-fms/process/123
 */
const BASE = (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const frontendUrl = (path = '') => {
  const p = String(path || '');
  return `${BASE}${p.startsWith('/') ? '' : '/'}${p}`;
};

export default frontendUrl;
