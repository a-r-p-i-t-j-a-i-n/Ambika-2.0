import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton,
} from '@mui/material';
import { X, Download, ExternalLink, FileX2 } from 'lucide-react';
import { resolveFileUrl } from '../../../utils/fileUrl';

/**
 * In-app preview of a PO PDF (iframe) with download/open actions.
 * `previewUrl` (a blob: URL) takes precedence — used for the unsaved draft preview;
 * otherwise falls back to a saved PO's `poPdfUrl` (generated on release).
 */
const PurchaseOrderPdfPreview = ({ open, onClose, po, previewUrl }) => {
  // `previewUrl` is a fresh blob: URL (draft preview). A saved PO's `poPdfUrl` is
  // an absolute URL baked at release time — if the backend lacked SERVER_URL it
  // points at localhost, so repair it against the current API origin.
  const url = previewUrl || resolveFileUrl(po?.poPdfUrl) || '';
  const isDraft = Boolean(previewUrl);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <span>
          {isDraft ? 'PO PDF — Draft Preview' : 'PO PDF'}
          {po?.poNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{po.poNumber}</Typography>}
        </span>
        <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex' }}>
        {url ? (
          <iframe title="PO PDF" src={url} style={{ border: 0, width: '100%', flexGrow: 1 }} />
        ) : (
          <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', color: 'text.disabled', py: 8 }}>
            <Box sx={{ textAlign: 'center' }}>
              <FileX2 size={36} />
              <Typography variant="body2" sx={{ mt: 1 }}>
                No PDF yet — it is generated when the PO is released to the vendor.
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        {url && (
          <>
            <Button startIcon={<ExternalLink size={15} />} href={url} target="_blank" rel="noopener">Open in tab</Button>
            <Button variant="contained" startIcon={<Download size={15} />} href={url} target="_blank" rel="noopener" download={po?.poPdfFileName || 'purchase-order.pdf'}>
              Download
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PurchaseOrderPdfPreview;
