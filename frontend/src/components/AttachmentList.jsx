import React, { useState } from 'react';
import {
  Box, Stack, Chip, Dialog, DialogTitle, DialogContent, IconButton, Typography, Button, alpha,
} from '@mui/material';
import {
  X, FileText, Image as ImageIcon, Music, Video, File, Download, ExternalLink, Trash2, Eye,
} from 'lucide-react';
import { resolveFileUrl } from '../utils/fileUrl';

// Decide how to preview from MIME (preferred) or filename extension.
const typeOf = (att) => {
  const mime = (att.fileType || '').toLowerCase();
  const name = (att.fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|webm|aac)$/.test(name)) return 'audio';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/.test(name)) return 'video';
  return 'other';
};

const ICONS = { image: ImageIcon, pdf: FileText, audio: Music, video: Video, other: File };
const TONE  = { image: '#0369a1', pdf: '#be123c', audio: '#7c3aed', video: '#b45309', other: '#475569' };

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const kb = (b) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.round(b / 1024)} KB` : '');

/**
 * Reusable attachment strip with in-app preview. Pass `attachments` (each:
 * { _id?, fileName, fileUrl, fileType, sizeBytes, kind, uploadedByName, uploadedAt }).
 * Optional onRemove(att) shows a delete button per chip.
 */
const AttachmentList = ({ attachments = [], onRemove, dense = false }) => {
  const [preview, setPreview] = useState(null);
  if (!attachments.length) return null;

  const t = preview ? typeOf(preview) : null;
  // Always resolve against the current API host — stored URLs may carry the
  // host they were uploaded on (e.g. localhost during testing).
  const src = preview ? resolveFileUrl(preview) : '';

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {attachments.map((att, i) => {
          const kind = typeOf(att);
          const Icon = ICONS[kind];
          return (
            <Chip
              key={att._id || i}
              icon={<Icon size={14} />}
              label={att.fileName || 'file'}
              onClick={() => setPreview(att)}
              onDelete={onRemove ? () => onRemove(att) : undefined}
              deleteIcon={onRemove ? <Trash2 size={13} /> : undefined}
              variant="outlined"
              size={dense ? 'small' : 'medium'}
              sx={{ maxWidth: 240, borderColor: alpha(TONE[kind], 0.4), '& .MuiChip-icon': { color: TONE[kind] } }}
            />
          );
        })}
      </Stack>

      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>{preview?.fileName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[preview?.uploadedByName, kb(preview?.sizeBytes), fmt(preview?.uploadedAt)].filter(Boolean).join(' · ')}
          </Typography>
          <IconButton onClick={() => setPreview(null)} sx={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ minHeight: 200 }}>
          {t === 'image' && <Box component="img" src={src} alt={preview.fileName} sx={{ width: '100%', borderRadius: 1 }} />}
          {t === 'pdf' && <Box component="iframe" title={preview.fileName} src={src} sx={{ width: '100%', height: '70vh', border: 0 }} />}
          {t === 'audio' && (
            <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
              <Music size={40} color="#7c3aed" />
              <audio controls src={src} style={{ width: '100%' }} />
            </Stack>
          )}
          {t === 'video' && <Box component="video" controls src={src} sx={{ width: '100%', maxHeight: '70vh' }} />}
          {t === 'other' && (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 5 }}>
              <File size={40} color="#475569" />
              <Typography variant="body2" color="text.secondary">No inline preview for this file type.</Typography>
            </Stack>
          )}
        </DialogContent>
        <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button startIcon={<ExternalLink size={16} />} href={src} target="_blank" rel="noreferrer">Open in new tab</Button>
          <Button startIcon={<Download size={16} />} variant="contained" component="a" href={src} target="_blank" rel="noreferrer" download>Download</Button>
        </Box>
      </Dialog>
    </>
  );
};

export default AttachmentList;
export { typeOf };
