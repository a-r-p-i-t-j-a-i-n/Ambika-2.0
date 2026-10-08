import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Button, Tooltip, TextField, MenuItem, InputAdornment, TablePagination,
} from '@mui/material';
import { Factory, Download, Copy, Check, CheckCircle2, Search, Boxes, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  FgShell, Panel, TableScroll, KpiTile, StatusChip, EmptyNote, Th,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, num, imsTableSx, FG_ACCENT, FG_STATUS_LABEL,
} from './fgImsMeta';
import { useGetFgReplenishQuery } from '../../store/api/fgImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.fg;

const fgStatusLabel = (k) => FG_STATUS_LABEL[k] || STOCK_TOKENS[k]?.label || k;

// One sentence saying WHY this item is on the plan. A number in a "days cover"
// column is data; this is the reason a planner can act on without interpreting.
const reasonFor = (r) => {
  if (r.status === 'OUT_OF_STOCK') return 'Nothing left in the store — orders cannot be filled.';
  const cover = r.daysCover;
  const lead = Number(r.leadDays || 0);
  if (cover != null && lead > 0 && cover < lead) {
    return `About ${num(cover)} days of stock left, but a production run takes ${num(lead)} days.`;
  }
  if (cover != null) return `About ${num(cover)} days of stock left at the current rate of demand.`;
  return 'Projected Available has fallen to the Reorder At level.';
};

