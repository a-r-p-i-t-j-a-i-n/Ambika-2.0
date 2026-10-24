import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell, Paper, ButtonBase,
  Skeleton, Tooltip, TablePagination, Collapse, IconButton, Button, Chip, Menu, MenuItem, ListItemIcon,
  useMediaQuery, alpha,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  History, ChevronRight, ChevronDown, AlertTriangle, ArrowUpRight, Scissors, HelpCircle, MoreVertical,
  RotateCcw, Disc3, Layers, Scale, Trash2, Receipt, Pencil, RefreshCw, Unlink, ListTree, FileText,
  CircleDashed, CheckCheck,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  TableScroll, EmptyNote, YieldChip, CutStatusChip,
  O2D, O2D_TIP, num, imsTableSx, panelSx,
} from './rmImsMeta';
import { CuttingFilterBar, WhereCut } from './cuttingShared';
import { useCuttingFilters } from './cuttingFilters';
import {
  useGetRmConversionLedgerQuery, useGetRmCoilLineageQuery, useGetRmCuttingHistoryCirclesQuery, useGetRmCuttingHistoryCoilsQuery,
  useGetRmOverviewQuery,
} from '../../store/api/rmImsApi';

const day = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '—');
const dayTime = (d) => (d ? dayjs(d).format('DD-MM-YYYY HH:mm') : '—');
const numSx = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const mono = { fontFamily: 'ui-monospace, monospace' };
const ROWS_PER_PAGE = [10, 25, 50, 100];
// Below this width the records are cards (two a row from CARDS_TWO_UP); the
// "Type" column joins the table from TYPE_COLUMN — below it the GRN / Source
// column already says what the record is.
const CARDS_BELOW = 1000;
const CARDS_TWO_UP = 760;
const TYPE_COLUMN = 1240;

/** The width of an element, kept current — the records area sizes itself, not the window. */
const useWidth = () => {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
};
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * THE COIL TABLE — laid out like a sheet. Every column keeps its own width
 * (COLS) and its header stays on one line, so nothing is squeezed or wraps;
 * the table scrolls left–right inside its card instead. The header row stays
 * at the top and the Action column at the right edge while it scrolls, and
 * the scroll box is never taller than the screen, so its horizontal
 * scrollbar is always in view just under the rows.
 */
// In column order. The first group — which SKU, which coil, what it gave and
// where it stands (to Status) — plus the pinned Action column is ~1,070px: in
// view on a normal desktop without scrolling. The details after it are
// scrolled to.
const COLS = {
  expand: 30, sno: 44, sku: 135, batch: 130, cut: 100, circleSku: 135, circles: 95, scrap: 88, yield: 76, status: 112,
  left: 110, date: 112, source: 160, location: 132, type: 132, action: 128,
};
const colSx = (key, extra) => ({ width: COLS[key], minWidth: COLS[key], ...extra });
const historyTableSx = (showType) => {
  const base = imsTableSx(Object.entries(COLS).reduce((s, [k, w]) => (k === 'type' && !showType ? s : s + w), 0));
  return {
    ...base,
    tableLayout: 'fixed',
    // "separate", not "collapse": a sticky header cell keeps its own borders
    // and background while the rows scroll under it.
    borderCollapse: 'separate',
    borderSpacing: 0,
    '& td, & th': { ...base['& td, & th'], px: 0.75 },
    '& tbody > tr[data-id] > td': { py: 1.1 },
    // THIS table's header only (child combinators): an opened coil's rounds
    // table sits inside it and keeps its own, unpinned header. Named by MUI
    // class so it outranks the theme's own head rule.
    '& > .MuiTableHead-root > .MuiTableRow-root > .MuiTableCell-root': {
      ...base['& thead th'], whiteSpace: 'nowrap', lineHeight: 1.25, verticalAlign: 'bottom',
      textTransform: 'none', letterSpacing: 0, fontSize: '0.74rem', fontWeight: 800, color: O2D.ink,
      // The header row is fixed: the rows and their data scroll under it.
      position: 'sticky', top: 0, zIndex: 2,
      borderBottom: `1px solid ${O2D.line}`, boxShadow: `0 1px 0 ${O2D.line}`,
    },
  };
};
/**
 * The Action column, pinned to the right edge while the table scrolls. Its
 * background is solid (the row's own, or the hover tint) so the columns
 * scrolling under it never show through, and a soft edge marks the pin.
 */
const actionCellSx = (bg = O2D.surface) => ({
  ...colSx('action'), position: 'sticky', right: 0, zIndex: 1, bgcolor: bg, whiteSpace: 'nowrap',
  boxShadow: `inset 1px 0 0 ${O2D.line}, -8px 0 10px -8px rgba(28,30,33,0.22)`,
  'tr:hover > &': { bgcolor: O2D.surfaceAlt },
});
// The scroll box: sideways always; downwards only once the rows are taller
// than the screen allows (then the header and the scrollbar stay in view).
const historyScrollSx = {
  containerType: 'inline-size',
  overflowY: 'auto',
  maxHeight: { md: 'max(420px, calc(100vh - 230px))' },
  '&::-webkit-scrollbar': { height: 11, width: 11 },
};

/**
 * What a row is: a physical coil known by its goods receipt or by a manual
 * entry — or a cut that names no physical coil at all.
 */
const ENTRY_TOKENS = {
  GRN: { label: 'GRN', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe', icon: Receipt,
    meaning: 'Received on a goods receipt (GRN) — its weight and rate come from that receipt.' },
  MANUAL: { label: 'Manual entry', color: '#b45309', bg: '#fef3c7', border: '#fde68a', icon: Pencil,
    meaning: 'Entered on Cut Coils under "Manual Entry — No GRN": no goods receipt, total weight typed on its first round.' },
  NONE: { label: 'No physical coil', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1', icon: Unlink,
    meaning: 'This cut names no physical coil — a spreadsheet import or a cut saved with "No receipt available". It is listed on its own: its scrap cannot be traced to a coil, and no coil is guessed from its batch number.' },
};
const chipSx = (t) => ({
  height: 22, fontWeight: 700, fontSize: '0.66rem', borderRadius: '6px',
  bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
  '& .MuiChip-icon': { color: t.color, ml: 0.6, mr: -0.4 }, '& .MuiChip-label': { px: 0.8 },
});

const EntryChip = ({ source }) => {
  const t = ENTRY_TOKENS[source] || ENTRY_TOKENS.GRN;
  const Icon = t.icon;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" icon={<Icon size={11} />} label={t.label} data-testid="entry-type-chip" sx={chipSx(t)} />
    </Tooltip>
  );
};

/** The record type, as the "Record type" filter names it. */
const TYPE_TOKENS = {
  COIL: { label: 'Physical coil', color: '#1d4ed8', bg: '#eef2ff', border: '#c7d2fe',
    meaning: 'A physical coil: one row for all of its cutting rounds.' },
  IMPORT: { label: 'Legacy import', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1',
    meaning: 'A cut imported from the client\'s workbook. It names no physical coil.' },
  NO_RECEIPT: { label: 'Unlinked', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1',
    meaning: 'A cut saved with "No receipt available". It names no physical coil.' },
};
const typeOf = (r) => (r.kind === 'UNLINKED' ? r.origin : 'COIL');
const TypeChip = ({ row }) => {
  const t = TYPE_TOKENS[typeOf(row)] || TYPE_TOKENS.COIL;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" label={t.label} data-testid="record-type-chip" sx={chipSx(t)} />
    </Tooltip>
  );
};

/** The operator's choice for a round, as recorded. Never guessed when absent. */
const cuttingTypeText = (t) => (t === 'FULL' ? 'Full' : t === 'PARTIAL' ? 'Partial' : null);
const NOT_RECORDED_TIP = 'Not recorded — this cut was saved before the cutting type was captured. It is not guessed from the weights.';
const NotRecorded = ({ dash }) => (
  <Tooltip arrow slotProps={O2D_TIP} title={NOT_RECORDED_TIP}>
    <Box component="span" sx={{ color: O2D.faint, cursor: 'help', fontWeight: 500 }}>{dash ? '—' : 'Not recorded'}</Box>
  </Tooltip>
);
const CuttingTypeChip = ({ type }) => {
  const text = cuttingTypeText(type);
  if (!text) return <NotRecorded dash />;
  const t = type === 'FULL'
    ? { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' }
    : { color: '#b45309', bg: '#fef3c7', border: '#fde68a' };
  return <Chip size="small" label={text} sx={{ ...chipSx(t), borderRadius: '999px' }} />;
};
// "Scrap checked?" is no longer asked when a cut is entered, so the history no
// longer shows it; Scrap IMS keeps each scrap record's own state.

/**
 * A PARTIAL round records only the coil weight it cut: the circles are entered
 * with the coil's Full cut, which works out the scrap and yield of the whole
 * coil. Until then a coil's circles, scrap and yield read "—" — and so do the
 * partial rounds themselves.
 */
const OUTPUT_PENDING_TIP = 'Entered with the full cut — once the whole coil is cut, its circles are entered and the scrap and yield are worked out for the whole coil.';
const outputPending = (r) => r.kind === 'COIL' && r.status !== 'FULLY_CUT';

/** A label over its value, for a details line. */
const Fact = ({ label, children, testId }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink, mt: 0.2 }} data-testid={testId}>{children}</Typography>
  </Box>
);
const sizesText = (circles, sep) => (circles || []).map((x) => `${x.skuCode} · ${num(x.pcs)} pcs · ${num(x.weightKg)} kg`).join(sep);

