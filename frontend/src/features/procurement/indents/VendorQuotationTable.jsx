import React, { useRef } from 'react';
import {
  Box, Typography, Button, IconButton, CircularProgress, TextField, MenuItem, Tooltip, Autocomplete,
} from '@mui/material';
import { Plus, FileText, X, ExternalLink } from 'lucide-react';
import { fileHref } from './indentMeta';
import { fmtDate } from '../purchase-orders/poMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';

/**
 * Step 1.2 — Receive Quote & Make Comparative, item-wise table.
 *
 * One card per indent item (Item Details · Qty · Unit); inside it one compact
 * line per uploaded quotation (Quotation File · Actual Date · remove),
 * with Quote Required? (Yes / No) ahead of the quotations and Remarks after them. The parent owns `rows` and the
 * upload mutation; this component is presentational + event wiring only.
 *
 * Row  : { itemId, skuCode, itemName, qty, unit, statusDone, remarks,
 *          vendor, vendorLocked,
 *          files: [{ fileName, fileUrl, actualAt, ... }] }
 * Quote Required? = No → no quotation files; the item's vendor is picked from the
 * item's previous vendors only (`historyByItem[itemId]`, served by the API from
 * purchase history) and is mandatory. `vendorLocked` = the item is already on a PO.
 * A "quotation" is one uploaded file together with the date it was received
 * (file.actualAt). No vendor is chosen here — the vendor is picked later, per item,
 * in the PO workflow. Fields the form does not edit (a vendor tag, quoted rate /
 * delivery days saved earlier) stay on the file untouched.
 *
 * Step 1.3 keeps using the shared ItemQuotationTable.
 */
const COLS = '28px minmax(0,1.5fr) 36px 44px 116px minmax(400px,3fr) minmax(130px,1fr)';
const QUOTE_COLS = 'minmax(0,1fr) 184px 30px';
const HEADERS = ['#', 'Item Details', 'Qty', 'Unit', 'Quote Required?', 'Quotations', 'Remarks'];

// What a previous vendor has supplied before — shown under its name in the picker.
const historyCaption = (h) => {
  const parts = [];
  if (h.location) parts.push(h.location);
  if (h.poCount) {
    parts.push(`${h.poCount} PO${h.poCount > 1 ? 's' : ''}${h.lastPoDate ? ` · last ${fmtDate(h.lastPoDate)}` : ''}${h.lastPoNumber ? ` (${h.lastPoNumber})` : ''}`);
  }
  if (h.inCatalog) parts.push('In Vendor Master item list');
  return parts.join(' · ');
};

// Mobile caption shown above a cell once the header row is hidden.
const MobileLabel = ({ children }) => (
  <Typography variant="caption" sx={{ display: { md: 'none' }, color: PFMS.sub, fontWeight: 700, mb: 0.25 }}>
    {children}
  </Typography>
);

