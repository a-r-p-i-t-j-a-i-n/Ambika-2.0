import React from 'react';
import {
  Dialog, Box, Stack, Typography, IconButton, Button, Tooltip,
} from '@mui/material';
import { X, ExternalLink, Download, FileText, Image as ImageIcon, File } from 'lucide-react';
import { resolveFileUrl } from '../../../utils/fileUrl';
import { O2D } from '../o2dTheme';

// Infer what we can render inline from the file name / URL extension.
const extOf = (s) => {
  const clean = String(s || '').split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const kindOf = (name, url) => {
  const e = extOf(name) || extOf(url);
  if (IMG.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  return 'other';
};

/**
 * Lightweight in-app previewer for a checklist proof (or any attachment):
 * images render inline, PDFs in an embedded viewer, anything else falls back to
 * open / download. So a reviewer never has to leave the task to check the evidence.
 */
const FilePreviewDialog = ({ open, onClose, name, url }) => {
  const src = resolveFileUrl(url);
  const kind = kindOf(name, url);
  const KindIcon = kind === 'image' ? ImageIcon : kind === 'pdf' ? FileText : File;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '10px', height: '88vh', maxHeight: '88vh', overflow: 'hidden', bgcolor: O2D.canvas } }}
    >
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1}
        sx={{ px: 2, py: 1.25, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ width: 30, height: 30, borderRadius: '7px', display: 'grid', placeItems: 'center', bgcolor: `${O2D.brand}14`, color: O2D.brand, flexShrink: 0 }}>
          <KindIcon size={16} />
        </Box>
        <Typography sx={{ flex: 1, minWidth: 0, fontWeight: 800, color: O2D.ink, fontSize: '0.92rem' }} noWrap>
          {name || 'Attachment'}
        </Typography>
        <Tooltip title="Open in new tab" arrow>
          <IconButton size="small" component="a" href={src} target="_blank" rel="noopener noreferrer" sx={{ color: O2D.body }}>
            <ExternalLink size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Download" arrow>
          <IconButton size="small" component="a" href={src} download={name || true} sx={{ color: O2D.body }}>
            <Download size={16} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose} sx={{ color: O2D.body }}><X size={17} /></IconButton>
      </Stack>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0, height: '100%', display: 'grid', placeItems: 'center', overflow: 'auto', p: kind === 'image' ? 2 : 0 }}>
        {kind === 'image' && (
          <Box component="img" src={src} alt={name || 'Attachment'}
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '6px', bgcolor: '#fff', boxShadow: '0 2px 14px rgba(28,30,33,0.12)' }} />
        )}
        {kind === 'pdf' && (
          <Box component="iframe" title={name || 'PDF preview'} src={src}
            sx={{ width: '100%', height: '100%', border: 0, bgcolor: '#fff' }} />
        )}
        {kind === 'other' && (
          <Stack spacing={1.5} alignItems="center" sx={{ p: 4, textAlign: 'center' }}>
            <Box sx={{ width: 52, height: 52, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: O2D.band, color: O2D.sub }}>
              <File size={24} />
            </Box>
            <Typography sx={{ fontWeight: 700, color: O2D.body }}>This file type can’t be previewed here.</Typography>
            <Typography variant="caption" sx={{ color: O2D.sub }}>Open it in a new tab or download it to review.</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Button component="a" href={src} target="_blank" rel="noopener noreferrer" variant="contained" disableElevation
                startIcon={<ExternalLink size={15} />} sx={{ textTransform: 'none', fontWeight: 700, bgcolor: O2D.brand, borderRadius: '7px' }}>
                Open
              </Button>
              <Button component="a" href={src} download={name || true} variant="outlined"
                startIcon={<Download size={15} />} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body, borderColor: O2D.line, borderRadius: '7px' }}>
                Download
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
    </Dialog>
  );
};

export default FilePreviewDialog;
