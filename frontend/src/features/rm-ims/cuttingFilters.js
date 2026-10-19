import { useEffect, useState } from 'react';

/**
 * Filter state and options of the Coil to Circle history — the one table of
 * every recorded cut (CuttingHistoryPanel.jsx). The bar that shows them is
 * CuttingFilterBar (cuttingShared.jsx).
 */

// ── Filters ──────────────────────────────────────────────────────────────────
export const NO_FILTERS = {
  batchNo: '', from: '', to: '', circleSkuId: '', location: '',
  entryType: '', status: '', search: '',
};
const TEXT_KEYS = ['batchNo', 'search'];
// Behind "More filters"; the rest are on the bar itself.
const SECONDARY_KEYS = ['batchNo', 'status'];
export const LOCATION_OPTIONS = [
  { value: 'PLG01', label: 'PLG01 — Plant' },
  { value: 'JW001', label: 'JW001 — Job Work' },
];
/**
 * The record type — what a row is: a physical coil (received on a GRN, or
 * entered by hand), or a cut that names no physical coil at all (spreadsheet
 * imports and "No receipt available"), listed on its own. COIL is every
 * physical coil, GRN and manual together.
 */
export const RECORD_TYPES = [
  { value: '', label: 'All records' },
  { value: 'COIL', label: 'With physical coil' },
  { value: 'GRN', label: 'GRN-linked coil' },
  { value: 'MANUAL', label: 'Manual coil (no GRN)' },
  { value: 'NONE', label: 'Without physical coil (older cuts)' },
];

/**
 * Filter state for a cutting table.
 *
 * What the inputs show (`input`) and what has been sent (`applied`, and as
 * request `params` — empty filters left out). Text is sent after a pause in
 * typing; everything else as soon as it is picked. Any change sends the table
 * back to its first page, because page 7 of one answer is meaningless in the
 * next.
 */
export const useCuttingFilters = () => {
  const [page, setPage] = useState(0);
  const [input, setInput] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);

  useEffect(() => {
    if (TEXT_KEYS.every((k) => applied[k] === input[k].trim())) return undefined;
    const t = setTimeout(() => {
      setApplied((a) => ({ ...a, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, input[k].trim()])) }));
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [input, applied]);

  const setText = (k, v) => setInput((f) => ({ ...f, [k]: v }));
  const setNow = (k, v) => {
    setInput((f) => ({ ...f, [k]: v }));
    setApplied((a) => ({ ...a, [k]: v }));
    setPage(0);
  };
  const reset = () => { setInput(NO_FILTERS); setApplied(NO_FILTERS); setPage(0); };

  const params = {};
  for (const [k, v] of Object.entries(applied)) if (v) params[k] = v;
  return {
    page,
    setPage,
    input,
    applied,
    params,
    setText,
    setNow,
    reset,
    dateError: !!(applied.from && applied.to && applied.from > applied.to),
    anyFilter: Object.values(input).some(Boolean),
    activeCount: Object.values(input).filter(Boolean).length,
    secondaryActive: SECONDARY_KEYS.filter((k) => input[k]).length,
  };
};
