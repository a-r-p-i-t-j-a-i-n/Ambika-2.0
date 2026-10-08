/**
 * E2E BACKEND LAUNCHER — the only way browser e2e tests should start a backend.
 *
 *   AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *   BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *   PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_xxx node src/scripts/e2eServer.js
 *
 * It runs the shared safety guard (local scratch DB, S3 off, email off), turns
 * the O2D escalation mailer off, writes a marker file the browser specs check
 * before they do anything, and then starts the normal server unchanged. A
 * browser spec pointed at any backend that did not come through here — a
 * `npm run dev` with Atlas and S3 in .env, say — refuses to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertE2ESafe } from './e2eSafety.js';

const uri = process.env.MONGO_URI || '';
if (!process.env.MONGO_URI) {
  console.error('[e2e-server] Set MONGO_URI explicitly to the scratch database.');
  process.exit(1);
}
process.env.O2D_FMS_ESCALATION = 'off';
const report = assertE2ESafe(uri, `e2e backend :${process.env.PORT || '?'}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER_DIR = path.resolve(HERE, '../../../frontend/e2e/shots');
const port = String(process.env.PORT || '');
const marker = path.join(MARKER_DIR, `e2e-backend-${port}.json`);
fs.mkdirSync(MARKER_DIR, { recursive: true });
fs.writeFileSync(marker, JSON.stringify({
  port, pid: process.pid, db: report.target.db, hosts: report.target.hosts,
  s3: report.s3, email: report.email, environment: report.environment, startedAt: new Date().toISOString(),
}, null, 2));
const cleanup = () => { try { fs.unlinkSync(marker); } catch { /* already gone */ } };
process.on('exit', cleanup);
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { cleanup(); process.exit(0); }));

await import('../server.js');
