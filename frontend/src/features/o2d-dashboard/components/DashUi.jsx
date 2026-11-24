// ── O2D Dashboard building blocks, styled after the client's design ──────────
import React, { createElement, useState } from 'react';
import { Box, ButtonBase, Dialog, Paper, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Activity, CircleCheck, CircleX, Clock, Maximize2, TriangleAlert, Workflow, X } from 'lucide-react';
import { CHIP_TONE, INSIGHT_BG, KPI_TONE, ROOMY, T } from '../dashTheme';
import { avatarColor, fmtNum, initials } from '../format';

const cardSx = {
  bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '12px',
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)', p: 1.5, minWidth: 0,
  display: 'flex', flexDirection: 'column', gap: 1,
};

/** Page shell: the design's light grey canvas. */
export const DashPage = ({ children }) => (
  <Box sx={{ bgcolor: T.page, minHeight: '100vh', p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
    {children}
  </Box>
);

/** "O2D" title row with the page's own buttons on the right. */
export const DashHeader = ({ title, subtitle, children }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
    <Box sx={{ width: 34, height: 34, borderRadius: '9px', bgcolor: T.brand50, color: T.brand, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Workflow size={18} />
    </Box>
    <Box sx={{ mr: 'auto', minWidth: 0 }}>
      <Typography component="h1" sx={{ fontSize: 20, fontWeight: 800, color: T.heading, lineHeight: 1.2 }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: 12, color: T.text2 }}>{subtitle}</Typography>}
    </Box>
    {children}
  </Box>
);

export const GhostButton = ({ onClick, children }) => (
  <ButtonBase
    onClick={onClick}
    sx={{ px: 1.5, py: 0.75, borderRadius: '8px', fontSize: 13, fontWeight: 600, color: T.text, '&:hover': { bgcolor: T.surface3 } }}
  >
    {children}
  </ButtonBase>
);

/** Company / My tasks — only for people who may see the whole dashboard. */
export const ViewSwitch = ({ value, onChange }) => (
  <Box role="tablist" aria-label="Dashboard view" sx={{ display: 'inline-flex', p: '3px', borderRadius: '9px', bgcolor: T.surface3 }}>
    {[{ v: 'company', l: 'Company' }, { v: 'mine', l: 'My tasks' }].map(({ v, l }) => (
      <ButtonBase
        key={v}
        role="tab"
        aria-selected={value === v}
        onClick={() => onChange(v)}
        sx={{
          px: 1.5, py: 0.5, borderRadius: '7px', fontSize: 12.5, fontWeight: 700,
          color: value === v ? T.heading : T.text2, bgcolor: value === v ? '#fff' : 'transparent',
          boxShadow: value === v ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
        }}
      >
        {l}
      </ButtonBase>
    ))}
  </Box>
);

/** "FILTER  [All orders · 48 orders]  … Clear" — the table's filter bar. */
export const FilterBar = ({ chip, children, onClear }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.text2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Filter</Typography>
    <Box component="span" sx={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', bgcolor: '#eef3fb', border: '1px solid #dbe5f3', borderRadius: 999, px: 1.25, py: '3px' }}>
      {chip}
    </Box>
    {children}
    <ButtonBase onClick={onClear} sx={{ fontSize: 12, fontWeight: 600, color: T.brand, px: 0.75, py: 0.4, borderRadius: '6px' }}>Clear</ButtonBase>
  </Box>
);

const IconSquare = ({ title, onClick, children }) => (
  <Tooltip title={title}>
    <ButtonBase
      onClick={onClick}
      aria-label={title}
      sx={{
        flexShrink: 0, width: 26, height: 26, borderRadius: '6px', border: `1px solid ${T.borderSoft}`,
        bgcolor: '#fff', color: '#334155', '&:hover': { bgcolor: '#f3f6fb' },
      }}
    >
      {children}
    </ButtonBase>
  </Tooltip>
);

/**
 * A dashboard panel. `children` may be a function of `big`, so the same panel
 * can be drawn larger in the expand window (the ⤢ button, as in the design).
 * With `onExpand`, the ⤢ button calls it instead (e.g. opens the full screen
 * the panel previews), labelled `expandLabel`.
 */
export const DashCard = ({ title, actions = null, expandable = true, onExpand, expandLabel = 'Expand', children, sx, bodySx }) => {
  const [open, setOpen] = useState(false);
  const body = (big) => (typeof children === 'function' ? children(big) : children);
  // Title and controls wrap as needed; the expand button stays top-right.
  const header = (big) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0, flex: 1, minHeight: 26 }}>
        <Typography component="h3" sx={{ fontSize: big ? 17 : 14, fontWeight: 700, color: T.heading, mr: 'auto' }}>
          {title}
        </Typography>
        {actions}
      </Box>
      {onExpand && (
        <IconSquare title={expandLabel} onClick={onExpand}>
          <Maximize2 size={13} />
        </IconSquare>
      )}
      {expandable && !onExpand && (
        <IconSquare title={big ? 'Close' : 'Expand'} onClick={() => setOpen(!big)}>
          {big ? <X size={13} /> : <Maximize2 size={13} />}
        </IconSquare>
      )}
    </Box>
  );
  return (
    <>
      <Paper sx={{ ...cardSx, ...sx }}>
        {header(false)}
        <Box sx={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', ...bodySx }}>{body(false)}</Box>
      </Paper>
      {expandable && !onExpand && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          maxWidth="lg"
          fullWidth
          PaperProps={{ sx: { ...cardSx, p: 2.5, gap: 1.5, maxHeight: '88vh' } }}
        >
          {header(true)}
          <Box sx={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>{body(true)}</Box>
        </Dialog>
      )}
    </>
  );
};

/** KPI tile: outline icon, a thin divider, then the number over its label. Clicking filters the page. */
export const KpiTile = ({ tone = 'blue', icon, value, label, active = false, onClick }) => {
  const { fg, bg } = KPI_TONE[tone] || KPI_TONE.blue;
  const text = String(value);
  return (
    <ButtonBase
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={active}
      sx={{
        justifyContent: 'flex-start', gap: 1.25, px: 1.5, py: 1.5, height: 80, minWidth: 0, textAlign: 'left',
        borderRadius: '12px', bgcolor: bg, border: '1px solid',
        borderColor: active ? T.brand : alpha(fg, 0.3),
        boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : 'none',
        transition: 'box-shadow .12s, border-color .12s',
        '&:hover': { boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : '0 2px 8px rgba(15,23,42,.07)' },
        '&.Mui-disabled': { color: 'inherit' },
        '& .kpi-icon': { width: 26, height: 26, flexShrink: 0 },
        [ROOMY]: { gap: 1.5, px: 1.75, '& .kpi-icon': { width: 30, height: 30 } },
      }}
    >
      {icon ? createElement(icon, { size: 30, color: fg, strokeWidth: 1.8, className: 'kpi-icon' }) : null}
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: T.divider, my: 0.5, flexShrink: 0 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 0.25 }}>
        <Typography sx={{ fontSize: text.length > 8 ? 15 : text.length > 6 ? 17 : 22, fontWeight: 800, color: T.text, lineHeight: 1.1, whiteSpace: 'nowrap' }}>
          {text}
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: T.ink, fontWeight: 500, lineHeight: 1.25 }}>{label}</Typography>
      </Box>
    </ButtonBase>
  );
};

