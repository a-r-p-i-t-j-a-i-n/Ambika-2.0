import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Button, Tooltip, TextField, MenuItem, InputAdornment, TablePagination, Chip,
} from '@mui/material';
import { ShoppingCart, Download, Copy, Check, CheckCircle2, Search, Boxes, ArrowRight, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  ImsShell, Panel, TableScroll, KpiCard, KpiGrid, StatusChip, EmptyNote, Th,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, imsTableSx,
} from './imsMeta';
import { useGetImsReorderQuery } from '../../store/api/imsApi';
import { FIELD } from './imsFieldHelp';

const H = FIELD.ims;

// What each KPI card filters the list to. 'ALL' is the whole list.
//   OUT_OF_STOCK / REORDER  — that status only
//   UNITS                   — items with a quantity to order, largest first
const KPI_FILTERS = {
  ALL: 'All items on the list',
  OUT_OF_STOCK: 'Out of stock',
  REORDER: 'At reorder point',
  UNITS: 'Items with a quantity to order — largest first',
};

// One sentence saying WHY this item is on the list. A number in a "days cover"
// column is data; this is the reason a buyer can act on without interpreting.
const reasonFor = (r) => {
  if (r.status === 'OUT_OF_STOCK') return 'Nothing left in the store — production can stop at any moment.';
  const cover = r.daysCover;
  const lead = Number(r.leadDays || 0);
  if (cover != null && lead > 0 && cover < lead) {
    return `About ${num(cover)} days of stock left, but the vendor needs ${num(lead)} days to deliver.`;
  }
  if (cover != null) return `About ${num(cover)} days of stock left at the current rate of use.`;
  return 'Closing Stock has fallen to the reorder point.';
};

