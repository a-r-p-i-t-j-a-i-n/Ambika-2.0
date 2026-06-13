import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton,
} from '@mui/material';
import { X, Download, ExternalLink, FileX2 } from 'lucide-react';

/** In-app preview of the generated PO PDF (iframe) with download/open actions. */
const PurchaseOrderPdfPreview = ({ open, onClose, po }) => {
  const url = po?.poPdfUrl || '';
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
        <span>
          PO PDF
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
