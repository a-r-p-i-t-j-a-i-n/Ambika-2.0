import React, { useMemo } from 'react';
import {
  Box, Stack, Typography, Chip, alpha, useTheme, Tooltip,
} from '@mui/material';
import { DataGrid, useGridApiContext } from '@mui/x-data-grid';
import { ArrowUp, ArrowDown, Calendar, HelpCircle } from 'lucide-react';
import dayjs from 'dayjs';
import { fmtINR } from '../../../utils/formatters';

const PriceMasterTable = ({ rows, isLoading, onRowClick }) => {
  const theme = useTheme();

  const columns = useMemo(() => [
    {
      field: '__serial',
      headerName: '#',
      width: 60,
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
      minWidth: 200,
      renderCell: (p) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography sx={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontWeight: 800, fontSize: '0.82rem',
            color: theme.palette.primary.dark,
            lineHeight: 1.1,
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
      field: 'currentPrice',
      headerName: 'Current Price',
      width: 140,
      align: 'right', headerAlign: 'right',
      renderCell: (p) => (
        <Typography sx={{
          fontWeight: 800, fontSize: '0.92rem',
          fontVariantNumeric: 'tabular-nums',
          color: p.value == null ? 'text.disabled' : 'text.primary',
        }}>
          {fmtINR(p.value)}
        </Typography>
      ),
    },
    {
      field: 'previousPrice',
      headerName: 'Previous Price',
      width: 130,
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
      headerName: 'Last Change Date',
      width: 160,
      renderCell: (p) => p.value ? (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Calendar size={12} color={theme.palette.text.disabled} />
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>
            {dayjs(p.value).format('DD MMM YYYY')}
          </Typography>
        </Stack>
      ) : <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>—</Typography>,
    },
    {
      field: 'changeAmount',
      headerName: 'Change Amount',
      width: 150,
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
              Change Amount
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
              height: 24, fontWeight: 800, fontSize: '0.74rem',
              color, bgcolor: bg, border: `1px solid ${alpha(color, 0.22)}`,
              '& .MuiChip-icon': { color: 'inherit' },
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        );
      },
    },
    {
      field: 'revisedByName',
      headerName: 'Revised By',
      width: 150,
      renderCell: (p) => (
        <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }} noWrap>
          {p.value || '—'}
        </Typography>
      ),
    },
  ], [theme]);

  return (
    <Box>
      <DataGrid
        rows={rows}
        columns={columns}
        getRowId={(r) => r.skuId}
        loading={isLoading}
        autoHeight
        rowHeight={64}
        disableRowSelectionOnClick
        onRowClick={(p) => onRowClick?.(p.row)}
        getRowClassName={(p) => {
          if (p.row.marginAlert) return 'row-margin-breach';
          if (p.row.statusTag === 'changed')  return 'row-changed';
          if (p.row.statusTag === 'unpriced') return 'row-unpriced';
          return '';
        }}
        sx={{
          border: 0,
          cursor: 'pointer',
          '& .MuiDataGrid-columnHeaders': {
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
          },
          '& .MuiDataGrid-columnHeaderTitle': {
            fontSize: '0.7rem',
            fontWeight: 800,
            letterSpacing: '0.06em',
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
