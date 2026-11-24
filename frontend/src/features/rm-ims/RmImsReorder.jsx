import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Button, Tooltip, TextField, MenuItem, InputAdornment, TablePagination, Chip,
} from '@mui/material';
import { ShoppingCart, Download, Copy, Check, CheckCircle2, Search, ArrowRight, IndianRupee, Disc3, CircleDashed, Layers, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  RmShell, Panel, TableScroll, RmKpiCard, RmKpiGrid, StatusChip, EmptyNote, Th, KindChip, uomOf,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr,
} from './rmImsMeta';
import { FLUENT, rmTableSx, statusEdgeSx, statusInk, headerBtnSx } from './rmFluent';
import { useGetRmReorderQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

// One sentence saying WHY this coil or circle is on the list.
const reasonFor = (r) => {
  if (r.status === 'OUT_OF_STOCK') return 'Nothing left in the store — production can stop at any moment.';
  const cover = r.daysCover;
  const lead = Number(r.leadDays || 0);
  if (cover != null && lead > 0 && cover < lead) {
    return `About ${num(cover)} days of stock left, but the vendor needs ${num(lead)} days to deliver.`;
  }
  if (cover != null) return `About ${num(cover)} days of stock left at the current rate of use.`;
  return 'On-hand has fallen to the reorder point.';
};

const KIND_FILTERS = [
  { value: 'ALL', label: 'All raw material' },
  { value: 'COIL', label: 'Coils only' },
  { value: 'CIRCLE', label: 'Circles only' },
];

// The two ranking cards. Each shows only the items that carry the figure, in
// descending order of it.
const RANKS = {
  UNITS: { label: 'Items with a quantity to order — largest first', key: 'suggestedOrderQty' },
  SPEND: { label: 'Items with an estimated spend — highest first', key: 'buyCost' },
};

const RmImsReorder = () => {
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState('ALL');
  // Which ranking card is active (kept in the URL so it survives a refresh).
  const [rank, setRank] = useState(() => (RANKS[params.get('rank')] ? params.get('rank') : null));
  const pickRank = (r) => {
    const next = rank === r ? null : r;   // clicking the active card turns it off
    setRank(next);
    if (next) params.set('rank', next); else params.delete('rank');
    setParams(params, { replace: true });
  };
  const showAll = () => { setKind('ALL'); setSearch(''); setRank(null); params.delete('rank'); setParams(params, { replace: true }); };
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Always fetch the whole list and filter coil/circle here. Filtering on the
  // server would make the Coils and Circles tiles count only what is already
  // showing — so the tile you have not picked would always read zero.
  const { data, isFetching } = useGetRmReorderQuery({});
  const rows = useMemo(() => data?.data || [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows
      .filter((r) => (kind === 'ALL' || r.kind === kind)
        && (!q || `${r.skuCode || ''} ${r.skuName || ''} ${r.vendorName || ''}`.toLowerCase().includes(q))
        && (!rank || Number(r[RANKS[rank].key] || 0) > 0));
    if (rank) {
      const k = RANKS[rank].key;
      return list.sort((a, b) => Number(b[k] || 0) - Number(a[k] || 0));
    }
    // Worst first, then tightest cover — the order a buyer works in.
    return list.sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
      || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  }, [rows, search, kind, rank]);

  useEffect(() => { setPage(0); }, [search, kind, rank, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  // What the filtered table adds up to (the summary line, the copy and the export)…
  const totalQty = filtered.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);
  const totalSpend = filtered.reduce((s, r) => s + Number(r.buyCost || 0), 0);
  // …and what the whole list holds (the KPI cards — they never change as you filter).
  const listQty = rows.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);
  const listSpend = rows.reduce((s, r) => s + Number(r.buyCost || 0), 0);
  const qtyItems = rows.filter((r) => Number(r.suggestedOrderQty || 0) > 0).length;
  const spendItems = rows.filter((r) => Number(r.buyCost || 0) > 0).length;
  const coilCount = rows.filter((r) => r.kind === 'COIL').length;
  const circleCount = rows.filter((r) => r.kind === 'CIRCLE').length;

  const exportCsv = () => {
    const header = [
      'SKU Code', 'Item Name', 'Material', 'UOM', 'Total Available Quantity', 'Material In Transit',
      'Days cover', 'Reorder at', 'Max Level', 'Reorder Quantity', 'MOQ', 'Rate', 'Estimated spend',
      'Vendor Name', 'Status', 'Why',
    ];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.kind === 'CIRCLE' ? 'Circle' : 'Coil', uomOf(r),
      r.onHand, r.inTransit, r.daysCover ?? '', r.reorderPoint, r.maxLevel, r.suggestedOrderQty, r.moq,
      r.rate, r.buyCost, r.vendorName, stockToken(r.status).label, reasonFor(r),
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `raw-material-buying-list_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Plain text for an email or message to the supplier — grouped by vendor,
  // because that is how a purchase enquiry actually goes out.
  const copyList = async () => {
    const byVendor = filtered.reduce((m, r) => {
      const v = r.vendorName || 'No vendor recorded';
      (m[v] = m[v] || []).push(r);
      return m;
    }, {});
    const text = [
      `Raw material purchase requirement (${dayjs().format('DD MMM YYYY')})`,
      '',
      ...Object.entries(byVendor).flatMap(([vendor, list]) => [
        `— ${vendor} —`,
        ...list.map((r, i) => `${i + 1}. ${r.skuName} (${r.skuCode}, ${r.kind === 'COIL' ? 'coil' : 'circle'}) — order ${num(r.suggestedOrderQty)} · in store ${num(r.onHand)}`),
        '',
      ]),
      `Total: ${filtered.length} item(s), ${num(totalQty)} units${totalSpend ? `, estimated ${inr(totalSpend)}` : ''}.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 2200);
      enqueueSnackbar('Buying list copied — paste it into an email or message.', { variant: 'success' });
    } catch { enqueueSnackbar('Could not copy. Use Export instead.', { variant: 'error' }); }
  };

  return (
    <RmShell
      icon={ShoppingCart}
      title="Buying List"
      subtitle="Coils and circles at or below their reorder point, with how much to order — worst first."
      actions={rows.length > 0 && (
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="outlined" startIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyList}
            sx={{ ...headerBtnSx, color: copied ? STOCK_TOKENS.OK.color : O2D.body }}>
            {copied ? 'Copied' : 'Copy as text'}
          </Button>
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv}
            sx={headerBtnSx}>
            Export
          </Button>
        </Stack>
      )}
    >
      <RmKpiGrid>
        <RmKpiCard label="Items to order" value={num(rows.length)} sub="Everything on this list today"
          tone={rows.length ? FLUENT.orange : FLUENT.teal} icon={ShoppingCart}
          actionLabel="Show all" onClick={showAll} hint="Show every item on the buying list." />
        <RmKpiCard label="Coils" value={num(coilCount)} sub="Uncut raw metal" tone={FLUENT.teal} icon={Disc3}
          actionLabel="Filter" active={kind === 'COIL'} onClick={() => setKind(kind === 'COIL' ? 'ALL' : 'COIL')}
          hint="Show coils only." />
        <RmKpiCard label="Circles" value={num(circleCount)} sub="Cut and ready" tone={FLUENT.lavender} icon={CircleDashed}
          actionLabel="Filter" active={kind === 'CIRCLE'} onClick={() => setKind(kind === 'CIRCLE' ? 'ALL' : 'CIRCLE')}
          hint="Show circles only." />
        <RmKpiCard label="Units to order" value={num(listQty)} sub={`Across ${num(qtyItems)} item${qtyItems === 1 ? '' : 's'}`}
          tone={FLUENT.blue} icon={ArrowRight} actionLabel="Rank" active={rank === 'UNITS'} onClick={() => pickRank('UNITS')}
          hint="Show the items with a quantity to order, largest order first." />
        <RmKpiCard label="Estimated spend" value={inr(listSpend)} sub={`At the recorded rates · ${num(spendItems)} item${spendItems === 1 ? '' : 's'}`}
          tone={FLUENT.grey} icon={IndianRupee} actionLabel="Rank" active={rank === 'SPEND'} onClick={() => pickRank('SPEND')}
          hint="Show the items with an estimated spend, highest first." />
      </RmKpiGrid>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this list by item, code or vendor…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
            <TextField select size="small" label="Material" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 175 }}>
              {KIND_FILTERS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
            </TextField>
            {rank && (
              <Chip size="small" label={`Showing: ${RANKS[rank].label}`} onDelete={() => pickRank(rank)} deleteIcon={<X size={13} />}
                sx={{ height: 26, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            )}
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
              <b>{filtered.length}</b> of {rows.length} · <b>{num(totalQty)}</b> units
            </Typography>
          </Stack>
        </Paper>
      )}

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={rmTableSx(1560)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell>Material</TableCell>
                <TableCell>Why it's here</TableCell>
                <TableCell align="right"><Th label="Total Available Quantity" hint={H.onHand} /></TableCell>
                <TableCell align="right"><Th label="Material In Transit" hint={H.inTransit} /></TableCell>
                <TableCell align="right"><Th label="Cover" hint={H.daysCover} /></TableCell>
                <TableCell align="right"><Th label="Reorder at" hint={H.reorderPoint} /></TableCell>
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="right"><Th label="Reorder Quantity" hint={H.suggestedOrderQty} /></TableCell>
                <TableCell align="right"><Th label="Estimated spend" hint={H.buyCost} /></TableCell>
                <TableCell><Th label="Vendor Name" hint={H.vendorName} /></TableCell>
                <TableCell><Th label="Status" hint={H.status} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={14} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
              )}
              {!isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={14} sx={{ border: 0 }}>
                  <EmptyNote icon={CheckCircle2} title="Nothing to buy right now"
                    hint="Every coil and circle is comfortably above its reorder point. This list fills itself as material is consumed."
                    tone={STOCK_TOKENS.OK.color} />
                </TableCell></TableRow>
              )}
              {!isFetching && rows.length > 0 && filtered.length === 0 && (
                <TableRow><TableCell colSpan={14} sx={{ border: 0 }}>
                  <EmptyNote icon={Search} title="No items match your search"
                    hint="Clear the search box or switch back to all raw material." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                return (
                  // Coloured left edge only — on this screen every row is a
                  // problem, so tinting them all would carry no signal.
                  <TableRow key={r.skuId} hover data-status={r.status} sx={{ ...statusEdgeSx(r.status) }}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontSize: '0.73rem', color: O2D.body, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>{uomOf(r)}</Typography>
                    </TableCell>
                    <TableCell><KindChip kind={r.kind} /></TableCell>
                    <TableCell sx={{ minWidth: 260, maxWidth: 320 }}>
                      <Typography sx={{ fontSize: '0.73rem', color: statusInk(r.status), fontWeight: 600 }}>{reasonFor(r)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inTransit ? O2D.body : O2D.faint }}>
                      {r.inTransit ? num(r.inTransit) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.daysCover == null ? '—' : `${num(r.daysCover)}d`}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right">
                      <Tooltip arrow slotProps={O2D_TIP}
                        title={r.moq ? `The supplier's minimum order quantity is ${num(r.moq)}.` : 'No minimum order quantity recorded for this item.'}>
                        <Box sx={{ display: 'inline-block', cursor: 'help' }}>
                          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: O2D.brand, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                            {num(r.suggestedOrderQty)}
                          </Typography>
                          {r.moq > 0 && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>min {num(r.moq)}</Typography>}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {r.buyCost ? (
                        <>
                          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink, lineHeight: 1.15 }}>{inr(r.buyCost)}</Typography>
                          {r.rate > 0 && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>at {inr(r.rate)}/{uomOf(r)}</Typography>}
                        </>
                      ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>No rate set</Typography>}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 150 }}>
                      <Typography noWrap sx={{ fontSize: '0.73rem', color: r.vendorName ? O2D.body : O2D.faint }} title={r.vendorName}>
                        {r.vendorName || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        {filtered.length > 0 && (
          <TablePagination
            component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[25, 50, 100, 200]} labelRowsPerPage="Items per page:"
            sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
          />
        )}
      </Panel>

      {rows.length > 0 && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 0.5 }}>
          <Layers size={13} color={O2D.faint} />
          <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
            Quantities are worked out as the <b>Max Level</b> minus what is on hand and already in transit, then rounded up to
            the supplier's MOQ where one is recorded. Adjust an item's Daily Avg Consumption, Lead Time or
            Safety Factor from the Stock list to change what appears here.
          </Typography>
        </Stack>
      )}
    </RmShell>
  );
};

export default RmImsReorder;
