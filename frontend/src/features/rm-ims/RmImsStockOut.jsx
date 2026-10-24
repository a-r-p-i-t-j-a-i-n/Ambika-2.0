import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, Autocomplete, IconButton, FormControlLabel, Switch,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import { PackageMinus, Plus, Trash2, Save, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, EmptyNote, Th, KindChip, uomOf, newRequestId,
  STOCK_OUT_REASON_OPTIONS, RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx, IMS_FORM_MAX,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useRmIssueMutation } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const blankLine = () => ({ sku: null, quantity: '', quantityKg: '', remarks: '' });
// Counted in kilograms (a coil): its quantity is already a weight.
const countsInKg = (sku) => !!sku && /^KGS?$/i.test(String(uomOf(sku)).trim());

/**
 * The line's weight in kg — optional, typed on its own. For an item counted in
 * kg the quantity is a weight too, so when the two differ it says what the
 * quantity is: a typo shows up, a deliberate difference is still allowed.
 */
const WeightField = ({ line, onChange }) => {
  const kg = line.quantityKg;
  const differs = countsInKg(line.sku) && kg !== '' && line.quantity !== ''
    && Math.abs(Number(kg) - Number(line.quantity)) > 0.001;
  return (
    <Stack spacing={0.25} alignItems="flex-end">
      <TextField size="small" type="number" value={kg} onChange={(e) => onChange(e.target.value)}
        inputProps={{ min: 0, style: { textAlign: 'right', width: 72 }, 'aria-label': `Weight in kg — ${line.sku?.skuName || 'item'}` }}
        placeholder="Optional" />
      {differs && (
        <Typography sx={{ fontSize: '0.6rem', color: STOCK_TOKENS.LOW.color, whiteSpace: 'nowrap' }}>
          Quantity says {num(line.quantity)} kg
        </Typography>
      )}
    </Stack>
  );
};

/**
 * STOCK OUT — raw material leaving the store.
 *
 * One form, read top to bottom in the order it happens: WHAT goes out (each
 * coil or circle and its quantity), then WHO received it and when (date, the
 * person — required, it is who answers for it — department, reason,
 * location), then Save. No numbered steps, and only what the floor needs;
 * "Purpose" and "Reference" are not asked any more.
 *
 * No "issue" anywhere a person reads it — on the floor it reads as "a
 * problem". The API keeps its names (`rmIssue`, `issuedTo`, PRODUCTION_ISSUE),
 * so nothing stored changes meaning.
 */
