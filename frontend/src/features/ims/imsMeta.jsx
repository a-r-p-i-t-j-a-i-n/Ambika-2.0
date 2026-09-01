import React from 'react';
import { Box, Stack, Typography, Chip, Paper, Tooltip, alpha, ButtonBase } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, PackagePlus, PackageMinus, ShoppingCart, History, HelpCircle, ArrowLeft,
} from 'lucide-react';
import {
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, moveToken, txnLabel,
  num, inr, compactInr, imsTableSx, numCell, panelSx, hScrollSx,
} from './imsTheme';

// Re-export so screens import everything they need from one place.
export {
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, moveToken, txnLabel,
  num, inr, compactInr, imsTableSx, numCell, panelSx, hScrollSx,
};

// Legacy shape kept for the RM-IMS / FG-IMS screens, which import
// `STATUS_META` and expect `{ color, label }`. It now reads from the same
// tokens, so a chip means the same thing in every inventory area.
export const STATUS_META = Object.fromEntries(
  Object.entries(STOCK_TOKENS).map(([k, v]) => [k, { color: v.color, label: v.label }]),
);

// ── Status pill ──────────────────────────────────────────────────────────────
// The O2D pill: tinted background, matching border, 999px radius. Hovering
// explains what the status actually means in plain English.
export const StatusChip = ({ status, size = 'small', withHint = true }) => {
  const t = stockToken(status);
  const chip = (
    <Chip
      size={size}
      label={t.label}
      sx={{
        height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
  if (!withHint) return chip;
  return <Tooltip arrow title={t.meaning} slotProps={O2D_TIP}><span>{chip}</span></Tooltip>;
};

// ── Movement direction pill ──────────────────────────────────────────────────
export const MoveChip = ({ movementType, txnType }) => {
  const t = moveToken(movementType);
  return (
    <Chip
      size="small" label={txnLabel(txnType) || t.label}
      sx={{
        height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
};

// ── Small help affordance ────────────────────────────────────────────────────
// A quiet "?" next to a jargon word. The client should never have to ask what a
// column means — the answer is one hover away.
export const Help = ({ text, size = 12 }) => (
  <Tooltip arrow title={text} slotProps={O2D_TIP}>
    <Box component="span" sx={{ display: 'inline-flex', ml: 0.4, color: O2D.faint, verticalAlign: 'middle', cursor: 'help' }}>
      <HelpCircle size={size} />
    </Box>
  </Tooltip>
);

// A table header cell label with an attached explanation.
export const Th = ({ label, hint }) => (hint
  ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>{label}<Help text={hint} /></Box>
  : label);

// ── The IMS sub-navigation ───────────────────────────────────────────────────
// Every screen of an inventory area, always visible, always in workflow order:
// see it → look it up → bring it in → send it out → buy more → check history.
// Clients stop hunting in the sidebar because the whole area is one strip away.
// The Raw-Material area passes its own list (it has an extra Conversion screen).
export const IMS_NAV = [
  { label: 'Overview',   short: 'Overview',  path: '/ims',           icon: LayoutDashboard, exact: true },
  { label: 'Stock list', short: 'Stock',     path: '/ims/stock',     icon: Boxes },
  { label: 'Stock In',   short: 'In',        path: '/ims/stock-in',  icon: PackagePlus },
  { label: 'Stock Out',  short: 'Out',       path: '/ims/stock-out', icon: PackageMinus },
  { label: 'Buying list', short: 'Buy',      path: '/ims/reorder',   icon: ShoppingCart },
  { label: 'History',    short: 'History',   path: '/ims/movements', icon: History },
];

export const ImsNav = ({ items = IMS_NAV }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const NAV = items;
  return (
    <Box sx={{
      display: 'flex', gap: 0.5, px: { xs: 1, md: 1.5 }, bgcolor: O2D.surfaceAlt,
      borderBottom: `1px solid ${O2D.line}`, overflowX: 'auto',
      '&::-webkit-scrollbar': { height: 0 },
    }}>
      {NAV.map((n) => {
        const active = n.exact ? pathname === n.path : pathname.startsWith(n.path);
        const Icon = n.icon;
        return (
          <ButtonBase
            key={n.path}
            onClick={() => navigate(n.path)}
            sx={{
              px: 1.25, py: 0.9, gap: 0.6, flexShrink: 0, borderRadius: 0,
              fontSize: '0.75rem', fontWeight: active ? 800 : 600,
              color: active ? O2D.brand : O2D.sub,
              borderBottom: `2px solid ${active ? O2D.brand : 'transparent'}`,
              '&:hover': { color: O2D.ink, bgcolor: alpha(O2D.brand, 0.04) },
            }}
          >
            <Icon size={14} />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{n.label}</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{n.short}</Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
};

// ── Page shell ───────────────────────────────────────────────────────────────
// Warm canvas + a flush white top bar + the sub-nav. Identical structure to the
// O2D screens, so moving between the order flow and inventory feels like one
// product rather than two.
export const ImsShell = ({ icon: Icon, title, subtitle, actions, children, nav = true, navItems, maxWidth, onBack, backLabel = 'Back' }) => (
  <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas }}>
    <Box sx={{ position: 'sticky', top: 0, zIndex: 6, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
      <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap
        sx={{ px: { xs: 1.5, md: 2 }, py: 1 }}>
        {onBack && (
          <Tooltip arrow title={backLabel} slotProps={O2D_TIP}>
            <ButtonBase onClick={onBack} sx={{
              width: 30, height: 30, borderRadius: '6px', flexShrink: 0, color: O2D.body,
              border: `1px solid ${O2D.line}`, '&:hover': { bgcolor: O2D.surfaceAlt },
            }}>
              <ArrowLeft size={15} />
            </ButtonBase>
          </Tooltip>
        )}
        {Icon && (
          <Box sx={{
            width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center',
            flexShrink: 0, bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand,
          }}>
            <Icon size={16} />
          </Box>
        )}
        <Box sx={{ minWidth: 0, mr: 'auto' }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>{title}</Typography>
          {subtitle && <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>{subtitle}</Typography>}
        </Box>
        {actions}
      </Stack>
      {nav && <ImsNav items={navItems} />}
    </Box>
    {/* `minWidth: 0` on the column AND on every direct child. Without it a flex
        item sizes to its widest content, so a wide table would push the whole
        page sideways instead of scrolling inside its own panel. */}
    <Box sx={{
      px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, display: 'flex', flexDirection: 'column', gap: 1.25,
      minWidth: 0, '& > *': { minWidth: 0 },
      ...(maxWidth ? { maxWidth, mx: 'auto', width: '100%' } : null),
    }}>
      {children}
    </Box>
  </Box>
);

// ── Panel ────────────────────────────────────────────────────────────────────
// A white card with an optional title row. `hint` puts the explanation right
// under the title instead of hiding it in a tooltip when it matters.
export const Panel = ({ title, hint, icon: Icon, actions, children, sx, bodySx, dense }) => (
  <Paper elevation={0} sx={{ ...panelSx, overflow: 'hidden', ...sx }}>
    {(title || actions) && (
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
        sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface }}>
        {Icon && <Box sx={{ display: 'flex', color: O2D.brand, flexShrink: 0 }}><Icon size={15} /></Box>}
        <Box sx={{ minWidth: 0, mr: 'auto' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.25 }}>{title}</Typography>
          {hint && <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{hint}</Typography>}
        </Box>
        {actions}
      </Stack>
    )}
    <Box sx={{ p: dense ? 0 : 1.5, minWidth: 0, ...bodySx }}>{children}</Box>
  </Paper>
);

// The standard wrapper for a wide table: scrolls horizontally inside the panel
// instead of stretching it. Use this everywhere a table has a minWidth.
export const TableScroll = ({ children, sx }) => (
  <Box sx={{ ...hScrollSx, ...sx }}>{children}</Box>
);

// ── KPI tile ─────────────────────────────────────────────────────────────────
// Reads top-to-bottom: what it is → the number → what to do about it. `onClick`
// makes the tile a filter shortcut, which is how most clients actually navigate.
export const KpiTile = ({ label, value, sub, color = O2D.brand, icon: Icon, onClick, active, tone }) => {
  const clickable = !!onClick;
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        ...panelSx, p: 1.25, flex: '1 1 160px', minWidth: 155,
        ...(tone ? { bgcolor: tone } : null),
        ...(active ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` } : null),
        ...(clickable ? {
          cursor: 'pointer', transition: 'border-color .15s, transform .15s',
          '&:hover': { borderColor: color, transform: 'translateY(-1px)' },
        } : null),
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        {Icon && (
          <Box sx={{
            width: 30, height: 30, borderRadius: '7px', display: 'grid', placeItems: 'center',
            flexShrink: 0, bgcolor: alpha(color, 0.12), color,
          }}>
            <Icon size={16} />
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{
            fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: O2D.sub,
          }}>{label}</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.15, color }}>{value}</Typography>
          {sub && <Typography noWrap sx={{ fontSize: '0.65rem', color: O2D.faint }}>{sub}</Typography>}
        </Box>
      </Stack>
    </Paper>
  );
};

// ── Section label ────────────────────────────────────────────────────────────
export const Eyebrow = ({ children }) => (
  <Typography sx={{
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.07em', color: O2D.faint,
  }}>{children}</Typography>
);

// ── Empty state ──────────────────────────────────────────────────────────────
export const EmptyNote = ({ icon: Icon, title, hint, tone = O2D.sub }) => (
  <Stack alignItems="center" spacing={0.75} sx={{ py: 5, px: 2, textAlign: 'center' }}>
    {Icon && <Box sx={{ color: alpha(tone, 0.5) }}><Icon size={26} /></Box>}
    <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: tone }}>{title}</Typography>
    {hint && <Typography sx={{ fontSize: '0.72rem', color: O2D.faint, maxWidth: 380 }}>{hint}</Typography>}
  </Stack>
);

// ── Status legend ────────────────────────────────────────────────────────────
// Spelled out once per screen so the colour code never needs decoding.
export const StatusLegend = ({ counts, value, onPick }) => (
  <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap alignItems="center">
    <Chip
      size="small" clickable={!!onPick} onClick={onPick ? () => onPick('ALL') : undefined}
      label={`All${counts ? ` (${counts.ALL ?? 0})` : ''}`}
      sx={{
        height: 24, fontWeight: 800, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: value === 'ALL' ? O2D.ink : O2D.surface, color: value === 'ALL' ? '#fff' : O2D.body,
        border: `1px solid ${value === 'ALL' ? O2D.ink : O2D.line}`,
      }}
    />
    {STOCK_ORDER.map((k) => {
      const t = STOCK_TOKENS[k];
      const on = value === k;
      return (
        <Tooltip key={k} arrow title={t.meaning} slotProps={O2D_TIP}>
          <Chip
            size="small" clickable={!!onPick} onClick={onPick ? () => onPick(k) : undefined}
            label={`${t.label}${counts ? ` (${counts[k] ?? 0})` : ''}`}
            sx={{
              height: 24, fontWeight: on ? 800 : 700, fontSize: '0.7rem', borderRadius: '999px',
              bgcolor: on ? t.color : t.bg, color: on ? '#fff' : t.color,
              border: `1px solid ${on ? t.color : t.border}`,
            }}
          />
        </Tooltip>
      );
    })}
  </Stack>
);

// ── Legacy gradient hero ─────────────────────────────────────────────────────
// Still used by the RM-IMS and FG-IMS screens, which have not been converted to
// the warm O2D language yet. Left untouched so those screens keep working.
export const ImsHero = ({ icon: Icon, title, subtitle, action }) => (
  <Box sx={{
    color: '#fff', px: { xs: 2.5, md: 4 }, pt: { xs: 2.5, md: 3 }, pb: { xs: 3.5, md: 4.5 },
    background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
  }}>
    <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
      <Stack direction="row" spacing={1.75} alignItems="center">
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
          {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.82rem', mt: 0.25 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
      {action}
    </Stack>
  </Box>
);

export default ImsShell;
