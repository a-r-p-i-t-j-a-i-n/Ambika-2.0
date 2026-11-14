/**
 * E2E BACKEND LAUNCHER — the only way browser e2e tests should start a backend.
 *
 *   AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *   BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_xxx node src/scripts/e2eServer.js
 *
 * It runs the shared safety guard (local scratch DB, S3 off, email off), turns
 * the O2D escalation mailer and the O2D → Delegation Suite link off, writes a
 * marker file the browser specs check before they do anything, and then starts
 * the normal server unchanged. A browser spec pointed at any backend that did
 * not come through here — a `npm run dev` with Atlas and S3 in .env, say —
 * refuses to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uri = process.env.MONGO_URI || '';
if (!process.env.MONGO_URI) {
  console.error('[e2e-server] Set MONGO_URI explicitly to the scratch database.');
  process.exit(1);
}
process.env.O2D_FMS_ESCALATION = 'off';
// No Delegation Suite traffic from an e2e backend. These MUST be set before
// config/env.js is first loaded: it copies SUITE_API_URL / ERP_SSO_SECRET into
// its `env` object once, at load, and dotenv never overrides a variable that is
// already set (even to ''). That is why e2eSafety.js — which loads env.js — is
// imported dynamically below, after this, and not as a static import (static
// imports run before any line of this file).
//   O2D_DELEGATION_SYNC=off  server.js never starts the 60s O2D → Suite round
//   SUITE_API_URL=''         suite-client has no host to call (delegationLinkOn() false)
//   ERP_SSO_SECRET=''        nothing can be signed for the Suite (and /auth/sso answers 503;
//                            the e2e specs sign in with email + password)
process.env.O2D_DELEGATION_SYNC = 'off';
process.env.SUITE_API_URL = '';
process.env.ERP_SSO_SECRET = '';

const { assertE2ESafe } = await import('./e2eSafety.js');
const report = assertE2ESafe(uri, `e2e backend :${process.env.PORT || '?'}`);

// Check what the app will actually read — the loaded env object and the
// Suite client's own switch — and stop before the server starts if the link
// could still be on.
const { default: env } = await import('../config/env.js');
const { delegationLinkOn } = await import('../modules/o2d-fms/suite-client.js');
if (env.SUITE_API_URL || env.ERP_SSO_SECRET || delegationLinkOn() || process.env.O2D_DELEGATION_SYNC !== 'off') {
  console.error('[e2e-server] Delegation Suite link is not off — refusing to start.');
  process.exit(1);
}
console.log('  SUITE LINK       OFF (O2D_DELEGATION_SYNC=off, SUITE_API_URL and ERP_SSO_SECRET blank)');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER_DIR = path.resolve(HERE, '../../../frontend/e2e/shots');
const port = String(process.env.PORT || '');
const marker = path.join(MARKER_DIR, `e2e-backend-${port}.json`);
fs.mkdirSync(MARKER_DIR, { recursive: true });
fs.writeFileSync(marker, JSON.stringify({
  port, pid: process.pid, db: report.target.db, hosts: report.target.hosts,
  s3: report.s3, email: report.email, suiteLink: delegationLinkOn(), environment: report.environment, startedAt: new Date().toISOString(),
}, null, 2));
const cleanup = () => { try { fs.unlinkSync(marker); } catch { /* already gone */ } };
process.on('exit', cleanup);
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { cleanup(); process.exit(0); }));

await import('../server.js');
