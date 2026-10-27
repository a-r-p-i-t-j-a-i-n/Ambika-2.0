import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, Chip, Table, TableBody, TableCell, TableHead, TableRow,
  TablePagination, Skeleton, Tooltip,
} from '@mui/material';
import { ShoppingCart } from 'lucide-react';
import { useGetPurchaseOrdersQuery } from '../../../store/api/procurementApi';
import { PoStatusChip, fmtINR, poDisplayNumber } from '../purchase-orders/poMeta';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const SHOWN_LINES = 3;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// JSL lines may carry grade / width / finish instead of an item name.
const lineName = (l) => l.itemName || l.itemDescription || [l.grade, l.width, l.finish].filter(Boolean).join(' ') || '—';
const lineText = (l) => `${lineName(l)}${l.skuCode ? ` (${l.skuCode})` : ''} — ${Number(l.quantity || 0).toLocaleString('en-IN')} ${l.unit || ''}`.trim();

/**
 * Purchase Orders raised against ONE vendor — derived from the PO records
 * themselves (GET /procurement/purchase-orders?vendorId=…), so it always shows
 * each PO's current status and nothing is stored twice. One row per PO; a
 * multi-item PO lists its lines inside that row. Matched by the vendor id the
 * PO stores — older POs that recorded a Party id instead are not shown here.
 */
const VendorPoHistory = ({ vendorId }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data, isLoading, isFetching, isError } = useGetPurchaseOrdersQuery(
    { vendorId, page: page + 1, limit: rowsPerPage, sort: '-poDate,-createdAt' },
    { skip: !vendorId },
  );
  const rows = data?.data || [];
  const total = data?.meta?.total ?? rows.length;

  return (
    <Paper sx={{ ...pfmsCardSx, overflow: 'hidden', mt: 2 }} data-testid="vendor-po-history">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ShoppingCart size={16} color={BRAND_DK} />
          <Typography sx={{ fontWeight: 800, color: BRAND_DK }}>Purchase Order History</Typography>
        </Stack>
        <Chip size="small" data-testid="vendor-po-count" label={`${total} PO${total === 1 ? '' : 's'}`}
          sx={{ fontWeight: 700, bgcolor: alpha(BRAND, 0.08), color: BRAND_DK }} />
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 760, '& td, & th': { fontSize: '0.8rem', verticalAlign: 'top' } }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(BRAND, 0.05) }}>
              <TableCell sx={{ fontWeight: 800 }}>PO Number</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Order Date</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Items (SKU) — Qty</TableCell>
              <TableCell sx={{ fontWeight: 800 }} align="right">Amount</TableCell>
              <TableCell sx={{ fontWeight: 800 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && [0, 1, 2].map((i) => (
              <TableRow key={i}><TableCell colSpan={5}><Skeleton height={28} /></TableCell></TableRow>
            ))}
            {!isLoading && rows.map((po) => {
              const lines = po.items || [];
              const extra = lines.slice(SHOWN_LINES);
              return (
                <TableRow key={po._id} hover data-testid="vendor-po-row" data-po={poDisplayNumber(po)}
                  onClick={() => navigate(`/procurement/purchase-orders/${po._id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: BRAND }}>{poDisplayNumber(po)}</Typography>
                    {po.revisionNo > 0 && (
                      <Typography sx={{ fontSize: '0.7rem', color: PFMS.sub }}>
                        Revision {po.revisionNo}{po.revisedFromPoNumber ? ` of ${po.revisedFromPoNumber}` : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: PFMS.ink }}>{fmtDate(po.poDate || po.createdAt)}</TableCell>
                  <TableCell sx={{ color: PFMS.ink }}>
                    {lines.slice(0, SHOWN_LINES).map((l, i) => (
                      <Typography key={l._id || i} sx={{ fontSize: '0.78rem', color: PFMS.ink }} data-testid="vendor-po-line">{lineText(l)}</Typography>
                    ))}
                    {extra.length > 0 && (
                      <Tooltip title={extra.map(lineText).join('\n')} componentsProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: BRAND }}>+{extra.length} more item{extra.length === 1 ? '' : 's'}</Typography>
                      </Tooltip>
                    )}
                    {!lines.length && '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 700, color: PFMS.ink }}>{fmtINR(po.grandTotal)}</TableCell>
                  <TableCell><PoStatusChip status={po.poStatus} /></TableCell>
                </TableRow>
              );
            })}
            {!isLoading && !rows.length && (
              <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>
                {isError ? 'Could not load purchase orders.' : 'No purchase orders for this vendor yet.'}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      {total > 10 && (
        <TablePagination component="div" count={total} page={page} rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 25, 50]} sx={{ opacity: isFetching ? 0.6 : 1 }}
          onPageChange={(_e, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }} />
      )}
    </Paper>
  );
};

export default VendorPoHistory;
