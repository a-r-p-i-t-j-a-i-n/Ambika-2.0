import React, { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Tooltip, TablePagination, Collapse, IconButton, TextField, MenuItem, Button, Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  History, ChevronRight, ChevronDown, AlertTriangle, ArrowUpRight, Scissors, HelpCircle,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  Panel, TableScroll, EmptyNote, YieldChip, CutStatusChip,
  O2D, O2D_TIP, num, imsTableSx,
} from './rmImsMeta';
import { LOCATION_TOKENS } from '../scrap-ims/scrapImsMeta';
import { useGetRmCuttingHistoryQuery, useGetRmCoilLineageQuery } from '../../store/api/rmImsApi';

const day = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '—');
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const COLS = 12;

// The shared table look, with two concessions to eleven columns: headers may
// wrap ("Circle output KG" over two lines) and cells are a little tighter, so
// "Rounds" stays on screen at a normal desktop width instead of behind a scroll.
const historyTableSx = (() => {
  const base = imsTableSx(1000);
  return {
    ...base,
    '& td, & th': { ...base['& td, & th'], px: 1 },
    '& thead th': { ...base['& thead th'], whiteSpace: 'normal', lineHeight: 1.25, verticalAlign: 'bottom' },
  };
})();

/** Where the coil was cut. A coil whose rounds were cut in both places says so. */
const WhereCut = ({ location }) => {
  if (!location) return <Typography sx={{ fontSize: '0.7rem', color: O2D.faint }}>—</Typography>;
  if (location === 'MIXED') {
    return (
      <Tooltip arrow slotProps={O2D_TIP} title="Some rounds were cut at PLG01 and some at JW001. Open the coil to see each round's location.">
        <Chip size="small" label="Mixed" sx={{ height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, color: O2D.body, border: `1px solid ${O2D.line}` }} />
      </Tooltip>
    );
  }
  // The location CODE (PLG01 / JW001), in the Scrap module's own colours and
  // with its own explanation of who owns the offcut.
  const t = LOCATION_TOKENS[location];
  if (!t) return <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>{location}</Typography>;
  const Icon = t.icon;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" icon={<Icon size={12} />} label={location}
        sx={{
          height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
          '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
        }} />
    </Tooltip>
  );
};

/**
 * The rounds of ONE coil, loaded only when its row is opened.
 *
 * Straight from the lineage endpoint — the same `deriveRounds` the full coil
 * page uses — so the round numbers, running remaining weight and per-round
 * status here can never disagree with that page.
 */
