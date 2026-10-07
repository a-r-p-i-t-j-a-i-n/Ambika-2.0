import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useDeleteGrnMutation } from '../../../store/api/procurementApi';

/**
 * Confirm + delete a DRAFT GRN. A draft has posted no stock, so deleting it
 * leaves nothing behind in inventory; completed GRNs are refused by the server.
 */
const GrnDeleteDialog = ({ open, grn, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [deleteGrn, { isLoading }] = useDeleteGrnMutation();

  const handleDelete = async () => {
    try {
      await deleteGrn(grn._id).unwrap();
      enqueueSnackbar(`Draft GRN ${grn.grnNumber} deleted`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to delete GRN', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => (isLoading ? null : onClose?.(false))} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Delete draft GRN?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          This will delete <b>{grn?.grnNumber || 'this GRN'}</b>. No stock has been posted for a draft,
          so inventory is not affected. This action cannot be undone from here.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={isLoading}>
          {isLoading ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GrnDeleteDialog;
