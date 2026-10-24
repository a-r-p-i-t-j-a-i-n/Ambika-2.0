import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, Chip, FormControlLabel, Switch, CircularProgress, Tooltip,
  Autocomplete,
} from '@mui/material';
import { PackageMinus, Trash2, Save, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  ImsShell, Panel, TableScroll, EmptyNote, Th, ItemMultiPicker, StepHead, newRequestId,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx, IMS_FORM_MAX, emptyCellSx,
} from './imsMeta';
import { useGetImsOverviewQuery, useImsIssueMutation } from '../../store/api/imsApi';
import { FIELD } from './imsFieldHelp';

const H = FIELD.ims;

/**
 * Why the material is leaving the store — the same control, and the same
 * "type your own" rule, as the Reason on Stock In.
 *
 * Every reason here IS consumption. A Stock Out still posts a CONSUME_OUT, and
 * that is exactly what Average Daily Consumption is measured from, so writing
 * off damage or fixing a miscount must not be recorded through this screen —
 * either would quietly inflate every reorder level built on ADC.
 */
const REASONS = [
  { value: 'PRODUCTION_ISSUE', label: 'Used in production', hint: 'Material issued to the line to be used in production.' },
  { value: 'MAINTENANCE', label: 'Maintenance / upkeep', hint: 'Used servicing or maintaining the machines.' },
  { value: 'SAMPLE_TESTING', label: 'Sample / testing', hint: 'Taken for a sample, a trial or quality testing.' },
  { value: 'OTHER', label: 'Other', hint: 'Anything else — type your own reason so History can explain it later.' },
];

const REASON_BY_LABEL = new Map(REASONS.map((r) => [r.label.toLowerCase(), r]));

/**
 * Turn whatever is in the Reason field into what the API expects — identical to
 * the Stock In rule: a predefined label maps to its code, anything else IS the
 * reason and rides along as customReason under OTHER. "Other" on its own names
 * no reason, so it is deliberately not valid.
 */
const resolveReason = (text) => {
  const t = String(text || '').trim();
  const hit = REASON_BY_LABEL.get(t.toLowerCase());
  if (hit && hit.value !== 'OTHER') return { reason: hit.value, customReason: '', custom: false, ok: true, hint: hit.hint };
  if (hit) return { reason: 'OTHER', customReason: '', custom: true, ok: false, hint: hit.hint };
  if (!t) return { reason: '', customReason: '', custom: false, ok: false, hint: '' };
  return { reason: 'OTHER', customReason: t, custom: true, ok: true, hint: '' };
};

