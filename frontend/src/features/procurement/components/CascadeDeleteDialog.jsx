import React, { useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, Alert, Box, Checkbox,
  FormControlLabel, CircularProgress, useMediaQuery, useTheme,
} from '@mui/material';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useGetCascadeDeletePreviewQuery, useCascadeDeleteMutation } from '../../../store/api/procurementApi';
import { PFMS } from '../pfmsTheme';

const RED = '#b91c1c';
const ACK_TEXT = 'I have read and understood that deleting this step will also delete all the downstream records listed above.';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MAX_NUMBERS = 8;

const StepCode = ({ code, tone = PFMS.sub }) => (
  <Box component="span" sx={{
    display: 'inline-block', minWidth: 34, px: 0.6, py: 0.1, mr: 1, borderRadius: '6px', border: `1px solid ${PFMS.line}`,
    fontSize: '0.7rem', fontWeight: 700, color: tone, textAlign: 'center', bgcolor: PFMS.surfaceAlt,
  }}>{code}</Box>
);

/** One step's records that go: "1.4 Purchase Order — 2 records" + their numbers. */
const AffectedGroup = ({ g }) => {
  const shown = g.records.slice(0, MAX_NUMBERS);
  const warnings = g.records.flatMap((r) => (r.warnings || []).map((w) => `${r.number || g.stepLabel}: ${w}`));
  return (
    <Box data-testid={`cascade-group-${g.type}`} sx={{ px: 1.5, py: 1, borderTop: `1px solid ${PFMS.lineSoft}`, '&:first-of-type': { borderTop: 0 } }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 0.5 }}>
        <StepCode code={g.stepCode} tone={RED} />
        <Typography component="span" sx={{ fontSize: '0.86rem', fontWeight: 700, color: PFMS.ink }}>{g.stepLabel}</Typography>
        <Typography component="span" data-testid="cascade-group-count" sx={{ fontSize: '0.86rem', color: PFMS.ink }}>
          – {plural(g.count, 'record')}
        </Typography>
        {g.selected && (
          <Typography component="span" sx={{ fontSize: '0.7rem', fontWeight: 700, color: RED, ml: 0.5 }}>SELECTED STEP</Typography>
        )}
      </Box>
      {g.records.some((r) => r.number) && (
        <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub, mt: 0.25, pl: '46px', wordBreak: 'break-word' }}>
          {shown.map((r) => `${r.number || '—'}${r.status ? ` (${r.status})` : ''}`).join(', ')}
          {g.records.length > MAX_NUMBERS ? `, +${g.records.length - MAX_NUMBERS} more` : ''}
        </Typography>
      )}
      {warnings.map((w) => (
        <Typography key={w} sx={{ fontSize: '0.75rem', color: '#b45309', mt: 0.25, pl: '46px' }}>⚠ {w}</Typography>
      ))}
    </Box>
  );
};

/**
 * The body of the Purchase FMS cascade-delete confirmation: what goes with the
 * selected step (per step, with counts), what blocks it, what changes on the
 * records that stay, and which earlier steps stay unchanged. The final button
 * stays disabled until the acknowledgement is ticked; the server re-checks the
 * exact plan shown here (planToken) before deleting anything.
 */
