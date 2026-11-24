// ── O2D Dashboard look — the client's design (ui html/O2D-V2-Dashboard) ──────
// Colours and sizes copied from that file so the screen matches it.

export const T = {
  page: '#f3f5f9',
  surface: '#ffffff',
  surface2: '#f7f9fc',
  surface3: '#eef2f7',
  border: '#e3e8ef',
  borderSoft: '#dfe5ee',
  divider: '#cfd6e2',
  text: '#0f172a',
  text2: '#475569',
  muted: '#8590a2',
  ink: '#111827',
  heading: '#1e3a8a',
  brand: '#286abb',
  brand50: '#edf4fc',
  pick: '#2563eb',
};

// Order / task status colours (donut, legend, overview icons).
export const GROUP_COLOR = { OPEN: '#4a90e2', OVERDUE: '#f0646f', COMPLETED: '#3fbf7f', CANCELLED: '#b5bcc9' };
export const GROUP_LABEL = { OPEN: 'In progress', OVERDUE: 'Delayed', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

// KPI tiles: outline icon colour + tile background.
export const KPI_TONE = {
  blue: { fg: '#2f6fd0', bg: '#f1f6ff' },
  amber: { fg: '#f08a24', bg: '#fff7ec' },
  green: { fg: '#22a06b', bg: '#effaf4' },
  teal: { fg: '#14b8c8', bg: '#ecfbfc' },
  orange: { fg: '#f97316', bg: '#fff5ec' },
  red: { fg: '#e11d48', bg: '#fdf2f4' },
  fuchsia: { fg: '#c026d3', bg: '#fcf4fd' },
  violet: { fg: '#7c5ce0', bg: '#f6f3ff' },
};

// Status chips.
export const CHIP_TONE = {
  ok: { fg: '#0f7a2f', bg: '#e7f7ec' },
  info: { fg: '#1d5fc4', bg: '#e8f1fe' },
  warn: { fg: '#9a5b00', bg: '#fff4dc' },
  danger: { fg: '#c02626', bg: '#fdecec' },
  neutral: { fg: '#556072', bg: '#eef0f4' },
};

export const SKU_COLORS = ['#2f6fd0', '#7c5ce0', '#2f9e6a', '#d98e12', '#0e9aa7', '#d6485a', '#c026d3', '#4f46e5', '#64748b', '#b7791f'];
export const AVATAR_COLORS = ['#7c6cf0', '#2f8fd6', '#e0708f', '#2fa77a', '#e09a2f', '#5b6ee0'];

// Quick Overview stat boxes.
export const STAT_BG = { blue: '#eef4fd', green: '#eefaf3', pink: '#fdf0f2', grey: '#f2f4f8', amber: '#fff9ec' };

export const INSIGHT_BG = '#e7f8f1';

// Panels sit side by side from here — narrower than MUI's lg, because inside
// the Delegation Suite the ERP frame is ~1100–1200px wide on a laptop.
export const WIDE = '@media (min-width: 1080px)';
export const ROOMY = '@media (min-width: 1280px)';
