import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  ToggleButton, ToggleButtonGroup, Chip, IconButton, Tooltip, Skeleton, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, MenuItem, CircularProgress, Divider,
} from '@mui/material';
import { Layers, Search, Pencil, SlidersHorizontal, X, Save } from 'lucide-react';
import { ImsHero, StatusChip, num, inr } from '../ims/imsMeta';
import { useGetRmOverviewQuery, useUpsertRmPolicyMutation } from '../../store/api/rmImsApi';

const KIND_TABS = [{ k: 'ALL', label: 'All' }, { k: 'COIL', label: 'Coils' }, { k: 'CIRCLE', label: 'Circles' }];
const STATUS_TABS = ['ALL', 'REORDER', 'OUT_OF_STOCK', 'LOW', 'OK', 'OVERSTOCK'];

const num0 = (v) => (v == null ? '—' : num(v));

// Available % pill — red <33, amber 33-66, green 66-100, blue >100 (mirrors the sheet bands).
const PctPill = ({ pct }) => {
  const theme = useTheme();
  if (pct == null) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const c = pct < 33 ? theme.palette.error.main : pct <= 66 ? theme.palette.warning.main : pct <= 100 ? theme.palette.success.main : theme.palette.info.main;
  return <Chip size="small" label={`${pct}%`} sx={{ height: 20, fontWeight: 800, bgcolor: alpha(c, 0.14), color: c }} />;
};

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
  const derivedMax = Math.round((Number({ LOW: f.adcLow, NORMAL: f.adcNormal, PEAK: f.adcPeak }[f.consumptionMode]) || 0) * Number(f.leadDays) * Number(f.safetyFactor));

  const submit = async () => {
    await save({
      skuId: row.skuId,
      consumptionMode: f.consumptionMode,
      adcLow: Number(f.adcLow) || 0, adcNormal: Number(f.adcNormal) || 0, adcPeak: Number(f.adcPeak) || 0,
      leadDays: Number(f.leadDays) || 0, safetyFactor: Number(f.safetyFactor) || 0,
      moq: Number(f.moq) || 0, maxLevel: Number(f.maxLevel) || 0,
      materialInTransit: Number(f.materialInTransit) || 0, bookedQty: Number(f.bookedQty) || 0,
      openingStock: Number(f.openingStock) || 0, vendorName: f.vendorName || '', rate: Number(f.rate) || 0,
    }).unwrap().then(onClose).catch(() => {});
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Planning policy — {row.skuCode}
        <Typography variant="caption" color="text.secondary" display="block">{row.skuName} · {row.kind}</Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Daily avg consumption</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <TextField size="small" type="number" label="Low" value={f.adcLow} onChange={set('adcLow')} fullWidth />
              <TextField size="small" type="number" label="Normal" value={f.adcNormal} onChange={set('adcNormal')} fullWidth />
              <TextField size="small" type="number" label="Peak" value={f.adcPeak} onChange={set('adcPeak')} fullWidth />
            </Stack>
          </Box>
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Current consumption" value={f.consumptionMode} onChange={set('consumptionMode')} sx={{ width: 180 }}>
              <MenuItem value="LOW">Low</MenuItem><MenuItem value="NORMAL">Normal</MenuItem><MenuItem value="PEAK">Peak</MenuItem>
            </TextField>
            <TextField size="small" type="number" label="Lead time (days)" value={f.leadDays} onChange={set('leadDays')} fullWidth />
            <TextField size="small" type="number" label="Safety factor" value={f.safetyFactor} onChange={set('safetyFactor')} fullWidth />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" type="number" label="MOQ" value={f.moq} onChange={set('moq')} fullWidth />
            <TextField size="small" type="number" label="Max level (0 = auto)" value={f.maxLevel} onChange={set('maxLevel')} fullWidth helperText={`Auto = ADC×lead×SF ≈ ${num(derivedMax)}`} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" type="number" label="Material in transit" value={f.materialInTransit} onChange={set('materialInTransit')} fullWidth />
            <TextField size="small" type="number" label="Booked qty" value={f.bookedQty} onChange={set('bookedQty')} fullWidth />
            <TextField size="small" type="number" label="Opening stock" value={f.openingStock} onChange={set('openingStock')} fullWidth />
          </Stack>
          <Divider />
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Vendor" value={f.vendorName} onChange={set('vendorName')} fullWidth />
            <TextField size="small" type="number" label="Rate (₹/unit)" value={f.rate} onChange={set('rate')} sx={{ width: 160 }} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={isLoading} startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}>
          {isLoading ? 'Saving…' : 'Save policy'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RmImsStockList = () => {
  const theme = useTheme();
  const [kind, setKind] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);

  const params = useMemo(() => ({
    ...(kind !== 'ALL' ? { kind } : {}),
    ...(status !== 'ALL' ? { status } : {}),
    ...(search ? { search } : {}),
  }), [kind, status, search]);
  const { data, isFetching } = useGetRmOverviewQuery(params);
  const rows = data?.data || [];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={Layers} title="RM Stock & Master Data" subtitle="Every coil & circle with on-hand, planning levels and buying status." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper elevation={0} sx={{ p: 1.5, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
            <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, v) => v && setKind(v)}>
              {KIND_TABS.map((t) => <ToggleButton key={t.k} value={t.k} sx={{ textTransform: 'none', px: 2 }}>{t.label}</ToggleButton>)}
            </ToggleButtonGroup>
            <TextField
              size="small" placeholder="Search code / name / category…" value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ width: { xs: '100%', md: 320 }, '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
            />
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
            <SlidersHorizontal size={15} style={{ opacity: 0.5, marginTop: 4 }} />
            {STATUS_TABS.map((st) => (
              <Chip key={st} size="small" label={st === 'ALL' ? 'All' : st.replace('_', ' ')} clickable
                onClick={() => setStatus(st)} variant={status === st ? 'filled' : 'outlined'}
                color={status === st ? 'primary' : 'default'} sx={{ textTransform: 'capitalize' }} />
            ))}
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            {isFetching ? <Skeleton variant="rounded" height={360} /> : (
              <Table size="small" sx={{ minWidth: 1040 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['SKU', 'Kind', 'On hand', 'Max', 'In transit', 'Booked', 'Avail %', 'Days cover', 'Vendor', 'Status', ''].map((h, i) => (
                      <TableCell key={h} align={[2, 3, 4, 5, 7].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={11} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>No items match.</TableCell></TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.skuId} hover>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{r.skuName}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.skuCode}{r.category ? ` · ${r.category}` : ''}</Typography>
                      </TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={r.kind} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{num(r.onHand)}</TableCell>
                      <TableCell align="right">{num0(r.maxLevel)}</TableCell>
                      <TableCell align="right">{num0(r.inTransit)}</TableCell>
                      <TableCell align="right">{num0(r.booked)}</TableCell>
                      <TableCell align="right"><PctPill pct={r.availablePct} /></TableCell>
                      <TableCell align="right">{r.daysCover == null ? '—' : `${num(r.daysCover)}d`}</TableCell>
                      <TableCell><Typography variant="caption" noWrap>{r.vendorName || '—'}</Typography></TableCell>
                      <TableCell><StatusChip status={r.status} /></TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit planning policy"><IconButton size="small" onClick={() => setEdit(r)}><Pencil size={15} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Paper>
      </Box>

      {edit && <PolicyDialog row={edit} onClose={() => setEdit(null)} />}
    </Box>
  );
};

export default RmImsStockList;
