import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, Chip, MenuItem, FormControlLabel, Switch, CircularProgress, alpha, useTheme,
} from '@mui/material';
import { PackageMinus, Trash2, Save, AlertTriangle } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { ImsHero, num } from './imsMeta';
import { useGetImsOverviewQuery, useImsIssueMutation } from '../../store/api/imsApi';

// Stock-Out (production issue / consumption) — multi-line, reduces inventory.
const ImsStockOut = () => {
  const theme = useTheme();
  const { data } = useGetImsOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [issue, { isLoading }] = useImsIssueMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [purpose, setPurpose] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [department, setDepartment] = useState('');
  const [reference, setReference] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [lines, setLines] = useState([]); // {skuId, skuCode, skuName, unit, onHand, quantity}

  const addItem = (it) => {
    if (!it || lines.some((l) => l.skuId === it.skuId)) return;
    setLines((p) => [...p, { skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit, onHand: it.onHand, quantity: '' }]);
  };
  const setQty = (id, q) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, quantity: q } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const anyOver = lines.some((l) => Number(l.quantity) > l.onHand);

  const submit = async () => {
    try {
      const res = await issue({
        date, purpose, issuedTo, department, reference, allowNegative,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity) })),
      }).unwrap();
      enqueueSnackbar(`Issued ${res?.data?.count || lines.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setPurpose(''); setIssuedTo(''); setDepartment(''); setReference('');
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not issue stock.', { variant: 'error' }); }
  };

  const available = items.filter((i) => !lines.some((l) => l.skuId === i.skuId));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={PackageMinus} title="Stock Out — Production Issue" subtitle="Record items going out to production. Stock reduces automatically and the history is saved." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Date *" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField label="Purpose" size="small" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Buffing line" />
            <TextField label="Department" size="small" value={department} onChange={(e) => setDepartment(e.target.value)} />
            <TextField label="Issued to (person)" size="small" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} />
            <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)} />
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
            renderInput={(p) => <TextField {...p} label="Add item to issue" placeholder="Search code or name…" size="small" />}
          />

          <Box sx={{ overflowX: 'auto', mt: 2 }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['SKU', 'Item', 'On hand', 'Issue qty', ''].map((h, i) => (
                    <TableCell key={h} align={[2, 3].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>Add items above to build this issue.</TableCell></TableRow>
                )}
                {lines.map((l) => {
                  const over = Number(l.quantity) > l.onHand;
                  return (
                    <TableRow key={l.skuId} hover>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{l.skuCode}</TableCell>
                      <TableCell>{l.skuName}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(l.onHand)} {l.unit}</TableCell>
                      <TableCell align="right">
                        <TextField size="small" type="number" value={l.quantity} onChange={(e) => setQty(l.skuId, e.target.value)} error={over}
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
              label="Allow issue beyond on-hand (negative stock)" />
            <Stack direction="row" spacing={1.5} alignItems="center">
              {anyOver && !allowNegative && <Chip size="small" color="warning" icon={<AlertTriangle size={13} />} label="Some lines exceed stock" />}
              <Button variant="contained" disabled={!valid || isLoading || (anyOver && !allowNegative)} onClick={submit}
                startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />}>
                Issue stock
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default ImsStockOut;
