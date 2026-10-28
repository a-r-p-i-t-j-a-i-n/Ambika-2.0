import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Table, TableHead, TableBody, TableRow, TableCell } from '@mui/material';
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import { ApprovalChip, itemRef } from './indentMeta';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '');
const qtyOf = (v) => (v || v === 0 ? v : '—');

/**
 * Indent quick view (row eye icon on the Indents and quotation-step lists).
 * Read-only, built from the list row itself; legacy single-product indents
 * show their one product as the only line.
 */
const IndentQuickViewDialog = ({ indent, onClose }) => {
  const navigate = useNavigate();
  const items = indent
    ? (indent.items?.length ? indent.items : (indent.productNameRevised ? [{
      itemName: indent.productNameRevised, skuCode: indent.skuCode, quantity: indent.quantity, unit: indent.unit,
      revisedQuantity: indent.revisedQuantity, approvedQuantity: indent.approvedQuantity,
    }] : []))
    : [];

  return (
    <RowQuickViewDialog
      open={Boolean(indent)}
      onClose={onClose}
      title="Indent Details"
      number={indent?.indentNumber}
      status={indent?.approvalStatus ? <ApprovalChip status={indent.approvalStatus} /> : null}
      subtitle={indent ? [indent.department, indent.raisedBy].filter(Boolean).join(' · ') : ''}
      fields={indent ? [
        { label: 'Date', value: fmtDate(indent.timestamp) },
        { label: 'Type', value: indent.requestType === 'INTERNAL_SERVICE' ? 'Service' : 'Material' },
        { label: 'Raised By', value: indent.raisedBy },
        { label: 'Department', value: indent.department },
        { label: 'Items', value: items.length },
        { label: 'Status', value: indent.overallStatus?.replace(/_/g, ' ') },
      ] : []}
      openFullLabel="Open full indent"
      onOpenFull={indent ? () => navigate(`/procurement/indents/${indent._id}`) : undefined}
    >
      {items.length > 0 && (
        <Box sx={{ mt: 2, border: `1px solid ${PFMS.line}`, borderRadius: '8px', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 520 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={pfmsTableHeadSx}>Item Ref</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={pfmsTableHeadSx}>SKU</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Qty</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Revised</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Approved</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={it._id || i}>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700, color: 'primary.main' }}>{itemRef(indent.indentNumber, it, i)}</TableCell>
                  <TableCell><Typography variant="body2" sx={{ color: PFMS.ink, fontWeight: 600 }}>{it.itemName || '—'}</Typography></TableCell>
                  <TableCell sx={{ color: PFMS.sub, whiteSpace: 'nowrap' }}>{it.skuCode || '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: PFMS.ink }}>
                    {qtyOf(it.quantity)} {it.unit || ''}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: PFMS.ink }}>{qtyOf(it.revisedQuantity)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0f766e' }}>{qtyOf(it.approvedQuantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </RowQuickViewDialog>
  );
};

export default IndentQuickViewDialog;