const ImsReorder = () => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetImsReorderQuery({});
  const rows = useMemo(() => data?.data || [], [data]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [params, setParams] = useSearchParams();
  // Which KPI card is filtering the list (kept in the URL, so it survives a refresh).
  const [kpi, setKpi] = useState(() => (KPI_FILTERS[params.get('show')] ? params.get('show') : 'ALL'));
  const pickKpi = (k) => {
    const next = kpi === k ? 'ALL' : k;   // clicking the active card turns it off
    setKpi(next);
    if (next === 'ALL') params.delete('show'); else params.set('show', next);
    setParams(params, { replace: true });
  };
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows
      .filter((r) => (!category || r.category === category)
        && (!q || `${r.skuCode || ''} ${r.skuName || ''} ${r.category || ''}`.toLowerCase().includes(q))
        && (kpi === 'ALL' || kpi === 'UNITS' || r.status === kpi)
        && (kpi !== 'UNITS' || Number(r.suggestedOrderQty || 0) > 0));
    // The Units card ranks by how much to order; everything else is worst first,
    // then by the tightest cover — the order a buyer would work in.
    return kpi === 'UNITS'
      ? list.sort((a, b) => Number(b.suggestedOrderQty || 0) - Number(a.suggestedOrderQty || 0))
      : list.sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
        || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  }, [rows, search, category, kpi]);

  // Page resets whenever the result set changes, so you never land on an empty page.
  useEffect(() => { setPage(0); }, [search, category, kpi, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  // What the filtered table adds up to (the summary line, the copy and the export)…
  const totalSuggested = filtered.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);
  // …and what the whole list holds (the KPI cards — they never change as you filter).
  const listSuggested = rows.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);
  const outCount = rows.filter((r) => r.status === 'OUT_OF_STOCK').length;
  const reorderCount = rows.filter((r) => r.status === 'REORDER').length;
  const unitsItems = rows.filter((r) => Number(r.suggestedOrderQty || 0) > 0).length;

  const exportCsv = () => {
    // "Available Qty" is what the column is called on every IMS screen; the
    // export used to call the same number "Closing Stock".
    const header = ['SKU Code', 'Item Name', 'Category', 'Available Qty', 'Material In Transit', 'Reorder at', 'Max Level', 'Days cover', 'Reorder Quantity', 'MOQ', 'Status', 'Why'];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.category, r.onHand, r.inTransit, r.reorderPoint, r.maxLevel,
      r.daysCover ?? '', r.suggestedOrderQty, r.moq, stockToken(r.status).label, reasonFor(r),
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `buying-list_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // A plain-text version to paste straight into an email or a message to the
  // supplier — the way purchase requests actually leave most factories.
  const copyList = async () => {
    const text = [
      `Purchase requirement — consumables & packaging (${dayjs().format('DD MMM YYYY')})`,
      '',
      ...filtered.map((r, i) => `${i + 1}. ${r.skuName} (${r.skuCode}) — order ${num(r.suggestedOrderQty)}${r.moq ? ` (min ${num(r.moq)})` : ''} · in store ${num(r.onHand)}`),
      '',
      `Total: ${filtered.length} item(s), ${num(totalSuggested)} units.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 2200);
      enqueueSnackbar('Buying list copied — paste it into an email or message.', { variant: 'success' });
    } catch { enqueueSnackbar('Could not copy. Use Export instead.', { variant: 'error' }); }
  };

  return (
    <ImsShell
      icon={ShoppingCart}
      title="Buying List"
      subtitle="Everything at or below its reorder point, with how much to order — worst first."
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
      <KpiGrid>
        <KpiCard label="Items to order" value={num(rows.length)} sub="Everything on this list today"
          color={rows.length ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color} icon={ShoppingCart}
          actionLabel="Show all" onClick={() => pickKpi(kpi)}
          hint="Show every item on the buying list." />
        <KpiCard label="Out of stock" value={num(outCount)} sub="Order these first"
          color={STOCK_TOKENS.OUT_OF_STOCK.color} icon={Boxes}
          actionLabel="Filter" active={kpi === 'OUT_OF_STOCK'} onClick={() => pickKpi('OUT_OF_STOCK')}
          hint="Show only the items with nothing left in the store." />
        <KpiCard label="At reorder point" value={num(reorderCount)} sub="Due for a purchase order"
          color={STOCK_TOKENS.REORDER.color} icon={ShoppingCart}
          actionLabel="Filter" active={kpi === 'REORDER'} onClick={() => pickKpi('REORDER')}
          hint="Show only the items at or below their reorder point." />
        <KpiCard label="Units to order" value={num(listSuggested)}
          sub={`Across ${num(unitsItems)} item${unitsItems === 1 ? '' : 's'}`}
          color={O2D.brand} icon={ArrowRight}
          actionLabel="Rank" active={kpi === 'UNITS'} onClick={() => pickKpi('UNITS')}
          hint="Show the items with a quantity to order, largest order first." />
      </KpiGrid>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this list…" sx={{ minWidth: { xs: '100%', sm: 240 }, flex: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
            <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            {kpi !== 'ALL' && (
              <Chip size="small" label={`Showing: ${KPI_FILTERS[kpi]}`} onDelete={() => pickKpi(kpi)}
                deleteIcon={<X size={13} />}
                sx={{ height: 26, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            )}
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
              <b>{filtered.length}</b> of {rows.length} · <b>{num(totalSuggested)}</b> units
            </Typography>
          </Stack>
        </Paper>
      )}

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1040)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell>Why it's here</TableCell>
                <TableCell align="right">Available Qty</TableCell>
                <TableCell align="right"><Th label="Material In Transit" hint={H.inTransit} /></TableCell>
                <TableCell align="right"><Th label="Reorder at" hint={H.reorderPoint} /></TableCell>
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="right"><Th label="Reorder Quantity" hint={H.suggestedOrderQty} /></TableCell>
                <TableCell align="center"><Th label="Status" hint={H.status} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={220} /></TableCell></TableRow>
              )}
              {!isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={CheckCircle2} title="Nothing to buy right now"
                    hint="Every item is comfortably above its reorder point. This list fills itself as stock is issued to production."
                    tone={STOCK_TOKENS.OK.color} />
                </TableCell></TableRow>
              )}
              {!isFetching && rows.length > 0 && filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={Search} title={kpi !== 'ALL' ? `No items match “${KPI_FILTERS[kpi]}”` : 'No items match your search'}
                    hint={kpi !== 'ALL' ? 'Click the highlighted card again, or clear the search and category.' : 'Clear the search box or pick a different category.'} />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                const t = stockToken(r.status);
                return (
                  // No row wash here. On this screen EVERY row is a problem, so
                  // tinting them all is noise — the coloured left edge plus the
                  // status chip carry the severity on their own.
                  <TableRow key={r.skuId} hover sx={{
                    cursor: 'pointer', borderLeft: `3px solid ${t.color}`,
                  }} onClick={() => navigate(`/ims/item/${r.skuId}`)}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: O2D.brand, whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 230 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }}>{r.category || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography sx={{ fontSize: '0.73rem', color: t.color, fontWeight: 600 }}>{reasonFor(r)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inTransit ? O2D.body : O2D.faint }}>{r.inTransit ? num(r.inTransit) : '—'}</TableCell>
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
                    <TableCell align="center"><StatusChip status={r.status} /></TableCell>
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
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, px: 0.5 }}>
          Quantities are worked out as <b>order up to</b> minus what is on hand and already in transit, then rounded up to the
          supplier's minimum order quantity where one is recorded. Adjust an item's daily use, lead time or safety factor from
          its detail page to change what appears here.
        </Typography>
      )}
    </ImsShell>
  );
};

export default ImsReorder;
