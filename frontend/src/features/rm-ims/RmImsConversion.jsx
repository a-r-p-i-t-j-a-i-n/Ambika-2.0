import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, MenuItem,
  FormControlLabel, Switch, Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
  Tooltip, LinearProgress, Radio, RadioGroup, FormControl, FormLabel,
} from '@mui/material';
import {
  Recycle, Plus, Trash2, Save, Disc3, CircleDashed, AlertTriangle, Info, Scissors, ArrowUpRight,
} from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { FIELD } from '../ims/imsFieldHelp';

import {
  RmShell, Panel, TableScroll, KpiTile, EmptyNote, Th, StepHead, KindChip, YieldChip, ScrapChip, yieldBand,
  CutStatusChip, cuttingStatusOf,
  newRequestId,
  RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx,
} from './rmImsMeta';
import {
  useGetRmOverviewQuery, useGetRmConversionsQuery, useGetRmReceivedCoilsQuery,
  useGetRmCircleOptionsQuery, useGetRmCoilLineageQuery, useRmConvertMutation,
} from '../../store/api/rmImsApi';
import CuttingHistoryPanel from './CuttingHistoryPanel';

const H = FIELD.rm;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const blankCircle = () => ({ sku: null, sizeLabel: '', pcs: '', weightKg: '' });

/**
 * "Scrap checked?" — has the scrap this cut produced been physically weighed
 * and verified, full stop. Exactly two states, on purpose: this field answers
 * ONE question, and it is not "where was this cut done" — that question has
 * its own field two boxes over ("Received At"), which is what actually decides
 * whether the scrap becomes Ambika-owned stock (see the warning below the
 * fields). A PLG01 cut and a JW001 cut can each be "Not yet checked" or
 * "Verified" — the two ideas are independent, and conflating them is exactly
 * the mistake this list used to invite (a third option here once read "Sent
 * for job work", which was really restating the location, not a verification
 * state).
 *
 * The model/ScrapRecord enum still carries that old third value (`JOB_WORK`)
 * and a fourth (`REJECTED`) for historical rows imported before this screen
 * existed — neither is removed from the data, only from this picker, so
 * nothing already recorded changes meaning. See coilConversion.model.js.
 */
const SCRAP_STATES = [
  { value: 'PENDING', label: 'Not yet checked', hint: 'Scrap weight has not been physically verified against the store.' },
  { value: 'DONE', label: 'Verified', hint: 'Scrap has been weighed and accounted for.' },
];

