import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, MenuItem, Table, TableHead, TableBody, TableRow,
  TableCell, TablePagination, Chip, Tooltip,
} from '@mui/material';
import { History } from 'lucide-react';
import dayjs from 'dayjs';
import {
  Panel, TableScroll, EmptyNote, Th, emptyCellSx,
  SCRAP_OUT_REASON_OPTIONS, SCRAP_WAREHOUSE_OPTIONS, O2D, O2D_TIP, num, imsTableSx, numCell,
} from './scrapImsMeta';
import { fmtEntered, unitLabel } from './scrapUom';
import { useGetScrapOutHistoryQuery } from '../../store/api/scrapImsApi';

const WAREHOUSE_LABEL = Object.fromEntries(SCRAP_WAREHOUSE_OPTIONS.map((w) => [w.value, w.label]));

/**
 * The movement status as stored. Every ledger row carries the base schema's
 * `status`, and the stock engine never sets anything but ACTIVE — there is no
 * cancel or reversal for a Scrap Out. "Active" is a technical word that means
 * nothing to a business user, so a row that is both ACTIVE and a sale is
 * relabelled to the thing that actually happened: the scrap was SOLD. Any
 * other stored status (a future cancellation, say) is shown as stored,
 * never hidden behind that relabelling — see `statusToken`.
 */
const STATUS_TOKENS = {
  SOLD: {
    label: 'Sold', color: '#15803d', bg: '#dcfce7', border: '#bbf7d0',
    meaning: 'Sold to the buyer under Sold To — this quantity has left the scrap balance.',
  },
  ACTIVE: {
    label: 'Active', color: '#15803d', bg: '#dcfce7', border: '#bbf7d0',
    meaning: 'Recorded and counted — this quantity has left the scrap balance.',
  },
};
/** ACTIVE + a sale reads as "Sold"; any other stored status passes through untouched. */
const statusToken = (r) => STATUS_TOKENS[r.status === 'ACTIVE' && r.reason === 'SALE' ? 'SOLD' : r.status] || {
  label: r.status || '—', color: O2D.sub, bg: O2D.surfaceAlt, border: O2D.line, meaning: 'Status as stored on the movement.',
};
const StatusBadge = ({ row }) => {
  const t = statusToken(row);
  return (
    <Tooltip arrow title={t.meaning} slotProps={O2D_TIP}>
      <Chip
        size="small" label={t.label}
        sx={{
          height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', cursor: 'help',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 0.9 },
        }}
      />
    </Tooltip>
  );
};

/**
 * Sold Weight — the figure and unit the operator actually typed (500 KG,
 * 5 Quintal, 2 Ton), not the normalized KG split three ways.
 *
 * `enteredQty`/`enteredUom` are only persisted when the operator picked a unit
 * on the Scrap Out form (see scrapUom.js / scrapIms.service.js `_entry`) — so
 * every row from the current form carries them. A row from before that (or
 * posted as a bare `quantityKg`) has neither; for those there is no original
 * unit to recover, so the normalized KG is shown plainly as KG, exactly as it
 * was entered — never split into an invented Quintal/Ton.
 */
const soldWeight = (r) => (r.enteredUom && r.enteredQty != null
  ? `${fmtEntered(r.enteredQty, r.enteredUom)} ${unitLabel(r.enteredUom)}`
  : `${fmtEntered(r.quantityKg, 'KG')} ${unitLabel('KG')}`);

const caption = { fontSize: '0.66rem', color: O2D.sub, lineHeight: 1.3 };
const dash = '—';

/**
 * Scrap Out history — the table under the Scrap Out form.
 *
 * Reads the SCRAP_OUT rows of the scrap ledger (the same rows Scrap movement
 * lists) through /scrap-ims/scrap-out/history. It shares the movement tag, so
 * the Scrap Out mutation refetches it on save; `refreshKey` changes on every
 * save so the table also jumps back to page 1, where the new row is.
 */
