import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, MenuItem,
  FormControlLabel, Switch, Checkbox, Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
  Tooltip, LinearProgress, Radio, RadioGroup, FormControl, FormLabel,
} from '@mui/material';
import {
  Plus, Trash2, Save, Disc3, CircleDashed, AlertTriangle, Scissors, ArrowUpRight,
  Receipt, Pencil,
} from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { FIELD } from '../ims/imsFieldHelp';

import {
  Panel, TableScroll, Th, StepHead, YieldChip, yieldBand,
  CutStatusChip, cuttingStatusOf,
  newRequestId,
  RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx,
} from './rmImsMeta';
import {
  useGetRmOverviewQuery, useGetRmReceivedCoilsQuery, useGetRmCuttingHistoryQuery,
  useGetRmCircleOptionsQuery, useGetRmCoilLineageQuery, useRmConvertMutation, useLookupRmManualCoilQuery,
} from '../../store/api/rmImsApi';

const H = FIELD.rm;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const blankCircle = () => ({ sku: null, sizeLabel: '', pcs: '', weightKg: '' });
// How two batch numbers are compared on this screen: trimmed, any case.
const batchKey = (b) => String(b || '').trim().toLowerCase();

/**
 * One option in the Batch Number dropdown — a physical coil, whichever way it
 * is recorded. A received coil is a GRN_IN row from /rm-ims/received-coils; a
 * manual coil (no GRN) comes from the manual-coil lookup or the cutting
 * history. Both are reduced to the same few identifying fields for display.
 */
const grnOption = (r) => ({
  kind: 'GRN', key: `grn:${r.id}`, batchNo: r.batchNo || '', skuCode: r.skuCode, skuName: r.skuName,
  ref: r.grnNumber || r.grnRegisterNumber || r.movementNumber || '', supplier: r.supplier || '',
  // Never more than this receipt held: a batch on two receipts of one coil
  // grade shares one ledger, which would otherwise show the pair's weight.
  location: r.warehouse || '', date: r.receivedDate,
  remainingKg: Math.min(Number(r.availableWeight), Number(r.receivedWeight)), originalKg: r.receivedWeight,
  partiallyCut: !!r.partiallyCut, historical: r.grnSource === 'EXCEL_GRN', row: r,
});
const manualOption = (m) => ({
  kind: 'MANUAL', key: `mc:${m.id || m.manualCoilId}`, batchNo: m.batchNo || '', skuCode: m.skuCode,
  skuName: m.skuName || m.itemName || '', ref: '', supplier: '', location: m.warehouse || m.receivedAt || '',
  date: m.enteredAt || m.receivedDate, remainingKg: m.availableKg ?? m.remainingKg, originalKg: m.originalWeightKg ?? m.receivedKg,
  row: m,
});

/**
 * "Scrap checked?" — has the scrap this cut produced been physically weighed
 * and verified, full stop. Exactly two states, on purpose: this field answers
 * ONE question, and it is not "where was this cut done" — that question has
 * its own field ("Received At"), which is what actually decides whether the
 * scrap becomes Ambika-owned stock (see the override warning below). A PLG01
 * cut and a JW001 cut can each be "Not yet checked" or "Verified" — the two
 * ideas are independent, and conflating them is exactly the mistake this
 * list used to invite (a third option here once read "Sent for job work",
 * which was really restating the location, not a verification state).
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

const capsSx = { fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub };
const helperSx = (color = O2D.sub) => ({ component: 'div', sx: { fontSize: '0.66rem', color, mx: 0 } });
const linkSx = { p: 0, border: 0, bgcolor: 'transparent', color: O2D.brand, fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline' };

/**
 * THE COIL → CIRCLE ENTRY FORM — one cutting round of one physical coil.
 *
 * Opened from the "+ Coil to Circle" button on the Coil to Circle page, in a
 * dialog. Everything the form does is its own and unchanged by where it sits:
 * the coil lookup, Full / Partial, the approved-circle mapping, the stock and
 * over-cut checks, and the one-id-per-submission duplicate guard.
 *
 *   onSaved(saved)          after the server accepted the round — the page
 *                           closes the dialog; the history refreshes itself
 *                           through RTK Query's tags.
 *   onCancel()              the operator wants out (the page asks first if
 *                           anything has been entered).
 *   onStateChange({ dirty, saving })   so the page knows whether closing
 *                           would lose input, and never closes mid-save.
 *
 * A failed save leaves every field exactly as it was, with the server's own
 * message on screen, so it can be corrected and saved again.
 */
