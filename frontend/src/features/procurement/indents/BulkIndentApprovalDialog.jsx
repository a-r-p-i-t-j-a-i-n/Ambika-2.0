import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Chip, Checkbox, IconButton, MenuItem,
  Table, TableBody, TableCell, TableHead, TableRow, Collapse,
  InputAdornment, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Search, ChevronDown, ChevronRight, CheckCircle2, XCircle, ClipboardList, FileText,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIndentsQuery,
  useBulkApproveIndentsMutation,
  useBulkRejectIndentsMutation,
} from '../../../store/api/procurementApi';
import { DEPARTMENTS } from './indentMeta';
import { PFMS } from '../pfmsTheme';

const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
    WebkitAppearance: 'none', margin: 0,
  },
};
const num = (n) => Number(n) || 0;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const productsSummary = (items = []) => {
  if (!items.length) return '—';
  return items.length > 1 ? `${items[0].itemName} +${items.length - 1} more` : items[0].itemName;
};

// Approved Qty auto-syncs from Revised Qty; falls back to the requested
// quantity when Revised Qty is left blank. Not tracked in state separately.
const approvedQtyOf = (it) => (it.revisedQuantity === '' || it.revisedQuantity == null ? num(it.requestedQty) : num(it.revisedQuantity));

// Map a fetched indent into an editable row (per-item revised qty only —
// Approved Qty always mirrors it, see approvedQtyOf).
const toRow = (ind) => {
  const items = (ind.items || []).map((it) => ({
    _id: it._id,
    itemName: it.itemName || '',
    skuCode: it.skuCode || '',
    unit: it.unit || 'Pcs',
    requestedQty: num(it.quantity),
    revisedQuantity: it.revisedQuantity ? num(it.revisedQuantity) : num(it.quantity),
    remarks: it.remarks || '',
    approvalStatus: 'APPROVED',
    rejectionReason: '',
  }));
  return {
    _id: ind._id,
    indentNumber: ind.indentNumber,
    approvalStatus: ind.approvalStatus,
    createdAt: ind.createdAt || ind.timestamp,
    raisedBy: ind.raisedBy || '',
    department: ind.department || '',
    remarks: '', // approval remarks
    items,
  };
};

/**
 * Bulk approve / reject pending Purchase Indents from one modal. Lists only
 * PENDING_APPROVAL indents; each row expands to edit item-wise revised/approved
 * quantities. Approve and Reject act on the selected rows.
 */
