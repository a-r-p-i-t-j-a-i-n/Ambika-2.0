// ── O2D design system — status-driven colour tokens ─────────────────────────
// One source of truth for "what a colour MEANS" across the whole O2D area (pipeline
// + FMS). The client's rule is simple: the colour follows the STATE. Something done
// is green, something in-hand is blue, something waiting is slate, something late is
// amber. Every O2D screen reads from here so the language is identical everywhere —
// a doer never has to decode a new palette per screen.

// The client's palette is a WARM neutral one — crisp white panels for content,
// separated by soft greige/khaki bands for the chrome (journey rail, sidebar,
// up-next, footer). That alternation is what makes each block read as its own
// zone without needing heavy borders or shadows.
export const O2D = {
  ink:     '#1c1e21',   // primary text (warm near-black)
  body:    '#3f4650',
  sub:     '#6b7280',   // secondary text / captions
  faint:   '#9ca3af',
  line:    '#e4e1d9',   // warm hairline borders
  lineSoft:'#eeebe4',
  surface: '#ffffff',   // content panels — always white
  surfaceAlt: '#f7f6f2',// tinted band: journey rail, sidebar cards, footer
  band:    '#efece5',   // stronger band: up-next strip
  canvas:  '#e9e7e1',   // page background (the warm khaki behind everything)
  brand:   '#1d4ed8',
};

// status → the full visual chip: strong colour, chip background, faint tint for
// card washes, a display label and the "dot"/ring colour used on the journey rail.
export const STATUS_TOKENS = {
  DONE:        { color: '#15803d', bg: '#dcfce7', tint: '#f2fdf5', ring: '#22c55e', label: 'Completed' },
  DELAYED:     { color: '#b45309', bg: '#fef3c7', tint: '#fffbeb', ring: '#f59e0b', label: 'Completed · late' },
  IN_PROGRESS: { color: '#1d4ed8', bg: '#dbeafe', tint: '#f2f6ff', ring: '#3b82f6', label: 'In progress' },
  PENDING:     { color: '#475569', bg: '#e9eef5', tint: '#f7f9fc', ring: '#cbd5e1', label: 'Pending' },
  SKIPPED:     { color: '#64748b', bg: '#e9eef5', tint: '#f7f9fc', ring: '#cbd5e1', label: 'Skipped' },
};

// The O2D tooltip look — a light, warm popover with blue text, NOT the browser
// default black slab. Every O2D surface uses this one so a hint always reads the
// same: `<Tooltip arrow slotProps={O2D_TIP} …>`.
export const O2D_TIP = {
  tooltip: {
    sx: {
      bgcolor: O2D.surface, color: O2D.brand, fontWeight: 800, fontSize: '0.72rem',
      px: 1.1, py: 0.6, borderRadius: '7px', border: `1px solid ${O2D.line}`,
      boxShadow: '0 8px 24px rgba(28,30,33,0.16)',
      maxWidth: 300,
    },
  },
  arrow: { sx: { color: O2D.surface, '&::before': { border: `1px solid ${O2D.line}` } } },
};

export const tokenOf = (status) => STATUS_TOKENS[status] || STATUS_TOKENS.PENDING;
export const isDone = (status) => status === 'DONE' || status === 'DELAYED';

// Timing verdict for a step → green when on/ahead of time, amber when late.
export const timingOf = (step) => {
  const late = Number(step?.delayMins || 0) > 0 || step?.status === 'DELAYED' || step?.isOverdue;
  return late
    ? { text: step?.delayMins ? `Late by ${step.delayMins} min` : 'Late', color: '#b45309', tone: 'late' }
    : { text: 'On time', color: '#15803d', tone: 'ontime' };
};

// The order's journey is read as MILESTONE PHASES (Pre-production → Planning →
// Execution → Post-dispatch) rather than all 13 steps — so the rail stays short and
// legible. Labels are deliberately plain-English, no internal jargon.
export const JOURNEY_PHASES = [
  { key: 'PRE_PRODUCTION', label: 'Order received' },
  { key: 'PLANNING',       label: 'Dispatch plan' },
  { key: 'EXECUTION',      label: 'Production & dispatch' },
  { key: 'POST_DISPATCH',  label: 'Invoice & payment' },
];
