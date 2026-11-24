import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Typography, CircularProgress, Divider, Alert, Box,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApproveQuotationMutation } from '../../../store/api/procurementApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import ItemQuotationTable from './ItemQuotationTable';
import { itemRef, matchItemRow, legacyFallbackDocs, isItemEligibleForQuote } from './indentMeta';

/**
 * Step 1.3 — Approved Quotation 1.03.
 *
 * Item-wise: every indent line item gets its own approved-quotation upload
 * (PDF / image / Excel, multiple files allowed), actual date and remarks.
 * Reuses the quotations uploaded in Step 1.2 — the documents are loaded
 * automatically and the user simply removes the ones that are not approved. The
 * remaining files (same URLs, no re-upload) are submitted as the approved
 * quotation via `itemApprovedQuotations[]`. Requires Step 1.2 done.
 *
 * Each quoted item also names its Approved Vendor. It is saved on the indent
 * item and the Purchase Order for that item must use it. When Step 1.2 recorded
 * who sent each quotation, the choice is limited to the vendors whose quotation
 * is kept (the server enforces the same); older quotations that name no vendor
 * keep the full Vendor Master list.
 */
// Vendors named on the kept files → Approved Vendor options (lowest rate first seen).
const keptVendorOptions = (files) => {
  const byId = new Map();
  (files || []).forEach((f) => {
    if (!f.vendor?._id) return;
    const id = String(f.vendor._id);
    const rate = f.quotedRate === '' || f.quotedRate == null ? null : Number(f.quotedRate);
    const days = f.deliveryDays === '' || f.deliveryDays == null ? null : Number(f.deliveryDays);
    const cur = byId.get(id);
    if (!cur) { byId.set(id, { _id: id, name: f.vendor.name, quotedRate: rate, deliveryDays: days }); return; }
    if (rate != null && (cur.quotedRate == null || rate < cur.quotedRate)) cur.quotedRate = rate;
    if (days != null && (cur.deliveryDays == null || days < cur.deliveryDays)) cur.deliveryDays = days;
  });
  return [...byId.values()];
};
// Keep the pick only while its quotation is kept; one kept vendor is picked for you.
const reconcileVendor = (row) => {
  const kept = keptVendorOptions(row.files);
  if (!kept.length) return row;
  if (row.vendor && kept.some((v) => v._id === String(row.vendor._id))) return row;
  return { ...row, vendor: kept.length === 1 ? { _id: kept[0]._id, name: kept[0].name } : null };
};
const fileFromDoc = (d) => ({
  fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, uploadedAt: d.uploadedAt,
  vendor: d.vendorId ? { _id: String(d.vendorId), name: d.vendorName || '' } : null,
  quotedRate: d.quotedRate ?? '',
  deliveryDays: d.deliveryDays ?? '',
});
const todayStr = () => new Date().toISOString().slice(0, 10);

// Carry each item's Step 1.2 status forward into Step 1.3. Items that had a quote
// (YES) need an approved-quotation; items marked "Quote Not Required" in Step 1.2
// have nothing to approve. Uses the shared strict itemId-first matcher so a
// skuCode/itemName collision on another row never wins over the correct item.
const carriedItemStatus = (step12, it) => {
  const match = matchItemRow(step12?.itemQuotations, it);
  return match?.statusDone === 'QUOTE_NOT_REQUIRED' ? 'QUOTE_NOT_REQUIRED' : 'YES';
};

// Indent line items (multi-item, with legacy single-product fallback). Items
// rejected during indent approval (Step 1.1) never reach Step 1.3 either.
const itemsOf = (indent) => {
  if (indent?.items?.length) return indent.items.filter((it) => isItemEligibleForQuote(indent, it));
  if (indent?.productNameRevised) {
    return [{
      _id: 'legacy', itemName: indent.productNameRevised, skuCode: indent.skuCode,
      skuId: indent.skuId, quantity: indent.quantity, approvedQuantity: indent.approvedQuantity, unit: indent.unit,
    }];
  }
  return [];
};

const QuotationApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([]); // [{ itemId, skuId, skuCode, itemName, qty, unit, statusDone, files, actualAt, remarks }]

  const [approveQuotation, { isLoading: saving }] = useApproveQuotationMutation();
  const { data: vendorsRes, isLoading: vendorsLoading, isError: vendorsError, refetch: refetchVendors } = useGetVendorsQuery(
    { limit: 500, sort: 'name' }, { skip: !open },
  );
  const vendorOptions = (vendorsRes?.data || []).filter((v) => v.isActive !== false);

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quotationApprovalStep;
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');

    // Step 1.3 reuses the quotations uploaded in Step 1.2 — the user never
    // re-uploads. On first open, load each item's Step 1.2 documents; on re-edit,
    // restore the previously-kept approved selection so prior removals persist.
    // Matching is strictly itemId-first (matchItemRow) so a skuCode/itemName
    // collision between two lines never pulls in the wrong item's files.
    const step12 = indent?.quoteComparativeStep;
    const saved = existing?.itemApprovedQuotations || [];
    const indentItems = itemsOf(indent);
    const step12Items = step12?.itemQuotations || [];
    // Legacy flat Step 1.2 docs — only valid for a true single-item/pre-item-wise
    // indent, never spread across multiple items.
    const step12FlatDocs = legacyFallbackDocs(step12Items, indentItems, step12?.quotationDocuments, step12?.quotationUploaded);

    setRows(indentItems.map((it, i) => {
      const s = matchItemRow(saved, it);
      const s12 = matchItemRow(step12Items, it);
      const sourceDocs = s?.approvedQuotationDocuments?.length
        ? s.approvedQuotationDocuments                     // re-edit: prior approved selection
        : (s12?.quotationDocuments?.length
          ? s12.quotationDocuments                         // first open: reuse Step 1.2 files
          : step12FlatDocs);                                // legacy flat fallback (single-item only)
      // Reuse the original file references verbatim — same URL, no new upload.
      // Vendor tags always come from Step 1.2's copy of the file.
      const step12ByUrl = new Map((s12?.quotationDocuments || []).map((d) => [d.fileUrl, d]));
      const files = sourceDocs
        .filter((d) => d?.fileUrl)
        .map((d) => fileFromDoc(step12ByUrl.get(d.fileUrl) || d));
      return reconcileVendor({
        itemId: it._id && it._id !== 'legacy' ? it._id : undefined,
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || '',
        itemDisplayNumber: itemRef(indent?.indentNumber, it, i),
        qty: it.approvedQuantity || it.quantity,
        unit: it.unit || 'Pcs',
        // Status is carried from Step 1.2 — never chosen here.
        statusDone: carriedItemStatus(step12, it),
        files,
        actualAt: s?.actualAt ? s.actualAt.slice(0, 10) : '',
        remarks: s?.remarks || '',
        // Approved vendor already recorded for this item (re-edit before any PO).
        vendor: it.vendorSource === 'APPROVED_QUOTATION' && it.vendorId ? { _id: String(it.vendorId), name: it.vendorName } : null,
      });
    }));
  }, [open, indent]);

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const removeFile = (idx, fileIdx) => setRows((cur) => cur.map((r, i) => (i === idx
    ? reconcileVendor({ ...r, files: r.files.filter((_, fi) => fi !== fileIdx) })
    : r)));

  // Approved Vendor options per item: the vendors whose kept quotation names them;
  // an item whose quotations name no vendor (older record) → Vendor Master.
  const vendorOptionsFor = (row) => {
    const kept = keptVendorOptions(row.files);
    return kept.length ? kept : vendorOptions;
  };
  // Legacy fallback (intentional): quotations saved before vendors were recorded
  // name no vendor, so the item keeps the Vendor Master choice (the server
  // applies the same rule). Once any kept quotation names a vendor, only those count.
  const untaggedKept = (row) => (row.files || []).filter((f) => !f.vendor?._id).length;
  const vendorHint = (row) => {
    const kept = keptVendorOptions(row.files);
    const older = untaggedKept(row);
    if (kept.length) {
      return `Only vendors whose quotation is kept (${kept.length})${older ? ` · ${older} older quotation${older === 1 ? '' : 's'} name no vendor` : ''}`;
    }
    return 'Older quotation — no vendor was recorded, so any active vendor can be selected';
  };
  const legacyRows = rows.filter((r) => r.statusDone === 'YES' && r.itemId && r.files.length && !keptVendorOptions(r.files).length);
  // Award summary: one PO per vendor will follow.
  const awards = (() => {
    const byVendor = new Map();
    rows.filter((r) => r.statusDone === 'YES' && r.vendor?._id).forEach((r) => {
      const k = String(r.vendor._id);
      if (!byVendor.has(k)) byVendor.set(k, { name: r.vendor.name, items: [] });
      byVendor.get(k).items.push(r.itemDisplayNumber || r.itemName);
    });
    return [...byVendor.values()];
  })();
  const pendingVendor = rows.filter((r) => r.statusDone === 'YES' && r.itemId && !r.vendor?._id).length;

  const handleSubmit = async () => {
    // Each carried-YES item must keep ≥1 quotation to be approved; "Quote Not
    // Required" items have nothing to approve and are exempt.
    const missing = rows.find((r) => r.statusDone === 'YES' && r.files.length === 0);
    if (missing) {
      enqueueSnackbar(`Keep at least one approved quotation for "${missing.itemName}"`, { variant: 'warning' });
      return;
    }
    const noVendor = rows.find((r) => r.statusDone === 'YES' && r.itemId && !r.vendor?._id);
    if (noVendor) {
      enqueueSnackbar(`Select the approved vendor for "${noVendor.itemName}"`, { variant: 'warning' });
      return;
    }
    // statusDone is NOT sent — Step 1.3 carries it from Step 1.2 (the backend
    // derives it). The kept documents reuse Step 1.2's file references verbatim
    // (same URL + uploadedAt) so nothing is uploaded or stored twice.
    try {
      await approveQuotation({
        id: indent._id,
        itemApprovedQuotations: rows.map((r) => ({
          itemId: r.itemId,
          skuId: r.skuId,
          skuCode: r.skuCode,
          itemName: r.itemName,
          statusDone: r.statusDone,
          approvedQuotationDocuments: r.files.map((f) => ({ fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType, uploadedAt: f.uploadedAt })),
          vendorId: r.statusDone === 'YES' ? (r.vendor?._id || null) : null,
          actualAt: r.actualAt || actualAt,
          remarks: r.remarks?.trim() || '',
        })),
        actualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Quotation approval recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Approved Quotation 1.03 — Vendor Selection</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField label="Indent No" fullWidth value={indent?.indentNumber || ''} InputProps={{ readOnly: true }} disabled />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Step No" select fullWidth value="Step 1.3" disabled>
              <MenuItem value="Step 1.3">Step 1.3</MenuItem>
            </TextField>
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />
        {/* Status is carried from Step 1.2 — the user is not asked to pick it again. */}
        <Typography variant="body2" sx={{ mb: 1.5, p: 1.25, borderRadius: '8px', bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>
          Status carried from Receive Quote (Step 1.2): YES
        </Typography>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>
          Approve the quotation and select the vendor for each item
        </Typography>
        {legacyRows.length > 0 && (
          <Alert severity="info" sx={{ mb: 1.5 }} data-testid="legacy-vendor-note">
            {legacyRows.length === 1 ? '1 item has' : `${legacyRows.length} items have`} quotations saved before vendors were recorded
            ({legacyRows.map((r) => r.itemDisplayNumber || r.itemName).join(', ')}). For {legacyRows.length === 1 ? 'it' : 'them'} any active vendor
            can be selected; to limit the choice to the vendors who quoted, name the vendor on each quotation in Receive Quote (Step 1.2).
          </Alert>
        )}
        <ItemQuotationTable
          rows={rows}
          qtyLabel="Approved Qty"
          uploadLabel="Quotation (from Step 1.2)"
          yesValue="YES"
          hideStatus
          noUpload
          onRemoveFile={removeFile}
          onPatchRow={patchRow}
          vendorOptions={vendorOptionsFor}
          vendorHint={vendorHint}
          vendorsLoading={vendorsLoading}
        />
        <Box data-testid="vendor-award-summary" sx={{ mt: 1.5, p: 1.25, borderRadius: '10px', border: '1px solid', borderColor: 'divider', bgcolor: '#f8fafc' }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase' }}>
            Vendor award · {awards.length} PO{awards.length === 1 ? '' : 's'} will be raised
          </Typography>
          {awards.length ? awards.map((a) => (
            <Typography key={a.name} variant="body2" sx={{ mt: 0.5 }} data-testid="vendor-award-row">
              <b>{a.name}</b> — {a.items.length} item{a.items.length === 1 ? '' : 's'}: {a.items.join(', ')}
            </Typography>
          )) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>No vendor selected yet.</Typography>
          )}
          {pendingVendor > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5, color: '#b45309', fontWeight: 600 }} data-testid="vendor-award-pending">
              {pendingVendor} item{pendingVendor === 1 ? '' : 's'} still need{pendingVendor === 1 ? 's' : ''} a vendor
            </Typography>
          )}
        </Box>
        {vendorsError && (
          <Alert severity="error" sx={{ mt: 1 }} action={<Button size="small" onClick={() => refetchVendors()}>Retry</Button>}>
            Could not load the Vendor Master — the approved vendor cannot be selected.
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Quotations from Step 1.2 are loaded automatically. Remove the ones not approved — the remaining quotation(s) are saved as the approved quotation. No re-upload needed.
          Select the vendor whose quotation is approved for each item — only vendors who quoted in Step 1.2 are offered, and each vendor gets its own Purchase Order.
        </Typography>

        <Divider sx={{ my: 1.5 }} />
        <Grid container spacing={2}>
          <Grid item xs={12} sm={5}>
            <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt} onChange={setActualAt} />
          </Grid>
          <Grid item xs={12} sm={7}>
            <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuotationApprovalDialog;