/** Compact native select, as in the design's panel headers. */
export const MiniSelect = ({ value, onChange, options, label, sx }) => (
  <Box
    component="select"
    value={value}
    aria-label={label}
    onChange={(e) => onChange(e.target.value)}
    sx={{
      font: 'inherit', fontSize: 13, color: T.ink, bgcolor: '#fff', border: `1px solid ${T.border}`,
      borderRadius: '7px', px: 1, py: '5px', maxWidth: 170, cursor: 'pointer', ...sx,
    }}
  >
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </Box>
);

export const MiniDate = ({ value, onChange, label }) => (
  <Box
    component="input"
    type="date"
    value={value}
    aria-label={label}
    onChange={(e) => onChange(e.target.value)}
    sx={{ font: 'inherit', fontSize: 13, color: T.ink, bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '7px', px: 1, py: '4px' }}
  />
);

const CHIP_ICON = { ok: CircleCheck, info: Activity, warn: Clock, danger: TriangleAlert, neutral: CircleX };

export const ToneChip = ({ tone = 'neutral', children }) => {
  const c = CHIP_TONE[tone] || CHIP_TONE.neutral;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: '3px', borderRadius: '6px',
        fontSize: 11.5, fontWeight: 700, color: c.fg, bgcolor: c.bg, whiteSpace: 'nowrap',
      }}
    >
      {createElement(CHIP_ICON[tone] || CircleX, { size: 12 })}
      {children}
    </Box>
  );
};

