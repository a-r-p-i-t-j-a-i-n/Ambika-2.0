import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Button, Tooltip, TextField, MenuItem, InputAdornment, TablePagination,
} from '@mui/material';
import { ShoppingCart, Download, Copy, Check, CheckCircle2, Search, ArrowRight, IndianRupee, Disc3, CircleDashed, Layers } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  RmShell, Panel, TableScroll, KpiTile, StatusChip, EmptyNote, Th, KindChip,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr, imsTableSx,
} from './rmImsMeta';
import { useGetRmReorderQuery } from '../../store/api/rmImsApi';

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

const RmImsReorder = () => {
  const [kind, setKind] = useState('ALL');
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
    return rows
      .filter((r) => (kind === 'ALL' || r.kind === kind)
        && (!q || `${r.skuCode || ''} ${r.skuName || ''} ${r.vendorName || ''}`.toLowerCase().includes(q)))
      // Worst first, then tightest cover — the order a buyer works in.
      .sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
        || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  }, [rows, search, kind]);

  useEffect(() => { setPage(0); }, [search, kind, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const totalQty = filtered.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);
  const totalSpend = filtered.reduce((s, r) => s + Number(r.buyCost || 0), 0);
  const coilCount = rows.filter((r) => r.kind === 'COIL').length;
  const circleCount = rows.filter((r) => r.kind === 'CIRCLE').length;

  const exportCsv = () => {
    const header = ['Code', 'Item', 'Kind', 'On hand', 'Days cover', 'Order up to', 'Order this much', 'Rate', 'Estimated spend', 'Vendor', 'Status', 'Why'];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.kind, r.onHand, r.daysCover ?? '', r.maxLevel, r.suggestedOrderQty,
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
      title="Buying list"
      subtitle="Coils and circles at or below their reorder point, with how much to order — worst first."
      actions={rows.length > 0 && (
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="outlined" startIcon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyList}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: copied ? STOCK_TOKENS.OK.color : O2D.body }}>
            {copied ? 'Copied' : 'Copy as text'}
          </Button>
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Export
          </Button>
        </Stack>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Items to order" value={num(rows.length)} sub="On this list today"
          color={rows.length ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color} icon={ShoppingCart} />
        <KpiTile label="Coils" value={num(coilCount)} sub="Uncut raw metal" color="#0f766e" icon={Disc3}
          active={kind === 'COIL'} onClick={() => setKind(kind === 'COIL' ? 'ALL' : 'COIL')} />
        <KpiTile label="Circles" value={num(circleCount)} sub="Cut and ready" color="#4338ca" icon={CircleDashed}
          active={kind === 'CIRCLE'} onClick={() => setKind(kind === 'CIRCLE' ? 'ALL' : 'CIRCLE')} />
        <KpiTile label="Units to order" value={num(totalQty)} sub="Total across the list" color={O2D.brand} icon={ArrowRight} />
        <KpiTile label="Estimated spend" value={inr(totalSpend)} sub="At the recorded rates" color="#7c3aed" icon={IndianRupee} />
      </Stack>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this list by item, code or vendor…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
            <TextField select size="small" label="Material" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 175 }}>
              {KIND_FILTERS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
            </TextField>
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
              <b>{filtered.length}</b> of {rows.length} · <b>{num(totalQty)}</b> units
            </Typography>
          </Stack>
        </Paper>
      )}

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1120)}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell>Material</TableCell>
                <TableCell>Why it's here</TableCell>
                <TableCell align="right">In store</TableCell>
                <TableCell align="right"><Th label="Cover" hint="Days the current stock lasts at the planned rate of use." /></TableCell>
                <TableCell align="right"><Th label="Order up to" hint="The level we buy back up to." /></TableCell>
                <TableCell align="right"><Th label="Order this much" hint="Enough to bring stock back to the order-up-to level." /></TableCell>
                <TableCell align="right"><Th label="Estimated spend" hint="Order quantity × the rate saved on the item's policy." /></TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
              )}
              {!isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={CheckCircle2} title="Nothing to buy right now"
                    hint="Every coil and circle is comfortably above its reorder point. This list fills itself as material is consumed."
                    tone={STOCK_TOKENS.OK.color} />
                </TableCell></TableRow>
              )}
              {!isFetching && rows.length > 0 && filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={Search} title="No items match your search"
                    hint="Clear the search box or switch back to all raw material." />
                </TableCell></TableRow>
              )}
              {paged.map((r) => {
                const t = stockToken(r.status);
                return (
                  // Coloured left edge only — on this screen every row is a
                  // problem, so tinting them all would carry no signal.
                  <TableRow key={r.skuId} hover sx={{ borderLeft: `3px solid ${t.color}` }}>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                    </TableCell>
                    <TableCell><KindChip kind={r.kind} /></TableCell>
                    <TableCell sx={{ maxWidth: 270 }}>
                      <Typography sx={{ fontSize: '0.73rem', color: t.color, fontWeight: 600 }}>{reasonFor(r)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.daysCover == null ? '—' : `${num(r.daysCover)}d`}</TableCell>
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
                          {r.rate > 0 && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>at {inr(r.rate)}/unit</Typography>}
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
            Quantities are worked out as <b>order up to</b> minus what is on hand and already in transit, then rounded up to
            the supplier's minimum order quantity where one is recorded. Adjust an item's daily consumption, lead time or
            safety factor from the Stock list to change what appears here.
          </Typography>
        </Stack>
      )}
    </RmShell>
  );
};

export default RmImsReorder;
