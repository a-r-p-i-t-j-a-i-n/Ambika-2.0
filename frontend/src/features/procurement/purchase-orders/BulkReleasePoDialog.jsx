import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Chip, Checkbox, Table, TableBody,
  TableCell, TableHead, TableRow, InputAdornment, Popover, MenuItem,
} from '@mui/material';
import {
  Send, Search, CheckCircle2, XCircle, MailWarning, AlertTriangle, Paperclip,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useBulkReleasePurchaseOrdersMutation,
  useGetPoReleasePreviewMutation,
} from '../../../store/api/procurementApi';
import { poDisplayNumber } from './poMeta';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';

const parseEmailList = (raw) => raw.split(',').map((e) => e.trim()).filter(Boolean);

// Mirrors the backend's default body (purchaseOrder.service.js buildPoEmailHtml)
// so the live preview matches exactly what gets sent when no custom message is typed.
const defaultMessage = (vendorName, poNumber) =>
  `Dear ${vendorName || 'Vendor'},\n\nPlease find attached Purchase Order ${poNumber || ''} for your reference and processing.`;

const STATUS_META = {
  READY:              { label: 'Ready',             color: 'success', icon: CheckCircle2 },
  MISSING_RECIPIENT:  { label: 'Missing Recipient',  color: 'warning', icon: MailWarning },
  INVALID_EMAIL:      { label: 'Invalid Email',      color: 'warning', icon: AlertTriangle },
  ALREADY_RELEASED:   { label: 'Already Released',   color: 'default', icon: CheckCircle2 },
};

const EmailStatusBadge = ({ status, loading }) => {
  if (loading) return <Chip size="small" label="…" sx={{ fontWeight: 700 }} />;
  const meta = STATUS_META[status] || STATUS_META.MISSING_RECIPIENT;
  const Icon = meta.icon;
  return <Chip size="small" color={meta.color} variant="outlined" icon={<Icon size={13} />} label={meta.label} sx={{ fontWeight: 700 }} />;
};

// A "To/CC/BCC" table cell — click opens a Popover listing the resolved
// addresses. When "To" is empty, the popover instead shows the Vendor Master
// diagnostic (what's configured vs. missing) with an Edit Vendor shortcut.
const RecipientCell = ({ label, emails, previewRow, vendorId, loading }) => {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  if (loading) return <Typography variant="body2" color="text.disabled">…</Typography>;

  const count = emails?.length || 0;
  const isTo = label === 'To';

  return (
    <>
      <Typography
        variant="body2"
        onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
        sx={{
          cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5,
          color: count ? 'primary.main' : (isTo ? 'warning.main' : 'text.disabled'),
        }}
      >
        {count > 0
          ? `${count} Recipient${count > 1 ? 's' : ''}`
          : (isTo ? '⚠ No Recipient' : 'No Recipient')}
      </Typography>
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={(e) => { e?.stopPropagation?.(); setAnchorEl(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} onClick={(e) => e.stopPropagation()}>
        <Box sx={{ p: 2, minWidth: 240, maxWidth: 320 }}>
          {count > 0 ? (
            <>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{label}</Typography>
              {emails.map((e, i) => <Typography key={i} variant="body2" sx={{ py: 0.25, wordBreak: 'break-all' }}>{e}</Typography>)}
            </>
          ) : isTo ? (
            <>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Vendor Master</Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>To Emails — {previewRow?.to?.length ? previewRow.to.join(', ') : '—'}</Typography>
              <Typography variant="body2">CC Emails — {previewRow?.cc?.length ? previewRow.cc.join(', ') : '—'}</Typography>
              <Typography variant="body2">BCC Emails — {previewRow?.bcc?.length ? previewRow.bcc.join(', ') : '—'}</Typography>
              <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 1.5 }}>
                At least one To Email is required.
              </Typography>
              <Button size="small" variant="outlined" sx={{ mt: 1.5 }}
                onClick={() => navigate(`/procurement/vendors/${vendorId}`)} disabled={!vendorId}>
                Edit Vendor
              </Button>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">No {label} recipients configured.</Typography>
          )}
        </Box>
      </Popover>
    </>
  );
};

/**
 * Bulk-release multiple approved, not-yet-released POs to their vendors in one
 * go (Step 1.4). Own scoped query, checkbox selection via a Set, a 'select'
 * phase and a 'result' phase showing the per-PO success/failure breakdown from
 * the backend. Adds a read-only recipient/subject/body preview (resolved from
 * Vendor Master) and a confirmation step before anything is actually sent —
 * the actual release call (`bulkRelease`) and its payload are unchanged.
 */
