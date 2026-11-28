import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, CircularProgress, Alert, Box,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSetItemVendorMutation } from '../../../store/api/procurementApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import StatusChip from '../components/StatusChip';
import ItemVendorPicker from './ItemVendorPicker';

/**
 * Pending for PO — fix the vendor that will supply one approved indent item.
 *  - Quotation not required: select / change / clear the vendor (the PO form then
 *    auto-fills and locks to it). Steps 1.2/1.3 are never opened.
 *  - Quotation required, approved before vendors were recorded: confirm the vendor
 *    from the approved quotation (one-time — afterwards it is locked).
 * Two ways to choose, same as on the PO form (ItemVendorPicker): Select Previous Vendor (row.previousVendors —
 * the vendors that supplied the item before, placed POs) or Add New Vendor (any active Vendor Master vendor,
 * history or not). Nothing is selected for the user; the server re-checks the vendor and the item's workflow
 * state. Mount it with key = the row's item id so the selection starts from that row's saved vendor.
 */
const ItemVendorDialog = ({ open, onClose, row }) => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmMode = row?.quotationPath === 'REQUIRED';
  const [vendor, setVendor] = useState(() => (row?.vendorId ? { _id: String(row.vendorId), name: row.vendorName } : null));

  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery({ limit: 500, sort: 'name' }, { skip: !open });
  const vendors = useMemo(() => vendorsRes?.data || [], [vendorsRes]);
  const [saveVendor, { isLoading: saving }] = useSetItemVendorMutation();

  const save = async (vendorId) => {
    try {
      await saveVendor({ indentId: row.indentId, indentItemId: row.indentItemId, vendorId: vendorId || null }).unwrap();
      enqueueSnackbar(vendorId
        ? `${confirmMode ? 'Approved vendor confirmed' : 'Vendor selected'} for ${row.indentItemDisplayNumber}`
        : `Vendor cleared for ${row.indentItemDisplayNumber}`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save the vendor', { variant: 'error' });
    }
  };

  const unchanged = String(vendor?._id || '') === String(row?.vendorId || '');

  return (
    <Dialog open={open} onClose={() => !saving && onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Select Vendor</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
          <Typography variant="body2" fontWeight={700} color="primary.main">{row?.indentItemDisplayNumber}</Typography>
          <StatusChip status={row?.quoteNotRequired ? 'QUOTE_NOT_REQUIRED' : 'YES'} />
        </Box>
        <Typography variant="body2" fontWeight={600}>{row?.itemName}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {[row?.skuCode && `SKU: ${row.skuCode}`, `Approved: ${row?.approvedQuantity ?? '—'} ${row?.unit || ''}`].filter(Boolean).join(' · ')}
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          {confirmMode
            ? 'The vendor is optional until the PO. One chosen here is saved with the approval and used by the PO.'
            : 'No quotation was required for this item. The vendor chosen here is used for its Purchase Order and can be changed until a PO is raised.'}
          {' '}Choose a vendor that supplied this item before, or add any active vendor from the Vendor Master.
        </Alert>

        <ItemVendorPicker row={row} vendors={vendors} loading={vendorsLoading} value={vendor} onChange={setVendor} testId="item-vendor-pick" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {!confirmMode && row?.vendorId ? (
          <Button color="error" onClick={() => save(null)} disabled={saving} sx={{ mr: 'auto' }}>Clear vendor</Button>
        ) : null}
        <Button onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => save(vendor?._id)} disabled={saving || !vendor || unchanged}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}>
          Save Vendor
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ItemVendorDialog;
