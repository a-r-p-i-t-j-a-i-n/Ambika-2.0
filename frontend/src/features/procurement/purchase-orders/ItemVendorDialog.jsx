import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Autocomplete,
  Typography, CircularProgress, Alert, Box,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSetItemVendorMutation } from '../../../store/api/procurementApi';
import StatusChip from '../components/StatusChip';
import { fmtDate } from './poMeta';

/**
 * Pending for PO — fix the vendor that will supply one approved indent item.
 *  - Quotation not required: select / change / clear the vendor (the PO form then
 *    auto-fills and locks to it). Steps 1.2/1.3 are never opened.
 *  - Quotation required, approved before vendors were recorded: confirm the vendor
 *    from the approved quotation (one-time — afterwards it is locked).
 * Vendors offered are the item's ELIGIBLE vendors only (row.eligibleVendors: quoted for it at Step 1.2
 * OR supplied it before — placed POs / Vendor Master item list) — never the whole Vendor Master; the server re-checks the vendor
 * and the item's workflow state. Mount it with key = the row's item id
 * so the selection starts from that row's saved vendor.
 */
const ItemVendorDialog = ({ open, onClose, row }) => {
  const { enqueueSnackbar } = useSnackbar();
  const confirmMode = row?.quotationPath === 'REQUIRED';
  const [vendor, setVendor] = useState(() => (row?.vendorId ? { _id: String(row.vendorId), name: row.vendorName } : null));

  const options = useMemo(() => (row?.eligibleVendors || []).map((h) => ({
    _id: String(h.vendorId), name: h.vendorName,
    caption: [h.quoted ? `Quoted${h.quotedRate != null ? ` ₹${h.quotedRate}/${row?.unit || 'unit'}` : ''}${h.deliveryDays != null ? ` · ${h.deliveryDays} day(s)` : ''}` : '', h.location, h.poCount ? `${h.poCount} PO${h.poCount > 1 ? 's' : ''}${h.lastPoDate ? ` · last ${fmtDate(h.lastPoDate)}` : ''}${h.lastPoNumber ? ` (${h.lastPoNumber})` : ''}` : '', h.inCatalog ? 'In Vendor Master item list' : '']
      .filter(Boolean).join(' · '),
  })), [row]);
  const isLoading = false;
  const noHistory = options.length === 0;
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
          {' '}Only vendors that quoted for this item or have supplied it before are offered.
        </Alert>

        {noHistory ? (
          <Alert severity="warning" data-testid="item-vendor-no-history">No eligible vendors found for this item — none has quoted for it or supplied it before.</Alert>
        ) : (
          <Autocomplete
            options={options}
            loading={isLoading}
            value={vendor}
            onChange={(_e, v) => setVendor(v)}
            getOptionLabel={(o) => o?.name || ''}
            isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
            noOptionsText="No eligible vendors found"
            renderOption={(props, o) => (
              <Box component="li" {...props} key={o._id} sx={{ display: 'block !important', py: 0.75 }}>
                <Typography variant="body2" fontWeight={700}>{o.name}</Typography>
                <Typography variant="caption" color="text.secondary">{o.caption || '—'}</Typography>
              </Box>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Vendor *" placeholder="Select an eligible vendor"
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
          Save Vendor
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ItemVendorDialog;
