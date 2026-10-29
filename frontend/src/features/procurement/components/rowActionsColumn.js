import { alpha } from '@mui/material/styles';
import { PFMS } from '../pfmsTheme';

/**
 * Column definition + grid wiring for the shared row action cell
 * (RowActionsCell.jsx — keep the sizes below in sync with it).
 *
 *   columns: [...theRest, rowActionsColumn((p) => <RowActionsCell … />)]
 *   <DataGrid {...rowActionsGridProps} sx={[…, rowActionsGridSx]} />
 */
export const ROW_ACTIONS_FIELD = '__actions';
const BUTTON = 30;
const GAP = 4;
const CELL_PAD = 10; // DataGrid's own cell padding, each side

/** Width of the action column with `extra` px of workflow buttons before the eye. */
export const rowActionsWidth = (extra = 0) => BUTTON * 2 + GAP + CELL_PAD * 2 + (extra ? extra + GAP : 0);

/** The action column — always the last column. */
export const rowActionsColumn = (renderCell, overrides = {}) => ({
  field: ROW_ACTIONS_FIELD,
  headerName: 'Actions',
  width: rowActionsWidth(),
  sortable: false,
  filterable: false,
  disableColumnMenu: true,
  hideable: false,
  resizable: false,
  disableExport: true,
  align: 'right',
  headerAlign: 'right',
  renderCell,
  ...overrides,
});

// MUI X community has no column pinning, and its column virtualisation drops
// off-screen columns from the DOM — so render every column (the lists are
// server-paginated, ≤100 rows) and pin the action cells with CSS sticky.
export const rowActionsGridProps = { disableVirtualization: true };

const ACTIONS = `[data-field="${ROW_ACTIONS_FIELD}"]`;

/** sx for a DataGrid with a rowActionsColumn (merge into the grid's sx). */
export const rowActionsGridSx = (theme) => {
  const edge = `inset 1px 0 0 ${PFMS.line}`;
  // Row hover/selection tints are translucent; a sticky cell needs an opaque
  // base, so it paints the tint as an inset shadow over the paper colour.
  const tinted = (a) => ({
    backgroundColor: '#ffffff',
    boxShadow: `${edge}, inset 0 0 0 100vmax ${alpha(theme.palette.primary.main, a)}`,
  });
  // Always a SOLID background: cells scrolling underneath must never show
  // through (a row's own background can resolve to transparent).
  return {
    [`& .MuiDataGrid-cell${ACTIONS}, & .MuiDataGrid-columnHeader${ACTIONS}`]: {
      position: 'sticky', right: 0, zIndex: 2, boxShadow: edge, backgroundColor: '#ffffff',
    },
    [`& .MuiDataGrid-columnHeader${ACTIONS}`]: { zIndex: 3 },
    [`& .MuiDataGrid-row:hover .MuiDataGrid-cell${ACTIONS}`]: tinted(0.06),
    [`& .MuiDataGrid-row:has(:focus-visible) .MuiDataGrid-cell${ACTIONS}`]: tinted(0.08),
    [`& .MuiDataGrid-row.Mui-selected .MuiDataGrid-cell${ACTIONS}`]: tinted(0.08),
    [`& .MuiDataGrid-row.Mui-selected:hover .MuiDataGrid-cell${ACTIONS}`]: tinted(0.12),
    [`& .MuiDataGrid-cell${ACTIONS}:focus, & .MuiDataGrid-cell${ACTIONS}:focus-within`]: { outline: 'none' },
  };
};
