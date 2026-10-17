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
 */
const NextStepBanner = ({ step }) => {
  if (!step) return null;
  const t = TONE[step.tone] || TONE.info;
  return (
    <Paper elevation={0} sx={{
      mb: 2.5, p: 2.5, borderRadius: '8px', border: '1px solid', borderColor: t.border, bgcolor: t.bg,
      display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
    }}>
      <Box sx={{ width: 42, height: 42, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: PFMS.surface, color: t.fg, flexShrink: 0 }}>
        <ArrowRight size={22} />
      </Box>
      <Box sx={{ minWidth: 220, flexGrow: 1 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: t.fg }}>Next Step</Typography>
        <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>{step.title}</Typography>
        {step.desc && <Typography variant="body2" color="text.secondary">{step.desc}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
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
