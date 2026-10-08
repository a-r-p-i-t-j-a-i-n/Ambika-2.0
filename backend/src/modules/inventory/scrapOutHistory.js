/**
 * Scrap Out history — one ledger row, read back for the table under the form.
 *
 * READ-ONLY. The source of truth is the InventoryMovement row Scrap Out already
 * writes (txnType SCRAP_OUT, against the scrap SKU). Nothing here stores
 * anything; it only reshapes a stored row for display.
 *
 * Pure, so it is unit-tested without a database — see
 * __tests__/scrapOutHistory.test.js.
 */
import { SCRAP_QTY_UNITS } from './scrapUom.js';
import { SCRAP_OUT_REASONS } from './scrapIms.validation.js';

const SEP = ' · ';

/** Rounded to the unit's own decimal limit, so 0.1 + 0.2 noise never shows. */
const inUnit = (kg, unitCode) => {
  const u = SCRAP_QTY_UNITS[unitCode];
  const p = 10 ** u.decimals;
  return Math.round(((Number(kg) || 0) / u.factor) * p) / p;
};

/** The reason as Scrap Out wrote it into the sentence ("Other — <custom>"). */
const reasonText = (m) => (m.reason === 'OTHER'
  ? `${SCRAP_OUT_REASONS.OTHER} — ${m.customReason || ''}`
  : (SCRAP_OUT_REASONS[m.reason] || m.reason || ''));

/**
 * The operator's own Remarks, recovered from the stored `remarks` line.
 *
 * Scrap Out stores ONE sentence — reason · "Sold to: <party>" · reference ·
 * the operator's remarks (see `_entry` in scrapIms.service.js) — and keeps
 * every other part as a real field on the same row. So the leading parts can be
 * rebuilt from those fields exactly, and whatever follows them is what the
 * operator typed.
 *
 * Both party labels are tried: rows written before the buyer master read
 * "Issued to" even on a sale. If the stored line matches neither prefix (an
 * imported row, or the sentence format changed), the whole line is returned —
 * shown as stored, never guessed at.
 */
export const operatorRemarks = (m = {}) => {
  const stored = String(m.remarks || '').trim();
  if (!stored) return '';
  const labels = m.reason === 'SALE' ? ['Sold to', 'Issued to'] : ['Issued to'];
  for (const label of labels) {
    const prefix = [
      reasonText(m),
      m.partyName && `${label}: ${m.partyName}`,
      m.refNumber,
    ].filter(Boolean).join(SEP);
    if (stored === prefix) return '';
    if (stored.startsWith(prefix + SEP)) return stored.slice(prefix.length + SEP.length).trim();
  }
  return stored;
};

/**
 * One SCRAP_OUT movement → one history row.
 *
 * `quantity` is the stored KG figure; Quintal and Ton are derived from it and
 * never stored. "Sold to" is only for a sale — the buyer snapshot's name, or,
 * on a sale recorded before the buyer master, the free-text party it stored.
 * Any other reason's free-text "Issued to" comes back as `issuedTo` instead,
 * so it is never presented as a buyer.
 */
export const toScrapOutHistoryRow = (m = {}) => {
  const isSale = m.reason === 'SALE';
  const kg = Number(m.quantity) || 0;
  return {
    _id: m._id,
    movementNumber: m.movementNumber || '',
    date: m.movementDate || null,
    createdAt: m.createdAt || null,
    quantityKg: kg,
    quintal: inUnit(kg, 'QUINTAL'),
    ton: inUnit(kg, 'TON'),
    enteredQty: m.enteredQty ?? null,
    enteredUom: m.enteredUom || null,
    soldTo: isSale ? (m.buyer?.name || m.partyName || null) : null,
    buyer: isSale && m.buyer ? m.buyer : null,
    issuedTo: !isSale ? (m.partyName || null) : null,
    reason: m.reason || '',
    reasonLabel: SCRAP_OUT_REASONS[m.reason] || m.reason || '',
    customReason: m.reason === 'OTHER' ? (m.customReason || '') : '',
    warehouse: m.warehouse || '',
    status: m.status || '',
    reference: m.refNumber || '',
    remarks: operatorRemarks(m),
    performedByName: m.performedByName || '',
  };
};

export default { operatorRemarks, toScrapOutHistoryRow };
