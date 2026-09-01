import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, MenuItem,
  FormControlLabel, Switch, Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
  Chip, Tooltip, LinearProgress,
} from '@mui/material';
import { Recycle, Plus, Trash2, Save, Disc3, CircleDashed, AlertTriangle, Info, Scissors } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, KpiTile, EmptyNote, Th, StepHead, KindChip, YieldChip, ScrapChip, yieldBand,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useGetRmConversionsQuery, useRmConvertMutation } from '../../store/api/rmImsApi';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const blankCircle = () => ({ sku: null, sizeLabel: '', pcs: '', weightKg: '' });

const SCRAP_STATES = [
  { value: 'PENDING', label: 'Not yet checked', hint: 'Scrap weight has not been physically verified against the store.' },
  { value: 'JOB_WORK', label: 'Sent for job work', hint: 'The offcuts have gone out to a job worker.' },
  { value: 'DONE', label: 'Verified', hint: 'Scrap has been weighed and accounted for.' },
];

const RmImsConversion = () => {
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);
  const coils = useMemo(() => items.filter((i) => i.kind === 'COIL'), [items]);
  const circleSkus = useMemo(() => items.filter((i) => i.kind === 'CIRCLE'), [items]);
  const { data: convRes } = useGetRmConversionsQuery({ limit: 50 });
  const conversions = convRes?.data || [];
  const totals = convRes?.meta || {};
  const [convert, { isLoading }] = useRmConvertMutation();

  const [coil, setCoil] = useState(null);
  const [head, setHead] = useState({
    conversionDate: dayjs().format('YYYY-MM-DD'), batchNo: '', coilWeightKg: '', rate: '',
    scrapVerified: 'PENDING', allowNegative: false,
  });
  const [circles, setCircles] = useState([blankCircle()]);

  const setC = (i, k, v) => setCircles((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addC = () => setCircles((p) => [...p, blankCircle()]);
  const delC = (i) => setCircles((p) => (p.length === 1 ? [blankCircle()] : p.filter((_, j) => j !== i)));

  const circlesWeight = round2(circles.reduce((s, c) => s + Number(c.weightKg || 0), 0));
  const coilWt = Number(head.coilWeightKg || 0);
  const scrap = round2(coilWt - circlesWeight);
  const yieldPct = coilWt > 0 ? round2((circlesWeight / coilWt) * 100) : 0;
  const validCircles = circles.filter((c) => c.sku && Number(c.weightKg) > 0);
  const overCut = scrap < 0;
  const shortCoil = !!coil && coilWt > Number(coil.onHand || 0) && !head.allowNegative;
  const ready = !!coil && coilWt > 0 && validCircles.length > 0 && !overCut && !shortCoil;
  const band = yieldBand(yieldPct);

  const submit = async () => {
    if (!coil) return enqueueSnackbar('Pick the coil being cut.', { variant: 'warning' });
    if (coilWt <= 0) return enqueueSnackbar('Enter how much coil weight was consumed.', { variant: 'warning' });
    if (!validCircles.length) return enqueueSnackbar('Add at least one circle with a weight.', { variant: 'warning' });
    try {
      const res = await convert({
        conversionDate: head.conversionDate, batchNo: head.batchNo || undefined,
        coilSkuId: coil.skuId, coilWeightKg: coilWt, rate: Number(head.rate || coil.rate || 0),
        scrapVerified: head.scrapVerified, allowNegative: head.allowNegative,
        circles: validCircles.map((c) => ({
          circleSkuId: c.sku.skuId, sizeLabel: c.sizeLabel || c.sku.skuName,
          pcs: Number(c.pcs || 0), weightKg: Number(c.weightKg),
        })),
      }).unwrap();
      enqueueSnackbar(`Conversion ${res?.data?.conversionNumber || ''} saved — yield ${num(res?.data?.yieldRatioPct)}%.`, { variant: 'success' });
      setCoil(null);
      setHead((h) => ({ ...h, batchNo: '', coilWeightKg: '', rate: '' }));
      setCircles([blankCircle()]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the conversion.', { variant: 'error' }); }
  };

  return (
    <RmShell
      icon={Recycle}
      title="Cut coils into circles"
      subtitle="One entry takes the coil out of stock, puts the circles in, and records the scrap."
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            <b>Yield</b> is the share of the coil's weight that came out as usable circles — everything else is scrap.
            Watch it batch to batch: a yield that drifts downward usually means blade wear or a change in the cutting
            pattern, and it costs real money.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 — the coil ── */}
      <Panel>
        <StepHead n={1} title="Which coil is being cut?" hint="Pick the coil and say how much of its weight went into the machine." done={!!coil && coilWt > 0} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr' }, gap: 1.25, mt: 1.25 }}>
          <Autocomplete
            size="small" options={coils} value={coil}
            onChange={(_, v) => { setCoil(v); if (v && !head.rate) setHead((h) => ({ ...h, rate: v.rate || '' })); }}
            getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
            isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
            renderOption={(props, o) => (
              <li {...props} key={o.skuId}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{o.skuCode} · {num(o.onHand)} in store</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => (
              <TextField {...p} label="Coil being cut" placeholder="Search a coil…"
                InputProps={{ ...p.InputProps, startAdornment: <><Disc3 size={14} style={{ marginLeft: 6, marginRight: 2, opacity: 0.55 }} />{p.InputProps.startAdornment}</> }} />
            )}
          />
          <TextField size="small" type="date" label="Date cut" value={head.conversionDate}
            onChange={(e) => setHead((h) => ({ ...h, conversionDate: e.target.value }))}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          <TextField size="small" label="Batch number" value={head.batchNo}
            onChange={(e) => setHead((h) => ({ ...h, batchNo: e.target.value }))}
            placeholder="Optional"
            helperText="Traces a quality issue back to this cut."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.25, mt: 1.5 }}>
          <TextField size="small" type="number" label="Coil weight used (kg)" value={head.coilWeightKg}
            onChange={(e) => setHead((h) => ({ ...h, coilWeightKg: e.target.value }))}
            error={shortCoil}
            helperText={coil ? `${num(coil.onHand)} in store` : 'Pick a coil first'}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: shortCoil ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.sub, mx: 0 } }} />
          <TextField size="small" type="number" label="Rate (₹ per kg)" value={head.rate}
            onChange={(e) => setHead((h) => ({ ...h, rate: e.target.value }))}
            helperText="Used to value the circles produced."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
          <TextField select size="small" label="Scrap checked?" value={head.scrapVerified}
            onChange={(e) => setHead((h) => ({ ...h, scrapVerified: e.target.value }))}
            helperText={SCRAP_STATES.find((s) => s.value === head.scrapVerified)?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}>
            {SCRAP_STATES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <FormControlLabel
            sx={{ alignSelf: 'start', mt: 0.5 }}
            control={<Switch size="small" checked={head.allowNegative}
              onChange={(e) => setHead((h) => ({ ...h, allowNegative: e.target.checked }))} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow cutting more coil than we hold</Typography>}
          />
        </Box>
      </Panel>

      {/* ── Step 2 — the circles ── */}
      <Panel>
        <StepHead n={2} title="What came out?" hint="Every circle size produced from this coil, with its weight." done={validCircles.length > 0} />
        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(860)}>
            <TableHead>
              <TableRow>
                <TableCell>Circle produced</TableCell>
                <TableCell><Th label="Size label" hint="How the shop floor names this size. Leave blank to use the item name." /></TableCell>
                <TableCell align="right">Pieces</TableCell>
                <TableCell align="right"><Th label="Weight (kg)" hint="Total weight of these circles. This is what the yield is calculated from." /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {circles.map((c, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ minWidth: 270 }}>
                    <Autocomplete
                      size="small" options={circleSkus} value={c.sku} onChange={(_, v) => setC(i, 'sku', v)}
                      getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                      isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                      renderOption={(props, o) => (
                        <li {...props} key={o.skuId}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{o.skuCode} · {num(o.onHand)} in store</Typography>
                          </Box>
                        </li>
                      )}
                      renderInput={(p) => (
                        <TextField {...p} placeholder="Search a circle…"
                          InputProps={{ ...p.InputProps, startAdornment: <><CircleDashed size={14} style={{ marginLeft: 6, marginRight: 2, opacity: 0.55 }} />{p.InputProps.startAdornment}</> }} />
                      )}
                    />
                  </TableCell>
                  <TableCell sx={{ width: 210 }}>
                    <TextField size="small" value={c.sizeLabel} onChange={(e) => setC(i, 'sizeLabel', e.target.value)}
                      placeholder={'e.g. Cu - 0.8mm - 8.50"'} fullWidth />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>
                    <TextField size="small" type="number" value={c.pcs} onChange={(e) => setC(i, 'pcs', e.target.value)}
                      inputProps={{ min: 0, style: { textAlign: 'right', width: 66 } }} placeholder="0" />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 130 }}>
                    <TextField size="small" type="number" value={c.weightKg} onChange={(e) => setC(i, 'weightKg', e.target.value)}
                      inputProps={{ min: 0, style: { textAlign: 'right', width: 78, fontWeight: 700 } }} placeholder="0" />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Tooltip arrow slotProps={O2D_TIP} title="Clear this line">
                      <IconButton size="small" onClick={() => delC(i)} sx={{ color: O2D.faint, '&:hover': { color: STOCK_TOKENS.OUT_OF_STOCK.color } }}>
                        <Trash2 size={15} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
        <Button size="small" startIcon={<Plus size={14} />} onClick={addC}
          sx={{ mt: 1.25, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', color: O2D.brand }}>
          Add another circle size
        </Button>
      </Panel>

      {/* ── Step 3 — the arithmetic, live ── */}
      <Panel>
        <StepHead n={3} title="Check the balance" hint="Coil in, circles out, and what is left as scrap." done={ready} />
        <Box sx={{ mt: 1.25 }}>
          {/* A single bar reading left to right: usable circles, then scrap.
              A reader sees the split without doing the division themselves. */}
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.6 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.sub, mr: 'auto' }}>
              {coilWt > 0 ? `${num(circlesWeight)}kg of usable circles from ${num(coilWt)}kg of coil` : 'Enter the coil weight to see the split'}
            </Typography>
            {coilWt > 0 && <YieldChip pct={yieldPct} />}
          </Stack>
          <LinearProgress
            variant="determinate"
            value={coilWt > 0 ? Math.min(100, Math.max(0, yieldPct)) : 0}
            sx={{
              height: 10, borderRadius: 5, bgcolor: overCut ? STOCK_TOKENS.OUT_OF_STOCK.bg : '#fef3c7',
              '& .MuiLinearProgress-bar': { borderRadius: 5, bgcolor: band.color },
            }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            {[
              ['Coil used', `${num(coilWt)} kg`, O2D.body, 'The weight taken out of coil stock.'],
              ['Circles made', `${num(circlesWeight)} kg`, '#4338ca', 'The weight added to circle stock.'],
              ['Scrap', `${num(scrap)} kg`, overCut ? STOCK_TOKENS.OUT_OF_STOCK.color : '#b45309', 'Offcuts and losses — coil weight minus circle weight.'],
              ['Yield', `${num(yieldPct)}%`, band.color, 'Share of the coil that became usable circles.'],
            ].map(([label, value, color, hint]) => (
              <Tooltip key={label} arrow slotProps={O2D_TIP} title={hint}>
                <Box sx={{
                  px: 1.25, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`,
                  bgcolor: O2D.surface, minWidth: 106, cursor: 'help',
                }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                </Box>
              </Tooltip>
            ))}
          </Stack>

          {overCut && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  The circles weigh {num(Math.abs(scrap))}kg more than the coil. Metal cannot be created — check the weights.
                </Typography>
              </Stack>
            </Paper>
          )}
          {!overCut && shortCoil && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  Only {num(coil?.onHand)}kg of this coil is in stock. Correct the weight, or allow a negative balance above.
                </Typography>
              </Stack>
            </Paper>
          )}
          {ready && yieldPct < 85 && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: '1px solid #fde68a', bgcolor: '#fffbeb',
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: '#b45309', display: 'flex' }}><Scissors size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309' }}>
                  {num(100 - yieldPct)}% of this coil is going to scrap. Worth a look at the cutting pattern before saving.
                </Typography>
              </Stack>
            </Paper>
          )}

          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Save this conversion
            </Button>
          </Stack>
        </Box>
      </Panel>

      {/* ── Past conversions ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Coil consumed" value={`${num(totals.coilKg)} kg`} sub="Across recorded conversions" color="#0f766e" icon={Disc3} />
        <KpiTile label="Circles produced" value={`${num(totals.circlesKg)} kg`} sub="Added back to stock" color="#4338ca" icon={CircleDashed} />
        <KpiTile label="Scrap" value={`${num(totals.scrapKg)} kg`} sub="Offcuts and losses" color="#b45309" icon={Trash2} />
        <KpiTile label="Average yield" value={`${num(totals.avgYield)}%`} sub="Higher is better"
          color={yieldBand(totals.avgYield).color} icon={Recycle} />
      </Stack>

      <Panel title="Past conversions" icon={Recycle} hint="Every coil cut so far, newest first." dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(920)}>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Coil</TableCell>
                <TableCell align="right">Coil used</TableCell>
                <TableCell align="right">Circles made</TableCell>
                <TableCell align="right">Scrap</TableCell>
                <TableCell><Th label="Yield" hint="Share of the coil's weight that became usable circles." /></TableCell>
                <TableCell>Scrap checked?</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {conversions.length === 0 && (
                <TableRow><TableCell colSpan={8} sx={{ border: 0 }}>
                  <EmptyNote icon={Recycle} title="No coils cut yet"
                    hint="Record your first conversion above and the batch history will build up here." />
                </TableCell></TableRow>
              )}
              {conversions.map((c) => (
                <TableRow key={c._id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: O2D.ink }}>{dayjs(c.conversionDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{c.batchNo || '—'}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>{c.conversionNumber}</Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <KindChip kind="COIL" withHint={false} />
                      <Typography noWrap sx={{ fontSize: '0.78rem', color: O2D.body }} title={c.coilSkuName}>{c.coilSkuCode}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.coilWeightKg)} kg</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#4338ca', fontWeight: 700 }}>{num(c.circlesWeightKg)} kg</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{num(c.scrapKg)} kg</TableCell>
                  <TableCell><YieldChip pct={c.yieldRatioPct} /></TableCell>
                  <TableCell><ScrapChip state={c.scrapVerified} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>
    </RmShell>
  );
};

export default RmImsConversion;
