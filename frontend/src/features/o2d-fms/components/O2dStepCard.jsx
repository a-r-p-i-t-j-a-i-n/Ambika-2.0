import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, alpha } from '@mui/material';
import {
  Workflow, Inbox, FileCheck2, PackageSearch, CalendarRange, Send, Truck, ReceiptText, MailCheck,
  MapPinned, PhoneCall, Wallet, FileInput, Banknote,
} from 'lucide-react';
import { FLUENT_DEPTH } from '../../ims/imsFluent';
import { O2D_TIP } from '../o2dTheme';

// ── O2D step card — shared by the Step Board and O2D Master Data ────────────
// The O2D dashboard KPI card look: big outline icon · hairline divider · big
// figure over the step name, on a very light ground with a matching border.
// Presentation only — the figure and the click are whatever the screen passes.

// Each step's own icon — what the step is about (the 13-step O2D sequence).
// A step code not listed here (a custom template step) gets the flow icon.
export const STEP_ICONS = {
  '1.01': Inbox,          // order received
  '2.02': FileCheck2,     // PO / Tally check
  '2.03': PackageSearch,  // check inventory
  '2.04': CalendarRange,  // dispatch planning
  '2.05': Send,           // email dispatch schedule
  '2.06': Truck,          // actual dispatch
  '2.07': ReceiptText,    // invoice & e-way bill
  '2.08': MailCheck,      // email invoice
  '2.09': MapPinned,      // track delivery
  '2.10': PhoneCall,      // payment follow-up
  '2.11': Wallet,         // receive payment & Tally
  '2.12': FileInput,      // receive transport bill
  '2.13': Banknote,       // transport bill payment
};
export const stepIcon = (code) => STEP_ICONS[code] || Workflow;

// The reference card colours (O2D V2 dashboard KPI row), in its order —
// [icon accent, card background, card border] — then six more of the same
// family so all 13 steps differ. Text stays dark navy on every card.
const STEP_PALETTE = [
  ['#2563eb', '#eef4fe', '#b9d3f7'], // blue
  ['#d97706', '#fff8ef', '#f5d6ae'], // amber
  ['#16a34a', '#effcf6', '#a8e6c9'], // green
  ['#0891b2', '#eefcfd', '#a9e3ea'], // cyan
  ['#ea580c', '#fff5ee', '#f8c9a6'], // orange
  ['#e11d48', '#fff2f3', '#f6b9c2'], // rose
  ['#c026d3', '#fdf3fd', '#ecbdf0'], // magenta
  ['#7c3aed', '#f6f2ff', '#d4c4fb'], // violet
  ['#0d9488', '#effcfa', '#a5e2d9'], // teal
  ['#4f46e5', '#f1f2ff', '#c5c7f7'], // indigo
  ['#db2777', '#fef2f8', '#f5bcd8'], // pink
  ['#0284c7', '#eef8fe', '#aed8f3'], // sky
  ['#65a30d', '#f6fbee', '#cde5a8'], // lime
];
export const stepTone = (i) => {
  const [accent, bg, border] = STEP_PALETTE[i % STEP_PALETTE.length];
  return { accent, bg, border };
};
// The same palette by colour name — for cards whose colour MEANS something
// (pending = amber, done = green …) rather than following the step order.
const PALETTE_NAMES = ['blue', 'amber', 'green', 'cyan', 'orange', 'rose', 'magenta', 'violet', 'teal', 'indigo', 'pink', 'sky', 'lime'];
export const STEP_TONES = {
  ...Object.fromEntries(PALETTE_NAMES.map((n, i) => [n, stepTone(i)])),
  grey: { accent: '#475569', bg: '#f7f9fc', border: '#dfe5ee' },
};
const CARD_INK = '#0f172a';

/**
 * One step card. The whole card is the button (click, Enter / Space);
 * forwardRef so a Tooltip can anchor on it. `unit` only words the
 * screen-reader label ("12 orders" / "12 records"). `labelLines` = how many
 * lines a long step name may wrap to (2 by default; 3 still fits the 72px card).
 * `icon` is an icon component (or an icon element). Without `onClick` the card
 * is a plain figure (no button role, no hover). `fitValue` shrinks a long figure
 * (₹ amounts) to the card's width instead of cutting it.
 */
