import React from 'react';
import {
  Box, Typography, IconButton, TextField, Tooltip, Autocomplete, Button, Checkbox,
} from '@mui/material';
import { FileText, X, ExternalLink, PlayCircle } from 'lucide-react';
import { fileHref } from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import StatusChip from '../components/StatusChip';
import ItemVendorPicker from '../purchase-orders/ItemVendorPicker';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';

/**
 * Step 1.3 — Approved Quotation, item-wise vendor selection table.
 *
 * Presentational only: the dialog owns `rows` and every rule (which vendors are
 * offered, what is required, what is saved).  * One card per item; every quoted item is decided on its own:
 *
 *   Approved      Quote Required = Yes: the kept quotation files as compact chips
 *                 + an OPTIONAL compact dropdown of the item's ELIGIBLE vendors — quoted
 *                 for it at Step 1.2 or previously supplied (a vendor not chosen here
 *                 is chosen on the PO). "On PO-…" and read-only once a PO exists.
 *   Pending       an item left unticked in Select Items mode, or saved as pending earlier
 *                 (shown here as pending, kept for later; its vendor picker is disabled).
 *   On Hold       an item held earlier (there is no Hold button any more) — stays on Step 1.3 for later; Resume undoes it.
 *   No Quote      Quote Required = No: `No Quote · Vendor: <name>`; the vendor
 *                 shown is the one already chosen (Step 1.2 / Pending for PO).
 *
 * Row: { itemId, skuCode, itemName, itemDisplayNumber, qty, unit, statusDone, files,
 *        actualAt, remarks, vendor, hold, locked, poNumber, selected }
 * Select Items mode (`selectMode`): the serial of each QUOTED row becomes a checkbox
 * (select-item-<i>) — disabled when held, ticked + disabled when already on a PO.
 * Test ids kept from the shared table: approved-vendor-<i> (the dropdown input),
 * quote-file-<i>-<f>.
 */
const COLS = '28px minmax(0,1.6fr) 72px 48px minmax(300px,3fr) 168px minmax(130px,1fr)';
const HEADERS = ['#', 'Item Details', 'Approved Qty', 'Unit', 'Quotation · Vendor', 'Actual Date', 'Remarks'];

const fmtRate = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const hasNum = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));

// Mobile caption shown above a cell once the header row is hidden.
const MobileLabel = ({ children }) => (
  <Typography variant="caption" sx={{ display: { md: 'none' }, color: PFMS.sub, fontWeight: 700, mb: 0.25 }}>
    {children}
  </Typography>
);


