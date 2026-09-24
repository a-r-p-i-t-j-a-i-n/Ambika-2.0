import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, FormControlLabel, Switch, CircularProgress, Tooltip,
} from '@mui/material';
import { Truck, Trash2, Save, AlertTriangle, Info, History, ClipboardList } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  FgShell, Panel, TableScroll, EmptyNote, Th, ItemMultiPicker, StepHead, IntroNote,
  QtyField, BalanceDelta, ConfirmBar, SuccessNote, SummaryChip, newRequestId,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx, IMS_FORM_MAX, emptyCellSx, FG_ACCENT, FG_ACCENT_DARK,
} from './fgImsMeta';
import { useGetFgOverviewQuery, useFgDispatchMutation } from '../../store/api/fgImsApi';

// Dispatch Out — record finished goods shipped to a customer. Reduces inventory.
// Standalone entry for now (not yet auto-wired to the Dispatch module).
const FgImsDispatchOut = () => {
  const navigate = useNavigate();
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
  // What the last dispatch actually posted, so the cleared form still says so.
  const [saved, setSaved] = useState(null);
  // Identifies THIS submission. It survives a failed save on purpose, so the
  // corrected retry is the same dispatch, and is replaced once one is accepted.
  const requestId = useRef(newRequestId());

  // Rows land with an EMPTY quantity — picking an item and saying how much of it
  // shipped are two different decisions. `unit` rides along from the SKU master
  // so the row never asks for a UOM.
  const toLine = (it) => ({
    skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit,
    onHand: it.onHand, reorderPoint: it.reorderPoint, quantity: '',
  });
  const addItems = (picked = []) => setLines((p) => {
    const have = new Set(p.map((l) => l.skuId));
    return [...p, ...picked.filter((it) => it && !have.has(it.skuId)).map(toLine)];
  });
  const setQty = (id, q) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, quantity: q } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const totalQty = lines.reduce((t, l) => t + Number(l.quantity || 0), 0);
  const overLines = lines.filter((l) => Number(l.quantity || 0) > Number(l.onHand || 0));
  const anyOver = overLines.length > 0;
  const blocked = anyOver && !allowNegative;
  // Lines that will drop through their Reorder At level — worth flagging before
  // saving, because that is the moment a production run becomes due.
  const willTrigger = lines.filter((l) => {
    const after = Number(l.onHand || 0) - Number(l.quantity || 0);
    return Number(l.quantity || 0) > 0 && Number(l.reorderPoint || 0) > 0
      && after <= Number(l.reorderPoint) && Number(l.onHand || 0) > Number(l.reorderPoint);
  });

  const submit = async () => {
    try {
      const res = await dispatch({
        date, customer, orderNo, vehicleNo, reference, allowNegative,
        clientRequestId: requestId.current,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity) })),
      }).unwrap();
      const count = res?.data?.count || lines.length;
      setSaved({ count, units: totalQty, customer });
      enqueueSnackbar(res?.data?.duplicate
        ? 'Already recorded — this dispatch was submitted twice, so stock was not changed again.'
        : `Dispatched ${count} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setCustomer(''); setOrderNo(''); setVehicleNo(''); setReference('');
      requestId.current = newRequestId();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not record dispatch.', { variant: 'error' }); }
  };

  return (
    <FgShell
      icon={Truck}
      title="Dispatch Out — goods shipped to a customer"
      subtitle="Record what left the store. Stock comes down and the dispatch is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      <IntroNote accent={FG_ACCENT} icon={Info}>
        Every dispatch recorded here reduces finished-goods stock and feeds the <b>Production Plan</b>. The more
        faithfully the customer and order details are filled in, the easier this is to trace back later.
      </IntroNote>

      {/* ── What the last dispatch posted ── */}
      {saved && (
        <SuccessNote
          title="Dispatch confirmed"
          detail={`${num(saved.count)} item${saved.count === 1 ? '' : 's'} · ${num(saved.units)} units dispatched${saved.customer ? ` to ${saved.customer}` : ''}.`}
          onDismiss={() => setSaved(null)}
          actions={(
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" startIcon={<History size={14} />}
                onClick={() => navigate('/fg-ims/movements')}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
                View History
              </Button>
              <Button size="small" variant="outlined" startIcon={<ClipboardList size={14} />}
                onClick={() => navigate('/fg-ims/planning')}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
                View Production Plan
              </Button>
            </Stack>
          )}
        />
      )}

      {/* ── Step 1 — the dispatch header ── */}
      <Panel>
        <StepHead n={1} title="Dispatch details" hint="When it went out, who it went to, and on what vehicle." done={!!date} accent={FG_ACCENT} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField label="Dispatch date" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }} />
          <TextField label="Customer" size="small" value={customer} onChange={(e) => setCustomer(e.target.value)}
            placeholder="Party name"
            helperText="Who the goods were shipped to."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
          <TextField label="Order no." size="small" value={orderNo} onChange={(e) => setOrderNo(e.target.value)}
            placeholder="Customer order no." />
          <TextField label="Vehicle no." size="small" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="e.g. MH 12 AB 1234" />
          <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="Challan / invoice no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 — the lines ── */}
      <Panel>
        <StepHead n={2} title="What is being dispatched?" hint="Tick the finished goods being shipped, add them, then type each quantity."
          done={lines.length > 0} accent={FG_ACCENT} />
        {/* Multi-select: tick several items and add them in one go — the same
            picker the Consumables Stock Out screen uses. */}
        <ItemMultiPicker
          options={items}
          addedIds={lines.map((l) => l.skuId)}
          onAdd={addItems}
          accent={FG_ACCENT}
          label="Add finished goods to dispatch"
          placeholder="Search finished good by code or name..."
          emptyHint="No finished goods match that search."
        />

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(880)}>
            <TableHead>
              <TableRow>
                <TableCell>SKU Code</TableCell>
                <TableCell sx={{ width: '100%' }}>Finished Good</TableCell>
                <TableCell><Th label="UOM" hint="The unit this finished good is counted in. It comes from the SKU master and is never typed here." /></TableCell>
                <TableCell align="right">Available Qty</TableCell>
                <TableCell align="right">Quantity dispatched</TableCell>
                <TableCell align="right"><Th label="Remaining balance" hint="What the stock on hand becomes once you save this dispatch." /></TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={7} sx={emptyCellSx}>
                  <EmptyNote dense icon={Truck} title="No finished goods added yet"
                    hint="Use the search box above to pick the first item being shipped." />
                </TableCell></TableRow>
              )}
              {lines.map((l) => {
                const qty = Number(l.quantity || 0);
                const over = qty > Number(l.onHand || 0);
                const after = Number(l.onHand || 0) - qty;
                const belowReorder = !over && Number(l.reorderPoint || 0) > 0 && after <= Number(l.reorderPoint);
                const tone = over ? STOCK_TOKENS.OUT_OF_STOCK : belowReorder ? STOCK_TOKENS.REORDER : STOCK_TOKENS.OK;
                return (
                  <TableRow key={l.skuId} hover sx={over ? { bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint } : null}>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: FG_ACCENT, whiteSpace: 'nowrap' }}>{l.skuCode}</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={l.skuName}>{l.skuName}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700, color: O2D.sub }}>{l.unit || '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>{num(l.onHand)}</TableCell>
                    <TableCell align="right">
                      <QtyField
                        value={l.quantity} unit={l.unit} accent={FG_ACCENT} error={over && !allowNegative}
                        autoFocus={lines[lines.length - 1].skuId === l.skuId}
                        ariaLabel={`Quantity dispatched — ${l.skuName}`}
                        onChange={(e) => setQty(l.skuId, e.target.value)}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {qty > 0
                        ? <BalanceDelta from={l.onHand} to={after} unit={l.unit} tone={tone}
                            title={over
                              ? `Only ${num(l.onHand)} ${l.unit || 'units'} are in the store. Dispatching ${num(qty)} would leave the balance negative.`
                              : belowReorder
                                ? `This drops the item to or below its Reorder At level of ${num(l.reorderPoint)} — it will appear on the Production Plan.`
                                : 'Balance stays healthy after this dispatch.'} />
                        : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell align="center" sx={{ width: 48 }}>
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

      {/* ── Consequences, spelled out before the user commits ── */}
      {blocked && (
        <Paper elevation={0} sx={{
          borderRadius: '8px', px: 1.5, py: 1.1,
          border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
        }}>
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={17} /></Box>
            <Box sx={{ minWidth: 0, mr: 'auto' }}>
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
              After this dispatch, {willTrigger.length} item{willTrigger.length > 1 ? 's' : ''} will land on the Production Plan.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* ── Step 3 — confirm ── */}
      <ConfirmBar
        n={3} title="Confirm and save" done={valid && !blocked} accent={FG_ACCENT}
        hint={blocked ? 'Fix the over-dispatched lines first.'
          : valid ? 'Everything looks right.' : 'Add at least one finished good with a quantity above zero.'}
        extra={(
          <FormControlLabel
            sx={{ ml: 0.5 }}
            control={<Switch size="small" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow dispatching more than we hold</Typography>}
          />
        )}
      >
        <SummaryChip label={`${num(lines.length)} Finished Good${lines.length === 1 ? '' : 's'}`} />
        <SummaryChip label={`${num(totalQty)} Total Units`} tone={STOCK_TOKENS.REORDER} />
        <Button variant="contained" disableElevation disabled={!valid || isLoading || blocked} onClick={submit}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: FG_ACCENT, '&:hover': { bgcolor: FG_ACCENT_DARK } }}>
          Confirm Dispatch
        </Button>
      </ConfirmBar>
    </FgShell>
  );
};

export default FgImsDispatchOut;