const CoilToCircleForm = ({ onSaved, onCancel, onStateChange }) => {
  const navigate = useNavigate();
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);
  // Only coils the Coil → Circle sheet maps can be cut here. The server says
  // which (`circleMapped`, from coil-circle-map.js) — no list is kept on this
  // side. An unmapped SKU stays in RM stock; it just is not offered for cutting.
  const coils = useMemo(() => items.filter((i) => i.kind === 'COIL' && i.circleMapped), [items]);
  const circleSkus = useMemo(() => items.filter((i) => i.kind === 'CIRCLE'), [items]);
  const [convert, { isLoading }] = useRmConvertMutation();
  // A second click that lands before the button re-renders as disabled is
  // still one submission — on top of the server's clientRequestId guard.
  const submitting = useRef(false);

  /**
   * WHICH PHYSICAL COIL — one Batch Number field decides it.
   *
   * The batch typed (or picked from its dropdown) is looked up against every
   * record of a physical coil, and the answer decides the workflow; the
   * operator never chooses a mode:
   *
   *   one received coil (GRN) carries it    → that coil is bound (`receipt`);
   *   one manual coil (no GRN) carries it   → that coil is bound (`boundManual`)
   *                                           and its rounds continue;
   *   several coils carry it                → nothing is bound until one is
   *                                           picked in the dropdown;
   *   nothing carries it                    → a NEW manual coil, described in
   *                                           this form (grade + total weight)
   *                                           and recorded only when the round
   *                                           is saved;
   *   left blank                            → a coil with no batch number:
   *                                           "No receipt available", ticked on
   *                                           purpose (head.manualFallback).
   *
   * A binding is only ever set from a lookup answer or a pick — never from
   * typed text — and is released the moment the box stops naming that coil,
   * so a cut can never be saved against a coil the screen no longer describes.
   */
  const [receipt, setReceipt] = useState(null);
  const [boundManual, setBoundManual] = useState(null);
  // A manual coil picked in the dropdown: bound as soon as the exact lookup of
  // its batch confirms it (the dropdown row is a search hit, not its record).
  const [pendingChoice, setPendingChoice] = useState(null);
  // The Batch Number dropdown's open state: it closes the moment a coil is
  // bound, so the list never sits over the fields the coil just filled in.
  const [listOpen, setListOpen] = useState(false);
  // The coil GRADE the operator picked — for a coil this form describes itself
  // (a new manual coil, or one with no batch number). A bound coil carries its
  // own grade (see `coil` below), so there is no second box to keep in step.
  const [pickedCoil, setPickedCoil] = useState(null);
  // A new manual coil: the weight of the WHOLE coil, typed on its first round.
  // A coil already on record keeps the weight it was saved with.
  const [manualTotal, setManualTotal] = useState('');
  // "Full cutting" / "Partial cutting" — the operator's choice for THIS round,
  // asked only once a physical coil is identified. Never pre-selected. Stored
  // with the coil it was made for (see `cutType` below).
  const [cutChoice, setCutChoice] = useState({ coilKey: null, type: null });
  const [debouncedBatch, setDebouncedBatch] = useState('');
  // One id per submission, so a double-click, a browser retry or a second tab
  // are recognised as the same cut instead of cutting the coil twice. A fresh
  // id is taken only after a SUCCESSFUL save, so correcting a rejected cut and
  // trying again is still accepted.
  const [requestId, setRequestId] = useState(newRequestId);
  const [head, setHead] = useState({
    conversionDate: dayjs().format('YYYY-MM-DD'), batchNo: '', coilWeightKg: '', rate: '',
    scrapVerified: 'PENDING', allowNegative: false,
    /**
     * "No receipt available" — this coil has no goods receipt AND no batch
     * number, so it cannot be named at all.
     *
     * The server's deliberate escape hatch (manualFallback in rmConvertSchema):
     * the coils received without a batch number can be cut no other way. The
     * cut is recorded with no coil behind it and its scrap reports as
     * Untraceable — so it is never inferred, least of all from a lookup that
     * found nothing (an unmatched batch is a NEW coil, and stays traceable).
     * Offered only while the batch is blank, as an explicit tick.
     */
    manualFallback: false,
    // Most coil cutting happens at the job worker, not in the plant, so this is
    // recorded per conversion rather than assumed.
    warehouse: DEFAULT_RECEIVED_AT,
  });
  const [circles, setCircles] = useState([blankCircle()]);

  const typedBatch = head.batchNo.trim();
  const untraceable = head.manualFallback && !typedBatch;

  /**
   * The batch number is looked up after a short pause in typing (Enter looks
   * it up at once). An answer only counts while it is the answer for exactly
   * what is in the box: until then the lookup reads "pending", never the
   * previous batch's result.
   */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBatch(head.batchNo.trim()), 350);
    return () => clearTimeout(t);
  }, [head.batchNo]);
  const lookupTerm = debouncedBatch === typedBatch ? typedBatch : '';

  /* ── RECEIVED COILS ────────────────────────────────────────────────────────
   *
   * Two questions, asked separately on purpose:
   *
   *   exact   which received coils carry EXACTLY this batch (any case) — fully
   *           cut ones included, so the screen can still say "fully cut". This
   *           decides the coil, and it is asked by batch alone, so a short
   *           batch can never be pushed out of the answer by the many batches
   *           that merely contain it (the broad search below is cut to 25).
   *   search  what the dropdown offers: coils whose batch, GRN number, PO,
   *           coil or supplier contains the text, with weight left. With the
   *           box empty, the coils of completed GRNs with weight left — what
   *           the old "Select GRN / Received Coil" list offered. Never decides.
   */
  const exactLookup = useGetRmReceivedCoilsQuery(
    { batchNo: lookupTerm, limit: 25, circleMapped: true, includeConsumed: true }, { skip: !lookupTerm },
  );
  const sameBatch = (r) => batchKey(r.batchNo) === batchKey(lookupTerm);
  const exactRows = exactLookup.currentData?.data;
  const exactReceipts = useMemo(() => (exactRows || []).filter(sameBatch), [exactRows, lookupTerm]); // eslint-disable-line react-hooks/exhaustive-deps
  const searchLookup = useGetRmReceivedCoilsQuery(
    debouncedBatch ? { q: debouncedBatch, limit: 25, circleMapped: true } : { limit: 50, circleMapped: true, grnOnly: true },
    { skip: untraceable },
  );
  const searchRows = searchLookup.currentData?.data;

  /* ── MANUAL COILS (no GRN) ────────────────────────────────────────────────
   *
   * The exact lookup is the authority: the manual coil this batch names (with
   * its original weight, rounds and remaining weight), and any goods receipt
   * that already carries the batch. The cutting history lists manual coils
   * whose batch contains the text, only to offer them in the dropdown.
   */
  const manualLookup = useLookupRmManualCoilQuery({ batchNo: lookupTerm }, { skip: !lookupTerm });
  const manualRes = manualLookup.originalArgs?.batchNo === lookupTerm ? manualLookup.currentData : undefined;
  const manualSearch = useGetRmCuttingHistoryQuery(
    { entryType: 'MANUAL', search: debouncedBatch, limit: 10 }, { skip: debouncedBatch.length < 2 },
  );

  const receiptsSettled = !!lookupTerm && !!exactRows && !exactLookup.isFetching;
  const manualSettled = !!lookupTerm && !!manualRes && !manualLookup.isFetching;
  const lookupFailed = !!lookupTerm && (exactLookup.isError || manualLookup.isError);
  // A failed lookup never counts as an answer — not even the last good one
  // RTK Query keeps after a failed refetch — so nothing is bound from it.
  const lookupSettled = receiptsSettled && manualSettled && !lookupFailed;
  const foundManual = lookupSettled ? (manualRes.data || null) : null;
  // A goods receipt carries this batch, but it is not a coil that can be cut
  // here (nothing left on its ledger, or an unmapped grade): never a new coil.
  const receiptOnRecord = lookupSettled ? (manualRes.meta?.grnReceipt || null) : null;
  // The batch WAS received, but on a coil with no approved circle sizes — say
  // that, rather than the misleading "not found".
  const unmappedBatch = lookupSettled && !exactReceipts.length ? (exactLookup.currentData?.meta?.unmappedBatch || null) : null;

  /**
   * Every physical coil that carries EXACTLY the batch typed — each received
   * coil (one per receipt, so the same batch on two GRNs is two coils) and the
   * manual coil, if there is one.
   */
  const exactCoils = useMemo(() => (lookupSettled ? [
    ...exactReceipts.map(grnOption),
    ...(foundManual ? [manualOption(foundManual)] : []),
  ] : []), [lookupSettled, exactReceipts, foundManual]);
  /**
   * The coils the batch could MEAN: those with weight left; only when none has
   * any, the fully cut ones (so a spent coil is still found and shown). One →
   * bound automatically. More than one → nothing is bound until the operator
   * picks one; the screen never chooses between two physical coils.
   */
  const candidates = useMemo(() => {
    const live = exactCoils.filter((o) => Number(o.remainingKg) > 0.001);
    return live.length ? live : exactCoils;
  }, [exactCoils]);

  /**
   * What the dropdown offers: every coil carrying exactly this batch first
   * (duplicates and fully cut ones too), then every other coil the text
   * found — received coils by batch / GRN / PO / coil /
   * supplier, manual coils by batch — so a record can be picked straight from
   * the list. Nothing in it is ever chosen for the operator.
   */
  const options = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (o) => { if (o && !seen.has(o.key)) { seen.add(o.key); out.push(o); } };
    exactCoils.forEach(add);
    (searchRows || []).forEach((r) => add(grnOption(r)));
    (debouncedBatch ? (manualSearch.currentData?.data || []) : [])
      .filter((m) => m.manualCoilId).forEach((m) => add(manualOption(m)));
    return out;
  }, [exactCoils, searchRows, manualSearch.currentData, debouncedBatch]);

  /**
   * Bind one received coil and fill the form from it.
   *
   * Everything that described the previous coil is replaced, not merged: its
   * grade, rate, location, this round's weight and the Full / Partial choice.
   * The rate and Received At come from THIS coil's own receipt (Received At
   * falls back to the default only when the receipt has none). "Cut this
   * round" is deliberately left empty — a coil is often cut over several
   * rounds, and pre-filling everything left turned every save into a full cut.
   */
  const applyReceipt = (r) => {
    setReceipt(r);
    setListOpen(false);
    setBoundManual(null);
    setPendingChoice(null);
    setPickedCoil(null);
    setManualTotal('');
    setCutChoice({ coilKey: null, type: null });
    setHead((h) => ({
      ...h, coilWeightKg: '', rate: String(r.unitCost ?? ''), warehouse: r.warehouse || DEFAULT_RECEIVED_AT,
    }));
  };
  // The same for a manual coil already on record: its grade, total weight,
  // rate and location are the ones its first round recorded.
  const applyManual = (m) => {
    setBoundManual(m);
    setListOpen(false);
    setReceipt(null);
    setPendingChoice(null);
    setPickedCoil(null);
    setManualTotal('');
    setCutChoice({ coilKey: null, type: null });
    setHead((h) => ({
      ...h, coilWeightKg: '', rate: m.rate ? String(m.rate) : '', warehouse: m.warehouse || DEFAULT_RECEIVED_AT,
    }));
  };
  const bindOption = (o) => (o.kind === 'GRN' ? applyReceipt(o.row) : applyManual(o.row));

  const bound = receipt || boundManual;
  /**
   * The automatic part: the one coil the batch names is bound as soon as the
   * lookup answers — or the coil picked in the dropdown, once the exact lookup
   * has confirmed it. Several candidates and no pick: nothing is bound.
   */
  const toBind = !bound
    ? (exactCoils.find((c) => c.key === pendingChoice) || (candidates.length === 1 ? candidates[0] : null))
    : null;
  useEffect(() => {
    if (toBind) bindOption(toBind);
  }, [toBind?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Let go of the coil that was identified, and of everything it filled in.
   *
   * The form returns to "no coil": no binding, no rate, the default location,
   * no round weight, no cutting type. What the operator entered that does not
   * belong to a coil — the date, the scrap check, the circles counted — stays;
   * a circle size the next coil cannot produce is dropped when that coil is
   * known (see the effect on `allowedIds`).
   */
  const releaseCoil = () => {
    setReceipt(null);
    setBoundManual(null);
    setPendingChoice(null);
    setCutChoice({ coilKey: null, type: null });
    setHead((h) => ({ ...h, coilWeightKg: '', rate: '', warehouse: DEFAULT_RECEIVED_AT }));
  };

  // "Clear coil", and clearing the Batch Number field: back to an empty form.
  const clearCoil = () => {
    releaseCoil();
    setHead((h) => ({ ...h, batchNo: '' }));
    setDebouncedBatch('');
  };

  /**
   * Typing in the Batch Number field. The box names the coil: the moment it
   * stops naming the coil that is bound, that coil is released — its figures,
   * rate and location go with it — and the new text is looked up. While that
   * lookup is pending, ambiguous or finds nothing, there is no coil, so
   * nothing can be saved against the previous one.
   */
  const onBatchChange = (v) => {
    setHead((h) => ({ ...h, batchNo: v }));
    setPendingChoice(null);
    if (bound && batchKey(v) !== batchKey(bound.batchNo)) releaseCoil();
  };

  // A record picked in the dropdown. A received coil carries everything it
  // needs and is bound at once; a manual coil is bound when the exact lookup
  // of its batch confirms it. Either way the box shows the coil's batch.
  const pickOption = (o) => {
    if (o.kind === 'GRN') applyReceipt(o.row);
    else { releaseCoil(); setPendingChoice(o.key); }
    setHead((h) => ({ ...h, batchNo: o.batchNo }));
    setDebouncedBatch(o.batchNo.trim());
  };

  // "No receipt available" on / off — only offered while the batch is blank.
  const setUntraceable = (on) => {
    releaseCoil();
    setManualTotal('');
    setHead((h) => ({ ...h, manualFallback: on }));
  };

  // A manual coil bound from the lookup, kept current with its latest answer.
  const existingManual = boundManual
    ? (foundManual && String(foundManual.id) === String(boundManual.id) ? foundManual : boundManual)
    : null;

  /**
   * WHERE THE TYPED BATCH STANDS — one word, for the field's status line and
   * for what the rest of the form allows.
   */
  const batchState = untraceable ? 'untraceable'
    : !typedBatch ? 'empty'
      : bound ? 'bound'
        : lookupFailed ? 'error'
          : (!lookupSettled || toBind) ? 'pending'
            : candidates.length > 1 ? 'ambiguous'
              : unmappedBatch ? 'unmapped'
                : receiptOnRecord ? 'blocked'
                  : 'new';
  const lookingUp = batchState === 'pending';
  // No coil on record carries this batch: the form describes a NEW manual coil.
  const isNewCoil = batchState === 'new';

  /**
   * THE COIL GRADE BEING CUT — derived wherever the coil carries one.
   *
   * A received coil's grade is its receipt's; a manual coil already entered
   * keeps the grade of its first round — the box shows it, locked. With no
   * coil bound the grade is picked by hand (a grade alone is still not a
   * physical coil, so the round stays locked until one is named). Derived
   * rather than copied, so a coil change can never leave the previous coil's
   * grade behind.
   */
  const boundCoil = receipt || existingManual;
  const coil = useMemo(() => {
    if (!boundCoil) return pickedCoil;
    return coils.find((c) => String(c.skuId) === String(boundCoil.skuId))
      // Still loading the overview: the coil's own identity until it arrives.
      || { skuId: boundCoil.skuId, skuCode: boundCoil.skuCode, skuName: boundCoil.skuName || '' };
  }, [boundCoil, pickedCoil, coils]);
  const coilOptions = useMemo(
    () => (coil && !coils.some((c) => String(c.skuId) === String(coil.skuId)) ? [...coils, coil] : coils),
    [coil, coils],
  );
  const manualTotalNum = Number(manualTotal);
  const manualTotalBad = isNewCoil && manualTotal !== '' && !(Number.isFinite(manualTotalNum) && manualTotalNum > 0);
  // A brand-new manual coil, complete enough to cut: batch, grade, total weight.
  const manualNewReady = isNewCoil && !!pickedCoil && manualTotalNum > 0 && !manualTotalBad;

  const setC = (i, k, v) => setCircles((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addC = () => setCircles((p) => [...p, blankCircle()]);
  const delC = (i) => setCircles((p) => (p.length === 1 ? [blankCircle()] : p.filter((_, j) => j !== i)));

  /**
   * Which circles THIS coil is approved to produce.
   *
   * The client's mapping sheet decides, and it is asked for per coil rather
   * than copied into this file — the server holds the one copy, so a size the
   * client adds or drops reaches the floor without a frontend release. Skipped
   * until a coil is known: before that there is no question to ask.
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
   * An approved circle the overview did not return is still offered — the
   * client approved it, and dropping it here would hide a size for a reason the
   * operator cannot see.
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
   * Changing the coil drops any circle that coil cannot produce.
   *
   * Only the SIZE is cleared — the pieces and weight that were physically
   * counted stay, because re-picking a size is a click and re-counting a pallet
   * is not. It waits for the answer rather than clearing on every keystroke:
   * mid-fetch `allowedIds` is the previous coil's.
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

  // What the circle picker says when it has nothing to offer. "Pick a coil
  // first" is a step not yet taken, "no approved sizes" is a gap in the sheet.
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
   *
   * ONE BATCH ON TWO RECEIPTS OF THE SAME COIL. The ledger is kept per batch
   * and coil grade, so two receipts sharing both share one ledger: each would
   * show the pair's combined weight as its own (600 + 400 → "1,000 left" on a
   * 600 kg coil). This coil's remaining is therefore the SMALLER of the ledger
   * and what its own receipt can still hold (its weight less the rounds cut
   * from it). For every coil with a ledger of its own the two agree — or the
   * ledger is the smaller, through earlier unlinked cuts — so nothing else
   * changes. A shared coil is never cut "Full": the server measures Full
   * against the whole ledger, not this coil.
   */
  const lineage = useGetRmCoilLineageQuery(receipt?.id, { skip: !receipt?.id });
  const lin = lineage.data?.meta;
  const linFresh = !!lin && String(lin.receipt?.movementId) === String(receipt?.id);
  const coilFacts = receipt ? (() => {
    const originalKg = round2(linFresh ? lin.receipt.receivedWeightKg : receipt.receivedWeight);
    const ledgerKg = round2(linFresh ? lin.totals.coil.availableKg : receipt.availableWeight);
    // What this receipt alone can still hold: its weight less its own rounds
    // (before the lineage answers, its weight — never more than that).
    const ownKg = round2(linFresh ? lin.totals.remainingKg : receipt.receivedWeight);
    const sharedLedger = ledgerKg > ownKg + 0.001;
    const availableKg = Math.min(ledgerKg, ownKg);
    const alreadyCutKg = round2(originalKg - availableKg);
    return {
      originalKg,
      availableKg,
      alreadyCutKg,
      sharedLedger,
      ledgerKg,
      rounds: linFresh ? lin.totals.rounds : null,
      roundsCutKg: linFresh ? lin.totals.cutKg : null,
      otherOutKg: linFresh ? Math.max(0, lin.totals.coil.otherOutKg) : 0,
      status: linFresh && !sharedLedger ? lin.totals.coil.status : cuttingStatusOf({ cutKg: alreadyCutKg, remainingKg: availableKg }),
    };
  })()
    /*
     * A MANUAL coil — the same four figures, from its own entry. Total is the
     * weight entered for the whole coil (stored on its first round, never
     * recalculated); remaining is that minus its rounds, the very figure the
     * server checks this round against. A coil entered for the first time has
     * cut nothing yet, so all of it remains.
     */
    : existingManual ? {
      originalKg: round2(existingManual.originalWeightKg),
      availableKg: round2(existingManual.availableKg),
      alreadyCutKg: round2(existingManual.originalWeightKg - existingManual.availableKg),
      rounds: existingManual.rounds,
      roundsCutKg: round2(existingManual.cutKg),
      otherOutKg: 0,
      status: existingManual.status,
      manual: true,
    }
      : manualNewReady ? {
        originalKg: round2(manualTotalNum),
        availableKg: round2(manualTotalNum),
        alreadyCutKg: 0,
        rounds: 0,
        roundsCutKg: 0,
        otherOutKg: 0,
        status: cuttingStatusOf({ cutKg: 0, remainingKg: manualTotalNum }),
        manual: true,
        isNew: true,
      } : null;
  // Which coil this round belongs to, for labels — whichever way it was named.
  const coilLabel = receipt?.batchNo || existingManual?.batchNo || (coilFacts?.manual ? typedBatch : '');

  /**
   * IS THERE A COIL TO CUT?
   *
   *   a received coil or a manual coil on record is bound;
   *   a new manual coil is complete — batch, grade and total weight;
   *   "No receipt available" is ticked and the grade being cut is picked.
   *
   * Every field stays on screen; until this is true the round's controls are
   * disabled, and a cut that does not say which coil it came off can never be
   * saved — the server refuses it too.
   */
  const identified = !!receipt || !!existingManual || (untraceable ? !!coil : manualNewReady);
  const noCoil = !identified;

  // A cutting-type choice made for one coil says nothing about the next: it is
  // kept together with the coil it was made for, so it simply reads as "not
  // chosen" for any other coil. A new manual coil is identified by its batch
  // number (one manual coil per batch); one with no receipt by its grade.
  const coilKey = receipt ? `grn:${receipt.id}`
    : existingManual ? `mc:${existingManual.id}`
      : untraceable ? `none:${coil?.skuId || ''}` : `new:${typedBatch.toUpperCase()}`;
  const cutType = cutChoice.coilKey === coilKey ? cutChoice.type : null;
  const setCutType = (type) => setCutChoice({ coilKey: type ? coilKey : null, type });

  /**
   * CUT THIS ROUND — where the weight comes from.
   *
   *   Full cutting    → the coil's remaining weight, read-only. Not typed and
   *                     not copied into the field: it IS coilFacts.availableKg,
   *                     so a refreshed lineage can never leave a stale number
   *                     behind. The server re-checks it against the ledger.
   *   Partial cutting → the weight the operator typed.
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
  // yield and scrap are worked out from.
  const validCircles = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && Number(c.pcs) > 0);
  const missingPcs = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && !(Number(c.pcs) > 0));
  const overCut = scrap < 0;
  // Once there is a coil, Full or Partial must be chosen on purpose — never
  // pre-selected. (A cut with no receipt can only be Partial.)
  const cutTypeMissing = identified && !cutType;
  // Nothing left on the coil: a full cut has nothing to take.
  // (Nor on a batch whose ledger another receipt shares — see coilFacts.)
  const fullImpossible = isFull && (coilFacts.availableKg <= 0.001 || !!coilFacts.sharedLedger);

  // Where a coil was identified, its own remaining weight is the limit — the
  // item's total across every batch would let a spent coil through. A cut with
  // no receipt has only the grade's stock to go by.
  const available = coilFacts ? coilFacts.availableKg : Number(coil?.onHand || 0);
  const shortCoil = !!coil && coilWt > available && !head.allowNegative;
  // "Allow cutting more coil than we hold" is ON and this round takes more than
  // the coil has. Allowed — that switch is a deliberate business option — but
  // never silent: the resulting negative balance is spelled out below.
  const overdrawn = !!coil && coilWt > available && head.allowNegative;
  /**
   * A manual coil still comes OUT OF RM STOCK, by grade, exactly as the server
   * checks it — a coil with no GRN is not a way round the stock check. Its own
   * remaining weight (above) is the first limit; this is the second.
   */
  const gradeOnHand = Number(coil?.onHand || 0);
  const gradeShort = !!coilFacts?.manual && !!coil && coilWt > 0 && coilWt > gradeOnHand && !head.allowNegative;
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

  // Belt and braces. The dropdown can only offer approved sizes, so this should
  // never be non-empty — but a stale list after a coil change, or a size the
  // client withdrew mid-shift, would otherwise reach the server as a 400 the
  // operator only discovers on save. The server stays the authority either way.
  const blockedCircles = validCircles.filter((c) => !allowedIds.has(String(c.sku.skuId)));
  const ready = identified && !!coil && coilWt > 0 && validCircles.length > 0 && !missingPcs.length
    && !overCut && !shortCoil && !gradeShort && !blockedCircles.length
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
   * receipt). But never SILENT: whichever location ends up selected decides
   * whose scrap stock the offcut lands in, so the override is spelled out.
   */
  const receiptLocation = receipt?.warehouse ? String(receipt.warehouse).toUpperCase() : null;
  const locationOverridden = !!receiptLocation && receiptLocation !== head.warehouse;

  /**
   * Has the operator entered anything that closing the form would lose?
   *
   * Every field the operator can touch, compared with how the form opens. The
   * auto-fill only ever runs after a batch number is typed or a coil picked, so
   * an untouched form is never reported as dirty.
   */
  const [openedOn] = useState(() => dayjs().format('YYYY-MM-DD'));
  const dirty = !!receipt || !!boundManual || !!pickedCoil || !!cutType
    || head.batchNo.trim() !== '' || head.coilWeightKg !== '' || head.rate !== ''
    || head.manualFallback || head.allowNegative || head.scrapVerified !== 'PENDING'
    || head.warehouse !== DEFAULT_RECEIVED_AT || head.conversionDate !== openedOn
    || manualTotal !== ''
    || circles.some((c) => c.sku || c.sizeLabel || c.pcs !== '' || c.weightKg !== '');
  useEffect(() => { onStateChange?.({ dirty, saving: isLoading }); }, [dirty, isLoading, onStateChange]);

  const submit = async () => {
    if (submitting.current) return undefined;
    if (!identified) {
      return enqueueSnackbar(
        batchState === 'new'
          ? 'No coil carries this batch number — choose the coil and enter its total weight to enter it as a new coil.'
          : 'Enter the batch number of the coil being cut, or pick it from the list.',
        { variant: 'warning' },
      );
    }
    if (!coil) return enqueueSnackbar('Pick the coil being cut.', { variant: 'warning' });
    if (cutTypeMissing) return enqueueSnackbar('Choose Full cutting or Partial cutting for this round.', { variant: 'warning' });
    if (fullImpossible) return enqueueSnackbar('This coil is already fully cut — nothing is left for a full cut.', { variant: 'error' });
    if (!(coilWt > 0)) return enqueueSnackbar('Enter how much of the coil is cut this round (more than 0 kg).', { variant: 'warning' });
    if (shortCoil) return enqueueSnackbar(`Only ${num(available)} KG is available from this physical coil.`, { variant: 'error' });
    if (gradeShort) return enqueueSnackbar(`Only ${num(gradeOnHand)} KG of ${coil.skuCode} is in RM stock. Turn on "Allow cutting more coil than we hold" to override.`, { variant: 'error' });
    if (missingPcs.length) return enqueueSnackbar('Enter the number of pieces for every circle produced.', { variant: 'warning' });
    if (!validCircles.length) return enqueueSnackbar('Add at least one circle with pieces and a weight.', { variant: 'warning' });
    if (blockedCircles.length) {
      return enqueueSnackbar(
        `${blockedCircles.map((c) => c.sku.skuCode).join(', ')} cannot be produced from coil ${coil.skuCode}.`,
        { variant: 'error' },
      );
    }
    // A new manual coil: nothing on record carries the batch, so the cut
    // records the coil (its batch and WHOLE weight) together with this round.
    const newManual = !receipt && !existingManual && !untraceable;
    submitting.current = true;
    try {
      /**
       * The BOUND COIL is the parent, full stop — the id the lookup or the
       * dropdown resolved, never the typed text. The server takes the batch
       * number off the receipt itself, so what is typed cannot corrupt the
       * record either way. A cut names its coil ONE way (rmConvertSchema).
       */
      const res = await convert({
        conversionDate: head.conversionDate, batchNo: head.batchNo || undefined,
        clientRequestId: requestId,
        coilReceiptId: receipt ? receipt.id : undefined,
        // Only ever true because the operator ticked "No receipt available".
        manualFallback: untraceable ? true : undefined,
        manualCoilId: existingManual ? existingManual.id : undefined,
        manualCoil: newManual ? { batchNo: typedBatch, totalWeightKg: manualTotalNum } : undefined,
        // FULL makes the server take the coil's remaining weight — and refuse
        // if it differs from `coilWeightKg`.
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
      if (saved.receiptBinding === 'AUTO' && saved.coilReceiptId) {
        enqueueSnackbar(`Linked to coil ${saved.batchNo || ''} from its goods receipt — open the coil to see every round.`, { variant: 'info' });
      }
      if (saved.manualCoil?.created) {
        enqueueSnackbar(`Manual coil ${saved.manualCoil.batchNo} recorded at ${num(saved.manualCoil.originalWeightKg)} kg. Type its batch number to cut its next round.`, { variant: 'info' });
      }
      /*
       * The next cut starts from the same clean form every time. In particular
       * none of these is a sticky preference: "No receipt available" is a
       * statement about ONE coil, Received At is a fact about the cut just
       * saved (a JW001 cut must not leave the next coil sitting on JW001), and
       * "has THIS cut's scrap been checked" cannot default to "Verified" for a
       * coil nobody has looked at yet.
       */
      setReceipt(null);
      setBoundManual(null);
      setPendingChoice(null);
      setPickedCoil(null);
      setRequestId(newRequestId());
      setHead((h) => ({
        ...h, batchNo: '', coilWeightKg: '', rate: '', manualFallback: false,
        warehouse: DEFAULT_RECEIVED_AT, scrapVerified: 'PENDING',
      }));
      setDebouncedBatch('');
      setCircles([blankCircle()]);
      setCutType(null);
      setManualTotal('');
      // The page closes the form and points at the coil just cut, so its
      // every round is one click away while it is still on the operator's mind.
      onSaved?.(saved);
    } catch (e) {
      // Nothing above ran, so every field is still exactly as entered — and
      // the submission id is kept, so saving again can never record the round
      // twice even if the first attempt did reach the server. The server's
      // own sentence where it sent one; never a raw status code.
      const msg = e?.data?.message
        || (e?.status === 'FETCH_ERROR' ? 'Could not reach the server — check the connection and save again.' : null)
        || 'Could not save this conversion — check the entry and save again.';
      enqueueSnackbar(msg, { variant: 'error' });
    } finally {
      submitting.current = false;
    }
    return undefined;
  };

  /* ── The Batch Number field's status line — only what the operator needs ── */
  const batchHint = {
    untraceable: { text: 'Not needed — "No receipt available" is ticked: this coil has no batch number.', color: O2D.sub },
    empty: { text: 'Type the batch number on the coil, or pick it from the list — its details are filled in from its record.', color: O2D.sub },
    pending: { text: 'Looking up this batch number…', color: O2D.sub },
    error: { text: 'Could not look this batch number up — the server did not answer. Try again.', color: STOCK_TOKENS.OUT_OF_STOCK.color },
    ambiguous: { text: `${candidates.length} coils carry this batch number — pick the one being cut from the list.`, color: STOCK_TOKENS.LOW.color },
    unmapped: {
      text: unmappedBatch ? `Batch ${unmappedBatch.batchNo} is a ${unmappedBatch.skuCode} (${unmappedBatch.skuName}) coil. No approved circle sizes are configured for it, so it cannot be cut here.` : '',
      color: STOCK_TOKENS.OUT_OF_STOCK.color,
    },
    blocked: {
      text: receiptOnRecord ? `Batch ${receiptOnRecord.batchNo} is on goods receipt${receiptOnRecord.grnNumber ? ` ${receiptOnRecord.grnNumber}` : ''} (${receiptOnRecord.skuCode}), with nothing on it that can be cut here — and a coil with a GRN cannot be entered manually.` : '',
      color: STOCK_TOKENS.OUT_OF_STOCK.color,
    },
    new: {
      text: options.length
        ? 'No coil has exactly this batch number — pick one from the list, or enter the coil details manually.'
        : 'No matching coil/GRN found. Enter the coil details manually.',
      color: STOCK_TOKENS.LOW.color,
    },
    bound: receipt
      ? (coilFacts.availableKg <= 0.001
        // Found, and shown with its history — but there is nothing left to cut.
        ? { text: `Existing received coil found · ${receipt.skuName} · This coil is fully cut — nothing is left on it to cut.`, color: STOCK_TOKENS.OUT_OF_STOCK.color }
        : coilFacts.sharedLedger
          // One batch on two receipts of this coil grade: say so, and say what
          // that limits — this coil's own weight, Partial only.
          ? {
            text: `Existing received coil found · ${receipt.skuName}${receipt.grnNumber ? ` · ${receipt.grnNumber}` : ''} · this batch is also on another receipt of ${receipt.skuCode}, so their stock is shared: up to this coil's own ${num(coilFacts.availableKg)} kg, Partial cutting only.`,
            color: STOCK_TOKENS.LOW.color,
          }
          : {
            text: `Existing received coil found · ${receipt.skuName} · ${num(coilFacts.availableKg)} kg available to cut · ₹${num(receipt.unitCost)}/kg${receipt.grnNumber ? ` · ${receipt.grnNumber}` : ''}`,
            color: STOCK_TOKENS.OK.color,
          })
      : existingManual
        ? (existingManual.availableKg <= 0.001
          ? { text: `Existing manual coil found (no GRN) · ${existingManual.skuCode} · This coil is fully cut — nothing is left on it to cut.`, color: STOCK_TOKENS.OUT_OF_STOCK.color }
          : { text: `Existing manual coil found (no GRN) · ${existingManual.skuCode} · ${num(existingManual.availableKg)} kg remaining. This cut continues it.`, color: STOCK_TOKENS.OK.color })
        : { text: '', color: O2D.sub },
  }[batchState];

  // The option the field shows as selected: the bound coil.
  const selectedOption = useMemo(
    () => (receipt ? grnOption(receipt) : existingManual ? manualOption(existingManual) : null),
    [receipt, existingManual],
  );

  /**
   * THE BATCH NUMBER FIELD — the one way a coil is identified.
   *
   * Free text (typed, pasted, or Enter to look up at once) and a dropdown of
   * the coils the text finds, in one box. Picking an option binds that exact
   * coil; typing a batch binds the coil it names when it names exactly one.
   */
  const batchField = (
    <Autocomplete
      freeSolo
      data-testid="batch-field"
      open={listOpen}
      onOpen={() => setListOpen(true)}
      onClose={() => setListOpen(false)}
      size="small"
      options={options}
      value={selectedOption}
      inputValue={head.batchNo}
      disabled={untraceable}
      filterOptions={(x) => x}
      // Wider than the box itself, so each coil's GRN, supplier and weights
      // read on one or two lines.
      slotProps={{ popper: { placement: 'bottom-start', sx: { minWidth: { xs: 300, md: 620 } } } }}
      loading={lookingUp}
      loadingText="Looking up this batch number…"
      onInputChange={(_, v, reason) => {
        if (reason === 'input') onBatchChange(v);
        else if (reason === 'clear') clearCoil();
      }}
      onChange={(_, v, reason) => {
        if (v && typeof v === 'object') pickOption(v);
        else if (typeof v === 'string') setDebouncedBatch(v.trim()); // Enter: look it up now
        else if (reason === 'clear') clearCoil();
      }}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.batchNo)}
      isOptionEqualToValue={(a, b) => a.key === b?.key}
      renderOption={(props, o) => (
        <li {...props} key={o.key} data-testid="batch-option">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }}>
              Batch {o.batchNo || '—'}
              <Box component="span" sx={{ fontWeight: 600, color: O2D.body }}> · {o.skuCode}{o.skuName ? ` — ${o.skuName}` : ''}</Box>
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, fontVariantNumeric: 'tabular-nums' }}>
              {[
                o.kind === 'GRN' ? (o.ref || 'Goods receipt') : 'Manual entry · no GRN',
                o.historical && 'historical GRN register',
                o.supplier,
                o.date && `${o.kind === 'GRN' ? 'Received' : 'Entered'} ${dayjs(o.date).format('DD MMM YYYY')}`,
                o.location && `at ${o.location}`,
                o.originalKg != null && `Original ${num(o.originalKg)} kg`,
                o.remainingKg != null && (Number(o.remainingKg) > 0.001
                  ? `Remaining ${num(o.remainingKg)} kg${o.partiallyCut ? ' (partly cut)' : ''}` : 'Fully cut · 0 kg left'),
              ].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(p) => (
        <TextField {...p} label="Batch number"
          placeholder="Type or pick the coil's batch number"
          onKeyDown={(e) => { if (e.key === 'Enter') setDebouncedBatch(head.batchNo.trim()); }}
          inputProps={{ ...p.inputProps, 'data-testid': 'batch-input' }}
          InputProps={{
            ...p.InputProps,
            endAdornment: <>{lookingUp ? <CircularProgress size={13} /> : null}{p.InputProps.endAdornment}</>,
          }}
          helperText={batchHint.text || undefined}
          FormHelperTextProps={helperSx(batchHint.color)} />
      )}
    />
  );

  // The coil grade. Picked for a coil this form describes itself (a new coil,
  // or one with no batch number); shown, locked, for a coil on record.
  const coilPicker = (
    <Autocomplete
      size="small" options={coilOptions} value={coil}
      disabled={!!boundCoil}
      // Picking a coil GRADE never fills the rate. The rate is what was paid
      // for one physical coil, so it comes from that coil's own record — never
      // from the grade's master rate.
      onChange={(_, v) => { setPickedCoil(v); setCutChoice({ coilKey: null, type: null }); }}
      getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
      isOptionEqualToValue={(a, b) => String(a.skuId) === String(b?.skuId)}
      renderOption={(props, o) => (
        <li {...props} key={o.skuId}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }}>{o.skuName}</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{o.skuCode}{Number.isFinite(o.onHand) ? ` · ${num(o.onHand)} in store` : ''}</Typography>
          </Box>
        </li>
      )}
      renderInput={(p) => (
        <TextField {...p} label="Coil being cut" placeholder="Search a coil…"
          required={isNewCoil || untraceable}
          helperText={receipt ? 'From the coil\'s GRN — Clear coil to change it.'
            : existingManual ? 'Fixed by this coil\'s first round.'
              : (isNewCoil || untraceable) ? 'Required — the grade of the physical coil.' : undefined}
          FormHelperTextProps={helperSx()}
          InputProps={{ ...p.InputProps, startAdornment: <><Disc3 size={14} style={{ marginLeft: 6, marginRight: 2, opacity: 0.55 }} />{p.InputProps.startAdornment}</> }} />
      )}
    />
  );

  /**
   * TOTAL COIL WEIGHT / ALREADY CUT / REMAINING WEIGHT (+ the coil's status).
   *
   * Information, not inputs: read straight from `coilFacts` — the goods
   * receipt and the batch ledger, the same remaining figure the server checks
   * a round against. Rendered only once a coil is identified.
   */
  const coilFactsTiles = coilFacts && (
    <Box data-testid="coil-facts" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1, mt: 1.25 }}>
      {[
        ['Total coil weight', `${num(coilFacts.originalKg)} kg`, O2D.ink,
          coilFacts.manual ? 'Entered for the whole coil — it has no goods receipt.' : 'What this coil weighed on its goods receipt.'],
        ['Already cut', `${num(coilFacts.alreadyCutKg)} kg`, O2D.body,
          coilFacts.rounds == null ? 'Loading this coil\'s rounds…'
            : coilFacts.otherOutKg > 0.001
              ? `${coilFacts.rounds} round${coilFacts.rounds === 1 ? '' : 's'} here (${num(coilFacts.roundsCutKg)} kg) + ${num(coilFacts.otherOutKg)} kg earlier, not linked to a round`
              : `${coilFacts.rounds} previous round${coilFacts.rounds === 1 ? '' : 's'}`],
        ['Remaining weight', `${num(coilFacts.availableKg)} kg`,
          coilFacts.availableKg > 0.001 ? '#0f766e' : STOCK_TOKENS.OUT_OF_STOCK.color,
          'Total coil weight minus already cut — the most this round can take.'],
      ].map(([label, value, color, sub]) => (
        <Box key={label} sx={{ px: 1.1, py: 0.6, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 0 }}>
          <Typography sx={capsSx}>{label}</Typography>
          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          <Typography sx={{ fontSize: '0.6rem', color: O2D.faint }}>{sub}</Typography>
        </Box>
      ))}
      <Box sx={{ px: 1.1, py: 0.6, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Typography sx={capsSx}>Cutting status</Typography>
        <Box sx={{ mt: 0.4 }}><CutStatusChip status={coilFacts.status} /></Box>
        <Typography sx={{ fontSize: '0.6rem', color: O2D.faint, mt: 0.3 }}>Worked out from the weights — never set by hand.</Typography>
      </Box>
    </Box>
  );

  return (
    <Stack spacing={1.25} sx={{ minWidth: 0, '& > *': { minWidth: 0 } }} data-testid="coil-to-circle-form">
      {/* ── Step 1 — the coil ── */}
      <Panel>
        <StepHead n={1} title="Which coil is being cut?"
          hint="Type or pick the coil's batch number — a coil on record is filled in automatically; a coil with no record is entered here. Then say how much of it is cut in this round."
          done={identified && coilWt > 0} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 2fr 1fr 1fr' }, gap: 1.25, mt: 1.25 }}>
          {/* Batch number first: it is how the physical coil is identified,
              and finding it fills in the rest. */}
          {batchField}
          {coilPicker}
          <TextField size="small" type="date" label="Date cut" value={head.conversionDate}
            onChange={(e) => setHead((h) => ({ ...h, conversionDate: e.target.value }))}
            InputLabelProps={{ shrink: true }} inputProps={{ max: dayjs().format('YYYY-MM-DD') }} />
          {/* The weight of the WHOLE physical coil — not this round's cut.
              Typed only for a NEW coil (no record carries its batch); a coil
              on record shows the weight it was received / entered with. */}
          <TextField size="small" type="number" label="Total coil weight (kg)"
            required={isNewCoil}
            value={receipt ? String(coilFacts.originalKg) : existingManual ? String(round2(existingManual.originalWeightKg)) : isNewCoil ? manualTotal : ''}
            onChange={(e) => { setManualTotal(e.target.value); setCutChoice({ coilKey: null, type: null }); }}
            disabled={!isNewCoil}
            error={manualTotalBad}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 0, step: 'any', 'data-testid': 'manual-total-input' }}
            helperText={receipt ? 'From this coil\'s goods receipt.'
              : existingManual ? 'Recorded on this coil\'s first round — it does not change.'
                : untraceable ? 'Not recorded — there is no coil to keep it against.'
                  : isNewCoil ? (manualTotalBad ? 'Enter the coil\'s weight — a number above 0 kg.' : 'The whole coil before any cutting — not this round\'s cut.')
                    : 'From the coil\'s record, or entered for a new coil.'}
            FormHelperTextProps={helperSx(manualTotalBad ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.sub)} />
        </Box>

        {/* ── "NO RECEIPT AVAILABLE" — only while the batch is blank: it is for
            a coil with no batch number to type. It records the cut with no
            coil behind it, so it says exactly that before it is ticked. An
            unmatched batch is never this — it is a new coil, kept traceable. */}
        {!typedBatch && (
          <Box data-testid="no-receipt-option" sx={{ mt: 0.75 }}>
            <FormControlLabel sx={{ mr: 0, alignItems: 'flex-start' }}
              control={<Checkbox size="small" checked={head.manualFallback} sx={{ py: 0.25 }}
                onChange={(e) => setUntraceable(e.target.checked)} />}
              label={(
                <Box sx={{ pt: 0.4 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.body }}>
                    No receipt available — the coil has no GRN and no batch number
                  </Typography>
                  <Typography sx={{ fontSize: '0.66rem', color: untraceable ? STOCK_TOKENS.LOW.color : O2D.faint }}>
                    {untraceable
                      ? 'This cut will not be traceable to a coil: its scrap shows under “Untraceable” in Scrap IMS, and only Partial cutting is possible. Untick it to type the batch number instead.'
                      : 'Records the cut without a coil, so its scrap cannot be traced. Only for a coil with no batch number to type above.'}
                  </Typography>
                </Box>
              )} />
          </Box>
        )}

        {/* ── WHICH MANUAL COIL THIS CUT BELONGS TO ── */}
        {coilFacts?.manual && (
          <Paper elevation={0} data-testid="manual-coil-banner" sx={{
            mt: 1.5, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Pencil size={15} /></Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>
                  Manual coil {coilLabel} · {coil?.skuCode || existingManual?.skuCode} · no GRN
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                  {existingManual
                    ? `Entered ${dayjs(existingManual.enteredAt).format('DD MMM YYYY')} · ${existingManual.rounds} round${existingManual.rounds === 1 ? '' : 's'} so far. This cut continues the same coil.`
                    : 'A new manual coil. It is recorded with its total weight when this round is saved, and its later rounds continue from it.'}
                </Typography>
              </Box>
              {existingManual && (
                <Button size="small" endIcon={<ArrowUpRight size={13} />} sx={{ ml: { sm: 'auto' }, textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}
                  onClick={() => navigate(`/rm-ims/coil/${existingManual.id}`)}>
                  View this coil's history
                </Button>
              )}
            </Stack>
            {coilFactsTiles}
          </Paper>
        )}
        {/* ── WHICH PHYSICAL COIL THIS CUT BELONGS TO ──────────────────────
            The scrap this cut leaves is traced back through here and nowhere
            else, so the link is stated on the form. A batch typed over it
            releases it at once, so it never describes a different coil. */}
        {receipt && (
          <Paper elevation={0} data-testid="selected-coil" sx={{
            mt: 1.5, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Receipt size={15} /></Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>
                  Physical coil {receipt.batchNo} · {receipt.skuCode}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
                  {[receipt.grnNumber && `GRN ${receipt.grnNumber}`, receipt.poNumber && `PO ${receipt.poNumber}`, receipt.supplier]
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
                  onClick={clearCoil}
                  sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.sub }}>
                  Clear coil
                </Button>
              </Stack>
            </Stack>
            {coilFactsTiles}
          </Paper>
        )}
        {/* No coil identified yet: no figure cards at all — they appear with
            the coil, in the banner above. */}

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
              : existingManual?.rate
                ? `From this coil's manual entry (₹${num(existingManual.rate)}/kg). Used to value the circles produced.`
                : (isNewCoil || untraceable || existingManual)
                  ? 'The rate paid for this coil, where known. Used to value the circles produced.'
                  : 'Filled from the coil\'s record once its batch number is found. Used to value the circles produced.'}
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
              <FormControlLabel value="FULL" disabled={noCoil || !coilFacts || coilFacts.availableKg <= 0.001 || !!coilFacts.sharedLedger}
                control={<Radio size="small" />}
                label={(
                  <Box>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit' }}>Full cutting</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: O2D.sub }}>
                      {!coilFacts ? (noCoil ? 'Choose the coil first' : 'Needs a physical coil')
                        : coilFacts.sharedLedger ? 'Not on a batch shared with another receipt — use Partial'
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
              Partial: typed. Sent as `coilWeightKg` — exactly what the server
              deducts from the coil for this round. */}
          <TextField size="small" type="number" label="Cut this round (kg)"
            value={isFull ? String(coilFacts.availableKg) : head.coilWeightKg}
            onChange={(e) => setHead((h) => ({ ...h, coilWeightKg: e.target.value }))}
            disabled={noCoil || cutTypeMissing}
            placeholder={noCoil ? 'Choose the coil first' : cutTypeMissing ? 'Choose Full or Partial first' : undefined}
            InputLabelProps={noCoil || cutTypeMissing ? { shrink: true } : undefined}
            error={shortCoil || gradeShort || badWeight}
            inputProps={{ min: 0, step: 'any', readOnly: isFull }}
            sx={isFull ? { '& .MuiInputBase-root': { bgcolor: O2D.surfaceAlt } } : { '& .MuiInputBase-root': { bgcolor: O2D.surface } }}
            helperText={(
              <>
                {noCoil ? (untraceable ? 'Choose the coil being cut above first.'
                  : isNewCoil ? 'Choose the coil and enter its total weight above first — it is a new coil.'
                    : batchState === 'ambiguous' ? 'Pick which coil this is from the Batch Number list first.'
                      : 'Enter the batch number above to choose the coil.')
                  : cutTypeMissing ? 'Choose the cutting type to enter this round\'s weight.'
                    : isFull ? `Full cutting — the whole remaining ${num(coilFacts.availableKg)} kg, set by the system.`
                      : badWeight ? 'Enter a weight above 0 kg. '
                        : shortCoil ? (coilFacts
                          ? `Only ${num(available)} KG is available from this physical coil. `
                          : `Only ${num(available)} KG of ${coil.skuCode} is in RM stock. `)
                          : gradeShort ? `Only ${num(gradeOnHand)} KG of ${coil.skuCode} is in RM stock. `
                            : coilFacts ? `Up to ${num(coilFacts.availableKg)} kg remaining. `
                              : (coil ? `${num(coil.onHand)} in store. ` : 'Pick a coil first. ')}
                {/* "Use all" is Full cutting — the same calculation, not a copy. */}
                {cutType === 'PARTIAL' && coilFacts && !coilFacts.sharedLedger && coilFacts.availableKg > 0.001 && (
                  <Box component="button" type="button" onClick={() => setCutType('FULL')} sx={linkSx}>
                    Use all {num(coilFacts.availableKg)} kg (Full cutting)
                  </Box>
                )}
              </>
            )}
            FormHelperTextProps={{ component: 'div', sx: { fontSize: '0.66rem', color: (shortCoil || gradeShort || badWeight) ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.sub, mx: 0 } }} />

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
        {/* The yellow "No physical coil chosen yet" panel that closed this step
            is gone: its guidance is the Batch Number field's status line, a
            coil with no record is entered in the fields above, and "No
            receipt available" is offered (above) while the batch is blank. */}
      </Panel>

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
              for an identified coil — without one there is no coil to say
              anything about. */}
          {coilFacts && (
            <>
              <Typography sx={{ mt: 1.25, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.sub }}>
                After this round{after ? ` · round ${after.roundNo} of coil ${coilLabel}` : ''}
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
          {!overCut && !shortCoil && gradeShort && (
            <Paper elevation={0} data-testid="grade-short-warning" sx={{
              mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
              border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                  Only {num(gradeOnHand)} KG of {coil.skuCode} is in RM stock, and a manual coil is still taken out of stock.
                  Correct "Cut this round", or turn on "Allow cutting more coil than we hold" above.
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

          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
            {onCancel && (
              <Button variant="outlined" onClick={onCancel} disabled={isLoading}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
                Cancel
              </Button>
            )}
            <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
              Save this conversion
            </Button>
          </Stack>
        </Box>
      </Panel>
    </Stack>
  );
};

export default CoilToCircleForm;
