import React, { useRef, useState } from 'react';
import {
  Dialog, Box, Typography, IconButton, Paper, Button, Chip, CircularProgress, TextField,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Building2, FileText, Upload, UploadCloud, ExternalLink } from 'lucide-react';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
import { TONES } from './StatusChip';

/**
 * The building blocks of a Purchase FMS form dialog — Create / Edit GRN and
 * Incoming QC are built from these, so the two steps share one header, vendor
 * bar, section card, field label, table head, attachment box and footer.
 *
 * PfmsFormDialog opens in the CONTENT AREA beside the app sidebar: MainLayout
 * publishes the sidebar's current width as --app-sidebar-width (0 on a phone,
 * where the sidebar is a temporary drawer, and when embedded), and the modal
 * root starts there instead of at the viewport's left edge. The body scrolls on
 * its own between the fixed header and footer.
 */

const SIDEBAR = 'var(--app-sidebar-width, 0px)';

export const PfmsFormDialog = ({ open, onClose, children, ...rest }) => (
  <Dialog open={open} onClose={onClose} maxWidth={false} fullWidth
    sx={{ left: SIDEBAR }}
    // The backdrop is position:fixed (whole viewport) by default; absolute keeps
    // it inside the modal root, so the sidebar stays undimmed and clickable.
    BackdropProps={{ sx: { position: 'absolute' } }}
    PaperProps={{
      sx: {
        width: { xs: '100%', sm: 'calc(100% - 32px)' },
        maxWidth: 1480,
        height: { xs: '100%', sm: 'calc(100% - 32px)' },
        maxHeight: { xs: '100%', sm: 'calc(100% - 32px)' },
        m: { xs: 0, sm: 2 },
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: { xs: 0, sm: '10px' },
        bgcolor: PFMS.surface,
      },
    }}
    {...rest}>
    {children}
  </Dialog>
);

const META_LABEL_SX = { fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: PFMS.sub, lineHeight: 1.2 };

/** A read-only value box in the header (GRN No., QC status). */
export const MetaPill = ({ label, value, placeholder, tone, title, hideXs = false, ...rest }) => (
  <Box title={title} {...rest}
    sx={{
      px: 1.5, py: 0.75, borderRadius: '8px', bgcolor: alpha(PFMS.brand || '#1d4ed8', 0.05), border: `1px solid ${PFMS.lineSoft}`,
      display: { xs: hideXs ? 'none' : 'flex', sm: 'flex' }, flexDirection: 'column', minWidth: 0, maxWidth: 260,
    }}>
    <Typography sx={META_LABEL_SX}>{label}</Typography>
    {value ? (
      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.35, overflowWrap: 'anywhere', color: tone ? (TONES[tone] || TONES.neutral).fg : PFMS.ink }}>
        {value}
      </Typography>
    ) : (
      <Typography sx={{ fontWeight: 600, fontSize: '0.84rem', fontStyle: 'italic', color: PFMS.sub, lineHeight: 1.35 }}>{placeholder}</Typography>
    )}
  </Box>
);

/**
 * Top of the dialog: icon tile, title + step line, an optional step switch,
 * the meta pills and the close button; `children` (the vendor bar) sits under it.
 */
export const FormDialogHeader = ({ icon, title, subtitle, nav, meta, onClose, children }) => (
  <Box sx={{ flexShrink: 0, bgcolor: PFMS.surface, borderTop: `4px solid ${PFMS.brand}`, borderBottom: `1px solid ${PFMS.line}` }}>
    <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Box sx={{ width: 40, height: 40, borderRadius: '10px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(PFMS.brand, 0.08), color: PFMS.brand }}>
        {icon}
      </Box>
      <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
        <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1.08rem', color: PFMS.ink, lineHeight: 1.25 }}>{title}</Typography>
        {/* Hidden on a phone, where the body needs the height. */}
        {subtitle && <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.75rem', color: PFMS.sub, mt: 0.25 }}>{subtitle}</Typography>}
      </Box>
      {nav}
      <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>{meta}</Box>
      {/* Not "Close": the footer's Close / Cancel button owns that name. */}
      <IconButton aria-label="Dismiss dialog" title="Close" onClick={onClose} sx={{ color: PFMS.sub, ml: { xs: 'auto', md: 0 } }}><X size={20} /></IconButton>
    </Box>
    {children}
  </Box>
);

/**
 * Vendor line: name, then "PO … | Indent … | PI …" (label light, value bold),
 * with `aside` (the step's date field) on the right.
 */
export const FormVendorBar = ({ name, emptyText, refs = [], extra, aside, ...rest }) => (
  <Box {...rest}
    sx={{ px: { xs: 2, md: 3 }, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderTop: `1px solid ${PFMS.lineSoft}` }}>
    <Building2 size={20} color={name ? PFMS.brand : PFMS.faint} style={{ flexShrink: 0 }} />
    <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
      <Typography title={name || undefined}
        sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.3, color: name ? PFMS.ink : PFMS.faint, overflowWrap: 'anywhere' }}>
        {name || emptyText}
      </Typography>
      {refs.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25, mt: 0.25 }}>
          {refs.map((r, i) => (
            <Typography key={i} component="span"
              sx={{ fontSize: '0.8rem', color: PFMS.sub, overflowWrap: 'anywhere', ...(i > 0 ? { pl: 1, borderLeft: `1px solid ${PFMS.line}` } : {}) }}>
              {r.label ? `${r.label} ` : ''}<Box component="span" sx={{ fontWeight: 700, color: PFMS.ink }}>{r.value}</Box>
            </Typography>
          ))}
        </Box>
      )}
    </Box>
    {extra}
    {aside && (
      <Box sx={{ flex: { xs: '1 1 100%', sm: '0 0 auto' }, width: { sm: 230 }, pl: { sm: 2 }, borderLeft: { sm: `1px solid ${PFMS.line}` } }}>
        {aside}
      </Box>
    )}
  </Box>
);

