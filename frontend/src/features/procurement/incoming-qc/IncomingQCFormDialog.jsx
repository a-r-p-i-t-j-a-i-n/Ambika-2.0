import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Autocomplete, CircularProgress, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ClipboardCheck, Building2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetGrnsQuery,
  useCreateIncomingQcMutation,
  useUpdateIncomingQcMutation,
} from '../../../store/api/procurementApi';
import QcInspectionForm from './QcInspectionForm';
import {
  emptyHeader, headerFromQc, linesFromGrn, linesFromQc, allLinesBalanced, buildQcPayload,
} from './qcForm';
import { PFMS } from '../pfmsTheme';

/**
 * Create / edit an Incoming QC (Step 1.9). Only completed GRNs that are still
 * QC-pending are selectable; lines auto-load from the GRN. Per item:
 *   acceptedQty + rejectedQty must equal receivedQty.
 * The form body (QcInspectionForm) is shared with the QC section on the GRN page.
 */
const IncomingQCFormDialog = ({ open, onClose, qc = null, presetGrn = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const isEdit = Boolean(qc?._id);

  const [grn, setGrn] = useState(null);
  const [header, setHeader] = useState(emptyHeader);
  const [items, setItems] = useState([]);
  const [doc, setDoc] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [createQc, { isLoading: creating }] = useCreateIncomingQcMutation();
  const [updateQc, { isLoading: updating }] = useUpdateIncomingQcMutation();
  const saving = creating || updating;

  // GRNs eligible for QC: completed + qcStatus PENDING + MD Approved.
  const { data: grnRes, isLoading: grnLoading } = useGetGrnsQuery(
    { limit: 200, sort: '-createdAt', qcStatus: 'PENDING' },
    { skip: !open || isEdit },
  );
  const grnOptions = (grnRes?.data || []).filter(
    (g) => ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(g.grnStatus)
      && g.qcStatus === 'PENDING' && g.approvalStatus === 'MD_APPROVED',
  );

  useEffect(() => {
    if (!open) return;
    if (qc) {
      setGrn({ _id: qc.grnId, grnNumber: qc.grnNumber, vendorName: qc.vendorName });
      setHeader(headerFromQc(qc));
      setDoc(qc.qcReportDocument?.fileUrl ? { ...qc.qcReportDocument } : null);
      setItems(linesFromQc(qc));
    } else {
      setHeader(emptyHeader());
      setDoc(null);
      if (presetGrn) { setGrn(presetGrn); setItems(linesFromGrn(presetGrn)); }
      else { setGrn(null); setItems([]); }
    }
  }, [open, qc, presetGrn]);

  const applyGrn = (g) => { setGrn(g); setItems(g ? linesFromGrn(g) : []); };
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const allBalanced = allLinesBalanced(items);

  const handleSubmit = async () => {
    if (!isEdit && !grn?._id) { enqueueSnackbar('Select a GRN first', { variant: 'warning' }); return; }
    if (items.length === 0) { enqueueSnackbar('No items to inspect', { variant: 'warning' }); return; }
    const payload = buildQcPayload({ header, items, doc });
    try {
      if (isEdit) {
        await updateQc({ id: qc._id, ...payload }).unwrap();
        enqueueSnackbar('QC updated', { variant: 'success' });
        onClose?.(true);
      } else {
        const res = await createQc({ ...payload, grnId: grn._id }).unwrap();
        const newId = res?.data?._id;
        enqueueSnackbar(`QC ${res?.data?.qcNumber || ''} created — complete the inspection to continue`, { variant: 'success' });
        onClose?.(true);
        // Take the user straight to the new QC, where "Complete QC" + the Next Step
        // banner are shown — no hunting for where to go next.
        if (newId) navigate(`/procurement/incoming-qc/${newId}`);
      }
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save QC', { variant: 'error' });
    }
  };

  const sourceField = isEdit || presetGrn ? (
    <TextField label="GRN Number" fullWidth value={grn?.grnNumber || ''} disabled />
  ) : (
    <Autocomplete
      options={grnOptions}
      loading={grnLoading}
      value={grn}
      getOptionLabel={(o) => (o ? `${o.grnNumber} — ${o.vendorName}` : '')}
      isOptionEqualToValue={(o, v) => o._id === v._id}
      onChange={(_e, v) => applyGrn(v)}
      noOptionsText="No GRN is pending QC (must be MD Approved)"
      renderInput={(params) => (
        <TextField {...params} label="GRN *" placeholder="Completed + MD Approved GRNs pending QC"
          InputProps={{ ...params.InputProps, endAdornment: (<>{grnLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
      )}
    />
  );

  const sourceSummary = grn ? (
    <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
      <Building2 size={16} color="#1d4ed8" />
      <Typography variant="caption" fontWeight={700}>{grn.vendorName || qc?.vendorName || '—'}</Typography>
      {(grn.poNumber || qc?.poNumber) && <Chip size="small" variant="outlined" label={`PO ${grn.poNumber || qc?.poNumber}`} sx={{ fontWeight: 700 }} />}
      {(grn.piNumber || qc?.piNumber) && <Chip size="small" variant="outlined" label={`PI ${grn.piNumber || qc?.piNumber}`} sx={{ fontWeight: 700 }} />}
    </Box>
  ) : null;

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ClipboardCheck size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${qc.qcNumber}` : 'New Incoming QC Check'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.9 · Inspect received material — rejected qty moves out of stock on Complete
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: PFMS.canvas }}>
        <QcInspectionForm
          header={header} onHeaderChange={(patch) => setHeader((h) => ({ ...h, ...patch }))}
          items={items} onItemChange={setItem}
          doc={doc} onDocChange={setDoc} onUploadingChange={setUploading}
          sourceField={sourceField} sourceSummary={sourceSummary}
        />
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color={allBalanced ? 'text.secondary' : 'error'}>
          {items.length} item(s) · {allBalanced ? 'quantities balanced' : 'quantities not balanced'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={handleSubmit} disabled={saving || uploading}>
            {isEdit ? 'Save Changes' : 'Create QC'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default IncomingQCFormDialog;
