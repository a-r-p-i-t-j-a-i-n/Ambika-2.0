import React from 'react';
import { Box, Stack, Typography, Paper, Chip, alpha } from '@mui/material';
import BackButton from '../../../components/BackButton';

/**
 * Shared design + reference tokens for the PPC / DPR module. The reason & defect
 * KEYS here mirror backend/src/modules/ppc/dpr.constants.js exactly — they are
 * what persist to the database, so keep them in lock-step (labels are display
 * only and safe to reword). PPC uses an indigo→violet accent to sit apart from
 * the blue IMS and emerald Finished-Goods modules.
 */

export const PPC_ACCENT = '#6d28d9';       // violet-700
export const PPC_ACCENT_SOFT = '#7c3aed';

// ── Reference lists (mirror the client's OEE sheet columns) ────────────────────
export const HOUR_SLOTS = [
  { key: '0830-0930', label: '08:30–09:30' }, { key: '0930-1030', label: '09:30–10:30' },
  { key: '1030-1130', label: '10:30–11:30' }, { key: '1130-1230', label: '11:30–12:30' },
  { key: '1230-0100', label: '12:30–01:00' }, { key: '0100-0200', label: '01:00–02:00' },
  { key: '0200-0300', label: '02:00–03:00' }, { key: '0300-0400', label: '03:00–04:00' },
  { key: '0400-0500', label: '04:00–05:00' }, { key: '0500-0600', label: '05:00–06:00' },
  { key: '0600-0700', label: '06:00–07:00' }, { key: '0700-0800', label: '07:00–08:00' },
  { key: '0800-0900', label: '08:00–09:00' },
];

export const PLANNED_REASONS = [
  { key: 'mc_pm', label: 'M/c PM' }, { key: 'shutdown', label: 'Shutdown / No Plan' },
  { key: 'lunch_tea', label: 'Lunch & Tea Time' }, { key: 'training', label: 'Training / Meeting' },
  { key: 'cleaning_5s', label: '5S / M/c Cleaning' }, { key: 'plan_down_1', label: 'Plan Downtime 1' },
  { key: 'plan_down_2', label: 'Plan Downtime 2' },
];

export const DOWNTIME_REASONS = [
  { key: 'no_operator', label: 'No Operator / No Manpower' }, { key: 'coil_unloading', label: 'Coil Unloading' },
  { key: 'no_material', label: 'No Material' }, { key: 'material_shifting', label: 'Material Shifting' },
  { key: 'mc_breakdown', label: 'M/C Breakdown' }, { key: 'tool_breakdown', label: 'Tool Breakdown' },
  { key: 'tool_changeover', label: 'Tool Changeover' }, { key: 'thessy_changing', label: 'Thessy Changing' },
  { key: 'die_setup', label: 'Die Setup' }, { key: 'die_punch', label: 'Die Punch' },
  { key: 'die_polish', label: 'Die Polish' }, { key: 'die_change', label: 'Die Change' },
  { key: 'die_ring_ct_pol', label: 'Die Ring Ct. Pol.' }, { key: 'material_packing', label: 'Material Packing' },
  { key: 'punch_change', label: 'Punch Change' }, { key: 'cutting_circle', label: 'Cutting Circle' },
  { key: 'tool_dhar', label: 'Tool Dhar' }, { key: 'setting_punch', label: 'Setting Punch' },
  { key: 'box_packing', label: 'Box Packing' }, { key: 'power_cut', label: 'Power Cut' },
  { key: 'soap_mixing', label: 'Soap Mixing' }, { key: 'circle_unloading', label: 'Circle Unloading' },
  { key: 'chun_packing', label: 'Chun Packing' }, { key: 'freshen_up', label: 'Freshen Up' },
  { key: 'material_counting', label: 'Material Counting' }, { key: 'machine_prob', label: 'Machine Prob' },
  { key: 'other_loss', label: 'Other Loss' }, { key: 'machine_setting', label: 'Machine Setting' },
  { key: 'paper_polish', label: 'Paper Polish' }, { key: 'press_setting', label: 'Press Setting' },
  { key: 'circle_shifting', label: 'Circle Shifing' }, { key: 'material_repair', label: 'Material Repair' },
  { key: 'die_prob', label: 'Die Prob' }, { key: 'material_checking', label: 'Material checking' },
  { key: 'no_tool', label: 'No Tool' }, { key: 'box_loading', label: 'Box Loading' },
  { key: 'setting_coil', label: 'Setting Coil' },
];

export const DEFECT_TYPES = [
  { key: 'side_cut', label: 'Side Cut' }, { key: 'bend', label: 'Bend' }, { key: 'scratch', label: 'Scratch' },
  { key: 'pressure', label: 'Pressure' }, { key: 'dent', label: 'Dent' }, { key: 'patti_bardi', label: 'Patti Bardi' },
  { key: 'crack', label: 'Crack' }, { key: 'goba_prob', label: 'Goba Prob' }, { key: 'burr', label: 'Burr' },
  { key: 'press_line', label: 'Press Line' }, { key: 'punching_miss', label: 'Punching Miss' },
  { key: 'outpatti', label: 'Outpatti' }, { key: 'dent_scratch', label: 'Dent / Scratch' },
  { key: 'rolling_line', label: 'Rolling Line' }, { key: 'rolling_goba', label: 'Rolling Goba' },
  { key: 'inside_ragdi', label: 'Inside Ragdi' }, { key: 'file_mark', label: 'File Mark' },
  { key: 'scrap', label: 'Scrap' }, { key: 'circle', label: 'Circle' }, { key: 'others', label: 'Others' },
  { key: 'setting_pcs', label: 'Setting Pcs' }, { key: 'patti_chimati', label: 'Patti Chimati' },
  { key: 'dimension_ng', label: 'Dimension NG' }, { key: 'patti_problem', label: 'Patti Problem' },
  { key: 'chun_mar_bottom', label: 'Chun Mar On Bottom' },
];

