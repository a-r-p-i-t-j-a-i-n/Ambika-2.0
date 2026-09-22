import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, CircularProgress, Tooltip, Chip, alpha,
} from '@mui/material';
import { PackagePlus, Trash2, Save, ArrowRight, Info } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  ImsShell, Panel, TableScroll, EmptyNote, Th, ItemMultiPicker,
  O2D, O2D_TIP, STOCK_TOKENS, num, inr, imsTableSx,
} from './imsMeta';
import { useGetImsOverviewQuery, useImsReceiveMutation } from '../../store/api/imsApi';

const REASONS = [
  { value: 'VENDOR_RECEIPT', label: 'Vendor receipt', hint: 'Material physically received from a supplier against a bill or challan.' },
  { value: 'OPENING_STOCK', label: 'Opening stock', hint: 'The stock that already existed when you started using IMS.' },
  { value: 'CORRECTION_ADJUSTMENT', label: 'Correction / adjustment', hint: 'Fixing a counting mistake so the system matches the physical store.' },
  // Anything that is none of the above. Rather than minting a new code per
  // one-off situation, the operator types the reason and it is stored with it.
  { value: 'OTHER', label: 'Other', hint: 'Anything else — type your own reason into this field so History can explain it later.' },
];

const REASON_BY_LABEL = new Map(REASONS.map((r) => [r.label.toLowerCase(), r]));

/**
 * Turn whatever is in the Reason field into what the API expects. The field is
 * the single source of truth — a predefined label maps to its code, anything
 * else IS the reason and rides along as customReason under OTHER.
 *
 * "Other" typed or picked on its own is deliberately NOT valid: it names no
 * reason, which is the whole point of letting the user type one.
 */
const resolveReason = (text) => {
  const t = String(text || '').trim();
  const hit = REASON_BY_LABEL.get(t.toLowerCase());
  if (hit && hit.value !== 'OTHER') return { reason: hit.value, customReason: '', custom: false, ok: true, hint: hit.hint };
  if (hit) return { reason: 'OTHER', customReason: '', custom: true, ok: false, hint: hit.hint };
  if (!t) return { reason: '', customReason: '', custom: false, ok: false, hint: '' };
  return { reason: 'OTHER', customReason: t, custom: true, ok: true, hint: '' };
};

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
  // The Reason field's raw text. Everything else about the reason is derived.
  const [reasonText, setReasonText] = useState(REASONS[0].label);
  // Selecting "Other" is a mode switch, not a value — see onInputChange below.
  const otherJustPicked = useRef(false);
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([]); // {skuId, skuCode, skuName, unit, onHand, quantity, unitCost}

  // The row shape is unchanged — quantity and unitCost start EMPTY, whether one
  // item is added or twenty. Nothing downstream can tell how it was picked.
  const toLine = (it) => ({
    skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit,
    onHand: it.onHand, maxLevel: it.maxLevel, quantity: '', unitCost: '',
  });
  const addItems = (picked = []) => setLines((p) => {
    // Guard against a double-add even though the picker already greys out rows
    // that are on the table.
    const have = new Set(p.map((l) => l.skuId));
    return [...p, ...picked.filter((it) => it && !have.has(it.skuId)).map(toLine)];
  });
  const setField = (id, k, v) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, [k]: v } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const picked = resolveReason(reasonText);
  const reasonError = !picked.ok;
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0) && picked.ok;
  const totalQty = lines.reduce((t, l) => t + Number(l.quantity || 0), 0);
  const totalValue = lines.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);

  const submit = async () => {
    try {
      const res = await receive({
        date, reference,
        // Unchanged API: a predefined code, or OTHER carrying the typed text.
        reason: picked.reason, customReason: picked.customReason,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0) })),
      }).unwrap();
      enqueueSnackbar(`Stock added for ${res?.data?.count || lines.length} item(s).`, { variant: 'success' });
      setLines([]); setReference(''); setReasonText(REASONS[0].label);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
  };


  return (
    <ImsShell
      icon={PackagePlus}
      title="Stock In — bring material into the store"
      subtitle="Record what arrived. Closing Stock goes up and the movement is logged against your name."
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
          {/* One control, both jobs: pick a predefined reason or type your own.
              freeSolo is what lets the same field accept arbitrary text, so there
              is no second input to keep in sync. */}
          <Autocomplete
            freeSolo size="small" options={REASONS}
            // All four options, always. The default filter would narrow the
            // list to whatever is already typed, so a field reading "Vendor
            // receipt" would offer only that one and hide "Other" — fatal for a
            // 4-item mode picker. selectOnFocus makes overtyping a single click.
            filterOptions={(x) => x} selectOnFocus handleHomeEndKeys openOnFocus
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
            inputValue={reasonText}
            onInputChange={(_, v, changeReason) => {
              // After picking an option MUI writes its label back into the input.
              // For "Other" we want an EMPTY field instead, so the user can type
              // immediately rather than deleting the word first.
              if (changeReason === 'reset' && otherJustPicked.current) {
                otherJustPicked.current = false;
                setReasonText('');
                return;
              }
              setReasonText(v);
            }}
            onChange={(_, v) => {
              if (v && typeof v === 'object') {
                otherJustPicked.current = v.value === 'OTHER';
                setReasonText(v.value === 'OTHER' ? '' : v.label);
              } else {
                setReasonText(v || '');
              }
            }}
            renderOption={(props, o) => (
              <li {...props} key={o.value}>
                <Box>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: O2D.ink }}>{o.label}</Typography>
                  <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.hint}</Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Reason" size="small" required
                placeholder="Pick one, or type your own reason…"
                error={reasonError}
                helperText={
                  !reasonText.trim() ? 'Reason is required — pick one from the list or type your own.'
                    : !picked.ok ? 'Type your own reason here, in place of "Other".'
                      : picked.custom ? 'Saved as a custom reason and shown in History.'
                        : picked.hint
                }
                FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: reasonError ? undefined : O2D.sub, mx: 0 } }} />
            )}
          />
          <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="Bill / challan / note no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 — the lines ── */}
      <Panel>
        <StepHead n={2} title="What is coming in?" hint="Tick the items that arrived, add them, then type each quantity." done={lines.length > 0} />
        {/* Multi-select: tick several items and add them in one go. Each one
            still lands as an ordinary row with an EMPTY quantity, exactly as a
            one-by-one add did. */}
        <ItemMultiPicker
          options={items}
          addedIds={lines.map((l) => l.skuId)}
          onAdd={addItems}
        />

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(820)}>
            <TableHead>
              <TableRow>
                <TableCell>SKU Code</TableCell>
                <TableCell>Item Name</TableCell>
                <TableCell align="right">Available Qty</TableCell>
                <TableCell align="right">Quantity received</TableCell>
                <TableCell align="right"><Th label="Cost per unit" hint="Optional. Used to value the stock and to price future purchases." /></TableCell>
                <TableCell align="right"><Th label="New balance" hint="What the Closing Stock becomes once you save this receipt." /></TableCell>
                <TableCell align="center" />
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
