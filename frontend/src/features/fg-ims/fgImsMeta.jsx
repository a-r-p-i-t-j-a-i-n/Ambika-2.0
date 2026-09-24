import React from 'react';
import { LayoutDashboard, Boxes, Factory, Truck, ClipboardList, History } from 'lucide-react';
// Imported (not just re-exported) because the FG shell and status chip wrap them
// to carry finished-goods wording and the emerald identity accent.
import { ImsShell, StatusChip as ImsStatusChip } from '../ims/imsMeta';
import { useGetDprOptionsQuery } from '../../store/api/dprApi';

// The whole shared IMS toolkit, re-exported from one place so an FG screen
// imports exactly what a Consumables screen imports. There is deliberately no
// second set of FG layout primitives — same shell, same panel, same table
// recipe, same tiles, same empty state, same tooltip.
export {
  // layout
  Panel, TableScroll, KpiTile, EmptyNote, Eyebrow, ItemMultiPicker, StepHead, IntroNote,
  // transaction entry — the same primitives the Consumables screens use
  QtyField, BalanceDelta, ConfirmBar, SuccessNote, SummaryChip, newRequestId,
  // status + movement
  STOCK_TOKENS, STOCK_ORDER, moveToken, MoveChip, StatusLegend,
  // help + formatting
  Help, Th, num, inr, compactInr,
  // tokens / sx recipes
  O2D, O2D_TIP, imsTableSx, IMS_FORM_MAX, emptyCellSx,
} from '../ims/imsMeta';

// Movement transaction → human label. Deliberately the SHARED map, not a second
// FG-only copy: these are the same TXN_TYPE codes the ledger stores for every
// module, so "Opening stock" must not read as "Opening" here and "QC rejected"
// must not read as "QC reject". FG's own codes (PRODUCE_IN, SALES_RETURN_IN)
// live in that same map.
export { txnLabel } from '../ims/imsTheme';

// Finished-goods accent — emerald, to visually distinguish this IMS from the
// blue consumables/RM ones (finished = ready-to-sell). It tints the shell icon,
// the active nav tab and primary actions ONLY. Anything that encodes stock STATE
// uses the shared STOCK_TOKENS, so a colour never means two things.
export const FG_ACCENT = '#059669';
export const FG_ACCENT_DARK = '#047857';

// The FG sub-navigation, in workflow order: see it → look it up → make it →
// ship it → plan the next run → check history. Rendered by the shared ImsNav so
// every inventory area navigates the same way.
export const FG_NAV = [
  { label: 'Overview',      short: 'Overview', path: '/fg-ims',               icon: LayoutDashboard, exact: true },
  { label: 'Stock list',    short: 'Stock',    path: '/fg-ims/stock',         icon: Boxes },
  { label: 'Production In', short: 'In',       path: '/fg-ims/production-in', icon: Factory },
  { label: 'Dispatch Out',  short: 'Out',      path: '/fg-ims/dispatch-out',  icon: Truck },
  { label: 'Production Plan', short: 'Plan',   path: '/fg-ims/planning',      icon: ClipboardList },
  { label: 'History',       short: 'History',  path: '/fg-ims/movements',     icon: History },
];

// The FG page shell — the shared ImsShell carrying FG's own nav and accent, so
// every FG screen gets the identical header, nav strip, canvas and content
// rhythm the Consumables screens have. Screens pass only icon/title/subtitle.
export const FgShell = (props) => <ImsShell {...props} navItems={FG_NAV} accent={FG_ACCENT} />;

// What each stock status MEANS for a finished good. The thresholds, colours and
// labels are the shared ones, but the action is not: finished goods are produced,
// not bought, so the consumables copy ("raise a purchase order") would send a
// planner looking for a vendor that does not exist.
export const FG_STATUS_MEANING = {
  OK: 'Comfortably above the Reorder At level — no action needed.',
  LOW: 'Cover is thinning. Watch it — a production run is coming due.',
  REORDER: 'At or below the Reorder At level. Schedule a production run today.',
  OUT_OF_STOCK: 'Nothing on hand. Orders cannot be filled — produce urgently.',
  OVERSTOCK: 'Above the Max Level. Money is parked in finished stock — hold off producing.',
};

// The one label that differs from the shared set. Finished goods are MADE, so
// the REORDER state reads "Produce" rather than "Order now" — everywhere: the
// chip, the filter pill, the colour key and the CSV. The status CODE, its colour
// and its threshold are untouched; only the word a planner reads changes.
export const FG_STATUS_LABEL = { REORDER: 'Produce' };