const ScrapOutHistory = ({ refreshKey = 0 }) => {
  const [filters, setFilters] = useState({ reason: '', warehouse: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(10);
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => { setPage(0); }, [refreshKey]);

  // Debounced, so typing a buyer's name is one request rather than one per key.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = { page: page + 1, limit };
  for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;

  const { data, isFetching, isError } = useGetScrapOutHistoryQuery(params);
  const rows = data?.data || [];
  const meta = data?.meta || {};
  const summary = meta.summary || {};
  const filtered = Object.values(filters).some(Boolean);

  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };

  return (
    <Panel
      icon={History}
      title="Scrap Out History"
      hint="History of scrap sold, disposed of or moved out."
      actions={meta.total != null && (
        <Chip
          size="small" data-testid="scrap-out-history-summary"
          label={`${summary.count || 0} ${summary.count === 1 ? 'record' : 'records'} · ${num(summary.totalKg || 0)} kg`}
          sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }}
        />
      )}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: '1.6fr repeat(4, 1fr)' }, gap: 1.25 }}>
        <TextField
          size="small" label="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Sold to, reference, GSTIN or phone"
          inputProps={{ 'data-testid': 'scrap-out-history-search' }}
        />
        {/* Labelled distinctly from the form's own "Reason" / "Taken from" fields
            above — the same screen cannot carry two controls with the same
            accessible name. "Location" matches how Scrap movement already
            labels this same filter. */}
        <TextField select size="small" label="Any reason" value={filters.reason} onChange={(e) => set('reason', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          {SCRAP_OUT_REASON_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Location" value={filters.warehouse} onChange={(e) => set('warehouse', e.target.value)}>
          <MenuItem value="">All</MenuItem>
          {SCRAP_WAREHOUSE_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="From" value={filters.from}
          onChange={(e) => set('from', e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="To" value={filters.to}
          onChange={(e) => set('to', e.target.value)} InputLabelProps={{ shrink: true }} />
      </Box>

      <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
        <Table size="small" sx={imsTableSx(1100)} data-testid="scrap-out-history">
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell><Th label="Date" /></TableCell>
              <TableCell align="right"><Th label="Sold Weight" hint="As entered on the form — KG, Quintal or Ton." /></TableCell>
              <TableCell><Th label="Sold To" /></TableCell>
              <TableCell><Th label="Reason" /></TableCell>
              <TableCell><Th label="Taken From" /></TableCell>
              <TableCell><Th label="Status" /></TableCell>
              <TableCell><Th label="Reference" /></TableCell>
              <TableCell><Th label="Remarks" /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r._id} hover data-testid="scrap-out-history-row">
                {/* Continuous across pages: page 2 at 10 per page starts at 11. */}
                <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                  {page * limit + i + 1}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>{r.date ? dayjs(r.date).format('DD-MM-YYYY') : dash}</Typography>
                  {!!r.movementNumber && <Typography sx={caption}>{r.movementNumber}</Typography>}
                </TableCell>
                <TableCell sx={{ ...numCell, fontWeight: 700, color: '#b91c1c', whiteSpace: 'nowrap' }} data-testid="scrap-out-history-weight">
                  {soldWeight(r)}
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: '0.74rem', fontWeight: r.soldTo ? 600 : 400 }}>{r.soldTo || dash}</Typography>
                  {!!r.buyer?.code && <Typography sx={caption}>{r.buyer.code}</Typography>}
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: '0.74rem' }}>{r.reasonLabel || dash}</Typography>
                  {!!r.customReason && <Typography sx={caption}>{r.customReason}</Typography>}
                  {/* A non-sale's free-text "Issued to" — not a buyer, so not under Sold To. */}
                  {!!r.issuedTo && <Typography sx={caption}>To {r.issuedTo}</Typography>}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{WAREHOUSE_LABEL[r.warehouse] || r.warehouse || dash}</TableCell>
                <TableCell><StatusBadge row={r} /></TableCell>
                <TableCell>{r.reference || dash}</TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  <Typography sx={{ fontSize: '0.74rem', color: r.remarks ? O2D.body : O2D.faint, wordBreak: 'break-word' }}>
                    {r.remarks || dash}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={9} sx={emptyCellSx}>
                  <EmptyNote
                    dense icon={History}
                    title={isFetching ? 'Loading…'
                      : isError ? 'Could not load the Scrap Out history.'
                        : filtered ? 'No Scrap Out matches these filters.' : 'No scrap has been taken out yet.'}
                    hint={isFetching || isError ? undefined
                      : filtered ? 'Clear a filter to see more.' : 'Every scrap issued from the form above will be listed here, newest first.'}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableScroll>

      <TablePagination
        component="div"
        count={meta.total || 0}
        page={meta.total ? page : 0}
        onPageChange={(_e, p) => setPage(p)}
        rowsPerPage={limit}
        onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </Panel>
  );
};

export default ScrapOutHistory;
