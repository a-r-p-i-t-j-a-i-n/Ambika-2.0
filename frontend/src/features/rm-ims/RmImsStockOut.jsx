import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, FormControlLabel, Switch,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import { PackageMinus, Plus, Trash2, Save, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, EmptyNote, Th, StepHead, KindChip,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useRmIssueMutation } from '../../store/api/rmImsApi';

const blankLine = () => ({ sku: null, quantity: '', remarks: '' });

const RmImsStockOut = () => {
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [issue, { isLoading }] = useRmIssueMutation();

  const [header, setHeader] = useState({
    date: dayjs().format('YYYY-MM-DD'), purpose: '', issuedTo: '', department: '', reference: '', allowNegative: false,
  });
  const [lines, setLines] = useState([blankLine()]);

  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, blankLine()]);
  const delLine = (i) => setLines((p) => (p.length === 1 ? [blankLine()] : p.filter((_, j) => j !== i)));

  const valid = lines.filter((l) => l.sku && Number(l.quantity) > 0);
  const overLines = valid.filter((l) => Number(l.quantity) > Number(l.sku.onHand || 0));
  const blocked = overLines.length > 0 && !header.allowNegative;
  const totalQty = valid.reduce((t, l) => t + Number(l.quantity || 0), 0);
  // Lines that will fall through their reorder point once saved.
  const willTrigger = valid.filter((l) => {
    const rp = Number(l.sku.reorderPoint || 0);
    const after = Number(l.sku.onHand || 0) - Number(l.quantity || 0);
    return rp > 0 && after <= rp && Number(l.sku.onHand || 0) > rp;
  });

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    try {
      const res = await issue({
        date: header.date, purpose: header.purpose || undefined, issuedTo: header.issuedTo || undefined,
        department: header.department || undefined, reference: header.reference || undefined,
        allowNegative: header.allowNegative,
        items: valid.map((l) => ({ skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity), remarks: l.remarks || undefined })),
      }).unwrap();
      enqueueSnackbar(`Issued ${res?.data?.count || valid.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([blankLine()]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not issue stock.', { variant: 'error' }); }
  };

  return (
    <RmShell
      icon={PackageMinus}
      title="Stock Out — issue raw material to production"
      subtitle="Record what left the store. On-hand comes down and the issue is logged against your name."
      maxWidth={1180}
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            Use this for material going out to production or being written off. If you are <b>cutting a coil into
            circles</b>, use the Cut coils screen instead — it takes the coil out and puts the circles in as one entry,
            and records the scrap.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 ── */}
      <Panel>
        <StepHead n={1} title="Issue details" hint="When it went out, where it went, and who took it." done={!!header.date} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField size="small" type="date" label="Date issued" value={header.date}
            onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          <TextField size="small" label="Purpose" value={header.purpose}
            onChange={(e) => setHeader((h) => ({ ...h, purpose: e.target.value }))}
            placeholder="e.g. Press shop"
            helperText="What the material is being used for."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
          <TextField size="small" label="Department" value={header.department}
            onChange={(e) => setHeader((h) => ({ ...h, department: e.target.value }))} placeholder="e.g. Pressing" />
          <TextField size="small" label="Issued to (person)" value={header.issuedTo}
            onChange={(e) => setHeader((h) => ({ ...h, issuedTo: e.target.value }))} placeholder="Who collected it" />
          <TextField size="small" label="Reference (optional)" value={header.reference}
            onChange={(e) => setHeader((h) => ({ ...h, reference: e.target.value }))}
            placeholder="Slip / job no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 ── */}
      <Panel>
        <StepHead n={2} title="What is going out?" hint="Pick each coil or circle, then type the quantity issued." done={valid.length > 0} />
        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(880)}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">In store now</TableCell>
                <TableCell align="right">Quantity issued</TableCell>
                <TableCell align="right"><Th label="Left after this" hint="What on-hand becomes once you save this issue." /></TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => {
                const qty = Number(l.quantity || 0);
                const onHand = Number(l.sku?.onHand || 0);
                const over = !!l.sku && qty > onHand;
                const after = onHand - qty;
                const rp = Number(l.sku?.reorderPoint || 0);
                const belowReorder = !over && rp > 0 && after <= rp;
                const tone = over ? STOCK_TOKENS.OUT_OF_STOCK : belowReorder ? STOCK_TOKENS.REORDER : STOCK_TOKENS.OK;
                return (
                  <TableRow key={i} hover sx={over ? { bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint } : null}>
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
                      {l.sku ? num(onHand) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.quantity} error={over && !header.allowNegative}
                        onChange={(e) => setLine(i, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 82, fontWeight: 700 } }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {l.sku && qty > 0 ? (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={over
                            ? `Only ${num(onHand)} are in the store. Issuing ${num(qty)} would leave the balance negative.`
                            : belowReorder
                              ? `This drops the item to or below its reorder point of ${num(rp)} — it will appear on the buying list.`
                              : 'Balance stays healthy after this issue.'}>
                          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ cursor: 'help' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>{num(onHand)}</Typography>
                            <ArrowRight size={12} color={O2D.faint} />
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: tone.color }}>{num(after)}</Typography>
                          </Stack>
                        </Tooltip>
                      ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      <TextField size="small" value={l.remarks} onChange={(e) => setLine(i, 'remarks', e.target.value)} fullWidth placeholder="Optional" />
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
                <TableRow><TableCell colSpan={6} sx={{ border: 0 }}>
                  <EmptyNote icon={PackageMinus} title="No items added yet" hint="Add a line to start this issue." />
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

      {blocked && (
        <Paper elevation={0} sx={{
          borderRadius: '8px', px: 1.5, py: 1.1,
          border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
        }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={17} /></Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                {overLines.length} line{overLines.length > 1 ? 's ask' : ' asks'} for more than the store holds
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                Either correct the quantity, or tick the switch below to record a negative balance — which usually means
                the physical count and the system have drifted apart.
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}
      {!blocked && willTrigger.length > 0 && (
        <Paper elevation={0} sx={{
          borderRadius: '8px', px: 1.5, py: 1.1,
          border: `1px solid ${STOCK_TOKENS.REORDER.border}`, bgcolor: STOCK_TOKENS.REORDER.tint,
        }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{ color: STOCK_TOKENS.REORDER.color, display: 'flex' }}><AlertTriangle size={17} /></Box>
            <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.REORDER.color, fontWeight: 700 }}>
              After this issue, {willTrigger.length} item{willTrigger.length > 1 ? 's' : ''} will land on the buying list.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* ── Step 3 ── */}
      <Paper elevation={0} sx={{
        position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
        border: `1px solid ${valid.length && !blocked ? STOCK_TOKENS.OK.border : O2D.line}`,
        bgcolor: valid.length && !blocked ? STOCK_TOKENS.OK.tint : O2D.surface,
        boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StepHead n={3} title="Confirm and save"
            hint={blocked ? 'Fix the over-issued lines first.' : valid.length ? 'Everything looks right.' : 'Pick an item and enter a quantity above zero.'}
            done={valid.length > 0 && !blocked} />
          <FormControlLabel
            sx={{ ml: 0.5, mr: 'auto' }}
            control={<Switch size="small" checked={header.allowNegative}
              onChange={(e) => setHeader((h) => ({ ...h, allowNegative: e.target.checked }))} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow issuing more than we hold</Typography>}
          />
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={`${valid.length} item${valid.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units out`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: '#ffedd5', border: '1px solid #fed7aa', color: '#c2410c' }} />
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !valid.length || blocked}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Issue from store
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </RmShell>
  );
};

export default RmImsStockOut;
