import React, { useMemo, useRef, useState } from 'react';
import {
  Box, Stack, Typography, TextField, Button, Table, TableHead, TableBody,
  TableRow, TableCell, IconButton, MenuItem, CircularProgress, Tooltip, Autocomplete,
} from '@mui/material';
import { Factory, Trash2, Save, Info, History, ClipboardList } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  FgShell, Panel, TableScroll, EmptyNote, Th, ItemMultiPicker, StepHead, IntroNote,
  QtyField, BalanceDelta, ConfirmBar, SuccessNote, SummaryChip,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx, IMS_FORM_MAX, emptyCellSx,
  FG_ACCENT, FG_ACCENT_DARK, SHIFT_LABEL, useFgProductionMasters, newRequestId,
} from './fgImsMeta';
import { useGetFgOverviewQuery, useFgProduceMutation } from '../../store/api/fgImsApi';

const REASONS = [
  { value: 'PRODUCTION', label: 'Production (Daily Production Report)' },
  { value: 'OPENING', label: 'Opening stock' },
  { value: 'SALES_RETURN', label: 'Sales return (goods back in)' },
  { value: 'CORRECTION', label: 'Correction / adjustment' },
];

// The save button names the business act, not the database operation. The API
// call behind every one of these is the same unchanged fgProduce mutation.
const SAVE_LABEL = {
  PRODUCTION: 'Save Production Report',
  OPENING: 'Save Opening Stock',
  SALES_RETURN: 'Save Sales Return',
  CORRECTION: 'Save Correction',
};

const SAVED_LABEL = {
  PRODUCTION: 'Production report saved',
  OPENING: 'Opening stock saved',
  SALES_RETURN: 'Sales return saved',
  CORRECTION: 'Correction saved',
};

