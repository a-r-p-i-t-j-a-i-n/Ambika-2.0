import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box,
  Typography, Chip, Skeleton,
} from '@mui/material';
import { Save, Pencil } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useUpdateChallanMutation, useGetChallanByIdQuery, useGenerateChallanPdfMutation } from '../../store/api/dispatchControlApi';
import { useUpdateOrderMutation } from '../../store/api/orderApi';
import { O2D } from './o2dTheme';

// ── Step-Board inline row editor ────────────────────────────────────────────
// Excel-flavoured popup: grey label column, white EDITABLE value column with a
// visible input look (border, hover, focus ring). Edit where you are, Save,
// done — no redirect to another screen.
//   • A challan row loads the FULL Delivery Challan and edits everything safe:
//     DC number, date, vehicle, transport, transporter, LR, invoice no, email,
//     delivery address, remarks. (Item quantities are excluded on purpose —
//     they drive the order's dispatched/balance totals and must go through the
//     dispatch flow so the numbers never drift.)
//   • An order row edits the Sales Order basics (PO number).

const toDateInput = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

// One sheet line: label cell + value cell (input or read-only value).
const SheetRow = ({ label, children, value }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: '150px 1fr', borderBottom: `1px solid ${O2D.line}` }}>
    <Box sx={{
      px: 1.25, py: 1, bgcolor: O2D.surfaceAlt, borderRight: `1px solid ${O2D.line}`,
      display: 'flex', alignItems: 'center',
    }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub }}>
        {label}
      </Typography>
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 40 }}>
      {children || (
        <Typography sx={{ px: 1.25, fontSize: '0.85rem', fontWeight: 600, color: O2D.sub }}>{value ?? '—'}</Typography>
      )}
    </Box>
  </Box>
);

// A cell that clearly reads as EDITABLE: white, bordered on hover, ring on focus.
const cellInputSx = {
  flex: 1,
  m: 0.4,
  '& .MuiOutlinedInput-root': { borderRadius: '4px', bgcolor: '#fff' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: O2D.line },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: O2D.brand },
  '& .MuiOutlinedInput-root.Mui-focused': { bgcolor: '#f0f6ff' },
  '& input, & textarea': { fontSize: '0.85rem', py: 0.9, color: O2D.ink },
};

