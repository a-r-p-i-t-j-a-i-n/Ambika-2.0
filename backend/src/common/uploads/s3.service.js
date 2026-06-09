/**
 * S3 storage helper — shared by every file-upload endpoint (now and future).
 *
 * Files are stored PRIVATELY under a per-project prefix so a bucket shared with
 * another project never mixes objects. They are served back through our own API
 * (`GET /api/v1/uploads/file?key=…`) which signs a short-lived URL on demand —
 * so links are stable, work on any bucket (even with Block Public Access on),
 * and no object is ever made public.
 *
 * Enabled only when the AWS_* env vars are present; otherwise callers fall back
 * to local disk, so the app keeps working with zero config.
 */

import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../utils/logger.js';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET_NAME;
// Per-project folder inside the (possibly shared) bucket. Override via env.
const PREFIX = (process.env.AWS_S3_PREFIX || 'agl-dpes').replace(/^\/+|\/+$/g, '');

export const s3Enabled = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && REGION && BUCKET,
);

let client = null;
if (s3Enabled) {
  client = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  logger.info(`[s3] Enabled — bucket "${BUCKET}" (${REGION}), prefix "${PREFIX}/"`);
} else {
  logger.info('[s3] Disabled (no AWS_* env) — file uploads use local disk.');
}

/** Build a collision-proof, project-scoped object key: agl-dpes/<folder>/<ts>-<rand><ext> */
export const buildKey = (folder, originalName) => {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 10);
  const rand = crypto.randomBytes(12).toString('hex');
  const safeFolder = String(folder || 'misc').replace(/[^a-z0-9/_-]/gi, '');
  return `${PREFIX}/${safeFolder}/${Date.now()}-${rand}${ext}`;
};

export const uploadBuffer = async ({ buffer, key, contentType }) => {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType,
  }));
  return key;
};

/** Short-lived signed GET url (default 1h). */
export const getSignedDownloadUrl = (key, expiresIn = 3600) =>
  getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });

export const deleteObject = async (key) => {
  if (!s3Enabled || !key) return;
  try { await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); }
  catch (err) { logger.error(`[s3] delete failed for ${key}: ${err.message}`); }
};
