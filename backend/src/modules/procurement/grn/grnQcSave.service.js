/**
 * One Save for the combined GRN + Incoming QC form (Purchase FMS 1.8 + 1.9).
 *
 * The form used to take five actions over two records: Save GRN draft, Save QC
 * Draft, Complete GRN (+ its confirmation dialog), Complete QC (+ its dialog).
 * This orchestrates the SAME services those actions called — nothing here
 * re-implements a rule:
 *
 *   draft save   GRN create/update (grnService — every GRN validation, incl.
 *                per-line over-receipt consent) and the QC entries:
 *                  · GRN still a draft → kept on the GRN (`qcDraft`); a QC
 *                    record can only exist for a completed GRN
 *                  · GRN completed     → the QC record itself (incomingQcService)
 *                Never posts stock.
 *
 *   complete     the draft save, then — only after the QC split has been checked
 *                against the GRN's received lines, so a GRN is never finalised
 *                with a QC that would be refused — grnService.complete (claim
 *                guard, over-receipt re-check against the PO's CURRENT pending
 *                qty, PO/PI quantities, MD approval), then the QC record(s) and
 *                incomingQcService.complete (claim guard — the one place the
 *                accepted qty is posted to stock).
 *
 * The steps keep their own atomic units (GRN completion and QC completion each
 * run in their own transaction, as before). Each step is idempotent, so a Save
 * that fails half way (e.g. stock posting refused after the GRN completed) is
 * finished by the next Save: a completed GRN is not completed again, an
 * existing QC is updated rather than duplicated, a completed QC is left alone.
 */
import GoodsReceiptNote, { GRN_STATUS } from './grn.model.js';
import IncomingQC, { QC_STATUS } from '../incoming-qc/incomingQc.model.js';
import { grnService } from './grn.service.js';
import { incomingQcService, qcScopeLines } from '../incoming-qc/incomingQc.service.js';
import { createGrnSchema, updateGrnSchema } from './grn.validation.js';
import { AppError } from '../../../utils/apiResponse.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const QC_ELIGIBLE = [GRN_STATUS.RECEIVED, GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED];
const QC_ACTIVE = [QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS];
const QC_DONE = [QC_STATUS.PASSED, QC_STATUS.FAILED, QC_STATUS.PARTIAL];
const INSPECTION = ['acceptedQty', 'rejectedQty', 'reworkQty', 'defectType', 'defectSeverity', 'qcRemarks'];

/**
 * The key a QC line is matched by — the same rule as the form's lineKey
 * (qcForm.js): the PO line, which survives draft re-saves and completion; a
 * W/O PO line falls back to its GRN line id, then to SKU|batch|name. Pure.
 */
export const qcLineKey = (it = {}) => String(it.poItemId || it.grnItemId || `${it.skuCode || ''}|${it.batchNo || ''}|${it.itemName || ''}`);
const keyOfGrnLine = (l) => qcLineKey({ poItemId: l.poItemId, grnItemId: l._id, skuCode: l.skuCode, batchNo: l.batchNo, itemName: l.itemName });

/** The QC scopes of a GRN: one per PO on a multi-PO GRN, else one unscoped. Pure. */
export const qcScopesOf = (grn) => {
  const poIds = grn?.poIds || [];
  return poIds.length > 1 ? poIds.map((id, i) => ({ poId: String(id), poNumber: grn.poNumbers?.[i] || '' })) : [{ poId: null, poNumber: '' }];
};

/** The entry the form sent for one scope. Pure. */
export const entryForScope = (qcs = [], scope, multi) => (multi
  ? qcs.find((q) => q.poId && String(q.poId) === String(scope.poId))
  : (qcs.find((q) => !q.poId) || qcs[0])) || null;

/**
 * QC lines for one scope: received qty, SKU, batch and unit from the GRN line;
 * only the inspection result from the form. `strict` (completion) also demands
 * every line be inspected, unchanged and balanced; a draft fills an uninspected
 * line with "all accepted", as a new QC always has. Pure.
 * @returns {{ items: object[], errors: string[] }}
 */
