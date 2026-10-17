/**
 * Pure helpers for the Incoming QC inspection form (Purchase FMS Step 1.9).
 * Shared by the standalone QC dialog and the QC section on the GRN page, so
 * both build the same lines, enforce the same balance rule and send the same
 * payload. No React / no imports — kept testable with plain `node --test`.
 */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const todayStr = () => new Date().toISOString().slice(0, 10);

export const ACTIVE_QC_STATUSES = ['DRAFT', 'IN_PROGRESS'];
export const COMPLETED_QC_STATUSES = ['PASSED', 'FAILED', 'PARTIAL'];

export const emptyHeader = () => ({ qcDate: todayStr(), checkedByName: '', preparedBy: '', remarks: '' });

export const headerFromQc = (qc) => ({
  qcDate: qc?.qcDate ? String(qc.qcDate).slice(0, 10) : todayStr(),
  checkedByName: qc?.checkedByName || '',
  preparedBy: qc?.preparedBy || '',
  remarks: qc?.remarks || '',
});

/** Received GRN lines → inspection rows (default: everything accepted). */
export const linesFromGrn = (grn) => (grn?.items || [])
  .filter((it) => round2(it.receivedQty) > 0)
  .map((it) => ({
    grnItemId: it._id, poItemId: it.poItemId || '', skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName,
    unit: it.unit || 'Pcs', batchNo: it.batchNo || '', receivedQty: round2(it.receivedQty),
    acceptedQty: round2(it.receivedQty), rejectedQty: 0, reworkQty: 0,
    defectType: '', defectSeverity: '', qcRemarks: '',
  }));

/** A saved QC's rows, for resuming / viewing it. */
export const linesFromQc = (qc) => (qc?.items || []).map((it) => ({
  grnItemId: it.grnItemId, skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName,
  unit: it.unit || 'Pcs', batchNo: it.batchNo || '', receivedQty: it.receivedQty,
  acceptedQty: it.acceptedQty, rejectedQty: it.rejectedQty, reworkQty: it.reworkQty,
  defectType: it.defectType || '', defectSeverity: it.defectSeverity || '', qcRemarks: it.qcRemarks || '',
}));

/**
 * Stable key for a GRN line across draft edits (the line's own _id can change
 * when a draft GRN is re-saved; its PO line does not).
 */
export const lineKey = (it) => String(it.poItemId || it.grnItemId || `${it.skuCode || ''}|${it.batchNo || ''}|${it.itemName || ''}`);

const ENTERED_FIELDS = ['acceptedQty', 'rejectedQty', 'reworkQty', 'defectType', 'defectSeverity', 'qcRemarks'];

/**
 * QC typed in before the QC record can exist (GRN not yet completed / signed),
 * laid over the GRN's current lines. An entry is kept only while its line's
 * received qty is unchanged — if the GRN line changed, that line starts again
 * from "all accepted" rather than carrying a split that no longer adds up.
 */
export const mergeEnteredLines = (grnLines = [], entered = {}) => grnLines.map((line) => {
  const e = entered[lineKey(line)];
  if (!e || round2(e.receivedQty) !== round2(line.receivedQty)) return line;
  const patch = Object.fromEntries(ENTERED_FIELDS.filter((f) => e[f] !== undefined).map((f) => [f, e[f]]));
  return { ...line, ...patch };
});

/** Received − (accepted + rejected + rework). 0 = balanced; > 0 = still to assign; < 0 = over-assigned. */
export const lineRemaining = (it) =>
  round2(round2(it.receivedQty) - round2(it.acceptedQty) - round2(it.rejectedQty) - round2(it.reworkQty));

const hasNegative = (it) => [it.acceptedQty, it.rejectedQty, it.reworkQty].some((v) => Number(v) < 0);

/**
 * The inspection is two-way: every received unit is Accepted or Rejected, so a
 * line is complete when Accepted + Rejected = Received. Rework is no longer
 * entered; a historical draft that still carries rework must have it
 * re-split into Accepted / Rejected (it is shown, never silently dropped).
 * Still satisfies the server's Accepted + Rejected + Rework = Received rule.
 */
export const lineBalanced = (it) => !hasNegative(it)
  && round2(it.reworkQty) === 0
  && round2(round2(it.acceptedQty) + round2(it.rejectedQty)) === round2(it.receivedQty);
export const allLinesBalanced = (items = []) => items.length > 0 && items.every(lineBalanced);

/** Rework / defect / severity recorded by the earlier form on this line (kept on the record). */
export const legacyLineDetail = (it) => {
  const parts = [];
  if (round2(it.reworkQty) > 0) parts.push(`rework ${round2(it.reworkQty)}`);
  if (it.defectType) parts.push(`defect: ${it.defectType}${it.defectSeverity ? ` (${it.defectSeverity})` : ''}`);
  else if (it.defectSeverity) parts.push(`severity: ${it.defectSeverity}`);
  return parts.join(' · ');
};

export const qcTotals = (items = []) => items.reduce((a, it) => ({
  received: round2(a.received + round2(it.receivedQty)),
  accepted: round2(a.accepted + round2(it.acceptedQty)),
  rejected: round2(a.rejected + round2(it.rejectedQty)),
  rework: round2(a.rework + round2(it.reworkQty)),
}), { received: 0, accepted: 0, rejected: 0, rework: 0 });

/** Result the server will derive on Complete (same rule as incomingQc.service deriveResult). */
export const expectedQcResult = (items = []) => {
  const allAccepted = items.every((it) => round2(it.acceptedQty) === round2(it.receivedQty) && round2(it.rejectedQty) === 0 && round2(it.reworkQty) === 0);
  const allRejected = items.every((it) => round2(it.rejectedQty) === round2(it.receivedQty) && round2(it.acceptedQty) === 0);
  if (allAccepted) return 'PASS';
  if (allRejected) return 'FAIL';
  return 'PARTIAL_PASS';
};

/** Create / update body for the Incoming QC API. */
export const buildQcPayload = ({ header, items, doc }) => ({
  ...header,
  qcReportDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
  items: items.map((it) => ({
    grnItemId: it.grnItemId, skuId: it.skuId || undefined, skuCode: it.skuCode || '', itemName: it.itemName,
    unit: it.unit, batchNo: it.batchNo, receivedQty: round2(it.receivedQty),
    acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty), reworkQty: round2(it.reworkQty),
    defectType: it.defectType?.trim() || '', defectSeverity: it.defectSeverity || '', qcRemarks: it.qcRemarks?.trim() || '',
  })),
});

/** The GRN's live QC: the open draft if there is one, else the latest completed QC (cancelled ones ignored). */
export const pickGrnQc = (qcs = []) => {
  const live = qcs.filter((q) => q && !q.isDeleted && q.qcStatus !== 'CANCELLED');
  return live.find((q) => ACTIVE_QC_STATUSES.includes(q.qcStatus))
    || live.find((q) => COMPLETED_QC_STATUSES.includes(q.qcStatus))
    || null;
};
