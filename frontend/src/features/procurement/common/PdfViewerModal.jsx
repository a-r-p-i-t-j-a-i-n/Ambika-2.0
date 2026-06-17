import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  IconButton, CircularProgress,
} from '@mui/material';
import { X, Download, ExternalLink, FileX2 } from 'lucide-react';

/**
 * Simple, reusable in-app PDF viewer — renders a generated PDF (by URL) in an
 * iframe inside a modal, with Open-in-tab + Download actions. Used wherever we
 * previously opened a PDF in a new browser tab.
 *
 * Props: open, onClose, url, title, fileName, loading
 */
const PdfViewerModal = ({ open, onClose, url = '', title = 'Document', fileName, loading = false }) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
    <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
      <span>{title}</span>
      <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
      {loading ? (
        <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.secondary', py: 8 }}>
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress size={28} />
            <Typography variant="body2" sx={{ mt: 1.5 }}>Generating PDF…</Typography>
          </Box>
        </Box>
      ) : url ? (
        <iframe title={title} src={url} style={{ border: 0, width: '100%', flexGrow: 1 }} />
      ) : (
        <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.disabled', py: 8 }}>
          <Box sx={{ textAlign: 'center' }}>
            <FileX2 size={36} />
            <Typography variant="body2" sx={{ mt: 1 }}>No PDF available.</Typography>
          </Box>
        </Box>
      )}
    </DialogContent>
    <DialogActions sx={{ p: 1.5, gap: 1 }}>
      {url && (
        <>
          <Button startIcon={<ExternalLink size={15} />} href={url} target="_blank" rel="noopener">Open in tab</Button>
          <Button variant="contained" startIcon={<Download size={15} />} href={url} target="_blank" rel="noopener" download={fileName || 'document.pdf'}>
            Download
          </Button>
        </>
      )}
    </DialogActions>
  </Dialog>
);

export default PdfViewerModal;