const ApprovedVendorTable = ({
  rows,
  yesValue = 'YES',
  onRemoveFile,
  onPatchRow,
  onHold,               // (rowIdx, boolean) — Resume (takes an item that was held earlier off hold)
  selectMode = false,   // Select Items mode: serial → checkbox on quoted rows
  onSelect,             // (rowIdx, boolean) — tick / untick a quoted row
  decisionOf,           // (row) → 'APPROVED' | 'PENDING' | 'ON_HOLD' | 'NO_QUOTE'
  vendorOptions,        // (row) → [{ _id, name, caption?, quotedRate?, deliveryDays? }] — PREVIOUS vendors (quoted for the item or supplied it before)
  vendorState,          // (row) → { loading, failed, noHistory }
  vendors = [],         // the Vendor Master list — "Add New Vendor" offers any active one
  vendorsLoading = false,
  onCreateVendor,       // (row, rowIdx) → opens "create a new vendor" for the item
}) => {
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
          const needsFile = row.statusDone === yesValue;
          const files = row.files || [];
          // Lowest quoted rate among this row's files (only older tagged quotations carry one).
          const rates = files.map((f) => f.quotedRate).filter(hasNum).map(Number);
          const lowestRate = rates.length > 1 ? Math.min(...rates) : null;
          const vendorName = row.vendor?.name || '';
          const decision = decisionOf(row);
          const needsVendorPick = needsFile && !!row.itemId;
          const vs = needsVendorPick ? vendorState(row) : {};

          return (
            <Box
              key={row.itemId || idx}
              data-testid={`approved-item-${idx}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: COLS },
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
              {/* Serial (md+) — a checkbox on quoted rows in Select Items mode */}
              {selectMode && needsVendorPick ? (
                <Checkbox
                  size="small"
                  sx={{ p: 0, width: 24, height: 24, mt: 0.1, display: { xs: 'none', md: 'inline-flex' } }}
                  checked={!!(row.locked || row.selected)}
                  disabled={!!(row.locked || row.hold)}
                  onChange={(e) => onSelect?.(idx, e.target.checked)}
                  inputProps={{ 'aria-label': `Select item ${idx + 1}`, 'data-testid': `select-item-${idx}` }}
                />
              ) : (
                <Box
                  sx={{
                    display: { xs: 'none', md: 'grid' }, placeItems: 'center', width: 24, height: 24, mt: 0.1,
                    borderRadius: '6px', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}`,
                    fontSize: '0.72rem', fontWeight: 800, color: PFMS.sub,
                  }}
                >
                  {idx + 1}
                </Box>
              )}

              {/* Item details */}
              <Box data-cell="wide" sx={{ minWidth: 0 }}>
                <MobileLabel>{`Item ${idx + 1}`}</MobileLabel>
                {selectMode && needsVendorPick && (
                  <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', mb: 0.25 }}>
                    <Checkbox size="small" sx={{ p: 0.25, mr: 0.5 }} checked={!!(row.locked || row.selected)} disabled={!!(row.locked || row.hold)}
                      onChange={(e) => onSelect?.(idx, e.target.checked)} inputProps={{ 'aria-label': `Select item ${idx + 1} (mobile)` }} />
                    <Typography variant="caption" sx={{ color: PFMS.sub, fontWeight: 700 }}>Select</Typography>
                  </Box>
                )}
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: PFMS.ink, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                  {row.itemName || '—'}
                </Typography>
                <Typography component="div" sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'primary.main', overflowWrap: 'anywhere' }}>
                  {row.skuCode ? `SKU: ${row.skuCode}` : 'SKU: —'}
                  {row.itemDisplayNumber ? <Box component="span" sx={{ color: PFMS.sub, fontWeight: 600 }}>{` · ${row.itemDisplayNumber}`}</Box> : null}
                </Typography>
              </Box>

              {/* Approved qty */}
              <Box>
                <MobileLabel>Approved Qty</MobileLabel>
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, lineHeight: '36px' }}>{row.qty ?? '—'}</Typography>
              </Box>

              {/* Unit */}
              <Box>
                <MobileLabel>Unit</MobileLabel>
                <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub, lineHeight: '36px' }}>{row.unit || '—'}</Typography>
              </Box>

              {/* Quotation · Vendor */}
              <Box data-cell="wide" sx={{ minWidth: 0 }}>
                <MobileLabel>{needsFile ? 'Quotation · Approved Vendor *' : 'Vendor'}</MobileLabel>

                {needsFile ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {/* Kept quotations — compact chips */}
                    {files.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {files.map((f, fi) => {
                          const detail = [
                            f.vendor?.name,
                            hasNum(f.quotedRate) && `${fmtRate(f.quotedRate)} / ${row.unit || 'unit'}`,
                            hasNum(f.deliveryDays) && `${f.deliveryDays} day(s)`,
                            f.uploadedAt && new Date(f.uploadedAt).toLocaleDateString(),
                          ].filter(Boolean).join(' · ');
                          return (
                            <Box
                              key={f.fileUrl || fi}
                              data-testid={`quote-file-${idx}-${fi}`}
                              sx={{
                                display: 'inline-flex', alignItems: 'center', gap: 0.25, maxWidth: '100%',
                                pl: 0.75, pr: 0.25, py: 0.1, borderRadius: '6px',
                                border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surfaceAlt,
                              }}
                            >
                              <FileText size={13} color={PFMS.sub} style={{ flexShrink: 0 }} />
                              <Tooltip title={detail || f.fileName || ''}>
                                <Typography noWrap sx={{ fontSize: '0.74rem', fontWeight: 600, color: PFMS.ink, maxWidth: 200, mx: 0.25 }}>
                                  {f.fileName || `File ${fi + 1}`}
                                </Typography>
                              </Tooltip>
                              {lowestRate !== null && Number(f.quotedRate) === lowestRate && (
                                <Typography component="span" sx={{ px: 0.5, mr: 0.25, borderRadius: '5px', bgcolor: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.62rem' }}>Lowest</Typography>
                              )}
                              <Tooltip title="View / Download">
                                <IconButton size="small" href={fileHref(f.fileUrl)} target="_blank" rel="noopener" aria-label="View quotation file" sx={{ p: 0.4 }}>
                                  <ExternalLink size={12} />
                                </IconButton>
                              </Tooltip>
                              {!row.locked && (
                                <Tooltip title="Remove (reject this quotation)">
                                  <IconButton size="small" color="error" onClick={() => onRemoveFile(idx, fi)} aria-label="Remove quotation" data-testid={`approved-remove-${idx}-${fi}`} sx={{ p: 0.4 }}>
                                    <X size={12} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    ) : (
                      <Typography sx={{ fontSize: '0.74rem', color: decision === 'APPROVED' ? 'error.main' : PFMS.sub, fontWeight: 600 }}>
                        {decision === 'APPROVED' ? 'No quotation kept — keep at least one' : 'No quotation kept'}
                      </Typography>
                    )}

                    {/* Vendor decision — approved / pending / on hold / on a PO */}
                    {needsVendorPick ? (
                      row.locked ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }} data-testid={`approved-vendor-state-${idx}`} data-state="locked">
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.4, borderRadius: '6px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surfaceAlt, fontSize: '0.78rem', fontWeight: 600, color: PFMS.ink }}>
                            <span>Vendor:</span>
                            <Box component="span" sx={{ fontWeight: 800 }} data-testid={`approved-vendor-locked-${idx}`}>{row.vendor?.name || '—'}</Box>
                          </Box>
                          <StatusChip status="DONE" tone="green" label={row.poNumber ? `On ${row.poNumber}` : 'On PO'} />
                        </Box>
                      ) : row.hold ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }} data-testid={`approved-vendor-state-${idx}`} data-state="hold">
                          <StatusChip status="ON_HOLD" tone="orange" label="On Hold" />
                          <Typography sx={{ fontSize: '0.74rem', color: PFMS.sub }}>Stays pending — not in any PO</Typography>
                          <Button size="small" variant="text" startIcon={<PlayCircle size={14} />} onClick={() => onHold(idx, false)}
                            data-testid={`approved-resume-${idx}`} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0 }}>
                            Resume
                          </Button>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid={`approved-vendor-state-${idx}`}
                          data-state={row.vendor?._id ? 'selected' : (vs.noHistory ? 'nohistory' : 'none')}>
                          {/* Two ways to choose the vendor (the same picker as the PO / Pending for PO): a PREVIOUS vendor — quoted
                              for the item or supplied it before — or ANY other active vendor ("Add New Vendor"), or create one here. */}
                          <Box sx={{ flex: '1 1 270px', maxWidth: 380, minWidth: 0 }}>
                            <ItemVendorPicker
                              row={row}
                              vendors={vendors}
                              loading={!!vs.loading || vendorsLoading}
                              value={row.vendor?._id ? { _id: String(row.vendor._id), name: row.vendor.name } : null}
                              onChange={(v) => onPatchRow(idx, { vendor: v ? { _id: v._id, name: v.name } : null })}
                              onCreateVendor={onCreateVendor ? () => onCreateVendor(row, idx) : undefined}
                              createLabel="Create new vendor"
                              previousOptions={vendorOptions(row) || []}
                              previousCaption={(o) => [o.caption, hasNum(o.quotedRate) && `${fmtRate(o.quotedRate)} / ${row.unit || 'unit'}`, hasNum(o.deliveryDays) && `${o.deliveryDays} day(s)`].filter(Boolean).join(' · ')}
                              noPreviousText={vs.failed ? 'Could not load the previous vendors — use Add New Vendor.' : 'No previous vendor has quoted for or supplied this item — use Add New Vendor.'}
                              disabled={decision === 'PENDING'}
                              testId={`approved-vendor-pick-${idx}`}
                              inputTestId={`approved-vendor-${idx}`}
                            />
                          </Box>
                          {decision === 'PENDING'
                            ? <StatusChip status="PENDING" tone="amber" label="Pending" />
                            : <StatusChip status="DONE" tone="green" label="Approved" />}
                          {decision === 'APPROVED' && !row.vendor?._id && !vs.noHistory && (
                            <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }} data-testid={`approved-vendor-later-${idx}`}>
                              Vendor not selected — chosen on the PO
                            </Typography>
                          )}
                        </Box>
                      )
                    ) : (
                      <Box><StatusChip status="DONE" tone="green" label="Approved" /></Box>
                    )}
                  </Box>
                ) : (
                  /* Quote Required = No — compact label; the vendor already chosen stays visible */
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }} data-testid={`approved-noquote-${idx}`} data-state={vendorName ? 'selected' : 'pending'}>
                    <Box
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%', px: 1, py: 0.4,
                        borderRadius: '6px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surfaceAlt,
                        fontSize: '0.78rem', fontWeight: 600, color: PFMS.ink,
                      }}
                    >
                      <span>No Quote</span>
                      <Box component="span" sx={{ color: PFMS.faint }}>·</Box>
                      <span>Vendor:</span>
                      <Box component="span" sx={{ fontWeight: 800, minWidth: 0, overflowWrap: 'anywhere', color: vendorName ? PFMS.ink : PFMS.sub }} data-testid={`approved-noquote-vendor-${idx}`}>
                        {vendorName || '—'}
                      </Box>
                    </Box>
                    {!vendorName && (
                      <Tooltip title="Vendor is chosen on Pending for PO">
                        <Box component="span"><StatusChip status="PENDING" tone="amber" label="Pending" /></Box>
                      </Tooltip>
                    )}
                  </Box>
                )}
              </Box>

              {/* Actual date */}
              <Box>
                <MobileLabel>Actual Date</MobileLabel>
                <DateInputDDMMYYYY
                  fullWidth
                  size="small"
                  value={row.actualAt || ''}
                  onChange={(v) => onPatchRow(idx, { actualAt: v })}
                />
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

export default ApprovedVendorTable;
