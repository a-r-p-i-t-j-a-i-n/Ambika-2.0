import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, Chip, FormControlLabel, Switch, CircularProgress, alpha,
} from '@mui/material';
import { Truck, Trash2, Save, AlertTriangle } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { FgHero, num } from './fgImsMeta';
import { useGetFgOverviewQuery, useFgDispatchMutation } from '../../store/api/fgImsApi';

// Dispatch Out — record finished goods shipped to a customer. Reduces inventory.
// Standalone entry for now (not yet auto-wired to the Dispatch module).
const FgImsDispatchOut = () => {
  const { data } = useGetFgOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [dispatch, { isLoading }] = useFgDispatchMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [customer, setCustomer] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [reference, setReference] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [lines, setLines] = useState([]);

  const addItem = (it) => {
    if (!it || lines.some((l) => l.skuId === it.skuId)) return;
    setLines((p) => [...p, { skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit, onHand: it.onHand, quantity: '' }]);
  };
  const setQty = (id, q) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, quantity: q } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const totalQty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const anyOver = lines.some((l) => Number(l.quantity) > l.onHand);

  const submit = async () => {
    try {
      const res = await dispatch({
        date, customer, orderNo, vehicleNo, reference, allowNegative,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity) })),
      }).unwrap();
      enqueueSnackbar(`Dispatched ${res?.data?.count || lines.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setCustomer(''); setOrderNo(''); setVehicleNo(''); setReference('');
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not record dispatch.', { variant: 'error' }); }
  };

  const available = items.filter((i) => !lines.some((l) => l.skuId === i.skuId));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={Truck} title="Dispatch Out — Goods Shipped" subtitle="Record finished goods shipped to a customer. Stock reduces automatically and the history is saved." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Dispatch date *" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField label="Customer" size="small" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Party name" />
            <TextField label="Order no." size="small" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
            <TextField label="Vehicle no." size="small" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
            <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Challan / invoice no." />
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
            renderInput={(p) => <TextField {...p} label="Add finished good to dispatch" placeholder="Search code or name…" size="small" />}
          />

          <Box sx={{ overflowX: 'auto', mt: 2 }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#059669', 0.06) }}>
                  {['SKU', 'Finished good', 'In stock', 'Dispatch qty', ''].map((h, i) => (
                    <TableCell key={h || i} align={[2, 3].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>Add finished goods above to build this dispatch.</TableCell></TableRow>
                )}
                {lines.map((l) => {
                  const over = Number(l.quantity) > l.onHand;
                  return (
                    <TableRow key={l.skuId} hover>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{l.skuCode}</TableCell>
                      <TableCell>{l.skuName}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(l.onHand)} {l.unit}</TableCell>
                      <TableCell align="right">
                        <TextField size="small" type="number" value={l.quantity} onChange={(e) => setQty(l.skuId, e.target.value)} error={over && !allowNegative}
                          inputProps={{ min: 0, style: { textAlign: 'right', width: 90, fontWeight: 700 } }}
                          helperText={over && !allowNegative ? 'Over stock' : ' '} />
                      </TableCell>
                      <TableCell align="right"><IconButton size="small" color="error" onClick={() => remove(l.skuId)}><Trash2 size={15} /></IconButton></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
            <FormControlLabel control={<Switch checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />}
              label="Allow dispatch beyond in-stock (negative stock)" />
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" color="text.secondary">Total: <b>{num(totalQty)}</b> units</Typography>
              {anyOver && !allowNegative && <Chip size="small" color="warning" icon={<AlertTriangle size={13} />} label="Some lines exceed stock" />}
              <Button variant="contained" color="error" disabled={!valid || isLoading || (anyOver && !allowNegative)} onClick={submit}
                startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />}>
                Record dispatch
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default FgImsDispatchOut;
