import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, TextField, InputAdornment, Button, IconButton, Tooltip, Tabs, Tab, Autocomplete, Skeleton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus, Eye, Edit3, ShoppingCart, Clock, CheckCircle, AlertCircle, Package, ExternalLink, ListChecks, Trash2 } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetOrdersQuery, useGetOrderStatsQuery, useDeleteOrderMutation } from '../../store/api/orderApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { usePermissions } from '../../hooks/usePermission';
import OrderEntryDrawer from './OrderEntryDrawer';
import OrderUpdateModal from './OrderUpdateModal';
import OrderDetailDrawer from './OrderDetailDrawer';
import TableSkeleton from '../../components/TableSkeleton';
import dayjs from 'dayjs';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', wip: '#7c3aed' };

const STATUS_TABS = [
  { label: 'All Orders', value: '' },
  { label: 'Received', value: 'RECEIVED' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Short Closed', value: 'SHORT_CLOSED' },
];

const StatusBadge = ({ value }) => {
  const map = { RECEIVED: BRAND.warning, IN_PROGRESS: BRAND.primary, COMPLETED: BRAND.success, CANCELLED: BRAND.error, SHORT_CLOSED: '#64748b', PLANNING: BRAND.wip };
  const color = map[value] || '#64748b';
  return (
    <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha(color, 0.08), color, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {value?.replace('_', ' ')}
    </Box>
  );
};

const StatCard = ({ title, value, icon: Icon, color, loading }) => (
  <Paper sx={{ p: 2, borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none', flex: 1, transition: 'all 0.2s', '&:hover': { boxShadow: `0 4px 16px ${alpha(color, 0.12)}` } }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Box>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>{title}</Typography>
        {loading ? <Skeleton width={60} height={28} /> : (
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: '#0b2545', lineHeight: 1.2 }}>{value}</Typography>
        )}
      </Box>
      <Box sx={{ p: 0.75, borderRadius: '8px', bgcolor: alpha(color, 0.08), color }}>
        <Icon size={16} strokeWidth={2.5} />
      </Box>
    </Box>
  </Paper>
);

const PipelineBar = ({ row }) => {
  const steps = ['poEntry','inventoryCheck','scheduling','emailSchedule'];
  const done = steps.filter(s => row[s]?.status === 'DONE').length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: BRAND.primary }}>{done}/{steps.length}</Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: '#94a3b8' }}>{pct}%</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: '2px', height: 5, borderRadius: '3px', overflow: 'hidden', bgcolor: '#f1f5f9' }}>
        {steps.map(s => (
          <Box key={s} sx={{ flex: 1, bgcolor: row[s]?.status === 'DONE' ? BRAND.success : row[s]?.status === 'DELAYED' ? BRAND.error : '#e2e8f0', transition: 'all 0.2s' }} />
        ))}
      </Box>
    </Box>
  );
};