const CoilRounds = ({ receiptId }) => {
  const navigate = useNavigate();
  const { data, isFetching, isError } = useGetRmCoilLineageQuery(receiptId);
  const rounds = data?.data || [];
  const meta = data?.meta || {};
  const receipt = meta.receipt || {};

  return (
    <Box sx={{ px: 2, py: 1.25, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.lineSoft}` }}>
      <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: O2D.ink }}>Cutting rounds</Typography>
        {receipt.batchNo && (
          <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
            Batch {receipt.batchNo} · {receipt.skuCode} · total coil weight {num(receipt.receivedWeightKg)} kg
          </Typography>
        )}
        <Button size="small" endIcon={<ArrowUpRight size={13} />} onClick={() => navigate(`/rm-ims/coil/${receiptId}`)}
          sx={{ ml: 'auto', textTransform: 'none', fontWeight: 700, fontSize: '0.7rem' }}>
          Open coil page
        </Button>
      </Stack>
      {isError ? (
        <Typography sx={{ fontSize: '0.72rem', color: '#b91c1c' }}>Could not load the rounds for this coil.</Typography>
      ) : (
        <TableScroll>
          <Table size="small" sx={imsTableSx(900)} aria-label={`Cutting rounds for batch ${receipt.batchNo || ''}`}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64 }}>Round</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Cutting type</TableCell>
                <TableCell align="right">Cut this round</TableCell>
                <TableCell align="right">Circle output</TableCell>
                <TableCell align="right">Scrap</TableCell>
                <TableCell>Yield</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Location</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && !rounds.length && (
                <TableRow><TableCell colSpan={10}><Skeleton height={22} /></TableCell></TableRow>
              )}
              {rounds.map((r) => (
                <TableRow key={r.conversionId} data-testid="cut-round-row">
                  <TableCell align="center" sx={{ ...numCell, fontWeight: 800, color: '#0f766e' }}>{r.roundNo}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.ink }}>{day(r.date)}</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>{r.conversionNumber}</Typography>
                  </TableCell>
                  {/* The operator's choice for the round, as recorded — not
                      the outcome (that is Status). Never guessed when absent. */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {r.cuttingType ? (
                      <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.ink }}>
                        {r.cuttingType === 'FULL' ? 'Full' : 'Partial'}
                      </Typography>
                    ) : (
                      <Tooltip arrow slotProps={O2D_TIP} title="Not recorded — this round was saved before the cutting type was captured. It is not guessed from the weights.">
                        <Typography sx={{ fontSize: '0.74rem', color: O2D.faint, cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ ...numCell, fontWeight: 800 }}>{num(r.cutKg)} kg</TableCell>
                  <TableCell align="right" sx={{ ...numCell, color: '#4338ca' }}>{num(r.circlesKg)} kg</TableCell>
                  <TableCell align="right" sx={{ ...numCell, color: '#b45309' }}>{num(r.scrapKg)} kg</TableCell>
                  <TableCell>{r.yieldPct != null ? <YieldChip pct={r.yieldPct} /> : '—'}</TableCell>
                  <TableCell align="right" sx={{ ...numCell, fontWeight: 700, color: r.remainingAfterKg < 0 ? '#b91c1c' : O2D.ink }}>
                    {num(r.remainingAfterKg)} kg
                  </TableCell>
                  <TableCell><CutStatusChip status={r.status} /></TableCell>
                  <TableCell><WhereCut location={r.location} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
      {meta.totals && meta.totals.reconciles === false && (
        <Typography sx={{ mt: 0.75, fontSize: '0.66rem', color: '#b45309' }}>
          The stock ledger shows {num(meta.totals.ledgerAvailableKg)} kg left on this batch.{' '}
          {num(meta.totals.coil?.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil).
        </Typography>
      )}
    </Box>
  );
};

/**
 * CUTTING HISTORY — one row per PHYSICAL COIL, under the Cut Coils form.
 *
 * Every figure is derived on the server from the coil's receipt, its rounds
 * and the batch ledger (rmIms.service.js → listCuttingHistory). Nothing here
 * is typed by anyone, least of all the status.
 */
const CuttingHistoryPanel = () => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching, isError } = useGetRmCuttingHistoryQuery({
    page: page + 1, limit: rowsPerPage,
    search: debounced || undefined, location: location || undefined, status: status || undefined,
  });
  const rows = data?.data || [];
  const meta = data?.meta || {};
  const untraceable = meta.untraceable || {};

  const toggle = (id) => setOpen((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Panel
      title="Cutting History"
      icon={History}
      hint="See how much of each physical coil was cut, what was produced, what remains, and every cutting round."
      dense
      actions={(
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" placeholder="Batch, coil, GRN, supplier…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            inputProps={{ 'aria-label': 'Search cutting history' }}
            sx={{ width: 210, '& .MuiInputBase-input': { fontSize: '0.74rem', py: 0.6 } }} />
          <TextField select size="small" value={location} onChange={(e) => { setLocation(e.target.value); setPage(0); }}
            SelectProps={{ displayEmpty: true }} inputProps={{ 'aria-label': 'Filter by location' }}
            sx={{ width: 130, '& .MuiSelect-select': { fontSize: '0.74rem', py: 0.6 } }}>
            <MenuItem value="">All locations</MenuItem>
            <MenuItem value="PLG01">PLG01 — Plant</MenuItem>
            <MenuItem value="JW001">JW001 — Job work</MenuItem>
          </TextField>
          <TextField select size="small" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
            SelectProps={{ displayEmpty: true }} inputProps={{ 'aria-label': 'Filter by status' }}
            sx={{ width: 140, '& .MuiSelect-select': { fontSize: '0.74rem', py: 0.6 } }}>
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="PARTIALLY_CUT">Partially cut</MenuItem>
            <MenuItem value="FULLY_CUT">Fully cut</MenuItem>
          </TextField>
        </Stack>
      )}
    >
      <TableScroll>
        <Table size="small" sx={historyTableSx} aria-label="Cutting history">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 36 }} />
              <TableCell align="center" sx={{ width: 56, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell>Batch / Coil</TableCell>
              <TableCell align="right">Total coil weight KG</TableCell>
              <TableCell align="right">Total cut KG</TableCell>
              <TableCell align="right">Circle output KG</TableCell>
              <TableCell align="right">Scrap KG</TableCell>
              <TableCell>Yield %</TableCell>
              <TableCell align="right">Remaining KG</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="right">Rounds</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !rows.length && [0, 1, 2].map((i) => (
              <TableRow key={i}><TableCell colSpan={COLS}><Skeleton height={24} /></TableCell></TableRow>
            ))}
            {!isFetching && isError && (
              <TableRow><TableCell colSpan={COLS} sx={{ border: 0 }}>
                <EmptyNote icon={AlertTriangle} title="Could not load the cutting history" hint="Refresh the page to try again." dense />
              </TableCell></TableRow>
            )}
            {!isFetching && !isError && rows.length === 0 && (
              <TableRow><TableCell colSpan={COLS} sx={{ border: 0 }}>
                <EmptyNote icon={Scissors}
                  title={debounced || location || status ? 'No coil matches these filters' : 'No physical coil has been cut here yet'}
                  hint="Each coil appears here after its first round is saved above, and updates with every round after that." dense />
              </TableCell></TableRow>
            )}
            {rows.map((c, i) => {
              // The physical coil — its receipt, or its manual entry (no GRN).
              const id = String(c.coilId || c.coilReceiptId);
              const isOpen = open.has(id);
              const jw = c.jobWorkScrapKg > 0;
              return (
                <React.Fragment key={id}>
                  <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => toggle(id)} data-testid="cut-history-row" data-batch={c.batchNo}>
                    <TableCell sx={{ width: 36, pr: 0 }}>
                      <IconButton size="small" sx={{ color: O2D.sub }}
                        aria-label={isOpen ? `Hide rounds of batch ${c.batchNo}` : `Show rounds of batch ${c.batchNo}`}>
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </IconButton>
                    </TableCell>
                    <TableCell align="center" sx={{ ...numCell, color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, fontFamily: 'ui-monospace, monospace' }}>{c.batchNo || '—'}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }} title={c.itemName}>{c.skuCode}{c.grnNo ? ` · ${c.grnNo}` : ''}{c.coilSource === 'MANUAL' ? ' · Manual entry (no GRN)' : ''}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={numCell}>{num(c.receivedKg)}</TableCell>
                    <TableCell align="right" sx={{ ...numCell, fontWeight: 800 }}>{num(c.cutKg)}</TableCell>
                    <TableCell align="right" sx={{ ...numCell, color: '#4338ca', fontWeight: 700 }}>{num(c.circlesKg)}</TableCell>
                    <TableCell align="right" sx={numCell}>
                      <Tooltip arrow slotProps={O2D_TIP} title={jw
                        ? `${num(c.plantScrapKg)} kg is Ambika scrap (cut at PLG01). ${num(c.jobWorkScrapKg)} kg stayed with the job worker (JW001) — calculated for traceability, never added to Ambika's scrap stock.`
                        : 'Cut at PLG01 — this scrap went into Ambika\'s scrap stock.'}>
                        <Box component="span" sx={{ cursor: 'help' }}>
                          <Typography component="span" sx={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>{num(c.scrapKg)}</Typography>
                          {jw && (
                            <Typography sx={{ fontSize: '0.6rem', color: '#7c3aed' }}>
                              {c.plantScrapKg > 0 ? `${num(c.jobWorkScrapKg)} with job worker` : 'with job worker'}
                            </Typography>
                          )}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{c.yieldPct != null ? <YieldChip pct={c.yieldPct} /> : '—'}</TableCell>
                    <TableCell align="right" sx={{ ...numCell, fontWeight: 800, color: c.remainingKg < 0 ? '#b91c1c' : O2D.ink }}>
                      <Stack direction="row" spacing={0.4} alignItems="center" justifyContent="flex-end">
                        {!c.reconciles && (
                          <Tooltip arrow slotProps={O2D_TIP}
                            title={`The stock ledger shows ${num(c.ledgerAvailableKg)} kg left on this batch: ${num(c.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil). Status follows the ledger.`}>
                            <Box component="span" sx={{ display: 'flex', color: '#b45309' }}><AlertTriangle size={13} /></Box>
                          </Tooltip>
                        )}
                        <span>{num(c.remainingKg)}</span>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <CutStatusChip status={c.status} />
                    </TableCell>
                    <TableCell><WhereCut location={c.location} /></TableCell>
                    <TableCell align="right" sx={{ ...numCell, fontWeight: 800 }}>{c.rounds}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={COLS} sx={{ p: 0, border: 0 }}>
                      <Collapse in={isOpen} unmountOnExit>
                        <CoilRounds receiptId={id} />
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
      <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
        {/* Always stated, even at zero: cuts that name no coil are real and
            sit outside this table, and the reader is told how many. Only once
            the count is KNOWN — a "0" shown while loading would be a false fact. */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ py: 0.75, mr: 'auto' }}>
          {data?.meta && (
            <>
              <Box sx={{ color: O2D.faint, display: 'flex' }}><HelpCircle size={13} /></Box>
              <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }} data-testid="cut-history-untraceable">
                {num(untraceable.records || 0)} older cut{untraceable.records === 1 ? '' : 's'} ({num(untraceable.cutKg || 0)} kg) name no physical coil — spreadsheet imports
                or “No receipt available” — so they are not shown as rounds here. They remain in Past conversions below.
              </Typography>
            </>
          )}
        </Stack>
        <TablePagination
          component="div" count={meta.pagination?.total || 0} page={page} rowsPerPage={rowsPerPage}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50]}
          sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
        />
      </Stack>
    </Panel>
  );
};

export default CuttingHistoryPanel;