const RmImsStockOut = () => {
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [stockOut, { isLoading }] = useRmIssueMutation();

  const [header, setHeader] = useState({
    date: dayjs().format('YYYY-MM-DD'),
    reason: 'PRODUCTION_ISSUE',
    customReason: '',
    warehouse: DEFAULT_RECEIVED_AT,
    receivedBy: '', department: '', allowNegative: false,
  });
  const [lines, setLines] = useState([blankLine()]);
  // Replay protection for this submission — see the note on Stock In.
  const [requestId, setRequestId] = useState(newRequestId);

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

  // "Other" has to say what it was, or History can never explain this movement.
  const needsCustomReason = header.reason === 'OTHER' && !header.customReason.trim();
  // Who received it is the one thing the store must always be able to answer.
  const needsReceiver = !header.receivedBy.trim();
  const ready = valid.length > 0 && !blocked && !needsReceiver && !needsCustomReason;
  const status = !valid.length ? 'Pick an item and enter a quantity above zero.'
    : blocked ? 'Fix the lines that ask for more than the store holds.'
      : needsReceiver ? 'Enter who received it.'
        : needsCustomReason ? 'Say what the reason is.'
          : 'Everything looks right.';

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    if (needsReceiver) return enqueueSnackbar('Enter who received it.', { variant: 'warning' });
    if (needsCustomReason) return enqueueSnackbar('Say what the reason is when Reason is Other.', { variant: 'warning' });
    try {
      const res = await stockOut({
        date: header.date, reason: header.reason,
        clientRequestId: requestId,
        customReason: header.reason === 'OTHER' ? header.customReason.trim() : undefined,
        warehouse: header.warehouse,
        issuedTo: header.receivedBy.trim(),
        department: header.department || undefined,
        allowNegative: header.allowNegative,
        items: valid.map((l) => ({
          skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity), remarks: l.remarks || undefined,
          // The weight, when it was weighed — for circles, so the kg balance comes
          // down with the pieces. Undefined, not 0, when nothing was entered.
          quantityKg: l.quantityKg === '' ? undefined : Number(l.quantityKg),
        })),
      }).unwrap();
      if (res?.data?.duplicate) {
        enqueueSnackbar('Already recorded — this stock out was submitted twice, so stock was not changed again.', { variant: 'info' });
      } else {
        enqueueSnackbar(`Stock out saved — ${res?.data?.count || valid.length} item(s), stock updated.`, { variant: 'success' });
      }
      setLines([blankLine()]);
      setHeader((h) => ({ ...h, customReason: '' }));
      setRequestId(newRequestId());
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the stock out.', { variant: 'error' }); }
    return undefined;
  };

  return (
    <RmShell
      icon={PackageMinus}
      title="Stock Out — raw material to production"
      subtitle="Record what left the store and who received it. On-hand comes down and the entry is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            For material going out to production or being used up. <b>Cutting a coil into circles?</b> Use
            Coil to Circle instead — it takes the coil out, puts the circles in and records the scrap in one entry.
          </Typography>
        </Stack>
      </Paper>

      {/* ── One form: the items, then who received them, then Save ── */}
      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1060)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Item" hint={H.skuName} /></TableCell>
                <TableCell align="right"><Th label="UOM" hint={H.unit} /></TableCell>
                <TableCell align="right">In store now</TableCell>
                <TableCell align="right">Quantity out</TableCell>
                <TableCell align="right"><Th label="Weight (kg)" hint={H.weightKg} /></TableCell>
                <TableCell align="right"><Th label="Left after this" hint={H.newBalance} /></TableCell>
                <TableCell><Th label="Notes" hint={H.movementNotes} /></TableCell>
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
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
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
                    <TableCell align="right" sx={{ fontSize: '0.7rem', fontWeight: 700, color: O2D.sub, whiteSpace: 'nowrap' }}>
                      {l.sku ? uomOf(l.sku) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>
                      {l.sku ? num(onHand) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.quantity} error={over && !header.allowNegative}
                        onChange={(e) => setLine(i, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 82, fontWeight: 700 },
                          'aria-label': `Quantity out — ${l.sku?.skuName || 'item'}` }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>
                      {/* Weight, optional and entered on its own for every item — never
                          copied from the quantity. For an item counted in kg the two
                          should agree, so a different figure is pointed out (not blocked). */}
                      {!l.sku ? (
                        <Tooltip arrow slotProps={O2D_TIP} title="Pick an item first.">
                          <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
                        </Tooltip>
                      ) : (
                        <WeightField line={l} onChange={(v) => setLine(i, 'quantityKg', v)} />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {l.sku && qty > 0 ? (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={over
                            ? `Only ${num(onHand)} are in the store. Taking out ${num(qty)} would leave the balance negative.`
                            : belowReorder
                              ? `This drops the item to or below its reorder point of ${num(rp)} — it will appear on the buying list.`
                              : 'Balance stays healthy after this.'}>
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
                <TableRow><TableCell colSpan={9} sx={{ border: 0 }}>
                  <EmptyNote icon={PackageMinus} title="No items added yet" hint="Add a line to start." />
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableScroll>

        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Button size="small" startIcon={<Plus size={14} />} onClick={addLine}
            sx={{ mt: 1, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', color: O2D.brand }}>
            Add another item
          </Button>

          {blocked && (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={17} /></Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  {overLines.length} line{overLines.length > 1 ? 's ask' : ' asks'} for more than the store holds
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                  Either correct the quantity, or turn on "Allow taking out more than we hold" to record a negative
                  balance — which usually means the physical count and the system have drifted apart.
                </Typography>
              </Box>
            </Stack>
          )}
          {!blocked && willTrigger.length > 0 && (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.REORDER.border}`, bgcolor: STOCK_TOKENS.REORDER.tint,
            }}>
              <Box sx={{ color: STOCK_TOKENS.REORDER.color, display: 'flex' }}><AlertTriangle size={17} /></Box>
              <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.REORDER.color, fontWeight: 700 }}>
                After this, {willTrigger.length} item{willTrigger.length > 1 ? 's' : ''} will land on the buying list.
              </Typography>
            </Stack>
          )}

          {/* Who received it, and when. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.25, mt: 1.75 }}>
            <TextField size="small" type="date" label="Date" value={header.date}
              onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
              InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
            <TextField size="small" label="Received by" required value={header.receivedBy}
              onChange={(e) => setHeader((h) => ({ ...h, receivedBy: e.target.value }))}
              placeholder="Who it was handed to" inputProps={{ maxLength: 120, 'data-testid': 'stock-out-received-by' }} />
            <TextField size="small" label="Department" value={header.department}
              onChange={(e) => setHeader((h) => ({ ...h, department: e.target.value }))} placeholder="e.g. Pressing" />
            {/* Why it went out. Every option IS consumption, so the movement stays
                a CONSUME_OUT and what Average Daily Consumption measures is unchanged. */}
            <TextField select size="small" label="Reason" value={header.reason}
              onChange={(e) => setHeader((h) => ({ ...h, reason: e.target.value }))}>
              {STOCK_OUT_REASON_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
            {/* Where it went out from. */}
            <TextField select size="small" label="Location" value={header.warehouse}
              onChange={(e) => setHeader((h) => ({ ...h, warehouse: e.target.value }))}>
              {RECEIVED_AT_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
            </TextField>
            {header.reason === 'OTHER' && (
              <TextField size="small" label="Custom reason" required value={header.customReason}
                onChange={(e) => setHeader((h) => ({ ...h, customReason: e.target.value }))}
                placeholder="Say what it was for" error={needsCustomReason}
                inputProps={{ maxLength: 200 }}
                sx={{ gridColumn: { md: 'span 2' } }} />
            )}
          </Box>

          {/* Save — the last line of the same form. */}
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap
            sx={{ mt: 1.75, pt: 1.25, borderTop: `1px solid ${O2D.lineSoft}` }}>
            <FormControlLabel sx={{ mr: 0 }}
              control={<Switch size="small" checked={header.allowNegative}
                onChange={(e) => setHeader((h) => ({ ...h, allowNegative: e.target.checked }))} />}
              label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow taking out more than we hold</Typography>}
            />
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ready ? STOCK_TOKENS.OK.color : O2D.sub, mr: 'auto' }}>{status}</Typography>
            <Chip size="small" label={`${valid.length} item${valid.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units out`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: '#ffedd5', border: '1px solid #fed7aa', color: '#c2410c' }} />
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Save stock out
            </Button>
          </Stack>
        </Box>
      </Panel>
    </RmShell>
  );
};

export default RmImsStockOut;
