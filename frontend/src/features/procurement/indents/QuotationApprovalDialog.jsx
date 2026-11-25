import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Typography, CircularProgress, Divider, Alert, Box, Switch, Checkbox, FormControlLabel,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApproveQuotationMutation, useGetIndentItemVendorHistoryQuery } from '../../../store/api/procurementApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import ApprovedVendorTable from './ApprovedVendorTable';
import StatusChip from '../components/StatusChip';
import { PFMS } from '../pfmsTheme';
import { fmtDate } from '../purchase-orders/poMeta';
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
 * Each quoted item is decided on its own and can be submitted independently:
 *   Approved   goes on to Purchase Orders. Its vendor is OPTIONAL here: one chosen (from the
 *              item's ELIGIBLE vendors — quoted at Step 1.2 OR previously supplied) is saved
 *              and used by the PO; otherwise the PO's vendor is chosen on the PO form, from
 *              the same eligible vendors
 *   On Hold    "Hold / Keep Pending" — kept on Step 1.3 for later, never in a PO
 *   Pending    an item left unticked in Select Items mode (or saved as pending earlier)
 * "Select Items" mode: each quoted row gets a checkbox in place of its serial number and ONLY
 * the ticked items are approved; unticked ones are saved as pending and never reach a PO.
 * The step is complete once every quoted item is approved.
 */
const fileFromDoc = (d) => ({
  fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, uploadedAt: d.uploadedAt,
  vendor: d.vendorId ? { _id: String(d.vendorId), name: d.vendorName || '' } : null,
  quotedRate: d.quotedRate ?? '',
  deliveryDays: d.deliveryDays ?? '',
});
const todayStr = () => new Date().toISOString().slice(0, 10);

// Item vendor sources (indent item .vendorSource). A "Quote Required? = No" item keeps
// the vendor chosen in Step 1.2 / Pending for PO as PO_PREPARATION; a quoted item keeps
// the vendor approved here as APPROVED_QUOTATION.
const SOURCE_APPROVED = 'APPROVED_QUOTATION';

// Why an eligible vendor is offered — shown under its name in the picker: it quoted for the item
// (Step 1.2) and/or has supplied it before (placed PO / Vendor Master item list).
const eligibleCaption = (h) => {
  const parts = [];
  if (h.quoted) parts.push('Quoted');
  if (h.poCount || h.inCatalog) parts.push('Previous vendor');
  if (h.location) parts.push(h.location);
  if (h.poCount) {
    parts.push(`${h.poCount} PO${h.poCount > 1 ? 's' : ''}${h.lastPoDate ? ` · last ${fmtDate(h.lastPoDate)}` : ''}${h.lastPoNumber ? ` (${h.lastPoNumber})` : ''}`);
  }
  if (h.inCatalog) parts.push('In Vendor Master item list');
  return parts.join(' · ');
};

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

// Where an item stands (the summary counts and the Submit payload both read this):
//   NO_QUOTE  Quote Required = No — nothing to approve here
//   APPROVED  goes on to PO — a vendor is optional here
//   ON_HOLD   "Hold / Keep Pending"
//   PENDING   left unticked in Select Items mode (saved as pending, kept for later)
// With Select Items OFF every quoted item that is not on hold is approved (as always); with it ON
// only the ticked ones are.
const decisionOf = (r, selectMode = false) => {
  if (r.statusDone !== 'YES') return 'NO_QUOTE';
  if (r.locked) return 'APPROVED';
  if (r.hold) return 'ON_HOLD';
  if (selectMode && !r.selected) return 'PENDING';
  return 'APPROVED';
};

const QuotationApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([]); // [{ itemId, skuId, skuCode, itemName, qty, unit, statusDone, files, actualAt, remarks, vendor, hold, locked, selected }]
  const [selectMode, setSelectMode] = useState(false); // Select Items: only ticked items are approved

  const [approveQuotation, { isLoading: saving }] = useApproveQuotationMutation();
  // The vendors an item may be approved for: its ELIGIBLE vendors — quoted at Step 1.2 OR previously
  // supplied (purchase history + Vendor Master item list). Served — and re-checked on save — by the API.
  const { data: historyRes, isError: historyError, refetch: refetchHistory } = useGetIndentItemVendorHistoryQuery(
    indent?._id, { skip: !open || !indent?._id, refetchOnMountOrArgChange: true },
  );
  const historyByItem = useMemo(() => {
    const map = {};
    (historyRes?.data?.items || []).forEach((h) => { map[String(h.itemId)] = h.eligibleVendors || h.vendors || []; });
    return map;
  }, [historyRes]);

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quotationApprovalStep;
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');

    // Step 1.3 reuses the quotations uploaded in Step 1.2 — the user never
    // re-uploads. On first open, load each item's Step 1.2 documents; on re-edit,
    // restore the previously-saved selection (vendor, hold, kept files, date, remarks)
    // so nothing already recorded is lost.
    // Matching is strictly itemId-first (matchItemRow) so a skuCode/itemName
    // collision between two lines never pulls in the wrong item's files.
    const step12 = indent?.quoteComparativeStep;
    const saved = existing?.itemApprovedQuotations || [];
    const indentItems = itemsOf(indent);
    const step12Items = step12?.itemQuotations || [];
    // Legacy flat Step 1.2 docs — only valid for a true single-item/pre-item-wise
    // indent, never spread across multiple items.
    const step12FlatDocs = legacyFallbackDocs(step12Items, indentItems, step12?.quotationDocuments, step12?.quotationUploaded);

    const built = indentItems.map((it, i) => {
      const s = matchItemRow(saved, it);
      const s12 = matchItemRow(step12Items, it);
      const heldOrPending = ['ON_HOLD', 'PENDING'].includes(s?.statusDone);
      const sourceDocs = s?.approvedQuotationDocuments?.length || heldOrPending
        ? (s.approvedQuotationDocuments || [])             // re-edit: prior kept selection (a held item may keep none)
        : (s12?.quotationDocuments?.length
          ? s12.quotationDocuments                         // first open: reuse Step 1.2 files
          : step12FlatDocs);                                // legacy flat fallback (single-item only)
      // Reuse the original file references verbatim — same URL, no new upload.
      // Vendor tags always come from Step 1.2's copy of the file.
      const step12ByUrl = new Map((s12?.quotationDocuments || []).map((d) => [d.fileUrl, d]));
      const files = sourceDocs
        .filter((d) => d?.fileUrl)
        .map((d) => fileFromDoc(step12ByUrl.get(d.fileUrl) || d));
      const statusDone = carriedItemStatus(step12, it);
      // Vendor already recorded on the item. Quoted item -> the approved vendor (re-edit
      // before any PO). No-quote item -> the vendor chosen earlier (Step 1.2 history pick or
      // Pending for PO), shown read-only: Step 1.3 never saves a vendor for it.
      const hold = statusDone === 'YES' && s?.statusDone === 'ON_HOLD';
      const recorded = it.vendorId && !hold && (statusDone === 'YES' ? it.vendorSource === SOURCE_APPROVED : true)
        ? { _id: String(it.vendorId), name: it.vendorName || '' } : null;
      return {
        itemId: it._id && it._id !== 'legacy' ? it._id : undefined,
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || '',
        itemDisplayNumber: itemRef(indent?.indentNumber, it, i),
        qty: it.approvedQuantity || it.quantity,
        unit: it.unit || 'Pcs',
        // Status is carried from Step 1.2 — never chosen here.
        statusDone,
        files,
        actualAt: s?.actualAt ? s.actualAt.slice(0, 10) : '',
        remarks: s?.remarks || '',
        vendor: recorded,
        // A vendor saved earlier stays selectable even if it has no purchase history (kept as recorded).
        savedVendor: statusDone === 'YES' ? recorded : null,
        hold,
        // Already on a PO: its approval and vendor can no longer change.
        locked: statusDone === 'YES' && it.procurementStatus === 'PO_CREATED',
        poNumber: it.poNumber || '',
        // Select Items: ticked = already approved (saved YES row, or on a PO).
        selected: statusDone === 'YES' && (it.procurementStatus === 'PO_CREATED' || s?.statusDone === 'YES'),
        savedPending: statusDone === 'YES' && s?.statusDone === 'PENDING',
      };
    });
    setRows(built);
    // Reopening a partial step (items saved as pending) comes back in Select Items mode with the
    // already-approved items ticked.
    setSelectMode(built.some((r) => r.savedPending));
  }, [open, indent]);

  // A saved vendor whose name was not stored with the item is named from its purchase history.
  const namedRows = rows.map((r) => {
    if (!r.vendor?._id || r.vendor.name) return r;
    const m = (historyByItem[String(r.itemId)] || []).find((h) => String(h.vendorId) === String(r.vendor._id));
    return m ? { ...r, vendor: { ...r.vendor, name: m.vendorName } } : r;
  });

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  // Hold / Keep Pending: the item leaves the vendor decision (its vendor choice is cleared)
  // and stays on Step 1.3; Resume puts it back to Pending.
  const setHold = (idx, hold) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, hold, ...(hold ? { vendor: null, selected: false } : {}) } : r)));

  const removeFile = (idx, fileIdx) => setRows((cur) => cur.map((r, i) => (i === idx
    ? { ...r, files: r.files.filter((_, fi) => fi !== fileIdx) }
    : r)));

  // Select Items — a quoted row can be ticked unless it is held or already on a PO.
  const canSelect = (r) => r.statusDone === 'YES' && !!r.itemId && !r.hold && !r.locked;
  const selectRow = (idx, selected) => setRows((cur) => cur.map((r, i) => (i === idx && canSelect(r) ? { ...r, selected } : r)));
  const selectable = rows.filter(canSelect);
  const selectedCount = selectable.filter((r) => r.selected).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;
  const selectAll = (on) => setRows((cur) => cur.map((r) => (canSelect(r) ? { ...r, selected: on } : r)));

  // Approved Vendor options per item: its ELIGIBLE vendors only — quoted for it at Step 1.2 OR
  // previously supplied (never the whole Vendor Master). A vendor already saved for the item is
  // always kept selectable so a saved selection never disappears.
  const vendorOptionsFor = (row) => {
    let opts = (historyByItem[String(row.itemId)] || []).map((h) => ({
      _id: String(h.vendorId), name: h.vendorName, caption: eligibleCaption(h),
      quotedRate: h.quoted ? h.quotedRate : null, deliveryDays: h.quoted ? h.deliveryDays : null,
    }));
    if (row.savedVendor?._id && !opts.some((o) => o._id === String(row.savedVendor._id))) {
      opts = [{ _id: String(row.savedVendor._id), name: row.savedVendor.name, caption: 'Previously approved' }, ...opts];
    }
    return opts;
  };
  // Whether an item's vendors are still loading, or loaded and empty (→ "No Eligible Vendors Found").
  const vendorStateFor = (row) => {
    const loaded = Object.prototype.hasOwnProperty.call(historyByItem, String(row.itemId));
    return {
      loading: !loaded && !historyError,
      failed: !loaded && historyError,
      noHistory: loaded && !(historyByItem[String(row.itemId)] || []).length && !row.savedVendor?._id,
    };
  };

  // Award summary: one PO per vendor will follow (approved items only).
  const awards = (() => {
    const byVendor = new Map();
    namedRows.filter((r) => decisionOf(r, selectMode) === 'APPROVED' && r.vendor?._id).forEach((r) => {
      const k = String(r.vendor._id);
      if (!byVendor.has(k)) byVendor.set(k, { name: r.vendor.name, items: [] });
      byVendor.get(k).items.push(r.itemDisplayNumber || r.itemName);
    });
    return [...byVendor.values()];
  })();
  // Header summary - counted from the item rows themselves; the four chips partition the items:
  //   Approved  quoted items going on to PO (every quoted item that is not on hold; ticked ones in Select Items)
  //   Pending   quoted items left unticked in Select Items mode / saved as pending earlier (kept for later)
  //   On Hold   quoted items kept pending on purpose ("Hold / Keep Pending")
  //   No Quote  Quote Required = No (nothing to approve here)
  const decide = (r) => decisionOf(r, selectMode);
  const counts = namedRows.reduce((c, r) => { c[decide(r)] += 1; return c; }, { APPROVED: 0, PENDING: 0, ON_HOLD: 0, NO_QUOTE: 0 });
  const stillOpen = counts.PENDING + counts.ON_HOLD;
  // Selected = items ticked in Select Items mode (0 when the mode is off), on-PO ones included.
  const selectedTotal = selectMode ? namedRows.filter((r) => r.statusDone === 'YES' && r.itemId && !r.hold && (r.locked || r.selected)).length : 0;
  const newlyApproved = namedRows.filter((r) => decide(r) === 'APPROVED' && r.statusDone === 'YES' && !r.locked).length;

  const handleSubmit = async () => {
    const decided = rows.map((r) => ({ r, d: decide(r) }));
    // An item going forward must keep ≥1 quotation; held / pending items may keep none.
    const missing = decided.find(({ r, d }) => d === 'APPROVED' && r.statusDone === 'YES' && r.files.length === 0);
    if (missing) {
      enqueueSnackbar(`Keep at least one approved quotation for "${missing.r.itemName}"`, { variant: 'warning' });
      return;
    }
    if (selectMode && newlyApproved === 0) {
      enqueueSnackbar('Select at least one item to approve', { variant: 'warning' });
      return;
    }
    if (counts.APPROVED === 0 && counts.ON_HOLD === 0) {
      enqueueSnackbar('Nothing to submit — every quoted item is on hold', { variant: 'warning' });
      return;
    }
    // statusDone is NOT carried as the step status — the backend derives it (complete only
    // when every quoted item is approved). The kept documents reuse Step 1.2's file references
    // verbatim (same URL + uploadedAt) so nothing is uploaded or stored twice.
    try {
      await approveQuotation({
        id: indent._id,
        itemApprovedQuotations: decided.map(({ r, d }) => ({
          itemId: r.itemId,
          skuId: r.skuId,
          skuCode: r.skuCode,
          itemName: r.itemName,
          statusDone: d === 'ON_HOLD' ? 'ON_HOLD' : d === 'PENDING' ? 'PENDING' : r.statusDone,
          approvedQuotationDocuments: r.files.map((f) => ({ fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType, uploadedAt: f.uploadedAt })),
          vendorId: d === 'APPROVED' && r.statusDone === 'YES' ? (r.vendor?._id || null) : null,
          actualAt: r.actualAt || actualAt,
          remarks: r.remarks?.trim() || '',
        })),
        actualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar(stillOpen
        ? `Quotation approval recorded — ${stillOpen} item${stillOpen === 1 ? '' : 's'} still open on Step 1.3`
        : 'Quotation approval recorded', { variant: 'success' });
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
        {/* Status is carried from Step 1.2 per item - this strip counts the items by state. */}
        {/* Select Items: tick the items to approve now — the rest stay pending on Step 1.3. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }} data-testid="select-items-bar">
          <FormControlLabel
            sx={{ m: 0 }}
            control={<Switch size="small" checked={selectMode} onChange={(e) => setSelectMode(e.target.checked)} inputProps={{ 'data-testid': 'select-items-toggle' }} />}
            label={<Typography sx={{ fontWeight: 700, fontSize: '0.84rem' }}>Select Items</Typography>}
          />
          {selectMode && (
            <>
              <FormControlLabel
                sx={{ m: 0 }}
                control={<Checkbox size="small" checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} disabled={!selectable.length}
                  onChange={(e) => selectAll(e.target.checked)} inputProps={{ 'data-testid': 'select-all' }} />}
                label={<Typography sx={{ fontSize: '0.82rem' }}>Select all eligible</Typography>}
              />
              <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub, fontWeight: 600 }} data-testid="select-count">
                {selectedCount} of {selectable.length} selected
              </Typography>
              <Typography sx={{ fontSize: '0.74rem', color: PFMS.sub }}>Only ticked items are approved; unticked items stay pending.</Typography>
            </>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }} data-testid="approval-summary"
          data-total={namedRows.length} data-selected={selectedTotal} data-approved={counts.APPROVED} data-pending={counts.PENDING}
          data-hold={counts.ON_HOLD} data-noquote={counts.NO_QUOTE}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: PFMS.ink, mr: 0.5 }}>
            Approve the quotation and select the vendor for each item
          </Typography>
          <StatusChip status="NOT_STARTED" tone="neutral" showIcon={false} label={`${namedRows.length} Item${namedRows.length === 1 ? '' : 's'}`} />
          {selectMode && <StatusChip status="NOT_STARTED" tone="neutral" showIcon={false} label={`${selectedTotal} Selected`} />}
          <StatusChip status="DONE" tone="green" label={`${counts.APPROVED} Approved`} />
          <StatusChip status="PENDING" tone={counts.PENDING ? 'amber' : 'neutral'} label={`${counts.PENDING} Pending`} />
          <StatusChip status="ON_HOLD" tone={counts.ON_HOLD ? 'orange' : 'neutral'} label={`${counts.ON_HOLD} On Hold`} />
          <StatusChip status="NOT_STARTED" tone="neutral" showIcon={false} label={`${counts.NO_QUOTE} No Quote`} />
        </Box>
        <ApprovedVendorTable
          rows={namedRows}
          yesValue="YES"
          decisionOf={decide}
          selectMode={selectMode}
          onSelect={selectRow}
          onRemoveFile={removeFile}
          onPatchRow={patchRow}
          onHold={setHold}
          vendorOptions={vendorOptionsFor}
          vendorState={vendorStateFor}
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
          {stillOpen > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5, color: '#b45309', fontWeight: 600 }} data-testid="vendor-award-pending">
              {stillOpen} item{stillOpen === 1 ? '' : 's'} stay{stillOpen === 1 ? 's' : ''} pending on Step 1.3 — not in any PO until approved
            </Typography>
          )}
        </Box>
        {historyError && (
          <Alert severity="error" sx={{ mt: 1 }} action={<Button size="small" onClick={() => refetchHistory()}>Retry</Button>}>
            Could not load the items&apos; eligible vendors — a vendor cannot be selected until they load.
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Quotations from Step 1.2 are loaded automatically. Remove the ones not approved — the remaining quotation(s) are saved as the approved quotation. No re-upload needed.
          The vendor is optional here — if none is chosen it is chosen on the Purchase Order. Vendors offered are the ones who quoted for the item or have supplied it before. Use Select Items to approve only some items now; items on hold or left unticked stay pending and can be completed later. Only approved items go to Purchase Orders.
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
