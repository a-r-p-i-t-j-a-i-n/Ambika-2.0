import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, Autocomplete, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import { PackagePlus, Plus, Trash2, Save, ArrowRight, Info } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, EmptyNote, Th, KindChip, uomOf, newRequestId,
  STOCK_IN_REASON_OPTIONS, RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT,
  O2D, O2D_TIP, STOCK_TOKENS, num, inr, imsTableSx, IMS_FORM_MAX,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useRmReceiveMutation, useGetRmReceivedCoilsQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const blankLine = () => ({ sku: null, quantity: '', quantityKg: '', unitCost: '', batchNo: '' });
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
 * Batch number, with the receipt behind it looked up as you type.
 *
 * Why a component per row rather than one lookup on the form: Stock In has a
 * batch PER LINE, and a hook cannot be called in a loop. Each row therefore
 * owns its own debounce and its own query — the same pattern the Cut Coils
 * screen uses for its single batch, applied per line.
 *
 * It stays a plain text box. Batch numbers are typed off a label, a brand new
 * coil has no record to pick from, and Stock In must keep working for exactly
 * that case — so this NEVER blocks on a match. A hit fills what it safely can;
 * a miss just says so and gets out of the way.
 */
const BatchField = ({ value, onChange, onResolve, sku }) => {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(t);
  }, [value]);

  // A batch number is an identifier, not a phrase — below a few characters it
  // would match half the floor, so it is not worth asking the server.
  const term = debounced.length >= 4 ? debounced : '';
  const { data: res, isFetching } = useGetRmReceivedCoilsQuery({ q: term, limit: 5 }, { skip: !term });

  // Only an EXACT batch match counts. A near miss must never quietly fill the
  // line with a different coil's item and rate.
  const found = useMemo(
    () => (res?.data || []).find((r) => r.batchNo?.toLowerCase() === term.toLowerCase()) || null,
    [res, term],
  );

  // The found receipt is for a different item than the one already chosen on
  // this line. Report it; never silently re-point the line at another SKU.
  const mismatch = !!(found && sku && String(found.skuId) !== String(sku.skuId));

  const applied = useRef(null);
  useEffect(() => {
    if (!found) { applied.current = null; onResolve?.(null, false); return; }
    if (applied.current === found.id) return;
    applied.current = found.id;
    onResolve?.(found, mismatch);
  }, [found, mismatch]);

  const hint = isFetching ? 'Looking this batch up…'
    : mismatch ? `Batch ${found.batchNo} belongs to ${found.skuCode}, not the item on this line — nothing was filled in.`
      : found ? `${found.skuName} · received ${num(found.receivedWeight)} on ${found.grnNumber || 'a receipt'}${found.supplier ? ` from ${found.supplier}` : ''} · ${num(found.availableWeight)} left. Already in stock — only add it again if this is a separate physical receipt.`
        : (term && !isFetching) ? 'No received batch with this number — enter the details yourself.'
          : 'Optional. Identifies the physical coil.';

  const tone = mismatch ? STOCK_TOKENS.OUT_OF_STOCK.color
    : found ? STOCK_TOKENS.LOW.color
      : (term && !isFetching) ? O2D.sub : O2D.faint;

  return (
    <Stack spacing={0.3}>
      <TextField size="small" value={value} onChange={(e) => onChange(e.target.value)} fullWidth placeholder="Optional"
        inputProps={{ 'aria-label': 'Batch number' }} />
      <Typography sx={{ fontSize: '0.62rem', color: tone, lineHeight: 1.25 }}>{hint}</Typography>
    </Stack>
  );
};

