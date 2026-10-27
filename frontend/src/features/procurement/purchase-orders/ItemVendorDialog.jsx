import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Autocomplete,
  Typography, CircularProgress, Alert, Box,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSetItemVendorMutation } from '../../../store/api/procurementApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import StatusChip from '../components/StatusChip';

/**
 * Pending for PO — fix the vendor that will supply one approved indent item.
 *  - Quotation not required: select / change / clear the vendor (the PO form then
 *    auto-fills and locks to it). Steps 1.2/1.3 are never opened.
 *  - Quotation required, approved before vendors were recorded: confirm the vendor
 *    from the approved quotation (one-time — afterwards it is locked).
 * Vendors come from the Vendor Master (active records only); the server re-checks
 * the vendor and the item's workflow state. Mount it with key = the row's item id
 * so the selection starts from that row's saved vendor.
 */
const ItemVendorDialog = ({ open, onClose, row }) => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmMode = row?.quotationPath === 'REQUIRED';
  const [vendor, setVendor] = useState(() => (row?.vendorId ? { _id: String(row.vendorId), name: row.vendorName } : null));

  const { data: vendorsRes, isLoading, isError, refetch } = useGetVendorsQuery({ limit: 500, sort: 'name' }, { skip: !open });
  const options = useMemo(() => (vendorsRes?.data || []).filter((v) => v.isActive !== false), [vendorsRes]);
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
      <DialogTitle sx={{ fontWeight: 800 }}>{confirmMode ? 'Confirm Approved Vendor' : 'Select Vendor'}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
          <Typography variant="body2" fontWeight={700} color="primary.main">{row?.indentItemDisplayNumber}</Typography>
          <StatusChip status={row?.quoteNotRequired ? 'QUOTE_NOT_REQUIRED' : 'YES'} />
        </Box>
        <Typography variant="body2" fontWeight={600}>{row?.itemName}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {[row?.skuCode && `SKU: ${row.skuCode}`, `Approved: ${row?.approvedQuantity ?? '—'} ${row?.unit || ''}`].filter(Boolean).join(' · ')}
        </Typography>

        {confirmMode ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This item&apos;s quotation was approved before the approved vendor was recorded. Select the vendor whose
            quotation was approved — it is saved with the approval and cannot be changed afterwards.
          </Alert>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            No quotation was required for this item. The vendor chosen here is used for its Purchase Order and can be
            changed until a PO is raised.
          </Alert>
        )}

        {isError ? (
          <Alert severity="error" action={<Button size="small" onClick={() => refetch()}>Retry</Button>}>
            Could not load the Vendor Master.
          </Alert>
        ) : (
          <Autocomplete
            options={options}
            loading={isLoading}
            value={vendor}
            onChange={(_e, v) => setVendor(v)}
            getOptionLabel={(o) => o?.name || ''}
            isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
            noOptionsText={isLoading ? 'Loading vendors…' : 'No active vendors in the Vendor Master'}
            renderOption={(props, o) => (
              <Box component="li" {...props} key={o._id} sx={{ display: 'block !important', py: 0.75 }}>
                <Typography variant="body2" fontWeight={700}>{o.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[o.gstNo && `GST: ${o.gstNo}`, o.phone, o.email].filter(Boolean).join(' · ') || '—'}
                </Typography>
              </Box>
            )}
            renderInput={(params) => (
              <TextField {...params} label={confirmMode ? 'Approved Vendor *' : 'Vendor *'} placeholder="Select from Vendor Master"
                InputProps={{ ...params.InputProps, endAdornment: (<>{isLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
            )}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {!confirmMode && row?.vendorId ? (
          <Button color="error" onClick={() => save(null)} disabled={saving} sx={{ mr: 'auto' }}>Clear vendor</Button>
        ) : null}
        <Button onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => save(vendor?._id)} disabled={saving || !vendor || unchanged}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}>
          {confirmMode ? 'Confirm Vendor' : 'Save Vendor'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ItemVendorDialog;
