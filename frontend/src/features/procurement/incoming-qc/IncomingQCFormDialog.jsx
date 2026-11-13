import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, Button, Autocomplete, CircularProgress, Chip,
} from '@mui/material';
import { Save, ClipboardCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetGrnsQuery,
  useCreateIncomingQcMutation,
  useUpdateIncomingQcMutation,
} from '../../../store/api/procurementApi';
import QcInspectionForm from './QcInspectionForm';
import {
  emptyHeader, headerFromQc, linesFromGrn, linesFromQc, allLinesBalanced, buildQcPayload, qcTotals,
} from './qcForm';
import { PFMS } from '../pfmsTheme';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import {
  PfmsFormDialog, FormDialogHeader, MetaPill, FormVendorBar, FormDialogBody, FormDialogFooter, LabeledField,
} from '../components/PfmsFormDialog';

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

  // GRNs eligible for QC: completed + qcStatus PENDING (MD approval never holds QC back).
  const { data: grnRes, isLoading: grnLoading } = useGetGrnsQuery(
    { limit: 200, sort: '-createdAt', qcStatus: 'PENDING' },
    { skip: !open || isEdit },
  );
  const grnOptions = (grnRes?.data || []).filter(
    (g) => ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(g.grnStatus)
      && g.qcStatus === 'PENDING',
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
    <LabeledField label="GRN Number" htmlFor="qc-f-grn">
      <TextField id="qc-f-grn" fullWidth value={grn?.grnNumber || ''} disabled />
    </LabeledField>
  ) : (
    <LabeledField label="GRN *" htmlFor="qc-f-grn">
      <Autocomplete
        id="qc-f-grn"
        options={grnOptions}
        loading={grnLoading}
        value={grn}
        getOptionLabel={(o) => (o ? `${o.grnNumber} — ${o.vendorName}` : '')}
        isOptionEqualToValue={(o, v) => o._id === v._id}
        onChange={(_e, v) => applyGrn(v)}
        noOptionsText="No completed GRN is pending QC"
        renderInput={(params) => (
          <TextField {...params} placeholder="Completed GRNs pending QC"
            InputProps={{ ...params.InputProps, endAdornment: (<>{grnLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
        )}
      />
    </LabeledField>
  );

  // The vendor and what the GRN was received against, in the shared vendor bar.
  const vendorName = grn?.vendorName || qc?.vendorName || '';
  const poNumber = grn?.poNumber || qc?.poNumber;
  const piNumber = grn?.piNumber || qc?.piNumber;
  const vendorRefs = [
    grn?.grnNumber && { label: 'GRN', value: grn.grnNumber },
    !grn?.isWithoutPo && poNumber && { label: 'PO', value: poNumber },
    piNumber && { label: 'PI', value: piNumber },
  ].filter(Boolean);
  const totals = qcTotals(items);

  return (
    <PfmsFormDialog open={open} onClose={() => onClose?.(false)}>
      <FormDialogHeader
        icon={<ClipboardCheck size={22} />}
        title={isEdit ? `Edit ${qc.qcNumber}` : 'New Incoming QC Check'}
        subtitle="Step 1.9 · Inspect received material — rejected qty moves out of stock on Complete"
        onClose={() => onClose?.(false)}
        meta={(
          <>
            <MetaPill label="QC No." value={qc?.qcNumber} placeholder="Assigned on save" />
            <MetaPill label="QC Status" hideXs value={qc?.qcStatus ? qc.qcStatus.replace(/_/g, ' ') : null} tone={qc ? 'indigo' : undefined} placeholder="Not saved yet" />
          </>
        )}>
        <FormVendorBar name={vendorName} refs={vendorRefs} emptyText="No GRN yet — select one below"
          extra={grn?.isWithoutPo ? <Chip size="small" variant="outlined" color="warning" label="Without PO" sx={{ fontWeight: 700 }} /> : null}
          aside={(
            <LabeledField label="QC Date" htmlFor="qc-f-date-bar">
              <DateInputDDMMYYYY id="qc-f-date-bar" fullWidth value={header.qcDate}
                onChange={(val) => setHeader((h) => ({ ...h, qcDate: val }))} />
            </LabeledField>
          )} />
      </FormDialogHeader>

      <FormDialogBody>
        <QcInspectionForm
          header={header} onHeaderChange={(patch) => setHeader((h) => ({ ...h, ...patch }))}
          items={items} onItemChange={setItem}
          doc={doc} onDocChange={setDoc} onUploadingChange={setUploading}
          sourceField={sourceField}
        />
      </FormDialogBody>

      <FormDialogFooter summary={(
        <Box component="span" sx={{ color: allBalanced ? PFMS.sub : 'error.main' }}>
          {items.length} item(s) · received {totals.received} · accepted {totals.accepted} · rejected {totals.rejected} · {allBalanced ? 'quantities balanced' : 'quantities not balanced'}
        </Box>
      )}>
        <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || uploading}>
          {isEdit ? 'Save Changes' : 'Create QC'}
        </Button>
      </FormDialogFooter>
    </PfmsFormDialog>
  );
};

export default IncomingQCFormDialog;