/** Progress bar: green from 90%, blue from 50%, red below — as in the design. */
export const ProgressCell = ({ pct }) => {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const color = p >= 90 ? '#22a06b' : p >= 50 ? '#3b82f6' : '#e5484d';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 99, bgcolor: T.surface3, overflow: 'hidden', minWidth: 60 }}>
        <Box sx={{ width: `${p}%`, height: '100%', borderRadius: 99, bgcolor: color }} />
      </Box>
      <Typography sx={{ fontSize: 12, fontWeight: 600, width: 38, textAlign: 'right', color: T.text2 }}>{p}%</Typography>
    </Box>
  );
};

export const PersonAvatar = ({ name, size = 24 }) => (
  <Box
    component="span"
    title={name || ''}
    sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
      bgcolor: avatarColor(name), color: '#fff', fontSize: size * 0.4, fontWeight: 800,
    }}
  >
    {initials(name)}
  </Box>
);

export const Person = ({ name }) => (name ? (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
    <PersonAvatar name={name} />
    <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{name}</Typography>
  </Box>
) : <Typography sx={{ color: T.muted }}>—</Typography>);

/**
 * Status donut. `segments`: [{ key, value, color, label }]. Clicking a slice
 * filters the page; with `highlight`, the other slices go grey.
 */
export const Donut = ({ segments, centerLabel, centerValue, size = 210, highlight, onSegment }) => {
  const R = 72;
  const C = 2 * Math.PI * R;
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  // Each slice starts where the ones before it end.
  const arcs = segments.map((s, i) => ({
    ...s,
    len: (s.value / total) * C,
    start: segments.slice(0, i).reduce((a, p) => a + (p.value / total) * C, 0),
  }));
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <svg viewBox="0 0 190 190" width={size} height={size} role="img" aria-label={centerLabel}>
        <circle cx="95" cy="95" r={R} fill="none" stroke="#eef1f6" strokeWidth="22" />
        {arcs.map((s) => (
          <circle
            key={s.key}
            cx="95" cy="95" r={R} fill="none"
            stroke={!highlight || highlight.includes(s.key) ? s.color : '#e5e7eb'}
            strokeWidth="22"
            strokeDasharray={`${s.len} ${C - s.len}`}
            strokeDashoffset={-s.start}
            transform="rotate(-90 95 95)"
            style={{ cursor: onSegment ? 'pointer' : 'default' }}
            onClick={onSegment ? () => onSegment(s.key) : undefined}
          >
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        ))}
        <text x="95" y="90" textAnchor="middle" fontSize="12" fill={T.muted}>{centerLabel}</text>
        <text x="95" y="114" textAnchor="middle" fontSize="22" fontWeight="800" fill={T.text}>{centerValue}</text>
      </svg>
    </Box>
  );
};

