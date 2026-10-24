import React, { useState, useEffect } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, PhoneCall, Building2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useCreateFollowUpMutation,
  useUpdateFollowUpMutation,
} from '../../../store/api/procurementApi';
import { FOLLOWUP_TYPES } from './fuMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS } from '../pfmsTheme';

/**
 * Create / edit a Material Follow-up (Step 1.5).
 * Follow-ups exist only for POs that are RELEASED_TO_VENDOR; plannedAt
 * defaults to the PO's expectedDeliveryDate (releasedAt + leadTime).
 */
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const todayStr = () => new Date().toISOString().slice(0, 10);

const FollowUpFormDrawer = ({ open, onClose, followUp = null, presetPo = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(followUp?._id);

  const [po, setPo] = useState(null);
  const [plannedAt, setPlannedAt] = useState(todayStr());
  const [followUpType, setFollowUpType] = useState('CALL');
  const [remarks, setRemarks] = useState('');
  const [contactPerson, setContactPerson] = useState('');

  const [createFu, { isLoading: creating }] = useCreateFollowUpMutation();
  const [updateFu, { isLoading: updating }] = useUpdateFollowUpMutation();
  const saving = creating || updating;

  // Only released POs are eligible.
  const { data: posRes, isLoading: posLoading } = useGetPurchaseOrdersQuery(
    { limit: 200, sort: '-releasedAt', poStatus: 'RELEASED_TO_VENDOR' },
    { skip: !open || isEdit },
  );
  const poOptions = posRes?.data || [];

  useEffect(() => {
    if (!open) return;
    if (followUp) {
      setPo({ _id: followUp.poId, poNumber: followUp.poNumber, vendorName: followUp.vendorName });
      setPlannedAt(toDateInput(followUp.plannedAt) || todayStr());
      setFollowUpType(followUp.followUpType || 'CALL');
      setRemarks(followUp.remarks || '');
      setContactPerson(followUp.contactPerson || '');
    } else {
      setPo(presetPo || null);
      setPlannedAt(presetPo?.expectedDeliveryDate ? toDateInput(presetPo.expectedDeliveryDate) : todayStr());
      setFollowUpType('CALL');
      setRemarks('');
      setContactPerson('');
    }
  }, [open, followUp, presetPo]);

  const applyPo = (p) => {
    setPo(p);
    if (p?.expectedDeliveryDate) setPlannedAt(toDateInput(p.expectedDeliveryDate));
  };

  const handleSubmit = async () => {
    if (!isEdit && !po?._id) { enqueueSnackbar('Select a released PO first', { variant: 'warning' }); return; }
    try {
      if (isEdit) {
        await updateFu({ id: followUp._id, plannedAt, followUpType, remarks: remarks.trim(), contactPerson: contactPerson.trim() }).unwrap();
        enqueueSnackbar('Follow-up updated', { variant: 'success' });
      } else {
        const res = await createFu({ poId: po._id, plannedAt, followUpType, remarks: remarks.trim(), contactPerson: contactPerson.trim() }).unwrap();
        enqueueSnackbar(`Follow-up ${res?.data?.followUpNumber || ''} created`, { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save follow-up', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: '8px', overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PhoneCall size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${followUp.followUpNumber}` : 'New Material Follow-up'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.5 · Follow up on Material Delivery 1.05
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ p: 3, bgcolor: PFMS.surfaceAlt }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            {isEdit || presetPo ? (
              <TextField label="PO Number" fullWidth value={po?.poNumber || ''} disabled />
            ) : (
              <Autocomplete
                options={poOptions}
                loading={posLoading}
                value={po}
                getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
                isOptionEqualToValue={(o, v) => o._id === v._id}
                onChange={(_e, v) => applyPo(v)}
                renderInput={(params) => (
                  <TextField {...params} label="Purchase Order *" placeholder="Released POs only"
                    InputProps={{ ...params.InputProps, endAdornment: (<>{posLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                )}
              />
            )}
          </Grid>

          {po ? (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                <Building2 size={15} color="#1d4ed8" />
                <Typography variant="caption" fontWeight={700}>{po.vendorName || '—'}</Typography>
                {po.vendorPhone ? <Typography variant="caption" color="text.secondary">📞 {po.vendorPhone}</Typography> : null}
                {po.vendorEmail ? <Typography variant="caption" color="text.secondary">✉ {po.vendorEmail}</Typography> : null}
                {po.expectedDeliveryDate ? (
                  <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>
                    Expected delivery: {new Date(po.expectedDeliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </Typography>
                ) : null}
              </Box>
            </Grid>
          ) : null}

          <Grid item xs={6}>
            <DateInputDDMMYYYY label="Planned Date *" fullWidth value={plannedAt}
              onChange={setPlannedAt} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Follow-up Type" select fullWidth value={followUpType}
              onChange={(e) => setFollowUpType(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField label="Contact Person" fullWidth value={contactPerson} placeholder="Vendor-side person to follow up with"
              onChange={(e) => setContactPerson(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
              onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1.5, bgcolor: PFMS.surface }}>
        <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving}>
          {isEdit ? 'Save Changes' : 'Create Follow-up'}
        </Button>
      </Box>
    </Dialog>
  );
};

export default FollowUpFormDrawer;
