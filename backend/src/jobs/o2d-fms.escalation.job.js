/**
 * O2D FMS — SLA breach escalation.
 *
 * Periodically scans for PENDING steps that have crossed their planned time and
 * have not yet been escalated, then emails the step owner and the MD. We email
 * directly via the emailService (rather than the BullMQ EmailQueue, whose worker
 * is still a stub) so escalation works without a Redis dependency.
 *
 * Each breach is stamped with `escalatedAt` so it is never emailed twice.
 */

import { o2dFmsService } from '../modules/o2d-fms/o2d-fms.service.js';
import { emailService } from '../services/email.service.js';
import User from '../modules/auth/auth.model.js';
import { logger } from '../utils/logger.js';
import { frontendUrl } from '../utils/frontendUrl.js';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

const getMdEmails = async () => {
  const mds = await User.find({
    isActive: true,
    $or: [{ roles: 'MD' }, { role: 'MD' }],
  }).select('email').lean();
  return mds.map((m) => m.email).filter(Boolean);
};

export const runO2DEscalationScan = async () => {
  const breaches = await o2dFmsService.findOverdueSteps();
  if (!breaches.length) return 0;

  const mdEmails = await getMdEmails();
  let sent = 0;

  for (const b of breaches) {
    const recipients = new Set(mdEmails);
    if (b.owner?.email) recipients.add(b.owner.email);
    const to = [...recipients].join(',');
    if (!to) {
      // No one to notify, but still stamp so we don't rescan endlessly.
      await o2dFmsService.markEscalated(b.processId, b.stepCode);
      continue;
    }

    const subject = `⚠ SLA Breach — ${b.stepName} overdue · ${b.soNumber || ''}`;
    const ownerLine = b.owner?.name ? `Owner: ${b.owner.name}` : 'Owner: (unassigned)';
    // Absolute app link so it works from email / WhatsApp / any external channel.
    const link = frontendUrl(`/o2d-fms/task/${b.processId}/${encodeURIComponent(b.stepCode)}`);
    const html = `
      <p>An O2D step has crossed its SLA and is still pending.</p>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><b>Order</b></td><td>${b.soNumber || '—'} — ${b.partyName || ''}</td></tr>
        <tr><td><b>Step</b></td><td>${b.stepName} (${b.stepCode})</td></tr>
        <tr><td><b>${ownerLine.split(':')[0]}</b></td><td>${ownerLine.split(': ')[1] || ''}</td></tr>
        <tr><td><b>Planned by</b></td><td>${fmt(b.planned)}</td></tr>
      </table>
      <p><a href="${link}">Open this task →</a></p>
      <p>Please action this step or reassign it.</p>`;

    try {
      await emailService.sendEmail({
        to, subject,
        text: `SLA breach: step ${b.stepName} (${b.stepCode}) for order ${b.soNumber} was due ${fmt(b.planned)} and is still pending. ${ownerLine}. Open: ${link}`,
        html,
      });
      sent += 1;
    } catch (err) {
      logger.error(`[O2D-FMS] Escalation email failed for ${b.soNumber}/${b.stepCode}: ${err.message}`);
    }
    // Stamp regardless of email outcome to avoid retry storms; a failed SMTP send
    // is logged above and will surface on the dashboard overdue list anyway.
    await o2dFmsService.markEscalated(b.processId, b.stepCode);
  }

  logger.info(`[O2D-FMS] Escalation scan: ${breaches.length} breach(es), ${sent} email(s) sent`);
  return sent;
};

let timer = null;

/** Start the recurring scan. Default every 15 minutes. Guarded against double-start. */
export const startO2DEscalationJob = (intervalMs = 15 * 60 * 1000) => {
  if (timer) return;
  // Kick once shortly after boot, then on the interval.
  setTimeout(() => { runO2DEscalationScan().catch((e) => logger.error(`[O2D-FMS] scan error: ${e.message}`)); }, 30 * 1000);
  timer = setInterval(() => {
    runO2DEscalationScan().catch((e) => logger.error(`[O2D-FMS] scan error: ${e.message}`));
  }, intervalMs);
  logger.info(`[O2D-FMS] SLA escalation scan scheduled every ${Math.round(intervalMs / 60000)} min`);
};

export const stopO2DEscalationJob = () => {
  if (timer) { clearInterval(timer); timer = null; }
};
