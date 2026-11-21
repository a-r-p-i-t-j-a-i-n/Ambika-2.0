import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Typography, CircularProgress, Alert, Box,
} from '@mui/material';
import { Save, FileText } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useQuoteComparativeMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { istTodayStr } from '../../../utils/istDate';
import StatusChip from '../components/StatusChip';
import { PFMS } from '../pfmsTheme';
import VendorQuotationTable from './VendorQuotationTable';
import { itemRef, matchItemRow, legacyFallbackDocs, isItemEligibleForQuote, fileHref } from './indentMeta';

/**
 * Step 1.2 — Receive Quote & Make Comparative 1.02.
 *
 * Item-wise: every indent line item gets its own quotation upload (PDF / image /
 * Excel, multiple files allowed), actual date and remarks. Submits the
 * `itemQuotations[]` payload; the backend aggregates files into the legacy
 * `quotationDocuments[]` / `quotationUploaded` fields for older screens.
 *
 * Every quotation file names the vendor who sent it (Vendor Master) with its
 * quoted rate / delivery days — Step 1.3 then approves each item for one of
 * the vendors who quoted for it, not any vendor in the master.
 */
const toNum = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
// A saved quotation file → the form's file shape (with its vendor tag). A file
// saved before vendors were recorded is `legacy`: it stays valid without a
// vendor (tagging it is optional) — only new uploads must name their vendor.
// Each quotation carries its own Actual Date (received date). A file saved before
// that existed shows its item's date (or the step's), so nothing displays blank.
// Quoted rate / delivery days saved earlier are kept on the file and re-sent
// unchanged — this form no longer edits them.
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
const fileFromDoc = (d, fallbackDate = '') => ({
  legacy: !d.vendorId,
  fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, uploadedAt: d.uploadedAt,
  vendor: d.vendorId ? { _id: String(d.vendorId), name: d.vendorName || '' } : null,
  quotedRate: d.quotedRate ?? '',
  deliveryDays: d.deliveryDays ?? '',
  actualAt: dateOnly(d.actualAt) || fallbackDate,
});
const ACCEPT = '.pdf,image/*,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
// Default Actual Date = today in India (the UTC date is yesterday before 05:30 IST).
const todayStr = () => istTodayStr();

// "Quote Required?" — Yes keeps the stored value YES (a quotation file is needed),
// No is the stored QUOTE_NOT_REQUIRED. Only the labels changed; the API did not.
const STATUS_OPTIONS = [
  { value: 'YES', label: 'Yes' },
  { value: 'QUOTE_NOT_REQUIRED', label: 'No' },
];

// Indent line items (multi-item, with legacy single-product fallback). Items
// rejected during indent approval (Step 1.1) never reach Step 1.2.
const itemsOf = (indent) => {
  if (indent?.items?.length) return indent.items.filter((it) => isItemEligibleForQuote(indent, it));
  if (indent?.productNameRevised) {
    return [{
      _id: 'legacy', itemName: indent.productNameRevised, skuCode: indent.skuCode,
      skuId: indent.skuId, quantity: indent.quantity, unit: indent.unit,
    }];
  }
  return [];
};

const QuoteComparativeDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([]); // [{ itemId, skuId, skuCode, itemName, qty, unit, statusDone, files, actualAt, remarks }]
  const [uploadingIdx, setUploadingIdx] = useState(-1);
  // Uploads can run on several rows at once — Submit/Cancel wait for all of them.
  const [uploadsInFlight, setUploadsInFlight] = useState(0);

  const [uploadDoc] = useUploadOrderDocumentMutation();
  const [quoteComparative, { isLoading: saving }] = useQuoteComparativeMutation();
  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery({ limit: 500, sort: 'name' }, { skip: !open });
  const vendorOptions = (vendorsRes?.data || []).filter((v) => v.isActive !== false);

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quoteComparativeStep;
    const stepDate = existing?.actualAt ? dateOnly(existing.actualAt) : todayStr();
    setActualAt(stepDate);
    setRemarks(existing?.remarks || '');

    // Hydrate per-item files from saved itemQuotations[] — strictly keyed by
    // itemId first (matchItemRow never lets a skuCode/itemName match on the
    // wrong row win over a correct itemId match elsewhere in the array). The
    // legacy flat fallback only applies to a true single-item/pre-item-wise
    // indent — it is never spread across multiple items or dumped onto item 0.
    const saved = existing?.itemQuotations || [];
    const indentItems = itemsOf(indent);
    const legacyDocs = legacyFallbackDocs(saved, indentItems, existing?.quotationDocuments, existing?.quotationUploaded);

    setRows(indentItems.map((it, i) => {
      const s = matchItemRow(saved, it);
      const itemDate = dateOnly(s?.actualAt) || (existing?.actualAt ? stepDate : '');
      const files = (s?.quotationDocuments?.length ? s.quotationDocuments : legacyDocs)
        .filter((d) => d?.fileUrl)
        .map((d) => fileFromDoc(d, itemDate));
      return {
        itemId: it._id && it._id !== 'legacy' ? it._id : undefined,
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || '',
        itemDisplayNumber: itemRef(indent?.indentNumber, it, i),
        qty: it.quantity,
        unit: it.unit || 'Pcs',
        statusDone: s?.statusDone || existing?.statusDone || 'YES',
        files,
        actualAt: dateOnly(s?.actualAt),
        remarks: s?.remarks || '',
      };
    }));
  }, [open, indent]);

  // Old flat-format files that can't be tied to one item (multi-item legacy
  // records) — shown read-only; the server keeps them at quotation level.
  const unlinkedLegacyDocs = (() => {
    const step = indent?.quoteComparativeStep;
    if (step?.legacyQuotationDocuments?.length) return step.legacyQuotationDocuments;
    const hasItemFiles = (step?.itemQuotations || []).some((iq) => iq.quotationDocuments?.length);
    if (hasItemFiles || itemsOf(indent).length <= 1) return [];
    return (step?.quotationDocuments || []).filter((d) => d?.fileUrl);
  })();

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleUploadRow = async (idx, picked) => {
    setUploadingIdx(idx);
    setUploadsInFlight((n) => n + 1);
    for (const f of picked) {
      if (f.size > 10 * 1024 * 1024) {
        enqueueSnackbar(`${f.name} exceeds 10 MB`, { variant: 'warning' });
        continue;
      }
      try {
        const res = await uploadDoc(f).unwrap();
        const d = res?.data || {};
        setRows((cur) => cur.map((r, i) => (i === idx
          ? { ...r, files: [...r.files, { fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type, vendor: null, quotedRate: '', deliveryDays: '', actualAt: todayStr() }] }
          : r)));
      } catch (err) {
        enqueueSnackbar(err?.data?.message || `Failed to upload ${f.name}`, { variant: 'error' });
      }
    }
    setUploadsInFlight((n) => n - 1);
    setUploadingIdx((cur) => (cur === idx ? -1 : cur));
  };

  const removeFile = (idx, fileIdx) => setRows((cur) => cur.map((r, i) => (i === idx
    ? { ...r, files: r.files.filter((_, fi) => fi !== fileIdx) }
    : r)));
  const patchFile = (idx, fileIdx, p) => setRows((cur) => cur.map((r, i) => (i === idx
    ? { ...r, files: r.files.map((f, fi) => (fi === fileIdx ? { ...f, ...p } : f)) }
    : r)));

  const handleSubmit = async () => {
    // Each item marked "Yes" needs at least one file; "Quote Not Required" is optional.
    const missing = rows.find((r) => r.statusDone === 'YES' && r.files.length === 0);
    if (missing) {
      enqueueSnackbar(`Upload at least one quotation file for "${missing.itemName}"`, { variant: 'warning' });
      return;
    }
    // Who sent each quotation — Step 1.3 can only approve a vendor who quoted.
    const untagged = rows.find((r) => r.statusDone === 'YES' && r.files.some((f) => !f.vendor?._id && !f.legacy));
    if (untagged) {
      enqueueSnackbar(`Select the vendor who sent each quotation for "${untagged.itemName}"`, { variant: 'warning' });
      return;
    }
    const badRate = rows.find((r) => r.files.some((f) => (f.quotedRate !== '' && toNum(f.quotedRate) === null) || toNum(f.quotedRate) < 0
      || (f.deliveryDays !== '' && (toNum(f.deliveryDays) === null || toNum(f.deliveryDays) < 0 || !Number.isInteger(toNum(f.deliveryDays))))));
    if (badRate) {
      enqueueSnackbar(`Check the quoted rate / delivery days for "${badRate.itemName}"`, { variant: 'warning' });
      return;
    }
    // Aggregate step status: only QUOTE_NOT_REQUIRED if every item is not required.
    const statusDone = rows.length && rows.every((r) => r.statusDone === 'QUOTE_NOT_REQUIRED')
      ? 'QUOTE_NOT_REQUIRED'
      : 'YES';
    // Actual Date lives on each quotation. An item's date is its latest quotation
    // date, and the step's date is the latest across the indent; with no
    // quotation to carry a date (all items "Quote Not Required") the step keeps
    // the date picked in the footer.
    const latest = (dates) => dates.filter(Boolean).sort().pop() || '';
    const stepActualAt = latest(rows.flatMap((r) => r.files.map((f) => f.actualAt))) || actualAt;
    const itemDate = (r) => latest(r.files.map((f) => f.actualAt)) || stepActualAt;
    try {
      await quoteComparative({
        id: indent._id,
        statusDone,
        itemQuotations: rows.map((r) => ({
          itemId: r.itemId,
          skuId: r.skuId,
          skuCode: r.skuCode,
          itemName: r.itemName,
          statusDone: r.statusDone,
          // Keep each file's original upload date (new uploads get stamped server-side).
          quotationDocuments: r.files.map((f) => ({
            fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType,
            ...(f.uploadedAt ? { uploadedAt: f.uploadedAt } : {}),
            vendorId: f.vendor?._id || null,
            quotedRate: toNum(f.quotedRate),
            deliveryDays: toNum(f.deliveryDays),
            actualAt: f.actualAt || itemDate(r) || stepActualAt,
          })),
          actualAt: itemDate(r) || stepActualAt,
          remarks: r.remarks?.trim() || '',
        })),
        actualAt: stepActualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Quote & comparative recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  // Header counts — an item is Quoted once it holds a file, Pending while it
  // still needs one; "Quote Not Required" items are neither.
  const quotedCount = rows.filter((r) => r.statusDone === 'YES' && r.files.length > 0).length;
  const pendingCount = rows.filter((r) => r.statusDone === 'YES' && r.files.length === 0).length;
  const hasAnyQuotation = rows.some((r) => r.files.length > 0);
  const infoLabelSx = { fontSize: '0.68rem', fontWeight: 700, color: PFMS.sub, lineHeight: 1.2 };
  const infoValueSx = { fontSize: '0.86rem', fontWeight: 700, color: PFMS.ink, lineHeight: 1.4 };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth={false} fullWidth
      PaperProps={{ sx: { maxWidth: 1280 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.5 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}`, color: 'primary.main', flexShrink: 0 }}>
          <FileText size={16} />
        </Box>
        <Box component="span" sx={{ fontWeight: 800, fontSize: '1.1rem', color: PFMS.ink }}>Receive Quote &amp; Make Comparative</Box>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: PFMS.canvas }}>
        {/* Indent / step / progress band */}
        <Box
          sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 1,
            px: 1.5, py: 1, mb: 1.5, borderRadius: '8px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surface,
          }}
        >
          <Box>
            <Typography component="div" sx={infoLabelSx}>Indent No</Typography>
            <Typography component="div" sx={infoValueSx} data-testid="quote-indent-no">{indent?.indentNumber || '—'}</Typography>
          </Box>
          <Box>
            <Typography component="div" sx={infoLabelSx}>Step No</Typography>
            <Typography component="div" sx={infoValueSx}>Step 1.2</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', ml: { md: 'auto' } }} data-testid="quote-counts">
            <StatusChip status="NOT_STARTED" tone="neutral" showIcon={false} label={`Total Items: ${rows.length}`} />
            <StatusChip status="DONE" tone="green" label={`Quoted: ${quotedCount}`} />
            <StatusChip status="PENDING" tone="amber" label={`Pending: ${pendingCount}`} />
          </Box>
        </Box>

        <VendorQuotationTable
          rows={rows}
          accept={ACCEPT}
          statusOptions={STATUS_OPTIONS}
          yesValue="YES"
          uploadingIdx={uploadingIdx}
          onUploadRow={handleUploadRow}
          onRemoveFile={removeFile}
          onPatchRow={patchRow}
          onPatchFile={patchFile}
          vendorOptions={vendorOptions}
          vendorsLoading={vendorsLoading}
        />
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: PFMS.sub }}>
          Multiple files allowed per item · PDF, PNG, JPG, XLSX · max 10 MB each · name the vendor who sent each quotation
          — Step 1.3 approves each item for one of these vendors.
        </Typography>
        {unlinkedLegacyDocs.length > 0 && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {unlinkedLegacyDocs.length} earlier quotation file(s) are not linked to a specific item and are kept
            at quotation level:{' '}
            {unlinkedLegacyDocs.map((d, i) => (
              <React.Fragment key={d.fileUrl}>
                {i > 0 && ', '}
                <a href={fileHref(d.fileUrl)} target="_blank" rel="noopener noreferrer">{d.fileName || `File ${i + 1}`}</a>
              </React.Fragment>
            ))}
          </Alert>
        )}

        {/* Overall remarks. The step's Actual Date comes from the quotations; this
            date field only appears when no quotation exists to carry one. */}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {!hasAnyQuotation && (
            <Grid item xs={12} sm={4} md={3}>
              <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt} onChange={setActualAt} sx={{ bgcolor: PFMS.surface }} />
            </Grid>
          )}
          <Grid item xs={12} sm={hasAnyQuotation ? 12 : 8} md={hasAnyQuotation ? 12 : 9}>
            <TextField label="Overall Remarks" placeholder="Enter overall remarks (optional)" fullWidth value={remarks}
              onChange={(e) => setRemarks(e.target.value)} sx={{ bgcolor: PFMS.surface }} InputLabelProps={{ shrink: true }} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={saving || uploadsInFlight > 0}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || uploadsInFlight > 0}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuoteComparativeDialog;