// Production In — record finished goods completed on the line (the DPR). Adds to stock.
const FgImsProductionIn = () => {
  const navigate = useNavigate();
  const { data } = useGetFgOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [produce, { isLoading }] = useFgProduceMutation();
  // Shift / Line / Supervisor come from the PPC floor masters the DPR module
  // already owns — read only, and never written back from here.
  const masters = useFgProductionMasters();

  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [reason, setReason] = useState('PRODUCTION');
  const [reference, setReference] = useState('');
  const [shift, setShift] = useState('');
  const [line, setLine] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [lines, setLines] = useState([]);
  // What the last save actually posted, so the cleared form still says so.
  const [saved, setSaved] = useState(null);
  // Identifies THIS submission. It survives a failed save on purpose, so the
  // corrected retry is the same entry, and is replaced once an entry is
  // accepted so the next report is a new one.
  const requestId = useRef(newRequestId());

  // Rows land with an EMPTY quantity, whether one item is added or twenty —
  // picking an item and saying how much of it moved are two different decisions.
  // `unit` rides along from the SKU master so the row never asks for a UOM.
  const toLine = (it) => ({
    skuId: it.skuId, skuCode: it.skuCode, skuName: it.skuName, unit: it.unit,
    onHand: it.onHand, quantity: '', batchNo: '',
  });
  const addItems = (picked = []) => setLines((p) => {
    const have = new Set(p.map((l) => l.skuId));
    return [...p, ...picked.filter((it) => it && !have.has(it.skuId)).map(toLine)];
  });
  const setField = (id, k, v) => setLines((p) => p.map((l) => (l.skuId === id ? { ...l, [k]: v } : l)));
  const remove = (id) => setLines((p) => p.filter((l) => l.skuId !== id));

  const totalQty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0);
  const isProduction = reason === 'PRODUCTION';
  const supervisorOptions = masters.supervisorsFor(line);

  const submit = async () => {
    try {
      const res = await produce({
        date, reason, reference, clientRequestId: requestId.current,
        shift: isProduction ? shift : undefined,
        line: isProduction ? line : undefined,
        supervisor: isProduction ? supervisor : undefined,
        items: lines.map((l) => ({ skuId: l.skuId, skuCode: l.skuCode, quantity: Number(l.quantity), batchNo: l.batchNo || '' })),
      }).unwrap();
      const count = res?.data?.count || lines.length;
      setSaved({ reason, count, units: totalQty });
      enqueueSnackbar(res?.data?.duplicate
        ? 'Already recorded — this report was submitted twice, so stock was not changed again.'
        : `Recorded ${count} item(s) — stock updated.`, { variant: 'success' });
      setLines([]); setReference('');
      requestId.current = newRequestId();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not record production.', { variant: 'error' }); }
  };

  return (
    <FgShell
      icon={Factory}
      title="Production In — Daily Production Report"
      subtitle="Record finished goods completed on the line. Stock goes up and the movement is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      {/* What this screen does and does not do — stated up front. */}
      <IntroNote accent={FG_ACCENT} icon={Info}>
        Everything recorded here <b>adds to finished-goods stock</b> and is logged against your name. Production entries
        are the Daily Production Report; use Opening stock only for balances that existed before IMS, and Correction
        only to make the system match a physical count.
      </IntroNote>

      {/* ── What the last save posted ── */}
      {saved && (
        <SuccessNote
          title={SAVED_LABEL[saved.reason] || 'Entry saved'}
          detail={`${num(saved.count)} item${saved.count === 1 ? '' : 's'} · ${num(saved.units)} units added to finished-goods stock.`}
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

      {/* ── Step 1 — the production header ── */}
      <Panel>
        {/* Where shift / line / supervisor come from is said once, here, rather
            than as a helper line under all three fields — three extra lines of
            prose that pushed the table a whole row further down the page. */}
        <StepHead n={1} title="Production details"
          hint="When it was made, and why. Shift, line and supervisor come from the DPR floor masters."
          done={!!date} accent={FG_ACCENT} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField label="Production date" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          <TextField select label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField label="Reference (optional)" size="small" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="DPR / doc no."
            helperText="Helps you trace this entry later in History."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />

          {/* Shift, line and supervisor only mean anything for an actual production
              run — an opening balance or a correction has none of them. All three
              pick from the PPC floor masters, and all three stay freeSolo so a
              value can still be typed when a master has no matching record. */}
          {isProduction && <>
            <Autocomplete
              freeSolo size="small" options={masters.shifts} value={shift || null}
              onChange={(_e, v) => setShift(v || '')}
              onInputChange={(_e, v) => setShift(v || '')}
              renderOption={(props, o) => <li {...props} key={o}>{SHIFT_LABEL[o] || o}</li>}
              renderInput={(p) => (
                <TextField {...p} label="Shift" size="small"
                  placeholder={masters.shifts.length ? 'Pick a shift' : 'A / B / General'} />
              )}
            />
            <Autocomplete
              freeSolo size="small" options={masters.machines.map((m) => m.code)} value={line || null}
              onChange={(_e, v) => { setLine(v || ''); setSupervisor(''); }}
              onInputChange={(_e, v) => setLine(v || '')}
              renderOption={(props, code) => {
                const m = masters.machines.find((x) => x.code === code);
                return (
                  <li {...props} key={code}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }}>{code}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>
                        {[m?.name, m?.machineType].filter(Boolean).join(' · ') || 'Machine'}
                      </Typography>
                    </Box>
                  </li>
                );
              }}
              renderInput={(p) => (
                <TextField {...p} label="Line / machine" size="small"
                  placeholder={masters.machines.length ? 'Pick a machine' : 'Line or machine code'} />
              )}
            />
            <Autocomplete
              freeSolo size="small" options={supervisorOptions} value={supervisor || null}
              onChange={(_e, v) => setSupervisor(v || '')}
              onInputChange={(_e, v) => setSupervisor(v || '')}
              renderInput={(p) => (
                <TextField {...p} label="Supervisor" size="small"
                  placeholder={supervisorOptions.length ? 'Pick a supervisor' : 'Who ran the shift'} />
              )}
            />
          </>}
        </Box>
      </Panel>

      {/* ── Step 2 — the lines ── */}
      <Panel>
        <StepHead n={2} title="What was produced?" hint="Tick the finished goods that came off the line, add them, then type each quantity."
          done={lines.length > 0} accent={FG_ACCENT} />
        {/* Multi-select: tick several items and add them in one go — the same
            picker the Consumables Stock In screen uses. */}
        <ItemMultiPicker
          options={items}
          addedIds={lines.map((l) => l.skuId)}
          onAdd={addItems}
          accent={FG_ACCENT}
          label="Add finished goods produced"
          placeholder="Search finished good by code or name..."
          emptyHint="No finished goods match that search."
        />

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(940)}>
            <TableHead>
              <TableRow>
                {/* `width: '100%'` on the name column is the whole column-sizing
                    rule: the browser gives every other column exactly the width
                    its content needs, and hands all the slack to this one. On a
                    wide monitor the numeric columns stay grouped and readable
                    instead of drifting apart across the table. */}
                <TableCell>SKU Code</TableCell>
                <TableCell sx={{ width: '100%' }}>Finished Good</TableCell>
                <TableCell><Th label="UOM" hint="The unit this finished good is counted in. It comes from the SKU master and is never typed here." /></TableCell>
                <TableCell align="right">Available Qty</TableCell>
                <TableCell align="right">Quantity produced</TableCell>
                <TableCell align="right"><Th label="New balance" hint="What the stock on hand becomes once you save this entry." /></TableCell>
                <TableCell><Th label="Batch / lot" hint="Optional. The batch or lot number these units were made under — typed by hand, and stored with the movement." /></TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={8} sx={emptyCellSx}>
                  <EmptyNote dense icon={Factory} title="No finished goods added yet"
                    hint="Use the search box above to pick the first item that came off the line." />
                </TableCell></TableRow>
              )}
              {lines.map((l) => {
                const qty = Number(l.quantity || 0);
                const newBal = Number(l.onHand || 0) + qty;
                return (
                  <TableRow key={l.skuId} hover>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: FG_ACCENT, whiteSpace: 'nowrap' }}>{l.skuCode}</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={l.skuName}>{l.skuName}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700, color: O2D.sub }}>{l.unit || '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub, whiteSpace: 'nowrap' }}>{num(l.onHand)}</TableCell>
                    <TableCell align="right">
                      <QtyField
                        value={l.quantity} unit={l.unit} accent={FG_ACCENT}
                        autoFocus={lines[lines.length - 1].skuId === l.skuId}
                        ariaLabel={`Quantity produced — ${l.skuName}`}
                        onChange={(e) => setField(l.skuId, 'quantity', e.target.value)}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {qty > 0
                        ? <BalanceDelta from={l.onHand} to={newBal} unit={l.unit} tone={STOCK_TOKENS.OK}
                            title={`Saving this adds ${num(qty)} ${l.unit || 'units'} to stock.`} />
                        : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell>
                      <TextField size="small" value={l.batchNo} onChange={(e) => setField(l.skuId, 'batchNo', e.target.value)}
                        placeholder="Batch / lot no." inputProps={{ 'aria-label': `Batch or lot — ${l.skuName}`, style: { width: 116 } }} />
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

      {/* ── Step 3 — confirm. The summary sits next to the button so the planner
          sees exactly what they are committing before they click. ── */}
      <ConfirmBar
        n={3} title="Confirm and save" done={valid} accent={FG_ACCENT}
        hint={valid ? 'Everything looks right.' : 'Add at least one finished good with a quantity above zero.'}
      >
        <SummaryChip label={`${num(lines.length)} Finished Good${lines.length === 1 ? '' : 's'}`} />
        <SummaryChip label={`${num(totalQty)} Total Units`} tone={STOCK_TOKENS.OK} />
        <Button variant="contained" disableElevation disabled={!valid || isLoading} onClick={submit}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: FG_ACCENT, '&:hover': { bgcolor: FG_ACCENT_DARK } }}>
          {SAVE_LABEL[reason] || 'Save'}
        </Button>
      </ConfirmBar>
    </FgShell>
  );
};

export default FgImsProductionIn;