const BulkIndentApprovalDialog = ({ open, onClose, onReceiveQuote }) => {
  const { enqueueSnackbar } = useSnackbar();

  // Indents "awaiting approval" = PENDING_APPROVAL + DRAFT (the single-approve
  // flow accepts both). The query param is single-valued, so fetch each + merge.
  const pendingQ = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', approvalStatus: 'PENDING_APPROVAL' },
    { skip: !open },
  );
  const draftQ = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', approvalStatus: 'DRAFT' },
    { skip: !open },
  );
  const data = useMemo(
    () => ({ data: [...(pendingQ.data?.data || []), ...(draftQ.data?.data || [])] }),
    [pendingQ.data, draftQ.data],
  );
  const isLoading = pendingQ.isLoading || draftQ.isLoading;
  const isFetching = pendingQ.isFetching || draftQ.isFetching;

  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Result phase shown after a successful bulk approve.
  const [phase, setPhase] = useState('select'); // 'select' | 'result'
  const [approvedList, setApprovedList] = useState([]); // enriched rows from backend
  const [approvedSnapshot, setApprovedSnapshot] = useState([]); // local rows (with items) for the quote dialog

  const [bulkApprove, { isLoading: approving }] = useBulkApproveIndentsMutation();
  const [bulkReject, { isLoading: rejecting }] = useBulkRejectIndentsMutation();
  const busy = approving || rejecting;

  // Reset to the selection phase each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setPhase('select');
    setApprovedList([]);
    setApprovedSnapshot([]);
    setSelected(new Set());
    setExpanded(new Set());
    setSearch('');
    setDept('');
    setRejectOpen(false);
    setRejectReason('');
  }, [open]);

  // Hydrate the editable rows whenever the fetched data changes (select phase).
  useEffect(() => {
    setRows((data?.data || []).map(toRow));
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept && r.department !== dept) return false;
      if (!q) return true;
      return [r.indentNumber, r.raisedBy, productsSummary(r.items)]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, dept]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r._id));
  const someSelected = filtered.some((r) => selected.has(r._id)) && !allSelected;

  const toggleOne = (id) => setSelected((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((cur) => {
    const next = new Set(cur);
    if (allSelected) filtered.forEach((r) => next.delete(r._id));
    else filtered.forEach((r) => next.add(r._id));
    return next;
  });
  const toggleExpand = (id) => setExpanded((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const setItem = (rowId, itemIdx, patch) => setRows((cur) => cur.map((r) => (
    r._id === rowId ? { ...r, items: r.items.map((it, i) => (i === itemIdx ? { ...it, ...patch } : it)) } : r
  )));
  const setRowRemarks = (rowId, val) => setRows((cur) => cur.map((r) => (r._id === rowId ? { ...r, remarks: val } : r)));

  const selectedRows = rows.filter((r) => selected.has(r._id));

  const handleApprove = async () => {
    if (!selectedRows.length) { enqueueSnackbar('Select at least one indent', { variant: 'warning' }); return; }
    // Same rule as the single-approve dialog: Revised Qty must be > 0 — only
    // for items still marked Approved. It may be lower than, equal to, or
    // greater than the requested quantity.
    const invalidRow = selectedRows.find((r) => r.items.some((it) => {
      if (it.approvalStatus === 'REJECTED') return false;
      const approvedQty = approvedQtyOf(it);
      return !(approvedQty > 0);
    }));
    if (invalidRow) {
      enqueueSnackbar(
        `Fix the revised quantity for "${invalidRow.indentNumber}" — it must be greater than 0`,
        { variant: 'warning' },
      );
      return;
    }
    const missingReasonRow = selectedRows.find((r) => r.items.some((it) => it.approvalStatus === 'REJECTED' && !it.rejectionReason.trim()));
    if (missingReasonRow) {
      enqueueSnackbar(`Rejection reason is required for every rejected item in "${missingReasonRow.indentNumber}"`, { variant: 'warning' });
      return;
    }
    const payload = {
      indents: selectedRows.map((r) => ({
        indentId: r._id,
        items: r.items.map((it) => ({
          itemId: it._id,
          approvalStatus: it.approvalStatus,
          ...(it.approvalStatus === 'REJECTED'
            ? { rejectionReason: it.rejectionReason.trim(), revisedQuantity: 0, approvedQuantity: 0 }
            : {
              revisedQuantity: approvedQtyOf(it),
              // Mirrors Revised Qty — the backend re-derives this itself either way.
              approvedQuantity: approvedQtyOf(it),
            }),
        })),
        remarks: r.remarks.trim(),
      })),
    };
    try {
      const res = await bulkApprove(payload).unwrap();
      const r = res?.data || {};
      const rejectedItems = (r.approved || []).reduce((s, a) => s + (a.rejectedItemCount || 0), 0);
      enqueueSnackbar(
        rejectedItems
          ? `${r.approvedCount || 0} indent(s) processed (${rejectedItems} item(s) rejected)`
          : `${r.approvedCount || 0} indent(s) approved successfully`,
        { variant: 'success' },
      );
      if (r.failed?.length) enqueueSnackbar(`${r.failed.length} indent(s) could not be approved`, { variant: 'warning' });
      // Snapshot the approved rows (with items) so we can launch Step 1.2 directly,
      // independent of the list refetch that follows.
      const okIds = new Set((r.approved || []).map((a) => String(a._id)));
      setApprovedSnapshot(selectedRows.filter((row) => okIds.has(String(row._id))));
      setApprovedList(r.approved || []);
      setPhase('result');
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Bulk approval failed', { variant: 'error' });
    }
  };

  // Quote-eligible just after approval.
  const canReceiveQuote = (a) => ['QUOTE_PENDING', 'INDENT_APPROVED'].includes(a.overallStatus);

  // Build an indent object the existing QuoteComparativeDialog can consume from
  // the locally edited row (carries item-wise approved/revised quantities).
  const launchReceiveQuote = (a) => {
    const row = approvedSnapshot.find((rw) => String(rw._id) === String(a._id));
    const items = (row?.items || []).map((it) => ({
      _id: it._id,
      itemName: it.itemName,
      skuCode: it.skuCode,
      unit: it.unit,
      quantity: num(it.requestedQty),
      revisedQuantity: approvedQtyOf(it),
      approvedQuantity: approvedQtyOf(it),
    }));
    const indentForQuote = {
      _id: a._id,
      indentNumber: a.indentNumber,
      department: a.department,
      approvedQuantity: a.approvedQty,
      approvalStatus: 'APPROVED',
      overallStatus: a.overallStatus,
      items,
      quoteComparativeStep: null,
    };
    onClose?.(false);
    onReceiveQuote?.(indentForQuote);
  };

  const handleReject = async () => {
    if (!selectedRows.length) { enqueueSnackbar('Select at least one indent', { variant: 'warning' }); return; }
    if (!rejectReason.trim()) { enqueueSnackbar('Rejection remarks are required', { variant: 'warning' }); return; }
    try {
      const res = await bulkReject({ indentIds: selectedRows.map((r) => r._id), remarks: rejectReason.trim() }).unwrap();
      const r = res?.data || {};
      enqueueSnackbar(`${r.rejectedCount || 0} indent(s) rejected`, { variant: 'success' });
      if (r.failed?.length) enqueueSnackbar(`${r.failed.length} indent(s) could not be rejected`, { variant: 'warning' });
      setRejectOpen(false);
      setRejectReason('');
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Bulk reject failed', { variant: 'error' });
    }
  };

  const loading = isLoading || isFetching;
  const COLS = 11;

  return (
    <>
      <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xl" fullWidth
        PaperProps={{ sx: { height: '92vh', display: 'flex', flexDirection: 'column' } }}>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          {phase === 'result' ? <CheckCircle2 size={20} color="#16a34a" /> : <ClipboardList size={20} />}
          {phase === 'result' ? 'Approved Successfully' : 'Bulk Approve Indents'}
          <Chip size="small" color={phase === 'result' ? 'success' : 'default'}
            label={phase === 'result' ? `${approvedList.length} approved` : `${filtered.length} awaiting approval`}
            sx={{ ml: 1, fontWeight: 700 }} />
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          {phase === 'result' ? (
            <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Continue directly to Step 1.2 — Receive Quote &amp; Make Comparative — for any approved indent below.
              </Typography>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Indent No</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Products</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Items</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Department</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Approved Qty</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {approvedList.length === 0 && (
                    <TableRow><TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No indents were approved.</Typography>
                    </TableCell></TableRow>
                  )}
                  {approvedList.map((a) => (
                    <TableRow key={a._id} hover>
                      <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{a.indentNumber}</Typography></TableCell>
                      <TableCell><Typography variant="body2" noWrap title={a.productsSummary}>{a.productsSummary}</Typography></TableCell>
                      <TableCell align="right">{a.itemsCount}</TableCell>
                      <TableCell>{a.department || '—'}</TableCell>
                      <TableCell align="right">{a.approvedQty}</TableCell>
                      <TableCell align="right">
                        {canReceiveQuote(a)
                          ? <Button size="small" variant="contained" startIcon={<FileText size={14} />} onClick={() => launchReceiveQuote(a)}>Receive Quote</Button>
                          : <Typography variant="caption" color="text.disabled">—</Typography>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
          <>
          {/* Toolbar */}
          <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField size="small" placeholder="Search by indent / raised by / product…" value={search}
              onChange={(e) => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 320 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
            <TextField size="small" select label="Department" value={dept} onChange={(e) => setDept(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">All</MenuItem>
              {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
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
                    <TableCell padding="checkbox" sx={{ bgcolor: PFMS.surfaceAlt }}>
                      <Checkbox indeterminate={someSelected} checked={allSelected} onChange={toggleAll} />
                    </TableCell>
                    <TableCell sx={{ width: 36, bgcolor: PFMS.surfaceAlt }} />
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Indent No</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Created</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Raised By</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Dept</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Items</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Products</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Total Qty</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: PFMS.surfaceAlt, minWidth: 200 }}>Approval Remarks</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={COLS}>
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                        No indents awaiting approval.
                      </Typography>
                    </TableCell></TableRow>
                  )}
                  {filtered.map((r) => {
                    const isOpen = expanded.has(r._id);
                    const totalQty = r.items.reduce((s, it) => s + num(it.requestedQty), 0);
                    return (
                      <React.Fragment key={r._id}>
                        <TableRow hover selected={selected.has(r._id)}>
                          <TableCell padding="checkbox">
                            <Checkbox checked={selected.has(r._id)} onChange={() => toggleOne(r._id)} />
                          </TableCell>
                          <TableCell>
                            <IconButton size="small" onClick={() => toggleExpand(r._id)}>
                              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700} color="primary.main">{r.indentNumber}</Typography>
                          </TableCell>
                          <TableCell><Typography variant="body2" color="text.secondary">{fmtDate(r.createdAt)}</Typography></TableCell>
                          <TableCell>{r.raisedBy || '—'}</TableCell>
                          <TableCell>{r.department || '—'}</TableCell>
                          <TableCell align="right">{r.items.length}</TableCell>
                          <TableCell><Typography variant="body2" noWrap title={productsSummary(r.items)}>{productsSummary(r.items)}</Typography></TableCell>
                          <TableCell align="right">{totalQty}</TableCell>
                          <TableCell>
                            <Chip size="small"
                              color={r.approvalStatus === 'PENDING_APPROVAL' ? 'warning' : 'default'}
                              label={r.approvalStatus === 'PENDING_APPROVAL' ? 'Pending' : 'Draft'}
                              sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }} />
                          </TableCell>
                          <TableCell>
                            <TextField size="small" fullWidth placeholder="Approval remarks" value={r.remarks}
                              onChange={(e) => setRowRemarks(r._id, e.target.value)} onClick={(e) => e.stopPropagation()} />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={COLS} sx={{ py: 0, borderBottom: isOpen ? '1px solid' : 'none', borderColor: 'divider' }}>
                            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                              <Box sx={{ m: 1.5, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.03) }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>ITEMS ({r.items.length})</Typography>
                                <Table size="small" sx={{ mt: 0.5 }}>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell sx={{ fontWeight: 700 }}>Item Name</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
                                      <TableCell align="right" sx={{ fontWeight: 700 }}>Requested</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Unit</TableCell>
                                      <TableCell align="center" sx={{ fontWeight: 700, width: 150 }}>Decision</TableCell>
                                      <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Revised Qty</TableCell>
                                      <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Approved Qty (auto)</TableCell>
                                      <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Rejection Reason</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {r.items.map((it, i) => {
                                      const isRejected = it.approvalStatus === 'REJECTED';
                                      return (
                                        <TableRow key={it._id || i} sx={isRejected ? { bgcolor: alpha('#dc2626', 0.04) } : undefined}>
                                          <TableCell>{it.itemName}</TableCell>
                                          <TableCell>{it.skuCode || '—'}</TableCell>
                                          <TableCell align="right">{it.requestedQty}</TableCell>
                                          <TableCell>{it.unit}</TableCell>
                                          <TableCell align="center">
                                            <ToggleButtonGroup size="small" exclusive value={it.approvalStatus}
                                              onChange={(e, val) => val && setItem(r._id, i, { approvalStatus: val })}>
                                              <ToggleButton value="APPROVED" color="success" sx={{ py: 0.1, px: 0.75, textTransform: 'none', fontSize: '0.65rem' }}>Approve</ToggleButton>
                                              <ToggleButton value="REJECTED" color="error" sx={{ py: 0.1, px: 0.75, textTransform: 'none', fontSize: '0.65rem' }}>Reject</ToggleButton>
                                            </ToggleButtonGroup>
                                          </TableCell>
                                          <TableCell align="right">
                                            <TextField size="small" type="number" value={it.revisedQuantity} disabled={isRejected}
                                              onChange={(e) => setItem(r._id, i, { revisedQuantity: e.target.value })}
                                              inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={{ ...NO_SPIN, width: 90 }} />
                                          </TableCell>
                                          <TableCell align="right">
                                            {/* Read-only — always mirrors Revised Qty, shown for transparency. */}
                                            <TextField size="small" type="number" value={isRejected ? 0 : approvedQtyOf(it)} disabled
                                              inputProps={{ style: { textAlign: 'right' } }} sx={{ ...NO_SPIN, width: 90 }} />
                                          </TableCell>
                                          <TableCell>
                                            {isRejected ? (
                                              <TextField size="small" fullWidth required placeholder="Reason…"
                                                value={it.rejectionReason} onChange={(e) => setItem(r._id, i, { rejectionReason: e.target.value })}
                                                error={!it.rejectionReason.trim()} />
                                            ) : (it.remarks || '—')}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Box>
          </>
          )}
        </DialogContent>

        {/* Sticky footer */}
        <DialogActions sx={{ p: 2, gap: 1, justifyContent: 'space-between' }}>
          {phase === 'result' ? (
            <>
              <Typography variant="body2" color="text.secondary">{approvedList.length} indent(s) approved</Typography>
              <Button variant="contained" onClick={() => onClose?.(true)}>Close</Button>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">{selected.size} indent(s) selected</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
                <Button color="error" variant="outlined" startIcon={<XCircle size={16} />}
                  onClick={() => setRejectOpen(true)} disabled={busy || selected.size === 0}>
                  Reject Selected
                </Button>
                <Button color="success" variant="contained" startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
                  onClick={handleApprove} disabled={busy || selected.size === 0}>
                  Approve Selected
                </Button>
              </Box>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Reject reason confirmation */}
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Reject {selected.size} Indent(s)</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            This will reject the selected pending indents. A rejection reason is required.
          </Typography>
          <TextField label="Reject reason" required fullWidth multiline minRows={2} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)} placeholder="Rejected due to…"
            error={rejectReason.length > 0 && !rejectReason.trim()}
            helperText="Required — recorded on each rejected indent's timeline." />
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setRejectOpen(false)} disabled={rejecting}>Cancel</Button>
          <Button color="error" variant="contained" startIcon={rejecting ? <CircularProgress size={16} color="inherit" /> : <XCircle size={16} />}
            onClick={handleReject} disabled={rejecting || !rejectReason.trim()}>
            Confirm Reject
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default BulkIndentApprovalDialog;
