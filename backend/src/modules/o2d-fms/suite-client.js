/**
 * Talking to the Delegation Suite backend, server to server.
 *
 * Every message is signed with ERP_SSO_SECRET (the secret the two systems
 * already share for sign-in): the body travels as-is and the signature
 * carries its hash, so neither side can be fed a forged or altered message.
 * Used by the O2D → Delegation task sync (o2d-delegation.js) and by FMS →
 * Doer Assignment, which lists only Delegation employees.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../../config/env.js';
import { AppError } from '../../utils/apiResponse.js';

// A sleeping Suite server (free hosting) can take up to a minute to wake.
const REQUEST_TIMEOUT_MS = 75 * 1000;
const PEOPLE_CACHE_MS = 60 * 1000;

/** True when this ERP is linked to the Delegation Suite. */
export const delegationLinkOn = () => Boolean(env.SUITE_API_URL && env.ERP_SSO_SECRET);

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const signEnvelope = (data) => ({
  data,
  sig: jwt.sign({ sha: sha256(JSON.stringify(data)) }, env.ERP_SSO_SECRET, {
    algorithm: 'HS256', expiresIn: '5m', issuer: 'agl-erp', audience: 'ambika-suite-fms',
  }),
});

/** The `data` of a message signed by the Suite; throws when it is not. */
export const readSuiteEnvelope = (body) => {
  if (!env.ERP_SSO_SECRET) throw new AppError('The Delegation link is not configured', 503);
  let claims;
  try {
    claims = jwt.verify(String(body?.sig || ''), env.ERP_SSO_SECRET, {
      algorithms: ['HS256'], issuer: 'ambika-suite', audience: 'agl-erp-fms',
    });
  } catch {
    throw new AppError('Invalid or expired signature', 401);
  }
  if (!body || claims.sha !== sha256(JSON.stringify(body.data ?? null))) {
    throw new AppError('Invalid signature', 401);
  }
  return body.data;
};

/** POST a signed message to the Suite API (path under /api/v1). */
export const postToSuite = async (path, data) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.SUITE_API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(signEnvelope(data)),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path} answered ${res.status}${body?.message ? ` — ${body.message}` : ''}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
};

let peopleCache = { at: 0, list: null };

/**
 * The active Delegation employees (Delegation → Employees is the one employee
 * list): [{ email, name, role, roleLabel, mobile }], cached for a minute.
 */
export const fetchSuitePeople = async () => {
  if (peopleCache.list && Date.now() - peopleCache.at < PEOPLE_CACHE_MS) return peopleCache.list;
  const res = await postToSuite('/erp/fms/people', { source: 'o2d' });
  const list = (Array.isArray(res?.data?.people) ? res.data.people : [])
    .filter((p) => typeof p?.email === 'string' && p.email.includes('@'))
    .map((p) => ({
      email: p.email.trim().toLowerCase(),
      name: String(p.name || p.email).trim(),
      role: String(p.role || ''),
      roleLabel: String(p.roleLabel || p.role || ''),
      mobile: String(p.mobile || ''),
    }));
  peopleCache = { at: Date.now(), list };
  return list;
};
