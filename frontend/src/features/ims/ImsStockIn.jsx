import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, MenuItem, CircularProgress, alpha, useTheme,
} from '@mui/material';
import { PackagePlus, Trash2, Save } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { ImsHero, num } from './imsMeta';
import { useGetImsOverviewQuery, useImsReceiveMutation } from '../../store/api/imsApi';

const REASONS = [
  { value: 'VENDOR', label: 'Vendor receipt (manual)' },
  { value: 'OPENING', label: 'Opening stock' },
  { value: 'CORRECTION', label: 'Correction / adjustment' },
];

// Stock-In — manual multi-line receipt (vendor / opening / correction). Adds to inventory.
const ImsStockIn = () => {
  const theme = useTheme();
  const { data } = useGetImsOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [receive, { isLoading }] = useImsReceiveMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [reason, setReason] = useState('VENDOR');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([]); // {skuId, skuCode, skuName, unit, onHand, quantity, unitCost}

  const addItem = (it) => {
    if (!it || lines.some((l) => l.skuId === it.skuId)) return;
    setLines((p) => [...p, { skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit, onHand: it.onHand, quantity: '', unitCost: '' }]);
  };
  const setField = (id, k, v) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, [k]: v } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);

  const submit = async () => {
    try {
      const res = await receive({
        date, reason, reference,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0) })),
      }).unwrap();
      enqueueSnackbar(`Added ${res?.data?.count || lines.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setReference('');
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
  };

  const available = items.filter((i) => !lines.some((l) => l.skuId === i.skuId));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={PackagePlus} title="Stock In — Add to Inventory" subtitle="Manually add received / opening / corrected stock. Vendor GRNs already post here automatically." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Date *" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField select label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
            <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bill / note no." />
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
                  <Typography variant="caption" color="text.secondary">{o.skuCode} · on hand {num(o.onHand)} {o.unit}</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => <TextField {...p} label="Add item to receive" placeholder="Search code or name…" size="small" />}
          />

          <Box sx={{ overflowX: 'auto', mt: 2 }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['SKU', 'Item', 'On hand', 'Add qty', 'Unit cost (₹)', ''].map((h, i) => (
                    <TableCell key={h} align={[2, 3, 4].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>Add items above to build this receipt.</TableCell></TableRow>
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
                      <TextField size="small" type="number" value={l.unitCost} onChange={(e) => setField(l.skuId, 'unitCost', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 90 } }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right"><IconButton size="small" color="error" onClick={() => remove(l.skuId)}><Trash2 size={15} /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button variant="contained" disabled={!valid || isLoading} onClick={submit}
              startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />}>
              Add to inventory
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default ImsStockIn;
