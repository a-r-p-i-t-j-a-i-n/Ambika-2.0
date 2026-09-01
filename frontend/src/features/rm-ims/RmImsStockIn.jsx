import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, Autocomplete, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import { PackagePlus, Plus, Trash2, Save, ArrowRight, Info } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, EmptyNote, Th, StepHead, KindChip,
  O2D, O2D_TIP, STOCK_TOKENS, num, inr, imsTableSx,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useRmReceiveMutation } from '../../store/api/rmImsApi';

const REASONS = [
  { value: 'VENDOR', label: 'Vendor receipt', hint: 'Coils or circles physically received from a supplier against a bill or challan.' },
  { value: 'OPENING', label: 'Opening stock', hint: 'The material that already existed when you started using IMS.' },
  { value: 'CORRECTION', label: 'Correction / adjustment', hint: 'Fixing a counting mistake so the system matches the physical store.' },
];

const blankLine = () => ({ sku: null, quantity: '', unitCost: '', batchNo: '' });

const RmImsStockIn = () => {
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [receive, { isLoading }] = useRmReceiveMutation();

  const [header, setHeader] = useState({ date: dayjs().format('YYYY-MM-DD'), reason: 'VENDOR', reference: '' });
  const [lines, setLines] = useState([blankLine()]);

  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, blankLine()]);
  const delLine = (i) => setLines((p) => (p.length === 1 ? [blankLine()] : p.filter((_, j) => j !== i)));

  const valid = lines.filter((l) => l.sku && Number(l.quantity) > 0);
  const totalQty = valid.reduce((t, l) => t + Number(l.quantity || 0), 0);
  const totalValue = valid.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitCost || l.sku?.rate || 0), 0);
  const activeReason = REASONS.find((r) => r.value === header.reason);

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    try {
      const res = await receive({
        date: header.date, reason: header.reason, reference: header.reference || undefined,
        items: valid.map((l) => ({
          skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity),
          unitCost: Number(l.unitCost || 0), batchNo: l.batchNo || undefined,
        })),
      }).unwrap();
      enqueueSnackbar(`Stock added for ${res?.data?.count || valid.length} item(s).`, { variant: 'success' });
      setLines([blankLine()]);
      setHeader((h) => ({ ...h, reference: '' }));
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
  };

  return (
    <RmShell
      icon={PackagePlus}
      title="Stock In — bring raw material into the store"
      subtitle="Record what arrived. On-hand goes up and the movement is logged against your name."
      maxWidth={1180}
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            Use this only for material you are adding <b>by hand</b> — opening balances, corrections, or a receipt with no
            purchase order. Vendor GRNs raised in Purchase FMS already post into RM IMS automatically, so entering them
            here would double-count the stock.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 ── */}
      <Panel>
        <StepHead n={1} title="Receipt details" hint="When it arrived and why it is being added." done={!!header.date} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField size="small" type="date" label="Date received" value={header.date}
            onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          <TextField select size="small" label="Reason" value={header.reason}
            onChange={(e) => setHeader((h) => ({ ...h, reason: e.target.value }))}
            helperText={activeReason?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}>
            {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Reference (optional)" value={header.reference}
            onChange={(e) => setHeader((h) => ({ ...h, reference: e.target.value }))}
            placeholder="Challan / bill / note no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 ── */}
      <Panel>
        <StepHead n={2} title="What is coming in?" hint="Pick each coil or circle, then type the quantity received." done={valid.length > 0} />
        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(940)}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">In store now</TableCell>
                <TableCell align="right">Quantity received</TableCell>
                <TableCell align="right"><Th label="Cost per unit" hint="Optional — leave blank to use the rate saved on the item's policy." /></TableCell>
                <TableCell><Th label="Batch" hint="The mill or supplier batch number, so a quality issue can be traced back." /></TableCell>
                <TableCell align="right"><Th label="New balance" hint="What on-hand becomes once you save this receipt." /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => {
                const qty = Number(l.quantity || 0);
                const newBal = Number(l.sku?.onHand || 0) + qty;
                return (
                  <TableRow key={i} hover>
                    <TableCell sx={{ minWidth: 290 }}>
                      <Autocomplete
                        size="small" options={items} value={l.sku} onChange={(_, v) => setLine(i, 'sku', v)}
                        getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                        renderOption={(props, o) => (
                          <li {...props} key={o.skuId}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Stack direction="row" spacing={0.75} alignItems="center">
                                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                                <KindChip kind={o.kind} withHint={false} />
                              </Stack>
                              <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                                {o.skuCode} · {num(o.onHand)} in store
                              </Typography>
                            </Box>
                          </li>
                        )}
                        renderInput={(p) => <TextField {...p} placeholder="Search a coil or circle…" />}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>
                      {l.sku ? num(l.sku.onHand) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 82, fontWeight: 700 } }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.unitCost} onChange={(e) => setLine(i, 'unitCost', e.target.value)}
                        InputProps={{ startAdornment: <Typography sx={{ fontSize: '0.75rem', color: O2D.faint, mr: 0.4 }}>₹</Typography> }}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 70 } }}
                        placeholder={l.sku?.rate ? String(l.sku.rate) : '0'} />
                    </TableCell>
                    <TableCell sx={{ width: 140 }}>
                      <TextField size="small" value={l.batchNo} onChange={(e) => setLine(i, 'batchNo', e.target.value)} fullWidth placeholder="Optional" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {l.sku && qty > 0 ? (
                        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                          <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>{num(l.sku.onHand)}</Typography>
                          <ArrowRight size={12} color={O2D.faint} />
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>{num(newBal)}</Typography>
                        </Stack>
                      ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 48 }}>
                      <Tooltip arrow slotProps={O2D_TIP} title="Clear this line">
                        <IconButton size="small" onClick={() => delLine(i)} sx={{ color: O2D.faint, '&:hover': { color: STOCK_TOKENS.OUT_OF_STOCK.color } }}>
                          <Trash2 size={15} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyNote icon={PackagePlus} title="No items added yet" hint="Add a line to start this receipt." />
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableScroll>
        <Button size="small" startIcon={<Plus size={14} />} onClick={addLine}
          sx={{ mt: 1.25, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', color: O2D.brand }}>
          Add another item
        </Button>
      </Panel>

      {/* ── Step 3 ── */}
      <Paper elevation={0} sx={{
        position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
        border: `1px solid ${valid.length ? STOCK_TOKENS.OK.border : O2D.line}`,
        bgcolor: valid.length ? STOCK_TOKENS.OK.tint : O2D.surface,
        boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StepHead n={3} title="Confirm and save"
            hint={valid.length ? 'Everything looks right.' : 'Pick an item and enter a quantity above zero.'}
            done={valid.length > 0} />
          <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={`${valid.length} item${valid.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units in`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: STOCK_TOKENS.OK.bg, border: `1px solid ${STOCK_TOKENS.OK.border}`, color: STOCK_TOKENS.OK.color }} />
            {totalValue > 0 && (
              <Chip size="small" label={`Worth ${inr(totalValue)}`}
                sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            )}
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !valid.length}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Add to store
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </RmShell>
  );
};

export default RmImsStockIn;
