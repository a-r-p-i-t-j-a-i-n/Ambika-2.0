import React from 'react';
import {
  Drawer, Box, Typography, IconButton, Divider, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, Skeleton, Button, Tooltip
} from '@mui/material';
import { X, FileText, ExternalLink, CheckCircle2, Clock, AlertCircle, Truck, Calendar } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetOrderByIdQuery } from '../../store/api/orderApi';
import dayjs from 'dayjs';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', wip: '#7c3aed' };

const WORKFLOW_STEPS = [
  { key: 'poEntry', label: 'PO Entry in Tally', who: 'Upasana' },
  { key: 'inventoryCheck', label: 'Check Inventory', who: 'Upasana' },
  { key: 'scheduling', label: 'Create Dispatch Schedule', who: 'Aarti' },
  { key: 'emailSchedule', label: 'Email Dispatch Schedule', who: 'Aarti' },
];

const StatusBadge = ({ value }) => {
  const map = { RECEIVED: BRAND.warning, PLANNING: BRAND.wip, IN_PROGRESS: BRAND.primary, COMPLETED: BRAND.success, CANCELLED: BRAND.error, SHORT_CLOSED: '#64748b' };
  const color = map[value] || '#64748b';
  return (
    <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha(color, 0.08), color, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', display: 'inline-block' }}>
      {value?.replace('_', ' ')}
    </Box>
  );
};

const StepIcon = ({ status }) => {
  if (status === 'DONE') return <CheckCircle2 size={16} color={BRAND.success} />;
  if (status === 'DELAYED') return <AlertCircle size={16} color={BRAND.error} />;
  return <Clock size={16} color="#94a3b8" />;
};

