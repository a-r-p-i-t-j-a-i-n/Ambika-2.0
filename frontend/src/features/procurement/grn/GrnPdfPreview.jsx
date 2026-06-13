import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton,
} from '@mui/material';
import { X, Download, ExternalLink, FileX2 } from 'lucide-react';

/** In-app preview of the generated GRN (Goods Receiving & Inspection Report) PDF. */
const GrnPdfPreview = ({ open, onClose, grn }) => {
  const url = grn?.grnPdfUrl || '';
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <span>
          GRN PDF
          {grn?.grnNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{grn.grnNumber}</Typography>}
        </span>
        <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
        {url ? (
          <iframe title="GRN PDF" src={url} style={{ border: 0, width: '100%', flexGrow: 1 }} />
        ) : (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.disabled', py: 8 }}>
            <Box sx={{ textAlign: 'center' }}>
              <FileX2 size={36} />
              <Typography variant="body2" sx={{ mt: 1 }}>No PDF yet — it is generated when the GRN is completed.</Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        {url && (
          <>
            <Button startIcon={<ExternalLink size={15} />} href={url} target="_blank" rel="noopener">Open in tab</Button>
            <Button variant="contained" startIcon={<Download size={15} />} href={url} target="_blank" rel="noopener" download={grn?.grnPdfFileName || 'grn.pdf'}>
              Download
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default GrnPdfPreview;
