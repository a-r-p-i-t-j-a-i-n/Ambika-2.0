import React, { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, TextField, MenuItem, Table, TableHead, TableBody, TableRow,
  TableCell, TablePagination, Chip,
} from '@mui/material';
import { ScrollText, Recycle, ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react';
import dayjs from 'dayjs';
import {
  ScrapShell, Panel, TableScroll, EmptyNote, Th, KpiTile, ScrapTxnChip, SCRAP_REASON_LABEL,
  SCRAP_WAREHOUSE_OPTIONS, SCRAP_UOM, SCRAP_ACCENT, O2D, num, imsTableSx,
} from './scrapImsMeta';
import { useGetScrapMovementsQuery, useGetScrapStockQuery } from '../../store/api/scrapImsApi';
import { fmtEntered, unitLabel } from './scrapUom';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.scrap;

/**
 * Scrap movement — every movement against the scrap item.
 *
 * This is the BALANCE side of the module, not the production register. A cut
 * shows up here only when it was in-house; the register shows every cut. The
 * two are meant to differ, and the header says so rather than leaving someone
 * to discover it by subtracting.
 */
const ScrapImsMovements = () => {
  const [filters, setFilters] = useState({ warehouse: '', txnType: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  // The ledger has always been searchable on the server (movement no., reference,
  // party/buyer name) — this is the box for it, debounced so typing a buyer's
  // name is one request rather than one per key.
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = { page: page + 1, limit };
  for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;

  const { data, isFetching, isError, error } = useGetScrapMovementsQuery(params);
  const { data: stockRes } = useGetScrapStockQuery();

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const summary = meta.summary || {};
  const stock = stockRes?.data;

  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };

  return (
    <ScrapShell
      icon={ScrollText}
      title="Scrap movement"
      subtitle="Every kilogram of scrap that entered or left the yard, and what it was for."
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.25 }}>
        <KpiTile label="Scrap on hand" value={`${num(stock?.totalKg || 0)} kg`}
          sub="Across every location" color={SCRAP_ACCENT} icon={Recycle} />
        <KpiTile label="Total in" value={`${num(summary.inKg || 0)} kg`}
          sub={`${summary.inCount || 0} movements`} color="#15803d" icon={ArrowDownToLine} />
        <KpiTile label="Total out" value={`${num(summary.outKg || 0)} kg`}
          sub={`${summary.outCount || 0} movements`} color="#b91c1c" icon={ArrowUpFromLine} />
        <KpiTile label="Unit" value={SCRAP_UOM}
          sub="Scrap is only ever weighed" color="#0f766e" icon={Scale} />
      </Box>

      {/* Where the scrap physically sits. Worth its own strip: the in-house and
          job-work piles are not interchangeable. */}
      {!!stock?.byWarehouse?.length && (
        <Panel title="Where it is" hint="Scrap is held per location, and each is issued from separately.">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {stock.byWarehouse.map((w) => (
              <Chip
                key={w.warehouse} size="small"
                label={`${w.warehouse} — ${num(w.qtyOnHand)} kg`}
                sx={{
                  height: 26, fontWeight: 700, fontSize: '0.72rem', borderRadius: '999px',
                  bgcolor: w.isPhysicalScrap ? '#ccfbf1' : '#ede9fe',
                  color: w.isPhysicalScrap ? '#0f766e' : '#7c3aed',
                  border: `1px solid ${w.isPhysicalScrap ? '#99f6e4' : '#ddd6fe'}`,
                }}
              />
            ))}
          </Stack>
        </Panel>
      )}

      <Panel title="Movements" hint="Newest first.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: '1.6fr repeat(4, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField size="small" label="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buyer, GSTIN, phone, movement or reference no." inputProps={{ 'data-testid': 'scrap-mv-search' }} />
          <TextField select size="small" label="Direction" value={filters.txnType} onChange={(e) => set('txnType', e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="SCRAP_IN">In</MenuItem>
            <MenuItem value="SCRAP_OUT">Out</MenuItem>
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
          <Table size="small" sx={imsTableSx(1120)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Date" /></TableCell>
                <TableCell><Th label="Movement" /></TableCell>
                <TableCell><Th label="In / Out" hint={H.inOut} /></TableCell>
                <TableCell><Th label="Where" /></TableCell>
                <TableCell align="right"><Th label="Quantity" hint={H.quantity} /></TableCell>
                <TableCell align="right"><Th label="Balance after" hint={H.balanceAfter} /></TableCell>
                <TableCell><Th label="Why" /></TableCell>
                <TableCell><Th label="Party" hint={H.party} /></TableCell>
                <TableCell><Th label="Reference" hint={H.reference} /></TableCell>
                <TableCell><Th label="By" /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((m, i) => (
                <TableRow key={m._id} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell>{m.movementDate ? dayjs(m.movementDate).format('DD MMM YY') : '—'}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{m.movementNumber || '—'}</TableCell>
                  <TableCell><ScrapTxnChip txnType={m.txnType} /></TableCell>
                  <TableCell>{m.warehouse}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: m.txnType === 'SCRAP_OUT' ? '#b91c1c' : '#15803d' }}>
                    {m.txnType === 'SCRAP_OUT' ? '−' : '+'}{num(m.quantity)}
                    {/* The figure as entered, when it was not in kg (e.g. 5 Quintal). */}
                    {!!m.enteredUom && m.enteredUom !== 'KG' && (
                      <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: O2D.sub }}>
                        {fmtEntered(m.enteredQty, m.enteredUom)} {unitLabel(m.enteredUom)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{num(m.balanceAfter)}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.74rem' }}>
                      {SCRAP_REASON_LABEL[m.reason] || m.reason || '—'}
                    </Typography>
                    {m.reason === 'OTHER' && !!m.customReason && (
                      <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{m.customReason}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.74rem', fontWeight: m.buyer ? 600 : 400 }}>{m.partyName || '—'}</Typography>
                    {/* A sale's buyer, as recorded from the Scrap Buyer master at the time. */}
                    {!!m.buyer && (
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }}>
                        {[m.buyer.code, m.buyer.phone, m.buyer.gstNo && `GSTIN ${m.buyer.gstNo}`].filter(Boolean).join(' · ')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{m.refNumber || '—'}</TableCell>
                  <TableCell>{m.performedByName || '—'}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={11}>
                    {/* A failed load is said as a failure — never as "nothing yet",
                        which would tell the operator something false. Same rule
                        Scrap Out History already follows. */}
                    <EmptyNote
                      icon={ScrollText}
                      title={isFetching ? 'Loading…' : isError ? 'Could not load the scrap movements.' : 'No scrap movements yet'}
                      hint={isFetching ? undefined
                        : isError ? (error?.data?.message || 'The server did not answer. Refresh the page to try again.')
                          : 'Cutting a coil in-house adds its scrap here automatically. Use Scrap In for scrap that arrived some other way.'}
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
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={limit}
          onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsMovements;