const BulkReleasePoDialog = ({ open, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading, isFetching } = useGetPurchaseOrdersQuery(
    { approvalStatus: 'APPROVED', poStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED', limit: 200, sort: '-poDate' },
    { skip: !open },
  );
  const eligible = data?.data || [];
  const eligibleIds = useMemo(() => eligible.map((po) => po._id), [eligible]);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [emailMessage, setEmailMessage] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [phase, setPhase] = useState('select'); // 'select' | 'result'
  const [result, setResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewPoId, setPreviewPoId] = useState('');

  const [bulkRelease, { isLoading: releasing }] = useBulkReleasePurchaseOrdersMutation();
  const [fetchPreview, { isLoading: previewLoading }] = useGetPoReleasePreviewMutation();
  const [previewFrom, setPreviewFrom] = useState('');
  const [previewMap, setPreviewMap] = useState(() => new Map());

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelected(new Set());
    setEmailMessage('');
    setCcInput('');
    setBccInput('');
    setPhase('select');
    setResult(null);
    setConfirmOpen(false);
    setPreviewPoId('');
    setPreviewMap(new Map());
  }, [open]);

  // Resolve To/CC/BCC/subject for every eligible PO — refreshed (debounced) on
  // batch CC/BCC changes, since those are merged into the vendor-resolved lists.
  useEffect(() => {
    if (!open || !eligibleIds.length) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetchPreview({
          poIds: eligibleIds,
          emailMessage: emailMessage.trim(),
          ccEmails: parseEmailList(ccInput),
          bccEmails: parseEmailList(bccInput),
        }).unwrap();
        const payload = res?.data || {};
        setPreviewFrom(payload.from || '');
        setPreviewMap(new Map((payload.items || []).map((it) => [String(it.poId), it])));
      } catch { /* leave table showing loading state; user can retry via cc/bcc edit */ }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eligibleIds.join(','), ccInput, bccInput]);

  // Default the Email Preview panel to the first selected PO whenever the
  // current previewed PO drops out of the selection.
  useEffect(() => {
    if (!selected.size) { setPreviewPoId(''); return; }
    if (!selected.has(previewPoId)) setPreviewPoId([...selected][0]);
  }, [selected, previewPoId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((po) => [poDisplayNumber(po), po.vendorName]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [eligible, search]);

  const allSelected = filtered.length > 0 && filtered.every((po) => selected.has(po._id));
  const someSelected = filtered.some((po) => selected.has(po._id)) && !allSelected;

  const toggleOne = (id) => setSelected((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((cur) => {
    const next = new Set(cur);
    if (allSelected) filtered.forEach((po) => next.delete(po._id));
    else filtered.forEach((po) => next.add(po._id));
    return next;
  });

  const selectedPreviewRows = [...selected].map((id) => previewMap.get(String(id))).filter(Boolean);
  const summary = {
    to: selectedPreviewRows.reduce((s, r) => s + r.to.length, 0),
    cc: selectedPreviewRows.reduce((s, r) => s + r.cc.length, 0),
    bcc: selectedPreviewRows.reduce((s, r) => s + r.bcc.length, 0),
    ready: selectedPreviewRows.filter((r) => r.emailStatus === 'READY').length,
    blocked: selectedPreviewRows.filter((r) => r.emailStatus !== 'READY').length,
  };

  const doRelease = async () => {
    try {
      const res = await bulkRelease({
        poIds: [...selected],
        emailMessage: emailMessage.trim(),
        ccEmails: parseEmailList(ccInput),
        bccEmails: parseEmailList(bccInput),
      }).unwrap();
      setResult(res?.data || null);
      setPhase('result');
      setConfirmOpen(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Bulk release failed', { variant: 'error' });
      setConfirmOpen(false);
    }
  };

  const handleReleaseClick = () => {
    if (!selected.size) { enqueueSnackbar('Select at least one PO', { variant: 'warning' }); return; }
    setConfirmOpen(true);
  };

  const loading = isLoading || isFetching;
  const previewedRow = previewMap.get(String(previewPoId));
  const previewedPo = eligible.find((po) => po._id === previewPoId);

  return (
    <>
      <Dialog open={open} onClose={() => onClose?.(phase === 'result')} maxWidth="lg" fullWidth
        PaperProps={{ sx: { height: '92vh', display: 'flex', flexDirection: 'column' } }}>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          {phase === 'result' ? <CheckCircle2 size={20} color="#16a34a" /> : <Send size={20} />}
          {phase === 'result' ? 'Bulk Release Result' : 'Bulk Release PO'}
          <Chip size="small" color={phase === 'result' ? 'success' : 'default'}
            label={phase === 'result' ? `${result?.released || 0} released` : `${filtered.length} eligible`}
            sx={{ ml: 1, fontWeight: 700 }} />
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {phase === 'result' ? (
            <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2.5 }}>
              <Typography variant="body1" sx={{ fontWeight: 700, mb: 2 }}>
                {result?.released || 0} of {result?.total || 0} PO(s) released successfully
                {result?.failedCount ? `, ${result.failedCount} failed` : ''}.
              </Typography>

              {result?.success?.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.main', textTransform: 'uppercase' }}>
                    Released ({result.success.length})
                  </Typography>
                  <Table size="small" sx={{ mt: 0.5 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>PO No</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Vendor</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Emailed To</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.success.map((r) => (
                        <TableRow key={r.poId}>
                          <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{r.poNumber}</Typography></TableCell>
                          <TableCell>{r.vendorName || '—'}</TableCell>
                          <TableCell>{r.email || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {result?.failed?.length > 0 && (
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'error.main', textTransform: 'uppercase' }}>
                    Failed ({result.failed.length})
                  </Typography>
                  <Table size="small" sx={{ mt: 0.5 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>PO No</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.failed.map((r, i) => (
                        <TableRow key={r.poId || i}>
                          <TableCell><Typography variant="body2" fontWeight={700}>{r.poNumber || '—'}</Typography></TableCell>
                          <TableCell>
                            <Chip size="small" color="error" variant="outlined" icon={<XCircle size={13} />}
                              label={r.reason} sx={{ fontWeight: 600 }} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>
          ) : (
          <>
            {/* Toolbar */}
            <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
              <TextField size="small" placeholder="Search by PO / vendor…" value={search}
                onChange={(e) => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 300 } }}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
              <Box sx={{ flexGrow: 1 }} />
              <Chip color="primary" variant="outlined" label={`${selected.size} selected`} sx={{ fontWeight: 700 }} />
            </Box>

            {/* Table */}
            <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
              {loading ? (
                <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
              ) : (
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" sx={pfmsTableHeadSx}>
                        <Checkbox indeterminate={someSelected} checked={allSelected} onChange={toggleAll} />
                      </TableCell>
                      <TableCell sx={pfmsTableHeadSx}>PO Number</TableCell>
                      <TableCell sx={pfmsTableHeadSx}>Vendor</TableCell>
                      <TableCell sx={pfmsTableHeadSx}>To</TableCell>
                      <TableCell sx={pfmsTableHeadSx}>CC</TableCell>
                      <TableCell sx={pfmsTableHeadSx}>BCC</TableCell>
                      <TableCell sx={pfmsTableHeadSx}>Email Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={7}>
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                          No POs are eligible for release (must be Approved and not yet released).
                        </Typography>
                      </TableCell></TableRow>
                    )}
                    {filtered.map((po) => {
                      const row = previewMap.get(String(po._id));
                      const rowLoading = previewLoading && !row;
                      return (
                        <TableRow key={po._id} hover selected={selected.has(po._id)} onClick={() => toggleOne(po._id)} sx={{ cursor: 'pointer' }}>
                          <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selected.has(po._id)} onChange={() => toggleOne(po._id)} />
                          </TableCell>
                          <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{poDisplayNumber(po)}</Typography></TableCell>
                          <TableCell>{po.vendorName || '—'}</TableCell>
                          <TableCell><RecipientCell label="To" emails={row?.to} previewRow={row} vendorId={po.vendorId} loading={rowLoading} /></TableCell>
                          <TableCell><RecipientCell label="CC" emails={row?.cc} previewRow={row} vendorId={po.vendorId} loading={rowLoading} /></TableCell>
                          <TableCell><RecipientCell label="BCC" emails={row?.bcc} previewRow={row} vendorId={po.vendorId} loading={rowLoading} /></TableCell>
                          <TableCell><EmailStatusBadge status={row?.emailStatus} loading={rowLoading} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Box>

            {/* Batch email options */}
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField size="small" label="Email message (optional)" value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)} sx={{ flexGrow: 1, minWidth: 220 }} />
              <TextField size="small" label="CC (comma-separated)" value={ccInput}
                onChange={(e) => setCcInput(e.target.value)} sx={{ minWidth: 200 }}
                helperText="Added to each vendor's CC from Vendor Master" />
              <TextField size="small" label="BCC (comma-separated)" value={bccInput}
                onChange={(e) => setBccInput(e.target.value)} sx={{ minWidth: 200 }}
                helperText="Added to each vendor's BCC from Vendor Master" />
            </Box>

            {/* Email Preview */}
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 700 }}>Email Preview</Typography>
                {selected.size > 1 && (
                  <TextField select size="small" label="Previewing" value={previewPoId || ''}
                    onChange={(e) => setPreviewPoId(e.target.value)} sx={{ minWidth: 220 }}>
                    {[...selected].map((id) => {
                      const po = eligible.find((p) => p._id === id);
                      return <MenuItem key={id} value={id}>{po ? poDisplayNumber(po) : id}</MenuItem>;
                    })}
                  </TextField>
                )}
              </Box>
              {!previewedPo ? (
                <Typography variant="body2" color="text.secondary">Select at least one PO to preview its email.</Typography>
              ) : (
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>From</Typography>
                    <Typography variant="body2">{previewFrom || '—'}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>To</Typography>
                    <Typography variant="body2" color={previewedRow?.to?.length ? 'text.primary' : 'warning.main'}>
                      {previewedRow?.to?.length ? previewedRow.to.join(', ') : '⚠ No Recipient Configured'}
                    </Typography>
                  </Box>
                  {previewedRow?.cc?.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>CC</Typography>
                      <Typography variant="body2">{previewedRow.cc.join(', ')}</Typography>
                    </Box>
                  )}
                  {previewedRow?.bcc?.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>BCC</Typography>
                      <Typography variant="body2">{previewedRow.bcc.join(', ')}</Typography>
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>Subject</Typography>
                    <Typography variant="body2">{previewedRow?.subject || `Purchase Order ${poDisplayNumber(previewedPo)}`}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>Attachment</Typography>
                    <Typography variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      <Paperclip size={13} /> {previewedRow?.attachmentName || `${poDisplayNumber(previewedPo)}.pdf`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 70, color: 'text.secondary' }}>Message</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {emailMessage.trim() || defaultMessage(previewedPo.vendorName, poDisplayNumber(previewedPo))}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Selection summary */}
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 3, flexWrap: 'wrap', bgcolor: PFMS.surfaceAlt }}>
              <Box><Typography variant="caption" color="text.secondary">Selected POs</Typography><Typography sx={{ fontWeight: 800 }}>{selected.size}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Recipients — To</Typography><Typography sx={{ fontWeight: 800 }}>{summary.to}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">CC</Typography><Typography sx={{ fontWeight: 800 }}>{summary.cc}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">BCC</Typography><Typography sx={{ fontWeight: 800 }}>{summary.bcc}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Attachments</Typography><Typography sx={{ fontWeight: 800 }}>{selected.size} PDF{selected.size === 1 ? '' : 's'}</Typography></Box>
              <Box><Typography variant="caption" color="success.main">Ready</Typography><Typography sx={{ fontWeight: 800, color: 'success.main' }}>{summary.ready}</Typography></Box>
              <Box><Typography variant="caption" color="warning.main">Blocked</Typography><Typography sx={{ fontWeight: 800, color: 'warning.main' }}>{summary.blocked}</Typography></Box>
            </Box>
          </>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, gap: 1, justifyContent: 'space-between' }}>
          {phase === 'result' ? (
            <>
              <Typography variant="body2" color="text.secondary">Release list refreshed automatically.</Typography>
              <Button variant="contained" onClick={() => onClose?.(true)}>Close</Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">{selected.size} PO(s) selected</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={() => onClose?.(false)} disabled={releasing}>Cancel</Button>
                <Button variant="contained" color="success"
                  startIcon={<Send size={16} />}
                  onClick={handleReleaseClick} disabled={releasing || selected.size === 0}>
                  Release Selected
                </Button>
              </Box>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Confirmation before anything is actually sent */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Confirm Release</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            You are about to send <b>{selected.size}</b> Purchase Order{selected.size === 1 ? '' : 's'}.
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, mb: 2 }}>
            <Box><Typography variant="caption" color="text.secondary">To</Typography><Typography sx={{ fontWeight: 800 }}>{summary.to}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">CC</Typography><Typography sx={{ fontWeight: 800 }}>{summary.cc}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">BCC</Typography><Typography sx={{ fontWeight: 800 }}>{summary.bcc}</Typography></Box>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Attachments: {selected.size} Purchase Order PDF{selected.size === 1 ? '' : 's'}
          </Typography>
          {summary.blocked > 0 && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1.5 }}>
              ⚠ {summary.blocked} of these have no recipient or an invalid email and will fail.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={releasing}>Cancel</Button>
          <Button variant="contained" color="success"
            startIcon={releasing ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
            onClick={doRelease} disabled={releasing}>
            Send Emails
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default BulkReleasePoDialog;