/** One clickable line beside the donut: coloured dot, "11 delayed orders", note, share. */
export const SplitRow = ({ color, title, sub, share, active, onClick, big }) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      justifyContent: 'flex-start', alignItems: 'flex-start', gap: 1, px: 0.75, py: 0.5, borderRadius: '10px', textAlign: 'left',
      bgcolor: active ? T.brand50 : 'transparent', '&:hover': { bgcolor: active ? T.brand50 : T.surface2 },
    }}
  >
    <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: alpha(color, 0.14), display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />
    </Box>
    <Box>
      <Typography sx={{ fontSize: big ? 17 : 13, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{title}</Typography>
      <Typography sx={{ fontSize: big ? 12 : 10.5, color: T.muted }}>{sub}</Typography>
      <Typography sx={{ fontSize: big ? 12 : 10.5, fontWeight: 700, color }}>{share}</Typography>
    </Box>
  </ButtonBase>
);

export const Insights = ({ lines, big }) => (
  <Box sx={{ bgcolor: INSIGHT_BG, borderRadius: '12px', px: 1.25, py: 1 }}>
    <Typography sx={{ fontSize: big ? 14 : 12, fontWeight: 700, color: T.text, mb: 0.25 }}>Insights</Typography>
    {lines.map((line) => (
      <Typography key={line} sx={{ fontSize: big ? 14 : 11.5, color: T.text2, lineHeight: 1.55 }}>{`# ${line}`}</Typography>
    ))}
  </Box>
);

/**
 * Vertical bars with a coloured tag under each, biggest first. Clicking a bar
 * filters the page; the selected one's tag turns dark.
 */
export const Bars = ({ bars, colors, height = 330, selected, onSelect, format = fmtNum, emptyText }) => {
  if (!bars.length) {
    return (
      <Box sx={{ height, display: 'grid', placeItems: 'center', px: 2 }}>
        <Typography sx={{ fontSize: 13, color: T.muted, textAlign: 'center', lineHeight: 1.6 }}>{emptyText}</Typography>
      </Box>
    );
  }
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <Box
      sx={{
        height, display: 'grid', gap: 1.5, alignItems: 'end', justifyContent: 'center',
        gridTemplateColumns: `repeat(${bars.length}, minmax(0, 120px))`,
      }}
    >
      {bars.map((b, i) => {
        const col = colors[i % colors.length];
        const on = selected === b.key;
        return (
          <ButtonBase
            key={b.key}
            title={`${b.name}: ${b.note || format(b.value)}`}
            onClick={() => onSelect?.(b.key)}
            sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 0, '&:hover .bar-col': { opacity: 0.85 } }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.text }}>{format(b.value)}</Typography>
            <Box sx={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', minHeight: 0 }}>
              <Box
                className="bar-col"
                sx={{
                  width: '72%', maxWidth: 86, height: `${Math.max(6, Math.round((b.value / max) * 100))}%`,
                  borderRadius: '10px 10px 4px 4px', background: `linear-gradient(180deg, ${col}, ${col}aa)`, transition: 'opacity .15s',
                }}
              />
            </Box>
            <Box
              component="span"
              sx={{
                maxWidth: '100%', overflow: 'hidden', textAlign: 'center', lineHeight: 1.25,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', // long names wrap to two lines
                fontSize: 11, fontWeight: 700, px: 1.1, py: '3px', borderRadius: '10px',
                bgcolor: on ? T.ink : `${col}26`, color: on ? '#fff' : col,
              }}
            >
              {b.name}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
};

/** Quick Overview number box (Total / Completed / Delayed / Cancelled). */
export const StatBox = ({ label, value, bg, active, onClick, big }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', px: 1, py: 0.75, borderRadius: '12px',
      bgcolor: bg, border: '1px solid', borderColor: active ? T.pick : 'transparent', '&:hover': { filter: 'brightness(.98)' },
    }}
  >
    <Typography sx={{ fontSize: 10.5, color: T.text2, fontWeight: 600 }}>{label}</Typography>
    <Typography sx={{ fontSize: big ? 24 : 16, fontWeight: 800, color: T.text }}>{fmtNum(value)}</Typography>
  </ButtonBase>
);

/** A Quick Overview line: date, owner, name over step, status dot. */
export const OverviewItem = ({ date, person, title, sub, overdue, done, onClick, big }) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      display: 'grid', gridTemplateColumns: 'auto 24px minmax(0,1fr) auto', alignItems: 'center', gap: 1,
      px: 0.75, py: big ? 1.25 : 0.6, borderRadius: '10px', textAlign: 'left', '&:hover': { bgcolor: T.surface2 },
    }}
  >
    <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: T.text2, minWidth: 46 }}>{date}</Typography>
    <PersonAvatar name={person} />
    <Box sx={{ minWidth: 0 }}>
      <Typography noWrap sx={{ fontSize: big ? 15 : 12, fontWeight: 600, color: T.text }}>{title}</Typography>
      <Typography noWrap sx={{ fontSize: big ? 12 : 10.5, color: T.muted }}>{sub}</Typography>
    </Box>
    <Box
      sx={{
        width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff',
        bgcolor: done ? '#3fbf7f' : overdue ? '#f0646f' : '#4a90e2',
      }}
    >
      {done ? <CircleCheck size={12} /> : overdue ? <Clock size={12} /> : <Activity size={12} />}
    </Box>
  </ButtonBase>
);
