import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, Button, MenuItem,
  CircularProgress, Collapse, TablePagination, Chip,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { Layers, Search, Pencil, X, Save, Info, Download, Calculator, Disc3, CircleDashed } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  RmShell, Panel, TableScroll, KpiTile, StatusChip, StatusLegend, EmptyNote, Th, Eyebrow,
  KindChip, AvailMeter, availBand,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr, imsTableSx,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useUpsertRmPolicyMutation } from '../../store/api/rmImsApi';

const num0 = (v) => (v == null ? '—' : num(v));

// Every planning word on this screen, in plain English. Raw material carries a
// couple of terms consumables do not — booked quantity and the three
// consumption modes — so they get spelled out too.
const GLOSSARY = [
  ['On hand', 'How much of this coil or circle is physically in the store right now.'],
  ['In transit', 'Ordered from the vendor but not yet received.'],
  ['Booked', 'Already promised to a confirmed order — not really free to use.'],
  ['Available %', 'On-hand measured against the level this item is planned to hold. Under 33% is critical.'],
  ['Order up to', 'The ceiling. When we buy, we buy enough to reach this level.'],
  ['Cover', 'How many days the current stock lasts at the chosen daily consumption rate.'],
  ['Consumption mode', 'Whether we are planning against a Low, Normal or Peak production rate. It picks which daily-use figure drives the reorder point.'],
];

const KIND_FILTERS = [
  { value: 'ALL', label: 'All raw material', icon: Layers },
  { value: 'COIL', label: 'Coils only', icon: Disc3 },
  { value: 'CIRCLE', label: 'Circles only', icon: CircleDashed },
];

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