const Dash = ({ tip }) => (
  <Tooltip arrow slotProps={O2D_TIP} title={tip}>
    <Typography component="span" sx={{ fontSize: '0.78rem', color: O2D.faint, cursor: 'help' }}>—</Typography>
  </Tooltip>
);
const NO_COIL_TIP = {
  total: 'No physical coil — its total weight is not known.',
  remaining: 'No physical coil — nothing to say is left on it.',
  status: 'Cutting status belongs to a physical coil; this cut names none.',
};

/**
 * The scrap of a row, split by where it was cut: PLG01 scrap is Ambika's stock,
 * JW001 scrap stayed with the job worker.
 */
const ScrapFigure = ({ r }) => {
  const jw = r.jobWorkScrapKg > 0;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={jw
      ? `${num(r.plantScrapKg)} kg is Ambika scrap (cut at PLG01). ${num(r.jobWorkScrapKg)} kg stayed with the job worker (JW001) — calculated for traceability, never added to Ambika's scrap stock.`
      : r.plantScrapKg > 0 ? 'Cut at PLG01 — this scrap went into Ambika\'s scrap stock.' : 'Calculated as cut − circles. No cutting location is recorded for it.'}>
      <Box component="span" sx={{ cursor: 'help' }}>
        <Typography component="span" sx={{ fontSize: '0.8rem', color: '#b45309', fontWeight: 700, ...numSx }}>{num(r.scrapKg)}</Typography>
        {jw && (
          <Typography sx={{ fontSize: '0.62rem', color: '#7c3aed', whiteSpace: 'nowrap' }}>
            {r.plantScrapKg > 0 ? `${num(r.jobWorkScrapKg)} with job worker` : 'with job worker'}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

/** Cut, and — for a coil — out of how much it weighed in all. */
const CutFigure = ({ r }) => (
  <>
    <Typography component="div" sx={{ fontSize: '0.84rem', fontWeight: 800, color: O2D.ink, ...numSx }}>{num(r.cutKg)}</Typography>
    {r.kind === 'COIL' && (
      <Tooltip arrow slotProps={O2D_TIP} title={`Total coil weight: ${num(r.receivedKg)} kg — what this coil weighed ${r.coilSource === 'MANUAL' ? 'on its manual entry' : 'on its goods receipt'}.`}>
        <Typography component="div" sx={{ fontSize: '0.66rem', color: O2D.sub, cursor: 'help', ...numSx }}>of {num(r.receivedKg)}</Typography>
      </Tooltip>
    )}
  </>
);

/** Circles: pieces (the sizes in the tooltip) over their weight. */
const CirclesFigure = ({ r }) => (
  <>
    <Tooltip arrow slotProps={O2D_TIP} title={r.circleSkuCodes?.length ? `Sizes produced: ${r.circleSkuCodes.join(', ')}` : 'No circle sizes recorded'}>
      <Typography component="div" sx={{ fontSize: '0.84rem', fontWeight: 700, color: O2D.ink, cursor: 'help', ...numSx }}>
        {r.circlesPcs != null ? num(r.circlesPcs) : '—'}
      </Typography>
    </Tooltip>
    <Typography component="div" sx={{ fontSize: '0.68rem', color: '#4338ca', fontWeight: 600, ...numSx }}>{num(r.circlesKg)} kg</Typography>
  </>
);

/** Remaining weight — flagged when the stock ledger tells a different story. */
const RemainingFigure = ({ r, align = 'flex-end' }) => (
  <Stack direction="row" spacing={0.4} alignItems="center" justifyContent={align}>
    {!r.reconciles && (
      <Tooltip arrow slotProps={O2D_TIP}
        title={`The stock ledger shows ${num(r.ledgerAvailableKg)} kg left on this batch: ${num(r.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil). Status follows the ledger.`}>
        <Box component="span" sx={{ display: 'flex', color: '#b45309' }}><AlertTriangle size={13} /></Box>
      </Tooltip>
    )}
    <Typography component="span" sx={{ fontSize: '0.84rem', fontWeight: 800, color: r.remainingKg < 0 ? '#b91c1c' : O2D.ink, ...numSx }}>{num(r.remainingKg)}</Typography>
  </Stack>
);

/** Where a coil came from, in words — for the source column's tooltip. */
const sourceTipOf = (c) => (c.coilSource === 'MANUAL' ? 'No goods receipt'
  : [c.grnNo && `GRN ${c.grnNo}`, c.poNumber && `PO ${c.poNumber}`, c.supplier,
    c.receivedDate && `received ${day(c.receivedDate)}`, c.receivedAt && `at ${c.receivedAt}`,
    c.unitCost && `₹${num(c.unitCost)}/kg`, c.receiptNumber].filter(Boolean).join(' · '));

const SourceCell = ({ r }) => (r.kind === 'UNLINKED' ? (
  <>
    <EntryChip source="NONE" />
    <Typography noWrap sx={{ mt: 0.4, fontSize: '0.66rem', color: O2D.sub }}>
      {r.origin === 'IMPORT' ? 'Imported record' : 'No receipt available'}
    </Typography>
  </>
) : (
  <>
    <EntryChip source={r.coilSource} />
    <Tooltip arrow slotProps={O2D_TIP} title={sourceTipOf(r) || 'No receipt details recorded'}>
      <Typography noWrap sx={{ mt: 0.4, fontSize: '0.66rem', color: O2D.sub, cursor: 'help' }}>
        {r.coilSource === 'MANUAL' ? 'No GRN' : (r.grnNo || r.receiptNumber || '—')}
      </Typography>
    </Tooltip>
  </>
));

const SkuCell = ({ r }) => (
  <>
    <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuCode}>{r.skuCode || '—'}</Typography>
    <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }} title={r.itemName}>{r.itemName || '—'}</Typography>
  </>
);

/**
 * The circle SKU(s) the cut produced — code over name, like the coil's SKU.
 * Several sizes: the first, and "+N more" with every one in the tooltip.
 */
const CircleSkuCell = ({ r }) => {
  const list = r.circleSkus?.length ? r.circleSkus : (r.circleSkuCodes || []).map((code) => ({ code, name: '' }));
  if (!list.length) return <CenteredDash tip="No circle sizes recorded" />;
  const [first, ...rest] = list;
  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title={<Box component="span" sx={{ whiteSpace: 'pre-line' }}>{list.map((c) => `${c.code}${c.name ? ` — ${c.name}` : ''}`).join('\n')}</Box>}>
      <Box sx={{ minWidth: 0, cursor: 'help' }} data-testid="cut-history-circle-sku">
        <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#4338ca' }}>
          {first.code}{rest.length > 0 && <Box component="span" sx={{ fontWeight: 600, color: O2D.sub, fontSize: '0.66rem' }}> +{rest.length} more</Box>}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{first.name || '—'}</Typography>
      </Box>
    </Tooltip>
  );
};

// ── Opened details ───────────────────────────────────────────────────────────

/** The card an opened row's details sit in: a title, a caption, an action. */
const DetailsCard = ({
  icon, title, titleTestId, caption, captionTestId, action, children,
}) => {
  const Icon = icon;
  return (
  <Paper elevation={0} sx={{ ...panelSx, overflow: 'hidden' }}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap
      sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${O2D.lineSoft}` }}>
      <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha(O2D.brand, 0.08), color: O2D.brand, flexShrink: 0 }}>
        <Icon size={14} />
      </Box>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink }} data-testid={titleTestId}>{title}</Typography>
      {caption && <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, flex: '1 1 260px' }} data-testid={captionTestId}>{caption}</Typography>}
      {action && <Box sx={{ ml: 'auto' }}>{action}</Box>}
    </Stack>
    {children}
  </Paper>
  );
};

// Pinned to the visible width of the table's scroller, so the details open in
// view even when the wide table is scrolled sideways.
const detailsWrapSx = (compact) => (compact
  ? { pt: 1 }
  : { position: 'sticky', left: 0, width: '100cqw', boxSizing: 'border-box', px: 1.5, py: 1.25, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.lineSoft}` });

// Rounds table: a rule down the left of each column group ("This round",
// "After this round") so a round's own figures never read as the coil's.
const groupStart = { borderLeft: `1px solid ${O2D.line}` };
const roundsTableSx = (() => {
  const base = imsTableSx(860);
  return {
    ...base,
    '& td, & th': { ...base['& td, & th'], px: 1.25 },
    '& .MuiTableHead-root .MuiTableCell-root': { ...base['& thead th'], py: 0.6, textTransform: 'none', letterSpacing: 0, fontSize: '0.7rem', color: O2D.body },
    '& tbody td': { ...base['& tbody td'], py: 0.9 },
  };
})();