export const CascadeDeleteContent = ({ type, id, what, number, onClose, onDone, onBusy }) => {
  const { enqueueSnackbar } = useSnackbar();
  const { data, error: loadError, isFetching, refetch } = useGetCascadeDeletePreviewQuery({ type, id }, { refetchOnMountOrArgChange: true });
  const [runDelete] = useCascadeDeleteMutation();
  const plan = data?.data;
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, code }
  const inFlight = useRef(false); // a second click while the first request runs does nothing

  const label = plan ? `${plan.root.stepLabel} ${plan.root.number || ''}`.trim() : `${what} ${number || ''}`.trim();
  const blocked = Boolean(plan && (plan.blockers.length || plan.missingPermissions.length));
  const reasonOk = !plan?.reasonRequired || reason.trim().length >= 3;
  const canConfirm = Boolean(plan) && !isFetching && !blocked && acknowledged && reasonOk && !busy;

  const reviewAgain = async () => {
    setError(null);
    setAcknowledged(false);
    await refetch();
  };

  const confirm = async () => {
    if (!canConfirm || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      const res = await runDelete({ type, id, reason: reason.trim(), acknowledged: true, planToken: plan.planToken }).unwrap();
      const n = res?.data?.downstreamCount || 0;
      enqueueSnackbar(`${label} deleted${n ? ` with ${plural(n, 'downstream record')}` : ''}`, { variant: 'success' });
      onDone?.(res?.data);
      onClose();
    } catch (err) {
      setError({ message: err?.data?.message || `Could not delete ${label}`, code: err?.data?.data?.code });
      setAcknowledged(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  };

  const downstream = plan ? plan.affected.filter((g) => !g.selected) : [];

  return (
    <>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1 }} data-testid="cascade-title">
        <Box sx={{ width: 34, height: 34, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: '#fef2f2', color: RED, flexShrink: 0 }}>
          <AlertTriangle size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: PFMS.ink, lineHeight: 1.3 }}>Warning: Cascading Deletion</Typography>
          <Typography sx={{ fontSize: '0.86rem', color: PFMS.sub }} data-testid="cascade-lead">
            You are deleting <b style={{ color: PFMS.ink }}>{label}</b>.
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: PFMS.line }}>
        {loadError ? (
          <Alert severity="error" data-testid="cascade-load-error">{loadError?.data?.message || 'Could not work out what depends on this record.'}</Alert>
        ) : !plan ? (
          <Box sx={{ py: 3, display: 'grid', placeItems: 'center', gap: 1 }}>
            <CircularProgress size={22} />
            <Typography sx={{ fontSize: '0.84rem', color: PFMS.sub }}>Checking every record that depends on it…</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gap: 1.75, opacity: isFetching ? 0.6 : 1 }}>
            {plan.blockers.length > 0 && (
              <Alert severity="error" sx={{ '& .MuiAlert-message': { width: '100%' } }} data-testid="cascade-blocked">
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, mb: 0.5, color: 'inherit' }}>
                  This deletion is blocked — these records hold money, stock, a signature or another workflow:
                </Typography>
                {plan.blockers.map((b) => (
                  <Box key={`${b.type}-${b.id}-${b.reason}`} data-testid="cascade-blocker" sx={{ mt: 0.75 }}>
                    <Typography sx={{ fontSize: '0.84rem', color: 'inherit' }}>
                      <b>{b.stepLabel} {b.number}</b> — {b.reason}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8rem', color: 'inherit', opacity: 0.9 }}>What to do: {b.action}</Typography>
                  </Box>
                ))}
              </Alert>
            )}
            {plan.missingPermissions.length > 0 && (
              <Alert severity="error" data-testid="cascade-no-permission">
                You do not have permission to delete every record listed (missing: {plan.missingPermissions.join(', ')}).
              </Alert>
            )}

            <Box>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: 0.3, mb: 0.75 }}>
                {blocked
                  ? 'These records would be deleted once nothing blocks it'
                  : downstream.length ? 'The following records will be deleted (they go to the Recycle Bin and can be restored)' : 'This record will be deleted'}
              </Typography>
              <Box sx={{ border: `1px solid #fecaca`, borderRadius: '8px', bgcolor: '#fffafa' }} data-testid="cascade-affected">
                {plan.affected.map((g) => <AffectedGroup key={g.type} g={g} />)}
              </Box>
              <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub, mt: 0.75 }} data-testid="cascade-total">
                {downstream.length
                  ? `${plural(plan.totalRecords, 'record')} in total: the selected step and ${plural(plan.downstreamCount, 'downstream record')}.`
                  : `Nothing downstream depends on this ${plan.root.stepLabel.toLowerCase()} — only this record is deleted.`}
              </Typography>
            </Box>

            {plan.effects.length > 0 && (
              <Box data-testid="cascade-effects">
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: PFMS.ink, textTransform: 'uppercase', letterSpacing: 0.3, mb: 0.5 }}>
                  What changes on the records that stay
                </Typography>
                {plan.effects.map((e) => (
                  <Typography key={e} sx={{ fontSize: '0.82rem', color: PFMS.sub, pl: 1.5, textIndent: '-0.75rem' }}>• {e}</Typography>
                ))}
              </Box>
            )}

            <Box data-testid="cascade-preserved" sx={{ p: 1.25, borderRadius: '8px', border: '1px solid #bbf7d0', bgcolor: '#f0fdf4' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: plan.preserved.length ? 0.5 : 0 }}>
                <ShieldCheck size={16} color="#15803d" />
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#166534' }}>
                  {plan.preserved.length
                    ? `${plan.preserved.map((g) => g.stepLabel).join(', ').replace(/, ([^,]*)$/, ' and $1')} will remain unchanged.`
                    : 'No earlier step — this is where the workflow starts.'}
                </Typography>
              </Box>
              {plan.preserved.map((g) => (
                <Typography key={g.type} sx={{ fontSize: '0.78rem', color: '#166534', pl: 3 }}>
                  {g.stepCode} {g.stepLabel}: {g.records.map((r) => r.number || '—').join(', ')}
                </Typography>
              ))}
            </Box>

            {!blocked && plan.reasonRequired && (
              <TextField label="Reason for deleting *" fullWidth size="small" value={reason} disabled={busy}
                onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500, 'data-testid': 'cascade-reason' }}
                placeholder="e.g. Quotation approved against the wrong vendor"
                helperText="Kept on every deleted record's history and in the deletion audit." />
            )}

            {!blocked && (
              <FormControlLabel
                sx={{ alignItems: 'flex-start', mx: 0, p: 1, borderRadius: '8px', border: `1px solid ${acknowledged ? '#fca5a5' : PFMS.line}` }}
                control={(
                  <Checkbox checked={acknowledged} disabled={busy || isFetching} onChange={(e) => setAcknowledged(e.target.checked)}
                    color="error" sx={{ p: 0.5, mr: 1 }} inputProps={{ 'data-testid': 'cascade-ack' }} />
                )}
                label={<Typography sx={{ fontSize: '0.84rem', color: PFMS.ink, pt: 0.4 }}>{ACK_TEXT}</Typography>}
              />
            )}

            {error && (
              <Alert severity={error.code === 'PLAN_CHANGED' ? 'warning' : 'error'} data-testid="cascade-error"
                action={error.code === 'PLAN_CHANGED' ? <Button color="inherit" size="small" onClick={reviewAgain}>Review again</Button> : null}>
                {error.message}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} disabled={busy} data-testid="cascade-cancel">{blocked || loadError ? 'Close' : 'Cancel'}</Button>
        {!blocked && !loadError && (
          <Button color="error" variant="contained" onClick={confirm} disabled={!canConfirm} data-testid="cascade-confirm"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}>
            {busy ? 'Deleting…' : 'Delete All Affected Records'}
          </Button>
        )}
      </DialogActions>
    </>
  );
};

/**
 * The confirmation in its own dialog. Closing (Escape, backdrop, Cancel) never
 * deletes anything; while the deletion runs it cannot be closed.
 *   <CascadeDeleteDialog open type="PO" id={po._id} what="PO" number={po.poNumber} onClose={…} onDone={…} />
 */
const CascadeDeleteDialog = ({ open, type, id, what, number, onClose, onDone, onExited }) => {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [locked, setLocked] = useState(false);
  return (
    <Dialog open={open} onClose={() => (locked ? null : onClose())} maxWidth="sm" fullWidth fullScreen={fullScreen}
      TransitionProps={{ onExited }} data-testid="cascade-dialog">
      {id && (
        <CascadeDeleteContent key={`${type}-${id}`} type={type} id={id} what={what} number={number}
          onClose={onClose} onDone={onDone} onBusy={setLocked} />
      )}
    </Dialog>
  );
};

export default CascadeDeleteDialog;
