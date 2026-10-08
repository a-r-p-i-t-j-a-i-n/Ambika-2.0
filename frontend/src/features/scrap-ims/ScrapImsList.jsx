import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, MenuItem, Button, Skeleton,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination, IconButton, Tooltip,
} from '@mui/material';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Recycle, Search, Download, Eye, AlertTriangle, Disc3 } from 'lucide-react';
import dayjs from 'dayjs';
import {
  ScrapShell, SCRAP_ACCENT, Panel, TableScroll, KpiTile, EmptyNote, Th,
  LocationChip, DispositionChip, BatchStatusChip, YieldChip, kg,
  yieldBand, YIELD_GOOD_PCT, YIELD_HIGH_PCT,
  LOCATION_TOKENS, DISPOSITION_TOKENS,
  O2D, O2D_TIP, num, imsTableSx,
} from './scrapImsMeta';
import { useGetScrapOverviewQuery } from '../../store/api/scrapImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.scrap;

const ScrapImsList = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const location = params.get('location') || 'ALL';
  const disposition = params.get('disposition') || 'ALL';
  const batchStatus = params.get('batchStatus') || 'ALL';

  const setParam = (key, value) => {
    if (value === 'ALL') params.delete(key); else params.set(key, value);
    setParams(params, { replace: true });
    setPage(0);
  };

  const query = useMemo(() => ({
    page: page + 1,
    limit: rowsPerPage,
    ...(location !== 'ALL' ? { location } : {}),
    ...(disposition !== 'ALL' ? { disposition } : {}),
    ...(batchStatus !== 'ALL' ? { batchStatus } : {}),
    ...(search ? { search } : {}),
  }), [page, rowsPerPage, location, disposition, batchStatus, search]);

  const { data, isFetching, isError, error } = useGetScrapOverviewQuery(query);
  const rows = data?.data || [];
  const meta = data?.meta || {};
  const s = meta.summary || {};

  useEffect(() => { setPage(0); }, [search]);

  const activeFilters = (location !== 'ALL' ? 1 : 0) + (disposition !== 'ALL' ? 1 : 0)
    + (batchStatus !== 'ALL' ? 1 : 0) + (search ? 1 : 0);

  const exportCsv = () => {
    const header = ['Date', 'Batch No', 'Location', 'Coil SKU', 'Coil Name', 'Coil weight (kg)',
      'Circles weight (kg)', 'Scrap (kg)', 'Yield %', 'Checked', 'Verified on', 'Batch status', 'Conversion'];
    const lines = rows.map((r) => [
      r.scrapDate ? dayjs(r.scrapDate).format('YYYY-MM-DD') : '', r.batchNo, r.location,
      r.coilSkuCode, r.coilSkuName, r.coilWeightKg, r.circlesWeightKg, r.scrapKg,
      r.yieldRatioPct ?? '', DISPOSITION_TOKENS[r.disposition]?.label || r.disposition,
      r.verifiedAt ? dayjs(r.verifiedAt).format('YYYY-MM-DD') : '',
      r.batchStatus, r.conversionNumber || '',
    ]);
    const csv = [header, ...lines].map((x) => x.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `scrap-register_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <ScrapShell
      icon={Recycle}
      title="Scrap register"
      subtitle="Every coil cut on record — what it produced, what was left, and whether it was checked."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      {/* Totals cover the whole filtered set, not the page below. */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Scrap" value={kg(s.scrapKg)} sub={`Across ${num(s.batchesCut)} cuts`} color={SCRAP_ACCENT} icon={Recycle} />
        <KpiTile label="In-house" value={kg(s.inHouseScrapKg)} sub="PLG01 · physically held" color="#0f766e" icon={LOCATION_TOKENS.PLG01.icon} />
        <KpiTile label="Job work" value={kg(s.jobWorkScrapKg)} sub="JW001 · not held" color="#7c3aed" icon={LOCATION_TOKENS.JW001.icon} />
        <KpiTile label="Average yield" value={s.avgYield != null ? `${num(s.avgYield)}%` : '—'}
          sub={`Per cut · ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% is normal`} color={yieldBand(s.avgYield)?.color || '#15803d'} icon={Recycle} />
        {s.uncutBatches > 0 && (
          <KpiTile label="Coils not cut" value={num(s.uncutBatches)} sub="Excluded from the scrap figure" color="#b45309" icon={AlertTriangle} />
        )}
      </Stack>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by batch, coil code or name…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Where" value={location} onChange={(e) => setParam('location', e.target.value)} sx={{ minWidth: 168 }}>
            <MenuItem value="ALL">All locations</MenuItem>
            <MenuItem value="PLG01">{LOCATION_TOKENS.PLG01.label}</MenuItem>
            <MenuItem value="JW001">{LOCATION_TOKENS.JW001.label}</MenuItem>
          </TextField>
          <TextField select size="small" label="Checked?" value={disposition} onChange={(e) => setParam('disposition', e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="ALL">Any</MenuItem>
            {Object.entries(DISPOSITION_TOKENS).map(([k, t]) => <MenuItem key={k} value={k}>{t.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Cut?" value={batchStatus} onChange={(e) => setParam('batchStatus', e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="ALL">Any</MenuItem>
            <MenuItem value="CUT">Cut</MenuItem>
            <MenuItem value="UNCUT">Not cut</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
            <b>{num(meta.total || 0)}</b> record{meta.total === 1 ? '' : 's'}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" onClick={() => { setParams({}, { replace: true }); setSearch(''); setPage(0); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.sub }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>
      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1180)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 62, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell>Batch No.</TableCell>
                <TableCell>Coil</TableCell>
                <TableCell><Th label="Where" hint={H.location} /></TableCell>
                <TableCell align="right"><Th label="Coil weight" hint={H.coilWeight} /></TableCell>
                <TableCell align="right"><Th label="Circles weight" hint={H.circlesWeight} /></TableCell>
                <TableCell align="right"><Th label="Scrap" hint={H.scrapKg} /></TableCell>
                <TableCell align="right"><Th label="Yield" hint={H.yieldPct} /></TableCell>
                <TableCell><Th label="Checked?" hint={H.scrapVerified} /></TableCell>
                <TableCell><Th label="Cut?" hint={H.batchStatus} /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && !rows.length && (
                <TableRow><TableCell colSpan={12} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={280} /></TableCell></TableRow>
              )}
              {!isFetching && !rows.length && (
                <TableRow><TableCell colSpan={12} sx={{ border: 0 }}>
                  {/* A failed load is said as a failure, never as "no match". */}
                  <EmptyNote icon={Search}
                    title={isError ? 'Could not load the scrap register.' : 'No scrap records match these filters'}
                    hint={isError ? (error?.data?.message || 'The server did not answer. Refresh the page to try again.')
                      : 'Try clearing the location or check filter, or searching a different batch.'} />
                </TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={r._id} hover sx={r.batchStatus === 'UNCUT' ? { bgcolor: '#fffbeb' } : undefined}>
                  <TableCell align="center" sx={{ width: 62, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                    {page * rowsPerPage + i + 1}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{r.scrapDate ? dayjs(r.scrapDate).format('DD MMM YYYY') : '—'}</TableCell>
                  {/* ── THE WAY INTO THE COIL ──────────────────────────────
                      On the batch number, not in a trailing icon column. The
                      action lived at the far right of a table 1,328px wide in a
                      1,190px frame, so it sat off-screen behind a horizontal
                      scroll and was, in practice, invisible.

                      The batch number is also simply where people look for the
                      coil. Offered ONLY where the row names a goods receipt: a
                      row without `coilReceiptId` knows the grade and not the
                      coil, so there is nothing honest to open, and it says so
                      on hover instead of pretending to be a link. */}
                  <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    {r.coilReceiptId ? (
                      <Tooltip arrow slotProps={O2D_TIP} title="Open this physical coil — every round it was cut in, what each round produced, and how much coil was left after it">
                        <Box
                          role="button" tabIndex={0}
                          onClick={() => navigate(`/rm-ims/coil/${r.coilReceiptId}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/rm-ims/coil/${r.coilReceiptId}`); }}
                          sx={{
                            display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                            color: O2D.brand, fontWeight: 700,
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          <Disc3 size={13} />
                          {r.batchNo}
                        </Box>
                      </Tooltip>
                    ) : (
                      <Tooltip arrow slotProps={O2D_TIP} title="Untraceable — this record names a batch number but no goods receipt, so it cannot be tied to one physical coil. Nothing is linked to a coil by guesswork after the fact.">
                        <Box component="span" sx={{ cursor: 'help', color: O2D.body }}>{r.batchNo}</Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Typography noWrap sx={{ fontSize: '0.77rem', fontWeight: 600, color: O2D.ink }}>{r.coilSkuName}</Typography>
                    <Typography sx={{ fontSize: '0.64rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{r.coilSkuCode}</Typography>
                  </TableCell>
                  <TableCell><LocationChip location={r.location} /></TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{kg(r.coilWeightKg)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                    {r.batchStatus === 'UNCUT' ? <Box component="span" sx={{ color: O2D.faint }}>—</Box> : kg(r.circlesWeightKg)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: r.batchStatus === 'UNCUT' ? O2D.faint : SCRAP_ACCENT }}>
                    {r.batchStatus === 'UNCUT'
                      ? (
                        <Tooltip arrow slotProps={O2D_TIP} title="This coil was never cut, so no scrap came off it. The sheet reports the whole coil because its circle weight is blank — it is excluded from every total.">
                          <Box component="span" sx={{ cursor: 'help' }}>not scrap</Box>
                        </Tooltip>
                      )
                      : kg(r.scrapKg)}
                  </TableCell>
                  <TableCell align="right"><YieldChip pct={r.yieldRatioPct} disposition={r.disposition} /></TableCell>
                  <TableCell>
                    <DispositionChip disposition={r.disposition} />
                    {r.verifiedAt && (
                      <Typography sx={{ fontSize: '0.6rem', color: O2D.faint, mt: 0.2 }}>
                        {dayjs(r.verifiedAt).format('DD MMM YYYY')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell><BatchStatusChip batchStatus={r.batchStatus} /></TableCell>
                  <TableCell align="right" sx={{ width: 50 }}>
                    <Tooltip arrow slotProps={O2D_TIP} title="Open this cut — the circles it produced and the conversion behind it">
                      <IconButton size="small" onClick={() => navigate(`/scrap-ims/record/${r._id}`)} sx={{ color: O2D.sub }}>
                        <Eye size={15} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
        <TablePagination
          component="div" count={meta.total || 0} page={page} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Records per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsList;