const BoardRowEditDialog = ({ row, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [updateChallan, { isLoading: savingDc }] = useUpdateChallanMutation();
  const [updateOrder, { isLoading: savingOrder }] = useUpdateOrderMutation();
  const [generatePdf] = useGenerateChallanPdfMutation();
  const saving = savingDc || savingOrder;

  const dc = row?.dc || null;
  const p = row?.p || null;

  // Load the COMPLETE challan so every editable field is available, not just
  // the columns the board happens to show.
  const { data: dcRes, isFetching } = useGetChallanByIdQuery(dc?.dcId, { skip: !dc });
  const full = dcRes?.data || null;

  const [form, setForm] = useState({});
  useEffect(() => {
    if (!row) return;
    if (dc) {
      const src = full || {};
      setForm({
        dcNumber: src.dcNumber ?? dc.dcNumber ?? '',
        dcDate: toDateInput(src.dcDate ?? dc.dcDate),
        vehicleNo: src.vehicleNo || '',
        dispatchedThrough: src.dispatchedThrough ?? dc.transportType ?? '',
        transporterName: src.transporterName ?? dc.transporterName ?? '',
        lrNo: src.lrNo ?? dc.lrNo ?? '',
        invoiceNo: src.invoiceNo || '',
        clientEmail: src.clientEmail || '',
        deliveryAddress: src.deliveryAddress || '',
        remark: src.remark ?? dc.remark ?? '',
      });
    } else {
      setForm({ poNumber: p?.poNumber || '' });
    }
  }, [row, full]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    try {
      if (dc) {
        await updateChallan({
          id: dc.dcId,
          dcNumber: form.dcNumber,
          ...(form.dcDate ? { dcDate: form.dcDate } : {}),
          vehicleNo: form.vehicleNo,
          dispatchedThrough: form.dispatchedThrough,
          transporterName: form.transporterName,
          lrNo: form.lrNo,
          invoiceNo: form.invoiceNo,
          clientEmail: form.clientEmail,
          deliveryAddress: form.deliveryAddress,
          remark: form.remark,
        }).unwrap();
        // The PDF carries the DC number and logistics lines — regenerate it in
        // the background when they changed so the document never goes stale.
        if (form.dcNumber !== dc.dcNumber || form.lrNo !== (dc.lrNo || '') || form.transporterName !== (dc.transporterName || '')) {
          generatePdf(dc.dcId).catch(() => {});
        }
        enqueueSnackbar(`${form.dcNumber || dc.dcNumber} updated.`, { variant: 'success' });
      } else {
        await updateOrder({ id: p.salesOrderId, poNumber: form.poNumber }).unwrap();
        enqueueSnackbar(`${p.soNumber} updated.`, { variant: 'success' });
      }
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not save the changes.', { variant: 'error' });
    }
  };

  const editableRows = dc ? [
    ['DC Number',      <TextField key="n" size="small" value={form.dcNumber || ''} onChange={set('dcNumber')} sx={cellInputSx} fullWidth />],
    ['DC Date',        <TextField key="d" type="date" size="small" value={form.dcDate || ''} onChange={set('dcDate')} sx={cellInputSx} fullWidth />],
    ['Vehicle No.',    <TextField key="v" size="small" placeholder="Type here…" value={form.vehicleNo || ''} onChange={set('vehicleNo')} sx={cellInputSx} fullWidth />],
    ['Transport Type', <TextField key="t" size="small" placeholder="e.g. Freight Paid" value={form.dispatchedThrough || ''} onChange={set('dispatchedThrough')} sx={cellInputSx} fullWidth />],
    ['Transporter',    <TextField key="tr" size="small" placeholder="Type here…" value={form.transporterName || ''} onChange={set('transporterName')} sx={cellInputSx} fullWidth />],
    ['L.R. No.',       <TextField key="lr" size="small" placeholder="Type here…" value={form.lrNo || ''} onChange={set('lrNo')} sx={cellInputSx} fullWidth />],
    ['Invoice No.',    <TextField key="i" size="small" placeholder="Type here…" value={form.invoiceNo || ''} onChange={set('invoiceNo')} sx={cellInputSx} fullWidth />],
    ['Client Email',   <TextField key="e" size="small" type="email" placeholder="Type here…" value={form.clientEmail || ''} onChange={set('clientEmail')} sx={cellInputSx} fullWidth />],
    ['Delivery Address', <TextField key="a" size="small" multiline minRows={2} placeholder="Type here…" value={form.deliveryAddress || ''} onChange={set('deliveryAddress')} sx={cellInputSx} fullWidth />],
    ['Remarks',        <TextField key="r" size="small" multiline minRows={2} placeholder="Type here…" value={form.remark || ''} onChange={set('remark')} sx={cellInputSx} fullWidth />],
  ] : [
    ['PO Number',      <TextField key="po" size="small" placeholder="Type here…" value={form.poNumber || ''} onChange={set('poNumber')} sx={cellInputSx} fullWidth />],
  ];

  return (
    <Dialog open={!!row} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        Edit {dc ? (form.dcNumber || dc.dcNumber) : (p?.soNumber || 'row')}
        <Chip size="small" label={dc ? 'Delivery Challan' : 'Sales Order'}
          sx={{ height: 20, fontWeight: 700, fontSize: '0.66rem', bgcolor: '#eff6ff', color: O2D.brand }} />
      </DialogTitle>
      <DialogContent sx={{ pt: '4px !important' }}>
        <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Pencil size={12} /> All white cells are editable — click and type, then Save.
        </Typography>
        {dc && isFetching && !full ? (
          <Skeleton variant="rounded" height={360} />
        ) : (
          <Box sx={{ border: `1px solid ${O2D.line}`, borderBottom: 'none', borderRadius: '6px', overflow: 'hidden' }}>
            {dc ? (<>
              <SheetRow label="SO Number" value={p?.soNumber} />
              <SheetRow label="Party" value={dc.partyName || p?.partyName} />
              <SheetRow label="SKU / Qty" value={
                dc.skuNames?.length
                  ? dc.skuNames.map((n, i) => `${n} — ${dc.skuQtys?.[i] ?? '?'}`).join(' · ')
                  : String(dc.totalQty || '—')
              } />
            </>) : (<>
              <SheetRow label="SO Number" value={p?.soNumber} />
              <SheetRow label="Party" value={p?.partyName} />
            </>)}
            {editableRows.map(([label, input]) => <SheetRow key={label} label={label}>{input}</SheetRow>)}
          </Box>
        )}
        {dc ? (
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, mt: 1 }}>
            SKU quantities are changed through the dispatch flow (they drive the order's balance) — everything else saves right here.
          </Typography>
        ) : (
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, mt: 1 }}>
            To change items or quantities, use the pencil on the Sales Orders screen — that opens the full order form with amendment history.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
        <Button
          variant="contained" disableElevation disabled={saving || (dc && isFetching && !full)}
          startIcon={<Save size={14} />} onClick={handleSave}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BoardRowEditDialog;
