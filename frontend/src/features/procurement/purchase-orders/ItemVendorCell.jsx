import React from 'react';
import { Box, Typography } from '@mui/material';
import { VENDOR_SOURCE_LABEL } from './itemVendor';

/** Vendor column cell for an approved-item row (Pending for PO). */
const ItemVendorCell = ({ row }) => {
  if (row.vendorState === 'MISSING') {
    return (
      <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
        <Typography variant="body2" fontWeight={700} sx={{ color: 'error.main' }} noWrap>Approved vendor missing</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>Confirm from the approved quotation</Typography>
      </Box>
    );
  }
  if (row.vendorState === 'SET') {
    return (
      <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
        <Typography variant="body2" fontWeight={700} noWrap title={row.vendorName}
          sx={{ color: row.vendorUnavailable ? 'error.main' : 'text.primary' }}>
          {row.vendorName}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {row.vendorUnavailable ? 'Inactive / removed in Vendor Master' : VENDOR_SOURCE_LABEL[row.vendorSource]}
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
      <Typography variant="body2" color="text.secondary" noWrap>Not selected</Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>Choose here or in the PO form</Typography>
    </Box>
  );
};

export default ItemVendorCell;
