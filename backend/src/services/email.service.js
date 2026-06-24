import nodemailer from 'nodemailer';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';
import { s3Enabled, getSignedDownloadUrl } from '../common/uploads/s3.service.js';

// Transport selection: prefer the Brevo HTTP API (HTTPS/443 — immune to ISPs
// that block SMTP ports), fall back to SMTP when only SMTP creds are present.
const apiConfigured  = Boolean(env.BREVO_API_KEY);
const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
const mailConfigured = apiConfigured || smtpConfigured;

const fromEmail = env.MAIL_FROM || env.SMTP_USER;
const fromAddress = `"${env.COMPANY_NAME}" <${fromEmail}>`;

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,   // 465 = implicit TLS; 587 = STARTTLS
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  // Fail fast if the port is blocked/throttled instead of hanging ~60s.
  connectionTimeout: 15000, // TCP connect
  greetingTimeout:   10000, // wait for server greeting
  socketTimeout:     20000, // inactivity after connect
});

if (apiConfigured) {
  logger.info(`[mail] Using Brevo HTTP API (HTTPS) — From=${fromAddress}`);
} else if (smtpConfigured) {
  // Verify the SMTP connection at startup so a blocked port is obvious in logs.
  transporter.verify()
    .then(() => logger.info(`[mail] SMTP ready — ${env.SMTP_HOST}:${env.SMTP_PORT} as ${env.SMTP_USER}, From=${fromAddress}`))
    .catch((e) => logger.error(`[mail] SMTP verify FAILED (${env.SMTP_HOST}:${env.SMTP_PORT}): ${e.message} — set BREVO_API_KEY to send over HTTPS instead (ISPs often block SMTP).`));
} else {
  logger.warn('[mail] Email disabled — set BREVO_API_KEY (recommended) or SMTP_HOST/USER/PASS.');
}

// Send through Brevo's transactional HTTP API. Attachments are passed by URL
// (Brevo fetches them) — our signed S3 links work directly.
const sendViaBrevoApi = async ({ to, subject, text, html, attachments }) => {
  const recipients = String(to).split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }));
  const payload = {
    sender: { name: env.COMPANY_NAME, email: fromEmail },
    to: recipients,
    subject,
    htmlContent: html || (text ? `<pre>${text}</pre>` : ' '),
    ...(text ? { textContent: text } : {}),
    ...(attachments?.length ? { attachment: attachments.map((a) => ({ url: a.path, name: a.filename })) } : {}),
  };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Brevo API ${resp.status}: ${data.message || data.code || JSON.stringify(data)}`);
  return { messageId: data.messageId, accepted: recipients.map((r) => r.email), rejected: [], response: `200 OK (Brevo API) id=${data.messageId || ''}` };
};

// Our stored upload URLs are served through a signing proxy
// (`/api/v1/uploads/file?key=…`) and are RELATIVE — nodemailer can't fetch those.
// Pull the S3 key out and turn it into a short-lived absolute signed URL so the
// file actually attaches. Absolute http(s) URLs pass through unchanged.
const keyFromUrl = (url) => {
  if (!url) return null;
  const m = String(url).match(/[?&]key=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Turn stored upload refs into nodemailer attachments that actually download.
 * Each item: { filename, url?, key? }. Signs S3 keys; keeps absolute URLs.
 * Items we can't resolve to something fetchable are dropped (the body keeps a
 * link as a fallback), so a bad attachment never blocks the whole email.
 */
export const resolveStoredAttachments = async (items = []) => {
  const out = [];
  for (const it of (items || [])) {
    if (!it) continue;
    const key = it.key || keyFromUrl(it.url);
    let pathOrUrl = it.url;
    if (key && s3Enabled) {
      try { pathOrUrl = await getSignedDownloadUrl(key); } catch { /* fall back to url */ }
    }
    if (!pathOrUrl || !/^https?:\/\//i.test(String(pathOrUrl))) continue; // skip un-fetchable relatives
    out.push({ filename: it.filename || 'attachment', path: pathOrUrl });
  }
  return out;
};

export const emailService = {
  resolveStoredAttachments,
  async sendEmail({ to, subject, text, html, attachments = [] }) {
    if (!mailConfigured) {
      throw new Error('Email is not configured on the server (set BREVO_API_KEY, or SMTP_HOST/USER/PASS).');
    }
    try {
      const info = apiConfigured
        ? await sendViaBrevoApi({ to, subject, text, html, attachments })
        : await transporter.sendMail({ from: fromAddress, to, subject, text, html, attachments });
      const accepted = (info.accepted || []).join(', ') || 'none';
      const rejected = (info.rejected || []).join(', ') || 'none';
      // `response` carries the relay's reply, e.g. Brevo's "250 ... queued as <id>".
      logger.info(`📧 Email "${subject}" → ${to} | id=${info.messageId} | accepted=[${accepted}] rejected=[${rejected}] | relay="${(info.response || '').trim()}"`);
      if ((info.rejected || []).length) {
        logger.warn(`⚠️ [mail] Recipient(s) rejected by relay: ${rejected} — they will NOT receive the email.`);
      }
      return info;
    } catch (error) {
      logger.error(`❌ [mail] Send FAILED → ${to} | subject="${subject}" | ${error.message}`);
      throw error;
    }
  },

  async sendDispatchSchedule(to, partyName, soNumber, pdfPath) {
    const subject = `Dispatch Schedule - ${soNumber} - ${partyName}`;
    const text = `Dear ${partyName},\n\nPlease find attached the dispatch schedule for your order ${soNumber}.\n\nRegards,\n${env.COMPANY_NAME}`;
    const html = `<p>Dear ${partyName},</p><p>Please find attached the dispatch schedule for your order <b>${soNumber}</b>.</p><p>Regards,<br>${env.COMPANY_NAME}</p>`;

    return this.sendEmail({
      to,
      subject,
      text,
      html,
      attachments: [{ filename: `Schedule_${soNumber}.pdf`, path: pdfPath }],
    });
  },

  async sendInvoice(to, partyName, invoiceNo, pdfPath, ewayBillPath) {
    const subject = `Invoice - ${invoiceNo} - ${partyName}`;
    const text = `Dear ${partyName},\n\nPlease find attached the invoice ${invoiceNo} and E-way bill for your recent dispatch.\n\nRegards,\n${env.COMPANY_NAME}`;
    const html = `<p>Dear ${partyName},</p><p>Please find attached the invoice <b>${invoiceNo}</b> and E-way bill for your recent dispatch.</p><p>Regards,<br>${env.COMPANY_NAME}</p>`;

    const attachments = [{ filename: `Invoice_${invoiceNo}.pdf`, path: pdfPath }];
    if (ewayBillPath) {
      attachments.push({ filename: `EWayBill_${invoiceNo}.pdf`, path: ewayBillPath });
    }

    return this.sendEmail({ to, subject, text, html, attachments });
  },
};
