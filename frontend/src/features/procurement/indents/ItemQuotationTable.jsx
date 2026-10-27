import React, { useRef } from 'react';
import {
  Box, Typography, Button, IconButton, Stack, CircularProgress, TextField, MenuItem, Tooltip, Autocomplete,
} from '@mui/material';
import { Upload, FileText, X, ExternalLink } from 'lucide-react';
import { fileHref } from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Item-wise quotation upload table — shared by Step 1.2 (Receive Quote) and
 * Step 1.3 (Approved Quotation). Each indent line item gets its own status,
 * file upload, actual date and remarks. The parent owns the `rows` state and
 * the upload mutation; this component is purely presentational + event wiring.
 *
 * Row shape: { itemId, skuCode, itemName, qty, unit, statusDone, files:[{fileName,fileUrl,fileType}], actualAt, remarks, vendor }
 *
 * Step 1.3 passes `vendorOptions` to add an Approved Vendor column (Vendor Master,
 * required for each approved item); `row.vendor` = { _id, name } | null.
 */
const ItemQuotationTable = ({
  rows,
  qtyLabel = 'Qty',
  uploadLabel = 'Quotation Uploaded',
  accept,
  statusOptions = [],   // [{ value, label }] — the per-item Status Done choices
  yesValue = 'YES',     // which status value requires a file
  hideStatus = false,   // hide the Status Done column (Step 1.3 carries it from Step 1.2)
  noUpload = false,     // hide the upload control — files are reused (Step 1.3 selects from Step 1.2)
  uploadingIdx = -1,
  onUploadRow,
  onRemoveFile,
  onPatchRow,
  vendorOptions = null, // Step 1.3: Vendor Master records → shows the Approved Vendor column
  vendorsLoading = false,
}) => {
  const inputRefs = useRef([]);

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No items found on this indent.
      </Typography>
    );
  }

  const showVendor = Array.isArray(vendorOptions);
  const COLS = [
    '1.5fr 0.9fr 0.55fr 0.55fr',
    hideStatus ? '' : '1.2fr',
    showVendor ? '1.9fr' : '',
    '2fr 1.15fr 1.3fr',
  ].filter(Boolean).join(' ');
  const headers = ['Item Name', 'SKU', qtyLabel, 'Unit',
    ...(hideStatus ? [] : ['Status Done?']),
    ...(showVendor ? ['Approved Vendor *'] : []),
    uploadLabel, 'Actual Date', 'Remarks'];

  return (
    <Box>
      {/* Header (md+) */}
      <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLS, gap: 1, px: 1, mb: 0.5 }}>
        {headers.map((h, i) => (
          <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
        ))}
      </Box>

      <Stack spacing={1}>
        {rows.map((row, idx) => {
          const uploading = uploadingIdx === idx;
          const needsFile = row.statusDone === yesValue;
          const statusLabel = statusOptions.find((o) => o.value === row.statusDone)?.label || 'Not Required';
          return (
            <Box
              key={row.itemId || idx}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: COLS },
                gap: 1.25,
                alignItems: 'start',
                p: 1.25,
                borderRadius: '12px',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              {/* Item name */}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Item</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{row.itemName || '—'}</Typography>
                {row.itemDisplayNumber ? <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{row.itemDisplayNumber}</Typography> : null}
              </Box>

              {/* SKU */}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>SKU</Typography>
                <Typography variant="body2" color="primary.main" fontWeight={700}>{row.skuCode || '—'}</Typography>
              </Box>

              {/* Qty */}
              <Box>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>{qtyLabel}</Typography>
                <Typography variant="body2">{row.qty ?? '—'}</Typography>
              </Box>

              {/* Unit */}
              <Box>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Unit</Typography>
                <Typography variant="body2" color="text.secondary">{row.unit || '—'}</Typography>
              </Box>

              {/* Status Done — hidden when the status is carried from a prior step */}
              {!hideStatus && (
                <Box>
                  <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Status Done?</Typography>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={row.statusDone || yesValue}
                    onChange={(e) => {
                      const statusDone = e.target.value;
                      // When a quotation is no longer required, the upload control is
                      // disabled — so drop any already-attached files to avoid leaving
                      // an orphaned document behind a greyed-out control.
                      onPatchRow(idx, statusDone === yesValue ? { statusDone } : { statusDone, files: [] });
                    }}
                  >
                    {statusOptions.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                </Box>
              )}

              {/* Approved vendor (Step 1.3) — only items that had a quotation need one */}
              {showVendor && (
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Approved Vendor{needsFile ? ' *' : ''}</Typography>
                  {needsFile ? (
                    <Autocomplete
                      size="small"
                      options={vendorOptions}
                      loading={vendorsLoading}
                      value={row.vendor || null}
                      onChange={(_e, v) => onPatchRow(idx, { vendor: v ? { _id: v._id, name: v.name } : null })}
                      getOptionLabel={(o) => o?.name || ''}
                      isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
                      noOptionsText={vendorsLoading ? 'Loading vendors…' : 'No active vendors in the Vendor Master'}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Select vendor" error={!row.vendor}
                          inputProps={{ ...params.inputProps, 'data-testid': `approved-vendor-${idx}` }} />
                      )}
                    />
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Quote not required — vendor is chosen on Pending for PO.
                    </Typography>
                  )}
                </Box>
              )}

              {/* Upload / reuse + file list */}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>
                  {uploadLabel}{needsFile ? ' *' : ' (optional)'}
                </Typography>
                {!noUpload && (
                  <input
                    ref={(el) => { inputRefs.current[idx] = el; }}
                    type="file"
                    accept={accept}
                    multiple
                    hidden
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      e.target.value = '';
                      onUploadRow(idx, picked);
                    }}
                  />
                )}
                {row.files?.length > 0 && (
                  <Stack spacing={0.5} sx={{ mb: 0.75 }}>
                    {row.files.map((f, fi) => (
                      <Box key={fi} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px', bgcolor: '#f8fafc' }}>
                        <FileText size={14} />
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="caption" sx={{ display: 'block' }} noWrap title={f.fileName}>{f.fileName || `File ${fi + 1}`}</Typography>
                          {f.uploadedAt ? (
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.6rem' }}>
                              {new Date(f.uploadedAt).toLocaleDateString()}
                            </Typography>
                          ) : null}
                        </Box>
                        <Tooltip title="View / Download"><IconButton size="small" href={fileHref(f.fileUrl)} target="_blank" rel="noopener"><ExternalLink size={13} /></IconButton></Tooltip>
                        <Tooltip title={noUpload ? 'Remove (reject this quotation)' : 'Remove file'}><IconButton size="small" color="error" onClick={() => onRemoveFile(idx, fi)}><X size={13} /></IconButton></Tooltip>
                      </Box>
                    ))}
                  </Stack>
                )}
                {!noUpload && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />}
                    onClick={() => inputRefs.current[idx]?.click()}
                    disabled={uploading || !needsFile}
                    sx={{ textTransform: 'none' }}
                  >
                    {uploading ? 'Uploading…' : (row.files?.length ? 'Add file' : 'Upload PDF / Image / Excel')}
                  </Button>
                )}
                {/* Reuse mode (Step 1.3): no upload — guide the user to keep approved quotations. */}
                {noUpload && needsFile && !row.files?.length && (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    All quotations removed — keep at least one to approve this item.
                  </Typography>
                )}
                {!needsFile && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {hideStatus
                      ? 'No quotation was required for this item in Step 1.2 — nothing to approve.'
                      : `Quotation upload is disabled because '${statusLabel}' is selected.`}
                  </Typography>
                )}
              </Box>

              {/* Actual date */}
              <Box>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Actual Date</Typography>
                <DateInputDDMMYYYY
                  fullWidth
                  size="small"
                  value={row.actualAt || ''}
                  onChange={(v) => onPatchRow(idx, { actualAt: v })}
                />
              </Box>

              {/* Remarks */}
              <Box>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Remarks</Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Remarks"
                  value={row.remarks || ''}
                  onChange={(e) => onPatchRow(idx, { remarks: e.target.value })}
                />
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
};

export default ItemQuotationTable;
