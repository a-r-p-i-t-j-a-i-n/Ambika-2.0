import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, Chip, TablePagination,
} from '@mui/material';
import { Package, ArrowDownToLine, ArrowUpFromLine, Clock, History as HistoryIcon } from 'lucide-react';
import dayjs from 'dayjs';
import {
  TableScroll, EmptyNote, KpiTile, O2D, O2D_TIP, stockToken, moveToken, txnLabel, num, imsTableSx,
} from './imsMeta';

/**
 * ONE ITEM — the body of every IMS item page (Raw Material, Consumables &
 * Packaging, Finished Goods), opened from the eye on Stock & Master Data.
 *
 * Four cards — what is here now, what came in, what went out, the last entry —
 * and the item's history: one row per entry, newest first, every fact in its
 * own column (the date, what happened, in, out, the balance after, where, the
 * reference, who did it, their note). Nothing to work out or hover for.
 *
 *   useLedger  the module's query hook for one item's history — called with
 *              { skuId, page, limit }, answering rows in `data` and the in/out
 *              totals in `meta.totals` (RM movements, /ims/ledger, /fg-ims/ledger).
 *   places     the locations holding stock, when the item is held in several.
 */

const ROWS_PER_PAGE = [10, 25, 50, 100];
const LOCATION = { PLG01: 'PLG01 — In-house', JW001: 'JW001 — Job work', MAIN: 'Main store' };
const CORRECTION = { color: '#7c3aed', bg: '#f3e8ff', border: '#e9d5ff' };
// The screens whose Stock In posts ADJUST_IN for every reason but opening stock.
const ENTRY_SCREENS = ['RM_IMS', 'IMS', 'FG_IMS'];

/** What an entry was, in words and colour: in green, out orange, a correction purple. */
const entryOf = (m) => {
  if (m.sourceModule === 'STOCK_CORRECTION') return { ...CORRECTION, label: 'Stock correction' };
  if (ENTRY_SCREENS.includes(m.sourceModule) && m.txnType === 'ADJUST_IN') return { ...moveToken('IN'), label: 'Stock in' };
  return { ...moveToken(m.movementType), label: txnLabel(m.txnType) };
};

const EntryChip = ({ m }) => {
  const t = entryOf(m);
  return (
    <Chip size="small" label={t.label}
      sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 1 } }} />
  );
};

// The sheet: fixed column widths, a bold header that stays put while the rows
// scroll, the box never taller than the screen.
const COLS = {
  sno: 56, date: 120, what: 160, in: 110, out: 110, balance: 120, where: 140, ref: 170, by: 140, note: 260,
};
const colSx = (k) => ({ width: COLS[k], minWidth: COLS[k] });
const sheetSx = (withKg) => {
  const base = imsTableSx(Object.values(COLS).reduce((s, w) => s + w, 0) + (withKg ? 110 : 0));
  return {
    ...base,
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: 0,
    '& td, & th': { ...base['& td, & th'], px: 1 },
    '& tbody > tr > td': { py: 1 },
    '& > .MuiTableHead-root > .MuiTableRow-root > .MuiTableCell-root': {
      ...base['& thead th'], textTransform: 'none', letterSpacing: 0,
      fontSize: '0.74rem', fontWeight: 800, color: O2D.ink, position: 'sticky', top: 0, zIndex: 2,
    },
  };
};
const numSx = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const none = <Box component="span" sx={{ color: O2D.faint }}>—</Box>;

