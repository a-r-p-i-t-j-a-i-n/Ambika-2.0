/**
 * New PO form — the vendor rate a line fetches. Pure (no React) so the rules are
 * unit-testable.
 *
 * The form never matches the Vendor Master catalog itself: it asks the server
 * (GET /procurement/rate-changes/vendor-rate — vendor + SKU + unit, the same
 * lookup the save and the approval gate use) and records the answer on the row:
 *
 *   row.rateLookup = { key, status, message, hold, vendorRate, unit, candidates }
 *   row.autoRate   = the vendor rate that was fetched = the "original vendor rate"
 *                    a changed rate is compared against (undefined when none)
 *
 * Nothing is ever carried over from another vendor, unit or item: when the key
 * (vendor + SKU + name + unit) changes the previous answer, the rate it filled
 * and any edit made on top of it are dropped before the new answer arrives.
 */
import { sameRate } from '../rate-changes/rateChangeMeta.js';

const upper = (s) => String(s || '').trim().toUpperCase();
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const LOOKUP = {
  LOADING: 'loading',
  FOUND: 'found',
  NONE: 'none',                    // the vendor has no rate for this item
  NO_RATE: 'noRate',               // the vendor lists it, without a rate
  UNIT_MISMATCH: 'unitMismatch',   // the vendor prices it in another unit
  AMBIGUOUS: 'ambiguous',          // several different rates in this unit
  ERROR: 'error',
};

let rowSeq = 0;
/** A stable id for a PO row (rows are re-ordered / removed while a lookup is out). */
export const newRowId = () => { rowSeq += 1; return `row${rowSeq}`; };

/** What identifies the vendor rate a row needs ('' = nothing to look up yet). */
export const lookupKeyOf = (vendorId, it = {}) => {
  if (!vendorId || !(it.itemName || it.skuCode || it.skuId)) return '';
  return [String(vendorId), upper(it.skuCode), String(it.skuId || ''), norm(it.itemName), upper(it.unit)].join('|');
};

/** The /vendor-rate query for a row. */
export const lookupParams = (vendorId, it) => {
  const q = { vendorId: String(vendorId) };
  if (it.skuId) q.skuId = String(it.skuId);
  if (it.skuCode) q.skuCode = String(it.skuCode).trim();
  if (it.itemName) q.itemName = String(it.itemName).trim();
  if (it.unit) q.unit = String(it.unit).trim();
  return q;
};

/** The lookup state a server answer (or failure) means. */
export const answerOf = (res, error) => {
  if (error) {
    if (error.status === 404) return { status: LOOKUP.NONE, message: error.data?.message || 'Vendor not found in the Vendor Master' };
    return { status: LOOKUP.ERROR, message: 'Could not fetch the vendor rate — check the connection and try again.' };
  }
  if (res?.found) return { status: LOOKUP.FOUND, message: '' };
  const status = {
    NO_RATE: LOOKUP.NO_RATE, UNIT_MISMATCH: LOOKUP.UNIT_MISMATCH, AMBIGUOUS: LOOKUP.AMBIGUOUS,
  }[res?.problem] || LOOKUP.NONE;
  return { status, message: res?.message || 'No vendor rate configured for this item.' };
};

/**
 * The row once its key changed and the lookup is under way. A row that was
 * looked up before (another vendor / item / unit) gives up that answer: its
 * fetched rate, GST and the doer's edits on top of it.
 * `hold` = keep the row's own rate whatever the answer is — a saved PO being
 * edited (first lookup) and a rate negotiated in an approved quotation.
 */
export const startLookup = (it, key, { lockRates = false } = {}) => {
  const fresh = Boolean(it.rateLookup?.key) && it.rateLookup.key !== key;
  const hold = Boolean(it.fromQuotation) || (lockRates && !fresh);
  const next = { ...it, rateLookup: { key, status: LOOKUP.LOADING, message: '', hold } };
  if (fresh && !it.fromQuotation) {
    return {
      ...next, rate: '', autoRate: undefined, autoGst: undefined, rateMatched: undefined,
      rateTyped: false, gstTyped: false, rateEdited: false, manual: false, rateChangeReason: '',
    };
  }
  return next;
};