const VendorQuotationTable = ({
  rows,
  accept,
  statusOptions = [],
  yesValue = 'YES',
  uploadingIdx = -1,
  onUploadRow,
  onRemoveFile,
  onPatchRow,
  onPatchFile,
  historyByItem = {},
  historyLoading = false,
  historyError = false,
}) => {
  const inputRefs = useRef([]);

  if (!rows.length) {
    return (
      <Typography variant="body2" sx={{ py: 2, color: PFMS.sub }}>
        No items found on this indent.
      </Typography>
    );
  }

  return (
    <Box>
      {/* Header (md+) */}
      <Box
        sx={{
          ...pfmsTableHeadSx,
          display: { xs: 'none', md: 'grid' },
          gridTemplateColumns: COLS,
          columnGap: 1,
          px: 1.5,
          py: 0.75,
          mb: 1,
          borderRadius: '8px',
          border: `1px solid ${PFMS.line}`,
        }}
      >
        {HEADERS.map((h) => <Box key={h}>{h}</Box>)}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map((row, idx) => {
          const uploading = uploadingIdx === idx;
          const needsFile = row.statusDone === yesValue;
          const files = row.files || [];
          const state = !needsFile
            ? { status: 'NOT_REQUIRED', label: 'Not Required' }
            : files.length
              ? { status: 'RECEIVED', label: `Quoted (${files.length})`, tone: 'green' }
              : { status: 'PENDING', label: 'Pending' };

          const addButton = (
            <Button
              size="small"
              variant="outlined"
              startIcon={uploading ? <CircularProgress size={14} /> : <Plus size={14} />}
              onClick={() => inputRefs.current[idx]?.click()}
              disabled={uploading || !needsFile}
              data-testid={`add-quotation-${idx}`}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              {uploading ? 'Uploading…' : 'Add Quotation'}
            </Button>
          );

          return (
            <Box
              key={row.itemId || idx}
              data-testid={`quote-item-${idx}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: COLS },
                // Phones: Item / Quotations / Status / Remarks take the full width, Qty + Unit share a line.
                '& > [data-cell="wide"]': { gridColumn: { xs: '1 / -1', md: 'auto' } },
                columnGap: 1,
                rowGap: 1,
                alignItems: 'start',
                px: 1.5,
                py: 1,
                borderRadius: '8px',
                border: `1px solid ${PFMS.line}`,
                bgcolor: PFMS.surface,
              }}
            >
              {/* Serial number (md+) — on phones it is part of the Item label */}
              <Box
                data-testid={`quote-serial-${idx}`}
                sx={{
                  display: { xs: 'none', md: 'grid' }, placeItems: 'center', width: 24, height: 24, mt: 0.1,
                  borderRadius: '6px', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}`,
                  fontSize: '0.72rem', fontWeight: 800, color: PFMS.sub,
                }}
              >
                {idx + 1}
              </Box>

              {/* Item details */}
              <Box data-cell="wide" sx={{ minWidth: 0 }}>
                <MobileLabel>{`Item ${idx + 1}`}</MobileLabel>
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: PFMS.ink, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                  {row.itemName || '—'}
                </Typography>
                <Typography component="div" sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'primary.main', overflowWrap: 'anywhere' }}>
                  {row.skuCode ? `SKU: ${row.skuCode}` : 'SKU: —'}
                  {row.itemDisplayNumber ? <Box component="span" sx={{ color: PFMS.sub, fontWeight: 600 }}>{` · ${row.itemDisplayNumber}`}</Box> : null}
                </Typography>
              </Box>

              {/* Qty */}
              <Box>
                <MobileLabel>Qty</MobileLabel>
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, lineHeight: '36px' }}>{row.qty ?? '—'}</Typography>
              </Box>

              {/* Unit */}
              <Box>
                <MobileLabel>Unit</MobileLabel>
                <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub, lineHeight: '36px' }}>{row.unit || '—'}</Typography>
              </Box>

              {/* Quote Required? (the stored value is still statusDone: YES / QUOTE_NOT_REQUIRED) + derived state */}
              <Box data-cell="wide">
                <MobileLabel>Quote Required?</MobileLabel>
                <TextField
                  select
                  fullWidth
                  size="small"
                  value={row.statusDone || yesValue}
                  onChange={(e) => {
                    const statusDone = e.target.value;
                    // A quotation that is no longer required cannot keep its files.
                    onPatchRow(idx, statusDone === yesValue ? { statusDone } : { statusDone, files: [] });
                  }}
                  inputProps={{ 'data-testid': `quote-status-${idx}` }}
                >
                  {statusOptions.map((o) => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ mt: 0.75 }} data-testid={`quote-state-${idx}`}>
                  <StatusChip status={state.status} label={state.label} tone={state.tone} />
                </Box>
              </Box>

              {/* Vendor quotations */}
              <Box data-cell="wide" sx={{ minWidth: 0 }}>
                <MobileLabel>{needsFile ? 'Quotations *' : (row.itemId ? 'Vendor *' : 'Quotations (optional)')}</MobileLabel>
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

                {files.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 0.75 }}>
                    {files.map((f, fi) => (
                      <Box key={f.fileUrl || fi} data-testid={`quote-file-${idx}-${fi}`}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr) 32px', sm: QUOTE_COLS }, columnGap: 1, rowGap: 0.75, alignItems: 'center' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                            <FileText size={14} color={PFMS.sub} style={{ flexShrink: 0 }} />
                            <Typography noWrap title={f.fileName} sx={{ fontSize: '0.78rem', fontWeight: 600, color: PFMS.ink, minWidth: 0, flex: 1 }}>
                              {f.fileName || `File ${fi + 1}`}
                            </Typography>
                            <Tooltip title="View / Download">
                              <IconButton size="small" href={fileHref(f.fileUrl)} target="_blank" rel="noopener" aria-label="View quotation file">
                                <ExternalLink size={13} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          <DateInputDDMMYYYY
                            fullWidth
                            size="small"
                            value={f.actualAt || ''}
                            onChange={(v) => onPatchFile(idx, fi, { actualAt: v })}
                            data-testid={`quote-date-${idx}-${fi}`}
                          />
                          <Tooltip title="Remove quotation">
                            <IconButton size="small" color="error" onClick={() => onRemoveFile(idx, fi)} aria-label="Remove quotation" data-testid={`quote-remove-${idx}-${fi}`}>
                              <X size={14} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}

                {files.length > 0 && addButton}

                {files.length === 0 && needsFile && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub }}>No quotation added yet</Typography>
                    {addButton}
                  </Box>
                )}

                {!needsFile && row.itemId && (() => {
                  const history = historyByItem[row.itemId] || [];
                  const loaded = Object.prototype.hasOwnProperty.call(historyByItem, row.itemId);
                  const current = row.vendor || null;
                  const inHistory = !current || history.some((h) => String(h.vendorId) === String(current._id));
                  const empty = loaded && !historyLoading && history.length === 0;
                  const stale = !!current && loaded && !inHistory && !row.vendorLocked;
                  return (
                    <Box sx={{ mb: 0.75 }} data-testid={`quote-nr-vendor-${idx}`}>
                      <Autocomplete
                        size="small"
                        sx={{ maxWidth: 440 }}
                        options={history}
                        loading={historyLoading}
                        disabled={row.vendorLocked || (!loaded && !historyError)}
                        value={history.find((h) => current && String(h.vendorId) === String(current._id)) || current}
                        onChange={(_e, h) => onPatchRow(idx, { vendor: h ? { _id: h.vendorId, name: h.vendorName } : null })}
                        getOptionLabel={(o) => (o?.vendorName || o?.name || '') + (o?.vendorCode ? ` (${o.vendorCode})` : '')}
                        isOptionEqualToValue={(o, v) => String(o.vendorId || o._id) === String(v.vendorId || v._id)}
                        noOptionsText={historyLoading ? 'Loading previous vendors…' : 'No previous vendors found for this item'}
                        renderOption={(props, o) => (
                          <li {...props} key={o.vendorId} data-testid={`quote-nr-option-${idx}`}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, lineHeight: 1.3 }}>
                                {o.vendorName}{o.vendorCode ? <Box component="span" sx={{ color: PFMS.sub, fontWeight: 600 }}>{` · ${o.vendorCode}`}</Box> : null}
                              </Typography>
                              <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub, lineHeight: 1.3 }}>{historyCaption(o)}</Typography>
                            </Box>
                          </li>
                        )}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder={empty ? 'No previous vendors found for this item' : 'Select vendor (previous suppliers) *'}
                            error={!row.vendorLocked && (stale || (!current && loaded && !historyLoading))}
                            inputProps={{ ...params.inputProps, 'data-testid': `quote-nr-vendor-input-${idx}` }}
                          />
                        )}
                      />
                      {empty && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 0.25 }} data-testid={`quote-nr-empty-${idx}`}>
                          No previous vendors found for this item — set Quote Required to Yes and add quotations.
                        </Typography>
                      )}
                      {historyError && !loaded && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 0.25 }} data-testid={`quote-nr-error-${idx}`}>
                          Could not load this item&apos;s previous vendors — reopen the form.
                        </Typography>
                      )}
                      {stale && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 0.25 }} data-testid={`quote-nr-stale-${idx}`}>
                          {current.name} is not in this item&apos;s purchase history — select one of its previous vendors.
                        </Typography>
                      )}
                      {row.vendorLocked && (
                        <Typography variant="caption" sx={{ display: 'block', color: PFMS.sub, mt: 0.25 }}>
                          Already on a PO — cancel the PO to change the vendor.
                        </Typography>
                      )}
                    </Box>
                  );
                })()}

                {!needsFile && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }}>
                    <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub }}>
                      Quote not required for this item.
                    </Typography>
                    {addButton}
                  </Box>
                )}
              </Box>

              {/* Remarks */}
              <Box data-cell="wide">
                <MobileLabel>Remarks</MobileLabel>
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
      </Box>
    </Box>
  );
};

export default VendorQuotationTable;