const RmImsStockIn = () => {
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [receive, { isLoading }] = useRmReceiveMutation();

  const [header, setHeader] = useState({
    date: dayjs().format('YYYY-MM-DD'),
    // No default: 'Opening stock' and 'Correction / adjustment' mean different
    // things in History, so the operator picks one. A supplier delivery is not
    // one of them — it comes in through its GRN's Incoming QC.
    reason: '',
    customReason: '',
    warehouse: DEFAULT_RECEIVED_AT,
  });
  const [lines, setLines] = useState([blankLine()]);
  // Minted once per filled-in form. The server recognises a replay of the same
  // id — a double-click, a retry, a second tab — and does not add stock twice.
  // A new id is taken only after a successful save, so a corrected retry of a
  // FAILED submission is still accepted.
  const [requestId, setRequestId] = useState(newRequestId);

  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  // Has the operator chosen a Received At themselves? Once they have, a batch
  // lookup must not move it back - the header is theirs from that point on.
  const [warehouseTouched, setWarehouseTouched] = useState(false);

  /**
   * What a recognised batch is allowed to fill in.
   *
   *   AUTO-FILLED  item (only when the line has none) and cost per unit (only
   *                while it is empty or still holds what this filled in last).
   *   USER-ENTERED quantity, always. It is what is being received NOW, and the
   *                receipt only knows what arrived BEFORE - prefilling it is
   *                how the same material gets booked in twice.
   *   READ-ONLY    supplier, GRN, PO, dates. Shown in the hint under the field
   *                as context; this form has nowhere to put them and inventing
   *                fields for them is not what was asked for.
   *
   * Nothing is overwritten blindly: a value the operator typed always wins, and
   * a batch belonging to another item fills nothing at all.
   */
  const applyReceipt = (i, found, mismatch) => {
    if (!found || mismatch) return;
    setLines((p) => p.map((l, j) => {
      if (j !== i) return l;
      const cost = String(found.unitCost ?? '');
      return {
        ...l,
        // Only when the line has no item yet. An item already chosen is a
        // deliberate choice and is never re-pointed by a lookup.
        sku: l.sku || items.find((s) => String(s.skuId) === String(found.skuId)) || null,
        unitCost: (l.unitCost === '' || l.unitCost === l._autoCost) ? cost : l.unitCost,
        _autoCost: cost,
      };
    }));
    // Received At comes off the receipt, which is where the client's sheet
    // takes it from - but only while the operator has not set it themselves.
    if (!warehouseTouched && found.warehouse && RECEIVED_AT_OPTIONS.some((o) => o.value === found.warehouse)) {
      setHeader((h) => (h.warehouse === found.warehouse ? h : { ...h, warehouse: found.warehouse }));
    }
  };
  const addLine = () => setLines((p) => [...p, blankLine()]);
  const delLine = (i) => setLines((p) => (p.length === 1 ? [blankLine()] : p.filter((_, j) => j !== i)));

  const valid = lines.filter((l) => l.sku && Number(l.quantity) > 0);
  const totalQty = valid.reduce((t, l) => t + Number(l.quantity || 0), 0);
  const totalValue = valid.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitCost || l.sku?.rate || 0), 0);
  // "Other" has to say what it was, or History can never explain this movement.
  const needsCustomReason = header.reason === 'OTHER' && !header.customReason.trim();
  const needsReason = !header.reason;
  const ready = valid.length > 0 && !needsReason && !needsCustomReason;
  // What is still missing, said on the Save line.
  const status = !valid.length ? 'Pick an item and enter a quantity above zero.'
    : needsReason ? 'Pick a reason — a supplier delivery comes in through its GRN, not here.'
      : needsCustomReason ? 'Say what the reason is.'
        : 'Everything looks right.';

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    if (needsReason) return enqueueSnackbar('Pick a Reason. Material received from a supplier is not added here — raise a GRN and its Incoming QC adds the accepted quantity.', { variant: 'warning' });
    if (needsCustomReason) return enqueueSnackbar('Custom Reason is required when Reason is Other.', { variant: 'warning' });
    try {
      const res = await receive({
        date: header.date, reason: header.reason,
        clientRequestId: requestId,
        customReason: header.reason === 'OTHER' ? header.customReason.trim() : undefined,
        warehouse: header.warehouse,
        items: valid.map((l) => ({
          skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity),
          // Only sent when a weight was entered. Undefined — not 0 — so the
          // ledger records "not stated" rather than "weighed nothing".
          quantityKg: l.quantityKg === '' ? undefined : Number(l.quantityKg),
          unitCost: Number(l.unitCost || 0), batchNo: l.batchNo || undefined,
        })),
      }).unwrap();
      if (res?.data?.duplicate) {
        enqueueSnackbar('Already recorded — this receipt was submitted twice, so stock was not added again.', { variant: 'info' });
      } else {
        enqueueSnackbar(`Stock added for ${res?.data?.count || valid.length} item(s).`, { variant: 'success' });
      }
      setLines([blankLine()]);
      setHeader((h) => ({ ...h, customReason: '' }));
      setRequestId(newRequestId());
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
    return undefined;
  };

  return (
    <RmShell
      icon={PackagePlus}
      title="Stock In — bring raw material into the store"
      subtitle="Record what arrived. On-hand goes up and the movement is logged against your name."
      maxWidth={IMS_FORM_MAX}
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

      {/* ── One form: the items, then when / why / where, then Save ── */}
      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1140)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Item" hint={H.skuName} /></TableCell>
                <TableCell align="right"><Th label="UOM" hint={H.unit} /></TableCell>
                <TableCell align="right">In store now</TableCell>
                <TableCell align="right">Quantity in</TableCell>
                {/* Circles are counted in pieces but also weighed. Recording the
                    weight beside the count keeps both, and keeps them apart. */}
                <TableCell align="right"><Th label="Weight (kg)" hint={H.weightKg} /></TableCell>
                <TableCell align="right"><Th label="Cost per unit" hint={H.costPerUnit} /></TableCell>
                <TableCell><Th label="Batch" hint={H.batchNo} /></TableCell>
                <TableCell align="right"><Th label="New balance" hint={H.newBalance} /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => {
                const qty = Number(l.quantity || 0);
                const newBal = Number(l.sku?.onHand || 0) + qty;
                return (
                  <TableRow key={i} hover>
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
                      {l.sku ? num(l.sku.onHand) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 82, fontWeight: 700 },
                          'aria-label': `Quantity in — ${l.sku?.skuName || 'item'}` }} placeholder="0" />
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
                    <TableCell align="right" sx={{ width: 130 }}>
                      <TextField size="small" type="number" value={l.unitCost} onChange={(e) => setLine(i, 'unitCost', e.target.value)}
                        InputProps={{ startAdornment: <Typography sx={{ fontSize: '0.75rem', color: O2D.faint, mr: 0.4 }}>₹</Typography> }}
                        inputProps={{ min: 0, style: { textAlign: 'right', width: 70 } }}
                        placeholder={l.sku?.rate ? String(l.sku.rate) : '0'} />
                    </TableCell>
                    <TableCell sx={{ width: 230, minWidth: 230 }}>
                      <BatchField
                        value={l.batchNo}
                        sku={l.sku}
                        onChange={(v) => setLine(i, 'batchNo', v)}
                        onResolve={(found, mismatch) => applyReceipt(i, found, mismatch)}
                      />
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
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={PackagePlus} title="No items added yet" hint="Add a line to start." />
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

          {/* When it arrived, why it is added, and where it landed. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.25, mt: 1.75 }}>
            <TextField size="small" type="date" label="Date received" value={header.date}
              onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
              InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
            <TextField select size="small" label="Reason" required value={header.reason}
              onChange={(e) => setHeader((h) => ({ ...h, reason: e.target.value }))}
              SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="" disabled><Box component="span" sx={{ color: O2D.faint }}>Pick a reason</Box></MenuItem>
              {STOCK_IN_REASON_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
            {/* Where the material physically landed. Maps to the stock engine's
                existing warehouse field — the sheet's own PLG01 / JW001 codes. */}
            <TextField select size="small" label="Received At" value={header.warehouse}
              onChange={(e) => { setWarehouseTouched(true); setHeader((h) => ({ ...h, warehouse: e.target.value })); }}>
              {RECEIVED_AT_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
            </TextField>
            {header.reason === 'OTHER' && (
              <TextField size="small" label="Custom reason" required value={header.customReason}
                onChange={(e) => setHeader((h) => ({ ...h, customReason: e.target.value }))}
                placeholder="Say what this receipt was" error={needsCustomReason}
                inputProps={{ maxLength: 200 }} />
            )}
          </Box>

          {/* Save — the last line of the same form. */}
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap
            sx={{ mt: 1.75, pt: 1.25, borderTop: `1px solid ${O2D.lineSoft}` }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ready ? STOCK_TOKENS.OK.color : O2D.sub, mr: 'auto' }}>{status}</Typography>
            <Chip size="small" label={`${valid.length} item${valid.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units in`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: STOCK_TOKENS.OK.bg, border: `1px solid ${STOCK_TOKENS.OK.border}`, color: STOCK_TOKENS.OK.color }} />
            {totalValue > 0 && (
              <Chip size="small" label={`Worth ${inr(totalValue)}`}
                sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            )}
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Add to store
            </Button>
          </Stack>
        </Box>
      </Panel>
    </RmShell>
  );
};

export default RmImsStockIn;