export const inspectionFor = (scopeLines = [], entry, { strict = false } = {}) => {
  const errors = [];
  const sent = new Map((entry?.items || []).map((it) => [String(it.lineKey), it]));
  const items = scopeLines.map((g) => {
    const base = {
      grnItemId: g._id, skuId: g.skuId, skuCode: g.skuCode || '', itemName: g.itemName, unit: g.unit || 'Pcs',
      batchNo: g.batchNo || '', receivedQty: round2(g.receivedQty), shortQty: g.shortQty || 0,
      acceptedQty: round2(g.receivedQty), rejectedQty: 0, reworkQty: 0,
    };
    const it = sent.get(keyOfGrnLine(g));
    if (!it) {
      if (strict) errors.push(`"${g.itemName}" has not been inspected — enter its accepted / rejected quantity`);
      return base;
    }
    if (it.receivedQty != null && round2(it.receivedQty) !== round2(g.receivedQty)) {
      // The split was typed against a different received qty: never carried over silently.
      if (strict) errors.push(`"${g.itemName}": received is now ${round2(g.receivedQty)} (the QC was entered for ${round2(it.receivedQty)}) — check its accepted / rejected split`);
      return base;
    }
    const line = { ...base, ...Object.fromEntries(INSPECTION.filter((f) => it[f] !== undefined && it[f] !== null).map((f) => [f, it[f]])) };
    if (strict) {
      const sum = round2(round2(line.acceptedQty) + round2(line.rejectedQty) + round2(line.reworkQty));
      if (sum !== round2(line.receivedQty)) errors.push(`"${g.itemName}": accepted + rejected (${sum}) must equal received (${round2(line.receivedQty)})`);
    }
    return line;
  });
  if (strict && !items.length) errors.push('This GRN has no received items to inspect');
  return { items, errors };
};

/** The form's QC entries as kept on a draft GRN (plain data, nothing derived). Pure. */
export const toQcDraft = (qcs = []) => (qcs.length ? qcs.map((q) => ({
  poId: q.poId ? String(q.poId) : null,
  qcDate: q.qcDate || null,
  checkedByName: q.checkedByName || '',
  preparedBy: q.preparedBy || '',
  remarks: q.remarks || '',
  qcReportDocument: q.qcReportDocument?.fileUrl ? q.qcReportDocument : null,
  items: (q.items || []).map((it) => Object.fromEntries(
    ['lineKey', 'grnItemId', 'poItemId', 'itemName', 'receivedQty', ...INSPECTION].filter((f) => it[f] !== undefined).map((f) => [f, it[f]]),
  )),
})) : null);

/** The GRN form's body, validated exactly as POST / PATCH /grns validate it. */
const validGrnBody = (schema, body) => {
  const { error, value } = schema.validate(body || {}, { abortEarly: false, stripUnknown: true, errors: { wrap: { label: '' } } });
  if (error) throw new AppError(error.details.map((d) => d.message).join('; '), 422);
  return value;
};

const qcHeaderOf = (entry) => ({
  ...(entry.qcDate ? { qcDate: entry.qcDate } : {}),
  checkedByName: entry.checkedByName || '',
  preparedBy: entry.preparedBy || '',
  remarks: entry.remarks || '',
  // {} clears an attachment the user removed; the services treat it as "none".
  qcReportDocument: entry.qcReportDocument?.fileUrl ? entry.qcReportDocument : {},
});

const liveQcsOf = (grnId) => IncomingQC.find({ grnId, isDeleted: { $ne: true }, qcStatus: { $ne: QC_STATUS.CANCELLED } });

/**
 * Create or update the QC record of every scope of a COMPLETED GRN from the
 * form's entries. A completed QC is never touched. Returns the live records.
 */
const upsertQcs = async (grn, qcs, user, { strict }) => {
  const scopes = qcScopesOf(grn);
  const multi = scopes.length > 1;
  const live = await liveQcsOf(grn._id);
  const recordOf = (scope) => {
    const mine = live.filter((q) => !multi || String(q.poId) === String(scope.poId));
    return mine.find((q) => QC_ACTIVE.includes(q.qcStatus)) || mine.find((q) => QC_DONE.includes(q.qcStatus)) || null;
  };
  const out = [];
  for (const scope of scopes) {
    const existing = recordOf(scope);
    if (existing && QC_DONE.includes(existing.qcStatus)) { out.push(existing); continue; }
    const entry = entryForScope(qcs, scope, multi);
    const label = scope.poNumber ? ` for PO ${scope.poNumber}` : '';
    if (!entry) {
      if (strict) throw new AppError(`Enter the Incoming QC${label} before completing`, 400);
      if (existing) out.push(existing);
      continue;
    }
    const { items, errors } = inspectionFor(qcScopeLines(grn, scope.poId), entry, { strict });
    if (errors.length) throw new AppError(`Incoming QC${label}: ${errors.join('; ')}`, 400);
    const body = { ...qcHeaderOf(entry), items };
    if (existing) { out.push(await incomingQcService.update(existing._id, body, user)); continue; }
    try {
      out.push(await incomingQcService.create({ ...body, grnId: grn._id, ...(multi ? { poId: scope.poId } : {}) }, user));
    } catch (err) {
      // A second request created it first (create runs under the GRN's QC lock
      // and refuses a duplicate): use that record instead of a second one.
      if (err?.statusCode !== 409) throw err;
      const again = (await liveQcsOf(grn._id)).find((q) => (!multi || String(q.poId) === String(scope.poId)) && QC_ACTIVE.includes(q.qcStatus));
      if (!again) throw err;
      out.push(await incomingQcService.update(again._id, body, user));
    }
  }
  return out;
};

