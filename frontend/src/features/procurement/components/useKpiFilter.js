import { useState } from 'react';

/**
 * KPI card → list filter, shared by the Purchase FMS list screens so every
 * summary row behaves the same way.
 *
 * Each card is described in `defs` by WHAT IT COUNTS, expressed with a filter
 * the list API already accepts (see that module's getStats for the count):
 *
 *   { status: 'X' }   the screen's own Status dropdown value — the dropdown
 *                     shows the same value, so card and dropdown stay in sync
 *   { status: 'X,Y' } several statuses at once (the list API takes a comma
 *                     list as "any of"); give it a `label` so the dropdown
 *                     can show it
 *   { params: {...} } extra list-query params, for a card the Status dropdown
 *                     cannot express (e.g. approvalStatus, releaseStatus)
 *   {}                the Total card — clears whichever card filter is set
 *
 * One card at a time; clicking the active card again clears it. Search,
 * vendor and date filters are never touched — only the card/status filter.
 * Pure UI state: nothing here defines a status or changes a count.
 *
 * A `params` or multi-status card given a `label` is also offered in the
 * Status dropdown, so the dropdown names the active card instead of reading
 * "All", and choosing it there selects the card — card, dropdown and rows
 * always agree:
 *
 *   const kpi = useKpiFilter({ statusFilter, setStatusFilter, resetPage, defs });
 *   queryArgs: { ...existing, ...kpi.params }
 *   <PfmsKpiCard active={kpi.isActive('approved')} onClick={() => kpi.select('approved')} />
 *   <TextField select value={kpi.menuValue} onChange={(e) => kpi.onMenuChange(e.target.value)}>
 *     <MenuItem value="">All</MenuItem>
 *     {kpi.menuOptions.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
 *     …the screen's own statuses
 */
export const KPI_MENU_PREFIX = 'card:';

export function useKpiFilter({ statusFilter, setStatusFilter, resetPage, defs }) {
  const [key, setKey] = useState('');
  const params = (key && defs[key]?.params) || {};

  const isActive = (k) => {
    const d = defs[k];
    if (!d) return false;
    if (d.params) return key === k;
    if (d.status) return !key && statusFilter === d.status;
    return !key && !statusFilter;
  };

  const select = (k) => {
    const d = defs[k];
    if (!d) return;
    if (d.params) {
      setStatusFilter('');
      setKey(key === k ? '' : k);
    } else if (d.status) {
      setKey('');
      setStatusFilter(!key && statusFilter === d.status ? '' : d.status);
    } else {
      setKey('');
      setStatusFilter('');
    }
    resetPage();
  };

  // Status dropdown ↔ card. A labelled card has its own option (a params card
  // by key, a multi-status card by its status list); every other value is the
  // screen's plain status, which also clears any params card.
  const menuOptions = Object.entries(defs)
    .filter(([, d]) => d.label && (d.params || d.status))
    .map(([k, d]) => ({ value: d.params ? `${KPI_MENU_PREFIX}${k}` : d.status, label: d.label }));
  const menuValue = key && defs[key]?.label ? `${KPI_MENU_PREFIX}${key}` : statusFilter;
  const onMenuChange = (value) => {
    const v = String(value ?? '');
    if (v.startsWith(KPI_MENU_PREFIX)) {
      const k = v.slice(KPI_MENU_PREFIX.length);
      if (!defs[k]?.params) return;
      setStatusFilter('');
      setKey(k);
    } else {
      setKey('');
      setStatusFilter(v);
    }
    resetPage();
  };

  return { key, params, isActive, select, clear: () => setKey(''), menuOptions, menuValue, onMenuChange };
}

/**
 * The list grid's empty-state text: a failed load must not read as "no
 * records", and a filtered-to-nothing list says so (same wording as the
 * Awaiting queues' StepQueueGrid).
 */
export const listEmptyLabel = ({ isError, filtered, empty = 'No records yet' }) => {
  if (isError) return 'Could not load this list — try again';
  return filtered ? 'No records match these filters' : empty;
};

export default useKpiFilter;
