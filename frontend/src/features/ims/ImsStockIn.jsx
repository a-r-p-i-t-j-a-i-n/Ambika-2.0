import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, MenuItem, CircularProgress, Tooltip, Chip, alpha,
} from '@mui/material';
import { PackagePlus, Trash2, Save, ArrowRight, Info } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  ImsShell, Panel, TableScroll, EmptyNote, Th, O2D, O2D_TIP, STOCK_TOKENS, num, inr, imsTableSx,
} from './imsMeta';
import { useGetImsOverviewQuery, useImsReceiveMutation } from '../../store/api/imsApi';

const REASONS = [
  { value: 'VENDOR', label: 'Vendor receipt', hint: 'Material physically received from a supplier against a bill or challan.' },
  { value: 'OPENING', label: 'Opening stock', hint: 'The stock that already existed when you started using IMS.' },
  { value: 'CORRECTION', label: 'Correction / adjustment', hint: 'Fixing a counting mistake so the system matches the physical store.' },
];

// A numbered step header. Forms that read as 1 → 2 → 3 are the single biggest
// legibility win for a first-time user; nothing here is guesswork.
const StepHead = ({ n, title, hint, done }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box sx={{
      width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
      fontSize: '0.7rem', fontWeight: 800,
      bgcolor: done ? STOCK_TOKENS.OK.bg : alpha(O2D.brand, 0.1),
      color: done ? STOCK_TOKENS.OK.color : O2D.brand,
      border: `1px solid ${done ? STOCK_TOKENS.OK.border : alpha(O2D.brand, 0.25)}`,
    }}>{n}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.25 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{hint}</Typography>}
    </Box>
  </Stack>
);

// Stock In — manual multi-line receipt (vendor / opening / correction). Adds to inventory.
const ImsStockIn = () => {
  const { data } = useGetImsOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [receive, { isLoading }] = useImsReceiveMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [reason, setReason] = useState('VENDOR');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([]); // {skuId, skuCode, skuName, unit, onHand, quantity, unitCost}

  const addItem = (it) => {
    if (!it || lines.some((l) => l.skuId === it.skuId)) return;
    setLines((p) => [...p, {
      skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit,
      onHand: it.onHand, maxLevel: it.maxLevel, quantity: '', unitCost: '',
    }]);
  };
  const setField = (id, k, v) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, [k]: v } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const totalQty = lines.reduce((t, l) => t + Number(l.quantity || 0), 0);
  const totalValue = lines.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const activeReason = REASONS.find((r) => r.value === reason);

  const submit = async () => {
    try {
      const res = await receive({
        date, reason, reference,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0) })),
      }).unwrap();
      enqueueSnackbar(`Stock added for ${res?.data?.count || lines.length} item(s).`, { variant: 'success' });
      setLines([]); setReference('');
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
  };

  const available = items.filter((i) => !lines.some((l) => l.skuId === i.skuId));

  return (
    <ImsShell
      icon={PackagePlus}
      title="Stock In — bring material into the store"
      subtitle="Record what arrived. On-hand goes up and the movement is logged against your name."
      maxWidth={1180}
    >
      {/* What this screen does and does not do — stated up front so nobody
          double-enters a vendor receipt that GRN already posted. */}
      <Paper elevation={0} sx={{
        borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt,
      }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            Use this only for stock you are adding <b>by hand</b> — opening balances, corrections, or a receipt with no
            purchase order. Vendor GRNs raised in Procurement already post into IMS automatically, so entering them here
            would double-count the stock.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 — the receipt header ── */}
      <Panel>
        <StepHead n={1} title="Receipt details" hint="When it arrived and why it is being added." done={!!date} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField label="Date received" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          <TextField select label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value)}
            helperText={activeReason?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}>
            {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="Bill / challan / note no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 — the lines ── */}
      <Panel>
        <StepHead n={2} title="What is coming in?" hint="Search for an item, then type the quantity received." done={lines.length > 0} />
        <Autocomplete
          sx={{ mt: 1.25 }}
          options={available}
          getOptionLabel={(o) => `${o.skuCode} — ${o.skuName}`}
          value={null} blurOnSelect clearOnBlur
          onChange={(_, v) => addItem(v)}
          renderOption={(props, o) => (
            <li {...props} key={o.skuId}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                  {o.skuCode} · {num(o.onHand)} {o.unit} in store
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(p) => <TextField {...p} label="Add an item" placeholder="Type a code or item name…" size="small" />}
        />

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(820)}>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Item</TableCell>
                <TableCell align="right">In store now</TableCell>
                <TableCell align="right">Quantity received</TableCell>
                <TableCell align="right"><Th label="Cost per unit" hint="Optional. Used to value the stock and to price future purchases." /></TableCell>
                <TableCell align="right"><Th label="New balance" hint="What on-hand becomes once you save this receipt." /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyNote icon={PackagePlus} title="No items added yet"
                    hint="Use the search box above to pick the first item on the bill." />
                </TableCell></TableRow>
              )}
              {lines.map((l) => {
                const qty = Number(l.quantity || 0);
                const newBal = Number(l.onHand || 0) + qty;
                return (
                  <TableRow key={l.skuId} hover>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: O2D.brand, whiteSpace: 'nowrap' }}>{l.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 230 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={l.skuName}>{l.skuName}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>{num(l.onHand)} {l.unit}</TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.quantity} autoFocus={lines[lines.length - 1].skuId === l.skuId}
                        onChange={(e) => setField(l.skuId, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 84, fontWeight: 700 } }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.unitCost}
                        onChange={(e) => setField(l.skuId, 'unitCost', e.target.value)}
                        InputProps={{ startAdornment: <Typography sx={{ fontSize: '0.75rem', color: O2D.faint, mr: 0.4 }}>₹</Typography> }}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 74 } }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {qty > 0 ? (
                        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                          <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>{num(l.onHand)}</Typography>
                          <ArrowRight size={12} color={O2D.faint} />
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>{num(newBal)}</Typography>
                        </Stack>
                      ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 48 }}>
                      <Tooltip arrow slotProps={O2D_TIP} title="Remove this line">
                        <IconButton size="small" onClick={() => remove(l.skuId)} sx={{ color: O2D.faint, '&:hover': { color: STOCK_TOKENS.OUT_OF_STOCK.color } }}>
                          <Trash2 size={15} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>

      {/* ── Step 3 — confirm. Totals sit next to the button so the client sees
          exactly what they are committing before they click. ── */}
      <Paper elevation={0} sx={{
        position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
        border: `1px solid ${valid ? STOCK_TOKENS.OK.border : O2D.line}`,
        bgcolor: valid ? STOCK_TOKENS.OK.tint : O2D.surface,
        boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StepHead n={3} title="Confirm and save" hint={valid ? 'Everything looks right.' : 'Add at least one item with a quantity above zero.'} done={valid} />
          <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={`${lines.length} item${lines.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units in`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: STOCK_TOKENS.OK.bg, border: `1px solid ${STOCK_TOKENS.OK.border}`, color: STOCK_TOKENS.OK.color }} />
            {totalValue > 0 && (
              <Chip size="small" label={`Worth ${inr(totalValue)}`}
                sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            )}
            <Button variant="contained" disableElevation disabled={!valid || isLoading} onClick={submit}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Add to store
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </ImsShell>
  );
};

export default ImsStockIn;
