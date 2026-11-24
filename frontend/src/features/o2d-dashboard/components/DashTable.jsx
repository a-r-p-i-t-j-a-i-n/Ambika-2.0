// ── The design's list table: search, CSV, sortable headers, numbered pages ──
import React, { useMemo, useState } from 'react';
import { Box, Button, ButtonBase, InputBase, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { T } from '../dashTheme';
import { downloadCsv } from '../format';
import { MiniSelect } from './DashUi';

const PAGE_SIZES = [5, 8, 10, 25, 50];

// 1 … 4 5 6 … 12 — at most seven buttons.
const pageList = (page, count) => {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const set = new Set([0, count - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < count));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
};

const pageBtnSx = (on) => ({
  minWidth: 28, height: 28, px: 0.75, borderRadius: '8px', fontSize: 12.5, fontWeight: 600,
  border: `1px solid ${on ? T.brand : T.border}`, bgcolor: on ? T.brand : '#fff', color: on ? '#fff' : T.text2,
  '&.Mui-disabled': { opacity: 0.45 },
});

/**
 * columns: [{ key, label, align, width, sortValue(row), render(row), csv(row) }]
 * csvColumns — what the CSV gets, when it differs from the columns on screen.
 * `resetKey` — when it changes (a new filter) the table goes back to page 1.
 */
const DashTable = ({
  columns, csvColumns, rows, rowKey, onRowClick, searchText, searchPlaceholder, exportName,
  defaultSort, defaultPageSize = 8, emptyText = 'Nothing to show', resetKey = '',
}) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(defaultSort || { key: null, dir: 'asc' });
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [pageState, setPageState] = useState({ page: 0, key: resetKey });
  // A new filter starts again from page 1.
  const page = pageState.key === resetKey ? pageState.page : 0;
  const setPage = (p) => setPageState({ page: p, key: resetKey });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? rows.filter((r) => String(searchText(r) || '').toLowerCase().includes(q)) : rows;
    const col = columns.find((c) => c.key === sort.key);
    if (col?.sortValue) {
      const dir = sort.dir === 'desc' ? -1 : 1;
      list = [...list].sort((a, b) => {
        const x = col.sortValue(a);
        const y = col.sortValue(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    return list;
  }, [rows, query, sort, columns, searchText]);

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(current * pageSize, (current + 1) * pageSize);
  const from = shown.length ? current * pageSize + 1 : 0;
  const to = Math.min(shown.length, (current + 1) * pageSize);

  const toggleSort = (col) => {
    if (!col.sortValue) return;
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, height: 34, width: { xs: '100%', sm: 340 }, border: `1px solid ${T.border}`, borderRadius: '8px', bgcolor: '#fff' }}>
          <Search size={15} color={T.muted} />
          <InputBase
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            sx={{ flex: 1, fontSize: 13 }}
            inputProps={{ 'aria-label': searchPlaceholder }}
          />
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Download size={14} />}
          disabled={!shown.length}
          onClick={() => downloadCsv(`${exportName}_${new Date().toISOString().slice(0, 10)}.csv`, (csvColumns || columns).filter((c) => c.csv), shown)}
          sx={{ ml: 'auto', textTransform: 'none', fontWeight: 700, borderRadius: '8px', borderColor: T.border, color: T.text, bgcolor: '#fff' }}
        >
          CSV
        </Button>
      </Box>

      <Box sx={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: '10px' }}>
        <Table size="small" sx={{ minWidth: 860 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: T.surface2 }}>
              {columns.map((col) => {
                const active = sort.key === col.key;
                const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <TableCell
                    key={col.key}
                    align={col.align || 'left'}
                    onClick={() => toggleSort(col)}
                    sx={{
                      width: col.width, whiteSpace: 'nowrap', cursor: col.sortValue ? 'pointer' : 'default', userSelect: 'none',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                      color: active ? T.heading : T.text2, borderBottom: `1px solid ${T.border}`, py: 1,
                    }}
                  >
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      {col.label}
                      {col.sortValue ? <SortIcon size={11} style={{ opacity: active ? 1 : 0.45 }} /> : null}
                    </Box>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((row, i) => (
              <TableRow
                key={rowKey(row)}
                hover={!!onRowClick}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={{ cursor: onRowClick ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} align={col.align || 'left'} sx={{ fontSize: 13, color: T.text, borderBottom: `1px solid ${T.surface3}`, py: 1.1 }}>
                    {col.render(row, current * pageSize + i)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!pageRows.length && (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ py: 5, textAlign: 'center', color: T.muted, fontSize: 13, borderBottom: 0 }}>
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12.5, color: T.text2 }}>
          {shown.length ? `Showing ${from}–${to} of ${shown.length}` : 'Showing 0'}
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <MiniSelect
            label="Rows per page"
            value={pageSize}
            onChange={(v) => { setPageSize(Number(v)); setPage(0); }}
            options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page` }))}
          />
          <ButtonBase sx={pageBtnSx(false)} disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
            <ChevronLeft size={14} />
          </ButtonBase>
          {pageList(current, pageCount).map((p) => (typeof p === 'string'
            ? <Typography key={p} sx={{ fontSize: 12, color: T.muted, px: 0.25 }}>…</Typography>
            : (
              <ButtonBase key={p} sx={pageBtnSx(p === current)} onClick={() => setPage(p)} aria-current={p === current ? 'page' : undefined}>
                {p + 1}
              </ButtonBase>
            )))}
          <ButtonBase sx={pageBtnSx(false)} disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
            <ChevronRight size={14} />
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};

export default DashTable;
