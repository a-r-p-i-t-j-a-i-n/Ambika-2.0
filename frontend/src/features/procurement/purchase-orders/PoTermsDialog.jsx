import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, CircularProgress, Chip, Box,
} from '@mui/material';
import { FileText, RotateCcw, Save } from 'lucide-react';
import { PO_TERMS_MAX } from './poTerms';

/**
 * Edit Terms & Conditions — the block printed beside the signatory on the PO
 * PDF (JSL and Other formats). Used by the PO form (applied when the PO is
 * saved), the PO detail page (saved straight away) and Company Settings (the
 * per-format defaults). Line breaks are kept as typed.
 *
 * onSave(text) may return a promise; the dialog stays open if it rejects.
 */
const PoTermsDialog = ({
  open, onClose, onSave, initialText = '', defaultText = '', formatLabel = '',
  title = 'Edit Terms & Conditions', subtitle = '', note = '', saving = false, saveLabel = 'Save',
}) => {
  const [text, setText] = useState('');
  // Loaded once per opening, so a refetch never wipes what is being typed.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setText(initialText || defaultText || '');
  }

  const trimmed = text.trim();
  const tooLong = text.length > PO_TERMS_MAX;
  const canSave = !!trimmed && !tooLong && !saving;
  const close = () => { if (!saving) onClose?.(); };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth data-testid="po-terms-dialog">
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <FileText size={20} /> {title}
        {formatLabel && <Chip size="small" label={`${formatLabel} PO`} sx={{ fontWeight: 700 }} />}
        {subtitle && (
          <Typography component="span" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{subtitle}</Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {note && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{note}</Typography>}
        <TextField
          fullWidth multiline minRows={8} maxRows={18} autoFocus
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. This order is under Price Protection Policy till 31st December 2026."
          error={tooLong || !trimmed}
          helperText={
            !trimmed ? 'Terms & Conditions cannot be empty — use Reset to default to start again'
              : tooLong ? `Too long — at most ${PO_TERMS_MAX} characters`
                : 'Printed on the PO PDF exactly as typed, line breaks included.'
          }
          inputProps={{ 'data-testid': 'po-terms-input', 'aria-label': 'Terms & Conditions' }}
        />
        <Typography variant="caption" color={tooLong ? 'error' : 'text.secondary'} sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}
          data-testid="po-terms-count">
          {text.length} / {PO_TERMS_MAX}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap', '& > :not(style) ~ :not(style)': { ml: 0 } }}>
        <Box sx={{ flex: 1 }}>
          {defaultText && (
            <Button size="small" startIcon={<RotateCcw size={15} />} onClick={() => setText(defaultText)} sx={{ whiteSpace: 'nowrap' }}
              disabled={saving || text === defaultText} data-testid="po-terms-reset">
              Reset to default
            </Button>
          )}
        </Box>
        <Button onClick={close} disabled={saving} data-testid="po-terms-cancel">Cancel</Button>
        <Button variant="contained" disabled={!canSave} data-testid="po-terms-save"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={() => onSave?.(trimmed)}>
          {saveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PoTermsDialog;
