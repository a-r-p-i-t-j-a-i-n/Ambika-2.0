import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Dialog, DialogContent,
  DialogTitle, DialogContentText, DialogActions, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Recycle, Plus, X, Disc3, ArrowUpRight,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  RmShell, O2D, O2D_TIP, STOCK_TOKENS,
} from './rmImsMeta';
import CuttingHistoryPanel from './CuttingHistoryPanel';
import CoilToCircleForm from './CoilToCircleForm';

/**
 * COIL TO CIRCLE — the Cut Coils page.
 *
 * Opens on the history: every recorded cut in one table — a row per physical
 * coil (its rounds open under it) and a row per older cut that names no coil —
 * filterable by batch, cutting date, circle produced, location, entry type,
 * status and a search. Recording a new cutting round is
 * one click away — "+ Coil to Circle" opens the entry form in a dialog, the
 * same form with the same rules it always had (CoilToCircleForm.jsx).
 *
 * The dialog closes on a successful save; the history and its cards refresh
 * themselves through RTK Query's tags, and the page points at the coil just
 * cut. Closing a form with something entered asks first; it cannot be closed
 * at all while a save is in flight. Filters on the history are untouched by
 * any of this — the history stays mounted underneath the dialog.
 *
 * `?new=1` opens the form straight away, for the "Cut a coil" shortcuts
 * elsewhere in RM IMS.
 */
const RmImsConversion = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(() => params.get('new') === '1');
  const [formState, setFormState] = useState({ dirty: false, saving: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lastCut, setLastCut] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // The shortcut has done its job once the form is open; a reload of this
  // page should land on the history, not reopen the form.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openForm = () => {
    setFormState({ dirty: false, saving: false });
    setFormOpen(true);
  };
  const closeForm = () => { setConfirmDiscard(false); setFormOpen(false); };
  // Every way out — Close, Cancel, Esc, a click outside — comes through here.
  const requestClose = () => {
    if (formState.saving) return;
    if (formState.dirty) setConfirmDiscard(true);
    else closeForm();
  };
  const onFormState = useCallback((s) => setFormState(s), []);
  const onSaved = (saved) => {
    const coilId = saved.coilReceiptId || saved.manualCoilId;
    setLastCut({
      coilId: coilId || null,
      batchNo: saved.batchNo || '',
      conversionNumber: saved.conversionNumber || '',
    });
    setRefreshKey((k) => k + 1);
    closeForm();
  };

  return (
    <RmShell
      icon={Recycle}
      title="Coil to Circle"
      subtitle="Track coil cutting history, circle output and remaining weight."
      actions={(
        <Button variant="contained" disableElevation onClick={openForm} startIcon={<Plus size={16} />}
          data-testid="open-coil-to-circle"
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '7px', bgcolor: O2D.brand, px: 2, py: 0.75, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
          Record Cutting Round
        </Button>
      )}
    >
      {/* Straight from the save to the coil that was just cut. */}
      {lastCut && (
        <Paper elevation={0} data-testid="last-cut-banner" sx={{
          borderRadius: '8px', px: 1.5, py: 0.9,
          border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
        }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Disc3 size={15} /></Box>
            <Typography sx={{ fontSize: '0.75rem', color: O2D.body }}>
              {lastCut.conversionNumber ? <>Conversion <b>{lastCut.conversionNumber}</b> saved</> : 'Saved'}
              {lastCut.batchNo ? <> against coil <b>{lastCut.batchNo}</b></> : ''}. The history below is up to date.
            </Typography>
            {lastCut.coilId && (
              <Button size="small" endIcon={<ArrowUpRight size={13} />} sx={{ ml: { sm: 'auto' }, textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}
                onClick={() => navigate(`/rm-ims/coil/${lastCut.coilId}`)}>
                See every round on this coil
              </Button>
            )}
            <Button size="small" color="inherit" onClick={() => setLastCut(null)}
              sx={{ ml: lastCut.coilId ? 0 : { sm: 'auto' }, textTransform: 'none', fontSize: '0.72rem', color: O2D.sub }}>Dismiss</Button>
          </Stack>
        </Paper>
      )}

      <CuttingHistoryPanel refreshKey={refreshKey} />

      {/* ── The entry form ── */}
      <Dialog
        open={formOpen}
        onClose={requestClose}
        fullScreen={fullScreen}
        maxWidth={false}
        scroll="paper"
        aria-labelledby="coil-to-circle-form-title"
        PaperProps={{
          'data-testid': 'coil-to-circle-dialog',
          sx: {
            width: '100%', maxWidth: 1180, height: fullScreen ? '100%' : '94vh',
            m: fullScreen ? 0 : 2, borderRadius: fullScreen ? 0 : '12px', bgcolor: O2D.canvas,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}
          sx={{ px: { xs: 1.5, md: 2 }, py: 1.1, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '7px', display: 'grid', placeItems: 'center', bgcolor: `${O2D.brand}1a`, color: O2D.brand, flexShrink: 0 }}>
            <Recycle size={17} />
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography id="coil-to-circle-form-title" sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
              Coil to Circle — record a cutting round
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              One entry takes the coil out of stock, puts the circles in, and records the scrap.
            </Typography>
          </Box>
          <Tooltip arrow slotProps={O2D_TIP} title={formState.saving ? 'Saving — wait for it to finish' : 'Close'}>
            <span>
              <IconButton onClick={requestClose} disabled={formState.saving} aria-label="Close the Coil to Circle form" data-testid="close-coil-to-circle">
                <X size={18} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <DialogContent sx={{ p: { xs: 1.25, md: 1.75 }, bgcolor: O2D.canvas }}>
          <CoilToCircleForm onSaved={onSaved} onCancel={requestClose} onStateChange={onFormState} />
        </DialogContent>
      </Dialog>

      {/* ── Closing a form with something entered ── */}
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth="xs" fullWidth
        aria-labelledby="discard-coil-to-circle-title" PaperProps={{ 'data-testid': 'discard-dialog' }}>
        <DialogTitle id="discard-coil-to-circle-title" sx={{ fontSize: '0.95rem', fontWeight: 800 }}>Discard this entry?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.8rem' }}>
            The coil, weights and circles entered in this form have not been saved and will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Button onClick={() => setConfirmDiscard(false)} autoFocus sx={{ textTransform: 'none', fontWeight: 700 }}>Keep editing</Button>
          <Button onClick={closeForm} color="error" variant="contained" disableElevation sx={{ textTransform: 'none', fontWeight: 700 }}>
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </RmShell>
  );
};

export default RmImsConversion;