// ── Planning policy dialog ───────────────────────────────────────────────────
// Same idea as the consumables drawer: show the arithmetic live, so nobody has
// to save a change to find out what it did to the reorder point.
const PolicyDialog = ({ row, onClose }) => {
  const [save, { isLoading }] = useUpsertRmPolicyMutation();
  const [f, setF] = useState({
    consumptionMode: row.consumptionMode || 'LOW',
    adcLow: row.adcLow || 0, adcNormal: row.adcNormal || 0, adcPeak: row.adcPeak || 0,
    leadDays: row.leadDays || 16, safetyFactor: row.safetyFactor || 2,
    moq: row.moq || 0, maxLevel: row.maxLevel || 0,
    materialInTransit: row.inTransit || 0, bookedQty: row.booked || 0,
    openingStock: row.openingStock || 0, vendorName: row.vendorName || '', rate: row.rate || 0,
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const activeAdc = Number({ LOW: f.adcLow, NORMAL: f.adcNormal, PEAK: f.adcPeak }[f.consumptionMode]) || 0;
  const lead = Number(f.leadDays) || 0;
  const sf = Number(f.safetyFactor) || 0;
  const derived = Math.round(activeAdc * lead * sf);
  const effectiveMax = Number(f.maxLevel) || derived;
  const modeLabel = { LOW: 'Low', NORMAL: 'Normal', PEAK: 'Peak' }[f.consumptionMode];

  const submit = async () => {
    try {
      await save({
        skuId: row.skuId,
        consumptionMode: f.consumptionMode,
        adcLow: Number(f.adcLow) || 0, adcNormal: Number(f.adcNormal) || 0, adcPeak: Number(f.adcPeak) || 0,
        leadDays: lead, safetyFactor: sf,
        moq: Number(f.moq) || 0, maxLevel: Number(f.maxLevel) || 0,
        materialInTransit: Number(f.materialInTransit) || 0, bookedQty: Number(f.bookedQty) || 0,
        openingStock: Number(f.openingStock) || 0, vendorName: f.vendorName || '', rate: Number(f.rate) || 0,
      }).unwrap();
      enqueueSnackbar('Planning policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the policy.', { variant: 'error' }); }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: '10px', border: `1px solid ${O2D.line}` } }}>
      <DialogTitle sx={{ py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink }}>Planning policy</Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {row.skuName} · {row.skuCode}
            </Typography>
          </Box>
          <KindChip kind={row.kind} withHint={false} />
          <IconButton size="small" onClick={onClose} sx={{ color: O2D.sub }}><X size={16} /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: O2D.canvas, p: 1.5 }}>
        <Stack spacing={1.25}>
          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>How fast is it used?</Eyebrow>
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.4, mb: 1.25 }}>
              Enter the daily consumption at each production rate, then pick which rate we are planning against today.
              Only the selected one drives the reorder point.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" type="number" label="Low rate / day" value={f.adcLow} onChange={set('adcLow')} fullWidth />
              <TextField size="small" type="number" label="Normal rate / day" value={f.adcNormal} onChange={set('adcNormal')} fullWidth />
              <TextField size="small" type="number" label="Peak rate / day" value={f.adcPeak} onChange={set('adcPeak')} fullWidth />
            </Stack>
            <TextField select size="small" label="Planning against" value={f.consumptionMode} onChange={set('consumptionMode')}
              fullWidth sx={{ mt: 1.5 }}
              helperText="Switch this when the factory moves between a slow season and a busy one."
              FormHelperTextProps={helperSx}>
              <MenuItem value="LOW">Low production</MenuItem>
              <MenuItem value="NORMAL">Normal production</MenuItem>
              <MenuItem value="PEAK">Peak production</MenuItem>
            </TextField>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>How long does it take to arrive?</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25 }}>
              <TextField size="small" type="number" label="Lead time (days)" value={f.leadDays} onChange={set('leadDays')} fullWidth
                helperText="Days the vendor takes to deliver." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Safety factor" value={f.safetyFactor} onChange={set('safetyFactor')} fullWidth
                helperText="Cushion for spikes and late deliveries." FormHelperTextProps={helperSx} />
            </Stack>
          </Paper>

          {/* Live arithmetic */}
          <Paper elevation={0} sx={{
            p: 1.5, borderRadius: '8px',
            border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Calculator size={15} /></Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>What this works out to</Typography>
            </Stack>
            <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
              {activeAdc > 0 && lead > 0 && sf > 0 ? (
                <>
                  At the <b>{modeLabel}</b> rate: {num(activeAdc)} per day × {num(lead)} days × {num(sf)} safety
                  = <b>reorder at {num(derived)}</b>. IMS will flag this item the moment on-hand falls to {num(derived)},
                  and will suggest ordering back up to {num(effectiveMax)}.
                </>
              ) : `Enter the ${modeLabel} daily rate, lead time and safety factor to see the reorder point this produces.`}
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>Buying rules and current commitments</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25 }}>
              <TextField size="small" type="number" label="Minimum order quantity" value={f.moq} onChange={set('moq')} fullWidth
                helperText="Smallest quantity the supplier accepts." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Order up to (max level)" value={f.maxLevel} onChange={set('maxLevel')} fullWidth
                helperText={`Leave 0 to use the calculated ${num(derived)}.`} FormHelperTextProps={helperSx} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.5 }}>
              <TextField size="small" type="number" label="Already in transit" value={f.materialInTransit} onChange={set('materialInTransit')} fullWidth
                helperText="Ordered, not yet received." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Booked against orders" value={f.bookedQty} onChange={set('bookedQty')} fullWidth
                helperText="Promised to confirmed orders." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Opening stock" value={f.openingStock} onChange={set('openingStock')} fullWidth
                helperText="Balance when tracking began." FormHelperTextProps={helperSx} />
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>Supplier</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25 }}>
              <TextField size="small" label="Vendor" value={f.vendorName} onChange={set('vendorName')} fullWidth />
              <TextField size="small" type="number" label="Rate (₹ per unit)" value={f.rate} onChange={set('rate')} sx={{ width: { xs: '100%', sm: 180 } }}
                helperText="Used to value stock and estimate spend." FormHelperTextProps={helperSx} />
            </Stack>
          </Paper>

          <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
            Changing this policy never changes the stock itself — on-hand only moves through Stock In, Stock Out and coil cutting.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: `1px solid ${O2D.lineSoft}`, px: 1.5, py: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={submit} disabled={isLoading}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
          Save policy
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RmImsStockList = () => {
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState(params.get('kind') || 'ALL');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [showGlossary, setShowGlossary] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Load the whole set and filter kind/status client-side, so the legend can
  // show live counts for every band rather than only the one being viewed.
  const queryArgs = useMemo(() => (search ? { search } : {}), [search]);
  const { data, isFetching } = useGetRmOverviewQuery(queryArgs);
  const rows = useMemo(() => data?.data || [], [data]);

  const setParam = (key, value, setter) => {
    setter(value);
    if (value === 'ALL') params.delete(key); else params.set(key, value);
    setParams(params, { replace: true });
  };

  const kindRows = useMemo(() => (kind === 'ALL' ? rows : rows.filter((r) => r.kind === kind)), [rows, kind]);
  const counts = useMemo(() => {
    const c = { ALL: kindRows.length };
    STOCK_ORDER.forEach((k) => { c[k] = kindRows.filter((r) => r.status === k).length; });
    return c;
  }, [kindRows]);

  const filtered = useMemo(() => {
    const list = status === 'ALL' ? kindRows : kindRows.filter((r) => r.status === status);
    // Worst first, then thinnest availability — the order a planner works in.
    return [...list].sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
      || (a.availablePct ?? 1e9) - (b.availablePct ?? 1e9));
  }, [kindRows, status]);

  useEffect(() => { setPage(0); }, [search, kind, status, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const summary = useMemo(() => ({
    coils: rows.filter((r) => r.kind === 'COIL').length,
    circles: rows.filter((r) => r.kind === 'CIRCLE').length,
    onHand: rows.reduce((t, r) => t + Number(r.onHand || 0), 0),
    value: rows.reduce((t, r) => t + Number(r.onHand || 0) * Number(r.rate || 0), 0),
    toOrder: rows.filter((r) => ['REORDER', 'OUT_OF_STOCK'].includes(r.status)).length,
  }), [rows]);

  const exportCsv = () => {
    const header = ['Code', 'Item', 'Kind', 'Category', 'On hand', 'Order up to', 'In transit', 'Booked', 'Available %', 'Days cover', 'Vendor', 'Status'];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.kind, r.category, r.onHand, r.maxLevel, r.inTransit, r.booked,
      r.availablePct ?? '', r.daysCover ?? '', r.vendorName, stockToken(r.status).label,
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `raw-material-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (kind !== 'ALL' ? 1 : 0) + (status !== 'ALL' ? 1 : 0) + (search ? 1 : 0);

  return (
    <RmShell
      icon={Layers}
      title="Stock & Master Data"
      subtitle="Every coil and circle — what's on hand, what's committed, and when to buy more."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Coils" value={num(summary.coils)} sub="Uncut raw metal" color="#0f766e" icon={Disc3}
          active={kind === 'COIL'} onClick={() => setParam('kind', kind === 'COIL' ? 'ALL' : 'COIL', setKind)} />
        <KpiTile label="Circles" value={num(summary.circles)} sub="Cut and ready" color="#4338ca" icon={CircleDashed}
          active={kind === 'CIRCLE'} onClick={() => setParam('kind', kind === 'CIRCLE' ? 'ALL' : 'CIRCLE', setKind)} />
        <KpiTile label="Units on hand" value={num(summary.onHand)} sub="Across all raw material" color={O2D.brand} icon={Layers} />
        <KpiTile label="Value in store" value={inr(summary.value)} sub="At the recorded rate" color="#7c3aed" icon={Calculator} />
        <KpiTile label="To order now" value={num(summary.toOrder)} sub="At or below reorder point"
          color={STOCK_TOKENS.REORDER.color} icon={Info} />
      </Stack>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, item or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Material" value={kind} onChange={(e) => setParam('kind', e.target.value, setKind)} sx={{ minWidth: 175 }}>
            {KIND_FILTERS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
          </TextField>
          <Button size="small" startIcon={<Info size={14} />} onClick={() => setShowGlossary((v) => !v)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: showGlossary ? O2D.brand : O2D.sub }}>
            What do these columns mean?
          </Button>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />}
              onClick={() => { setSearch(''); setParam('kind', 'ALL', setKind); setParam('status', 'ALL', setStatus); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <StatusLegend counts={counts} value={status} onPick={(s) => setParam('status', s, setStatus)} />
        </Box>

        <Collapse in={showGlossary}>
          <Box sx={{ mt: 1, p: 1.25, borderRadius: '7px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
            <Eyebrow>How to read this table</Eyebrow>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.6, mt: 0.75 }}>
              {GLOSSARY.map(([term, meaning]) => (
                <Stack key={term} direction="row" spacing={0.75}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.ink, minWidth: 118, flexShrink: 0 }}>{term}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{meaning}</Typography>
                </Stack>
              ))}
            </Box>
          </Box>
        </Collapse>
      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1120)}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell>Material</TableCell>
                <TableCell align="right"><Th label="On hand" hint="How much is physically in the store right now." /></TableCell>
                <TableCell align="right"><Th label="Order up to" hint="The level we buy back up to when ordering." /></TableCell>
                <TableCell align="right"><Th label="In transit" hint="Ordered from the vendor but not yet received." /></TableCell>
                <TableCell align="right"><Th label="Booked" hint="Already promised to confirmed orders — not free to use." /></TableCell>
                <TableCell align="right"><Th label="Available" hint="On-hand as a share of the level this item is planned to hold. Under 33% is critical." /></TableCell>
                <TableCell align="right"><Th label="Cover" hint="Days the current stock lasts at the chosen daily consumption rate." /></TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={11} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={280} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={11} sx={{ border: 0 }}>
                  <EmptyNote icon={Layers} title="No raw material matches these filters"
                    hint="Try clearing the status filter, switching between coils and circles, or searching a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r) => {
                const t = stockToken(r.status);
                const critical = r.status === 'OUT_OF_STOCK' || r.status === 'REORDER';
                const band = availBand(r.availablePct);
                return (
                  <TableRow key={r.skuId} hover sx={{
                    ...(critical ? { bgcolor: t.tint, borderLeft: `3px solid ${t.color}` } : { borderLeft: '3px solid transparent' }),
                  }}>
                    <TableCell sx={{ maxWidth: 270 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>
                        {r.skuCode}{r.category ? ` · ${r.category}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell><KindChip kind={r.kind} /></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num0(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inTransit ? O2D.body : O2D.faint }}>{num0(r.inTransit)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.booked ? O2D.body : O2D.faint }}>{num0(r.booked)}</TableCell>
                    <TableCell align="right"><AvailMeter pct={r.availablePct} /></TableCell>
                    <TableCell align="right" sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: band && band.color === '#b91c1c' ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.body,
                    }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 150 }}>
                      <Typography noWrap sx={{ fontSize: '0.73rem', color: r.vendorName ? O2D.body : O2D.faint }} title={r.vendorName}>
                        {r.vendorName || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right" sx={{ width: 52 }}>
                      <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (daily use, lead time, safety, vendor)">
                        <IconButton size="small" onClick={() => setEdit(r)} sx={{ color: O2D.sub }}><Pencil size={15} /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <TablePagination
          component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>

      {/* Availability bands, spelled out once so the meter never needs decoding. */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ px: 0.5 }}>
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, fontWeight: 700 }}>Availability bands:</Typography>
        {[[0, 'Under 33% — critically low'], [50, '33–66% — thin'], [90, '67–100% — comfortable'], [110, 'Over 100% — above plan']]
          .map(([p, label]) => {
            const b = availBand(p);
            return (
              <Chip key={label} size="small" label={label}
                sx={{
                  height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px',
                  bgcolor: O2D.surface, color: b.color, border: `1px solid ${b.color}44`,
                }} />
            );
          })}
      </Stack>

      {edit && <PolicyDialog row={edit} onClose={() => setEdit(null)} />}
    </RmShell>
  );
};

export default RmImsStockList;