const OrdersList = () => {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { can, isRoot } = usePermissions();
  const canDelete = isRoot || can('orders.delete');
  const [deleteOrder, { isLoading: deleting }] = useDeleteOrderMutation();

  const confirmDelete = async () => {
    try { await deleteOrder(deleteTarget._id).unwrap(); setDeleteTarget(null); }
    catch (e) { /* surfaced below */ }
  };

  const queryParams = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    status: statusFilter || undefined,
    partyId: partyFilter?._id || undefined,
    sort: '-orderDate',
  };

  const { data, isLoading } = useGetOrdersQuery(queryParams);
  const { data: statsRes, isLoading: statsLoading } = useGetOrderStatsQuery();
  const { data: partiesData } = useGetPartiesQuery({ limit: 200 });

  const stats = statsRes?.data?.summary || {};
  const parties = partiesData?.data || [];

  const handleViewDetail = (order) => { 
    navigate(`/orders/${order._id}`);
  };
  const handleUpdateClick = (order) => { setSelectedOrder(order); setIsUpdateOpen(true); };
  const handleEditOrder = (order) => { setEditOrder(order); setIsCreateOpen(true); };
  const handleNewOrder = () => { setEditOrder(null); setIsCreateOpen(true); };
  const handleDrawerClose = () => { setIsCreateOpen(false); setEditOrder(null); };

  if (isLoading && !data) return <TableSkeleton columns={8} />;

  const columns = [
    { field: 'soNumber', headerName: 'SO #', width: 150,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={700} color="primary.main" sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          onClick={() => handleViewDetail(p.row)}>
          {p.value}
        </Typography>
      )
    },
    { field: 'poNumber', headerName: 'PO #', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" fontWeight={500} fontSize="0.8rem">{p.value}</Typography>
    },
    { field: 'partyName', headerName: 'CUSTOMER', flex: 1, minWidth: 180,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap fontSize="0.8rem">{p.value}</Typography>
    },
    { field: 'orderDate', headerName: 'DATE', width: 95,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" fontWeight={500} fontSize="0.8rem">{dayjs(p.value).format('DD MMM YY')}</Typography>
    },
    { field: 'items', headerName: 'SKUs', width: 60, align: 'center', headerAlign: 'center',
      renderCell: (p) => (
        <Box sx={{ px: 1, py: 0.3, borderRadius: '6px', bgcolor: alpha(BRAND.wip, 0.06), color: BRAND.wip, fontSize: '0.75rem', fontWeight: 700 }}>
          {p.value?.length || 0}
        </Box>
      )
    },
    { field: 'totalOrderQty', headerName: 'ORDER QTY', width: 100, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} fontSize="0.8rem">{p.value?.toLocaleString('en-IN') || '0'}</Typography>
    },
    { field: 'totalDispatchedQty', headerName: 'DISPATCHED', width: 100, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={600} fontSize="0.8rem" color={BRAND.success}>{p.value?.toLocaleString('en-IN') || '0'}</Typography>
    },
    { field: 'totalBalanceQty', headerName: 'BALANCE', width: 90, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} fontSize="0.8rem" color={p.value > 0 ? BRAND.error : BRAND.success}>{p.value?.toLocaleString('en-IN') || '0'}</Typography>
    },
    { field: 'workflow', headerName: 'PROGRESS', width: 140, sortable: false,
      renderCell: (p) => <PipelineBar row={p.row} />
    },
    { field: 'status', headerName: 'STATUS', width: 120,
      renderCell: (p) => <StatusBadge value={p.value} />
    },
    { field: 'actions', headerName: '', width: canDelete ? 150 : 116, sortable: false, align: 'center',
      renderCell: (p) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Edit Order"><IconButton size="small" onClick={(e) => { e.stopPropagation(); handleEditOrder(p.row); }} sx={{ color: BRAND.primary }}><Edit3 size={14} /></IconButton></Tooltip>
          <Tooltip title="Edit Workflow"><IconButton size="small" onClick={(e) => { e.stopPropagation(); handleUpdateClick(p.row); }} sx={{ color: BRAND.wip }}><ListChecks size={14} /></IconButton></Tooltip>
          <Tooltip title="View Details"><IconButton size="small" onClick={(e) => { e.stopPropagation(); handleViewDetail(p.row); }} sx={{ color: '#94a3b8' }}><Eye size={14} /></IconButton></Tooltip>
          {canDelete && (
            <Tooltip title="Delete Order (MD only)"><IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.row); }} sx={{ color: BRAND.error }}><Trash2 size={14} /></IconButton></Tooltip>
          )}
        </Box>
      )
    }
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      
      {/* ── Header ─────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>Sales Orders</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Order booking, tracking & dispatch pipeline</Typography>
        </Box>
        <Button 
          variant="contained" 
          startIcon={<Plus size={16} />}
          onClick={handleNewOrder}
          fullWidth={false}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          New Order
        </Button>
      </Box>

      {/* ── Stat Cards ─────────────────────────────────────── */}
      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, 
        gap: 1.5 
      }}>
        <StatCard title="Total Orders" value={stats.totalOrders || 0} icon={ShoppingCart} color={BRAND.primary} loading={statsLoading} />
        <StatCard title="Total SKU Lines" value={stats.totalSkuLines || 0} icon={Package} color={BRAND.wip} loading={statsLoading} />
        <StatCard title="Dispatched Qty" value={(stats.totalDispatchedQty || 0).toLocaleString('en-IN')} icon={CheckCircle} color={BRAND.success} loading={statsLoading} />
        <StatCard title="Pending Balance" value={(stats.totalBalanceQty || 0).toLocaleString('en-IN')} icon={AlertCircle} color={BRAND.error} loading={statsLoading} />
      </Box>

      {/* ── Filters Bar ────────────────────────────────────── */}
      <Paper sx={{ borderRadius: '14px', p: 0, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'center' }, 
          justifyContent: 'space-between', 
          px: 1, 
          py: 1, 
          borderBottom: '1px solid #f1f5f9',
          gap: 1.5
        }}>
          <Tabs 
            value={statusFilter} 
            onChange={(_, v) => { setStatusFilter(v); setPaginationModel(prev => ({ ...prev, page: 0 })); }}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ 
              minHeight: 36, 
              '& .MuiTab-root': { minHeight: 36, py: 0.5, px: 1.5, fontSize: '0.75rem', fontWeight: 600, textTransform: 'none' } 
            }}
          >
            {STATUS_TABS.map(t => <Tab key={t.value} label={t.label} value={t.value} />)}
          </Tabs>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1.5, px: 1 }}>
            <Autocomplete
              options={parties}
              getOptionLabel={(opt) => opt.name || ''}
              value={partyFilter}
              onChange={(_, val) => { setPartyFilter(val); setPaginationModel(prev => ({ ...prev, page: 0 })); }}
              size="small"
              fullWidth
              sx={{ width: { xs: '100%', sm: 220 } }}
              renderInput={(params) => <TextField {...params} placeholder="Filter by Party..." variant="outlined" size="small" 
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff', fontSize: '0.8rem' } }} />}
            />
            <TextField 
              size="small" 
              placeholder="Search orders..." 
              value={searchTerm}
              fullWidth
              onChange={(e) => { setSearchTerm(e.target.value); setPaginationModel(prev => ({ ...prev, page: 0 })); }}
              sx={{ width: { xs: '100%', sm: 200 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff', fontSize: '0.8rem' } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} color="#94a3b8" /></InputAdornment> }}
            />
          </Box>
        </Box>

        {/* ── Data Grid ──────────────────────────────────── */}
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={42}
          onRowClick={(params) => handleViewDetail(params.row)}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
          }}
        />
      </Paper>

      {/* ── Modals & Drawers ─────────────────────────────── */}
      <OrderEntryDrawer open={isCreateOpen} onClose={handleDrawerClose} order={editOrder} />
      <OrderUpdateModal open={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} order={selectedOrder} />
      <OrderDetailDrawer open={isDetailOpen} onClose={() => setIsDetailOpen(false)} orderId={detailOrderId} />

      {/* Delete confirmation — MD only */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Delete this order?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes <b>{deleteTarget?.soNumber}</b> ({deleteTarget?.partyName}) and its O2D FMS process.
            This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete} disabled={deleting} startIcon={<Trash2 size={16} />}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OrdersList;