const RmImsConversion = () => {
  const navigate = useNavigate();
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);
  // Only coils the Coil → Circle sheet maps can be cut here. The server says
  // which (`circleMapped`, from coil-circle-map.js) — no list is kept on this
  // side. An unmapped SKU stays in RM stock; it just is not offered for cutting.
  const coils = useMemo(() => items.filter((i) => i.kind === 'COIL' && i.circleMapped), [items]);
  const circleSkus = useMemo(() => items.filter((i) => i.kind === 'CIRCLE'), [items]);
  const { data: convRes } = useGetRmConversionsQuery({ limit: 50 });
  const conversions = convRes?.data || [];
  const totals = convRes?.meta || {};
  const [convert, { isLoading }] = useRmConvertMutation();

  const [coil, setCoil] = useState(null);
  // The received coil the typed batch number resolved to, when it resolved to
  // one. Extra knowledge about the same cut — it replaces nothing on screen.
  const [receipt, setReceipt] = useState(null);
  // "Full cutting" / "Partial cutting" — the operator's choice for THIS round,
  // asked only once a physical coil is linked. Never pre-selected. Stored with
  // the coil it was made for (see `cutType` below).
  const [cutChoice, setCutChoice] = useState({ coilKey: null, type: null });
  const [debouncedBatch, setDebouncedBatch] = useState('');
  // The coil the last saved cut came off, so its full history is one click away
  // while it is still the thing the operator is thinking about.
  const [lastCut, setLastCut] = useState(null);
  // One id per submission, so a double-click, a browser retry or a second tab
  // are recognised as the same cut instead of cutting the coil twice. A fresh
  // id is taken only after a SUCCESSFUL save, so correcting a rejected cut and
  // trying again is still accepted.
  const [requestId, setRequestId] = useState(newRequestId);
  const [head, setHead] = useState({
    conversionDate: dayjs().format('YYYY-MM-DD'), batchNo: '', coilWeightKg: '', rate: '',
    scrapVerified: 'PENDING', allowNegative: false,
    /**
     * "This coil genuinely has no goods receipt behind it."
     *
     * The deliberate escape hatch. A cut that names no coil used to be what
     * happened by ACCIDENT — the screen only sent the receipt id while the
     * typed batch text still matched it character for character, so correcting
     * a digit silently threw the lineage away and produced a scrap record that
     * could never be traced back to a coil. Now the server refuses that, and
     * losing the lineage is something the operator has to tick.
     */
    manualFallback: false,
    // Most coil cutting happens at the job worker, not in the plant, so this is
    // recorded per conversion rather than assumed.
    warehouse: DEFAULT_RECEIVED_AT,
  });
  const [circles, setCircles] = useState([blankCircle()]);
  // A cutting-type choice made for one coil says nothing about the next: a
  // different (or cleared) coil — or ticking / unticking "No receipt
  // available" — starts the round over, with neither option selected. The
  // choice is kept together with the coil it was made for, so it simply reads
  // as "not chosen" for any other coil; no effect has to reset it.
  const coilKey = `${receipt?.id || ''}|${head.manualFallback ? 'manual' : ''}`;
  const cutType = cutChoice.coilKey === coilKey ? cutChoice.type : null;
  const setCutType = (type) => setCutChoice({ coilKey: type ? coilKey : null, type });

  /**
   * Which circles THIS coil is approved to produce.
   *
   * The dropdown used to offer every circle in the master, so a Cu 0.7 mm coil
   * could be recorded as having produced DD circles and the ledger took it. The
   * client's mapping sheet now decides, and it is asked for per coil rather
   * than copied into this file — the server holds the one copy, so a size the
   * client adds or drops reaches the floor without a frontend release.
   *
   * Skipped until a coil is known, which is the honest state: before that there
   * is no question to ask, and the dropdown says so instead of guessing.
   */
  const circleOpts = useGetRmCircleOptionsQuery(
    { coilSkuId: coil?.skuId }, { skip: !coil?.skuId },
  );
  const circleMapMeta = circleOpts.data?.meta || {};
  // `mapped === false` means the coil exists but the client's sheet is silent
  // about it. That is NOT a licence to show every circle — it is a gap to take
  // back to the client, so the list stays empty and says why.
  const coilIsMapped = coil ? circleMapMeta.mapped : null;

  /**
   * The approved circles, carrying the stock figures the picker already showed.
   *
   * The mapping endpoint answers "which sizes", the overview answers "how many
   * are in store". Matching them by code keeps the existing two-line option
   * (name over code · N in store) exactly as it was. An approved circle the
   * overview did not return is still offered — the client approved it, and
   * dropping it here would hide a size for a reason the operator cannot see.
   */
  const allowedCircles = useMemo(() => {
    const approved = circleOpts.data?.data || [];
    const byCode = new Map(circleSkus.map((s) => [s.skuCode, s]));
    return approved.map((a) => byCode.get(a.skuCode) || { ...a, onHand: null });
  }, [circleOpts.data, circleSkus]);
  const allowedIds = useMemo(
    () => new Set(allowedCircles.map((c) => String(c.skuId))),
    [allowedCircles],
  );

  /**
   * The batch number fills the rest of the form in.
   *
   * It was already on this screen and already meant "which physical coil this
   * is" — it just went nowhere. Typing one now looks the coil up and fills the
   * fields that were always there. Everything stays editable, nothing moves,
   * and leaving the field blank behaves exactly as it always did.
   */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBatch(head.batchNo.trim()), 350);
    return () => clearTimeout(t);
  }, [head.batchNo]);

  // A batch number is an identifier, not a phrase — below a few characters it
  // would match half the floor, so it is not worth asking the server.
  const lookupTerm = debouncedBatch.length >= 4 ? debouncedBatch : '';
  const { data: lookupRes, isFetching: lookingUp } = useGetRmReceivedCoilsQuery(
    { q: lookupTerm, limit: 5, circleMapped: true }, { skip: !lookupTerm },
  );

  // Only an exact batch match counts. A near miss must not quietly fill the
  // form with a different coil's weight and rate.
  const foundOpen = useMemo(() => (lookupRes?.data || [])
    .find((r) => r.batchNo?.toLowerCase() === lookupTerm.toLowerCase()) || null,
  [lookupRes, lookupTerm]);
  /**
   * A coil cut down to nothing is still a physical coil with a history.
   *
   * The lookup above offers only coils with weight left, so typing the batch of
   * a FULLY CUT coil used to read "no received coil with this batch number" —
   * as though it had never arrived. Only when that exact batch is not among the
   * open coils, ask again including spent ones, so the screen can say "fully
   * cut · 0 kg available" and show its rounds instead.
   */
  const askSpent = !!lookupTerm && !!lookupRes && !lookingUp && !foundOpen;
  const { data: spentRes, isFetching: lookingUpSpent } = useGetRmReceivedCoilsQuery(
    { q: lookupTerm, limit: 10, circleMapped: true, includeConsumed: true }, { skip: !askSpent },
  );
  const found = useMemo(() => foundOpen || (askSpent ? (spentRes?.data || [])
    .find((r) => r.batchNo?.toLowerCase() === lookupTerm.toLowerCase()) || null : null),
  [foundOpen, askSpent, spentRes, lookupTerm]);

  /**
   * Fill the form once per coil, not once per render of this effect.
   *
   * Saving a conversion invalidates the RM overview, so `coils` comes back as a
   * new array and re-runs this effect. Without the guard it re-applied the coil
   * that had just been cut, quietly putting its old available weight back into
   * a form the operator had just emptied — an easy way to save the same cut
   * twice. The id is cleared on submit, so re-typing the batch fills again.
   */
  const appliedCoil = useRef(null);
  // What this effect last wrote into these fields, so it can tell its own
  // value apart from one the operator typed or picked.
  const autoFilled = useRef({ rate: '', warehouse: '' });
  useEffect(() => {
    /**
     * THE SELECTED COIL STAYS SELECTED.
     *
     * This used to `setReceipt(null)` whenever the typed text stopped matching
     * a receipt — so picking the right coil and then fixing a typo in the batch
     * field quietly unlinked the cut, and it saved as an orphan with nothing on
     * screen to say so. The batch box is a SEARCH box; it is not the lineage.
     *
     * So a miss now leaves the bound coil alone and the banner below says which
     * coil is still attached. The binding changes in exactly three ways, all of
     * them deliberate: the text resolves to a DIFFERENT receipt (below), the
     * operator changes the coil SKU, or they clear it by hand.
     */
    if (!found) { appliedCoil.current = null; return; }
    if (appliedCoil.current === found.id) return;
    appliedCoil.current = found.id;
    setReceipt(found);
    setCutChoice({ coilKey: null, type: null }); // a newly linked coil starts a new round
    const match = coils.find((c) => String(c.skuId) === String(found.skuId));
    if (match) setCoil(match);
    const rate = String(found.unitCost ?? '');
    // Where this coil's own GRN recorded it as received — the authority for
    // "Received At", never guessed from the SKU. Blank when the receipt itself
    // carries no location (an old GRN posted before Received At existed).
    const warehouse = found.warehouse || '';
    setHead((h) => ({
      ...h,
      // "Cut this round" is deliberately NOT filled in. A coil is often cut
      // over several rounds, and pre-filling everything that is left turned
      // every save into a full cut unless the operator noticed and corrected
      // it. The operator types this round's weight (or presses "Use all").
      //
      // The rate is filled, but only into a field the operator has not already
      // filled in: the lookup takes a moment, and a value typed while it is in
      // flight must not be replaced when the answer comes back.
      rate: (h.rate === '' || h.rate === autoFilled.current.rate) ? rate : h.rate,
      // Same guard, for the same reason — and it matters more here, because
      // this field decides whose scrap stock gets the offcut. Only applied
      // while the dropdown still shows either the untouched default or this
      // effect's own last answer; a location the operator picked themselves
      // (including while this lookup was still in flight) is left alone.
      warehouse: (warehouse && (h.warehouse === DEFAULT_RECEIVED_AT || h.warehouse === autoFilled.current.warehouse))
        ? warehouse : h.warehouse,
    }));
    autoFilled.current = { rate, warehouse };
  }, [found, coils]);

  /**
   * Does the typed text still describe the coil that is actually bound?
   *
   * Not a problem — the bound coil wins and the cut saves against it — but the
   * operator has to be told, because the two no longer agree on screen and the
   * server will file this cut under the coil, not under what was typed.
   */
  const batchDrifted = !!receipt && head.batchNo.trim().length > 0
    && receipt.batchNo?.toLowerCase() !== head.batchNo.trim().toLowerCase();

  const unmappedBatch = found ? null : (lookupRes?.meta?.unmappedBatch || null);
  const batchHint = (lookingUp || lookingUpSpent) ? 'Looking this coil up…'
    : batchDrifted ? `Still linked to coil ${receipt.batchNo}. Clear it below to cut a different coil.`
      : receipt ? `${receipt.skuName} · ${num(receipt.availableWeight)} kg available to cut · ₹${num(receipt.unitCost)}/kg${receipt.grnNumber ? ` · ${receipt.grnNumber}` : ''}`
        : head.manualFallback ? 'Not being traced to a coil — you ticked "No receipt available".'
          // The batch WAS received, but on a coil with no approved circle sizes —
          // say that, rather than the misleading "not received".
          : (lookupTerm && !lookingUp && unmappedBatch) ? `Batch ${unmappedBatch.batchNo} is a ${unmappedBatch.skuCode} (${unmappedBatch.skuName}) coil. No approved circle sizes are configured for it, so it cannot be cut here.`
          : (lookupTerm && !lookingUp) ? 'No received coil with this batch number. Check it, or tick "No receipt available" below.'
            : 'Identifies the physical coil, so its scrap can be traced back to it.';
  const batchHintColor = batchDrifted ? STOCK_TOKENS.LOW.color
    : receipt ? STOCK_TOKENS.OK.color
      : (lookupTerm && !lookingUp && !receipt) ? STOCK_TOKENS.LOW.color : O2D.sub;

  const setC = (i, k, v) => setCircles((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addC = () => setCircles((p) => [...p, blankCircle()]);
  const delC = (i) => setCircles((p) => (p.length === 1 ? [blankCircle()] : p.filter((_, j) => j !== i)));

  /**
   * Changing the coil drops any circle that coil cannot produce.
   *
   * Someone who fills three rows and then corrects the batch number would
   * otherwise be left holding sizes from the previous coil, with the form
   * looking complete and the server rejecting it on save. Only the SIZE is
   * cleared — the pieces and weight that were physically counted stay, because
   * re-picking a size is a click and re-counting a pallet is not.
   *
   * It waits for the answer rather than clearing on every keystroke: mid-fetch
   * `allowedIds` is the previous coil's, and acting on it would wipe a correct
   * row the instant a coil was re-selected.
   */
  useEffect(() => {
    if (!coil || circleOpts.isFetching || !circleOpts.data) return;
    const dropped = circles.filter((l) => l.sku && !allowedIds.has(String(l.sku.skuId)));
    if (!dropped.length) return;
    setCircles((p) => p.map((l) => (
      l.sku && !allowedIds.has(String(l.sku.skuId)) ? { ...l, sku: null } : l
    )));
    enqueueSnackbar(
      `${dropped.map((d) => d.sku.skuCode).join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not approved for ${coil.skuCode}. Pick an approved size.`,
      { variant: 'warning' },
    );
  }, [coil, allowedIds, circles, circleOpts.isFetching, circleOpts.data]);

  // What the circle picker says when it has nothing to offer. Each state is a
  // different reason, and telling them apart is the point: "pick a coil first"
  // is a step not yet taken, "no approved sizes" is a gap in the client's sheet.
  const circlePlaceholder = !coil ? 'Pick a coil or batch first'
    : circleOpts.isFetching ? 'Loading approved sizes…'
      : coilIsMapped === false ? 'No approved sizes for this coil'
        : `Search an approved circle (${allowedCircles.length})`;
  const circleNoOptions = !coil
    ? 'Pick the coil or batch first — the approved sizes depend on it.'
    : circleOpts.isFetching ? 'Loading approved sizes…'
      : 'No approved circle sizes are configured for this coil.';

  const circlesWeight = round2(circles.reduce((s, c) => s + Number(c.weightKg || 0), 0));

  /**
   * THE PHYSICAL COIL, ROUND BY ROUND — all derived, nothing typed.
   *
   * Original is what its goods receipt says arrived. Available is the batch
   * ledger (Σ IN − Σ OUT) — the very figure the server checks this round
   * against. Already cut is the difference, so the three always add up:
   *
   *     original − already cut = available to cut
   *
   * The lineage endpoint splits "already cut" into the rounds recorded here
   * and any weight that left the batch WITHOUT naming this coil (the
   * spreadsheet-era cuts). That second part is shown, never turned into rounds.
   */
  const lineage = useGetRmCoilLineageQuery(receipt?.id, { skip: !receipt?.id });
  const lin = lineage.data?.meta;
  const linFresh = !!lin && String(lin.receipt?.movementId) === String(receipt?.id);
  const coilFacts = receipt ? (() => {
    const originalKg = round2(linFresh ? lin.receipt.receivedWeightKg : receipt.receivedWeight);
    const availableKg = round2(linFresh ? lin.totals.coil.availableKg : receipt.availableWeight);
    const alreadyCutKg = round2(originalKg - availableKg);
    return {
      originalKg,
      availableKg,
      alreadyCutKg,
      rounds: linFresh ? lin.totals.rounds : null,
      roundsCutKg: linFresh ? lin.totals.cutKg : null,
      otherOutKg: linFresh ? lin.totals.coil.otherOutKg : 0,
      status: linFresh ? lin.totals.coil.status : cuttingStatusOf({ cutKg: alreadyCutKg, remainingKg: availableKg }),
    };
  })() : null;

  /**
   * CUT THIS ROUND — where the weight comes from.
   *
   *   Full cutting    → the coil's remaining weight, read-only. Not typed and
   *                     not copied into the field: it IS coilFacts.availableKg,
   *                     so a refreshed lineage can never leave a stale number
   *                     behind. The server re-checks it against the ledger.
   *   Partial cutting → the weight the operator typed.
   *   No coil linked  → (manual fallback) the weight typed, as it always was.
   *
   * "Cutting type" is the operator's instruction for THIS round. It is not the
   * coil's status, which stays derived from the weights (cuttingStatusOf).
   */
  const isFull = !!coilFacts && cutType === 'FULL';
  const coilWt = isFull ? coilFacts.availableKg : Number(head.coilWeightKg || 0);
  const scrap = round2(coilWt - circlesWeight);
  const yieldPct = coilWt > 0 ? round2((circlesWeight / coilWt) * 100) : 0;
  // A circle line is only complete with BOTH figures: the pieces are what goes
  // into circle stock (circles are counted, not weighed), and the weight is what
  // yield and scrap are worked out from. A line with only a weight used to be
  // accepted and then posted kilograms into a balance counted in pieces.
  const validCircles = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && Number(c.pcs) > 0);
  const missingPcs = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && !(Number(c.pcs) > 0));
  const overCut = scrap < 0;
  // No coil to cut yet: no physical coil linked and "No receipt available" not
  // ticked. The round's controls stay disabled until one of those is true.
  const noCoil = !receipt && !head.manualFallback;
  // Once there is a coil, Full or Partial must be chosen on purpose — never
  // pre-selected. ("No receipt available" can only be Partial.)
  const cutTypeMissing = !noCoil && !cutType;
  // Nothing left on the coil: a full cut has nothing to take.
  const fullImpossible = isFull && coilFacts.availableKg <= 0.001;

  // Where a batch number identified the coil, its own remaining weight is the
  // limit — the item's total across every batch would let a spent coil through.
  const available = coilFacts ? coilFacts.availableKg : Number(coil?.onHand || 0);
  const shortCoil = !!coil && coilWt > available && !head.allowNegative;
  // "Allow cutting more coil than we hold" is ON and this round takes more than
  // the coil has. Allowed — that switch is a deliberate business option — but
  // never silent: the resulting negative balance is spelled out below.
  const overdrawn = !!coil && coilWt > available && head.allowNegative;
  // What this round leaves behind, for the "after this round" summary.
  const after = coilFacts && coilWt > 0 ? (() => {
    const remainingKg = round2(coilFacts.availableKg - coilWt);
    const totalCutKg = round2(coilFacts.alreadyCutKg + coilWt);
    return {
      remainingKg,
      totalCutKg,
      roundNo: (coilFacts.rounds ?? 0) + 1,
      status: cuttingStatusOf({ cutKg: totalCutKg, remainingKg }),
    };
  })() : null;
  const badWeight = !isFull && head.coilWeightKg !== '' && !(coilWt > 0);

  /**
   * TOTAL COIL WEIGHT / ALREADY CUT / REMAINING WEIGHT (+ the coil's status).
   *
   * Information, not inputs: read straight from `coilFacts` — the goods
   * receipt and the batch ledger, the same remaining figure the server checks
   * a round against. Before a coil is linked every value reads "—".
   */
  const tileLabelSx = { fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub };
  const coilFactsTiles = (
    <Box data-testid="coil-facts" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1, mt: receipt ? 1 : 1.5 }}>
      {[
        ['Total coil weight', coilFacts ? `${num(coilFacts.originalKg)} kg` : '—', O2D.ink, 'What this coil weighed on its goods receipt.'],
        ['Already cut', coilFacts ? `${num(coilFacts.alreadyCutKg)} kg` : '—', O2D.body,
          !coilFacts ? 'Every earlier round of this coil.'
            : coilFacts.rounds == null ? 'Loading this coil\'s rounds…'
              : coilFacts.otherOutKg > 0.001
                ? `${coilFacts.rounds} round${coilFacts.rounds === 1 ? '' : 's'} here (${num(coilFacts.roundsCutKg)} kg) + ${num(coilFacts.otherOutKg)} kg earlier, not linked to a round`
                : `${coilFacts.rounds} previous round${coilFacts.rounds === 1 ? '' : 's'}`],
        ['Remaining weight', coilFacts ? `${num(coilFacts.availableKg)} kg` : '—',
          !coilFacts ? O2D.faint : coilFacts.availableKg > 0.001 ? '#0f766e' : STOCK_TOKENS.OUT_OF_STOCK.color,
          'Total coil weight minus already cut — the most this round can take.'],
      ].map(([label, value, color, sub]) => (
        <Box key={label} sx={{ px: 1.1, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 0 }}>
          <Typography sx={tileLabelSx}>{label}</Typography>
          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          <Typography sx={{ fontSize: '0.6rem', color: O2D.faint }}>{sub}</Typography>
        </Box>
      ))}
      <Box sx={{ px: 1.1, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Typography sx={tileLabelSx}>Cutting status</Typography>
        <Box sx={{ mt: 0.4 }}>
          {coilFacts ? <CutStatusChip status={coilFacts.status} /> : <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: O2D.faint }}>—</Typography>}
        </Box>
        <Typography sx={{ fontSize: '0.6rem', color: O2D.faint, mt: 0.3 }}>Worked out from the weights — never set by hand.</Typography>
      </Box>
    </Box>
  );
  // Belt and braces. The dropdown can only offer approved sizes, so this should
  // never be non-empty — but a stale list after a coil change, or a size the
  // client withdrew mid-shift, would otherwise reach the server as a 400 the
  // operator only discovers on save. The server stays the authority either way.
  const blockedCircles = validCircles.filter((c) => !allowedIds.has(String(c.sku.skuId)));
  /**
   * A cut has to say WHICH physical coil it came off.
   *
   * The server refuses one that does not, so the button refuses first — being
   * told at the top of the form beats a 400 after the operator has counted and
   * keyed three pallets of circles. "No receipt available" satisfies it, which
   * is the point: the lineage can still be given up, but only on purpose.
   */
  const lineageMissing = !receipt && !head.manualFallback;
  const ready = !!coil && coilWt > 0 && validCircles.length > 0 && !missingPcs.length
    && !overCut && !shortCoil && !blockedCircles.length && !lineageMissing
    && !cutTypeMissing && !fullImpossible;
  const band = yieldBand(yieldPct);
  const activeLocation = RECEIVED_AT_OPTIONS.find((w) => w.value === head.warehouse);
  /**
   * The operator has picked a DIFFERENT cutting location than the one this
   * coil's own GRN recorded it as received at.
   *
   * Not blocked — a coil can genuinely be received at the plant and sent out
   * for job-work cutting, or the other way round, and the operator standing at
   * the machine is who actually knows which happened (see resolveScrapLocation
   * in rmIms.service.js, which is why the server trusts this field over the
   * receipt). But it is never a SILENT change: whichever location ends up
   * selected is what decides whose scrap stock the offcut lands in, so the
   * override is named and its consequence spelled out below, instead of being
   * one more dropdown a busy operator can click past without noticing.
   */
  const receiptLocation = receipt?.warehouse ? String(receipt.warehouse).toUpperCase() : null;
  const locationOverridden = !!receiptLocation && receiptLocation !== head.warehouse;

  const submit = async () => {
    if (!coil) return enqueueSnackbar('Pick the coil being cut.', { variant: 'warning' });
    if (cutTypeMissing) return enqueueSnackbar('Choose Full cutting or Partial cutting for this round.', { variant: 'warning' });
    if (fullImpossible) return enqueueSnackbar('This coil is already fully cut — nothing is left for a full cut.', { variant: 'error' });
    if (!(coilWt > 0)) return enqueueSnackbar('Enter how much of the coil is cut this round (more than 0 kg).', { variant: 'warning' });
    if (shortCoil) return enqueueSnackbar(`Only ${num(available)} KG is available from this physical coil.`, { variant: 'error' });
    if (missingPcs.length) return enqueueSnackbar('Enter the number of pieces for every circle produced.', { variant: 'warning' });
    if (!validCircles.length) return enqueueSnackbar('Add at least one circle with pieces and a weight.', { variant: 'warning' });
    if (blockedCircles.length) {
      return enqueueSnackbar(
        `${blockedCircles.map((c) => c.sku.skuCode).join(', ')} cannot be produced from coil ${coil.skuCode}.`,
        { variant: 'error' },
      );
    }
    if (lineageMissing) {
      return enqueueSnackbar(
        'Say which physical coil this is — pick it by batch number, or tick "No receipt available" if it genuinely has none.',
        { variant: 'warning' },
      );
    }
    try {
      /**
       * The SELECTED RECEIPT is the parent, full stop.
       *
       * It used to be sent only while `receipt.batchNo === head.batchNo.trim()`
       * still held — so the lineage survived or died on editable text, and a
       * corrected typo silently produced an untraceable cut. The id the picker
       * resolved is what goes to the server; the batch text is a search term
       * and nothing more. The server takes the batch number off the receipt
       * itself, so what is typed cannot corrupt the record either way.
       */
      const res = await convert({
        conversionDate: head.conversionDate, batchNo: head.batchNo || undefined,
        clientRequestId: requestId,
        coilReceiptId: receipt ? receipt.id : undefined,
        // Only meaningful with no receipt, and only ever true because the
        // operator ticked it. Sent explicitly so the server never has to infer
        // intent from an absent field.
        manualFallback: !receipt && head.manualFallback ? true : undefined,
        // Only meaningful for a linked coil. FULL makes the server take the
        // coil's remaining weight — and refuse if it differs from `coilWeightKg`.
        cuttingType: cutType || undefined,
        // No fallback to the grade's master rate: blank means "use this coil's
        // own receipt rate", which the server applies from the linked receipt.
        coilSkuId: coil.skuId, coilWeightKg: coilWt, rate: Number(head.rate || 0),
        scrapVerified: head.scrapVerified, allowNegative: head.allowNegative,
        warehouse: head.warehouse,
        circles: validCircles.map((c) => ({
          circleSkuId: c.sku.skuId, sizeLabel: c.sizeLabel || c.sku.skuName,
          pcs: Number(c.pcs || 0), weightKg: Number(c.weightKg),
        })),
      }).unwrap();
      const saved = res?.data || {};
      enqueueSnackbar(`Conversion ${saved.conversionNumber || ''} saved — yield ${num(saved.yieldRatioPct)}%.`, { variant: 'success' });
      // The server resolved the coil from the batch number because nobody had
      // picked it. Saying so is the honest version of a silent auto-link: the
      // operator can check it took the coil they meant, from the page it took.
      if (saved.receiptBinding === 'AUTO' && saved.coilReceiptId) {
        enqueueSnackbar(`Linked to coil ${saved.batchNo || ''} from its goods receipt — open the coil to see every round.`, { variant: 'info' });
      }
      // The lineage is one click away while the cut is still on the operator's
      // mind, instead of something to go and find later.
      setLastCut(saved.coilReceiptId ? { receiptId: saved.coilReceiptId, batchNo: saved.batchNo || '' } : null);
      setCoil(null);
      setReceipt(null);
      setRequestId(newRequestId());
      // `appliedCoil` is deliberately NOT cleared here. Saving invalidates the
      // coil ledger, which refetches this very lookup while the batch field's
      // debounce has not yet fired — so for a moment the effect still sees the
      // coil that was just cut, now carrying its NEW available weight, and
      // would put that straight back into the form the operator just emptied.
      // Leaving the id set makes the effect skip it. It clears itself a moment
      // later when the empty field resolves to no coil, so typing the same
      // batch again still fills the form.
      // `manualFallback` resets too. It is a statement about ONE coil — "this
      // particular coil has no receipt" — and leaving it on would quietly make
      // the next cut untraceable as well.
      //
      // `warehouse` resets to the default for the same reason: it is a fact
      // about the cut just saved, not a sticky preference for the next one. Left
      // as-is, a JW001 cut followed immediately by typing a new PLG01 batch —
      // with no page reload in between — would leave Received At sitting on
      // JW001 from the PREVIOUS coil. The override warning below would catch it
      // (it never submits silently), but the honest fix is for the next cut to
      // start from the same clean default every other field does.
      // `scrapVerified` resets too, for the identical reason: "has THIS cut's
      // scrap been checked" cannot default to "Verified" for a coil nobody has
      // looked at yet.
      setHead((h) => ({
        ...h, batchNo: '', coilWeightKg: '', rate: '', manualFallback: false,
        warehouse: DEFAULT_RECEIVED_AT, scrapVerified: 'PENDING',
      }));
      setCircles([blankCircle()]);
      setCutType(null);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the conversion.', { variant: 'error' }); }
  };

  return (
    <RmShell
      icon={Recycle}
      title="Cut coils into circles"
      subtitle="One entry takes the coil out of stock, puts the circles in, and records the scrap."
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            <b>Yield</b> is the share of the coil's weight that came out as usable circles — everything else is scrap.
            Watch it batch to batch: a yield that drifts downward usually means blade wear or a change in the cutting
            pattern, and it costs real money.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 — the coil ── */}
      <Panel>
        <StepHead n={1} title="Which coil is being cut?" hint="Pick the physical coil by its batch number, then say how much of it is cut in this round." done={!!coil && coilWt > 0} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr 1fr' }, gap: 1.25, mt: 1.25 }}>
          {/* Batch number first: it is how the operator identifies the physical
              coil, and typing it looks the coil up and fills in the rest. */}
          <TextField size="small" label="Batch number" value={head.batchNo}
            onChange={(e) => setHead((h) => ({ ...h, batchNo: e.target.value }))}
            placeholder="Optional"
            InputProps={{ endAdornment: lookingUp ? <CircularProgress size={13} /> : null }}
            helperText={batchHint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: batchHintColor, mx: 0 } }} />
          <Autocomplete
            size="small" options={coils} value={coil}
            // Picking a coil GRADE never fills the rate. The rate is what was
            // paid for one physical coil, so it comes from that coil's own
            // goods receipt when its batch number is entered — never from the
            // grade's master rate. Changing the grade also unlinks the batch,
            // so a rate that batch filled in goes with it; one the operator
            // typed is left alone.
            onChange={(_, v) => {
              setCoil(v);
              setReceipt(null);
              setCutChoice({ coilKey: null, type: null });
              setHead((h) => ({
                ...h,
                rate: h.rate !== '' && h.rate === autoFilled.current.rate ? '' : h.rate,
              }));
            }}
            getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
            isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
            renderOption={(props, o) => (
              <li {...props} key={o.skuId}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{o.skuCode} · {num(o.onHand)} in store</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => (
              <TextField {...p} label="Coil being cut" placeholder="Search a coil…"
                InputProps={{ ...p.InputProps, startAdornment: <><Disc3 size={14} style={{ marginLeft: 6, marginRight: 2, opacity: 0.55 }} />{p.InputProps.startAdornment}</> }} />
            )}
          />
          <TextField size="small" type="date" label="Date cut" value={head.conversionDate}
            onChange={(e) => setHead((h) => ({ ...h, conversionDate: e.target.value }))}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
        </Box>
        {/* ── WHICH PHYSICAL COIL THIS CUT BELONGS TO ──────────────────────
            The scrap this cut leaves is traced back through here and nowhere
            else, so the state of that link is stated on the form rather than
            left to be discovered later in a report. Three states, three
            different things to say. */}
        {receipt && (
          <Paper elevation={0} sx={{
            mt: 1.5, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${batchDrifted ? STOCK_TOKENS.LOW.border : STOCK_TOKENS.OK.border}`,
            bgcolor: batchDrifted ? STOCK_TOKENS.LOW.tint : STOCK_TOKENS.OK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box sx={{ color: batchDrifted ? STOCK_TOKENS.LOW.color : STOCK_TOKENS.OK.color, display: 'flex' }}>
                {batchDrifted ? <AlertTriangle size={15} /> : <Disc3 size={15} />}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>
                  Physical coil {receipt.batchNo} · {receipt.skuCode}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                  {batchDrifted
                    ? `The batch box now reads "${head.batchNo.trim()}", but this cut stays linked to coil ${receipt.batchNo}. Clear it if that is wrong.`
                    : [receipt.grnNumber && `GRN ${receipt.grnNumber}`, receipt.poNumber && `PO ${receipt.poNumber}`, receipt.supplier]
                      .filter(Boolean).join(' · ') || 'Its scrap will be traceable back to this coil.'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ ml: { sm: 'auto' } }}>
                <Button size="small" endIcon={<ArrowUpRight size={13} />}
                  onClick={() => navigate(`/rm-ims/coil/${receipt.id}`)}
                  sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
                  View this coil's history
                </Button>
                <Button size="small" color="inherit"
                  onClick={() => { setReceipt(null); setCutChoice({ coilKey: null, type: null }); appliedCoil.current = null; }}
                  sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.sub }}>
                  Clear coil
                </Button>
              </Stack>
            </Stack>
            {coilFactsTiles}
          </Paper>
        )}
        {/* No coil yet: the same three figures, shown as "—", so the operator
            sees what will be filled in rather than a gap in the form. */}
        {!receipt && coilFactsTiles}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.5 }}>
          <TextField select size="small" label="Received At" value={head.warehouse}
            onChange={(e) => setHead((h) => ({ ...h, warehouse: e.target.value }))}
            helperText={activeLocation?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}>
            {RECEIVED_AT_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Scrap checked?" value={head.scrapVerified}
            onChange={(e) => setHead((h) => ({ ...h, scrapVerified: e.target.value }))}
            helperText={SCRAP_STATES.find((s) => s.value === head.scrapVerified)?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}>
            {SCRAP_STATES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <TextField size="small" type="number" label="Rate (₹ per kg)" value={head.rate}
            onChange={(e) => setHead((h) => ({ ...h, rate: e.target.value }))}
            helperText={receipt
              ? `From this coil's goods receipt (₹${num(receipt.unitCost)}/kg). Used to value the circles produced.`
              : 'Filled from the coil\'s goods receipt once its batch number is entered. Used to value the circles produced.'}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>

        {/* ── THIS CUTTING ROUND ────────────────────────────────────────────
            With a physical coil linked, the operator says what this round is:
            Full (everything left — the system fills the weight) or Partial
            (type the weight; the rest stays for a later round). That choice is
            the INSTRUCTION for this round; the coil's status after it is still
            worked out from the weights, never from the choice. */}
        <Box data-testid="this-cutting-round" sx={{
          mt: 1.5, px: 1.5, py: 1.25, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt,
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr 1fr' }, gap: 1.5, alignItems: 'start',
        }}>
          {/* Always on screen; usable only once there is a coil to cut.
              Full needs a linked coil (it takes what THAT coil has left), so a
              "No receipt available" cut can only be Partial. */}
          <FormControl disabled={noCoil}>
            <FormLabel id="cut-type-label" sx={{ fontSize: '0.7rem', fontWeight: 800, color: O2D.ink, '&.Mui-focused': { color: O2D.ink }, '&.Mui-disabled': { color: O2D.faint } }}>
              Cutting type
            </FormLabel>
            <RadioGroup row aria-labelledby="cut-type-label" value={cutType || ''}
              onChange={(e) => setCutType(e.target.value)}>
              <FormControlLabel value="FULL" disabled={noCoil || !coilFacts || coilFacts.availableKg <= 0.001}
                control={<Radio size="small" />}
                label={(
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit' }}>Full cutting</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: O2D.sub }}>
                      {!coilFacts ? (noCoil ? 'Choose the coil first' : 'Needs a physical coil')
                        : coilFacts.availableKg > 0.001 ? `Cut everything left — ${num(coilFacts.availableKg)} kg` : 'Nothing left on this coil'}
                    </Typography>
                  </Box>
                )} />
              <FormControlLabel value="PARTIAL" disabled={noCoil} control={<Radio size="small" />}
                label={(
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit' }}>Partial cutting</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: O2D.sub }}>
                      {noCoil ? 'Choose the coil first' : 'Cut part; the rest stays for a later round'}
                    </Typography>
                  </Box>
                )} />
            </RadioGroup>
          </FormControl>

          {/* The weight this round takes. Full: the system's figure, read-only.
              Partial / no coil linked: typed. Sent as `coilWeightKg` — exactly
              what the server deducts from the coil for this round. */}
          <TextField size="small" type="number" label="Cut this round (kg)"
            value={isFull ? String(coilFacts.availableKg) : head.coilWeightKg}
            onChange={(e) => setHead((h) => ({ ...h, coilWeightKg: e.target.value }))}
            disabled={noCoil || cutTypeMissing}
            placeholder={noCoil ? 'Choose the coil first' : cutTypeMissing ? 'Choose Full or Partial first' : undefined}
            InputLabelProps={noCoil || cutTypeMissing ? { shrink: true } : undefined}
            error={shortCoil || badWeight}
            inputProps={{ min: 0, step: 'any', readOnly: isFull }}
            sx={isFull ? { '& .MuiInputBase-root': { bgcolor: O2D.surfaceAlt } } : { '& .MuiInputBase-root': { bgcolor: O2D.surface } }}
            helperText={(
              <>
                {noCoil ? 'Enter the batch number above to choose the coil.'
                  : cutTypeMissing ? 'Choose the cutting type to enter this round\'s weight.'
                  : isFull ? `Full cutting — the whole remaining ${num(coilFacts.availableKg)} kg, set by the system.`
                    : badWeight ? 'Enter a weight above 0 kg. '
                      : shortCoil ? `Only ${num(available)} KG is available from this physical coil. `
                        : coilFacts ? `Up to ${num(coilFacts.availableKg)} kg remaining. `
                          : (coil ? `${num(coil.onHand)} in store. ` : 'Pick a coil first. ')}
                {/* "Use all" is Full cutting — the same calculation, not a copy. */}
                {cutType === 'PARTIAL' && coilFacts && coilFacts.availableKg > 0.001 && (
                  <Box component="button" type="button" onClick={() => setCutType('FULL')}
                    sx={{ p: 0, border: 0, bgcolor: 'transparent', color: O2D.brand, fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>
                    Use all {num(coilFacts.availableKg)} kg (Full cutting)
                  </Box>
                )}
              </>
            )}
            FormHelperTextProps={{ component: 'div', sx: { fontSize: '0.66rem', color: (shortCoil || badWeight) ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.sub, mx: 0 } }} />

          {/* AFTER THIS ROUND — what the round takes and leaves on the coil.
              Derived, before saving; the status is the coil's, from weights. */}
          <Box data-testid="round-outcome" sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>
              After this round
            </Typography>
            {[
              ['Cut this round', after ? `${num(coilWt)} kg` : '—', O2D.ink],
              ['Remaining weight', after ? `${num(after.remainingKg)} kg` : '—',
                after && after.remainingKg < 0 ? STOCK_TOKENS.OUT_OF_STOCK.color : '#0f766e'],
            ].map(([label, value, color]) => (
              <Stack key={label} direction="row" justifyContent="space-between" spacing={1} sx={{ mt: 0.25 }}>
                <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>{label}</Typography>
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
              </Stack>
            ))}
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mt: 0.25 }}>
              <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>Status</Typography>
              {after ? <CutStatusChip status={after.status} /> : <Typography sx={{ fontSize: '0.8rem', color: O2D.faint }}>—</Typography>}
            </Stack>
          </Box>
        </Box>

        {/* Last in the round: the existing over-cut override, unchanged. */}
        <FormControlLabel
          sx={{ mt: 0.75 }}
          control={<Switch size="small" checked={head.allowNegative}
            onChange={(e) => setHead((h) => ({ ...h, allowNegative: e.target.checked }))} />}
          label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow cutting more coil than we hold</Typography>}
        />

        {/* ── Received At was changed away from the GRN's own record ───────
            Spelled out rather than silently accepted: this one field decides
            whether the offcut becomes Ambika scrap stock (PLG01) or stays with
            the job worker (JW001) — see resolveScrapLocation in rmIms.service.js. */}
        {locationOverridden && (
          <Paper elevation={0} sx={{
            mt: 1.5, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.REORDER.border}`, bgcolor: STOCK_TOKENS.REORDER.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ color: STOCK_TOKENS.REORDER.color, display: 'flex', pt: 0.15 }}><AlertTriangle size={16} /></Box>
              <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.REORDER.color }}>
                <b>
                  This coil's GRN recorded it as received at {RECEIVED_AT_OPTIONS.find((w) => w.value === receiptLocation)?.label || receiptLocation},
                  but Received At here is now set to {activeLocation?.label || head.warehouse}.
                </b>{' '}
                {head.warehouse === 'PLG01'
                  ? 'This cut will be recorded as in-house, and its scrap WILL be added to Ambika\'s PLG01 scrap stock.'
                  : 'This cut will be recorded as job-work, and its scrap will NOT be added to Ambika\'s scrap stock.'}{' '}
                Only change this if the coil was genuinely cut somewhere other than where it was received.
              </Typography>
            </Stack>
          </Paper>
        )}

        {/* No physical coil linked yet — last in Step 1, after the fields, so
            it reads as the closing reminder rather than splitting the form. */}
        {!receipt && (
          <Paper elevation={0} sx={{
            mt: 1.5, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${head.manualFallback ? O2D.line : STOCK_TOKENS.LOW.border}`,
            bgcolor: head.manualFallback ? O2D.surfaceAlt : STOCK_TOKENS.LOW.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              <Box sx={{ color: head.manualFallback ? O2D.sub : STOCK_TOKENS.LOW.color, display: 'flex', pt: 0.2 }}>
                <AlertTriangle size={15} />
              </Box>
              <Box sx={{ minWidth: 0, flex: '1 1 320px' }}>
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>
                  {head.manualFallback
                    ? 'This cut will not be traceable to a coil.'
                    : 'No physical coil chosen yet.'}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                  {head.manualFallback
                    ? 'Its scrap will show under “Untraceable” in Scrap IMS, and nobody will be able to ask how much scrap came off this coil. Only use this for a coil that genuinely has no goods receipt.'
                    : 'Type the batch number above to find the coil. Scrap can only be traced back to a coil that was named here.'}
                </Typography>
              </Box>
              <FormControlLabel
                sx={{ ml: { sm: 'auto' }, mr: 0 }}
                control={<Switch size="small" checked={head.manualFallback}
                  onChange={(e) => setHead((h) => ({ ...h, manualFallback: e.target.checked }))} />}
                label={<Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.sub }}>No receipt available</Typography>}
              />
            </Stack>
          </Paper>
        )}
      </Panel>

      {/* Straight from the save to the coil that was just cut. */}
      {lastCut && (
        <Paper elevation={0} sx={{
          borderRadius: '8px', px: 1.5, py: 0.9,
          border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
        }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Disc3 size={15} /></Box>
            <Typography sx={{ fontSize: '0.75rem', color: O2D.body }}>
              Saved against coil <b>{lastCut.batchNo || '—'}</b>.
            </Typography>
            <Button size="small" endIcon={<ArrowUpRight size={13} />} sx={{ ml: { sm: 'auto' }, textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}
              onClick={() => navigate(`/rm-ims/coil/${lastCut.receiptId}`)}>
              See every round on this coil
            </Button>
            <Button size="small" color="inherit" onClick={() => setLastCut(null)}
              sx={{ textTransform: 'none', fontSize: '0.72rem', color: O2D.sub }}>Dismiss</Button>
          </Stack>
        </Paper>
      )}
      {/* ── Step 2 — the circles ── */}
      <Panel>
        <StepHead
          n={2}
          title="What came out?"
          hint={coil
            ? `Only the circle sizes the client has approved for ${coil.skuCode} can be chosen — the pieces made and their weight.`
            : 'Every circle size produced from this coil — the pieces made and their weight.'}
          done={validCircles.length > 0 && !missingPcs.length}
        />

        {/* The client's sheet says nothing about this coil. Showing every circle
            instead would be the exact mistake the mapping exists to stop, so the
            list stays empty and the reason is on screen rather than implied. */}
        {!!coil && coilIsMapped === false && (
          <Paper elevation={0} sx={{
            mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex', pt: 0.15 }}><AlertTriangle size={16} /></Box>
              <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                <b>No approved circle sizes are configured for this coil ({coil.skuCode}).</b>{' '}
                It cannot be cut until its circle mapping is added — ask for the Coil → Circle sheet to be extended.
              </Typography>
            </Stack>
          </Paper>
        )}

        {/* A size the client approved that the SKU master has no active item for.
            Surfaced, never quietly dropped: otherwise a missing SKU looks to the
            floor like the client removed the size. */}
        {!!coil && !!circleMapMeta.missingCodes?.length && (
          <Paper elevation={0} sx={{
            mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.REORDER.border}`, bgcolor: STOCK_TOKENS.REORDER.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ color: STOCK_TOKENS.REORDER.color, display: 'flex', pt: 0.15 }}><AlertTriangle size={16} /></Box>
              <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.REORDER.color }}>
                <b>{circleMapMeta.missingCodes.join(', ')}</b>{' '}
                {circleMapMeta.missingCodes.length > 1 ? 'are approved sizes with no active item' : 'is an approved size with no active item'}{' '}
                in the SKU master, so {circleMapMeta.missingCodes.length > 1 ? 'they cannot' : 'it cannot'} be selected. Tell the store team.
              </Typography>
            </Stack>
          </Paper>
        )}

        <TableScroll sx={{ mt: 1.25, mx: -1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <Table size="small" sx={imsTableSx(860)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Circle produced" hint={H.circleProduced} /></TableCell>
                <TableCell><Th label="Size label" hint={H.sizeLabel} /></TableCell>
                {/* Both figures are required, and they do different jobs: PIECES go
                    into circle stock, WEIGHT drives yield and scrap. */}
                <TableCell align="right"><Th label="Pieces (PCS)" hint={H.pieces} /></TableCell>
                <TableCell align="right"><Th label="Circle weight (kg)" hint={H.weightKg} /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {circles.map((c, i) => (
                <TableRow key={i} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell sx={{ minWidth: 270 }}>
                    {/* Every row reads the SAME approved list, so adding a row
                        is not a way round the mapping. Disabled until a coil is
                        known, because until then there is no approved list. */}
                    <Autocomplete
                      size="small" options={allowedCircles} value={c.sku} onChange={(_, v) => setC(i, 'sku', v)}
                      disabled={!coil}
                      loading={!!coil && circleOpts.isFetching}
                      noOptionsText={circleNoOptions}
                      getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                      isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                      renderOption={(props, o) => (
                        <li {...props} key={o.skuId}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
                            {/* A circle the client approved that the overview did
                                not price yet has no stock figure — say nothing
                                rather than print a zero it does not mean. */}
                            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                              {o.skuCode}{Number.isFinite(o.onHand) ? ` · ${num(o.onHand)} in store` : ''}
                            </Typography>
                          </Box>
                        </li>
                      )}
                      renderInput={(p) => (
                        <TextField {...p} placeholder={circlePlaceholder}
                          InputProps={{ ...p.InputProps, startAdornment: <><CircleDashed size={14} style={{ marginLeft: 6, marginRight: 2, opacity: 0.55 }} />{p.InputProps.startAdornment}</> }} />
                      )}
                    />
                  </TableCell>
                  <TableCell sx={{ width: 210 }}>
                    <TextField size="small" value={c.sizeLabel} onChange={(e) => setC(i, 'sizeLabel', e.target.value)}
                      placeholder={'e.g. Cu - 0.8mm - 8.50"'} fullWidth />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>
                    <TextField size="small" type="number" value={c.pcs} onChange={(e) => setC(i, 'pcs', e.target.value)}
                      error={!!c.sku && Number(c.weightKg) > 0 && !(Number(c.pcs) > 0)}
                      inputProps={{ min: 0, style: { textAlign: 'right', width: 66, fontWeight: 700 },
                        'aria-label': `Pieces produced — ${c.sku?.skuName || 'circle'}` }} placeholder="0" />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 130 }}>
                    <TextField size="small" type="number" value={c.weightKg} onChange={(e) => setC(i, 'weightKg', e.target.value)}
                      inputProps={{ min: 0, style: { textAlign: 'right', width: 78, fontWeight: 700 } }} placeholder="0" />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Tooltip arrow slotProps={O2D_TIP} title="Clear this line">
                      <IconButton size="small" onClick={() => delC(i)} sx={{ color: O2D.faint, '&:hover': { color: STOCK_TOKENS.OUT_OF_STOCK.color } }}>
                        <Trash2 size={15} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
        <Button size="small" startIcon={<Plus size={14} />} onClick={addC}
          sx={{ mt: 1.25, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', color: O2D.brand }}>
          Add another circle size
        </Button>
      </Panel>

      {/* ── Step 3 — the arithmetic, live ── */}
      <Panel>
        <StepHead n={3} title="Check the balance" hint="This round: coil cut, circles out, scrap — and what is left on the coil afterwards." done={ready} />
        <Box sx={{ mt: 1.25 }}>
          {/* A single bar reading left to right: usable circles, then scrap.
              A reader sees the split without doing the division themselves.
              Everything here is THIS ROUND's — scrap and yield are against
              what was cut this round, never against the original coil. */}
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.6 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.sub, mr: 'auto' }}>
              {coilWt > 0 ? `${num(circlesWeight)}kg of usable circles from ${num(coilWt)}kg cut this round` : 'Enter "Cut this round" to see the split'}
            </Typography>
            {coilWt > 0 && <YieldChip pct={yieldPct} />}
          </Stack>
          <LinearProgress
            variant="determinate"
            value={coilWt > 0 ? Math.min(100, Math.max(0, yieldPct)) : 0}
            sx={{
              height: 10, borderRadius: 5, bgcolor: overCut ? STOCK_TOKENS.OUT_OF_STOCK.bg : '#fef3c7',
              '& .MuiLinearProgress-bar': { borderRadius: 5, bgcolor: band.color },
            }}
          />
          <Typography sx={{ mt: 1, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.sub }}>
            This round
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap data-testid="this-round">
            {[
              ['Cut', `${num(coilWt)} kg`, O2D.body, 'The coil weight taken out of stock in this round.'],
              ['Circle output', `${num(circlesWeight)} kg`, '#4338ca', 'The weight of circles this round produced.'],
              ['Scrap', `${num(scrap)} kg`, overCut ? STOCK_TOKENS.OUT_OF_STOCK.color : '#b45309', 'Cut this round minus this round\'s circle weight.'],
              ['Yield', `${num(yieldPct)}%`, band.color, 'This round\'s circle weight ÷ what was cut this round.'],
            ].map(([label, value, color, hint]) => (
              <Tooltip key={label} arrow slotProps={O2D_TIP} title={hint}>
                <Box sx={{
                  px: 1.25, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`,
                  bgcolor: O2D.surface, minWidth: 106, cursor: 'help',
                }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                </Box>
              </Tooltip>
            ))}
          </Stack>

          {/* What the PHYSICAL COIL looks like once this round is saved. Only
              for a coil identified by its receipt — without one there is no
              coil to say anything about. */}
          {coilFacts && (
            <>
              <Typography sx={{ mt: 1.25, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.sub }}>
                After this round{after ? ` · round ${after.roundNo} of coil ${receipt.batchNo}` : ''}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap alignItems="stretch" data-testid="after-round">
                {[
                  ['Cutting type', cutType === 'FULL' ? 'Full' : cutType === 'PARTIAL' ? 'Partial' : '—', O2D.ink],
                  ['Total coil', `${num(coilFacts.originalKg)} kg`, O2D.ink],
                  ['Already cut', `${num(coilFacts.alreadyCutKg)} kg`, O2D.body],
                  ['This round', `${num(coilWt)} kg`, O2D.body],
                  ['Remaining', after ? `${num(after.remainingKg)} kg` : `${num(coilFacts.availableKg)} kg`,
                    after && after.remainingKg < 0 ? STOCK_TOKENS.OUT_OF_STOCK.color : '#0f766e'],
                ].map(([label, value, color]) => (
                  <Box key={label} sx={{ px: 1.25, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 106 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>{label}</Typography>
                    <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                  </Box>
                ))}
                <Box sx={{ px: 1.25, py: 0.7, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 106 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>Physical coil status</Typography>
                  <Box sx={{ mt: 0.35 }}><CutStatusChip status={after ? after.status : coilFacts.status} /></Box>
                </Box>
              </Stack>
            </>
          )}

          {missingPcs.length > 0 && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.REORDER.border}`, bgcolor: STOCK_TOKENS.REORDER.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ color: STOCK_TOKENS.REORDER.color, display: 'flex', pt: 0.15 }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', color: STOCK_TOKENS.REORDER.color }}>
                  <b>{missingPcs.length} circle line{missingPcs.length > 1 ? 's have' : ' has'} a weight but no piece count.</b>{' '}
                  Circles are stocked in pieces, so without it the weight would be added to a balance counted in pieces.
                </Typography>
              </Stack>
            </Paper>
          )}
          {overCut && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  The circles weigh {num(Math.abs(scrap))}kg more than the coil. Metal cannot be created — check the weights.
                </Typography>
              </Stack>
            </Paper>
          )}
          {!overCut && shortCoil && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  {receipt
                    ? `Only ${num(available)} KG is available from this physical coil.`
                    : `Only ${num(available)}kg of this coil is in stock.`}{' '}
                  Correct "Cut this round", or turn on "Allow cutting more coil than we hold" above.
                </Typography>
              </Stack>
            </Paper>
          )}
          {!overCut && overdrawn && (
            <Paper elevation={0} data-testid="overdrawn-warning" sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  Over-cut: this round takes {num(coilWt)} KG but only {num(available)} KG is available
                  {receipt ? ' from this physical coil' : ''}. Saving will leave {num(round2(available - coilWt))} KG
                  (over by {num(round2(coilWt - available))} KG), because "Allow cutting more coil than we hold" is on.
                </Typography>
              </Stack>
            </Paper>
          )}
          {ready && yieldPct < 85 && (
            <Paper elevation={0} sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: '1px solid #fde68a', bgcolor: '#fffbeb',
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: '#b45309', display: 'flex' }}><Scissors size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#b45309' }}>
                  {num(100 - yieldPct)}% of this coil is going to scrap. Worth a look at the cutting pattern before saving.
                </Typography>
              </Stack>
            </Paper>
          )}

          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Save this conversion
            </Button>
          </Stack>
        </Box>
      </Panel>

      {/* ── Cutting History — one row per physical coil, rounds on expand ── */}
      <CuttingHistoryPanel />

      {/* ── Past conversions ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        {/* These four cover EVERY recorded cut, not just the page listed below,
            so the subtitle says how many — otherwise the reader assumes the two
            match. */}
        <KpiTile label="Coil consumed" value={`${num(totals.coilKg)} kg`}
          sub={totals.conversionCount ? `Across all ${num(totals.conversionCount)} recorded cuts` : 'Across recorded conversions'}
          color="#0f766e" icon={Disc3} />
        <KpiTile label="Circles produced" value={`${num(totals.circlesKg)} kg`} sub="Added back to stock" color="#4338ca" icon={CircleDashed} />
        <KpiTile label="Scrap" value={`${num(totals.scrapKg)} kg`} sub="Offcuts and losses" color="#b45309" icon={Trash2} />
        <KpiTile label="Average yield" value={`${num(totals.avgYield)}%`} sub="Higher is better"
          color={yieldBand(totals.avgYield).color} icon={Recycle} />
      </Stack>

      <Panel title="Past conversions" icon={Recycle}
        hint={totals.conversionCount > conversions.length
          ? `The ${num(conversions.length)} most recent of ${num(totals.conversionCount)} cuts. The totals above cover all of them.`
          : 'Every coil cut so far, newest first.'}
        dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1060)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Coil</TableCell>
                <TableCell><Th label="Came from" hint={H.reference} /></TableCell>
                <TableCell align="right">Coil used</TableCell>
                <TableCell align="right">Circles made</TableCell>
                <TableCell align="right">Scrap</TableCell>
                <TableCell><Th label="Yield" hint={H.yieldPct} /></TableCell>
                <TableCell>Scrap checked?</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {conversions.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={Recycle} title="No coils cut yet"
                    hint="Record your first conversion above and the batch history will build up here." />
                </TableCell></TableRow>
              )}
              {conversions.map((c, i) => (
                <TableRow key={c._id} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: O2D.ink }}>{dayjs(c.conversionDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{c.batchNo || '—'}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>{c.conversionNumber}</Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <KindChip kind="COIL" withHint={false} />
                      <Typography noWrap sx={{ fontSize: '0.78rem', color: O2D.body }} title={c.coilSkuName}>{c.coilSkuCode}</Typography>
                    </Stack>
                  </TableCell>
                  {/* Traceable back to the delivery, where the cut recorded it. */}
                  <TableCell sx={{ maxWidth: 190 }}>
                    {c.receipt ? (
                      <Tooltip arrow slotProps={O2D_TIP} title={[
                        c.receipt.grnNumber && `GRN ${c.receipt.grnNumber}`,
                        c.receipt.poNumber && `PO ${c.receipt.poNumber}`,
                        c.receipt.supplier,
                        c.receipt.receivedDate && `received ${dayjs(c.receipt.receivedDate).format('DD MMM YYYY')}`,
                        c.receipt.unitCost && `₹${num(c.receipt.unitCost)}/kg`,
                      ].filter(Boolean).join(' · ') || 'Goods receipt recorded'}>
                        {/* The link is offered ONLY where a physical receipt is
                            known. A row with no `coilReceiptId` has a grade and
                            not a coil, and a link that opened "some coil of this
                            material" would be a lie dressed as traceability. */}
                        <Box
                          role="button" tabIndex={0}
                          onClick={() => navigate(`/rm-ims/coil/${c.coilReceiptId}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/rm-ims/coil/${c.coilReceiptId}`); }}
                          sx={{
                            minWidth: 0, cursor: 'pointer', borderRadius: '4px',
                            '&:hover .lin': { textDecoration: 'underline' },
                          }}
                        >
                          <Typography noWrap className="lin" sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.brand }}>
                            {c.receipt.grnNumber || c.receipt.poNumber || c.receipt.movementNumber}
                          </Typography>
                          <Typography noWrap sx={{ fontSize: '0.64rem', color: O2D.sub }}>
                            {c.receipt.supplier || c.receipt.warehouse || '—'}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ) : (
                      <Tooltip arrow slotProps={O2D_TIP}
                        title="This cut names no goods receipt, so its scrap cannot be traced to a physical coil. Every historical cut is like this, and nothing is guessed after the fact.">
                        <Typography sx={{ fontSize: '0.7rem', color: O2D.faint, cursor: 'help' }}>untraceable</Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.coilWeightKg)} kg</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#4338ca', fontWeight: 700 }}>{num(c.circlesWeightKg)} kg</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{num(c.scrapKg)} kg</TableCell>
                  <TableCell><YieldChip pct={c.yieldRatioPct} /></TableCell>
                  <TableCell><ScrapChip state={c.scrapVerified} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>
    </RmShell>
  );
};

export default RmImsConversion;
