import React, { useRef } from 'react';
import {
  Box, Typography, Button, IconButton, Stack, CircularProgress, TextField, MenuItem,
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
 * Row shape: { itemId, skuCode, itemName, qty, unit, statusDone, files:[{fileName,fileUrl,fileType}], actualAt, remarks }
 */
const ItemQuotationTable = ({
  rows,
  qtyLabel = 'Qty',
  uploadLabel = 'Quotation Uploaded',
  accept,
  statusOptions = [],   // [{ value, label }] — the per-item Status Done choices
  yesValue = 'YES',     // which status value requires a file
  uploadingIdx = -1,
  onUploadRow,
  onRemoveFile,
  onPatchRow,
}) => {
  const inputRefs = useRef([]);

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No items found on this indent.
      </Typography>
    );
  }

  const COLS = '1.5fr 0.9fr 0.55fr 0.55fr 1.2fr 2fr 1.15fr 1.3fr';
  const headers = ['Item Name', 'SKU', qtyLabel, 'Unit', 'Status Done?', uploadLabel, 'Actual Date', 'Remarks'];

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

              {/* Status Done */}
              <Box>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>Status Done?</Typography>
                <TextField
                  select
                  fullWidth
                  size="small"
                  value={row.statusDone || yesValue}
                  onChange={(e) => onPatchRow(idx, { statusDone: e.target.value })}
                >
                  {statusOptions.map((o) => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </TextField>
              </Box>

              {/* Upload + file list */}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: { md: 'none' }, color: 'text.secondary', fontWeight: 700 }}>
                  {uploadLabel}{needsFile ? ' *' : ' (optional)'}
                </Typography>
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
                {row.files?.length > 0 && (
                  <Stack spacing={0.5} sx={{ mb: 0.75 }}>
                    {row.files.map((f, fi) => (
                      <Box key={fi} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px', bgcolor: '#f8fafc' }}>
                        <FileText size={14} />
                        <Typography variant="caption" sx={{ flexGrow: 1, minWidth: 0 }} noWrap title={f.fileName}>{f.fileName || `File ${fi + 1}`}</Typography>
                        <IconButton size="small" href={fileHref(f.fileUrl)} target="_blank" rel="noopener"><ExternalLink size={13} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => onRemoveFile(idx, fi)}><X size={13} /></IconButton>
                      </Box>
                    ))}
                  </Stack>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />}
                  onClick={() => inputRefs.current[idx]?.click()}
                  disabled={uploading}
                  sx={{ textTransform: 'none' }}
                >
                  {uploading ? 'Uploading…' : (row.files?.length ? 'Add file' : 'Upload PDF / Image / Excel')}
                </Button>
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