/** Complete a QC once: a concurrent Save that completed it first counts as done. */
const completeQcOnce = async (qc, user) => {
  try {
    return await incomingQcService.complete(qc._id, {}, user);
  } catch (err) {
    const now = await IncomingQC.findById(qc._id).lean();
    if (now && QC_DONE.includes(now.qcStatus)) return now;
    throw err;
  }
};

const resultOf = async (grnId) => ({
  grn: await grnService.getById(grnId),
  qcs: await IncomingQC.find({ grnId, isDeleted: { $ne: true } }).sort({ createdAt: 1 }),
});

export const grnQcSaveService = {
  /**
   * @param id    GRN id, or null to create the GRN
   * @param body  { complete, grn: GRN form body | null, qcs: QC entries }
   */
  async save(id, { complete = false, grn: grnBody = null, qcs = [] } = {}, user) {
    let grn = id ? await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } }) : null;
    if (id && !grn) throw new AppError('GRN not found', 404);
    if (grn?.grnStatus === GRN_STATUS.CANCELLED) throw new AppError('A cancelled GRN has no Incoming QC', 400);
    const wasDraft = !grn || grn.grnStatus === GRN_STATUS.DRAFT;

    // ── 1) The GRN — through its own create / update, every rule included ──
    if (wasDraft && grnBody) {
      grn = grn
        ? await grnService.update(grn._id, validGrnBody(updateGrnSchema, grnBody), user)
        : await grnService.create(validGrnBody(createGrnSchema, grnBody), user);
    }
    if (!grn) throw new AppError('Enter the GRN details first', 400);

    // ── 2) The QC entries of a draft GRN ride on it (no QC record can exist yet) ──
    if (wasDraft) {
      await GoodsReceiptNote.updateOne({ _id: grn._id, grnStatus: GRN_STATUS.DRAFT }, { $set: { qcDraft: toQcDraft(qcs) } });
    }

    if (!complete) {
      // A completed GRN's QC draft lives on the QC record itself.
      if (!wasDraft) await upsertQcs(await GoodsReceiptNote.findById(grn._id), qcs, user, { strict: false });
      return resultOf(grn._id);
    }

    // ── 3) Complete: QC checked first, then GRN, then QC (stock posts here) ──
    if (wasDraft) {
      const draft = await GoodsReceiptNote.findById(grn._id);
      const scopes = qcScopesOf(draft);
      const problems = scopes.flatMap((scope) => {
        const entry = entryForScope(qcs, scope, scopes.length > 1);
        const label = scope.poNumber ? `PO ${scope.poNumber}: ` : '';
        if (!entry) return [`${label}enter the Incoming QC before completing`];
        return inspectionFor(qcScopeLines(draft, scope.poId), entry, { strict: true }).errors.map((e) => `${label}${e}`);
      });
      if (problems.length) throw new AppError(`Incoming QC is not complete — ${problems.join('; ')}. The GRN was saved as a draft.`, 400);
      // The GRN-wide legacy consent is never passed: over-receipt is accepted
      // only per line, as ticked and saved on that line, and re-checked here.
      await grnService.complete(grn._id, { rmReceivedAtLocation: grnBody?.rmReceivedAtLocation || undefined }, user);
    }
    const done = await GoodsReceiptNote.findById(grn._id);
    if (!QC_ELIGIBLE.includes(done.grnStatus)) throw new AppError('This GRN is not ready for Incoming QC', 400);
    const records = await upsertQcs(done, qcs, user, { strict: true });
    for (const qc of records) {
      if (QC_ACTIVE.includes(qc.qcStatus)) await completeQcOnce(qc, user);
    }
    await GoodsReceiptNote.updateOne({ _id: done._id }, { $set: { qcDraft: null } });
    return resultOf(done._id);
  },
};