const InfoRow = ({ label, value, href }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary" fontWeight={500} fontSize="0.8rem">{label}</Typography>
    {href ? (
      <a href={href} target="_blank" rel="noreferrer" style={{ color: BRAND.primary, fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
        View <ExternalLink size={12} />
      </a>
    ) : (
      <Typography variant="body2" fontWeight={600} fontSize="0.8rem">{value || '—'}</Typography>
    )}
  </Box>
);

const OrderDetailDrawer = ({ open, onClose, orderId }) => {
  const { data: orderRes, isLoading } = useGetOrderByIdQuery(orderId, { skip: !orderId });
  const order = orderRes?.data;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} disableEnforceFocus
      PaperProps={{ sx: { width: { xs: '100%', md: 620 }, p: 0, display: 'flex', flexDirection: 'column' } }}>
      
      {/* ── Header ────────────────────────────────────────── */}
      <Box sx={{ p: 3, pb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography variant="h6" fontWeight={800} color="primary.main">
              {isLoading ? <Skeleton width={160} /> : order?.soNumber}
            </Typography>
            {order && <StatusBadge value={order.status} />}
          </Box>
          <Typography variant="body2" color="text.secondary" fontWeight={500}>
            {isLoading ? <Skeleton width={200} /> : order?.partyName}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small"><X size={20} /></IconButton>
      </Box>

      {/* ── Content ───────────────────────────────────────── */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="text" height={24} />)}
          </Box>
        ) : order ? (
          <>
            {/* ── Order Info ───────────────────────────────── */}
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
              Order Details
            </Typography>
            <Paper sx={{ p: 2, borderRadius: '12px', mb: 3, boxShadow: 'none', border: '1px solid #e2e8f0' }}>
              <InfoRow label="PO Number" value={order.poNumber} />
              <InfoRow label="PO Date" value={order.poDate ? dayjs(order.poDate).format('DD MMM YYYY') : '—'} />
              <InfoRow label="Order Date" value={dayjs(order.orderDate).format('DD MMM YYYY')} />
              <InfoRow label="Location" value={order.location} />
              <InfoRow label="Transport" value={order.transport} />
              <InfoRow label="Lead Time" value={`${order.leadTimeDays} days`} />
              <InfoRow label="Financial Year" value={order.financialYear} />
              {order.orderDocument && <InfoRow label="PO Document" href={order.orderDocument} />}
            </Paper>

            {/* ── Summary Stats ────────────────────────────── */}
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, 
              gap: 1.5, 
              mb: 3 
            }}>
              <Box sx={{ p: 2, bgcolor: alpha(BRAND.primary, 0.04), borderRadius: '12px', textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', mb: 0.5 }}>Order Qty</Typography>
                <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: BRAND.primary }}>{order.totalOrderQty?.toLocaleString('en-IN')}</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: alpha(BRAND.success, 0.04), borderRadius: '12px', textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', mb: 0.5 }}>Dispatched</Typography>
                <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: BRAND.success }}>{order.totalDispatchedQty?.toLocaleString('en-IN')}</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: alpha(BRAND.error, 0.04), borderRadius: '12px', textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', mb: 0.5 }}>Balance</Typography>
                <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: BRAND.error }}>{order.totalBalanceQty?.toLocaleString('en-IN')}</Typography>
              </Box>
            </Box>

            {/* ── SKU Items Table ──────────────────────────── */}
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
              SKU Line Items ({order.items?.length || 0})
            </Typography>
            <TableContainer component={Paper} sx={{ borderRadius: '12px', mb: 3, boxShadow: 'none', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 500 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#f8fafc' }}>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>SKU</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>Code</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>Order</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>Dispatched</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>Balance</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', color: '#475569' }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.items?.map((item, idx) => {
                    const pct = item.orderQty > 0 ? Math.round((item.dispatchedQty / item.orderQty) * 100) : 0;
                    const isDone = item.balanceQty <= 0;
                    return (
                      <TableRow key={item._id || idx}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} fontSize="0.8rem">{item.skuName}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" fontSize="0.75rem">{item.skuCode}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={700} fontSize="0.8rem">{item.orderQty?.toLocaleString('en-IN')}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600} fontSize="0.8rem" color={BRAND.success}>{item.dispatchedQty?.toLocaleString('en-IN')}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight={600} fontSize="0.8rem" color={isDone ? BRAND.success : BRAND.error}>
                            {item.balanceQty?.toLocaleString('en-IN')}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ px: 1, py: 0.3, borderRadius: '6px', bgcolor: alpha(isDone ? BRAND.success : BRAND.warning, 0.08), color: isDone ? BRAND.success : BRAND.warning, fontSize: '0.6rem', fontWeight: 700, textAlign: 'center' }}>
                            {isDone ? 'COMPLETE' : `${pct}%`}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            {/* ── Workflow Steps ────────────────────────────── */}
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
              Workflow Progress
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {WORKFLOW_STEPS.map((step) => {
                const data = order[step.key] || {};
                return (
                  <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: '10px', bgcolor: data.status === 'DONE' ? alpha(BRAND.success, 0.04) : '#fafbfc', border: '1px solid', borderColor: data.status === 'DONE' ? alpha(BRAND.success, 0.15) : '#f1f5f9' }}>
                    <StepIcon status={data.status} />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} fontSize="0.8rem">{step.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{step.who}</Typography>
                    </Box>
                    <Box sx={{ px: 1, py: 0.3, borderRadius: '6px', bgcolor: alpha(data.status === 'DONE' ? BRAND.success : data.status === 'DELAYED' ? BRAND.error : '#94a3b8', 0.1), color: data.status === 'DONE' ? BRAND.success : data.status === 'DELAYED' ? BRAND.error : '#94a3b8', fontSize: '0.6rem', fontWeight: 700 }}>
                      {data.status || 'PENDING'}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </>
        ) : null}
      </Box>

      {/* ── Footer ────────────────────────────────────────── */}
      <Box sx={{ p: 2, borderTop: '1px solid #e2e8f0', bgcolor: '#f8fafc' }}>
        <Button fullWidth variant="outlined" onClick={onClose} sx={{ borderColor: '#e2e8f0', color: '#475569' }}>
          Close
        </Button>
      </Box>
    </Drawer>
  );
};

export default OrderDetailDrawer;
