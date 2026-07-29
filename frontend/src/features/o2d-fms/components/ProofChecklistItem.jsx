import React, { useRef, useState } from 'react';
import {
  Box, Stack, Typography, Checkbox, Button, Chip, TextField, CircularProgress, alpha, Tooltip, Link,
} from '@mui/material';
import { Circle, CheckCircle2, Paperclip, Link2, X, Eye } from 'lucide-react';
import FilePreviewDialog from './FilePreviewDialog';

const GREEN = '#15803d';
const LINE = '#e6ebf3';

export const proofsOf = (item) => (Array.isArray(item?.proofs) ? item.proofs : []);
export const hasProof = (item) => proofsOf(item).length > 0;

// Shorten a URL for the chip label so a long Gmail thread link stays readable.
const shortUrl = (u) => {
  const s = String(u || '').replace(/^https?:\/\//, '');
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
};

/**
 * One checklist row with its OWN inline proof action.
 *
 * The doer attaches a file (screenshot / PDF) or pastes a link (Gmail thread, drive
 * URL) directly on the item, then ticks it — so every tick is backed by its own
 * evidence instead of one undifferentiated pile of attachments on the step.
 */
const ProofChecklistItem = ({
  item, disabled, canAct, proofRequired, busy,
  onToggle, onAttach, onLink, onClearProof,
}) => {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [preview, setPreview] = useState(null); // { name, url } of the file being previewed
  const fileRef = useRef(null);

  const done = !!item.done;
  const proofs = proofsOf(item);
  const proofed = proofs.length > 0;
  const blockedTick = proofRequired && !proofed && !done;
  // Evidence can ALWAYS be added/removed while the user may act on this step —
  // even after the item is ticked or the step signed off. Documents often arrive
  // late, and locking them out would force a fake re-open just to file a paper.
  const proofLocked = !canAct;

  const saveLink = () => {
    const v = linkValue.trim();
    if (!v) return;
    onLink(v);
    setLinkValue('');
    setLinkOpen(false);
  };

  return (
    <Box sx={{
      border: '1px solid', borderColor: done ? alpha(GREEN, 0.35) : LINE,
      borderRadius: '6px', p: 1, mb: 0.75,
      bgcolor: done ? alpha(GREEN, 0.05) : 'background.paper',
      transition: 'background-color .12s, border-color .12s',
    }}>
      <Stack direction="row" spacing={0.75} alignItems="flex-start">
        <Tooltip
          title={blockedTick ? 'Attach a file or paste a link first' : (done ? 'Click to undo' : 'Mark this item done')}
          placement="left" arrow
        >
          {/* span keeps the tooltip working while the checkbox is disabled */}
          <span>
            <Checkbox
              checked={done}
              disabled={disabled || busy || blockedTick}
              onChange={onToggle}
              size="small"
              icon={<Circle size={17} />}
              checkedIcon={<CheckCircle2 size={17} />}
              sx={{
                p: 0.4, color: '#cbd5e1',
                '&.Mui-checked': { color: GREEN },
                '&.Mui-disabled': { opacity: 1, color: '#e2e8f0' },
                '&.Mui-disabled.Mui-checked': { color: GREEN },
              }}
            />
          </span>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 0, pt: 0.25 }}>
          <Typography sx={{
            fontSize: '0.83rem', lineHeight: 1.3,
            textDecoration: done ? 'line-through' : 'none',
            color: done ? 'text.secondary' : 'text.primary',
          }}>
            {item.text}
          </Typography>

          {/* ── Proof: every document attached, plus the always-available actions ── */}
          <Box sx={{ mt: 0.6 }}>
            {/* All proofs on this item — each opens in a new tab, each removable */}
            {proofs.length > 0 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.6 }}>
                {proofs.map((p) => {
                  const isFile = !!p.fileUrl;
                  // Files open the in-app preview (image/PDF inline); links open the
                  // external thread/document in a new tab.
                  const open = isFile
                    ? () => setPreview({ name: p.fileName || 'Attachment', url: p.fileUrl })
                    : undefined;
                  return (
                    <Tooltip key={p._id} title={`${p.byName ? `Added by ${p.byName} — ` : ''}${isFile ? 'click to preview' : 'click to open'}`} arrow>
                      <Chip
                        size="small"
                        clickable={isFile}
                        onClick={open}
                        icon={isFile ? <Eye size={12} /> : <Link2 size={12} />}
                        label={isFile ? (p.fileName || 'Attachment') : (
                          <Link
                            href={p.link}
                            target="_blank" rel="noopener noreferrer"
                            sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'inherit', textDecoration: 'none' }}
                          >
                            {shortUrl(p.link)}
                          </Link>
                        )}
                        onDelete={proofLocked ? undefined : () => onClearProof(p._id)}
                        deleteIcon={<X size={12} />}
                        sx={{
                          height: 22, borderRadius: '4px', fontWeight: 700, maxWidth: 260,
                          bgcolor: alpha(GREEN, 0.1), color: GREEN,
                          '& .MuiChip-label': { fontSize: '0.68rem' },
                          '& .MuiChip-deleteIcon': { color: alpha(GREEN, 0.7), '&:hover': { color: GREEN } },
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Stack>
            )}

            {busy ? (
              <Stack direction="row" spacing={0.75} alignItems="center">
                <CircularProgress size={13} />
                <Typography variant="caption" color="text.secondary">Saving proof…</Typography>
              </Stack>
            ) : (
              // Always shown — so more documents can be added at any time, including
              // after the item is ticked and after the step is complete.
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <input ref={fileRef} type="file" multiple hidden
                  onChange={(e) => { Array.from(e.target.files || []).forEach((f) => onAttach(f)); e.target.value = ''; }} />
                <Button
                  size="small" variant="outlined" disabled={proofLocked}
                  startIcon={<Paperclip size={12} />} onClick={() => fileRef.current?.click()}
                  sx={{ py: 0.1, px: 0.9, fontSize: '0.66rem', fontWeight: 700, textTransform: 'none', borderRadius: '4px', borderColor: LINE, color: 'text.secondary' }}
                >
                  {proofed ? 'Add file' : 'Attach proof'}
                </Button>
                <Button
                  size="small" variant="outlined" disabled={proofLocked}
                  startIcon={<Link2 size={12} />} onClick={() => setLinkOpen((v) => !v)}
                  sx={{ py: 0.1, px: 0.9, fontSize: '0.66rem', fontWeight: 700, textTransform: 'none', borderRadius: '4px', borderColor: LINE, color: 'text.secondary' }}
                >
                  {proofed ? 'Add link' : 'Paste link'}
                </Button>
              </Stack>
            )}

            {/* Link entry row */}
            {linkOpen && !proofLocked && (
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.6 }} alignItems="center">
                <TextField
                  size="small" fullWidth autoFocus value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveLink(); }}
                  placeholder="https://mail.google.com/…  or paste the thread / document URL"
                  inputProps={{ style: { fontSize: '0.74rem', padding: '6px 8px' } }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '4px' } }}
                />
                <Button size="small" variant="contained" disableElevation onClick={saveLink} disabled={!linkValue.trim()}
                  sx={{ borderRadius: '4px', textTransform: 'none', fontWeight: 700, px: 1.5 }}>
                  Save
                </Button>
              </Stack>
            )}
          </Box>
        </Box>
      </Stack>

      <FilePreviewDialog
        open={!!preview}
        name={preview?.name}
        url={preview?.url}
        onClose={() => setPreview(null)}
      />
    </Box>
  );
};

export default ProofChecklistItem;
