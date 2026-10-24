import React from 'react';
import { TableCell, Typography } from '@mui/material';
import {
  useGridApiContext, useGridSelector,
  gridPaginatedVisibleSortedGridRowIdsSelector, gridExpandedSortedRowIdsSelector, gridPaginationModelSelector,
} from '@mui/x-data-grid';
import { PFMS } from '../pfmsTheme';

/**
 * S.No. (serial number) cells shared by every Purchase FMS table — one look,
 * one width, one rule: rows are numbered 1, 2, 3… in the order they are shown.
 * The column definition for DataGrid lists lives in ./serialNumber.js.
 */

// Same label as serialNumber.js SERIAL_LABEL (kept local: this file exports components only).
// Named SerialCells — not SerialNumber — so it can never collide with serialNumber.js
// on a case-insensitive file system (Windows), where that made serialNumber.js import itself.
const SERIAL_LABEL = 'S.No.';

const numberSx = { color: PFMS.sub, fontVariantNumeric: 'tabular-nums', fontSize: 'inherit', lineHeight: 'inherit' };

/**
 * DataGrid cell: position among the rows the grid is showing right now, plus
 * the rows on earlier pages — so page 2 of 10-row pages starts at 11. Read from
 * the grid's own state, it follows client-side sorting / filtering and both
 * server and client pagination; a filter change that resets the page (every
 * Purchase FMS list does) restarts it at 1.
 */
export const SerialGridCell = ({ id }) => {
  const apiRef = useGridApiContext();
  const pageIds = useGridSelector(apiRef, gridPaginatedVisibleSortedGridRowIdsSelector);
  const shownIds = useGridSelector(apiRef, gridExpandedSortedRowIdsSelector);
  const { page = 0, pageSize = 0 } = useGridSelector(apiRef, gridPaginationModelSelector) || {};
  // Client pagination: the grid slices the page itself (pageIds). Server
  // pagination: the grid holds only the current page and the paginated selector
  // is always empty (MUI X v7), so the rows it shows ARE the current page.
  const ids = pageIds.length ? pageIds : shownIds;
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return <Typography component="span" variant="body2" sx={numberSx}>{page * pageSize + index + 1}</Typography>;
};

// MUI <Table> — narrow, centred, never wraps.
const serialCellSx = {
  width: 56, minWidth: 48, maxWidth: 64, px: 1, textAlign: 'center', whiteSpace: 'nowrap',
};

/** Header cell — pass the table's own head-cell `sx` so it matches its neighbours. */
export const SerialHeadCell = ({ sx, ...rest }) => (
  <TableCell sx={[...(Array.isArray(sx) ? sx : [sx]), serialCellSx]} {...rest}>{SERIAL_LABEL}</TableCell>
);

/** Body cell — `n` is the 1-based row number within its own table. */
export const SerialCell = ({ n, sx, ...rest }) => (
  <TableCell sx={[...(Array.isArray(sx) ? sx : [sx]), serialCellSx, numberSx]} {...rest}>{n}</TableCell>
);

/** For CSS-grid tables: the header text / the number, in a SERIAL_GRID_COL track. */
export const SerialGridHead = ({ sx }) => (
  <Typography component="span" sx={[{ textAlign: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]}>{SERIAL_LABEL}</Typography>
);
export const SerialGridNumber = ({ n, sx }) => (
  <Typography component="span" variant="body2" sx={[numberSx, { textAlign: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]}>{n}</Typography>
);
