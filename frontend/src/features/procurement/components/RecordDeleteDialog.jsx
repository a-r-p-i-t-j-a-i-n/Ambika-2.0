import React, { useState } from 'react';
import {
  DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, Alert,
} from '@mui/material';
import { useSnackbar } from 'notistack';

/**
 * The body of the shared Purchase FMS delete confirm (see useRecordDelete):
 * what happens, the reason a completed record needs, and — when the server
 * refuses — its message naming the later records to delete first.
 */
const RecordDeleteDialog = ({ row, what, number, consequence, needsReason, remove, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await remove(needsReason ? { id: row._id, reason: reason.trim() } : row._id).unwrap();
      enqueueSnackbar(`${what} ${number} deleted`.replace(/\s+/g, ' '), { variant: 'success' });
      onClose();
    } catch (err) {
      setError(err?.data?.message || `Could not delete this ${what.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogTitle sx={{ fontWeight: 800 }}>Delete {what} {number}?</DialogTitle>
      <DialogContent>
        {consequence && <Typography variant="body2" color="text.secondary" sx={{ mb: needsReason ? 2 : 0 }}>{consequence}</Typography>}
        {needsReason && (
          <TextField label="Reason for deleting *" fullWidth size="small" autoFocus value={reason}
            onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500, 'data-testid': 'record-delete-reason' }}
            placeholder="e.g. Entered twice by mistake" />
        )}
        {error && <Alert severity="warning" sx={{ mt: 2 }} data-testid="record-delete-error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>{error ? 'Close' : 'Cancel'}</Button>
        <Button color="error" variant="contained" onClick={confirm} data-testid="record-delete-confirm"
          disabled={busy || (needsReason && reason.trim().length < 3)}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </>
  );
};

export default RecordDeleteDialog;
