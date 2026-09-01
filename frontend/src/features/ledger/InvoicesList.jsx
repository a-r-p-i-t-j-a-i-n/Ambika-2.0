import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Paper, IconButton, Tooltip, Button, TextField, InputAdornment } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Download, Eye, DollarSign, FileText, Wallet, TrendingUp } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { O2D } from '../o2d-fms/o2dTheme';
import BackButton from '../../components/BackButton';
import TableSkeleton from '../../components/TableSkeleton';
import dayjs from 'dayjs';

// Invoice status → colour. The client's rule: paid is green, part-paid amber,
// sent/created blue (in-hand), pending slate, cancelled muted red.
const STATUS_STYLE = {
  PAID:      { color: '#15803d', bg: '#dcfce7', label: 'Paid' },
  PARTIAL:   { color: '#b45309', bg: '#fef3c7', label: 'Part paid' },
  SENT:      { color: '#1d4ed8', bg: '#dbeafe', label: 'Sent' },
  CREATED:   { color: '#0369a1', bg: '#e0f2fe', label: 'Created' },
  PENDING:   { color: '#475569', bg: '#e9eef5', label: 'Pending' },
  CANCELLED: { color: '#b91c1c', bg: '#fee2e2', label: 'Cancelled' },
};

const StatusBadge = ({ value }) => {
  const s = STATUS_STYLE[value] || STATUS_STYLE.PENDING;
  return (
    <Box sx={{ px: 1.25, py: 0.4, borderRadius: '8px', bgcolor: s.bg, color: s.color,
      fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
      {s.label}
    </Box>
  );
};

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const StatCard = ({ icon: Icon, label, value, tint, color }) => (
  <Paper elevation={0} sx={{ flex: 1, minWidth: 180, p: 1.75, display: 'flex', alignItems: 'center', gap: 1.5,
    border: `1px solid ${O2D.line}`, borderRadius: '8px', bgcolor: O2D.surface }}>
    <Box sx={{ width: 38, height: 38, borderRadius: '8px', bgcolor: tint, color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Icon size={18} />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{value}</Typography>
    </Box>
  </Paper>
);

const InvoicesList = () => {
  const [searchParams] = useSearchParams();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  // Deep-link support: ?so=AGL/SO-… (from an FMS task) pre-filters to that order;
  // ?inv=INV-021 (from the FMS Step View) narrows to the one invoice of a challan.
  const [searchTerm, setSearchTerm] = useState(searchParams.get('inv') || searchParams.get('so') || '');

  // The factory's invoice book is small — pull the ledger once and filter/total
  // client-side so search is instant and the summary reflects EVERY matching row,
  // not just the visible page.
  const { data, isLoading } = useGetSalesInvoicesQuery({ limit: 1000, sort: '-invoiceDate' });
  const allRows = data?.data || [];

  const rows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => [r.invoiceNo, r.partyName, r.soNumber, r.dcNumber, r.poNumber]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [allRows, searchTerm]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    if (r.status === 'CANCELLED') return a;
    a.invoiced += r.invoiceAmount || 0;
    a.received += r.amountReceived || 0;
    a.outstanding += (r.balance != null ? r.balance : (r.invoiceAmount || 0) - (r.amountReceived || 0));
    return a;
  }, { invoiced: 0, received: 0, outstanding: 0 }), [rows]);

  if (isLoading) return <TableSkeleton columns={7} />;

  const columns = [
    { field: 'invoiceNo', headerName: 'INVOICE #', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: O2D.brand }}>{p.value}</Typography>
    },
    { field: 'partyName', headerName: 'CUSTOMER', flex: 1, minWidth: 180,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap sx={{ color: O2D.ink }}>{p.value || '—'}</Typography>
    },
    { field: 'soNumber', headerName: 'SALES ORDER', width: 140,
      renderCell: (p) => <Typography variant="body2" sx={{ color: O2D.sub, fontWeight: 500 }} noWrap>{p.value || '—'}</Typography>
    },
    { field: 'invoiceDate', headerName: 'DATE', width: 118,
      renderCell: (p) => <Typography variant="body2" sx={{ color: O2D.body }} fontWeight={500}>{p.value ? dayjs(p.value).format('DD MMM YYYY') : '—'}</Typography>
    },
    { field: 'invoiceAmount', headerName: 'AMOUNT', width: 128, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: O2D.ink }}>{inr(p.value)}</Typography>
    },
    { field: 'amountReceived', headerName: 'RECEIVED', width: 120, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={600} sx={{ color: p.value > 0 ? '#15803d' : O2D.faint }}>{inr(p.value)}</Typography>
    },
    { field: 'balance', headerName: 'BALANCE', width: 120, align: 'right', headerAlign: 'right',
      renderCell: (p) => {
        const bal = p.value != null ? p.value : (p.row.invoiceAmount || 0) - (p.row.amountReceived || 0);
        return <Typography variant="body2" fontWeight={700} sx={{ color: bal > 0 ? '#b45309' : O2D.faint }}>{inr(bal)}</Typography>;
      }
    },
    { field: 'status', headerName: 'STATUS', width: 118,
      renderCell: (p) => <StatusBadge value={p.value} />
    },
    { field: 'dcNumber', headerName: 'DC REF', width: 130,
      renderCell: (p) => <Typography variant="body2" sx={{ color: O2D.sub }} fontWeight={500} noWrap>{p.value || '—'}</Typography>
    },
    { field: 'actions', headerName: '', width: 72, sortable: false, align: 'center',
      renderCell: () => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="View invoice"><IconButton size="small" sx={{ color: O2D.brand }}><Eye size={15} /></IconButton></Tooltip>
          <Tooltip title="Payment"><IconButton size="small" sx={{ color: O2D.faint }}><DollarSign size={15} /></IconButton></Tooltip>
        </Box>
      )
    }
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <BackButton iconOnly />
          <Box>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.3rem' }, fontWeight: 800, color: O2D.ink, letterSpacing: '-0.015em', lineHeight: 1.2 }}>Invoices &amp; Finance</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: O2D.sub, fontWeight: 500, mt: 0.25 }}>Tax invoices and payment collection across all orders</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search invoice, customer, order…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', sm: 300 }, '& .MuiOutlinedInput-root': { bgcolor: O2D.surface, borderRadius: '8px' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={O2D.faint} /></InputAdornment> }}
          />
          <Button variant="outlined" startIcon={<Download size={16} />}
            sx={{ width: { xs: '100%', sm: 'auto' }, borderRadius: '8px', borderColor: O2D.line, color: O2D.body, bgcolor: O2D.surface, textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: O2D.surfaceAlt, borderColor: O2D.line } }}>
            Export Ledger
          </Button>
        </Box>
      </Box>

      {/* Finance summary */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        <StatCard icon={FileText} label={`Invoiced (${rows.filter((r) => r.status !== 'CANCELLED').length})`} value={inr(totals.invoiced)} tint={alpha(O2D.brand, 0.1)} color={O2D.brand} />
        <StatCard icon={Wallet} label="Received" value={inr(totals.received)} tint="#dcfce7" color="#15803d" />
        <StatCard icon={TrendingUp} label="Outstanding" value={inr(totals.outstanding)} tint="#fef3c7" color="#b45309" />
      </Box>

      {/* Data Grid */}
      <Paper elevation={0} sx={{ flexGrow: 1, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}` }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={44}
          localeText={{ noRowsLabel: searchTerm ? 'No invoices match your search' : 'No invoices yet' }}
          sx={{
            border: 0,
            '& .MuiDataGrid-columnHeaders': { bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.line}` },
            '& .MuiDataGrid-columnHeaderTitle': { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.03em', color: O2D.sub },
            '& .MuiDataGrid-cell': { borderColor: O2D.lineSoft },
            '& .MuiDataGrid-row:hover': { bgcolor: O2D.surfaceAlt },
          }}
        />
      </Paper>
    </Box>
  );
};

export default InvoicesList;
