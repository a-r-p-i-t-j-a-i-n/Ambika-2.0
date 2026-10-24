import React from 'react';
import { Box, Typography, Paper, Button, CircularProgress } from '@mui/material';
import { ArrowRight } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { PFMS } from '../pfmsTheme';

const TONE = {
  info:    { bg: alpha('#2563eb', 0.07), border: alpha('#2563eb', 0.35), fg: '#1d4ed8' },
  success: { bg: alpha('#16a34a', 0.08), border: alpha('#16a34a', 0.35), fg: '#15803d' },
  warn:    { bg: alpha('#f59e0b', 0.1),  border: alpha('#f59e0b', 0.45), fg: '#b45309' },
  error:   { bg: alpha('#dc2626', 0.08), border: alpha('#dc2626', 0.35), fg: '#b91c1c' },
};

/**
 * Shared "Next Step" call-to-action banner for Purchase FMS detail pages.
 * Consolidates what were four byte-identical copies (Indent, Material
 * Follow-up, GRN, Incoming QC detail pages) plus newly-added ones (Proforma
 * Invoice, Vendor Invoice, Voucher, Tally Entry, Final Payment).
 *
 * Each page still computes its OWN `step` object from its OWN status fields
 * (`{ tone, title, desc?, primary?: {label, icon, onClick, disabled, loading},
 * secondary?: {label, onClick, disabled} }`) — this component only renders
 * it, so no business/workflow rule lives here, only presentation.
 *
 * `mb` is kept on the component itself (not left to a parent's flex `gap`)
 * because every consumer still composes its page the same way — this banner
 * as a plain sibling before the rest of the content — so changing how it
 * spaces itself from what follows is safe to do once, here, for all of them.
 */
const NextStepBanner = ({ step }) => {
  if (!step) return null;
  const t = TONE[step.tone] || TONE.info;
  return (
    <Paper elevation={0} sx={{
      mb: 2.5, p: 2, borderRadius: '8px', border: '1px solid', borderColor: t.border, bgcolor: t.bg,
      display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
    }}>
      <Box sx={{ width: 40, height: 40, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: PFMS.surface, color: t.fg, flexShrink: 0 }}>
        <ArrowRight size={20} />
      </Box>
      {/* 220px flex BASIS, not just a min-width: with the default `auto` basis
          the line-wrap measured this block at its unwrapped one-line width, so
          a long description pushed the text under the icon (narrow screens)
          or the buttons onto a row of their own (desktop). */}
      <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: t.fg }}>Next Step</Typography>
        <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>{step.title}</Typography>
        {step.desc && <Typography variant="body2" color="text.secondary">{step.desc}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' }, '& .MuiButtonBase-root': { width: { xs: '100%', sm: 'auto' } } }}>
        {step.secondary && (
          <Button variant="outlined" disabled={step.secondary.disabled} onClick={step.secondary.onClick}>{step.secondary.label}</Button>
        )}
        {step.primary && (
          <Button
            variant="contained"
            startIcon={step.primary.loading ? <CircularProgress size={14} color="inherit" /> : step.primary.icon}
            disabled={step.primary.disabled || step.primary.loading}
            onClick={step.primary.onClick}
          >
            {step.primary.label}
          </Button>
        )}
      </Box>
    </Paper>
  );
};

export default NextStepBanner;