/** The scrolling area between header and footer. */
export const FormDialogBody = React.forwardRef(({ children, sx }, ref) => (
  <Box ref={ref} sx={{
    flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
    px: { xs: 1.5, md: 3 }, pt: 2, pb: 3,
    display: 'flex', flexDirection: 'column', gap: 2, bgcolor: PFMS.surfaceAlt, ...sx,
  }}>
    {children}
  </Box>
));
FormDialogBody.displayName = 'FormDialogBody';

const SECTION_TONE = { blue: PFMS.brand || '#1d4ed8', amber: '#c2410c' };

/** A titled card. `tone` colours the title + icon (blue for data, amber for the material itself). */
export const FormSection = React.forwardRef(({ icon, title, tone = 'blue', badge, actions, children, sx, ...rest }, ref) => (
  <Paper ref={ref} elevation={0} {...rest} sx={{ ...pfmsCardSx, borderRadius: '10px', p: { xs: 1.5, md: 2 }, minWidth: 0, ...sx }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Box sx={{ display: 'flex', color: SECTION_TONE[tone] }}>{icon}</Box>
        <Typography component="h3" sx={{ fontWeight: 800, fontSize: '1rem', color: SECTION_TONE[tone], lineHeight: 1.3 }}>{title}</Typography>
        {badge}
      </Box>
      {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>}
    </Box>
    {children}
  </Paper>
));
FormSection.displayName = 'FormSection';

/** A label ABOVE its control; `htmlFor` ties it to the input so it stays the accessible name. */
export const LabeledField = ({ label, htmlFor, id, children, sx }) => (
  <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75, ...sx }}>
    <Typography component="label" htmlFor={htmlFor} id={id}
      sx={{ fontSize: '0.8rem', fontWeight: 700, color: PFMS.ink, lineHeight: 1.2 }}>
      {label}
    </Typography>
    {children}
  </Box>
);

/** Column heads of a grid table (same template as its rows). `align` per column: 'left' | 'center' | 'right'. */
export const FormTableHead = ({ columns, template, align = [], gap = 1 }) => (
  <Box aria-hidden sx={{
    display: 'grid', gridTemplateColumns: template, gap, alignItems: 'end',
    px: 1.5, py: 1, mb: 0.75, borderRadius: '8px', bgcolor: alpha(PFMS.brand || '#1d4ed8', 0.06),
  }}>
    {columns.map((h, i) => (
      <Typography key={i} sx={{
        fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: PFMS.ink, lineHeight: 1.25, textAlign: align[i] || 'left', minWidth: 0,
      }}>{h}</Typography>
    ))}
  </Box>
);

/** Caption above a value / input in a stacked (narrow) table row. */
export const CellCaption = ({ children }) => (
  <Typography aria-hidden sx={{ fontSize: '0.68rem', fontWeight: 700, color: PFMS.sub, textTransform: 'uppercase', letterSpacing: '0.03em', mb: 0.5 }}>
    {children}
  </Typography>
);

/** Right-aligned totals below a table, separated by hairlines. */
export const FormTotals = ({ items }) => (
  <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', mt: 1.5, pt: 1.5, borderTop: `1px solid ${PFMS.lineSoft}` }}>
    {items.map((t) => (
      <Box key={t.label} sx={{ textAlign: 'center', px: { xs: 1.5, md: 3 }, py: 0.25, minWidth: 110, borderLeft: `1px solid ${PFMS.line}` }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: PFMS.ink }}>{t.label}</Typography>
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: t.color || PFMS.ink, lineHeight: 1.4 }}>{t.value}</Typography>
      </Box>
    ))}
  </Box>
);