export const StepCard = React.forwardRef(({
  code, name, value, tone, icon, active, onClick, testId, unit = 'orders', labelLines = 2, fitValue = false, badge, ...rest
}, ref) => {
  const StepIcon = icon;
  const interactive = typeof onClick === 'function';
  const iconNode = React.isValidElement(icon)
    ? React.cloneElement(icon, { size: 26, strokeWidth: 1.8 })
    : <StepIcon size={26} strokeWidth={1.8} />;
  const text = String(value ?? '');
  // ~0.64em per digit / symbol, ~0.3em per comma, point or space (weight 800).
  const valueEm = [...text].reduce((w, ch) => w + (/[,.\s]/.test(ch) ? 0.3 : 0.64), 0) || 1;
  const label = [code, name].filter(Boolean).join(' ');
  // `badge` given → the step NUMBER is the prominent figure and the count sits
  // in the O2D pending badge beside it (the original O2D step-rail pattern).
  const hasBadge = badge !== undefined;
  const figure = hasBadge ? code : value;
  const count = hasBadge ? badge : value;
  return (
  <Box
    ref={ref} {...rest}
    data-testid={testId}
    {...(interactive && {
      role: 'button', tabIndex: 0, 'aria-pressed': !!active,
      onClick,
      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } },
    })}
    aria-label={`${label}: ${count}${unit ? ` ${unit}` : ''}`}
    sx={{
      // Reference card geometry, measured on the reference screenshot (125% display):
      // 241 x 90 physical px = 193 x 72 CSS px; 14px sides; 11px icon / divider / text gaps.
      display: 'flex', alignItems: 'center', gap: '11px', height: 72, boxSizing: 'border-box',
      // Colours come from the tone; a screen may re-colour cards through CSS
      // variables (--card-bg / -border / -accent / -ring / -focus / -ink) —
      // unset, the card is exactly the tone's look.
      px: '14px', borderRadius: '7px', cursor: interactive ? 'pointer' : 'default', outline: 'none',
      bgcolor: `var(--card-bg, ${tone.bg})`,
      border: `1px solid ${active ? `var(--card-accent, ${tone.accent})` : `var(--card-border, ${tone.border})`}`,
      // Selected: the step's own colour as a ring — same card, just outlined.
      boxShadow: active ? `0 0 0 2px var(--card-ring, ${alpha(tone.accent, 0.25)})` : 'none',
      transition: 'box-shadow .15s, border-color .15s, transform .15s, background-color .15s',
      ...(interactive && {
        '&:hover': {
          borderColor: `var(--card-accent, ${tone.accent})`,
          boxShadow: active ? `0 0 0 2px var(--card-ring, ${alpha(tone.accent, 0.25)})` : FLUENT_DEPTH.hover,
          transform: 'translateY(-1px)',
        },
        '&:focus-visible': { boxShadow: `0 0 0 3px var(--card-focus, ${alpha(tone.accent, 0.35)})` },
      }),
    }}
  >
    <Box sx={{ color: `var(--card-accent, ${tone.accent})`, display: 'flex', flexShrink: 0 }}>
      {iconNode}
    </Box>
    <Box aria-hidden sx={{ width: '1px', height: 42, bgcolor: `var(--card-border, ${tone.border})`, flexShrink: 0 }} />
    <Box sx={{ minWidth: 0, flex: 1, pt: '2.4px', ...(fitValue && { containerType: 'inline-size' }) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', minWidth: 0 }}>
        <Typography data-card-figure="" sx={{
          fontSize: fitValue ? `min(19.5px, calc(100cqi / ${valueEm.toFixed(2)}))` : '19.5px',
          fontWeight: 800, lineHeight: 1.15, color: CARD_INK, fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
        }}>
          {figure}
        </Typography>
        {hasBadge && <PendingBadge count={badge} />}
      </Box>
      <Typography title={code ? `${code} · ${name}` : name} sx={{
        // One line like the reference; a long step name wraps (never cut).
        fontSize: '10.7px', fontWeight: 500, color: `var(--card-ink, ${CARD_INK})`, lineHeight: 1.3, mt: '0.6px',
        display: '-webkit-box', WebkitLineClamp: labelLines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {name}
      </Typography>
    </Box>
  </Box>
  );
});
StepCard.displayName = 'StepCard';

// The O2D step-rail pending badge (O2dStepBoard's original rail): a solid
// circular pill, 26px, heavy white figure, gently pulsing while work waits —
// red here; grey and still at zero. Display only: the count is what it's given.
const BADGE_RED = '#dc2626';
const PendingBadge = ({ count }) => {
  const n = Number(count);
  const live = Number.isFinite(n) && n > 0;
  return (
    <Box component="span" data-card-badge="" aria-hidden sx={{
      flexShrink: 0, height: 26, minWidth: 26, px: '7px', boxSizing: 'border-box', borderRadius: '999px',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 900, fontSize: '0.84rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
      bgcolor: live ? BADGE_RED : '#f1f5f9', color: live ? '#fff' : '#64748b',
      ...(live && {
        animation: 'stepBadgePulse 1.6s ease-in-out infinite',
        '@keyframes stepBadgePulse': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: `0 0 0 0 ${alpha(BADGE_RED, 0.45)}` },
          '50%': { transform: 'scale(1.12)', boxShadow: `0 0 0 6px ${alpha(BADGE_RED, 0)}` },
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }),
    }}>
      {count ?? '—'}
    </Box>
  );
};

// The rail the cards sit in: one row, scrolls sideways, a few px of room so the
// selected card's ring is not clipped.
export const STEP_RAIL_SX = {
  display: 'flex', gap: '9px', overflowX: 'auto', px: 0.5, pt: 0.5, pb: 1, scrollSnapType: 'x proximity',
  scrollbarWidth: 'thin', '& > *': { flex: '0 0 193px', scrollSnapAlign: 'start', minWidth: 0 },
};

/**
 * Rail behaviour: centres the selected card (sideways only — the page never
 * jumps) and gives card tooltips the rail as their edge, so they never spill
 * over the sidebar. Returns the ref setter for the rail and the Tooltip slotProps.
 */
export const useStepRail = (activeKey, count) => {
  const [railEl, setRailEl] = useState(null);
  useEffect(() => {
    const card = railEl?.querySelector('[data-active="true"]');
    if (!railEl || !card) return;
    const r = railEl.getBoundingClientRect(); const c = card.getBoundingClientRect();
    railEl.scrollBy?.({ left: (c.left - r.left) - (r.width - c.width) / 2 });
  }, [activeKey, count, railEl]);
  const tipProps = useMemo(() => ({
    ...O2D_TIP,
    popper: {
      sx: { pointerEvents: 'none' },
      modifiers: [
        { name: 'preventOverflow', options: { boundary: railEl || 'clippingParents', padding: 8, altAxis: false } },
        { name: 'flip', options: { fallbackPlacements: ['bottom'] } },
      ],
    },
  }), [railEl]);
  return { railRef: setRailEl, tipProps };
};
