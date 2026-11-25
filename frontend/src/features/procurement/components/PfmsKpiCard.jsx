import React from 'react';
import { StepCard, STEP_TONES } from '../../o2d-fms/components/O2dStepCard';
import { kpiCategoryFor } from '../pfmsTheme';

/**
 * Shared summary/KPI card for every Purchase FMS list page (all step routes,
 * the Awaiting queues, and the other procurement lists that use it).
 *
 * It is the O2D card (O2D Step Board / Master Data): 193 x 72, big outline icon
 * · hairline divider · big figure over the label, on a very light pastel with a
 * matching border — the shared StepCard, so both modules stay identical.
 *
 * Colour: the `color` a screen passes keeps its MEANING (total = blue, pending
 * = amber, approved = teal, done = green, partial = orange, cancelled = rose,
 * short-closed = violet, payment = cyan, neutral = grey) on the O2D palette.
 *
 * Optionally interactive: pass `onClick` and the card becomes a real button
 * that filters the list below it; `active` draws the selected state (the card's
 * own colour as a ring). Cards WITHOUT `onClick` are a plain summary figure.
 * Same props, same click, same title text and data attributes as before.
 */
const TONE_BY_CATEGORY = {
  total: 'blue', pending: 'amber', progress: 'teal', done: 'green', partial: 'orange',
  negative: 'rose', short: 'violet', payment: 'cyan', neutral: 'grey',
};
const TONE_BY_COLOR = { '#1d4ed8': 'blue', '#0ea5e9': 'sky' };   // colours outside the category map

// Any other colour (a status colour a screen passes from its own meta) → the
// O2D tone nearest in hue, so it keeps its colour; greys stay grey.
const hueOf = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16); const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const bl = (n & 255) / 255;
  const max = Math.max(r, g, bl); const min = Math.min(r, g, bl); const d = max - min;
  if (d / (max || 1) < 0.45) return null;                         // low saturation (slate) → grey
  const h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const nearestTone = (color) => {
  const h = hueOf(color);
  if (h == null) return STEP_TONES.grey;
  let best = 'blue'; let bestD = 999;
  Object.entries(STEP_TONES).forEach(([name, t]) => {
    const th = hueOf(t.accent); if (th == null) return;
    const dist = Math.min(Math.abs(h - th), 360 - Math.abs(h - th));
    if (dist < bestD) { bestD = dist; best = name; }
  });
  return STEP_TONES[best];
};

const toneFor = (color) => {
  const c = String(color || '').toLowerCase();
  return STEP_TONES[TONE_BY_COLOR[c] || TONE_BY_CATEGORY[kpiCategoryFor(c)]] || nearestTone(c);
};

const PfmsKpiCard = ({ icon, label, value, color, onClick, active = false }) => {
  const interactive = typeof onClick === 'function';
  const shown = value ?? 0;
  const isMoney = typeof shown === 'string' && shown.trim().startsWith('₹');
  return (
    <StepCard
      name={label} value={shown} unit="" tone={toneFor(color)} icon={icon}
      active={interactive && active} onClick={interactive ? onClick : undefined} fitValue={isMoney}
      data-kpi-card=""
      {...(interactive
        ? { 'data-kpi-clickable': 'true', title: active ? `Showing: ${label} (${shown}) — click again to clear` : `Filter by: ${label} (${shown})` }
        : { title: `${label}: ${shown}` })}
    />
  );
};

export default PfmsKpiCard;
