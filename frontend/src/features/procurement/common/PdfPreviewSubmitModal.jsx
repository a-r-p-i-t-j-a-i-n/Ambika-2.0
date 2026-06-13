import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  IconButton, CircularProgress,
} from '@mui/material';
import { X, ArrowLeft, Save, CheckCircle2, FileX2 } from 'lucide-react';

/**
 * Shared "Preview before submit" modal for Purchase FMS document modules
 * (PO, GRN, Incoming QC, Vendor Invoice, Voucher, Tally Entry, Final Payment).
 *
 * Renders a previewed PDF generated from the CURRENT (unsaved) form data and
 * exposes the three workflow actions. The preview itself saves nothing, changes
 * no status, and triggers no inventory/accounting — those happen only when the
 * caller's onApproveSubmit / onSaveDraft handlers run.
 *
 * Props:
 *  - open            : boolean
 *  - title           : document label, e.g. "Goods Receipt Note"
 *  - docNumber       : optional record number to show in the header
 *  - pdfUrl          : object URL of the previewed PDF blob
 *  - loading         : preview generation in flight
 *  - error           : error message string (empty when none)
 *  - saving          : a save/submit action is in flight
 *  - showSaveDraft   : show the "Save Draft" action (default true)
 *  - approveLabel    : label for the primary action (default "Approve & Submit")
 *  - onClose         : Back To Edit (also the dialog's onClose)
 *  - onSaveDraft     : Save Draft handler
 *  - onApproveSubmit : Approve & Submit handler
 */
const PdfPreviewSubmitModal = ({
  open,
  title = 'Document',
  docNumber = '',
  pdfUrl = '',
  loading = false,
  error = '',
  saving = false,
  showSaveDraft = true,
  approveLabel = 'Approve & Submit',
  onClose,
  onSaveDraft,
  onApproveSubmit,
}) => {
  const busy = loading || saving;
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { height: '92vh' } }}
    >
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <span>
          Preview — {title}
          {docNumber && (
            <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>
              {docNumber}
            </Typography>
          )}
          <Typography component="span" sx={{ ml: 1.5, color: 'warning.main', fontWeight: 700, fontSize: '0.7rem' }}>
            NOT SAVED YET
          </Typography>
        </span>
        <IconButton onClick={onClose} size="small" disabled={busy}><X size={18} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
        {loading ? (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.secondary', py: 8 }}>
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress size={28} />
              <Typography variant="body2" sx={{ mt: 1.5 }}>Generating preview…</Typography>
            </Box>
          </Box>
        ) : error ? (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'error.main', py: 8 }}>
            <Box sx={{ textAlign: 'center' }}>
              <FileX2 size={36} />
              <Typography variant="body2" sx={{ mt: 1 }}>{error}</Typography>
            </Box>
          </Box>
        ) : pdfUrl ? (
          <iframe title={`${title} preview`} src={pdfUrl} style={{ border: 0, width: '100%', flexGrow: 1 }} />
        ) : (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.disabled', py: 8 }}>
            <FileX2 size={36} />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        <Button startIcon={<ArrowLeft size={15} />} onClick={onClose} disabled={busy}>
          Back To Edit
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {showSaveDraft && (
          <Button
            variant="outlined"
            startIcon={<Save size={15} />}
            onClick={onSaveDraft}
            disabled={busy || !!error}
          >
            Save Draft
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={15} color="inherit" /> : <CheckCircle2 size={15} />}
          onClick={onApproveSubmit}
          disabled={busy || !!error}
        >
          {approveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PdfPreviewSubmitModal;