/** Multi-line remarks with a live character counter (the limit is the server's). */
export const RemarksField = ({ value, onChange, max = 1000, placeholder, error, helperText, disabled, id, inputProps, sx }) => (
  <Box>
    <TextField id={id} fullWidth multiline minRows={3} value={value} disabled={disabled} error={error}
      onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      inputProps={{ maxLength: max, ...inputProps }} sx={sx} />
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.5, px: 0.5 }}>
      <Typography sx={{ fontSize: '0.74rem', fontWeight: error ? 700 : 500, color: error ? '#b45309' : PFMS.sub }}>{helperText}</Typography>
      <Typography sx={{ fontSize: '0.74rem', color: PFMS.sub, flexShrink: 0 }}>{(value || '').length} / {max}</Typography>
    </Box>
  </Box>
);

const isAccepted = (file, accept) => {
  const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return rules.some((r) => (r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : r.startsWith('.') ? name.endsWith(r) : type === r));
};

/**
 * One attachment: an Upload button plus a drop zone (both hand the file to
 * `onFile`, the caller's existing upload), or — once attached — the file with
 * View / Remove. `inputProps` reaches the hidden <input type="file">.
 */
export const AttachmentDrop = ({
  label, doc, onFile, onRemove, uploading = false, readOnly = false, accept = '.pdf,image/*',
  hint = 'Supported: PDF, JPG, PNG (max 15 MB)', onReject, hrefOf = (u) => u, inputProps, fileTestId,
}) => {
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (f) => {
    if (!f) return;
    if (!isAccepted(f, accept)) { onReject?.(f); return; }
    onFile(f);
  };
  return (
    <Box>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: PFMS.ink, textTransform: 'uppercase', letterSpacing: '0.02em', mb: 0.75 }}>{label}</Typography>
      <input ref={fileRef} type="file" accept={accept} hidden {...inputProps}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
      {doc?.fileUrl ? (
        <Box data-testid={fileTestId}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, border: `1px solid ${PFMS.line}`, borderRadius: '10px', bgcolor: PFMS.surface, flexWrap: 'wrap' }}>
          <FileText size={16} color={PFMS.brand} />
          <Typography sx={{ flex: '1 1 160px', minWidth: 0, fontSize: '0.86rem', color: PFMS.ink, overflowWrap: 'anywhere' }}>{doc.fileName}</Typography>
          <Button size="small" startIcon={<ExternalLink size={13} />} href={hrefOf(doc.fileUrl)} target="_blank" rel="noopener">View</Button>
          {!readOnly && <Chip size="small" label="Remove" onDelete={onRemove} onClick={onRemove} deleteIcon={<X size={13} />} />}
        </Box>
      ) : readOnly ? (
        <Typography sx={{ fontSize: '0.86rem', color: PFMS.faint }}>No attachment</Typography>
      ) : (
        <Box
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!uploading) pick(e.dataTransfer.files?.[0]); }}
          sx={{
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', p: 1.5, borderRadius: '10px',
            border: `1.5px dashed ${over ? PFMS.brand : '#cbd5e1'}`, bgcolor: over ? alpha(PFMS.brand, 0.05) : PFMS.surface,
            transition: 'border-color 120ms, background-color 120ms',
          }}>
          <Button variant="outlined" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={15} />}
            onClick={() => fileRef.current?.click()} disabled={uploading} sx={{ minHeight: 40, px: 2.5, fontWeight: 700 }}>
            Upload PDF / Image
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pl: { sm: 2 }, borderLeft: { sm: `1px solid ${PFMS.line}` }, minWidth: 0 }}>
            <UploadCloud size={22} color={PFMS.sub} style={{ flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: PFMS.ink }}>or drag and drop a file here</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>{hint}</Typography>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

/**
 * The fixed footer: a one-line summary on the left, the actions on the right.
 * On a phone the actions wrap into equal-width rows under the summary.
 */
export const FormDialogFooter = ({ summary, children }) => (
  <Box sx={{
    flexShrink: 0, px: { xs: 1.5, md: 3 }, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: { xs: 'wrap', lg: 'nowrap' }, gap: 1.5, bgcolor: PFMS.surface, borderTop: `1px solid ${PFMS.line}`,
    boxShadow: '0 -4px 12px rgba(15, 23, 42, 0.04)',
  }}>
    <Typography component="div" sx={{ fontSize: '0.8rem', color: PFMS.sub, minWidth: 0, flex: '1 1 260px' }}>{summary}</Typography>
    <Box sx={{
      display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'flex-end', flex: { xs: '1 1 100%', lg: '0 0 auto' },
      '& .MuiButton-root': { minHeight: 42, px: 2.25, fontWeight: 700, lineHeight: 1.2, whiteSpace: { xs: 'normal', sm: 'nowrap' }, flex: { xs: '1 1 140px', sm: '0 0 auto' } },
    }}>
      {children}
    </Box>
  </Box>
);
