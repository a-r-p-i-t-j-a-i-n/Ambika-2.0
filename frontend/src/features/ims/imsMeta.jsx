import React from 'react';
import {
  Box, Stack, Typography, Chip, Paper, Tooltip, alpha, ButtonBase,
  TextField, InputAdornment, Popover, Checkbox, Button, Divider, IconButton,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, PackagePlus, PackageMinus, ShoppingCart, History, HelpCircle, ArrowLeft,
  Search, X, Plus,
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
// ── Multi-select item picker ────────────────────────────────────────────────
// Shared by Stock In and Stock Out so both screens pick items the same way:
// search -> tick several -> "Add selected" -> rows appear in the table below.
//
// It deliberately adds rows with NO quantity. Picking an item and saying how
// much of it moved are two different decisions, and guessing the second one is
// how you get a silent wrong stock posting. The caller's own addItem shape is
// reused verbatim, so every downstream calculation, limit and payload is
// untouched — this is a selection-workflow change only.
//
// @param options   every candidate item (already-added ones included, so the
//                  user can see they are already on the list)
// @param addedIds  Set/array of skuIds already in the table — shown greyed out
//                  with an "Added" tag and never selectable
// @param onAdd     called once with the array of chosen items
export const ItemMultiPicker = ({
  options = [],
  addedIds = [],
  onAdd,
  label = 'Add items',
  placeholder = 'Search item by code or name...',
  emptyHint = 'No items match that search.',
}) => {
  const anchorRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
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

  const reset = () => { setSelected(new Set()); setQuery(''); setOpen(false); };
  const commit = () => {
    const chosen = options.filter((o) => selected.has(o.skuId) && !added.has(String(o.skuId)));
    if (chosen.length && onAdd) onAdd(chosen);
    reset();
  };

  const count = selected.size;

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
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', minWidth: 0, px: 0.75 }}>
            {allFilteredSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <Typography sx={{ ml: 'auto', fontSize: '0.72rem', fontWeight: 700, color: count ? O2D.brand : O2D.sub }}>
            {count} item{count === 1 ? '' : 's'} selected
          </Typography>
        </Stack>
        <Divider sx={{ borderColor: O2D.lineSoft }} />

        <Box sx={{ maxHeight: 280, overflowY: 'auto', py: 0.5 }}>
          {!filtered.length && (
            <Typography sx={{ px: 1.5, py: 2, fontSize: '0.76rem', color: O2D.sub, textAlign: 'center' }}>
              {emptyHint}
            </Typography>
          )}
          {filtered.map((o) => {
            const isAdded = added.has(String(o.skuId));
            const checked = selected.has(o.skuId);
            return (
              <Box
                key={o.skuId}
                role="option" aria-selected={checked} aria-disabled={isAdded}
                onClick={() => !isAdded && toggle(o.skuId)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.35,
                  cursor: isAdded ? 'default' : 'pointer',
                  opacity: isAdded ? 0.5 : 1,
                  '&:hover': isAdded ? null : { bgcolor: alpha(O2D.brand, 0.05) },
                }}
              >
                <Checkbox size="small" checked={checked} disabled={isAdded} tabIndex={-1} disableRipple
                  inputProps={{ 'aria-label': o.skuName }} sx={{ p: 0.5 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Tooltip arrow slotProps={O2D_TIP} title={`${o.skuName} · ${o.skuCode}`}>
                    <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                  </Tooltip>
                  <Typography noWrap sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                    {o.skuCode} · {num(o.onHand)} {o.unit} in store
                  </Typography>
                </Box>
                {isAdded && (
                  <Chip size="small" label="Added" sx={{ height: 18, fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, bgcolor: O2D.surfaceAlt }} />
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
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
            Add selected{count ? ` (${count})` : ''}
          </Button>
        </Stack>
      </Popover>
    </>
  );
};

// ── Multi-select item picker ends ───────────────────────────────────────────

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
