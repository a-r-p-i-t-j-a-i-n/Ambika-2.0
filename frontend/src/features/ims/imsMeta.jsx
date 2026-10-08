import React from 'react';
import {
  Box, Stack, Typography, Chip, Paper, Tooltip, alpha, ButtonBase,
  TextField, InputAdornment, Popover, Checkbox, Button, Divider, IconButton,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, PackagePlus, PackageMinus, ShoppingCart, History, HelpCircle, ArrowLeft,
  Search, X, Plus, ArrowRight, CheckCircle2,
} from 'lucide-react';
import {
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, moveToken, txnLabel,
  num, inr, compactInr, imsTableSx, numCell, panelSx, hScrollSx, IMS_FORM_MAX,
} from './imsTheme';

// Re-export so screens import everything they need from one place.
export {
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, moveToken, txnLabel,
  num, inr, compactInr, imsTableSx, numCell, panelSx, hScrollSx, IMS_FORM_MAX,
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
// `meaning` lets an area explain the status in its own terms — Finished Goods
// produces rather than buys, so "raise a purchase order" would misdirect there.
// `label` does the same for the word on the chip ("Produce", not "Order now").
// Both default to the shared token every other area uses, so the colour, the
// threshold and the shape stay identical — only the wording is area-specific.
export const StatusChip = ({ status, size = 'small', withHint = true, meaning, label }) => {
  const t = stockToken(status);
  const chip = (
    <Chip
      size={size}
      label={label || t.label}
      sx={{
        height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
  if (!withHint) return chip;
  return <Tooltip arrow title={meaning || t.meaning} slotProps={O2D_TIP}><span>{chip}</span></Tooltip>;
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
//
// `text` is either a plain sentence or a structured entry from imsFieldHelp.js:
//   { means, source, formula, matters, example }
// A structured entry renders as a few short labelled lines, because for a
// calculated field "what is this?" is really four questions — what it means,
// where the number came from, how it was worked out, and what it goes on to
// drive. A single run-on sentence answered none of them well.

const HELP_ROWS = [
  ['means', 'What it means'],
  ['source', 'Where it comes from'],
  ['formula', 'How it is worked out'],
  ['matters', 'Why it matters'],
  ['example', 'Example'],
];

/** Renders a structured help entry; passes a plain string straight through. */
export const HelpBody = ({ entry }) => {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return (
    <Box sx={{ display: 'grid', gap: 0.6 }}>
      {HELP_ROWS.map(([key, label]) => (entry[key] ? (
        <Box key={key}>
          <Typography
            component="div"
            sx={{
              fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: O2D.faint, lineHeight: 1.3,
            }}
          >
            {label}
          </Typography>
          {/* pre-line so an entry can use line breaks — the status ladder does. */}
          <Typography
            component="div"
            sx={{ fontSize: '0.72rem', fontWeight: 600, color: O2D.brand, lineHeight: 1.45, whiteSpace: 'pre-line' }}
          >
            {entry[key]}
          </Typography>
        </Box>
      ) : null))}
    </Box>
  );
};

// Structured entries need more room than a one-liner, so they widen the bubble.
const helpSlots = (entry) => (typeof entry === 'string' || !entry
  ? O2D_TIP
  : { ...O2D_TIP, tooltip: { sx: { ...O2D_TIP.tooltip.sx, maxWidth: 380 } } });

export const Help = ({ text, size = 12 }) => (!text ? null : (
  <Tooltip arrow title={<HelpBody entry={text} />} slotProps={helpSlots(text)}>
    <Box component="span" sx={{ display: 'inline-flex', ml: 0.4, color: O2D.faint, verticalAlign: 'middle', cursor: 'help' }}>
      <HelpCircle size={size} />
    </Box>
  </Tooltip>
));

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

// ── Which tab is lit ─────────────────────────────────────────────────────────
// A nav item matches a URL only on a SEGMENT boundary. A plain `startsWith` is
// wrong here because these areas all contain sibling routes where one path is a
// literal prefix of another:
//
//   /ims/stock      vs  /ims/stock-in, /ims/stock-out
//   /rm-ims/stock   vs  /rm-ims/stock-in, /rm-ims/stock-out
//
// "/ims/stock-out".startsWith("/ims/stock") is true, so Stock list lit up on the
// Stock Out screen alongside Stock Out. Requiring the next character to be a "/"
// makes "stock-out" a different route rather than a child of "stock".
const navMatches = (pathname, item) => (item.exact
  ? pathname === item.path
  : pathname === item.path || pathname.startsWith(`${item.path}/`));

// If several items still match — which is what happens the moment an area grows
// a genuinely nested route such as /ims/stock/archive — the longest, most
// specific path wins. Returning a single winning path rather than testing each
// tab independently is what makes "exactly one tab is active" structural: two
// tabs cannot both believe they are selected.
export const activeNavPath = (pathname, items = []) => {
  let best = null;
  for (const item of items) {
    if (!item?.path || !navMatches(pathname, item)) continue;
    if (!best || item.path.length > best.length) best = item.path;
  }
  return best;
};

// `accent` lets an inventory area keep its own identity colour on the active tab
// (Finished Goods runs emerald) without forking the component. Defaults to the
// O2D blue every other area already uses.
export const ImsNav = ({ items = IMS_NAV, accent = O2D.brand }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const NAV = items;
  const current = activeNavPath(pathname, NAV);
  return (
    <Box sx={{
      display: 'flex', gap: 0.5, px: { xs: 1, md: 1.5 }, bgcolor: O2D.surfaceAlt,
      borderBottom: `1px solid ${O2D.line}`, overflowX: 'auto',
      '&::-webkit-scrollbar': { height: 0 },
    }}>
      {NAV.map((n) => {
        const active = n.path === current;
        const Icon = n.icon;
        return (
          <ButtonBase
            key={n.path}
            onClick={() => navigate(n.path)}
            sx={{
              px: 1.25, py: 0.9, gap: 0.6, flexShrink: 0, borderRadius: 0,
              fontSize: '0.75rem', fontWeight: active ? 800 : 600,
              color: active ? accent : O2D.sub,
              borderBottom: `2px solid ${active ? accent : 'transparent'}`,
              '&:hover': { color: O2D.ink, bgcolor: alpha(accent, 0.04) },
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
// `accent` is the area's identity colour — it tints the header icon and the
// active nav tab only. Everything that encodes STATE still reads from the shared
// STOCK_TOKENS, so a colour never means two different things across the areas.
export const ImsShell = ({ icon: Icon, title, subtitle, actions, children, nav = true, navItems, maxWidth, onBack, backLabel = 'Back', accent = O2D.brand }) => (
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
            flexShrink: 0, bgcolor: alpha(accent, 0.1), color: accent,
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
      {nav && <ImsNav items={navItems} accent={accent} />}
    </Box>
    {/* `minWidth: 0` on the column AND on every direct child. Without it a flex
        item sizes to its widest content, so a wide table would push the whole
        page sideways instead of scrolling inside its own panel.

        The gutter steps up at `lg` so that once `maxWidth` stops binding — on a
        laptop, or with the sidebar expanded — the page still has a deliberate
        margin instead of the panels running into the viewport edge.

        `pb` only has to clear the sticky confirm bar, which is in flow and so
        already occupies its own height. It was reserving a second bar's worth of
        empty canvas underneath it. */}
    <Box sx={{
      px: { xs: 1.25, md: 1.75, lg: 2.5 }, py: 1.25, pb: 3,
      display: 'flex', flexDirection: 'column', gap: 1.25,
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

// ── Numbered step header ─────────────────────────────────────────────────────
// Forms that read as 1 → 2 → 3 are the single biggest legibility win for a
// first-time user. Shared by every multi-line entry screen (Stock In, Stock Out,
// Production In, Dispatch Out) so a form is filled the same way in every area.
// `accent` carries the area's identity colour on the not-yet-done state; a
// completed step is always the shared OK green.
export const StepHead = ({ n, title, hint, done, accent = O2D.brand }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box sx={{
      width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
      fontSize: '0.7rem', fontWeight: 800,
      bgcolor: done ? STOCK_TOKENS.OK.bg : alpha(accent, 0.1),
      color: done ? STOCK_TOKENS.OK.color : accent,
      border: `1px solid ${done ? STOCK_TOKENS.OK.border : alpha(accent, 0.25)}`,
    }}>{n}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.25 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{hint}</Typography>}
    </Box>
  </Stack>
);

// ── Section label ────────────────────────────────────────────────────────────
export const Eyebrow = ({ children }) => (
  <Typography sx={{
    fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.07em', color: O2D.faint,
  }}>{children}</Typography>
);

// ── Empty state ──────────────────────────────────────────────────────────────
// `dense` is for an empty state sitting INSIDE a transaction table, where the
// table should grow with its rows rather than reserve a screenful of nothing
// before the first item is picked. The roomy default stays for a page-level
// empty state, which is the whole content of the screen.
export const EmptyNote = ({ icon: Icon, title, hint, tone = O2D.sub, dense }) => (
  <Stack alignItems="center" spacing={dense ? 0.25 : 0.75}
    sx={{ py: dense ? 1.25 : 5, px: 2, textAlign: 'center' }}>
    {Icon && <Box sx={{ color: alpha(tone, 0.5), display: 'flex' }}><Icon size={dense ? 18 : 26} /></Box>}
    <Typography sx={{ fontSize: dense ? '0.78rem' : '0.85rem', fontWeight: 700, color: tone, lineHeight: 1.35 }}>{title}</Typography>
    {hint && <Typography sx={{ fontSize: dense ? '0.68rem' : '0.72rem', color: O2D.faint, maxWidth: 420, lineHeight: 1.35 }}>{hint}</Typography>}
  </Stack>
);

// The cell an in-table empty state sits in. MUI gives every TableCell its own
// padding, which stacks on top of EmptyNote's and is the real reason an empty
// transaction table reads as a tall blank band. Zeroing it here means the empty
// state's own padding is the only padding, and every screen gets it the same way.
export const emptyCellSx = { border: 0, p: 0 };

// ── Status legend ────────────────────────────────────────────────────────────
// Spelled out once per screen so the colour code never needs decoding.
// `labels` / `meanings` are optional per-area overrides keyed by status, for an
// area whose action differs (Finished Goods produces where consumables buy).
// `allLabel` names the unfiltered pill. Colours are never overridable.
export const StatusLegend = ({ counts, value, onPick, labels, meanings, allLabel = 'All' }) => (
  <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap alignItems="center">
    <Chip
      size="small" clickable={!!onPick} onClick={onPick ? () => onPick('ALL') : undefined}
      label={`${allLabel}${counts ? ` (${counts.ALL ?? 0})` : ''}`}
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
        <Tooltip key={k} arrow title={meanings?.[k] || t.meaning} slotProps={O2D_TIP}>
          <Chip
            size="small" clickable={!!onPick} onClick={onPick ? () => onPick(k) : undefined}
            label={`${labels?.[k] || t.label}${counts ? ` (${counts[k] ?? 0})` : ''}`}
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

// ── Multi-select item picker ────────────────────────────────────────────────
// Shared by Stock In, Stock Out, Production In and Dispatch Out so every
// transaction screen picks items the same way: search -> tick several ->
// "Add selected" -> rows appear in the table below.
//
// It deliberately adds rows with NO quantity. Picking an item and saying how
// much of it moved are two different decisions, and guessing the second one is
// how you get a silent wrong stock posting. The caller's own addItem shape is
// reused verbatim, so every downstream calculation, limit and payload is
// untouched — this is a selection-workflow change only.
//
// Each option reads code → name → unit + availability, top to bottom, because
// the code is what an operator matches against the paperwork in their hand.
//
// Keyboard: ArrowUp/ArrowDown move, Home/End jump, Enter ticks the highlighted
// row, Ctrl/Cmd+Enter adds everything ticked, Esc closes.
//
// @param options   every candidate item (already-added ones included, so the
//                  user can see they are already on the list)
// @param addedIds  Set/array of skuIds already in the table — shown greyed out
//                  with an "Added" tag and never selectable
// @param onAdd     called once with the array of chosen items
// @param accent    the area's identity colour for the primary action
/**
 * A fresh id for one submission of an entry form.
 *
 * Sent with Stock In / Stock Out / Production In / Dispatch Out as
 * `clientRequestId`. The backend claims it once, so a double-click, a browser
 * retry or a resubmitted tab is recognised as the same entry instead of moving
 * stock a second time. A form mints one id, keeps it until the entry is
 * accepted, and mints the next one after — a corrected retry after a failure
 * deliberately reuses the id, which the backend released when it failed.
 */
export const newRequestId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The picker's own tooltip config — the shared O2D_TIP plus a popper that can
 * never intercept a pointer.
 *
 * The item rows sit directly above the "Add selected" button. MUI tooltips are
 * INTERACTIVE by default, which keeps the popper mounted and pointer-aware so a
 * user can hover into it; over a button that means the popper lingers after the
 * cursor leaves the row and swallows the click. `disableInteractive` on the
 * Tooltip removes the grace period, and `pointerEvents: 'none'` here guarantees
 * that even mid-fade the layer is transparent to clicks.
 *
 * Deliberately local: O2D_TIP is shared with every other module, and this is a
 * property of the picker's cramped layout, not of tooltips in general.
 */
const PICKER_TIP = {
  ...O2D_TIP,
  popper: {
    ...(O2D_TIP.popper || {}),
    sx: { ...(O2D_TIP.popper?.sx || {}), pointerEvents: 'none' },
  },
};

export const ItemMultiPicker = ({
  options = [],
  addedIds = [],
  onAdd,
  label = 'Add items',
  placeholder = 'Search item by code or name...',
  emptyHint = 'No items match that search.',
  accent = O2D.brand,
}) => {
  const anchorRef = React.useRef(null);
  const listRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [selected, setSelected] = React.useState(() => new Set());
  const added = React.useMemo(() => new Set([...addedIds].map(String)), [addedIds]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.skuCode} ${o.skuName}`.toLowerCase().includes(q));
  }, [options, query]);

  // "Select all" acts on what is on screen right now, and never on rows the
  // table already holds.
  const selectableFiltered = React.useMemo(
    () => filtered.filter((o) => !added.has(String(o.skuId))), [filtered, added],
  );
  const allFilteredSelected = selectableFiltered.length > 0
    && selectableFiltered.every((o) => selected.has(o.skuId));

  const toggle = (skuId) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(skuId)) next.delete(skuId); else next.add(skuId);
    return next;
  });
  const toggleAllFiltered = () => setSelected((prev) => {
    const next = new Set(prev);
    // Only the filtered rows change; anything ticked under a previous search
    // stays ticked, which is what makes searching mid-selection safe.
    if (allFilteredSelected) selectableFiltered.forEach((o) => next.delete(o.skuId));
    else selectableFiltered.forEach((o) => next.add(o.skuId));
    return next;
  });

  const reset = () => { setSelected(new Set()); setQuery(''); setActive(0); setOpen(false); };
  const commit = () => {
    const chosen = options.filter((o) => selected.has(o.skuId) && !added.has(String(o.skuId)));
    if (chosen.length && onAdd) onAdd(chosen);
    reset();
  };

  const count = selected.size;

  // The highlight always points at a row that exists — a new search resets it
  // to the top rather than leaving it off the end of a now-shorter list.
  React.useEffect(() => { setActive(0); }, [query, open]);
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active, open, filtered.length]);

  // Typing stays typing. Only the navigation keys are intercepted, so the
  // search box never swallows a character the user meant to search with.
  const onSearchKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (count) commit(); return; }
    if (!filtered.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(filtered.length - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o && !added.has(String(o.skuId))) toggle(o.skuId);
    }
  };

  return (
    <>
      <Box ref={anchorRef}>
        <TextField
          fullWidth size="small" label={label} placeholder={placeholder}
          value="" onChange={() => {}} onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
          inputProps={{ readOnly: true, 'aria-haspopup': 'listbox' }}
          sx={{ mt: 1.25, '& .MuiInputBase-root': { cursor: 'pointer' }, '& input': { cursor: 'pointer' } }}
          InputProps={{
            readOnly: true,
            startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment>,
          }}
        />
      </Box>

      <Popover
        open={open} anchorEl={anchorRef.current} onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              // Matches the trigger on desktop. minWidth stops a narrow anchor from
              // producing a panel too cramped to read a SKU in; maxWidth keeps it
              // inside the viewport on a phone so it can't push the page sideways.
              width: anchorRef.current ? anchorRef.current.offsetWidth : 360,
              minWidth: 'min(300px, calc(100vw - 24px))',
              maxWidth: 'calc(100vw - 24px)',
              mt: 0.5, borderRadius: '10px', border: `1px solid ${O2D.line}`,
              boxShadow: '0 8px 28px rgba(15,23,42,0.12)',
            },
          },
        }}
      >
        <Box sx={{ p: 1.25, pb: 0.75 }}>
          <TextField
            autoFocus fullWidth size="small" value={query} placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            inputProps={{
              'aria-label': placeholder, role: 'combobox', 'aria-expanded': true,
              'aria-controls': 'ims-item-picker-list', 'aria-activedescendant': `ims-item-opt-${active}`,
            }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment>,
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
        </Box>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.5 }}>
          <Button size="small" onClick={toggleAllFiltered} disabled={!selectableFiltered.length}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', minWidth: 0, px: 0.75, color: accent }}>
            {allFilteredSelected ? 'Deselect all' : 'Select all'}{query.trim() ? ' shown' : ''}
          </Button>
          <Typography sx={{ ml: 'auto', fontSize: '0.72rem', fontWeight: 700, color: count ? accent : O2D.sub }}>
            {count} item{count === 1 ? '' : 's'} selected
          </Typography>
        </Stack>
        <Divider sx={{ borderColor: O2D.lineSoft }} />

        <Box ref={listRef} id="ims-item-picker-list" role="listbox" aria-multiselectable="true"
          sx={{ maxHeight: 300, overflowY: 'auto', py: 0.5 }}>
          {!filtered.length && (
            <Typography sx={{ px: 1.5, py: 2, fontSize: '0.76rem', color: O2D.sub, textAlign: 'center' }}>
              {emptyHint}
            </Typography>
          )}
          {filtered.map((o, i) => {
            const isAdded = added.has(String(o.skuId));
            const checked = selected.has(o.skuId);
            const isActive = i === active;
            return (
              <Box
                key={o.skuId}
                id={`ims-item-opt-${i}`} data-idx={i}
                role="option" aria-selected={checked} aria-disabled={isAdded}
                onMouseEnter={() => setActive(i)}
                onClick={() => !isAdded && toggle(o.skuId)}
                sx={{
                  display: 'flex', alignItems: 'flex-start', gap: 0.5, px: 0.75, py: 0.4,
                  cursor: isAdded ? 'default' : 'pointer',
                  opacity: isAdded ? 0.5 : 1,
                  bgcolor: isActive && !isAdded ? alpha(accent, 0.07) : 'transparent',
                  borderLeft: `2px solid ${isActive && !isAdded ? accent : 'transparent'}`,
                }}
              >
                <Checkbox size="small" checked={checked} disabled={isAdded} tabIndex={-1} disableRipple
                  inputProps={{ 'aria-label': o.skuName }} sx={{ p: 0.5 }} />
                <Box sx={{ minWidth: 0, flex: 1, py: 0.15 }}>
                  {/* Code first — it is what the operator matches against the
                      paperwork in their hand — then the name, then the unit the
                      SKU master holds and what is actually on the shelf. */}
                  <Typography noWrap sx={{
                    fontSize: '0.74rem', fontWeight: 800, color: accent, lineHeight: 1.3,
                    fontFamily: 'ui-monospace, monospace',
                  }}>{o.skuCode}</Typography>
                  {/* disableInteractive + the non-interactive popper above: the
                      row sits directly over "Add selected", and an interactive
                      tooltip lingers there and eats the click. */}
                  <Tooltip arrow disableInteractive slotProps={PICKER_TIP} title={`${o.skuName} · ${o.skuCode}`}>
                    <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink, lineHeight: 1.3 }}>{o.skuName}</Typography>
                  </Tooltip>
                  <Typography noWrap sx={{ fontSize: '0.68rem', color: O2D.sub, lineHeight: 1.3 }}>
                    {o.unit || '—'} · {num(o.onHand)} available
                  </Typography>
                </Box>
                {isAdded && (
                  <Chip size="small" label="Added" sx={{ height: 18, mt: 0.5, fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, bgcolor: O2D.surfaceAlt }} />
                )}
              </Box>
            );
          })}
        </Box>

        <Divider sx={{ borderColor: O2D.lineSoft }} />
        <Stack direction="row" spacing={1} sx={{ p: 1 }}>
          <Button size="small" onClick={reset} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>
            Cancel
          </Button>
          <Button size="small" fullWidth variant="contained" disableElevation disabled={!count} onClick={commit}
            startIcon={<Plus size={14} />}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: accent }}>
            Add selected{count ? ` (${count})` : ''}
          </Button>
        </Stack>
      </Popover>
    </>
  );
};

// ── Multi-select item picker ends ───────────────────────────────────────────

// ── Transaction-entry primitives ────────────────────────────────────────────
// Everything below is shared by the multi-line entry screens — Stock In, Stock
// Out, Production In and Dispatch Out — so a transaction is entered, summarised
// and confirmed the same way in every inventory area. Only the wording changes.

// A summary pill for the confirm bar. `tone` takes a STOCK_TOKENS entry so a
// colour keeps meaning exactly what it means everywhere else.
export const SummaryChip = ({ label, tone }) => (
  <Chip
    size="small" label={label}
    sx={{
      height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
      bgcolor: tone ? tone.bg : O2D.surfaceAlt,
      border: `1px solid ${tone ? tone.border : O2D.line}`,
      color: tone ? tone.color : O2D.body,
    }}
  />
);

// ── The transaction quantity input ───────────────────────────────────────────
// The one number the whole screen exists to capture, so it is deliberately the
// heaviest control in the row: larger type, bold, right-aligned on tabular
// numerals, with the SKU's own unit pinned inside the field. The unit is shown,
// never typed — it comes from the SKU master.
//
// It stays a plain controlled number input: same `value`/`onChange` contract,
// same `min: 0`, no coercion and no auto-fill. Nothing about validation or the
// payload changes — this is type and spacing only.
export const QtyField = ({
  value, onChange, unit, error, autoFocus, placeholder = '0',
  width = 92, accent = O2D.brand, ariaLabel, inputRef,
}) => (
  <TextField
    size="small" type="number" value={value} onChange={onChange} error={!!error}
    autoFocus={autoFocus} placeholder={placeholder} inputRef={inputRef}
    inputProps={{
      min: 0, step: 'any', 'aria-label': ariaLabel,
      style: {
        textAlign: 'right', width, fontWeight: 800, fontSize: '0.95rem',
        fontVariantNumeric: 'tabular-nums', paddingTop: 7, paddingBottom: 7,
      },
    }}
    InputProps={{
      endAdornment: unit ? (
        <InputAdornment position="end" sx={{ ml: 0.35 }}>
          <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: O2D.faint, letterSpacing: '0.02em' }}>
            {unit}
          </Typography>
        </InputAdornment>
      ) : null,
    }}
    sx={{
      '& .MuiOutlinedInput-root': { bgcolor: O2D.surface },
      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
        borderColor: error ? undefined : accent, borderWidth: 2,
      },
    }}
  />
);

// ── Before → after, in one glance ────────────────────────────────────────────
// The whole point of the quantity column is what it does to the balance, so the
// balance is shown as a movement rather than a bare figure. Purely a rendering
// of numbers the caller has already worked out — it computes nothing itself.
export const BalanceDelta = ({ from, to, tone = STOCK_TOKENS.OK, unit, title }) => {
  const body = (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end"
      sx={{ cursor: title ? 'help' : 'default' }}>
      <Typography sx={{ fontSize: '0.75rem', color: O2D.faint, fontVariantNumeric: 'tabular-nums' }}>{num(from)}</Typography>
      <ArrowRight size={12} color={O2D.faint} />
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: tone.color, fontVariantNumeric: 'tabular-nums' }}>
        {num(to)}
      </Typography>
      {unit && <Typography sx={{ fontSize: '0.64rem', color: O2D.faint }}>{unit}</Typography>}
    </Stack>
  );
  return title ? <Tooltip arrow slotProps={O2D_TIP} title={title}><span>{body}</span></Tooltip> : body;
};

// ── The sticky confirm bar ───────────────────────────────────────────────────
// Always the last thing on a transaction screen, always in reach: the step
// heading on the left, the running summary and the one primary action on the
// right. It turns green only when the entry is actually saveable, so the colour
// is a readiness signal rather than decoration.
//
// `extra` holds any per-screen control that belongs beside the heading (the
// "allow negative" switch, for instance). `children` is the right-hand cluster.
export const ConfirmBar = ({
  n = 3, title = 'Confirm and save', hint, done, accent = O2D.brand, extra, children,
}) => (
  <Paper elevation={0} sx={{
    position: 'sticky', bottom: 10, zIndex: 4, borderRadius: '8px', px: 1.5, py: 0.85,
    border: `1px solid ${done ? STOCK_TOKENS.OK.border : O2D.line}`,
    bgcolor: done ? STOCK_TOKENS.OK.tint : O2D.surface,
    boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
  }}>
    {/* One row on desktop: step heading, any per-screen control, then the
        summary and the single primary action. It only wraps when the viewport
        genuinely cannot hold them side by side. */}
    <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
      <StepHead n={n} title={title} hint={hint} done={done} accent={accent} />
      <Box sx={{ mr: 'auto' }}>{extra}</Box>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
        {children}
      </Stack>
    </Stack>
  </Paper>
);

// ── Post-save confirmation ───────────────────────────────────────────────────
// A saved entry clears the form, which on its own looks indistinguishable from
// a form that never submitted. This says plainly what was posted, in the same
// terms the screen used, and offers the one or two places a user actually goes
// next — nothing more, so it never becomes a second navigation menu.
export const SuccessNote = ({ title, detail, actions, onDismiss }) => (
  <Paper elevation={0} sx={{
    borderRadius: '8px', px: 1.5, py: 1.1,
    border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
  }}>
    <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
      <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><CheckCircle2 size={18} /></Box>
      <Box sx={{ minWidth: 0, mr: 'auto' }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>{title}</Typography>
        {detail && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{detail}</Typography>}
      </Box>
      {actions}
      {onDismiss && (
        <Tooltip arrow slotProps={O2D_TIP} title="Dismiss">
          <IconButton size="small" onClick={onDismiss} aria-label="Dismiss" sx={{ color: O2D.faint }}>
            <X size={14} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  </Paper>
);

// ── Screen intro note ────────────────────────────────────────────────────────
// The "what this screen does and does not do" strip every transaction screen
// opens with, so the rule is stated once, in the same place, in every area.
export const IntroNote = ({ children, accent = O2D.brand, icon: Icon = HelpCircle }) => (
  <Paper elevation={0} sx={{
    borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt,
  }}>
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Box sx={{ color: accent, display: 'flex', pt: 0.15 }}><Icon size={15} /></Box>
      <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>{children}</Typography>
    </Stack>
  </Paper>
);

export default ImsShell;
