// ── Whole-row navigation for Purchase FMS tables ────────────────────────────
// One shared behaviour for every list where a row opens a detail view:
//  - clicking anywhere in the row opens it (any cell, not just the number);
//  - buttons, links, checkboxes, inputs, menus etc. inside the row keep doing
//    their own thing and never also trigger the row — even if the control
//    forgets to call stopPropagation;
//  - Enter on a focused cell opens the row, so the grid is keyboard-usable;
//  - a double-click, a second click while navigation is in flight, or a
//    click that ends a text-selection drag does not navigate (again);
//  - Ctrl/⌘-click opens the detail page in a new tab when it is a route.
// Rows that have nowhere to go (`isRowClickable` → false) keep the default
// cursor and ignore clicks.
import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';

const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'label', 'summary',
  '[contenteditable="true"]',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="switch"]', '[role="radio"]',
  '[role="menuitem"]', '[role="option"]', '[role="combobox"]', '[role="tab"]', '[role="slider"]',
  '[data-row-click="ignore"]',
].join(',');

// DataGrid columns whose cells are pure controls.
const IGNORED_FIELDS = new Set(['__check__', '__actions', '__detail_panel_toggle__', '__reorder__']);

const CLICKABLE_CLASS = 'pfms-row-clickable';
const LOCK_MS = 600;

/** True when the event started on a control nested inside the row/cell. */
export const isFromInteractiveElement = (event) => {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return false;
  const hit = target.closest(INTERACTIVE_SELECTOR);
  // `hit` may live in a portal (menu/popover opened from the row), so test
  // "not the row itself / an ancestor of it" rather than "inside the row".
  return Boolean(hit && hit !== event.currentTarget && !hit.contains(event.currentTarget));
};

// A drag that selects text ends with a click — don't treat it as "open".
const endsTextSelection = (event) => {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
  const row = event.currentTarget;
  return Boolean(row && typeof row.contains === 'function' && row.contains(sel.anchorNode));
};

const hoverFocusSx = (rowSelector) => (theme) => ({
  [`& ${rowSelector}`]: { cursor: 'pointer' },
  [`& ${rowSelector}:hover`]: { backgroundColor: alpha(theme.palette.primary.main, 0.06) },
  // Keyboard focus on any cell lights up the whole row.
  [`& ${rowSelector}:has(:focus-visible)`]: { backgroundColor: alpha(theme.palette.primary.main, 0.08) },
  [`& ${rowSelector}:focus-visible`]: {
    outline: `2px solid ${alpha(theme.palette.primary.main, 0.55)}`,
    outlineOffset: -2,
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
});

/** sx for a DataGrid using useRowNavigation (merge into the grid's sx). */
export const rowNavigationGridSx = (theme) => ({
  ...hoverFocusSx(`.MuiDataGrid-row.${CLICKABLE_CLASS}`)(theme),
  '& .MuiDataGrid-cell:focus-visible, & .MuiDataGrid-cell:focus-within:has(:focus-visible)': {
    outline: `2px solid ${alpha(theme.palette.primary.main, 0.55)}`,
    outlineOffset: -2,
  },
});

/**
 * @param {object}   opts
 * @param {(row) => string|null} [opts.to]     route of the row's detail page
 * @param {(row) => void}        [opts.onOpen] custom open (drawer/dialog); used when `to` is absent
 * @param {(row) => boolean}     [opts.isRowClickable]
 */
export default function useRowNavigation({ to, onOpen, isRowClickable } = {}) {
  const navigate = useNavigate();
  const lockedUntil = useRef(0);

  const canOpen = useCallback(
    (row) => Boolean(row) && (isRowClickable ? isRowClickable(row) : true) && (to ? Boolean(to(row)) : Boolean(onOpen)),
    [to, onOpen, isRowClickable],
  );

  const open = useCallback((row, event) => {
    if (!canOpen(row)) return;
    const href = to ? to(row) : null;
    if (href && (event?.ctrlKey || event?.metaKey)) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    const now = Date.now();
    if (now < lockedUntil.current) return;
    lockedUntil.current = now + LOCK_MS;
    if (href) navigate(href);
    else onOpen(row);
  }, [canOpen, to, onOpen, navigate]);

  // ── DataGrid wiring ──
  const onRowClick = useCallback((params, event) => {
    if (event?.detail > 1) return; // 2nd click of a double-click
    if (isFromInteractiveElement(event) || endsTextSelection(event)) return;
    open(params.row, event);
  }, [open]);

  const onCellKeyDown = useCallback((params, event) => {
    if (event.key !== 'Enter' || event.repeat || event.altKey || event.shiftKey) return;
    if (IGNORED_FIELDS.has(params.field) || params.colDef?.type === 'actions') return;
    if (isFromInteractiveElement(event)) return;
    if (!canOpen(params.row)) return;
    event.preventDefault();
    event.defaultMuiPrevented = true;
    open(params.row, event);
  }, [open, canOpen]);

  const getRowClassName = useCallback(
    (params) => (canOpen(params.row) ? CLICKABLE_CLASS : ''),
    [canOpen],
  );

  // ── Plain <TableRow> wiring ──
  const getTableRowProps = useCallback((row) => {
    if (!canOpen(row)) return {};
    return {
      tabIndex: 0,
      className: CLICKABLE_CLASS,
      onClick: (event) => {
        if (event.detail > 1 || isFromInteractiveElement(event) || endsTextSelection(event)) return;
        open(row, event);
      },
      onKeyDown: (event) => {
        if (event.target !== event.currentTarget || event.repeat) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open(row, event);
        }
      },
    };
  }, [canOpen, open]);

  // Spread onto <DataGrid {...rowNav.gridProps} />.
  const gridProps = { onRowClick, onCellKeyDown, getRowClassName };

  return { gridProps, getTableRowProps, open };
}

/** sx for a plain MUI <Table> whose body rows use getTableRowProps. */
export const rowNavigationTableSx = hoverFocusSx(`.MuiTableRow-root.${CLICKABLE_CLASS}`);
