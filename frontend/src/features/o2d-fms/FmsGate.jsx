import React, { useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Box, Paper, alpha, IconButton,
} from '@mui/material';
import { Lock, ArrowRight, X, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetFmsGateQuery } from '../../store/api/o2dFmsApi';

/**
 * FMS sequential gate. Given an order (soNumber) and the `action` this screen
 * performs (e.g. DISPATCH_PLAN, ACTUAL_DISPATCH), it asks the server whether the
 * prior FMS steps are done. When they're not, `blocked` is true and `blockingStep`
 * points at the step that must be finished first (with a deep-link to its task).
 *
 * Usage:
 *   const gate = useFmsGate({ soNumber, action: 'DISPATCH_PLAN' });
 *   ... disable the create action when gate.blocked ...
 *   <FmsGateDialog gate={gate} open={open} onClose={...} />
 */
export const useFmsGate = ({ soNumber, salesOrderId, intakeId, action }) => {
  const skip = !action || !(soNumber || salesOrderId || intakeId);
  const params = { action, ...(salesOrderId ? { salesOrderId } : {}), ...(intakeId ? { intakeId } : {}), ...(soNumber ? { soNumber } : {}) };
  const { data, isFetching } = useGetFmsGateQuery(params, { skip });
  const gate = data?.data || null;
  // Stable identity — so a consumer that lists `gate` in an effect's deps never
  // re-runs (and never loops) just because this hook returned a fresh object.
  return useMemo(() => ({
    loading: isFetching,
    gate,
    blocked: !!gate && gate.allowed === false,
    blockingStep: gate?.blockingStep || null,
    reason: gate?.reason || '',
  }), [gate, isFetching]);
};

/** Blocking modal — explains why and links straight to the pending step's task. */
export const FmsGateDialog = ({ gate, open, onClose }) => {
  const navigate = useNavigate();
  const blockingStep = gate?.blockingStep;
  if (!blockingStep) return null;
  const goComplete = () => { onClose?.(); navigate(blockingStep.taskUrl); };
  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha('#b45309', 0.12), color: '#b45309' }}><Lock size={18} /></Box>
          <Typography sx={{ fontWeight: 800 }}>Complete the previous step first</Typography>
        </Stack>
        {onClose && <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></IconButton>}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          You can’t do this yet — the FMS runs step-by-step. {gate?.reason}
        </Typography>
        <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.04), borderColor: alpha('#1d4ed8', 0.3) }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>Pending step</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{blockingStep.stepCode} — {blockingStep.name}</Typography>
        </Paper>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Finish it (the assigned doer/buddy), then come back — this will unlock automatically.
        </Typography>
      </DialogContent>
      <DialogActions>
        {onClose && <Button onClick={onClose}>Close</Button>}
        <Button variant="contained" endIcon={<ArrowRight size={16} />} onClick={goComplete}>Go complete it</Button>
      </DialogActions>
    </Dialog>
  );
};

/** Inline banner — shown on the screen while it's locked. */
export const FmsGateBanner = ({ gate, onOpen }) => {
  const navigate = useNavigate();
  const blockingStep = gate?.blockingStep;
  if (!gate || gate.allowed !== false || !blockingStep) return null;
  return (
    <Paper elevation={0} sx={{
      p: { xs: 1.25, md: 1.5 }, borderRadius: 2.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
      // Solid card so the dark hero never bleeds through (it floats over the hero edge).
      bgcolor: 'background.paper', border: `1px solid ${alpha('#b45309', 0.45)}`,
      boxShadow: '0 6px 20px rgba(180,83,9,0.10)',
    }}>
      <Box sx={{ p: 0.85, borderRadius: 1.5, bgcolor: alpha('#b45309', 0.12), color: '#b45309', display: 'flex', flexShrink: 0 }}><AlertTriangle size={16} /></Box>
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography sx={{ fontWeight: 800, color: '#92400e', fontSize: '0.86rem', lineHeight: 1.2 }}>Locked — finish the previous FMS step first</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>{gate.reason} This action stays disabled until then.</Typography>
      </Box>
      <Button variant="contained" size="small" endIcon={<ArrowRight size={14} />}
        onClick={() => (onOpen ? onOpen() : navigate(blockingStep.taskUrl))} sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
        Go complete it
      </Button>
    </Paper>
  );
};

export default useFmsGate;
