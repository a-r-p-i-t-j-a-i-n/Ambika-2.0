import React from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { fmtINR } from './poMeta';
import { pfmsTableHeadSx } from '../pfmsTheme';

/**
 * PO line items + financial summary. Shared by the PO Detail page's Items card
 * and the Purchase Orders list's item quick-view popup, so both always show the
 * same columns and the same stored amounts (nothing is recomputed here).
 * The table scrolls sideways when narrower than its content; item names wrap,
 * refs / SKUs stay on one line.
 */
const headSx = { ...pfmsTableHeadSx, whiteSpace: 'nowrap' };

const PoItemsTable = ({ po }) => (
  <>
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {['#', 'Item Ref', 'Item', 'SKU'].map((h) => <TableCell key={h} sx={headSx}>{h}</TableCell>)}
            <TableCell align="right" sx={headSx}>Qty</TableCell>
            <TableCell sx={headSx}>Unit</TableCell>
            <TableCell align="right" sx={headSx}>Rate</TableCell>
            <TableCell align="right" sx={headSx}>Taxable</TableCell>
            <TableCell align="center" sx={headSx}>GST %</TableCell>
            <TableCell align="right" sx={headSx}>Tax</TableCell>
            <TableCell align="right" sx={headSx}>Total</TableCell>
            <TableCell align="right" sx={headSx}>Received</TableCell>
            <TableCell align="right" sx={headSx}>Pending</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(po.items || []).map((it, i) => (
            <TableRow key={it._id || i} hover>
              <TableCell>{i + 1}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Typography variant="body2" color="primary.main" fontWeight={700}>
                  {it.indentItemDisplayNumber || it.indentNumber || '—'}
                </Typography>
              </TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 180, overflowWrap: 'anywhere' }}>{it.itemName}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
              <TableCell align="right">{it.quantity}</TableCell>
              <TableCell>{it.unit}</TableCell>
              <TableCell align="right">{Number(it.rate || 0).toFixed(2)}</TableCell>
              <TableCell align="right">{Number(it.taxableAmount || 0).toFixed(2)}</TableCell>
              <TableCell align="center">{it.gstRate || 0}%</TableCell>
              <TableCell align="right">{Number(it.taxAmount || 0).toFixed(2)}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{Number(it.totalAmount || 0).toFixed(2)}</TableCell>
              <TableCell align="right" sx={{ color: '#0f766e' }}>{it.receivedQty || 0}</TableCell>
              <TableCell align="right" sx={{ color: it.pendingQty > 0 ? '#b45309' : '#0f766e' }}>{it.pendingQty || 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    <Divider sx={{ my: 2 }} />
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL TAXABLE VALUE</Typography>
        <Typography fontWeight={700}>{fmtINR(po.totalTaxableValue)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>GST</Typography>
        <Typography fontWeight={700}>{fmtINR(po.totalGSTAmount)}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', px: 2, py: 1, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.06) }}>
        <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
        <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(po.grandTotal)}</Typography>
      </Box>
    </Box>
  </>
);

export default PoItemsTable;
