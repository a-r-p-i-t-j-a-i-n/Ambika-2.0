import React, { useMemo } from 'react';
import {
  Box, Stack, Typography, Chip, alpha, useTheme, Tooltip, Button,
} from '@mui/material';
import { DataGrid, useGridApiContext } from '@mui/x-data-grid';
import { ArrowUp, ArrowDown, Calendar, HelpCircle, Plus } from 'lucide-react';
import dayjs from 'dayjs';
import { fmtINR } from '../../../utils/formatters';

// Column widths are kept tight on purpose so the whole table fits inside the
// panel without horizontal clipping. The per-row price action lives INSIDE
// the Current Price cell (column 4) so it is always visible — never pushed
// off-screen the way a trailing actions column would be.
const PriceMasterTable = ({
  rows, isLoading, onRowClick, onRevise, canRevise = false, priceType,
}) => {
  const theme = useTheme();

  const columns = useMemo(() => [
    {
      field: '__serial',
      headerName: '#',
      width: 46,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => <SerialCell rowId={p.id} />,
    },
    {
      field: 'code',
      headerName: 'SKU',
      flex: 1,
      minWidth: 190,
      renderCell: (p) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontWeight: 800, fontSize: '0.8rem',
            color: theme.palette.primary.dark,
            lineHeight: 1.15,
          }}>
            {p.value}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', mt: 0.25 }} noWrap>
            {p.row.name}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'category',
      headerName: 'Group',
      width: 132,
      renderCell: (p) => (p.value ? (
        <Chip
          size="small"
          label={p.value}
          sx={{
            height: 22, fontSize: '0.69rem', fontWeight: 700,
            bgcolor: alpha(theme.palette.primary.main, 0.07),
            color: theme.palette.primary.dark,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
          }}
        />
      ) : (
        <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>—</Typography>
      )),
    },
    {
      field: 'currentPrice',
      headerName: 'Current Price',
      width: 158,
      align: 'right', headerAlign: 'right',
      renderCell: (p) => {
        if (p.value != null) {
          return (
            <Typography sx={{
              fontWeight: 800, fontSize: '0.92rem',
              fontVariantNumeric: 'tabular-nums',
              color: 'text.primary',
            }}>
              {fmtINR(p.value)}
            </Typography>
          );
        }
        // Unpriced — offer a one-click "Set price" right here so it is always
        // visible. Falls back to a plain chip when the user cannot revise.
        if (canRevise) {
          return (
            <Button
              size="small"
              variant="contained"
              startIcon={<Plus size={13} />}
              onClick={(e) => { e.stopPropagation(); onRevise?.(p.row); }}
              sx={{
                fontWeight: 800, fontSize: '0.7rem', textTransform: 'none',
                borderRadius: 1.25, py: 0.3, px: 1.1, boxShadow: 'none',
              }}
            >
              Set price
            </Button>
          );
        }
        return (
          <Chip
            size="small"
            label="Unpriced"
            sx={{
              height: 22, fontSize: '0.68rem', fontWeight: 800,
              bgcolor: alpha(theme.palette.error.main, 0.08),
              color: theme.palette.error.dark,
              border: `1px solid ${alpha(theme.palette.error.main, 0.20)}`,
            }}
          />
        );
      },
    },
    {
      field: 'previousPrice',
      headerName: 'Previous',
      width: 116,
      align: 'right', headerAlign: 'right',
      renderCell: (p) => (
        <Typography sx={{
          color: 'text.secondary', fontSize: '0.82rem',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {p.value == null ? '—' : fmtINR(p.value)}
        </Typography>
      ),
    },
    {
      field: 'effectiveFrom',
      headerName: 'Last Change',
      width: 140,
      renderCell: (p) => (p.value ? (
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Calendar size={12} color={theme.palette.text.disabled} />
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
            {dayjs(p.value).format('DD MMM YYYY')}
          </Typography>
        </Stack>
      ) : <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>—</Typography>),
    },
    {
      field: 'changeAmount',
      headerName: 'Change',
      width: 128,
      align: 'right', headerAlign: 'right',
      sortable: true,
      valueGetter: (_value, row) => {
        if (row.currentPrice == null || row.previousPrice == null) return null;
        const d = row.currentPrice - row.previousPrice;
        return d === 0 ? null : d;
      },
      renderHeader: () => (
        <Tooltip
          arrow
          title="Rupee amount the price moved by (current − previous). Green = increase, Red = decrease."
        >
          <Stack direction="row" alignItems="center" spacing={0.4} sx={{ width: '100%', justifyContent: 'flex-end', cursor: 'help' }}>
            <Typography sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
              Change
            </Typography>
            <HelpCircle size={11} style={{ opacity: 0.55 }} />
          </Stack>
        </Tooltip>
      ),
      renderCell: (p) => {
        if (p.value == null) {
          return <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>—</Typography>;
        }
        const up = p.value > 0;
        const color = up ? theme.palette.success.dark : theme.palette.error.dark;
        const bg    = up ? alpha(theme.palette.success.main, 0.08) : alpha(theme.palette.error.main, 0.08);
        const Icon  = up ? ArrowUp : ArrowDown;
        return (
          <Chip
            size="small"
            icon={<Icon size={12} style={{ marginLeft: 6 }} />}
            label={`${up ? '+' : '−'}${fmtINR(Math.abs(p.value))}`}
            sx={{
              height: 24, fontWeight: 800, fontSize: '0.73rem',
              color, bgcolor: bg, border: `1px solid ${alpha(color, 0.22)}`,
              '& .MuiChip-icon': { color: 'inherit' },
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        );
      },
    },
    // Purchase stream: the latest rate in the Vendor Master (read-only reference;
    // kept current by Vendor Master edits and approved POs — not a price revision).
    ...(priceType === 'RM_COST' ? [{
      field: 'latestVendorRate',
      headerName: 'Latest Vendor Rate',
      width: 170,
      align: 'right', headerAlign: 'right',
      valueGetter: (_value, row) => row.latestVendorRate?.rate ?? null,
      renderCell: (p) => {
        const v = p.row.latestVendorRate;
        if (!v) return <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>—</Typography>;
        const via = v.source === 'PURCHASE_ORDER'
          ? `PO creation${v.referenceNumber ? ` (${v.referenceNumber})` : ''}`
          : 'Vendor Master';
        const when = v.updatedAt ? ` · ${dayjs(v.updatedAt).format('DD MMM YYYY')}` : '';
        return (
          <Tooltip arrow title={`${v.vendorName || 'Vendor'} · updated through ${via}${when}`}>
            <Stack sx={{ alignItems: 'flex-end', py: 0.5 }}>
              <Typography sx={{ fontWeight: 700, fontSize: '0.86rem', fontVariantNumeric: 'tabular-nums' }}>
                {fmtINR(v.rate)}
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', maxWidth: 150 }} noWrap>
                {v.vendorName}
              </Typography>
            </Stack>
          </Tooltip>
        );
      },
    }] : []),
  ], [theme, canRevise, onRevise, priceType]);

  return (
    <Box>
      <DataGrid
        rows={rows}
        columns={columns}
        getRowId={(r) => r.skuId}
        loading={isLoading}
        autoHeight
        rowHeight={62}
        disableRowSelectionOnClick
        onRowClick={(p) => onRowClick?.(p.row)}
        slots={{ noRowsOverlay: NoRowsOverlay }}
        getRowClassName={(p) => {
          if (p.row.marginAlert) return 'row-margin-breach';
          if (p.row.statusTag === 'changed')  return 'row-changed';
          if (p.row.statusTag === 'unpriced') return 'row-unpriced';
          return '';
        }}
        sx={{
          border: 0,
          cursor: 'pointer',
          '--DataGrid-overlayHeight': '260px',
          '& .MuiDataGrid-columnHeaders': {
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
          },
          '& .MuiDataGrid-columnHeaderTitle': {
            fontSize: '0.7rem',
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: theme.palette.text.secondary,
          },
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          '& .MuiDataGrid-row:hover': { bgcolor: alpha(theme.palette.primary.main, 0.035) },
          '& .row-changed':         { bgcolor: alpha(theme.palette.success.main, 0.04) },
          '& .row-unpriced':        { bgcolor: alpha(theme.palette.error.main, 0.03) },
          '& .row-margin-breach':   {
            bgcolor: alpha(theme.palette.error.main, 0.06),
            boxShadow: `inset 3px 0 0 ${theme.palette.error.main}`,
          },
        }}
      />
    </Box>
  );
};

// Friendly empty state — keeps the table from looking broken when a filter
// (kind / group / search) matches nothing.
const NoRowsOverlay = () => (
  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: 'text.disabled', gap: 0.5 }}>
    <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>No SKUs here</Typography>
    <Typography sx={{ fontSize: '0.78rem' }}>
      Try another kind, clear the group filter, or change your search.
    </Typography>
  </Stack>
);

// Live row number that respects current sort/filter order.
const SerialCell = ({ rowId }) => {
  const apiRef = useGridApiContext();
  const idx = apiRef.current.getRowIndexRelativeToVisibleRows(rowId);
  return (
    <Typography sx={{
      fontSize: '0.78rem',
      fontWeight: 700,
      color: 'text.disabled',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {String((idx ?? 0) + 1).padStart(2, '0')}
    </Typography>
  );
};

export default PriceMasterTable;