// Production Plan — finished goods at/below reorder point with the quantity to
// produce to refill up to the Max Level.
const FgImsPlanning = () => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetFgReplenishQuery({});
  const rows = useMemo(() => data?.data || [], [data]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (!category || r.category === category)
        && (!q || `${r.skuCode || ''} ${r.skuName || ''} ${r.category || ''}`.toLowerCase().includes(q)))
      // Worst first, then by the tightest cover — the order a planner works in.
      .sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
        || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  }, [rows, search, category]);

  // Page resets whenever the result set changes, so you never land on an empty page.
  useEffect(() => { setPage(0); }, [search, category, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const totalToProduce = filtered.reduce((s, r) => s + Number(r.suggestedProduceQty || 0), 0);
  const outCount = rows.filter((r) => r.status === 'OUT_OF_STOCK').length;
  const reorderCount = rows.filter((r) => r.status === 'REORDER').length;

  // A plain-text version to paste straight into a message to the production
  // floor — the way a run list actually leaves most planning desks.
  const copyList = async () => {
    const text = [
      `Production requirement — finished goods (${dayjs().format('DD MMM YYYY')})`,
      '',
      ...filtered.map((r, i) => `${i + 1}. ${r.skuName} (${r.skuCode}) — produce ${num(r.suggestedProduceQty)}${r.moq ? ` (min batch ${num(r.moq)})` : ''} · in stock ${num(r.onHand)}`),
      '',
      `Total: ${filtered.length} item(s), ${num(totalToProduce)} units.`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 2200);
      enqueueSnackbar('Production plan copied — paste it into an email or message.', { variant: 'success' });
    } catch { enqueueSnackbar('Could not copy. Use Export instead.', { variant: 'error' }); }
  };

  const exportCsv = () => {
    const header = ['SKU Code', 'Finished Good', 'Category', 'Available Qty', 'In Production (WIP)', 'Booked (Committed Orders)',
      'Projected Available', 'Reorder At', 'Max Level', 'Days Cover', 'Production Quantity', 'MOQ', 'Status', 'Why'];
    const lines = filtered.map((r) => [r.skuCode, r.skuName, r.category, r.onHand, r.inProduction, r.booked,
      r.projectedAvailable, r.reorderPoint, r.maxLevel, r.daysCover ?? '', r.suggestedProduceQty, r.moq,
      fgStatusLabel(r.status), reasonFor(r)]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `fg-production-plan_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <FgShell
      icon={Factory}
      title="Production Plan"
      subtitle="Everything at or below its Reorder At level, with how much to produce — worst first."
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
        <KpiTile label="Items to produce" value={num(rows.length)} sub="On this plan today"
          color={rows.length ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color} icon={Factory} />
        <KpiTile label="Out of stock" value={num(outCount)} sub="Produce these first"
          color={STOCK_TOKENS.OUT_OF_STOCK.color} icon={Boxes} />
        <KpiTile label="At reorder level" value={num(reorderCount)} sub="Due for a production run"
          color={STOCK_TOKENS.REORDER.color} icon={Factory} />
        <KpiTile label="Units to produce" value={num(totalToProduce)} sub="Total across the plan"
          color={FG_ACCENT} icon={ArrowRight} />
      </Stack>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this plan…" sx={{ minWidth: { xs: '100%', sm: 240 }, flex: 1 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
            <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
              <b>{filtered.length}</b> of {rows.length} · <b>{num(totalToProduce)}</b> units
            </Typography>
          </Stack>
        </Paper>
      )}

      <Panel dense>
        <TableScroll>
          {/* Wide enough that the extra "Why it's here" column scrolls rather
              than crushing the SKU code and reason text into stacks. */}
          <Table size="small" sx={imsTableSx(1560)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Finished Good" hint={H.skuName} /></TableCell>
                <TableCell>Why it&apos;s here</TableCell>
                <TableCell align="right"><Th label="Available Qty" hint={H.onHand} /></TableCell>
                <TableCell align="right"><Th label="In Production (WIP)" hint={H.inProduction} /></TableCell>
                <TableCell align="right"><Th label="Booked (Committed Orders)" hint={H.booked} /></TableCell>
                <TableCell align="right"><Th label="Projected Available" hint={H.projectedAvailable} /></TableCell>
                <TableCell align="right"><Th label="Reorder At" hint={H.reorderPoint} /></TableCell>
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="right"><Th label="Days Cover" hint={H.daysCover} /></TableCell>
                <TableCell align="right"><Th label="Production Quantity" hint={H.suggestedProduceQty} /></TableCell>
                <TableCell align="center"><Th label="Status" hint={H.status} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={220} /></TableCell></TableRow>
              )}
              {!isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0 }}>
                  <EmptyNote icon={CheckCircle2} title="Nothing to produce right now"
                    hint="Every finished good is comfortably above its Reorder At level. This plan fills itself as stock is dispatched."
                    tone={STOCK_TOKENS.OK.color} />
                </TableCell></TableRow>
              )}
              {!isFetching && rows.length > 0 && filtered.length === 0 && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0 }}>
                  <EmptyNote icon={Search} title="No items match your search"
                    hint="Clear the search box or pick a different category." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                const t = STOCK_TOKENS[r.status] || STOCK_TOKENS.OK;
                const tightCover = r.daysCover != null && r.daysCover < r.leadDays;
                return (
                  // No row wash here. On this screen EVERY row is a problem, so
                  // tinting them all is noise — the coloured left edge plus the
                  // status chip carry the severity on their own.
                  <TableRow key={r.skuId} hover sx={{
                    cursor: 'pointer', borderLeft: `3px solid ${t.color}`,
                  }} onClick={() => navigate(`/fg-ims/item/${r.skuId}`)}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: FG_ACCENT, whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 230 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }}>{r.category || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 260, maxWidth: 320 }}>
                      <Typography sx={{ fontSize: '0.73rem', color: t.color, fontWeight: 600 }}>{reasonFor(r)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inProduction ? O2D.body : O2D.faint }}>{r.inProduction ? num(r.inProduction) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.booked ? O2D.body : O2D.faint }}>{r.booked ? num(r.booked) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: O2D.ink }}>{num(r.projectedAvailable)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: tightCover ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.body,
                    }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip arrow slotProps={O2D_TIP}
                        title={r.moq ? `The minimum production batch for this item is ${num(r.moq)}.` : 'No minimum production batch recorded for this item.'}>
                        <Box sx={{ display: 'inline-block', cursor: 'help' }}>
                          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: FG_ACCENT, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                            {num(r.suggestedProduceQty)}
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
          Quantities are worked out as the <b>Max Level</b> minus what is on hand and already in production, less what is
          booked to customer orders, then raised to the minimum production batch where one is recorded. Adjust an item&apos;s
          seasonal demand, Lead Time or Safety Factor from its detail page to change what appears here.
        </Typography>
      )}
    </FgShell>
  );
};

export default FgImsPlanning;
