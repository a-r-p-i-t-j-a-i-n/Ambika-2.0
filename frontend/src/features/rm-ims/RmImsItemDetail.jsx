import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell,
  Tabs, Tab, Tooltip, Button, TextField, Switch, FormControlLabel, TablePagination, Chip,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { Layers, Download, History as HistoryIcon, CalendarDays } from 'lucide-react';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, StatusChip, EmptyNote, Th, Help, KindChip, uomOf,
  O2D, O2D_TIP, STOCK_TOKENS, num, inr, imsTableSx, txnLabel, MoveChip,
} from './rmImsMeta';
import { useGetRmItemDetailQuery, useGetRmStockHistoryQuery, useGetRmMovementsQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const dash = (v) => (v == null ? '—' : num(v));

/**
 * One planning figure with its name and a definition. The label is the same
 * wording the stock list uses, so a planner reads the same word in both places.
 */
const Metric = ({ label, value, hint, sub, tone }) => (
  <Box sx={{ minWidth: 132, flex: '1 1 132px', p: 1.1, borderRadius: '8px', border: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface }}>
    <Stack direction="row" spacing={0.4} alignItems="center">
      <Typography sx={{ fontSize: '0.63rem', fontWeight: 800, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      {hint && <Help text={hint} />}
    </Stack>
    <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: tone || O2D.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
      {value}
    </Typography>
    {sub && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>{sub}</Typography>}
  </Box>
);

/** The client's IMS tab, rebuilt from the ledger. */
const StockHistory = ({ skuId, sku }) => {
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [from, setFrom] = useState(dayjs().subtract(29, 'day').format('YYYY-MM-DD'));
  const [onlyActive, setOnlyActive] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(30);

  const { data, isFetching } = useGetRmStockHistoryQuery({ skuId, from, to });
  const res = data?.data;
  const allDays = useMemo(() => res?.days || [], [res]);
  const days = useMemo(
    () => (onlyActive ? allDays.filter((d) => d.movementCount > 0) : allDays),
    [allDays, onlyActive],
  );
  const paged = useMemo(() => days.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [days, page, rowsPerPage]);
  const s = res?.summary || {};
  const weighed = !!res?.sku?.tracksWeight;
  const unit = res?.sku?.unit || '';

  const setRange = (n) => {
    setTo(dayjs().format('YYYY-MM-DD'));
    setFrom(dayjs().subtract(n - 1, 'day').format('YYYY-MM-DD'));
    setPage(0);
  };

  const exportCsv = () => {
    const header = ['Date', 'Opening', 'Inward', 'Conversion In', 'Conversion Out', 'Consumption', 'Adjustment', 'Net', 'Closing',
      ...(weighed ? ['Opening KG', 'In KG', 'Out KG', 'Closing KG'] : [])];
    const lines = days.map((d) => [d.date, d.opening, d.inward, d.conversionIn, d.conversionOut, d.consumption, d.adjustment, d.net, d.closing,
      ...(weighed ? [d.openingKg ?? '', d.inKg ?? '', d.outKg ?? '', d.closingKg ?? ''] : [])]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `rm-stock-history_${sku?.skuCode || skuId}_${from}_to_${to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <Panel
      title="Day-by-day stock history"
      hint="The closing balance at the end of every day, rebuilt from the movement ledger — the same card the client keeps in the IMS sheet."
      actions={<Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!days.length}
        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>Export</Button>}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        {[15, 30, 60, 90].map((n) => (
          <Button key={n} size="small" onClick={() => setRange(n)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.sub, minWidth: 0 }}>{n} days</Button>
        ))}
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }}
          InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }}
          InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
        <FormControlLabel sx={{ ml: 0.5 }}
          control={<Switch size="small" checked={onlyActive} onChange={(e) => { setOnlyActive(e.target.checked); setPage(0); }} />}
          label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Hide days with no movement</Typography>} />
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Metric label="Opening" value={`${dash(s.openingBalance)} ${unit}`} sub={weighed && s.openingKg != null ? `${num(s.openingKg)} kg recorded` : null} />
        <Metric label="Total in" value={`+${dash(s.totalIn)}`} tone={STOCK_TOKENS.OK.color} />
        <Metric label="Total out" value={`−${dash(s.totalOut)}`} tone={STOCK_TOKENS.REORDER.color} />
        <Metric label="Closing" value={`${dash(s.closingBalance)} ${unit}`} sub={weighed && s.closingKg != null ? `${num(s.closingKg)} kg recorded` : null} />
        <Metric label="Highest" value={dash(s.peak)} />
        <Metric label="Lowest" value={dash(s.low)} />
        <Metric label="Active days" value={`${dash(s.daysWithMovement)} / ${dash(res?.range?.dayCount)}`} />
      </Stack>

      <TableScroll>
        <Table size="small" sx={imsTableSx(weighed ? 1180 : 900)}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
              <TableCell align="right"><Th label="Opening" hint={H.openingBalance} /></TableCell>
              <TableCell align="right"><Th label="Inward" hint={H.inward} /></TableCell>
              <TableCell align="right"><Th label="Conversion In" hint={H.conversionIn} /></TableCell>
              <TableCell align="right"><Th label="Conversion Out" hint={H.conversionOut} /></TableCell>
              <TableCell align="right"><Th label="Consumption" hint={H.consumption} /></TableCell>
              <TableCell align="right"><Th label="Adjustment" hint={H.adjustment} /></TableCell>
              <TableCell align="right"><Th label="Closing" hint={H.closingBalance} /></TableCell>
              {weighed && <TableCell align="right"><Th label="In KG" hint={H.inKg} /></TableCell>}
              {weighed && <TableCell align="right"><Th label="Out KG" hint={H.outKg} /></TableCell>}
              {weighed && <TableCell align="right"><Th label="Closing KG" hint={H.closingKg} /></TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !days.length && (
              <TableRow><TableCell colSpan={weighed ? 11 : 8} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={220} /></TableCell></TableRow>
            )}
            {!isFetching && !days.length && (
              <TableRow><TableCell colSpan={weighed ? 11 : 8} sx={{ border: 0 }}>
                <EmptyNote icon={CalendarDays} title="No history in this window"
                  hint="Widen the date range, or switch off “hide days with no movement”." />
              </TableCell></TableRow>
            )}
            {paged.map((d, i) => (
              <TableRow key={d.date} hover sx={d.closing <= 0 ? { bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint } : undefined}>
                <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.74rem' }}>{dayjs(d.date).format('DD MMM YYYY')}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{num(d.opening)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.inward ? STOCK_TOKENS.OK.color : O2D.faint }}>{d.inward ? `+${num(d.inward)}` : '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.conversionIn ? STOCK_TOKENS.OK.color : O2D.faint }}>{d.conversionIn ? `+${num(d.conversionIn)}` : '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.conversionOut ? O2D.body : O2D.faint }}>{d.conversionOut ? `−${num(d.conversionOut)}` : '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.consumption ? STOCK_TOKENS.REORDER.color : O2D.faint }}>{d.consumption ? `−${num(d.consumption)}` : '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.adjustment ? O2D.body : O2D.faint }}>{d.adjustment ? num(d.adjustment) : '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: d.closing <= 0 ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.ink }}>{num(d.closing)}</TableCell>
                {weighed && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.faint }}>{d.inKg == null ? '—' : num(d.inKg)}</TableCell>}
                {weighed && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.faint }}>{d.outKg == null ? '—' : num(d.outKg)}</TableCell>}
                {weighed && <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{d.closingKg == null ? '—' : num(d.closingKg)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      <TablePagination component="div" count={days.length} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[15, 30, 60, 100]} labelRowsPerPage="Days per page:" />
    </Panel>
  );
};

/** Every ledger row for this one item. */
const ItemMovements = ({ skuCode }) => {
  const { data, isFetching } = useGetRmMovementsQuery({ search: skuCode, limit: 200 });
  const rows = data?.data || [];
  return (
    <Panel title="Every movement for this item" hint={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} — each one a receipt, an issue, a cut or a correction.`}>
      <TableScroll>
        <Table size="small" sx={imsTableSx(1000)}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
              <TableCell><Th label="Movement no" hint={H.movementNumber} /></TableCell>
              <TableCell><Th label="What happened" hint={H.movementType} /></TableCell>
              <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
              <TableCell align="right"><Th label="Balance after" hint={H.balanceAfter} /></TableCell>
              <TableCell>Batch</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !rows.length && (
              <TableRow><TableCell colSpan={9} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={180} /></TableCell></TableRow>
            )}
            {!isFetching && !rows.length && (
              <TableRow><TableCell colSpan={9} sx={{ border: 0 }}>
                <EmptyNote icon={HistoryIcon} title="Nothing recorded for this item yet"
                  hint="The first Stock In, Stock Out or coil cut you record will appear here." />
              </TableCell></TableRow>
            )}
            {rows.map((m, i) => (
              <TableRow key={m._id} hover>
                <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.74rem' }}>{dayjs(m.movementDate).format('DD MMM YYYY')}</TableCell>
                <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: O2D.sub }}>{m.movementNumber}</TableCell>
                <TableCell><MoveChip txnType={m.txnType} movementType={m.movementType} /></TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {m.movementType === 'IN' ? '+' : '−'}{num(m.quantity)}
                  {m.quantityKg != null && (
                    <Typography sx={{ fontSize: '0.6rem', color: O2D.faint }}>{num(m.quantityKg)} kg</Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(m.balanceAfter)}</TableCell>
                <TableCell sx={{ fontSize: '0.7rem', color: m.batchNo ? O2D.body : O2D.faint }}>{m.batchNo || '—'}</TableCell>
                <TableCell sx={{ fontSize: '0.7rem', color: O2D.sub, maxWidth: 200 }}>
                  <Typography noWrap sx={{ fontSize: 'inherit' }} title={m.remarks}>{m.refNumber || m.remarks || '—'}</Typography>
                </TableCell>
                <TableCell sx={{ fontSize: '0.7rem', color: O2D.sub }}>{m.performedByName || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
    </Panel>
  );
};

const RmImsItemDetail = () => {
  const { skuId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('history');
  const { data, isLoading } = useGetRmItemDetailQuery(skuId);
  const d = data?.data;

  const sku = d?.sku;
  const m = d?.metrics || {};
  const c = d?.consumption || {};
  const p = d?.procurement || {};
  const unit = sku ? uomOf({ unit: sku.unit, kind: sku.kind }) : '';

  if (isLoading || !d) {
    return (
      <RmShell icon={Layers} title="Item" subtitle="Loading item…" onBack={() => navigate("/rm-ims/stock")} backLabel="Back to the stock list">
        <Skeleton variant="rounded" height={340} />
      </RmShell>
    );
  }

  return (
    <RmShell
      icon={Layers}
      title={sku.skuName}
      subtitle={`${sku.skuCode}${sku.category ? ` · ${sku.category}` : ''} · ${sku.kind === 'CIRCLE' ? 'Circle' : 'Coil'} · counted in ${unit}`}
      onBack={() => navigate('/rm-ims/stock')}
      backLabel="Back to the stock list"
      actions={<Button size="small" variant="outlined" onClick={() => navigate('/rm-ims/stock')}
        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
        Edit planning policy
      </Button>}
    >
      {/* ── Identity + status ── */}
      <Paper elevation={0} sx={{ p: 1.25, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <KindChip kind={sku.kind} />
          <Chip size="small" label={`UOM ${unit}`} sx={{ height: 21, fontWeight: 700, fontSize: '0.68rem' }} />
          <StatusChip status={m.status} />
          {!m.hasPolicy && (
            <Tooltip arrow slotProps={O2D_TIP} title="No planning policy saved for this item. The levels below come from a system fallback, not from the client's own numbers.">
              <Chip size="small" label="No planning policy" sx={{ height: 21, fontWeight: 700, fontSize: '0.68rem', bgcolor: STOCK_TOKENS.LOW.tint, color: STOCK_TOKENS.LOW.color, cursor: 'help' }} />
            </Tooltip>
          )}
        </Stack>
      </Paper>

      {/* ── Stock ── */}
      <Panel title="Stock" hint="What is physically here, what is committed, and how long it lasts.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Total Available Quantity" value={`${dash(m.onHand)} ${unit}`}
            sub={sku.tracksWeight ? `${num(m.onHandKg)} kg recorded` : null}
            hint="How much is physically in the store right now." />
          <Metric label="Material In Transit" value={dash(m.inTransit)}
            sub={m.inTransitSource === 'PO' ? `from ${m.openPoCount} open PO${m.openPoCount > 1 ? 's' : ''}` : (m.inTransitSource === 'MANUAL' ? 'typed by hand' : null)}
            hint="Ordered and not yet received. Read from the open purchase orders; quantities already received sit in the stock on hand — or under Awaiting QC until their QC completes." />
          <Metric label="Awaiting QC" value={dash(m.awaitingQc)}
            sub={m.awaitingQcGrnNumbers?.length ? m.awaitingQcGrnNumbers.join(', ') : null}
            hint="Received on a completed GRN and waiting for Incoming QC — not usable yet. Only the accepted quantity is added to stock when the QC completes; the forecast counts it from the next day. Not part of in transit or on hand." />
          <Metric label="Booked Qty" value={dash(m.booked)} hint={H.booked} />
          <Metric label="Available %" value={m.availablePct == null ? '—' : `${m.availablePct}%`}
            hint="Total Available Quantity ÷ Max Level × 100 — the client's own formula." />
          <Metric label="Cover" value={m.daysCover == null ? '—' : `${num(m.daysCover)}d`}
            hint="Days the current stock lasts at the daily consumption rate. Blank when there is no rate." />
          <Metric label="Value" value={inr(m.stockValue)} hint={H.stockValue} />
        </Stack>
      </Panel>

      {/* ── Planning ── */}
      <Panel title="Planning" hint="Max Level = Daily Avg Consumption × Lead Time × Safety Factor.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Daily Consumption" value={c.today == null ? '—' : num(c.today)}
            sub={c.todayEvents ? `${c.todayEvents} issue${c.todayEvents > 1 ? 's' : ''} today` : 'nothing issued today'}
            hint="What was actually issued today. Not an average." />
          <Metric label="Daily Avg Consumption" value={dash(m.adc)}
            sub={m.adcSource === 'MEASURED' ? `measured over ${c.windowDays} days` : (m.adcSource === 'PLANNED' ? 'planned rate — no issues yet' : 'no rate set')}
            tone={m.adcSource === 'MEASURED' ? STOCK_TOKENS.OK.color : undefined}
            hint="The average issued per day over the last 90 days, measured from the ledger. Falls back to the planned rate for an item with no issue history." />
          <Metric label="Choose Current Consumption" value={d.policy?.consumptionMode || '—'}
            sub={d.policy ? `low ${num(d.policy.adcLow)} · normal ${num(d.policy.adcNormal)} · peak ${num(d.policy.adcPeak)}` : null}
            hint="Which planned rate this item is planned against." />
          <Metric label="Lead Time (From Indent to Receipt)" value={m.hasPolicy ? `${num(m.leadDays)}d` : 'Not configured'} hint={H.leadDays} />
          <Metric label="Safety Factor" value={m.hasPolicy ? `${num(m.safetyFactor)}×` : 'Not configured'} hint={H.safetyFactor} />
          <Metric label="Reorder at" value={dash(m.reorderPoint)} hint={H.reorderPoint} />
          <Metric label="Max Level" value={dash(m.maxLevel)}
            sub={m.maxLevelMode === 'MANUAL' ? `manual override — formula gives ${num(m.formulaMaxLevel)}` : 'calculated'}
            hint="Buy enough to bring stock back to this level." />
          <Metric label="MOQ" value={d.policy?.moq ? num(d.policy.moq) : '—'} hint={H.moq} />
          <Metric label="Reorder Quantity" value={dash(m.suggestedOrderQty)} hint={H.suggestedOrderQty} />
        </Stack>
      </Panel>

      {/* ── Procurement ── */}
      <Panel title="Procurement" hint="Where it is bought from, and what is currently on order.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Vendor Name" value={p.vendorName || '—'} />
          <Metric label="Rate" value={p.rate ? `${inr(p.rate)} / ${unit}` : '—'} />
          <Metric label="Open POs" value={dash(p.openPoCount)} sub={p.poNumbers?.length ? p.poNumbers.join(', ') : null} />
          <Metric label="Ordered" value={dash(p.orderedQty)} hint={H.poOrdered} />
          <Metric label="Received" value={dash(p.receivedQty)} hint={H.poReceived} />
          <Metric label="Pending" value={dash(p.pendingQty)} hint={H.poPending} />
          <Metric label="Expected" value={p.earliestExpectedAt ? dayjs(p.earliestExpectedAt).format('DD MMM YYYY') : '—'}
            sub={p.overduePoCount ? `${p.overduePoCount} overdue` : null}
            tone={p.overduePoCount ? STOCK_TOKENS.REORDER.color : undefined} />
        </Stack>
      </Panel>

      {/* ── Location ── */}
      <Panel title="Where it is" hint="The location each movement was recorded against. No rule is applied about whether job-work stock counts as available — that is still an open question.">
        {d.locations.length === 0 ? (
          <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>No stock recorded in any location yet.</Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {d.locations.map((l) => (
              <Metric key={l.warehouse} label={l.warehouse === 'JW001' ? 'JW001 — Job work' : (l.warehouse === 'PLG01' ? 'PLG01 — Plant' : l.warehouse)}
                value={`${num(l.qtyOnHand)} ${unit}`}
                sub={l.lastMovementAt ? `last moved ${dayjs(l.lastMovementAt).format('DD MMM YYYY')}` : null} />
            ))}
          </Stack>
        )}
      </Panel>

      {/* ── Movement summary ── */}
      <Panel title="Movement summary" hint="Lifetime totals per kind of movement. Scrap is not a stock movement — it is the weight a coil lost when it was cut.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {Object.entries(d.movementSummary.byTxn).map(([txn, v]) => (
            <Metric key={txn} label={txnLabel(txn)} value={num(v.qty)}
              sub={`${v.events} entr${v.events === 1 ? 'y' : 'ies'}${v.kg ? ` · ${num(v.kg)} kg` : ''}`} />
          ))}
          {sku.kind === 'COIL' && (
            <Metric label="Scrap" value={`${num(d.movementSummary.scrapKg)} kg`}
              sub={`across ${d.movementSummary.conversionCount} cut${d.movementSummary.conversionCount === 1 ? '' : 's'}`}
              hint="Coil weight minus circle weight, taken from the conversion records. It never becomes a stock movement and is never counted as consumption." />
          )}
          {Object.keys(d.movementSummary.byTxn).length === 0 && (
            <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>No movements recorded for this item yet.</Typography>
          )}
        </Stack>
      </Panel>

      <Paper elevation={0} sx={{ borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem' } }}>
          <Tab value="history" label="Day-by-day history" />
          <Tab value="movements" label="Every movement" />
        </Tabs>
      </Paper>

      {tab === 'history' && <StockHistory skuId={skuId} sku={sku} />}
      {tab === 'movements' && <ItemMovements skuCode={sku.skuCode} />}
    </RmShell>
  );
};

export default RmImsItemDetail;
