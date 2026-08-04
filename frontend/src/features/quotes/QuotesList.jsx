import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Button, Paper, alpha, useTheme,
  ToggleButtonGroup, ToggleButton, Skeleton,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import {
  FileSignature, Plus, Calculator, Hourglass, CheckCircle2, Send, ShieldOff, Repeat,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useListQuotesQuery } from '../../store/api/quoteApi';
import { fmtINR, fmtINRCompact } from '../../utils/formatters';
import { PageHero, pageSx, panelSx, primaryBtnSx, BRAND, BRAND_DK, NAVY, O2D } from '../../components/pageKit';

const STATUS_META = (theme) => ({
  DRAFT:           { color: theme.palette.text.secondary, bg: alpha(theme.palette.text.secondary, 0.10), label: 'Draft',         icon: FileSignature },
  SENT:            { color: theme.palette.primary.dark,   bg: alpha(theme.palette.primary.main, 0.10),  label: 'Sent',          icon: Send },
  ACCEPTED:        { color: theme.palette.success.dark,   bg: alpha(theme.palette.success.main, 0.10),  label: 'Accepted',      icon: CheckCircle2 },
  REJECTED:        { color: theme.palette.error.dark,     bg: alpha(theme.palette.error.main, 0.10),    label: 'Rejected',      icon: ShieldOff },
  EXPIRED:         { color: theme.palette.warning.dark,   bg: alpha(theme.palette.warning.main, 0.10),  label: 'Expired',       icon: Hourglass },
  CONVERTED_TO_SO: { color: theme.palette.info.dark,      bg: alpha(theme.palette.info.main, 0.10),     label: 'Converted',     icon: Repeat },
});

