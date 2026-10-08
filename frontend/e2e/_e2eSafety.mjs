/**
 * Browser-spec side of the e2e safety guard.
 *
 * A spec only ever talks to the backend it was given a port for. Before it
 * logs in, this checks that the backend on that port was started through
 * backend/src/scripts/e2eServer.js — which refuses anything but a localhost
 * scratch DB with S3 and email off — and is still that same process. Anything
 * else (a dev server on .env with Atlas + S3) stops the spec before it writes.
 */
import fs from 'node:fs';
import path from 'node:path';

export const assertE2EBackend = (apiUrl, label = 'browser e2e') => {
  const port = String(new URL(apiUrl).port);
  const file = path.resolve('e2e/shots', `e2e-backend-${port}.json`);
  const fail = (why) => {
    console.error(`\n[e2e-safety] ${label}: STOP — ${why}`);
    console.error('  Start the backend with: PORT=<port> MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_<x> node src/scripts/e2eServer.js (AWS_*/BREVO/SMTP blanked)\n');
    process.exit(1);
  };
  if (!fs.existsSync(file)) fail(`no e2e backend marker for port ${port} — this backend was not started through e2eServer.js`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  try { process.kill(m.pid, 0); } catch { fail(`the e2e backend recorded for port ${port} (pid ${m.pid}) is not running`); }
  console.log(`\n[e2e-safety] ${label}`);
  console.log(`  DATABASE TARGET  LOCAL SCRATCH — ${m.hosts.join(',')}/${m.db}`);
  console.log(`  S3 STATUS        ${m.s3 ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  EMAIL STATUS     ${m.email ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  ENVIRONMENT      ${m.environment}`);
  if (m.s3 || m.email || m.environment !== 'E2E/SCRATCH' || !/e2e/i.test(m.db)) fail('the backend is not a scratch E2E environment');
  return m;
};

/**
 * The browser never talks to the backend directly — the FRONTEND does, at
 * whatever VITE_API_URL the dev server was started with. So also check that
 * the dev server under test really points at the guarded backend: Vite's dev
 * transform inlines import.meta.env into the served module.
 */
export const assertE2EFrontend = async (appUrl, apiUrl, label = 'browser e2e') => {
  const port = String(new URL(apiUrl).port);
  let src = '';
  try { src = await fetch(`${appUrl}/src/store/api/baseApi.js`).then((r) => r.text()); } catch { /* handled below */ }
  const target = (src.match(/"VITE_API_URL":\s*"([^"]+)"/) || [])[1] || '';
  const ok = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/`).test(target);
  console.log(`  FRONTEND API     ${target || '(not found)'}${ok ? '' : '  ← NOT the guarded e2e backend'}`);
  if (!ok) {
    console.error(`\n[e2e-safety] ${label}: STOP — the frontend at ${appUrl} does not point at the e2e backend on :${port}. Start Vite with VITE_API_URL=http://127.0.0.1:${port}/api/v1\n`);
    process.exit(1);
  }
};

/** Both halves, before a spec does anything. */
export const assertE2ESetup = async (appUrl, apiUrl, label) => {
  assertE2EBackend(apiUrl, label);
  await assertE2EFrontend(appUrl, apiUrl, label);
};

export default assertE2EBackend;
