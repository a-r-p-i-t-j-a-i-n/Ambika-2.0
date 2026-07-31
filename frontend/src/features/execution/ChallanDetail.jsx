import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Chip, Stack, Button, IconButton, Skeleton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, alpha,
  TextField, MenuItem, CircularProgress,
} from '@mui/material';
import {
  ArrowLeft, ExternalLink, Truck, Calendar, Hash, User, Clock, MapPin,
  Package, FileText, CheckCircle2, AlertTriangle, CornerUpRight, Boxes, Scale,
  Download, FileSearch, RefreshCw, Pencil, Save, X,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetChallanByIdQuery, useGenerateChallanPdfMutation, useUpdateChallanMutation } from '../../store/api/dispatchControlApi';
import { resolveFileUrl } from '../../utils/fileUrl';

// Render the challan PDF live from the backend (fresh each time) — never rely on
// a stored pdfUrl, which may point at the dev host (localhost) and be dead on prod.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

const DISPATCH_STATUSES = ['CREATED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
const TRANSPORT_TYPES = ['Freight Paid', 'To Pay', 'Party Vehicle'];

// Warm "Editorial Clean" palette — neutrals are warm greige/khaki, status hues kept.
const C = {
  ink: '#1c1e21', body: '#3f4650', primary: '#1d4ed8', primaryDk: '#1a44bf',
  success: '#15803d', warning: '#b45309', error: '#be123c',
  slate: '#6b7280', faint: '#9ca3af', line: '#e4e1d9',
  surface: '#ffffff', surfaceAlt: '#f7f6f2', canvas: '#e9e7e1', band: '#efece5',
};

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');
const fmtDT = (d) => (d ? dayjs(d).format('DD MMM YYYY · hh:mm A') : '—');
const fmtD = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const STATUS_COLOR = {
  CREATED: C.warning, DISPATCHED: C.primary, DELIVERED: C.success, CANCELLED: C.error,
};

const Field = ({ icon: Icon, label, value, onClick }) => (
  <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 180 }}>
    <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1.5, display: 'grid', placeItems: 'center',
      bgcolor: alpha(C.primary, 0.08), color: C.primary }}>
      <Icon size={15} />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      <Typography
        onClick={onClick}
        sx={{
          fontSize: '0.84rem', fontWeight: 700, color: onClick ? C.primary : C.ink,
          cursor: onClick ? 'pointer' : 'default', wordBreak: 'break-word',
          '&:hover': onClick ? { textDecoration: 'underline' } : {},
        }}
      >
        {value || '—'}
      </Typography>
    </Box>
  </Stack>
);

const ChallanDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: res, isLoading } = useGetChallanByIdQuery(id);
  const [generatePdf, { isLoading: generating }] = useGenerateChallanPdfMutation();
  const [updateChallan, { isLoading: saving }] = useUpdateChallanMutation();
  const dc = res?.data;

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  const startEdit = () => {
    setForm({
      dcDate: dc.dcDate ? dayjs(dc.dcDate).format('YYYY-MM-DD') : '',
      vehicleNo: dc.vehicleNo || '',
      transporterName: dc.transporterName || '',
      transportMode: dc.transportMode || 'Road',
      dispatchedThrough: dc.dispatchedThrough || 'Freight Paid',
      invoiceNo: dc.invoiceNo || '',
      lrNo: dc.lrNo || '',
      deliveryAddress: dc.deliveryAddress || '',
      clientEmail: dc.clientEmail || '',
      status: dc.status || 'CREATED',
      remark: dc.remark || '',
    });
    setEditing(true);
  };
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const saveEdit = async () => {
    try {
      await updateChallan({ id, ...form }).unwrap();
      // Refresh the challan PDF so edited transporter / vehicle / invoice etc. reflect in it.
      try { await generatePdf(id).unwrap(); } catch { /* non-fatal */ }
      enqueueSnackbar('Dispatch updated — PDF refreshed.', { variant: 'success' });
      setEditing(false);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not update the dispatch.', { variant: 'error' });
    }
  };
  // Live PDF: fetch the freshly-rendered bytes from the backend and show them via a
  // blob URL — works on prod regardless of any stale stored URL. Re-fetched on edit.
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const loadPdf = useCallback(async () => {
    if (!id) return;
    setPdfLoading(true); setPdfError('');
    let url;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/challans/${id}/pdf/preview`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not render the challan PDF.');
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      setPdfBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      setPdfError(e.message || 'Could not render the challan PDF.');
    } finally {
      setPdfLoading(false);
    }
  }, [id]);

  useEffect(() => { if (dc?._id) loadPdf(); }, [dc?._id, loadPdf]);
  useEffect(() => () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); }, [pdfBlobUrl]);

  const pdfHref = pdfBlobUrl;

  if (isLoading) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rectangular" height={420} sx={{ borderRadius: 2 }} /></Box>;
  }
  if (!dc) return <Box sx={{ p: 3 }}><Typography>Delivery challan not found.</Typography></Box>;

  const statusColor = STATUS_COLOR[dc.status] || C.slate;

  const headBtn = {
    color: C.body, borderColor: C.line, textTransform: 'none', fontWeight: 700, borderRadius: '7px',
    '&:hover': { borderColor: C.faint, bgcolor: C.surfaceAlt },
  };
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.canvas, pb: 4 }}>
      {/* ── Header — flush warm white bar (was a navy gradient hero) ── */}
      <Box sx={{
        bgcolor: C.surface, borderBottom: `1px solid ${C.line}`,
        px: { xs: 1.5, md: 2.5 }, py: 1.5, position: 'sticky', top: 0, zIndex: 5,
      }}>
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
          <IconButton size="small" onClick={() => navigate('/challans')}
            sx={{ color: C.body, border: `1px solid ${C.line}`, borderRadius: '7px' }}>
            <ArrowLeft size={16} />
          </IconButton>
          <Box sx={{ width: 36, height: 36, borderRadius: '8px', display: 'grid', placeItems: 'center',
            bgcolor: alpha(C.primary, 0.1), color: C.primary }}>
            <Truck size={18} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.25rem' }, fontWeight: 800, color: C.ink, lineHeight: 1.2 }}>
              {dc.dcNumber}
            </Typography>
            <Typography sx={{ fontSize: '0.76rem', color: C.slate }}>
              Delivery Challan · {dc.partyName}
            </Typography>
          </Box>
          <Chip
            label={dc.status || 'CREATED'}
            size="small"
            sx={{ bgcolor: alpha(statusColor, 0.12), color: statusColor, fontWeight: 800, fontSize: '0.66rem', letterSpacing: '0.03em' }}
          />
          {!editing && (
            <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={startEdit} sx={headBtn}>
              Edit
            </Button>
          )}
          <Button size="small" variant="contained" disableElevation startIcon={<Download size={14} />}
            href={pdfHref || undefined} target="_blank" rel="noreferrer" disabled={!pdfHref}
            sx={{ fontWeight: 700, textTransform: 'none', borderRadius: '7px', bgcolor: C.primary, boxShadow: 'none', '&:hover': { bgcolor: C.primaryDk, boxShadow: 'none' } }}>
            Download
          </Button>
          <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} disabled={generating || pdfLoading}
            onClick={async () => { try { await generatePdf(id).unwrap(); } catch { /* non-fatal */ } loadPdf(); }}
            sx={headBtn}>
            Regenerate
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* ── Order + phase linkage ───────────────────────────── */}
        <Paper sx={{ p: 2, borderRadius: "10px", border: `1px solid ${C.line}` }}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap alignItems="center">
            <Field icon={Hash} label="Sales Order" value={dc.soNumber}
              onClick={dc.orderId ? () => navigate(`/orders/${dc.orderId}`) : undefined} />
            <Field icon={User} label="Customer" value={dc.partyName} />
            <Field icon={Hash} label="PO Number" value={dc.poNumber} />
            <Box sx={{ flex: 1 }} />
            {dc.isUnplanned ? (
              <Chip icon={<AlertTriangle size={13} />} label="Unplanned dispatch"
                sx={{ fontWeight: 800, bgcolor: alpha(C.warning, 0.12), color: C.warning,
                  '& .MuiChip-icon': { color: 'inherit' } }} />
            ) : dc.phaseRef?.phaseNo ? (
              <Chip
                icon={<CheckCircle2 size={13} />}
                label={`Fulfils Plan Phase ${dc.phaseRef.phaseNo}`}
                onClick={() => navigate(`/dispatch-planning?so=${encodeURIComponent(dc.soNumber)}&phase=${dc.phaseRef.phaseNo}`)}
                sx={{ fontWeight: 800, cursor: 'pointer', bgcolor: alpha(C.success, 0.12), color: C.success,
                  '& .MuiChip-icon': { color: 'inherit' } }}
              />
            ) : null}
          </Stack>
        </Paper>

        {/* ── When & How ──────────────────────────────────────── */}
        <Paper sx={{ p: 2, borderRadius: "10px", border: `1px solid ${C.line}` }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              When &amp; How
            </Typography>
            <Box sx={{ flex: 1 }} />
            {editing && (
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<X size={14} />} onClick={() => setEditing(false)} sx={{ color: C.slate }}>Cancel</Button>
                <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={13} color="inherit" /> : <Save size={14} />} disabled={saving} onClick={saveEdit} sx={{ fontWeight: 700 }}>
                  Save changes
                </Button>
              </Stack>
            )}
          </Stack>

          {editing ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
              <TextField size="small" type="date" label="Dispatch Date" InputLabelProps={{ shrink: true }} value={form.dcDate} onChange={setF('dcDate')} />
              <TextField size="small" select label="Status" value={form.status} onChange={setF('status')}>
                {DISPATCH_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Vehicle No" value={form.vehicleNo} onChange={setF('vehicleNo')} />
              <TextField size="small" label="Transporter" value={form.transporterName} onChange={setF('transporterName')} />
              <TextField size="small" label="Transport Mode" value={form.transportMode} onChange={setF('transportMode')} />
              <TextField size="small" select label="Dispatched Through" value={form.dispatchedThrough} onChange={setF('dispatchedThrough')}>
                {TRANSPORT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Invoice No" value={form.invoiceNo} onChange={setF('invoiceNo')} />
              <TextField size="small" label="L.R. / Docket No" value={form.lrNo} onChange={setF('lrNo')} />
              <TextField size="small" label="Client Email" value={form.clientEmail} onChange={setF('clientEmail')} />
              <TextField size="small" label="Delivery Address" value={form.deliveryAddress} onChange={setF('deliveryAddress')} sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }} />
              <TextField size="small" label="Remark" value={form.remark} onChange={setF('remark')} multiline minRows={2} sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }} />
            </Box>
          ) : (
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Field icon={Calendar} label="Dispatch Date" value={fmtD(dc.dcDate)} />
              <Field icon={Clock} label="Recorded On" value={fmtDT(dc.createdAt)} />
              <Field icon={User} label="Recorded By" value={dc.createdBy?.name || 'System'} />
              <Field icon={Truck} label="Vehicle No" value={dc.vehicleNo} />
              <Field icon={CornerUpRight} label="Transporter" value={dc.transporterName} />
              <Field icon={Truck} label="Transport Mode" value={dc.transportMode} />
              <Field icon={Package} label="Dispatched Through" value={dc.dispatchedThrough} />
              <Field icon={FileText} label="Invoice No" value={dc.invoiceNo} />
              <Field icon={FileText} label="L.R. / Docket No" value={dc.lrNo} />
              <Field icon={MapPin} label="Delivery Address" value={dc.deliveryAddress} />
            </Stack>
          )}
        </Paper>

        {/* ── Items dispatched ────────────────────────────────── */}
        <Paper sx={{ borderRadius: "10px", border: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Boxes size={16} color={C.primary} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.ink }}>Items Dispatched</Typography>
            <Chip label={`${dc.items?.length || 0} SKU`} size="small"
              sx={{ ml: 'auto', height: 22, fontWeight: 700, bgcolor: alpha(C.primary, 0.1), color: C.primaryDk }} />
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontSize: '0.66rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', bgcolor: C.surfaceAlt } }}>
                  <TableCell>#</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell align="right">Quantity (pcs)</TableCell>
                  <TableCell align="right">Boxes</TableCell>
                  <TableCell align="right">Weight (kg)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(dc.items || []).map((it, i) => (
                  <TableRow key={it._id || i} hover>
                    <TableCell><Typography sx={{ fontSize: '0.78rem', color: C.faint }}>{it.srNo || i + 1}</Typography></TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{it.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: C.faint }}>{it.skuCode}</Typography>
                    </TableCell>
                    <TableCell align="right"><Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: C.ink }}>{fmt(it.quantityPcs)}</Typography></TableCell>
                    <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', color: C.slate }}>{fmt(it.noOfBoxes)}</Typography></TableCell>
                    <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', color: C.slate }}>{fmt(it.weightKg)}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', gap: 3, p: 2, borderTop: `1px solid ${C.line}`, bgcolor: C.surfaceAlt, flexWrap: 'wrap' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Package size={15} color={C.primary} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: C.ink }}>
                {fmt(dc.totalQuantityPcs)} pcs
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Boxes size={15} color={C.primary} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: C.ink }}>
                {fmt(dc.totalBoxes)} boxes
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Scale size={15} color={C.primary} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: C.ink }}>
                {fmt(dc.totalWeightKg)} kg
              </Typography>
            </Stack>
          </Box>
        </Paper>

        {dc.remark && !editing && (
          <Paper sx={{ p: 2, borderRadius: "10px", border: `1px solid ${C.line}` }}>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: C.faint, textTransform: 'uppercase' }}>Remark</Typography>
            <Typography sx={{ fontSize: '0.84rem', color: C.body }}>{dc.remark}</Typography>
          </Paper>
        )}

        {/* ── Delivery Challan PDF (shown last, after all dispatch details) ── */}
        <Paper sx={{ borderRadius: "10px", border: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FileSearch size={16} color={C.primary} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.ink }}>Delivery Challan PDF</Typography>
            <Button size="small" startIcon={<Download size={14} />} href={pdfHref || undefined} target="_blank" rel="noreferrer" disabled={!pdfHref} sx={{ ml: 'auto', fontWeight: 700 }}>
              Download
            </Button>
          </Box>
          {pdfLoading ? (
            <Box sx={{ p: 6, textAlign: 'center', color: C.faint }}>
              <CircularProgress size={26} />
              <Typography sx={{ mt: 1.5 }}>Rendering the challan PDF…</Typography>
            </Box>
          ) : pdfError ? (
            <Box sx={{ p: 5, textAlign: 'center', color: C.error }}>
              <AlertTriangle size={30} style={{ opacity: 0.7 }} />
              <Typography sx={{ mt: 1 }}>{pdfError}</Typography>
              <Button size="small" startIcon={<RefreshCw size={14} />} onClick={loadPdf} sx={{ mt: 1, fontWeight: 700 }}>Retry</Button>
            </Box>
          ) : pdfHref ? (
            <Box component="iframe" title="Delivery Challan PDF" src={pdfHref}
              sx={{ width: '100%', height: { xs: 420, md: 640 }, border: 0, display: 'block' }} />
          ) : (
            <Box sx={{ p: 5, textAlign: 'center', color: C.faint }}>
              <FileText size={34} style={{ opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>No PDF available.</Typography>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default ChallanDetail;
