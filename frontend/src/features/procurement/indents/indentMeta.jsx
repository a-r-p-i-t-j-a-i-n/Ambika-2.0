import React from 'react';
import StatusChip from '../components/StatusChip';

/** Dropdown option sets shared across the Indent screens. */
export const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];

// The SKU master stores units as entered during import (e.g. "KGS", "LTR",
// "MTR", "NOS" — see sku.model.js's `unit` field comment), which don't match
// UNITS' display casing/spelling. Maps those known shorthands onto the
// dropdown's canonical labels so picking a Product doesn't silently lose its
// real unit (e.g. "KGS" collapsing to "Pcs").
const UNIT_ALIASES = {
  PCS: 'Pcs', PC: 'Pcs', NOS: 'Pcs', NO: 'Pcs',
  KG: 'Kg', KGS: 'Kg', KILOGRAM: 'Kg', KILOGRAMS: 'Kg',
  METER: 'Meter', METERS: 'Meter', METRE: 'Meter', METRES: 'Meter', MTR: 'Meter', MTRS: 'Meter',
  ROLL: 'Roll', ROLLS: 'Roll',
  BOX: 'Box', BOXES: 'Box',
  SET: 'Set', SETS: 'Set',
  LITRE: 'Litre', LITRES: 'Litre', LITER: 'Litre', LITERS: 'Litre', LTR: 'Litre', LTRS: 'Litre',
  DOZEN: 'Dozen', DOZ: 'Dozen',
};

/**
 * Map a stored unit to its canonical UNITS casing/spelling. Checks UNITS
 * itself first (legacy data may already hold "PCS", "kg", etc.), then known
 * aliases. Returns '' for empty or unrecognized input — callers decide
 * whether to fall back, rather than this guessing and overwriting the
 * master's real value with the wrong unit.
 */
export const normalizeUnit = (u) => {
  if (!u) return '';
  const raw = String(u).trim();
  const exact = UNITS.find((opt) => opt.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return UNIT_ALIASES[raw.toUpperCase()] || '';
};
export const DEPARTMENTS = ['Stores', 'Production', 'QC', 'Admin', 'Maintenance', 'Packing'];

export const APPROVAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

/**
 * Indent request types, mirroring the backend enum INDENT_REQUEST_TYPE
 * (indent.model.js). These are the ONLY two values an indent can carry — the
 * Type column and the Type filter both read from here so neither can drift
 * from the data.
 */
export const REQUEST_TYPES = [
  { value: 'MATERIAL_PURCHASE', label: 'Material' },
  { value: 'INTERNAL_SERVICE',  label: 'Service' },
];

// Per-item approval decision (Step 1.1) — lets one indent mix approved and
// rejected SKUs in the same approval action.
export const ITEM_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * Whether an indent line item is still eligible for Step 1.2/1.3/PO. Mirrors
 * the backend's isItemApprovalEffective() (indent.model.js) so old indents
 * approved before per-item decisions existed keep flowing through unchanged —
 * their items read approvalStatus PENDING, which falls back to the header.
 */
export const isItemEligibleForQuote = (indent, item) => {
  if (item?.approvalStatus === 'REJECTED') return false;
  if (item?.approvalStatus === 'APPROVED') return true;
  return indent?.approvalStatus === 'APPROVED';
};

/**
 * Resolve an uploaded file URL. Files are served from the API host root
 * (e.g. http://host/uploads/...), NOT under /api/v1.
 */
import { resolveFileUrl } from '../../../utils/fileUrl';

export const fileHref = (url) => {
  return resolveFileUrl(url);
};

/**
 * Build the display-only item reference from an indent number + line number.
 * Display-only — the original indent number is never changed.
 *   Ind-50/26-27 + lineNo 2 → Ind-50.2/26-27
 * Splits on the LAST "/" so the base and fiscal year stay intact.
 */
export const buildItemDisplayNumber = (indentNumber, lineNo) => {
  const n = Number(lineNo);
  if (!indentNumber || !n) return indentNumber || '';
  const slash = indentNumber.lastIndexOf('/');
  if (slash === -1) return `${indentNumber}.${n}`;
  return `${indentNumber.slice(0, slash)}.${n}/${indentNumber.slice(slash + 1)}`;
};

/**
 * Resolve an item's display reference: prefer a server-stamped value, else derive
 * it from the indent number + the item's stable line number (falling back to its
 * position in the items array).
 */
export const itemRef = (indentNumber, item, index = 0) =>
  item?.itemDisplayNumber
  || buildItemDisplayNumber(indentNumber, Number(item?.itemLineNo) || (index + 1));

/**
 * Match a saved item-wise quotation/approval row (Step 1.2 `itemQuotations` or
 * Step 1.3 `itemApprovedQuotations`) to an indent line item.
 *
 * Priority is strict and exhaustive per pass — an `itemId` match ANYWHERE in
 * `savedRows` always wins over a `skuCode`/`itemName` match, even one earlier
 * in the array. This matters because indents may legitimately contain two
 * lines with the same SKU/name (no uniqueness is enforced on `items[]`), so a
 * single combined `||` predicate inside `.find()` can return the wrong row —
 * that was the root cause of quotation files leaking across items.
 */
export const matchItemRow = (savedRows = [], item) => {
  if (!savedRows?.length || !item) return undefined;
  const hasRealId = item._id && item._id !== 'legacy';
  if (hasRealId) {
    const byId = savedRows.find((s) => s?.itemId && String(s.itemId) === String(item._id));
    if (byId) return byId;
  }
  if (item.skuCode) {
    const bySku = savedRows.find((s) => s?.skuCode && s.skuCode === item.skuCode);
    if (bySku) return bySku;
  }
  if (item.itemName) {
    const byName = savedRows.find((s) => s?.itemName && s.itemName === item.itemName);
    if (byName) return byName;
  }
  return undefined;
};

/**
 * Legacy flat-document fallback (pre-item-wise indents). Only valid when there
 * is NO item-wise data at all AND the indent has exactly one item — so there's
 * no ambiguity about which item the flat/legacy documents belong to. Never
 * spreads flat docs across a multi-item indent or dumps them onto "the first
 * item" as a guess.
 */
export const legacyFallbackDocs = (savedRows = [], items = [], flatDocs = [], singleDoc = null) => {
  if (savedRows?.length) return [];
  if ((items || []).length !== 1) return [];
  if (flatDocs?.length) return flatDocs;
  if (singleDoc?.fileUrl) return [singleDoc];
  return [];
};

export const ApprovalChip = ({ status }) => <StatusChip status={status} />;
export const OverallChip = ({ status }) => <StatusChip status={status} />;
export const QuoteChip = ({ status }) => <StatusChip status={status} />;
export const QuotationChip = ({ status }) => <StatusChip status={status} />;