// Stock Out (production issue / consumption) — multi-line, reduces inventory.
const ImsStockOut = () => {
  const { data } = useGetImsOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [issue, { isLoading }] = useImsIssueMutation();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  // The Reason field's raw text. Everything else about the reason is derived.
  const [reasonText, setReasonText] = useState(REASONS[0].label);
  // Selecting "Other" is a mode switch, not a value — see onInputChange below.
  const otherJustPicked = useRef(false);
  // Identifies THIS submission. It survives a failed save on purpose, so the
  // corrected retry is the same issue, and is replaced once one is accepted.
  const requestId = useRef(newRequestId());
  const [purpose, setPurpose] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [department, setDepartment] = useState('');
  const [reference, setReference] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);
  const [lines, setLines] = useState([]); // {skuId, skuCode, skuName, unit, onHand, reorderPoint, quantity}

  // The row shape is unchanged — quantity starts EMPTY, whether one item is
  // added or twenty. Nothing downstream can tell how it was picked.
  const toLine = (it) => ({
    skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit,
    onHand: it.onHand, reorderPoint: it.reorderPoint, quantity: '',
  });
  const addItems = (picked = []) => setLines((p) => {
    // Guard against a double-add even though the picker already greys out rows
    // that are on the table.
    const have = new Set(p.map((l) => l.skuId));
    return [...p, ...picked.filter((it) => it && !have.has(it.skuId)).map(toLine)];
  });
  const setQty = (id, q) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, quantity: q } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const picked = resolveReason(reasonText);
  const reasonError = !picked.ok;
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0) && picked.ok;
  const overLines = lines.filter((l) => Number(l.quantity || 0) > Number(l.onHand || 0));
  const anyOver = overLines.length > 0;
  const blocked = anyOver && !allowNegative;
  const totalQty = lines.reduce((t, l) => t + Number(l.quantity || 0), 0);
  // Lines that will drop through their reorder point — worth flagging before
  // saving, because that is the moment a purchase order becomes due.
  const willTrigger = lines.filter((l) => {
    const after = Number(l.onHand || 0) - Number(l.quantity || 0);
    return Number(l.quantity || 0) > 0 && Number(l.reorderPoint || 0) > 0
      && after <= Number(l.reorderPoint) && Number(l.onHand || 0) > Number(l.reorderPoint);
  });

  const submit = async () => {
    try {
      const res = await issue({
        date, purpose, issuedTo, department, reference, allowNegative,
        // Same shape as Stock In: a predefined code, or OTHER carrying the text.
        reason: picked.reason, customReason: picked.customReason,
        clientRequestId: requestId.current,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity) })),
      }).unwrap();
      enqueueSnackbar(res?.data?.duplicate
        ? 'Already recorded — this issue was submitted twice, so stock was not changed again.'
        : `Issued ${res?.data?.count || lines.length} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setPurpose(''); setIssuedTo(''); setDepartment(''); setReference('');
      setReasonText(REASONS[0].label);
      requestId.current = newRequestId();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not issue stock.', { variant: 'error' }); }
  };


  return (
    <ImsShell
      icon={PackageMinus}
      title="Stock Out — issue material to production"
      subtitle="Record what left the store. Closing Stock comes down and the issue is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            Every issue you record here also feeds the <b>average daily use</b> behind each item's reorder point. The more
            faithfully this is filled in, the sharper the buying list becomes.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 ── */}
      <Panel>
        <StepHead n={1} title="Issue details" hint="When it went out, where it went, and who took it." done={!!date} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField label="Date issued" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          {/* One control, both jobs — the same Reason field Stock In uses: pick a
              predefined reason or type your own. freeSolo is what lets the same
              field accept arbitrary text, so there is no second input to keep in
              sync. Stored on the movement, so History can explain the issue
              later without anyone parsing prose out of the remarks. */}
          <Autocomplete
            freeSolo size="small" options={REASONS}
            // All four options, always. The default filter would narrow the list
            // to whatever is already typed and hide "Other".
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
          <TextField label="Purpose" size="small" value={purpose} onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Buffing line"
            helperText="What the material is being used for."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
          <TextField label="Department" size="small" value={department} onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. Packing" />
          <TextField label="Issued to (person)" size="small" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)}
            placeholder="Who collected it" />
          <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="Slip / job no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
      </Panel>

      {/* ── Step 2 ── */}
      <Panel>
        <StepHead n={2} title="What is going out?" hint="Tick the items being issued, add them, then type each quantity." done={lines.length > 0} />
        {/* Multi-select: tick several items and add them in one go. Each one
            still lands as an ordinary row with an EMPTY quantity, exactly as a
            one-by-one add did. */}
        <ItemMultiPicker
          options={items}
          addedIds={lines.map((l) => l.skuId)}
          onAdd={addItems}
        />

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(760)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell sx={{ width: '100%' }}><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell align="right">Available Qty</TableCell>
                <TableCell align="right">Quantity issued</TableCell>
                <TableCell align="right"><Th label="Left after this" hint={H.newBalance} /></TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={7} sx={emptyCellSx}>
                  <EmptyNote dense icon={PackageMinus} title="No items added yet"
                    hint="Use the search box above to pick the first item being issued." />
                </TableCell></TableRow>
              )}
              {lines.map((l, i) => {
                const qty = Number(l.quantity || 0);
                const over = qty > Number(l.onHand || 0);
                const after = Number(l.onHand || 0) - qty;
                const belowReorder = !over && Number(l.reorderPoint || 0) > 0 && after <= Number(l.reorderPoint);
                const tone = over ? STOCK_TOKENS.OUT_OF_STOCK : belowReorder ? STOCK_TOKENS.REORDER : STOCK_TOKENS.OK;
                return (
                  <TableRow key={l.skuId} hover sx={over ? { bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint } : null}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: O2D.brand, whiteSpace: 'nowrap' }}>{l.skuCode}</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={l.skuName}>{l.skuName}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>{num(l.onHand)} {l.unit}</TableCell>
                    <TableCell align="right">
                      {/* The column heading is the only visible label, and a
                          screen reader does not carry it into the cell — so each
                          box names its own item. Same wording pattern as the FG
                          entry screens ("Quantity dispatched — <item>"). */}
                      <TextField size="small" type="number" value={l.quantity} error={over && !allowNegative}
                        autoFocus={lines[lines.length - 1].skuId === l.skuId}
                        onChange={(e) => setQty(l.skuId, e.target.value)}
                        inputProps={{
                          min: 0,
                          'aria-label': `Quantity issued — ${l.skuName}`,
                          style: { textAlign: 'right', width: 84, fontWeight: 700 },
                        }} placeholder="0" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {qty > 0 ? (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={over
                            ? `Only ${num(l.onHand)} ${l.unit || 'units'} are in the store. Issuing ${num(qty)} would leave the balance negative.`
                            : belowReorder
                              ? `This drops the item to or below its reorder point of ${num(l.reorderPoint)} — it will appear on the buying list.`
                              : 'Balance stays healthy after this issue.'}>
                          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ cursor: 'help' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>{num(l.onHand)}</Typography>
                            <ArrowRight size={12} color={O2D.faint} />
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: tone.color }}>{num(after)}</Typography>
                          </Stack>
                        </Tooltip>
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

      {/* ── Consequences, spelled out before the client commits ── */}
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
              After this issue, {willTrigger.length} item{willTrigger.length > 1 ? 's' : ''} will land on the buying list.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* ── Step 3 ── */}
      <Paper elevation={0} sx={{
        position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
        border: `1px solid ${valid && !blocked ? STOCK_TOKENS.OK.border : O2D.line}`,
        bgcolor: valid && !blocked ? STOCK_TOKENS.OK.tint : O2D.surface,
        boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StepHead n={3} title="Confirm and save"
            hint={blocked ? 'Fix the over-issued lines first.'
              : reasonError ? 'Pick a reason, or type your own.'
                : valid ? 'Everything looks right.' : 'Add at least one item with a quantity above zero.'}
            done={valid && !blocked} />
          <FormControlLabel
            sx={{ ml: 0.5, mr: 'auto' }}
            control={<Switch size="small" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow issuing more than we hold</Typography>}
          />
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={`${lines.length} item${lines.length === 1 ? '' : 's'}`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            <Chip size="small" label={`${num(totalQty)} units out`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: '#ffedd5', border: '1px solid #fed7aa', color: '#c2410c' }} />
            <Button variant="contained" disableElevation disabled={!valid || isLoading || blocked} onClick={submit}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Issue from store
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </ImsShell>
  );
};

export default ImsStockOut;