/** One round as a small card — the rounds on a phone. */
const RoundCard = ({ r, hit, matchedIds, showLocation }) => (
  <Box data-testid="cut-round-row" data-round={r.roundNo} data-conversion={r.conversionNumber}
    data-matches={matchedIds ? String(hit) : undefined}
    sx={{ border: `1px solid ${O2D.line}`, borderRadius: '8px', p: 1, opacity: hit ? 1 : 0.45, bgcolor: O2D.surface }}>
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f766e' }}>Round {r.roundNo}</Typography>
      <Typography sx={{ fontSize: '0.74rem', fontWeight: 600, color: O2D.ink }}>{day(r.date)}</Typography>
      <CuttingTypeChip type={r.cuttingType} />
      <Box sx={{ ml: 'auto' }}><CutStatusChip status={r.status} /></Box>
    </Stack>
    <Typography sx={{ fontSize: '0.64rem', color: O2D.faint, ...mono }}>{r.conversionNumber} · saved {dayTime(r.savedAt)}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.75, mt: 0.75 }}>
      <Fact label="Coil Used (kg)">{num(r.cutKg)}</Fact>
      <Fact label="Circles (pcs)">{r.outputPending ? <Dash tip={OUTPUT_PENDING_TIP} /> : num((r.circles || []).reduce((s, x) => s + x.pcs, 0))}</Fact>
      <Fact label="Circles (kg)">{r.outputPending ? <Dash tip={OUTPUT_PENDING_TIP} /> : num(r.circlesKg)}</Fact>
      <Fact label="Scrap (kg)">{r.outputPending ? <Dash tip={OUTPUT_PENDING_TIP} /> : num(r.scrapKg)}</Fact>
      <Fact label="Yield">{r.yieldPct != null ? `${num(r.yieldPct)}%` : <Dash tip={OUTPUT_PENDING_TIP} />}</Fact>
      <Fact label="Coil Left After (kg)">{num(r.remainingAfterKg)}</Fact>
      {showLocation && <Fact label="Location"><WhereCut location={r.location} /></Fact>}
    </Box>
  </Box>
);

/**
 * What opens under a coil — loaded only then, from the lineage endpoint (the
 * same `deriveRounds` the coil page uses, so round numbers, the running
 * remaining weight and each round's status can never disagree with it).
 *
 * It adds only what the coil row cannot say:
 *   one round   the row above already IS that round — its date, weights,
 *               yield, remaining and status — so nothing is repeated: just the
 *               round's own record: its conversion number, the cutting type
 *               chosen, the circle sizes it produced and when it was saved;
 *   2+ rounds   one line per round, oldest first. Cut, circles, scrap and
 *               yield are THAT round's ("—" on a partial round: they come with
 *               the full cut, whose own figures are the whole coil's);
 *               remaining and status are the coil's after it. Location gets a
 *               column only when the rounds were not all cut in one place —
 *               the coil row already names a single one.
 *
 *   matchedIds  with a per-cut filter on, the cuts the server matched (null
 *               without one) — the others are dimmed, never hidden.
 *   compact     a phone: the rounds as cards rather than a table.
 *
 * Every round stays reachable, and the full page is one click away.
 */