const ItemHistoryView = ({ skuId, useLedger, unit, onHand, status, places = [] }) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const moves = useLedger({ skuId, page: page + 1, limit: rowsPerPage });
  // The newest entry, whichever page of the history is showing.
  const latest = useLedger({ skuId, page: 1, limit: 1 });

  const rows = moves.data?.data || [];
  const meta = moves.data?.meta || {};
  const totals = meta.totals || {};
  const last = latest.data?.data?.[0];
  const withKg = rows.some((r) => r.quantityKg != null);
  const tone = stockToken(status);
  const held = places.filter((l) => Math.abs(l.qtyOnHand || 0) > 0.001);
  const entries = (n) => `${num(n || 0)} entr${n === 1 ? 'y' : 'ies'}`;

  return (
    <>
      {/* ── Four cards ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile icon={Package} color={tone.color} label="Available now"
          value={`${num(onHand)} ${unit}`}
          sub={held.length > 1 ? held.map((l) => `${l.warehouse} ${num(l.qtyOnHand)}`).join(' · ') : tone.label} />
        <KpiTile icon={ArrowDownToLine} color={moveToken('IN').color} label="Total in"
          value={`+${num(totals.inQty)}`} sub={entries(totals.inCount)} />
        <KpiTile icon={ArrowUpFromLine} color={moveToken('OUT').color} label="Total out"
          value={`−${num(totals.outQty)}`} sub={entries(totals.outCount)} />
        <KpiTile icon={Clock} color={O2D.brand} label="Last entry"
          value={last ? dayjs(last.movementDate).format('DD MMM YYYY') : '—'}
          sub={last ? `${entryOf(last).label}${last.performedByName ? ` · ${last.performedByName}` : ''}` : 'Nothing recorded yet'} />
      </Stack>

      {/* ── History ── */}
      <Paper elevation={0} sx={{ borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, overflow: 'hidden', minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${O2D.lineSoft}` }}>
          <HistoryIcon size={15} color={O2D.brand} />
          <Box>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink }}>History</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>Every entry for this item, newest first.</Typography>
          </Box>
        </Stack>

        <TableScroll sx={{ overflowY: 'auto', maxHeight: { md: 'max(420px, calc(100vh - 330px))' } }}>
          <Table size="small" sx={sheetSx(withKg)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={colSx('sno')}>S.No.</TableCell>
                <TableCell align="center" sx={colSx('date')}>Date</TableCell>
                <TableCell align="center" sx={colSx('what')}>What happened</TableCell>
                <TableCell align="center" sx={colSx('in')}>In</TableCell>
                <TableCell align="center" sx={colSx('out')}>Out</TableCell>
                {withKg && <TableCell align="center" sx={{ width: 110, minWidth: 110 }}>Weight</TableCell>}
                <TableCell align="center" sx={colSx('balance')}>Balance after</TableCell>
                <TableCell align="center" sx={colSx('where')}>Where</TableCell>
                <TableCell sx={colSx('ref')}>Reference</TableCell>
                <TableCell sx={colSx('by')}>Done by</TableCell>
                <TableCell sx={colSx('note')}>Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {moves.isFetching && !rows.length && (
                <TableRow><TableCell colSpan={11} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={220} /></TableCell></TableRow>
              )}
              {!moves.isFetching && !rows.length && (
                <TableRow><TableCell colSpan={11} sx={{ border: 0 }}>
                  <EmptyNote icon={HistoryIcon} title="Nothing recorded for this item yet"
                    hint="Its first Stock In, Stock Out or correction will show here." />
                </TableCell></TableRow>
              )}
              {rows.map((r, i) => {
                const into = r.movementType === 'IN';
                const color = moveToken(into ? 'IN' : 'OUT').color;
                return (
                  <TableRow key={r._id} hover data-testid="item-history-row">
                    <TableCell align="center" sx={{ ...numSx, color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell align="center" sx={numSx}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{dayjs(r.movementDate).format('DD MMM YYYY')}</Typography>
                      {/* The time it was saved — only when saved that same day (an
                          imported row was saved long after it happened). */}
                      {r.createdAt && dayjs(r.createdAt).isSame(dayjs(r.movementDate), 'day') && (
                        <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>{dayjs(r.createdAt).format('hh:mm A')}</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center"><EntryChip m={r} /></TableCell>
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color }}>{into ? `+${num(r.quantity)}` : none}</TableCell>
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color }}>{into ? none : `−${num(r.quantity)}`}</TableCell>
                    {withKg && (
                      <TableCell align="center" sx={{ ...numSx, color: O2D.sub }}>{r.quantityKg == null ? none : `${num(r.quantityKg)} kg`}</TableCell>
                    )}
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color: r.balanceAfter <= 0 ? '#b91c1c' : O2D.ink }}>
                      {num(r.balanceAfter)} <Box component="span" sx={{ fontSize: '0.64rem', fontWeight: 600, color: O2D.faint }}>{unit}</Box>
                    </TableCell>
                    <TableCell align="center" sx={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{LOCATION[r.warehouse] || r.warehouse || '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', color: O2D.body }}>
                      <Typography noWrap sx={{ fontSize: 'inherit', fontFamily: 'inherit' }}>{r.refNumber || r.batchNo || r.movementNumber || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.76rem', fontWeight: 600, color: r.performedByName ? O2D.ink : O2D.faint }}>
                      <Typography noWrap sx={{ fontSize: 'inherit', fontWeight: 'inherit' }}>
                        {r.performedByName || (String(r.sourceModule || '').startsWith('EXCEL') ? 'Excel import' : '—')}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                      {r.remarks ? (
                        <Tooltip arrow slotProps={O2D_TIP} title={r.remarks}>
                          <Typography noWrap sx={{ fontSize: 'inherit' }}>{r.remarks}</Typography>
                        </Tooltip>
                      ) : none}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <TablePagination
          component="div" count={meta.total || 0} page={meta.total ? page : 0} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={ROWS_PER_PAGE} labelRowsPerPage="Rows per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-toolbar': { minHeight: 44 } }}
        />
      </Paper>
    </>
  );
};

export default ItemHistoryView;
