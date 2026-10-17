import React from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { pfmsPageSx } from '../pfmsTheme';
import VoucherPanel from './VoucherPanel';

/**
 * Standalone Voucher detail route — thin wrapper around VoucherPanel, which
 * holds all the actual voucher business logic and UI. Kept as its own route
 * (and its own page chrome/back button) so existing direct links to
 * /procurement/vouchers/:id keep working unchanged, including for Expense
 * vouchers (which have no invoice and are only reachable this way).
 */
const VoucherDetail = () => {
  const { id } = useParams();
  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <VoucherPanel voucherId={id} backTo="/purchase-fms/payment-vouchers" notFoundMessage="Voucher not found" />
    </Box>
  );
};

export default VoucherDetail;
