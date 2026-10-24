import { createElement } from 'react';
import { SerialGridCell } from './SerialCells.jsx';

export const SERIAL_LABEL = 'S.No.';

/**
 * The S.No. column for every Purchase FMS DataGrid list — put it first:
 *   const columns = [serialColumn(), ...theRest];
 * Pagination-aware (page 2 of 25-row pages starts at 26), follows the grid's
 * visible order, never sortable / filterable / hideable, and clicking it opens
 * the row like any other data cell.
 */
export const SERIAL_FIELD = '__serial';

export const serialColumn = (overrides = {}) => ({
  field: SERIAL_FIELD,
  headerName: SERIAL_LABEL,
  width: 64,
  minWidth: 56,
  sortable: false,
  filterable: false,
  disableColumnMenu: true,
  hideable: false,
  resizable: false,
  disableExport: true,
  align: 'center',
  headerAlign: 'center',
  renderCell: (p) => createElement(SerialGridCell, { id: p.id }),
  ...overrides,
});

/** Width of the S.No. track for CSS-grid tables — prepend it to gridTemplateColumns. */
export const SERIAL_GRID_COL = '48px';