const CoilRounds = ({ coilId, batchNo, roundCount, matchedIds, compact }) => {
  const navigate = useNavigate();
  const { data, isError, refetch } = useGetRmCoilLineageQuery(coilId);
  const rounds = data?.data || [];
  const meta = data?.meta || {};
  const openPage = (
    <Button size="small" variant="outlined" endIcon={<ArrowUpRight size={13} />} onClick={() => navigate(`/rm-ims/coil/${coilId}`)}
      data-testid="round-details-coil-page"
      sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap', borderRadius: '7px', borderColor: O2D.line }}>
      Open coil page
    </Button>
  );
  const many = rounds.length > 1;
  const showLocation = new Set(rounds.map((r) => r.location || null)).size > 1;

  let body;
  if (!data && isError) {
    body = (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5 }} data-testid="round-details-error">
        <Typography sx={{ fontSize: '0.74rem', color: '#b91c1c' }}>Could not load the rounds of this coil.</Typography>
        <Button size="small" startIcon={<RefreshCw size={13} />} onClick={refetch}
          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>Try again</Button>
      </Stack>
    );
  } else if (!data) {
    body = <Box sx={{ p: 1.5 }}>{[...Array(Math.min(Math.max(roundCount || 1, 1), 3))].map((_, i) => <Skeleton key={i} height={24} />)}</Box>;
  } else if (rounds.length === 0) {
    body = (
      <Typography sx={{ p: 1.5, fontSize: '0.74rem', color: O2D.sub }} data-testid="round-details-empty">
        No cutting round is recorded against this coil any more. Open the coil page to see its ledger.
      </Typography>
    );
  } else if (!many) {
    const r = rounds[0];
    const circles = r.circles || [];
    body = (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, auto))' }, justifyContent: 'start', columnGap: 3, rowGap: 1, px: 1.5, py: 1.25 }}
        data-testid="round-details" data-rounds="1">
        <Fact label="Conversion" testId="round-details-conversion">
          <Box component="span" sx={mono}>{r.conversionNumber || '—'}</Box>
        </Fact>
        <Fact label="Cutting type" testId="round-details-type">{cuttingTypeText(r.cuttingType) || <NotRecorded />}</Fact>
        {/* One size: which one (the row already counts its pieces). Several:
            how the pieces and weight split between them. */}
        <Fact label={circles.length > 1 ? 'Circle sizes' : 'Circle size'} testId="round-details-sizes">
          {circles.length === 0 && (r.outputPending ? 'Entered with the full cut' : '—')}
          {circles.length === 1 && `${circles[0].skuCode}${circles[0].itemName ? ` · ${circles[0].itemName}` : ''}`}
          {circles.length > 1 && sizesText(circles, '  |  ')}
        </Fact>
        <Fact label="Saved" testId="round-details-saved">{dayTime(r.savedAt)}</Fact>
      </Box>
    );
  } else if (compact) {
    body = (
      <Stack spacing={0.75} sx={{ p: 1 }} data-testid="rounds-table">
        {rounds.map((r) => (
          <RoundCard key={r.conversionId} r={r} hit={!matchedIds || matchedIds.has(String(r.conversionId))} matchedIds={matchedIds} showLocation={showLocation} />
        ))}
      </Stack>
    );
  } else {
    body = (
      <TableScroll>
        <Table size="small" sx={roundsTableSx} aria-label={`Cutting rounds of batch ${batchNo || ''}`} data-testid="rounds-table">
          <TableHead>
            <TableRow>
              <TableCell rowSpan={2} align="center" sx={{ width: 64 }}>Round</TableCell>
              <TableCell rowSpan={2}>Date</TableCell>
              <TableCell rowSpan={2}>Conversion No.</TableCell>
              <TableCell rowSpan={2}>Cutting type</TableCell>
              <TableCell colSpan={5} align="center" sx={groupStart}>This round</TableCell>
              <TableCell colSpan={2} align="center" sx={groupStart}>After this round</TableCell>
              {showLocation && <TableCell rowSpan={2} sx={groupStart}>Location</TableCell>}
            </TableRow>
            <TableRow>
              <TableCell align="right" sx={groupStart}>Coil Used (kg)</TableCell>
              <TableCell align="right">Circles (pcs)</TableCell>
              <TableCell align="right">Circles (kg)</TableCell>
              <TableCell align="right">Scrap (kg)</TableCell>
              <TableCell>Yield</TableCell>
              <TableCell align="right" sx={groupStart}>Coil Left (kg)</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rounds.map((r) => {
              const hit = !matchedIds || matchedIds.has(String(r.conversionId));
              const sizes = sizesText(r.circles, '\n');
              const pcs = (r.circles || []).reduce((s, x) => s + x.pcs, 0);
              return (
                <TableRow key={r.conversionId} data-testid="cut-round-row" data-round={r.roundNo}
                  data-conversion={r.conversionNumber} data-matches={matchedIds ? String(hit) : undefined}
                  sx={{ opacity: hit ? 1 : 0.45 }}>
                  <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color: '#0f766e' }}>{r.roundNo}</TableCell>
                  {/* When it was saved is in the tooltip — the date is the day it was cut. */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip arrow slotProps={O2D_TIP} title={`Saved ${dayTime(r.savedAt)}`}>
                      <Box component="span" sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, cursor: 'help' }}>{day(r.date)}</Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.72rem', color: O2D.sub, ...mono }}>{r.conversionNumber}</TableCell>
                  <TableCell><CuttingTypeChip type={r.cuttingType} /></TableCell>
                  <TableCell align="right" sx={{ ...numSx, ...groupStart, fontWeight: 800, color: O2D.ink }}>{num(r.cutKg)}</TableCell>
                  {r.outputPending ? (
                    // A partial round: its circles, scrap and yield come with the full cut.
                    <>
                      <TableCell align="right"><Dash tip={OUTPUT_PENDING_TIP} /></TableCell>
                      <TableCell align="right"><Dash tip={OUTPUT_PENDING_TIP} /></TableCell>
                      <TableCell align="right"><Dash tip={OUTPUT_PENDING_TIP} /></TableCell>
                      <TableCell><Dash tip={OUTPUT_PENDING_TIP} /></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell align="right" sx={numSx}>
                        <Tooltip arrow slotProps={O2D_TIP} title={sizes ? <Box component="span" sx={{ whiteSpace: 'pre-line' }}>{sizes}</Box> : 'No circle sizes recorded'}>
                          <Box component="span" sx={{ cursor: 'help' }}>{num(pcs)}</Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right" sx={{ ...numSx, color: '#4338ca' }}>{num(r.circlesKg)}</TableCell>
                      <TableCell align="right" sx={{ ...numSx, color: '#b45309' }}>
                        {num(r.scrapKg)}
                        {/* The full cut that finished the coil: its circles and scrap
                            are the whole coil's, not this round's alone. */}
                        {r.settledKg > r.cutKg + 0.001 && (
                          <Tooltip arrow slotProps={O2D_TIP} title={`This full cut entered the circles of ${num(r.settledKg)} kg of the coil — its own ${num(r.cutKg)} kg and ${num(r.settledKg - r.cutKg)} kg cut in the partial rounds before it. Scrap and yield are over all of it.`}>
                            <Typography component="div" sx={{ fontSize: '0.6rem', color: O2D.sub, cursor: 'help' }} data-testid="round-settled-kg">of {num(r.settledKg)}</Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>{r.yieldPct != null ? <YieldChip pct={r.yieldPct} /> : '—'}</TableCell>
                    </>
                  )}
                  <TableCell align="right" sx={{ ...numSx, ...groupStart, fontWeight: 800, color: r.remainingAfterKg < 0 ? '#b91c1c' : O2D.ink }}>
                    {num(r.remainingAfterKg)}
                  </TableCell>
                  <TableCell><CutStatusChip status={r.status} /></TableCell>
                  {showLocation && <TableCell sx={groupStart}><WhereCut location={r.location} /></TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
    );
  }

  const count = data ? rounds.length : roundCount;
  return (
    <Box role="region" id={`coil-rounds-${coilId}`} aria-label={`Round details of batch ${batchNo || ''}`} sx={detailsWrapSx(compact)}>
      <DetailsCard icon={ListTree}
        title={count > 1 ? `Cutting rounds (${count})` : 'Cutting round (1)'} titleTestId="rounds-title"
        caption={!data ? null : many
          ? `Oldest first. Each line is one round; the coil row above is their total.${matchedIds ? ' Rounds the filters leave out are dimmed.' : ''}`
          : 'One cutting round — its date, weights, yield and status are the row above.'}
        captionTestId="rounds-caption" action={openPage}>
        {body}
        {meta.totals && meta.totals.reconciles === false && (
          <Typography sx={{ px: 1.5, pb: 1.25, fontSize: '0.68rem', color: '#b45309' }}>
            The stock ledger shows {num(meta.totals.ledgerAvailableKg)} kg left on this batch.{' '}
            {num(meta.totals.coil?.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil).
          </Typography>
        )}
      </DetailsCard>
    </Box>
  );
};

/**
 * What opens under a cut that names no physical coil: its own record, as it
 * was saved — the ledger row already carries all of it, so nothing is loaded.
 * There is no coil, so no rounds, remaining weight or status; and none is
 * borrowed from a coil that happens to share its batch number.
 */
const CutDetails = ({ cut, compact }) => {
  const circles = cut.circles || [];
  return (
    <Box role="region" id={`cut-details-${cut.id}`} aria-label={`Details of conversion ${cut.conversionNumber}`} sx={detailsWrapSx(compact)}>
      <DetailsCard icon={FileText} title="Conversion details"
        caption="This cut names no physical coil, so it has no rounds, remaining weight or coil status — and none is guessed from its batch number.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, auto))', lg: 'repeat(7, minmax(0, auto))' }, justifyContent: 'start', columnGap: 3, rowGap: 1, px: 1.5, pt: 1.25, pb: 0.75 }}
          data-testid="cut-details">
          <Fact label="Conversion" testId="cut-details-conversion"><Box component="span" sx={mono}>{cut.conversionNumber || '—'}</Box></Fact>
          <Fact label="Cut on" testId="cut-details-date">{day(cut.date)}</Fact>
          <Fact label="Saved" testId="cut-details-saved">{dayTime(cut.savedAt)}</Fact>
          <Fact label="Cutting type" testId="cut-details-type">{cuttingTypeText(cut.cuttingType) || <NotRecorded />}</Fact>
          <Fact label={circles.length > 1 ? 'Circle sizes' : 'Circle size'} testId="cut-details-sizes">
            {circles.length ? sizesText(circles, '  |  ') : '—'}
          </Fact>
          <Fact label="Rate" testId="cut-details-rate">{cut.rate ? `₹${num(cut.rate)}/kg` : '—'}</Fact>
          <Fact label="Source" testId="cut-details-source">
            {cut.origin === 'IMPORT'
              ? <>Imported record <Box component="span" sx={{ ...mono, fontWeight: 500, color: O2D.sub, fontSize: '0.66rem', wordBreak: 'break-all' }}>{cut.sourceRef}</Box></>
              : 'Saved with “No receipt available”'}
          </Fact>
          {cut.remarks && <Fact label="Remarks" testId="cut-details-remarks">{cut.remarks}</Fact>}
        </Box>
        {!cut.location && (
          <Typography sx={{ px: 1.5, pb: 1.25, fontSize: '0.68rem', color: O2D.sub }}>No cutting location was recorded for it.</Typography>
        )}
      </DetailsCard>
    </Box>
  );
};

// ── The summary ──────────────────────────────────────────────────────────────

/**
 * One summary card. With `onClick` it is a button that does what `actionLabel`
 * says, and shows a chevron; without one it is only a figure.
 */
const SummaryCard = ({
  label, value, sub, icon, color, tint, onClick, actionLabel, active, testId,
}) => {
  const Icon = icon;
  // Compact, so all five cards sit on one line on a normal screen.
  const content = (
    <Stack direction="row" spacing={1.1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
      <Box sx={{ width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(color, 0.12), color }}>
        <Icon size={17} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <Typography noWrap sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.body }}>{label}</Typography>
        <Typography sx={{ fontSize: { xs: '1.1rem', md: '1.15rem' }, fontWeight: 800, color, lineHeight: 1.25, ...numSx }}>{value}</Typography>
        <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, mt: 0.15, lineHeight: 1.35 }}>{sub}</Typography>
      </Box>
      {onClick && <Box sx={{ color: O2D.sub, display: 'flex', flexShrink: 0 }}><ChevronRight size={16} /></Box>}
    </Stack>
  );
  const sx = {
    ...panelSx, p: { xs: 1.25, md: 1.25 }, bgcolor: tint || O2D.surface, display: 'flex', width: '100%', minWidth: 0,
    ...(active ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` } : null),
  };
  return onClick ? (
    <ButtonBase onClick={onClick} aria-label={actionLabel} data-testid={testId}
      sx={{ ...sx, transition: 'border-color .15s, box-shadow .15s', '&:hover': { borderColor: color, boxShadow: '0 2px 10px rgba(28,30,33,0.08)' }, '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 } }}>
      {content}
    </ButtonBase>
  ) : (
    <Paper elevation={0} sx={sx} data-testid={testId}>{content}</Paper>
  );
};

/**
 * Circles in stock RIGHT NOW — the stock ledger's balance (the same figure as
 * Stock & Master Data), not the sum of circles ever cut: every cut adds its
 * circles, Stock In adds, Stock Out / issue to production removes, so circles
 * already used are not counted as available. All locations together.
 * Follows the Circle SKU filter; not the dates, since it is "now". Fetched
 * fresh each time the page opens, so the count is never an old one.
 */
const AvailableCirclesCard = ({ circleSkuId, onOpen }) => {
  const { data, isLoading, isError } = useGetRmOverviewQuery({ kind: 'CIRCLE' }, { refetchOnMountOrArgChange: true });
  const rows = (Array.isArray(data?.data) ? data.data : [])
    .filter((r) => r.kind === 'CIRCLE' && (!circleSkuId || String(r.skuId) === String(circleSkuId)));
  // A balance below zero is a records problem, never stock you can use.
  const pcs = rows.reduce((s, r) => s + Math.max(0, Number(r.onHand) || 0), 0);
  const kg = Math.round(rows.reduce((s, r) => s + Math.max(0, Number(r.onHandKg) || 0), 0) * 100) / 100;
  const sizes = rows.filter((r) => Number(r.onHand) > 0).length;
  const belowZero = rows.filter((r) => Number(r.onHand) < 0).length;

  let value = `${num(pcs)} pcs`;
  let sub = `${num(kg)} kg · ${plural(sizes, 'size')} in stock${circleSkuId ? ' (selected size)' : ''}`
    + (belowZero ? ` · ${plural(belowZero, 'size')} below zero` : '');
  if (isLoading) { value = '…'; sub = 'Loading circle stock'; }
  else if (isError) { value = '—'; sub = 'Could not load circle stock'; }

  return (
    <SummaryCard label="Available Circles" value={value} sub={sub} icon={CircleDashed} color="#047857" tint="#f2fbf6"
      onClick={onOpen} actionLabel="Open circle stock" testId="card-available-circles" />
  );
};

/** The record-type tabs over the table — the same filter as "Record type". */
const RECORD_TABS = [
  { key: 'all', value: '', label: 'All records', count: (s) => s.all, active: (t) => !t },
  { key: 'coil', value: 'COIL', label: 'With physical coil', count: (s) => s.coils, active: (t) => ['COIL', 'GRN', 'MANUAL'].includes(t) },
  { key: 'none', value: 'NONE', label: 'Without physical coil', count: (s) => s.unlinked, active: (t) => t === 'NONE' },
];
const RecordTabs = ({ segments, entryType, onPick }) => (
  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap role="group" aria-label="Record type" data-testid="record-tabs">
    {RECORD_TABS.map((t) => {
      const on = t.active(entryType);
      const n = segments ? t.count(segments) : null;
      return (
        <Button key={t.key} size="small" onClick={() => onPick(t.value)} aria-pressed={on} data-testid={`record-tab-${t.key}`} data-count={n ?? ''}
          sx={{
            textTransform: 'none', fontWeight: 700, fontSize: '0.76rem', borderRadius: '8px', px: 1.4, minHeight: 34, whiteSpace: 'nowrap',
            border: `1px solid ${on ? O2D.brand : O2D.line}`, bgcolor: on ? alpha(O2D.brand, 0.06) : O2D.surfaceAlt,
            color: on ? O2D.brand : O2D.body, '&:hover': { bgcolor: on ? alpha(O2D.brand, 0.1) : O2D.band },
          }}>
          {t.label}{n != null ? ` (${num(n)})` : ''}
        </Button>
      );
    })}
  </Stack>
);

// ── One row ──────────────────────────────────────────────────────────────────

/** The two kinds of row share everything but the figures a coil alone has. */
const rowAttrs = (r, isOpen) => (r.kind === 'UNLINKED'
  ? {
    'data-testid': 'ledger-cut-row', 'data-id': r.id, 'data-kind': 'UNLINKED', 'data-conversion': r.conversionNumber,
    'data-batch': r.batchNo, 'data-origin': r.origin, 'data-location': r.location || '', 'data-open': isOpen ? 'true' : 'false',
  }
  : {
    'data-testid': 'cut-history-row', 'data-id': r.id, 'data-kind': 'COIL', 'data-batch': r.batchNo,
    'data-source': r.coilSource, 'data-open': isOpen ? 'true' : 'false',
  });
const toggleLabelOf = (r, isOpen) => {
  if (r.kind === 'UNLINKED') return `${isOpen ? 'Hide' : 'Show'} the details of conversion ${r.conversionNumber}`;
  const one = r.rounds === 1;
  return isOpen
    ? `Hide the ${one ? 'round details' : 'rounds'} of batch ${r.batchNo}`
    : `Show the ${one ? 'round details' : `${r.rounds} rounds`} of batch ${r.batchNo}`;
};
const detailsIdOf = (r) => (r.kind === 'UNLINKED' ? `cut-details-${r.id}` : `coil-rounds-${r.id}`);

/** "N rounds" — opens the coil's rounds. */
const RoundsChip = ({ r, isOpen, onToggle }) => (
  <Tooltip arrow placement="top" disableInteractive slotProps={O2D_TIP} title={isOpen
    ? (r.rounds === 1 ? 'Hide the round details' : 'Hide the cutting rounds')
    : (r.rounds === 1 ? "Show this round's record: conversion number, cutting type and circle sizes" : 'Show each cutting round of this coil')}>
    <Button size="small" startIcon={<Layers size={12} />} aria-expanded={isOpen} aria-controls={isOpen ? detailsIdOf(r) : undefined}
      onClick={(e) => { e.stopPropagation(); onToggle(); }} data-testid="cut-history-rounds"
      sx={{
        mt: 0.4, minWidth: 0, px: 0.9, py: 0, minHeight: 22, textTransform: 'none', fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px',
        bgcolor: isOpen ? O2D.brand : O2D.surfaceAlt, color: isOpen ? '#fff' : O2D.body, border: `1px solid ${isOpen ? O2D.brand : O2D.line}`,
        '& .MuiButton-startIcon': { mr: 0.4 }, '&:hover': { bgcolor: isOpen ? O2D.brand : O2D.band },
      }}>
      {r.rounds} round{r.rounds === 1 ? '' : 's'}
    </Button>
  </Tooltip>
);

const MatchedNote = ({ r, cutFiltered }) => (cutFiltered && r.kind === 'COIL' && r.matchedRounds < r.rounds ? (
  <Typography sx={{ fontSize: '0.62rem', color: O2D.sub, mt: 0.3 }} data-testid="cut-history-matched">
    {r.matchedRounds} of {r.rounds} match
  </Typography>
) : null);

const BatchCell = ({ r, isOpen, onToggle, cutFiltered }) => (
  <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={0.6} alignItems="center">
      <Box sx={{ color: r.kind === 'COIL' ? O2D.brand : O2D.faint, display: 'flex', flexShrink: 0 }}>
        {r.kind === 'COIL' ? <Disc3 size={14} /> : <Unlink size={13} />}
      </Box>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink, ...mono, whiteSpace: 'nowrap' }}>{r.batchNo || '—'}</Typography>
    </Stack>
    {r.kind === 'COIL'
      ? <RoundsChip r={r} isOpen={isOpen} onToggle={onToggle} />
      : <Typography sx={{ mt: 0.3, fontSize: '0.64rem', color: O2D.faint, ...mono, whiteSpace: 'nowrap' }}>{r.conversionNumber}</Typography>}
    <MatchedNote r={r} cutFiltered={cutFiltered} />
  </Box>
);

const DateCell = ({ r }) => {
  const multi = r.kind === 'COIL' && r.rounds > 1 && r.firstCutAt && day(r.firstCutAt) !== day(r.lastCutAt);
  return (
    <>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink, whiteSpace: 'nowrap' }}>{day(r.kind === 'COIL' ? r.lastCutAt : r.date)}</Typography>
      {multi && <Typography sx={{ fontSize: '0.64rem', color: O2D.faint, whiteSpace: 'nowrap' }}>First: {day(r.firstCutAt)}</Typography>}
    </>
  );
};

const ExpandButton = ({ r, isOpen }) => (
  <IconButton size="small" sx={{ color: O2D.sub }} aria-expanded={isOpen}
    aria-controls={isOpen ? detailsIdOf(r) : undefined} aria-label={toggleLabelOf(r, isOpen)}
    data-testid="cut-history-expand">
    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
  </IconButton>
);

/**
 * A row's circles, scrap or yield — "—" while its coil is not fully cut. The
 * dash sits in the middle of its column, as every placeholder in this table
 * does, so a row of them lines up; `block` centres it in a column whose text
 * is otherwise left-aligned (the names).
 */
const CenteredDash = ({ tip }) => <Box sx={{ textAlign: 'center' }}><Dash tip={tip} /></Box>;
const UntilFullCut = ({ r, children, block }) => {
  if (!outputPending(r)) return children;
  return block ? <CenteredDash tip={OUTPUT_PENDING_TIP} /> : <Dash tip={OUTPUT_PENDING_TIP} />;
};

/**
 * A partially cut coil's next step, one click away: "Full Cut" opens the
 * entry form for THIS coil with Full cutting chosen — the round that enters
 * its circles. The row's other actions stay in its menu.
 */
const FullCutButton = ({ r, onCutCoil }) => (r.kind === 'COIL' && r.status === 'PARTIALLY_CUT' && onCutCoil ? (
  <Tooltip arrow slotProps={O2D_TIP} title={`Finish coil ${r.batchNo}: cut the ${num(r.remainingKg)} kg left and enter its circles.`}>
    <Button size="small" variant="outlined" startIcon={<Scissors size={12} />} data-testid="row-full-cut"
      aria-label={`Full cut of batch ${r.batchNo}`}
      onClick={(e) => { e.stopPropagation(); onCutCoil(r, 'FULL'); }}
      sx={{
        textTransform: 'none', fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', px: 1, py: 0, minHeight: 24, minWidth: 0,
        whiteSpace: 'nowrap', borderColor: alpha(O2D.brand, 0.4), color: O2D.brand, '& .MuiButton-startIcon': { mr: 0.4 },
      }}>
      Full Cut
    </Button>
  </Tooltip>
) : null);

const ActionsButton = ({ r, onMenu }) => (
  <IconButton size="small" aria-label={`Actions for ${r.kind === 'COIL' ? `batch ${r.batchNo}` : `conversion ${r.conversionNumber}`}`}
    aria-haspopup="menu" data-testid="row-actions"
    onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget, r); }} sx={{ color: O2D.sub }}>
    <MoreVertical size={16} />
  </IconButton>
);

/** One row of the table (from `md` up). */
const LedgerRow = ({
  r, sno, isOpen, onToggle, onMenu, onCutCoil, cutFiltered, matchedIds, showType, cols,
}) => (
  <>
    <TableRow hover onClick={onToggle} {...rowAttrs(r, isOpen)}
      sx={{ cursor: 'pointer', ...(r.kind === 'UNLINKED' ? { bgcolor: '#fbfcfd' } : null), '& > td': isOpen ? { borderBottom: 0 } : undefined }}>
      <TableCell sx={{ pr: 0 }}><ExpandButton r={r} isOpen={isOpen} /></TableCell>
      <TableCell align="center" sx={{ ...numSx, color: O2D.sub }} data-testid="cut-history-sno">{sno}</TableCell>
      {/* What is looked at first — which SKU, which coil, what it gave and
          where it stands — then the details, which the table scrolls to. Same
          order as the head. */}
      {/* Names read left-aligned; every figure, chip, date and "—" is centred
          in its column (and its header), so each column lines up. */}
      <TableCell><SkuCell r={r} /></TableCell>
      <TableCell><BatchCell r={r} isOpen={isOpen} onToggle={onToggle} cutFiltered={cutFiltered} /></TableCell>
      <TableCell align="center"><CutFigure r={r} /></TableCell>
      <TableCell><UntilFullCut r={r} block><CircleSkuCell r={r} /></UntilFullCut></TableCell>
      <TableCell align="center"><UntilFullCut r={r}><CirclesFigure r={r} /></UntilFullCut></TableCell>
      <TableCell align="center"><UntilFullCut r={r}><ScrapFigure r={r} /></UntilFullCut></TableCell>
      <TableCell align="center"><UntilFullCut r={r}>{r.yieldPct != null ? <YieldChip pct={r.yieldPct} /> : <Dash tip="No yield recorded" />}</UntilFullCut></TableCell>
      <TableCell align="center">{r.kind === 'COIL' ? <CutStatusChip status={r.status} /> : <Dash tip={NO_COIL_TIP.status} />}</TableCell>
      <TableCell align="center">{r.kind === 'COIL' ? <RemainingFigure r={r} align="center" /> : <Dash tip={NO_COIL_TIP.remaining} />}</TableCell>
      <TableCell align="center"><DateCell r={r} /></TableCell>
      <TableCell sx={{ maxWidth: 160 }}><SourceCell r={r} /></TableCell>
      <TableCell align="center"><WhereCut location={r.location} /></TableCell>
      {showType && <TableCell align="center"><TypeChip row={r} /></TableCell>}
      <TableCell align="right" sx={actionCellSx(r.kind === 'UNLINKED' ? '#fbfcfd' : O2D.surface)}>
        <Stack direction="row" spacing={0.25} alignItems="center" justifyContent="flex-end">
          <FullCutButton r={r} onCutCoil={onCutCoil} />
          <ActionsButton r={r} onMenu={onMenu} />
        </Stack>
      </TableCell>
    </TableRow>
    <TableRow>
      {/* `&&` outranks the table's own cell padding, so the pinned details
          line up with the scroller's edge. */}
      <TableCell colSpan={cols} sx={{ border: 0, '&&': { p: 0 } }}>
        <Collapse in={isOpen} unmountOnExit>
          {r.kind === 'UNLINKED'
            ? <CutDetails cut={r} />
            : <CoilRounds coilId={r.id} batchNo={r.batchNo} roundCount={r.rounds} matchedIds={matchedIds} />}
        </Collapse>
      </TableCell>
    </TableRow>
  </>
);

/** A label over a figure, in a record card. */
const CardFigure = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub }}>{label}</Typography>
    <Box sx={{ mt: 0.2 }}>{children}</Box>
  </Box>
);

/** One record as a card (below `md`) — the same record, the same details. */
const LedgerCard = ({
  r, sno, isOpen, onToggle, onMenu, onCutCoil, cutFiltered, matchedIds,
}) => (
  <Paper elevation={0} {...rowAttrs(r, isOpen)}
    sx={{ ...panelSx, p: 1.25, bgcolor: r.kind === 'UNLINKED' ? '#fbfcfd' : O2D.surface, ...(isOpen ? { borderColor: alpha(O2D.brand, 0.45), gridColumn: '1 / -1' } : null) }}>
    <Stack direction="row" spacing={0.75} alignItems="flex-start" onClick={onToggle} sx={{ cursor: 'pointer' }}>
      <Box sx={{ mt: -0.25, ml: -0.5 }}><ExpandButton r={r} isOpen={isOpen} /></Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Typography sx={{ fontSize: '0.7rem', color: O2D.faint, ...numSx }} data-testid="cut-history-sno">#{sno}</Typography>
          <Box sx={{ minWidth: 0 }}><DateCell r={r} /></Box>
        </Stack>
      </Box>
      <Box sx={{ flexShrink: 0 }}>{r.kind === 'COIL' ? <CutStatusChip status={r.status} /> : <TypeChip row={r} />}</Box>
      <Box sx={{ mt: -0.5, mr: -0.75 }}><ActionsButton r={r} onMenu={onMenu} /></Box>
    </Stack>
    <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between" sx={{ mt: 0.75 }}>
      <BatchCell r={r} isOpen={isOpen} onToggle={onToggle} cutFiltered={cutFiltered} />
      <FullCutButton r={r} onCutCoil={onCutCoil} />
    </Stack>
    <Stack direction="row" spacing={1.25} alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mt: 0.9 }}>
      <Box sx={{ minWidth: 0 }}><SourceCell r={r} /></Box>
      <Box sx={{ minWidth: 0, flex: '1 1 120px' }}><SkuCell r={r} /></Box>
      <Box><WhereCut location={r.location} /></Box>
    </Stack>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
      <CardFigure label="Coil Used (kg)"><CutFigure r={r} /></CardFigure>
      <CardFigure label="Circle SKU"><UntilFullCut r={r}><CircleSkuCell r={r} /></UntilFullCut></CardFigure>
      <CardFigure label="Circles (pcs | kg)"><UntilFullCut r={r}><CirclesFigure r={r} /></UntilFullCut></CardFigure>
      <CardFigure label="Scrap (kg)"><UntilFullCut r={r}><ScrapFigure r={r} /></UntilFullCut></CardFigure>
      <CardFigure label="Yield"><UntilFullCut r={r}>{r.yieldPct != null ? <YieldChip pct={r.yieldPct} /> : '—'}</UntilFullCut></CardFigure>
      <CardFigure label="Coil Left (kg)">{r.kind === 'COIL' ? <RemainingFigure r={r} align="flex-start" /> : <Dash tip={NO_COIL_TIP.remaining} />}</CardFigure>
      {/* The header carries a coil's status and a coil-less cut's type; here, the other. */}
      {r.kind === 'COIL'
        ? <CardFigure label="Type"><TypeChip row={r} /></CardFigure>
        : <CardFigure label="Status"><Dash tip={NO_COIL_TIP.status} /></CardFigure>}
    </Box>
    <Collapse in={isOpen} unmountOnExit>
      {r.kind === 'UNLINKED'
        ? <CutDetails cut={r} compact />
        : <CoilRounds coilId={r.id} batchNo={r.batchNo} roundCount={r.rounds} matchedIds={matchedIds} compact />}
    </Collapse>
  </Paper>
);

/**
 * COIL TO CIRCLE HISTORY — every recorded cut, in one table.
 *
 * The main content of the Coil to Circle page, from the conversion ledger
 * (rmIms.service.js → listConversionLedger). Two kinds of row, newest cut
 * first, paged together on the server:
 *
 *   a physical coil   one row per coil, totalled across its cutting rounds —
 *                     its rounds open under it (CoilRounds);
 *   a cut with no     one row per cut that names no physical coil (spreadsheet
 *   physical coil     imports, "No receipt available") — its own record opens
 *                     under it (CutDetails). Never attached to a coil.
 *
 * Every figure is derived on the server — nothing is typed by anyone, least of
 * all a status — and nothing is filtered or summed in the browser: filtering,
 * counting, the totals and paging all happen there. The totals add up each
 * matching cut once; a coil row and its rounds are never both counted.
 *
 * From `md` up the records are a table; below it, cards carrying the same
 * figures, details and actions. One record opens at a time.
 *
 *   refreshKey  changes after every save, so the list jumps back to page 1,
 *               where the coil just cut now sits (newest cut first). Filters
 *               are kept as they are.
 *   onCutCoil(row, 'FULL' | 'PARTIAL')
 *               a partially cut coil's row action: the page opens the entry
 *               form for that coil, with that cutting type chosen.
 */
const CuttingHistoryPanel = ({ refreshKey = 0, onCutCoil }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const narrowWindow = useMediaQuery(theme.breakpoints.down('md'));
  const [recordsRef, recordsWidth] = useWidth();
  // Until the records area has been measured, the window decides.
  const cards = recordsWidth ? recordsWidth < CARDS_BELOW : narrowWindow;
  const showType = recordsWidth >= TYPE_COLUMN;
  // All five summary cards on one line where they have room; fewer per row on
  // narrower screens.
  const summaryColumns = recordsWidth
    ? `repeat(${recordsWidth >= 980 ? 5 : recordsWidth >= 720 ? 3 : recordsWidth >= 440 ? 2 : 1}, minmax(0, 1fr))`
    : { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' };
  const cols = showType ? 16 : 15;
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const filters = useCuttingFilters();
  const {
    page, setPage, applied, dateError, anyFilter, reset, setNow,
  } = filters;
  const [openId, setOpenId] = useState(null);
  const [menu, setMenu] = useState(null); // { anchor, row }

  // A save happened: back to page 1 (React's "adjust state on a prop change").
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (seenRefresh !== refreshKey) { setSeenRefresh(refreshKey); setPage(0); }

  const params = { page: page + 1, limit: rowsPerPage, ...filters.params };
  const {
    data, currentData, isFetching, isError, error, refetch,
  } = useGetRmConversionLedgerQuery(params, { skip: dateError });
  // The answer for THESE filters — or, while it loads, the previous one shown
  // dimmed. Never a stale answer once the request has failed.
  const view = isError ? undefined : (currentData || (isFetching ? data : undefined));
  const stale = !!view && view !== currentData;
  const rows = useMemo(() => view?.data || [], [view]);
  const meta = view?.meta || {};
  const total = meta.pagination?.total || 0;
  // S.No. from the page the rows were actually fetched for.
  const rowBase = ((meta.pagination?.page || 1) - 1) * (meta.pagination?.limit || rowsPerPage);

  // Never sit on a page past the end of the answer just received.
  const lastPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1);
  if (currentData && page > lastPage) setPage(lastPage);

  // Every circle any cut produced — the older cuts' too, so a size only an
  // imported cut made can still be filtered by.
  const circleList = useGetRmCuttingHistoryCirclesQuery({ scope: 'all' });
  // Every coil SKU any cut was made from — what the "Coil SKU" filter offers.
  const coilList = useGetRmCuttingHistoryCoilsQuery();

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));
  // Per row, the cuts the server matched — for dimming the rest of a coil's rounds.
  const matchedSets = useMemo(() => new Map(rows.map((r) => [r.id, r.matchedConversionIds ? new Set(r.matchedConversionIds) : null])), [rows]);

  const cutFiltered = !!meta.cutFiltered;
  const errorText = error?.status === 'FETCH_ERROR'
    ? 'The server could not be reached. Check the connection and try again.'
    : (error?.data?.message || 'The server did not return the history. Try again in a moment.');
  const onMenu = (anchor, row) => setMenu({ anchor, row });
  const closeMenu = () => setMenu(null);

  // ── What the records area says when there are no records to show ──
  let stateBlock = null;
  if (dateError) {
    stateBlock = <EmptyNote icon={AlertTriangle} tone="#b45309" dense title={'"From date" is after "To date"'} hint="Correct the dates to see the matching cuts." />;
  } else if (!view && isFetching) {
    stateBlock = 'loading';
  } else if (isError && !isFetching) {
    stateBlock = (
      <Stack alignItems="center" spacing={0.75} sx={{ py: 1.5 }} data-testid="history-error">
        <EmptyNote icon={AlertTriangle} tone="#b91c1c" title="Could not load the cutting history" hint={errorText} dense />
        <Button size="small" variant="outlined" startIcon={<RefreshCw size={13} />} onClick={refetch}
          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
          Try again
        </Button>
      </Stack>
    );
  } else if (currentData && rows.length === 0) {
    stateBlock = (
      <Stack alignItems="center" spacing={0.5} sx={{ py: 1 }} data-testid="history-empty">
        <EmptyNote icon={Scissors} dense
          title={anyFilter ? 'Nothing matches these filters' : 'No physical coil has been cut yet'}
          hint={anyFilter ? 'Change or reset the filters to see more.' : 'Each coil appears here after its first round is saved with "New Cutting Entry", and updates with every round after that.'} />
        {anyFilter && (
          <Button size="small" onClick={reset} startIcon={<RotateCcw size={13} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
            Reset filters
          </Button>
        )}
      </Stack>
    );
  }
  const showRows = !dateError && stateBlock === null;

  /**
   * Rows per page — 10, 25, 50 or 100 — and the page. Shown over the records
   * and again under them, so it is in reach without scrolling back up; both
   * drive the same state.
   */
  const pager = (testId) => (
    <TablePagination
      component="div" count={total} page={total ? page : 0} rowsPerPage={rowsPerPage}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
      rowsPerPageOptions={ROWS_PER_PAGE}
      labelRowsPerPage="Rows per page:"
      data-testid={testId}
      sx={{
        ml: 'auto', border: 0,
        '& .MuiTablePagination-toolbar': { minHeight: 40, px: 0 },
        '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.76rem', color: O2D.body },
        '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } },
        '& .MuiTablePagination-input': { mr: { xs: 1, sm: 2 } },
        '& .MuiTablePagination-actions': { ml: { xs: 0.5, sm: 1.5 } },
      }}
    />
  );

  return (
    <>
      {/* ── Summary — for exactly the records the filters match, every page ── */}
      {view && (
        <Box sx={{ opacity: stale ? 0.6 : 1 }}>
          <Box data-testid="history-cards" sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: summaryColumns }}>
            <SummaryCard label="Physical Coils" value={num(meta.coils || 0)} icon={Layers} color={O2D.brand}
              sub={`${num(meta.partiallyCut || 0)} partially cut · ${num(meta.fullyCut || 0)} fully cut`}
              onClick={() => setNow('entryType', 'COIL')} actionLabel="Show the physical coil records" active={applied.entryType === 'COIL'}
              testId="card-physical-coils" />
            <SummaryCard label="Total Conversions" value={num(meta.cuts || 0)} icon={Disc3} color="#0f766e" tint="#f3fbf9"
              sub={meta.unlinked
                ? `${num(meta.coilCuts || 0)} on physical coils · ${num(meta.unlinked)} without physical coil`
                : (cutFiltered ? 'Cuts matching the filters' : 'Cutting rounds of these coils')}
              onClick={() => setNow('entryType', '')} actionLabel="Show all records" testId="card-conversions" />
            <SummaryCard label="Total Coil Used" value={`${num(meta.cutKg || 0)} kg`} icon={Scale} color="#4338ca"
              sub={`${num(meta.circlesKg || 0)} kg circles${meta.yieldPct != null ? ` · Yield ${num(meta.yieldPct)}%` : ''}`}
              testId="card-weight" />
            <SummaryCard label="Total Scrap Generated" value={`${num(meta.scrapKg || 0)} kg`} icon={Trash2} color="#b45309" tint="#fffaf2"
              sub={`PLG01 ${num(meta.plantScrapKg || 0)} kg · Job worker ${num(meta.jobWorkScrapKg || 0)} kg`}
              onClick={() => navigate('/scrap-ims/by-coil')} actionLabel="Open Scrap by Physical Coil" testId="card-scrap" />
            <AvailableCirclesCard circleSkuId={applied.circleSkuId} onOpen={() => navigate('/rm-ims/stock?kind=CIRCLE')} />
          </Box>
          {/* What the cards cover — and the two figures too long for a card. */}
          {!dateError && (
            <Typography data-testid="history-totals-scope" sx={{ mt: 0.75, fontSize: '0.68rem', color: O2D.sub }}>
              {meta.filtered
                ? `The weights add up the ${plural(meta.cuts || 0, 'matching cut')} (of ${num(meta.allCuts || 0)} recorded) — every page, each cut once. Coils are counted, never added.`
                : `The weights add up all ${plural(meta.cuts || 0, 'recorded cut')} — every page, each cut once. Coils are counted, never added.`}
              {meta.avgYieldPct != null && ` Yield averaged per cut: ${num(meta.avgYieldPct)}%.`}
              {meta.pendingKg > 0.005 && ` ${num(meta.pendingKg)} kg was cut in partial rounds whose circles come with the coil's full cut — it is in Coil Used, not yet in circles, scrap or yield.`}
              {meta.unplacedScrapKg > 0.005 && ` ${num(meta.unplacedScrapKg)} kg of the scrap has no recorded cutting location.`}
              {' Available Circles is the circle stock right now, all locations — the dates do not change it.'}
            </Typography>
          )}
        </Box>
      )}

      {/* ── Search and filters ── */}
      <CuttingFilterBar filters={filters} circleList={circleList} coilList={coilList} testId="history-filters">
        {!dateError && (cutFiltered || applied.status || applied.location) && (
          <Typography sx={{ mt: 1, fontSize: '0.66rem', color: O2D.sub }} data-testid="history-filter-note">
            {cutFiltered && 'Dates, coil, circle, location, batch and search are matched against each cut. A coil is listed when one of its cuts matches them all; its row still shows the whole coil, and the cards add up only the matching cuts. '}
            {applied.status && 'Cutting status belongs to a physical coil, so a cut that names no physical coil is not listed under a status. '}
            {applied.location && 'Location is where each cut was made (its scrap record — for an imported cut, its own Summary Scrap row); a cut with no recorded location is listed only under All locations.'}
          </Typography>
        )}
      </CuttingFilterBar>

      {/* ── The records ── */}
      <Paper elevation={0} ref={recordsRef} sx={{ ...panelSx, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: { xs: 1.25, md: 1.75 }, pt: 1.5, pb: 0.5 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha(O2D.brand, 0.08), color: O2D.brand, flexShrink: 0 }}>
            <History size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={{ fontSize: '0.92rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.25 }}>Coil to Circle history</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
              One row per physical coil, totalled across its cutting rounds — open it for each round. A cut that names no physical coil is a row of its own.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap columnGap={1.5} rowGap={0.5}
          sx={{ px: { xs: 1.25, md: 1.75 }, py: 1, borderBottom: `1px solid ${O2D.lineSoft}`, opacity: stale ? 0.6 : 1 }}>
          <RecordTabs segments={!dateError && view ? meta.segments : null} entryType={applied.entryType} onPick={(v) => setNow('entryType', v)} />
          {pager('history-pagination')}
        </Stack>

        {cards ? (
          // ── Below md: one card per record ──
          <Box role="region" aria-label="Coil to Circle history" aria-busy={isFetching} sx={{ p: 1.25, opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }}>
            {stateBlock === 'loading' && [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={120} sx={{ mb: 1 }} />)}
            {stateBlock && stateBlock !== 'loading' && stateBlock}
            {showRows && (
              <Box data-testid="history-records" sx={{ display: 'grid', gap: 1, alignItems: 'start', gridTemplateColumns: recordsWidth >= CARDS_TWO_UP ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
                {rows.map((r, i) => (
                  <LedgerCard key={r.id} r={r} sno={rowBase + i + 1} isOpen={openId === r.id} onToggle={() => toggle(r.id)}
                    onMenu={onMenu} onCutCoil={onCutCoil} cutFiltered={cutFiltered} matchedIds={matchedSets.get(r.id)} />
                ))}
              </Box>
            )}
          </Box>
        ) : (
          // ── From md: the table. A size container, so opened details can take
          //    exactly the visible width of this scroller (100cqw). ──
          <TableScroll sx={historyScrollSx}>
            <Table size="small" sx={{ ...historyTableSx(showType), opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} aria-label="Coil to Circle history" aria-busy={isFetching}>
              <TableHead>
                <TableRow>
                  <TableCell sx={colSx('expand')} />
                  <TableCell align="center" sx={colSx('sno')}>S.No.</TableCell>
                  {/* The columns read first, in view without scrolling … */}
                  <TableCell sx={colSx('sku')}>Coil SKU / Item</TableCell>
                  <TableCell sx={colSx('batch')}>Batch / Coil</TableCell>
                  <TableCell align="center" sx={colSx('cut')}>Coil Used (kg)</TableCell>
                  <TableCell sx={colSx('circleSku')}>Circle SKU</TableCell>
                  <TableCell align="center" sx={colSx('circles')}>Circles<Box component="span" sx={{ display: 'block', fontWeight: 600, color: O2D.sub, fontSize: '0.64rem' }}>Pcs | kg</Box></TableCell>
                  <TableCell align="center" sx={colSx('scrap')}>Scrap (kg)</TableCell>
                  <TableCell align="center" sx={colSx('yield')}>Yield</TableCell>
                  <TableCell align="center" sx={colSx('status')}>Status</TableCell>
                  {/* … then the details, scrolled to. */}
                  <TableCell align="center" sx={colSx('left')}>Coil Left (kg)</TableCell>
                  <TableCell align="center" sx={colSx('date')}>Date</TableCell>
                  <TableCell sx={colSx('source')}>GRN / Source</TableCell>
                  <TableCell align="center" sx={colSx('location')}>Location</TableCell>
                  {showType && <TableCell align="center" sx={colSx('type')}>Type</TableCell>}
                  <TableCell align="right" sx={{ ...actionCellSx(O2D.surfaceAlt), pr: 1.5 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody data-testid="history-records">
                {stateBlock === 'loading' && [0, 1, 2].map((i) => (
                  <TableRow key={i}><TableCell colSpan={cols}><Skeleton height={28} /></TableCell></TableRow>
                ))}
                {stateBlock && stateBlock !== 'loading' && (
                  <TableRow><TableCell colSpan={cols} sx={{ border: 0, p: 0 }}>{stateBlock}</TableCell></TableRow>
                )}
                {showRows && rows.map((r, i) => (
                  <LedgerRow key={r.id} r={r} sno={rowBase + i + 1} isOpen={openId === r.id} onToggle={() => toggle(r.id)}
                    onMenu={onMenu} onCutCoil={onCutCoil} cutFiltered={cutFiltered} matchedIds={matchedSets.get(r.id)} showType={showType} cols={cols} />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}

        {/* The same rows-per-page and paging, under the records. */}
        {view && !dateError && total > 0 && (
          <Stack direction="row" sx={{ px: { xs: 1.25, md: 1.75 }, borderTop: `1px solid ${O2D.lineSoft}`, opacity: stale ? 0.6 : 1 }}>
            {pager('history-pagination-bottom')}
          </Stack>
        )}

        {/* How many of the listed rows are cuts that name no physical coil —
            counted on the server over every page, and only once it is KNOWN:
            a "0" shown while loading would be a false fact. */}
        {view && !dateError && total > 0 && (
          <Stack direction="row" spacing={0.6} alignItems="flex-start" sx={{ px: { xs: 1.25, md: 1.75 }, py: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
            <Box sx={{ color: O2D.faint, display: 'flex', mt: 0.15 }}><HelpCircle size={13} /></Box>
            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }} data-testid="cut-history-untraceable">
              {meta.unlinked
                ? `${plural(meta.unlinked, 'row')} ${meta.unlinked === 1 ? 'is a cut' : 'are cuts'} (${num(meta.unlinkedCutKg || 0)} kg) that name${meta.unlinked === 1 ? 's' : ''} no physical coil — spreadsheet imports or “No receipt available”. Each is listed on its own, never attached to a coil by its batch number.`
                : 'Every row here is a physical coil.'}
            </Typography>
          </Stack>
        )}
      </Paper>

      {/* ── A row's actions ── */}
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { borderRadius: '8px', border: `1px solid ${O2D.line}`, minWidth: 210 } } }}>
        {/* A partially cut coil's two next steps — the same form either way,
            opened for this coil with the cutting type chosen. */}
        {menu && onCutCoil && menu.row.kind === 'COIL' && menu.row.status === 'PARTIALLY_CUT' && [
          <MenuItem key="full" data-testid="row-action-full-cut" onClick={() => { closeMenu(); onCutCoil(menu.row, 'FULL'); }} sx={{ fontSize: '0.8rem' }}>
            <ListItemIcon><CheckCheck size={15} /></ListItemIcon>
            Full cut — finish this coil
          </MenuItem>,
          <MenuItem key="partial" data-testid="row-action-partial-cut" onClick={() => { closeMenu(); onCutCoil(menu.row, 'PARTIAL'); }} sx={{ fontSize: '0.8rem' }}>
            <ListItemIcon><Scissors size={15} /></ListItemIcon>
            Partial cut — cut some more
          </MenuItem>,
        ]}
        {menu && (
          <MenuItem data-testid="row-action-toggle" onClick={() => { toggle(menu.row.id); closeMenu(); }} sx={{ fontSize: '0.8rem' }}>
            <ListItemIcon><ListTree size={15} /></ListItemIcon>
            {openId === menu.row.id
              ? (menu.row.kind === 'COIL' ? 'Hide cutting rounds' : 'Hide details')
              : (menu.row.kind === 'COIL' ? 'Show cutting rounds' : 'Show details')}
          </MenuItem>
        )}
        {menu && menu.row.kind === 'COIL' && (
          <MenuItem data-testid="row-action-coil-page" onClick={() => { closeMenu(); navigate(`/rm-ims/coil/${menu.row.id}`); }} sx={{ fontSize: '0.8rem' }}>
            <ListItemIcon><ArrowUpRight size={15} /></ListItemIcon>
            Open coil page
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

export default CuttingHistoryPanel;