// The shared chip — same colour and thresholds as every other IMS area —
// speaking finished-goods terms. Wrapped here so screens keep using
// <StatusChip status={...} /> unchanged.
export const StatusChip = (props) => (
  <ImsStatusChip
    {...props}
    label={FG_STATUS_LABEL[props.status]}
    meaning={FG_STATUS_MEANING[props.status]}
  />
);

// Plain-English definitions for the FG planning columns, mirroring the
// Consumables glossary. The wording describes what FINISHED GOODS actually do:
// Average Daily Demand is a PLANNED figure typed per season, NOT the ledger-measured
// Average Daily Consumption the consumables module calculates. The two are
// different business concepts and this copy must never blur them.
export const FG_GLOSSARY = [
  ['Available Qty', 'How many finished units are physically in the store right now.'],
  ['In Production (WIP)', 'Units on the line, expected to be completed and added to stock.'],
  ['Booked (Committed Orders)', 'Units already committed to confirmed customer orders, so not free to promise.'],
  ['Projected Available', 'Available Qty plus In Production, minus what is already Booked.'],
  ['Average Daily Demand', 'Units expected to be dispatched per day for the active season (Off-season / Normal / Peak). Set by hand in the planning policy — it is a plan, not a measured figure.'],
  ['Lead Time', 'Days it takes to produce a batch, from starting the run to stock being ready.'],
  ['Safety Factor', 'A cushion multiplier for demand spikes and production delays, set per item. 1.5 means we hold 50% extra.'],
  ['Reorder At', 'The trigger level. When stock drops to this, start a production run — Average Daily Demand × Lead Time. The Safety Factor does not enter here, so changing it never moves this number.'],
  ['Max Level', 'The ceiling. When we produce, we produce enough to reach this level — Average Daily Demand × Lead Time × Safety Factor. An "M" beside the figure means it was overridden by hand and ignores the formula.'],
  ['Production Quantity', 'How much to produce to bring stock back to the Max Level, allowing for what is already in production and booked.'],
];

// Seasonal demand modes (the finished-goods sheet's Low/Normal/Peak columns).
export const MODE_LABEL = { LOW: 'Off-season', NORMAL: 'Normal', PEAK: 'Peak' };
export const MODE_OPTIONS = [
  { value: 'LOW', label: 'Off-season' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'PEAK', label: 'Peak' },
];

// ── Shop-floor master data for the Daily Production Report ───────────────────
// Shift, Line/Machine and Supervisor are NOT new FG concepts — the PPC module
// already owns all three, and its DPR entry form already picks from them:
//
//   Shift       dpr.constants SHIFTS  → 'A' | 'B' | 'C' | 'G'
//   Line        Machine master        → the short code an operator knows it by
//   Supervisor  Operator master       → names, each tagged with the machines
//                                       that worker normally runs
//
// So Production In reads the SAME /dpr/options endpoint rather than minting a
// second copy of the floor. Nothing new is created and nothing is written back;
// this is a read for the dropdowns only, and the values still leave as the plain
// strings fgProduceSchema has always accepted.
export const SHIFT_LABEL = { A: 'Shift A', B: 'Shift B', C: 'Shift C', G: 'General (G)' };

export const useFgProductionMasters = () => {
  const { data, isFetching, isError } = useGetDprOptionsQuery();
  const o = data?.data || {};
  return React.useMemo(() => {
    const machines = o.machines || [];
    const operators = o.operators || [];
    return {
      loading: isFetching,
      // A masterless install must still be able to record production, so every
      // control stays freeSolo and simply offers nothing when these are empty.
      unavailable: isError,
      shifts: o.shifts || [],
      machines,
      operators,
      machineLabel: (code) => {
        const m = machines.find((x) => x.code === code);
        return m ? `${m.code}${m.name ? ` — ${m.name}` : ''}` : code || '';
      },
      // Mirrors the DPR entry form: once a line is chosen, offer the workers
      // normally assigned to it — but never hard-lock, because a supervisor can
      // legitimately cover a machine they are not tagged to.
      supervisorsFor: (lineCode) => {
        const all = operators.map((x) => x.name).filter(Boolean);
        if (!lineCode) return all;
        const matched = operators.filter((x) => (x.machineCodes || []).includes(lineCode)).map((x) => x.name);
        return matched.length ? matched : all;
      },
    };
  }, [o.shifts, o.machines, o.operators, isFetching, isError]);
};

// Available-vs-target % → colour (mirrors the RM sheet's coloured % column).
export const pctColor = (p) => {
  if (p == null) return '#94a3b8';
  if (p < 33) return '#dc2626';
  if (p <= 66) return '#b45309';
  if (p <= 110) return '#0f766e';
  return '#6366f1';
};

export default FgShell;