export const SHIFTS = ['A', 'B', 'C', 'G'];

export const MACHINE_TYPES = [
  'Circle Cutting Press', 'Double Action Press', 'Single Action Press', 'Spinning / Rolling Machine',
  'Cutting Machine', 'Hydraulic Press', 'Buffing Motor', 'Lathe', 'Manual / Other',
];

// Fast key→label maps for turning stored reason/defect keys back into words.
export const LABEL_OF = Object.fromEntries(
  [...PLANNED_REASONS, ...DOWNTIME_REASONS].map((r) => [r.key, r.label]),
);
export const DEFECT_LABEL_OF = Object.fromEntries(DEFECT_TYPES.map((r) => [r.key, r.label]));
export const HOUR_LABEL_OF = Object.fromEntries(HOUR_SLOTS.map((h) => [h.key, h.label]));

// ── Formatters ─────────────────────────────────────────────────────────────────
export const num = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const num2 = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export const compactInr = (v) => {
  const n = Number(v || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
};
export const pct = (v) => `${Number(v || 0).toFixed(1)}%`;
export const mins = (v) => `${Number(v || 0).toLocaleString('en-IN')} min`;

// ── OEE colour bands (world-class OEE ≥ 85%) ──────────────────────────────────
export const oeeColor = (p) => {
  const v = Number(p || 0);
  if (v >= 85) return '#0f766e'; // world-class — teal
  if (v >= 60) return '#16a34a'; // good — green
  if (v >= 40) return '#d97706'; // fair — amber
  return '#dc2626';              // low — red
};
export const oeeBand = (p) => {
  const v = Number(p || 0);
  if (v >= 85) return 'World-class';
  if (v >= 60) return 'Good';
  if (v >= 40) return 'Fair';
  return 'Needs attention';
};
// Generic 0–100 ratio colour (availability / performance / quality columns).
export const ratioColor = (p) => {
  const v = Number(p || 0);
  if (v >= 90) return '#0f766e';
  if (v >= 70) return '#16a34a';
  if (v >= 50) return '#d97706';
  return '#dc2626';
};

// Categorical palette for charts (colour-blind-safe-ish, distinct hues).
export const CHART_COLORS = ['#6d28d9', '#0ea5e9', '#16a34a', '#d97706', '#dc2626', '#0f766e', '#db2777', '#7c3aed', '#2563eb', '#65a30d'];

// ── Shared components ──────────────────────────────────────────────────────────
// Height is locked to the sidebar's brand header (80px on desktop) so the hero's
// bottom edge lines up exactly with the sidebar's divider.
export const DprHero = ({ icon: Icon, title, subtitle, action }) => (
  <Box sx={{
    color: '#fff', px: { xs: 2.5, md: 4 }, py: { xs: 1.25, md: 0 },
    minHeight: { xs: 64, md: 80 }, display: 'flex', alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.14)',
    background: 'linear-gradient(135deg, #2e1065 0%, #5b21b6 52%, #7c3aed 100%)',
  }}>
    <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <BackButton iconOnly sx={{ color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 2, flexShrink: 0 }} />
        {Icon && (
          <Box sx={{ width: 42, height: 42, borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Icon size={20} color="#fff" />
          </Box>
        )}
        <Box>
          <Typography sx={{ color: '#fff', fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {title}
          </Typography>
          {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.82rem', mt: 0.25 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
      {action}
    </Stack>
  </Box>
);

export const StatTile = ({ label, value, sub, color = PPC_ACCENT, icon: Icon }) => (
  <Paper elevation={0} sx={{
    p: 1.5, borderRadius: '14px', flex: 1, minWidth: 150,
    border: '1px solid', borderColor: 'divider',
    transition: 'box-shadow .15s, transform .15s', '&:hover': { boxShadow: 3, transform: 'translateY(-1px)' },
  }}>
    <Stack direction="row" spacing={1.25} alignItems="center">
      {Icon && (
        <Box sx={{ width: 38, height: 38, borderRadius: '11px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.12), color, flexShrink: 0 }}>
          <Icon size={19} />
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }} noWrap>{label}</Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2, color }} noWrap>{value}</Typography>
        {sub && <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }} noWrap>{sub}</Typography>}
      </Box>
    </Stack>
  </Paper>
);

export const Panel = ({ title, action, children, sx }) => (
  <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: '1px solid', borderColor: 'divider', ...sx }}>
    {(title || action) && (
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>{title}</Typography>
        {action}
      </Stack>
    )}
    {children}
  </Paper>
);

// A compact OEE ratio bar (availability / performance / quality readout).
export const RatioBar = ({ label, value, color }) => {
  const v = Math.min(100, Math.max(0, Number(value || 0)));
  const c = color || ratioColor(v);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: c }}>{v.toFixed(1)}%</Typography>
      </Stack>
      <Box sx={{ height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08), overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${v}%`, bgcolor: c, borderRadius: 5, transition: 'width .3s' }} />
      </Box>
    </Box>
  );
};

export const OeeChip = ({ value, size = 'small' }) => {
  const c = oeeColor(value);
  return <Chip size={size} label={`${Number(value || 0).toFixed(1)}%`} sx={{ fontWeight: 800, height: 22, bgcolor: `${c}1f`, color: c, border: `1px solid ${c}55` }} />;
};

export default DprHero;