/**
 * The row once there is nothing left to look up for (the vendor was cleared): the
 * answer, and the rate it filled, go — a rate must not outlive the vendor it came
 * from. A saved PO's own rate and a quotation rate stay.
 */
export const resetLookup = (it, { lockRates = false } = {}) => {
  if (!it.rateLookup) return it;
  if (it.fromQuotation || lockRates) return { ...it, rateLookup: undefined };
  return {
    ...it, rateLookup: undefined, rate: '', autoRate: undefined, autoGst: undefined, rateMatched: undefined,
    rateTyped: false, gstTyped: false, rateEdited: false, manual: false, rateChangeReason: '',
  };
};

/** The row with the server's answer applied — ignored when the row has moved on (another key). */
export const applyAnswer = (it, key, answer, res) => {
  if (it.rateLookup?.key !== key) return it;
  const { hold } = it.rateLookup;
  const look = {
    ...it.rateLookup, status: answer.status, message: answer.message,
    vendorRate: res?.found ? Number(res.rate) : null, unit: res?.unit || '',
    candidates: res?.candidates || [],
  };
  if (answer.status === LOOKUP.ERROR) return { ...it, rateLookup: look };
  if (answer.status !== LOOKUP.FOUND) {
    // Nothing to fetch: no original vendor rate (a typed rate is the first one).
    return { ...it, rateLookup: look, autoRate: undefined, autoGst: undefined, rateMatched: false };
  }
  const fillRate = !hold && !it.rateTyped;
  const fillGst = !hold && !it.gstTyped && res.gstRate != null;
  return {
    ...it,
    rateLookup: look,
    rateMatched: true,
    autoRate: Number(res.rate),
    autoGst: res.gstRate != null ? Number(res.gstRate) : undefined,
    rate: fillRate ? Number(res.rate) : it.rate,
    rateEdited: fillRate ? false : it.rateEdited,
    gstRate: fillGst ? Number(res.gstRate) : it.gstRate,
    hsn: !hold && res.hsn ? res.hsn : it.hsn,
  };
};

/** True while a row still waits for its vendor rate (a lookup is out, or not sent yet). */
export const awaitsRate = (it, vendorId) => {
  const key = lookupKeyOf(vendorId, it);
  if (!key) return false;
  return it.rateLookup?.key !== key || it.rateLookup?.status === LOOKUP.LOADING;
};

/** Why this row cannot be saved as it stands ('' = it can): the vendor prices it in another unit / twice. */
export const lookupBlock = (it) => {
  if (it.fromQuotation) return '';
  const s = it.rateLookup?.status;
  return s === LOOKUP.UNIT_MISMATCH || s === LOOKUP.AMBIGUOUS ? (it.rateLookup.message || '') : '';
};

/**
 * Is the row's rate a change of the vendor rate fetched for it? A changed rate
 * needs a reason and goes to Rate Change Approvals. A rate the approved quotation
 * set is not a change; a line already carrying a pending / approved request at
 * its saved rate needs nothing more.
 */
export const rateChangeOf = (it) => {
  const fetched = it.autoRate;
  if (fetched == null || it.rate === '' || it.rate == null) return { changed: false, needsReason: false };
  if (it.quotationRate != null && sameRate(it.rate, it.quotationRate)) return { changed: false, needsReason: false, fetched: Number(fetched) };
  const changed = !sameRate(it.rate, fetched);
  const covered = changed && ['PENDING', 'APPROVED'].includes(it.rateChangeStatus) && sameRate(it.rate, it.savedRate);
  return { changed, covered, needsReason: changed && !covered, fetched: Number(fetched) };
};

/** A line with no vendor rate to compare against, but a rate entered: the vendor's FIRST rate for the item. */
export const isFirstRate = (it) => {
  const s = it.rateLookup?.status;
  return (s === LOOKUP.NONE || s === LOOKUP.NO_RATE) && Number(it.rate) > 0;
};
