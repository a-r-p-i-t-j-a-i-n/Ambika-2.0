import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, MenuItem, CircularProgress, alpha,
} from '@mui/material';
import { Factory, Trash2, Save } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { FgHero, FG_ACCENT, num } from './fgImsMeta';
import { useGetFgOverviewQuery, useFgProduceMutation } from '../../store/api/fgImsApi';

const REASONS = [
  { value: 'PRODUCTION', label: 'Production (Daily Production Report)' },
  { value: 'OPENING', label: 'Opening stock' },
  { value: 'SALES_RETURN', label: 'Sales return (goods back in)' },
  { value: 'CORRECTION', label: 'Correction / adjustment' },
];

// Production In — record finished goods completed on the line (the DPR). Adds to stock.
const FgImsProductionIn = () => {
  const { data } = useGetFgOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [produce, { isLoading }] = useFgProduceMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [reason, setReason] = useState('PRODUCTION');
  const [reference, setReference] = useState('');
  const [shift, setShift] = useState('');
  const [line, setLine] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [lines, setLines] = useState([]);

  const addItem = (it) => {
    if (!it || lines.some((l) => l.skuId === it.skuId)) return;
    setLines((p) => [...p, { skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit, onHand: it.onHand, quantity: '', batchNo: '' }]);
  };
  const setField = (id, k, v) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, [k]: v } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const totalQty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const isProduction = reason === 'PRODUCTION';

  const submit = async () => {
    try {
      const res = await produce({
        date, reason, reference,
        shift: isProduction ? shift : undefined,
        line: isProduction ? line : undefined,
        supervisor: isProduction ? supervisor : undefined,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity), batchNo: l.batchNo || '' })),
      }).unwrap();
      enqueueSnackbar(`Recorded ${res?.data?.count || lines.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setReference('');
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not record production.', { variant: 'error' }); }
  };

  const available = items.filter((i) => !lines.some((l) => l.skuId === i.skuId));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={Factory} title="Production In — Daily Production Report" subtitle="Record finished goods completed on the line. Stock is added automatically and the history is kept." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Production date *" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField select label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
            <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DPR / doc no." />
            {isProduction && <>
              <TextField label="Shift" size="small" value={shift} onChange={(e) => setShift(e.target.value)} placeholder="A / B / General" />
              <TextField label="Line / machine" size="small" value={line} onChange={(e) => setLine(e.target.value)} />
              <TextField label="Supervisor" size="small" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
            </>}
          </Box>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Autocomplete
            options={available}
            getOptionLabel={(o) => `${o.skuCode} — ${o.skuName}`}
            value={null} blurOnSelect clearOnBlur
            onChange={(_, v) => addItem(v)}
            renderOption={(props, o) => (
              <li {...props} key={o.skuId}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.skuName}</Typography>
                  <Typography variant="caption" color="text.secondary">{o.skuCode} · in stock {num(o.onHand)} {o.unit}</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => <TextField {...p} label="Add finished good produced" placeholder="Search code or name…" size="small" />}
          />

          <Box sx={{ overflowX: 'auto', mt: 2 }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(FG_ACCENT, 0.06) }}>
                  {['SKU', 'Finished good', 'In stock', 'Produced qty', 'Batch / lot', ''].map((h, i) => (
                    <TableCell key={h || i} align={[2, 3].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>Add finished goods above to build this production entry.</TableCell></TableRow>
                )}
                {lines.map((l) => (
                  <TableRow key={l.skuId} hover>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{l.skuCode}</TableCell>
                    <TableCell>{l.skuName}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(l.onHand)} {l.unit}</TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.quantity} onChange={(e) => setField(l.skuId, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 90, fontWeight: 700 } }} />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" value={l.batchNo} onChange={(e) => setField(l.skuId, 'batchNo', e.target.value)}
                        placeholder="optional" inputProps={{ style: { width: 110 } }} />
                    </TableCell>
                    <TableCell align="right"><IconButton size="small" color="error" onClick={() => remove(l.skuId)}><Trash2 size={15} /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">Total produced: <b>{num(totalQty)}</b> units across {lines.length} item(s)</Typography>
            <Button variant="contained" disabled={!valid || isLoading} onClick={submit}
              sx={{ bgcolor: FG_ACCENT, '&:hover': { bgcolor: '#047857' } }}
              startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />}>
              Add to inventory
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default FgImsProductionIn;
