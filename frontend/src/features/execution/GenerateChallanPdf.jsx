import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Chip, InputAdornment,
  Table, TableBody, TableCell, TableHead, TableRow, alpha, useTheme, Skeleton, CircularProgress,
} from '@mui/material';
import { Truck, Eye, Search, FileText } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const STATUS_COLOR = {
  CREATED: 'default', DISPATCHED: 'info', DELIVERED: 'success', CANCELLED: 'error',
};

/**
 * Generate Delivery Challan PDF
 * -----------------------------
 * Lists actual-dispatch challans → pick a row → generate a fresh, professional
 * delivery-challan PDF (PDFKit, server-side) and open it for preview / download.
 * Route: /challans/generate-pdf
 */
const GenerateChallanPdf = () => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const { data, isFetching } = useGetChallansQuery({ limit: 200, sort: '-dcDate', search: search || undefined });
  const [busyId, setBusyId] = useState(null);

  const rows = useMemo(() => data?.data || [], [data]);

  // Always-fresh preview: stream the PDF bytes (nothing saved) and open them in a
  // new tab — the browser's PDF viewer shows it and offers download.
  const previewPdf = async (dc) => {
    setBusyId(dc._id);
    let blobUrl;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/challans/${dc._id}/pdf/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to render the challan PDF.');
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const w = window.open(blobUrl, '_blank', 'noopener');
      if (!w) enqueueSnackbar('Allow pop-ups to preview the challan PDF.', { variant: 'warning' });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      enqueueSnackbar(e.message || 'Could not preview the challan PDF.', { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        color: '#fff', px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
      }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <Box sx={{ width: 52, height: 52, borderRadius: 2.5, display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Truck size={26} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Generate Delivery Challan PDF
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5 }}>
              Pick an actual dispatch and generate its delivery challan — preview and download instantly.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
          <TextField
            fullWidth size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by DC number, SO number or party…"
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          />
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          {isFetching ? <Skeleton variant="rounded" height={320} /> : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 880 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['DC Number', 'Date', 'Party', 'SO / PO', 'Qty (pcs)', 'Boxes', 'Status'].map((h, i) => (
                      <TableCell key={h} align={[4, 5].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</TableCell>
                    ))}
                    <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Challan PDF</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>
                      <FileText size={28} style={{ opacity: 0.4 }} />
                      <Typography sx={{ fontWeight: 700, mt: 1 }}>No challans found</Typography>
                      <Typography variant="caption">Create an actual dispatch first, then generate its challan here.</Typography>
                    </TableCell></TableRow>
                  )}
                  {rows.map((dc) => (
                    <TableRow key={dc._id} hover>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: theme.palette.primary.dark }}>{dc.dcNumber}</TableCell>
                      <TableCell>{fmtDate(dc.dcDate)}</TableCell>
                      <TableCell>{dc.partyName || '—'}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{dc.soNumber || '—'}</Typography>
                        {dc.poNumber && <Typography variant="caption" color="text.secondary">PO {dc.poNumber}</Typography>}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(dc.totalQuantityPcs)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(dc.totalBoxes)}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" color={STATUS_COLOR[dc.status] || 'default'} label={dc.status} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /></TableCell>
                      <TableCell align="right">
                        <Button
                          size="small" variant="contained"
                          startIcon={busyId === dc._id ? <CircularProgress size={13} color="inherit" /> : <Eye size={14} />}
                          disabled={busyId === dc._id}
                          onClick={() => previewPdf(dc)}
                          sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          {busyId === dc._id ? 'Preparing…' : 'Preview / Download'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default GenerateChallanPdf;
