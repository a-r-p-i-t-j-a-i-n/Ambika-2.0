import React, { useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Popover, Box } from '@mui/material';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { PFMS } from '../pfmsTheme';

/**
 * Single-row adaptive filter toolbar shared by the Purchase FMS list screens.
 *
 *   <AdaptiveFilterBar
 *     pinned={[{ key: 'search', minWidth: 220, node: <Box sx={{ flex: '1 1 220px' }}>…</Box> }, …]}
 *     items={[{ key: 'vendor', width: 200, active: Boolean(vendor), node: <Box sx={{ flex: '0 1 200px', minWidth: 180 }}>…</Box> }, …]}
 *     onClearSecondary={clearSecondary}
 *     onClearAll={clearAll}
 *     anyActive={anyFilterActive}
 *   />
 *
 * `pinned` fields never leave the row; `items` stay inline in order while they
 * fit and the rest move into the "More" panel. Every width the layout depends
 * on is declared (item widths, pinned floors, fixed-width trigger and Clear
 * all), so the fit is decided from the measured row width alone — nothing can
 * end up clipped behind the row's edge.
 *
 * Layout only: each screen still owns every filter's state, so a field moving
 * between the row and the panel (a remount) keeps its value.
 */

const GAP = 10; // the row's gap: 1.25
const TRIGGER_FULL = 96;
const TRIGGER_COMPACT = 40;
const CLEAR_ALL_WIDTH = 96;
// Pinned fields may shrink to this once no secondary filter is inline, so
// Search + the primary filter + the trigger still fit one row on a 360px
// phone — including Indents, whose row also carries the Columns button.
const PINNED_HARD_FLOOR = 90;

const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(Infinity);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
};

const sumWithGaps = (widths) => widths.reduce((s, w, i) => s + w + (i > 0 ? GAP : 0), 0);

const computeLayout = (rowWidth, pinned, items, anyActive) => {
  const comfortFloor = sumWithGaps(pinned.map((p) => p.minWidth));
  const hardFloor = sumWithGaps(pinned.map((p) => Math.min(p.minWidth, PINNED_HARD_FLOOR)));
  const itemsWidth = items.reduce((s, it) => s + GAP + it.width, 0);
  const clearWidth = anyActive ? GAP + CLEAR_ALL_WIDTH : 0;

  if (comfortFloor + itemsWidth + clearWidth <= rowWidth) {
    return { cut: items.length, trigger: null, clearInline: true };
  }

  const configs = [
    { trigger: 'full', clearInline: true },
    { trigger: 'compact', clearInline: true },
    { trigger: 'compact', clearInline: false },
  ];
  const triggerWidth = (t) => (t === 'full' ? TRIGGER_FULL : TRIGGER_COMPACT);
  // The labelled trigger only when the pinned fields keep their comfortable
  // widths; on a phone, Search gets the space and the trigger goes icon-only.
  const floorFor = (t) => (t === 'full' ? comfortFloor : hardFloor);
  const chosen = configs.find(({ trigger, clearInline }) => (
    floorFor(trigger) + GAP + triggerWidth(trigger) + (clearInline ? clearWidth : 0) <= rowWidth
  )) || configs[configs.length - 1];

  const fixed = GAP + triggerWidth(chosen.trigger) + (chosen.clearInline ? clearWidth : 0);
  let budget = rowWidth - comfortFloor - fixed;
  let cut = 0;
  while (cut < items.length && budget >= GAP + items[cut].width) {
    budget -= GAP + items[cut].width;
    cut += 1;
  }
  // A trigger with nothing behind it would only be hosting Clear all.
  if (cut === items.length && cut > 0) cut -= 1;
  return { cut, ...chosen };
};

const OverflowPanel = ({ overflowItems, compact, headerAction }) => {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);
  // Counts only what is hidden right now, so it never double-counts a field a
  // resize has already brought back inline.
  const hiddenActive = overflowItems.filter((it) => it.active).length;

  return (
    <>
      <Badge
        badgeContent={hiddenActive}
        color="primary"
        invisible={!hiddenActive}
        data-testid="pfms-filter-more-badge"
        sx={{ flexShrink: 0, '& .MuiBadge-badge': { fontWeight: 700, fontSize: '0.62rem', minWidth: 16, height: 16 } }}
      >
        <Button
          variant="outlined"
          aria-label="More filters"
          aria-haspopup="dialog"
          aria-expanded={open || undefined}
          onClick={(e) => setAnchor(e.currentTarget)}
          endIcon={compact ? null : <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }} />}
          sx={{ height: 40, width: compact ? TRIGGER_COMPACT : TRIGGER_FULL, minWidth: 0, px: compact ? 0 : 1.5, whiteSpace: 'nowrap' }}
        >
          {compact ? <SlidersHorizontal size={16} /> : 'More'}
        </Button>
      </Badge>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, p: 1.5, width: { xs: 'calc(100vw - 32px)', sm: 280 }, borderRadius: '10px', border: `1px solid ${PFMS.line}` } } }}
      >
        {headerAction && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>{headerAction}</Box>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {overflowItems.map((it) => <Box key={it.key} sx={{ '& > *': { width: '100%' } }}>{it.node}</Box>)}
        </Box>
      </Popover>
    </>
  );
};

const AdaptiveFilterBar = ({ pinned = [], items = [], onClearSecondary, onClearAll, anyActive = false }) => {
  const [rowRef, rowWidth] = useWidth();
  const { cut, trigger, clearInline } = computeLayout(rowWidth, pinned, items, anyActive);
  const visible = items.slice(0, cut);
  const overflow = items.slice(cut);

  let headerAction = null;
  if (anyActive && !clearInline && onClearAll) {
    headerAction = (
      <Button size="small" startIcon={<X size={13} />} onClick={onClearAll} sx={{ fontSize: '0.72rem', minWidth: 0 }}>
        Clear all
      </Button>
    );
  } else if (items.some((it) => it.active) && onClearSecondary) {
    headerAction = (
      <Button size="small" startIcon={<X size={13} />} onClick={onClearSecondary} sx={{ fontSize: '0.72rem', minWidth: 0 }}>
        Clear
      </Button>
    );
  }

  return (
    <Box
      ref={rowRef}
      data-testid="pfms-filter-row"
      sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-end', gap: 1.25, minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}
    >
      {pinned.map((p) => React.cloneElement(p.node, {
        key: p.key,
        sx: { ...p.node.props.sx, minWidth: Math.min(p.minWidth, PINNED_HARD_FLOOR) },
      }))}
      {visible.map((it) => React.cloneElement(it.node, { key: it.key }))}
      {trigger && <OverflowPanel overflowItems={overflow} compact={trigger === 'compact'} headerAction={headerAction} />}
      {anyActive && clearInline && (
        <Button
          size="small"
          startIcon={<X size={14} />}
          onClick={onClearAll}
          sx={{ color: PFMS.sub, fontWeight: 600, flexShrink: 0, width: CLEAR_ALL_WIDTH, whiteSpace: 'nowrap', ml: 'auto' }}
        >
          Clear all
        </Button>
      )}
    </Box>
  );
};

export default AdaptiveFilterBar;
