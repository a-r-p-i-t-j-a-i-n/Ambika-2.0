/**
 * E2E SAFETY GUARD — shared by every e2e fixture and the e2e backend launcher.
 *
 * Why it exists: the e2e harness loads backend/.env like the app does, and that
 * file carries live AWS and mail credentials. Database writes were always
 * pinned to a localhost scratch DB, but PO release and GRN completion also
 * write PDFs — and with S3 configured those went to the REAL bucket. This
 * guard makes that impossible: before anything connects, it prints what the
 * run is pointed at and STOPS unless every answer is the safe one.
 *
 *   DATABASE TARGET  must be mongodb://localhost|127.0.0.1, a database whose
 *                    name contains "e2e" — never mongodb+srv, never Atlas
 *   S3 STATUS        must be DISABLED (same rule s3.service.js uses to enable it)
 *   EMAIL STATUS     must be DISABLED (same rule email.service.js uses)
 *   ENVIRONMENT      E2E/SCRATCH
 *
 * Production code is not touched: AWS and mail still work everywhere else.
 * To run e2e, blank the variables for the process (dotenv never overrides a
 * variable that is already set, even to empty):
 *
 *   AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *   BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= node src/scripts/<fixture> …
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/env.js'; // judge exactly the environment the app would see

/**
 * True when the module at `metaUrl` is the script node was started with.
 * Fixtures also export pure data that unit tests import (e.g. the expected
 * figures in e2eConsumablesFixture.js); the guard must stop a fixture RUN,
 * never a unit test that merely imports it.
 */
export const isEntry = (metaUrl) => {
  try { return path.resolve(fileURLToPath(metaUrl)) === path.resolve(process.argv[1] || ''); } catch { return false; }
};

export const E2E_BLANK_VARS = [
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'AWS_REGION',
  'BREVO_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
];

const e = (k) => (process.env[k] || '').trim();

/** Mirrors s3.service.js: S3 is on when all four are present. */
export const s3WouldBeEnabled = () => Boolean(e('AWS_ACCESS_KEY_ID') && e('AWS_SECRET_ACCESS_KEY') && e('AWS_REGION') && e('AWS_S3_BUCKET_NAME'));
/** Mirrors email.service.js: Brevo key, or the full SMTP trio. */
export const emailWouldBeEnabled = () => Boolean(e('BREVO_API_KEY') || (e('SMTP_HOST') && e('SMTP_USER') && e('SMTP_PASS')));

export const describeDbTarget = (uri = '') => {
  const srv = /^mongodb\+srv:\/\//i.test(uri);
  const m = String(uri).match(/^mongodb:\/\/([^/@]+@)?([^/?]+)\/([^?]*)/i);
  const hosts = m ? m[2].split(',') : [];
  const db = m ? m[3] : '';
  const local = !srv && hosts.length > 0 && hosts.every((h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(h));
  return { uri: uri.replace(/\/\/[^@/]*@/, '//***@'), hosts, db, local, srv, scratch: local && /e2e/i.test(db) };
};

export const e2eSafetyReport = (uri) => {
  const target = describeDbTarget(uri);
  return {
    target,
    s3: s3WouldBeEnabled(),
    email: emailWouldBeEnabled(),
    environment: target.scratch ? 'E2E/SCRATCH' : (target.local ? 'LOCAL (not a scratch e2e DB)' : 'NOT LOCAL'),
  };
};

/**
 * Print the banner, then stop the process unless it is safe. Called before
 * any connection is opened, so an unsafe run writes nothing anywhere.
 */
export const assertE2ESafe = (uri, label = 'e2e') => {
  const r = e2eSafetyReport(uri);
  const line = (k, v) => console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\n[e2e-safety] ${label}`);
  line('DATABASE TARGET', r.target.scratch ? `LOCAL SCRATCH — ${r.target.hosts.join(',')}/${r.target.db}` : `${r.target.uri} (NOT a local scratch DB)`);
  line('S3 STATUS', r.s3 ? 'ENABLED — would upload to the real bucket' : 'DISABLED');
  line('EMAIL STATUS', r.email ? 'ENABLED — could send real mail' : 'DISABLED');
  line('ENVIRONMENT', r.environment);

  const problems = [];
  if (!r.target.scratch) problems.push('Database must be a localhost scratch database whose name contains "e2e" (never mongodb+srv / Atlas).');
  if (r.s3) problems.push('Refusing to run E2E fixture with S3 enabled. Use a local scratch environment with S3 disabled.');
  if (r.email) problems.push('Refusing to run E2E fixture with email enabled. Blank BREVO_API_KEY / SMTP_* for this process.');
  if (problems.length) {
    console.error('\n[e2e-safety] STOP:');
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error(`  Blank these for the process: ${E2E_BLANK_VARS.map((k) => `${k}=`).join(' ')}\n`);
    process.exit(1);
  }
  return r;
};

export default assertE2ESafe;
