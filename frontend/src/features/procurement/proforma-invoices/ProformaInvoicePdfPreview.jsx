import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton,
} from '@mui/material';
import { X, Download, ExternalLink, FileX2 } from 'lucide-react';
import { resolveFileUrl } from '../../../utils/fileUrl';

/** In-app preview of the uploaded PI document (PDF/image) with open/download. */
const ProformaInvoicePdfPreview = ({ open, onClose, pi }) => {
  // Resolve against the current API host (uses the S3 key when present) so a
  // dev-baked localhost URL doesn't break the preview on the live site.
  const url = pi?.piDocument ? resolveFileUrl(pi.piDocument) : '';
  const isImage = /image\//i.test(pi?.piDocument?.fileType || '');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <span>
          PI Document
          {pi?.piNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{pi.piNumber}</Typography>}
        </span>
        <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
        {url ? (
          isImage ? (
            <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', p: 2, overflow: 'auto' }}>
              <img src={url} alt="PI document" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </Box>
          ) : (
            <iframe title="PI document" src={url} style={{ border: 0, width: '100%', flexGrow: 1 }} />
          )
        ) : (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.disabled', py: 8 }}>
            <Box sx={{ textAlign: 'center' }}>
              <FileX2 size={36} />
              <Typography variant="body2" sx={{ mt: 1 }}>No PI document uploaded yet.</Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        {url && (
          <>
            <Button startIcon={<ExternalLink size={15} />} href={url} target="_blank" rel="noopener">Open in tab</Button>
            <Button variant="contained" startIcon={<Download size={15} />} href={url} target="_blank" rel="noopener"
              download={pi?.piDocument?.fileName || 'proforma-invoice'}>
              Download
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ProformaInvoicePdfPreview;