const QuotesList = ({ initialStatus = '', lockStatus = false, title = 'Quotes' }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [status, setStatus] = useState(initialStatus);
  const { data, isFetching } = useListQuotesQuery({ status: status || undefined });
  const isDraftsView = lockStatus && initialStatus === 'DRAFT';
  const statusMeta = useMemo(() => STATUS_META(theme), [theme]);

  const rows = useMemo(() => {
    const list = data?.data || [];
    return list.map((q) => ({
      ...q,
      effectiveStatus: q.isExpired && q.status === 'SENT' ? 'EXPIRED' : q.status,
    }));
  }, [data]);

  const counts = useMemo(() => {
    const o = { all: rows.length };
    for (const q of rows) o[q.effectiveStatus] = (o[q.effectiveStatus] || 0) + 1;
    return o;
  }, [rows]);

  const columns = useMemo(() => [
    {
      field: 'quoteNumber', headerName: 'Quote #', width: 160,
      renderCell: (p) => (
        <Stack sx={{ py: 0.5 }}>
          <Typography sx={{
            fontFamily: 'ui-monospace, monospace', fontWeight: 800,
            color: theme.palette.primary.dark, fontSize: '0.84rem',
          }}>{p.value}</Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
            {dayjs(p.row.createdAt).format('DD MMM YYYY · HH:mm')}
          </Typography>
        </Stack>
      ),
    },
    {
      field: 'partyName', headerName: 'Party', flex: 1, minWidth: 180,
      renderCell: (p) => (
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 600 }}>{p.value || '—'}</Typography>
      ),
    },
    {
      field: 'asOfDate', headerName: 'As of', width: 110,
      renderCell: (p) => <Typography sx={{ fontSize: '0.78rem' }}>{dayjs(p.value).format('DD MMM YY')}</Typography>,
    },
    {
      field: 'lines', headerName: 'Lines', width: 80, align: 'right', headerAlign: 'right',
      valueGetter: (_v, row) => row.lines?.length || 0,
      renderCell: (p) => <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.value}</Typography>,
    },
    {
      field: 'totals', headerName: 'Total', width: 130, align: 'right', headerAlign: 'right',
      valueGetter: (_v, row) => row.totals?.grandTotal || 0,
      renderCell: (p) => (
        <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', fontVariantNumeric: 'tabular-nums' }}>
          {fmtINRCompact(p.value)}
        </Typography>
      ),
    },
    {
      field: 'effectiveStatus', headerName: 'Status', width: 130,
      renderCell: (p) => {
        const m = statusMeta[p.value] || statusMeta.DRAFT;
        const Icon = m.icon;
        return (
          <Chip
            size="small"
            icon={<Icon size={11} style={{ marginLeft: 6 }} />}
            label={m.label}
            sx={{
              height: 22, fontWeight: 800, fontSize: '0.7rem',
              color: m.color, bgcolor: m.bg, border: `1px solid ${alpha(m.color, 0.20)}`,
              '& .MuiChip-icon': { color: 'inherit' },
            }}
          />
        );
      },
    },
    {
      field: 'validUntil', headerName: 'Validity', width: 130,
      renderCell: (p) => {
        const days = dayjs(p.value).diff(dayjs(), 'day');
        const isExpired = days < 0;
        return (
          <Typography sx={{
            fontSize: '0.78rem',
            color: isExpired ? theme.palette.error.dark : days < 3 ? theme.palette.warning.dark : 'text.secondary',
            fontWeight: isExpired || days < 3 ? 700 : 500,
          }}>
            {isExpired ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Today' : `${days}d left`}
          </Typography>
        );
      },
    },
  ], [theme, statusMeta]);

  return (
    <Box sx={pageSx}>
      <PageHero
        icon={FileSignature}
        title={title}
        subtitle={isDraftsView
          ? 'Work-in-progress quotes — open one to edit, share on WhatsApp / email, or send.'
          : 'Saved snapshots from the calculator — prices frozen at the as-of date.'}
        actions={(
          <Button variant="contained" startIcon={<Calculator size={15} />}
            onClick={() => navigate('/pricing/calculator')} sx={primaryBtnSx}>
            New from Calculator
          </Button>
        )}
      />

      <Box sx={{ position: 'relative' }}>
        {!lockStatus && (
        <Paper sx={{ p: 2, borderRadius: '10px', mb: 2 }}>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {['', 'DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CONVERTED_TO_SO'].map((s) => {
              const label = s === '' ? 'All' : (statusMeta[s]?.label || s);
              const count = s === '' ? counts.all : (counts[s] || 0);
              const selected = status === s;
              const m = s === '' ? null : statusMeta[s];
              return (
                <Chip
                  key={s || 'all'}
                  size="small"
                  onClick={() => setStatus(s)}
                  label={`${label} ${count}`}
                  sx={{
                    height: 28, px: 0.75, fontWeight: 700, fontSize: '0.74rem',
                    color: selected ? '#fff' : (m?.color || 'text.secondary'),
                    bgcolor: selected ? (m?.color || theme.palette.primary.main) : alpha(m?.color || theme.palette.text.secondary, 0.08),
                    border: `1px solid ${alpha(m?.color || theme.palette.text.secondary, 0.20)}`,
                    cursor: 'pointer',
                  }}
                />
              );
            })}
          </Stack>
        </Paper>
        )}

        <Paper sx={{ borderRadius: '10px', overflow: 'hidden', mb: 4 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            getRowId={(r) => r._id}
            loading={isFetching}
            autoHeight
            rowHeight={66}
            disableRowSelectionOnClick
            onRowClick={(p) => navigate(`/quotes/${p.id}`)}
            sx={{ border: 0, cursor: 'pointer' }}
          />
          {!isFetching && rows.length === 0 && (
            <Box sx={{ p: 6, textAlign: 'center', color: 'text.disabled' }}>
              <FileSignature size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
              <Typography sx={{ fontWeight: 700 }}>{isDraftsView ? 'No saved drafts' : 'No quotes yet'}</Typography>
              <Typography sx={{ fontSize: '0.84rem', mb: 2 }}>
                Build one in the Turnover Calculator and click "{isDraftsView ? 'Save Draft' : 'Save as Quote'}".
              </Typography>
              <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => navigate('/pricing/calculator')} sx={{ fontWeight: 700 }}>
                Open Calculator
              </Button>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default QuotesList;
