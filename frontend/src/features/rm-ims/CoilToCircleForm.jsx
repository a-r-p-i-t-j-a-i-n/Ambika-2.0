import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, MenuItem,
  FormControlLabel, Switch, Checkbox, Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
  Tooltip, Radio, RadioGroup, FormControl, FormLabel,
} from '@mui/material';
import {
  Plus, Trash2, Save, Disc3, CircleDashed, AlertTriangle, History,
} from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { FIELD } from '../ims/imsFieldHelp';

import {
  Panel, TableScroll, Th, StepHead,
  cuttingStatusOf,
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

// "Scrap checked?" is no longer asked on this form: the client does not verify
// scrap at the cutting entry. The server records every cut's scrap as "Not yet
// checked" (PENDING, its default), as it always did for an untouched field.

const helperSx = (color = O2D.sub) => ({ component: 'div', sx: { fontSize: '0.66rem', color, mx: 0 } });

/**
 * THE COIL → CIRCLE ENTRY FORM — one cutting round of one physical coil.
 *
 * Opened in a dialog from "New Cutting Entry" on the Coil to Circle page, or
 * from a partially cut coil's "Full Cut" action in the history. Everything
 * the form does is its own and unchanged by where it sits: the coil lookup,
 * Full / Partial, the approved-circle mapping, the stock and over-cut checks,
 * and the one-id-per-submission duplicate guard.
 *
 * ── PARTIAL AND FULL ────────────────────────────────────────────────────────
 *   Partial cutting   only the coil weight cut this round. The circles are
 *                     counted once the coil is finished, so none are asked.
 *   Full cutting      the rest of the coil, and the circles of the WHOLE coil
 *                     (every round's): pieces and weight. Scrap and yield are
 *                     worked out over the whole coil — this round plus the
 *                     partial rounds before it.
 *   No receipt        no coil to finish later, so one entry: weight + circles.
 *
 *   preset                  { batchNo, coilKey, cutType } — opened for one coil
 *                           (the history's row action): its batch is looked up
 *                           and that exact coil bound, then the cutting type is
 *                           chosen. Everything stays editable.
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
const CoilToCircleForm = ({
  onSaved, onCancel, onStateChange, preset = null,
}) => {
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
  // Opened for one coil (`preset`), that coil — so a batch on two coils still
  // binds the one whose row was clicked.
  const [pendingChoice, setPendingChoice] = useState(() => preset?.coilKey || null);
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
  // A preset batch is looked up at once, not after the typing pause.
  const [debouncedBatch, setDebouncedBatch] = useState(() => String(preset?.batchNo || '').trim());
  // One id per submission, so a double-click, a browser retry or a second tab
  // are recognised as the same cut instead of cutting the coil twice. A fresh
  // id is taken only after a SUCCESSFUL save, so correcting a rejected cut and
  // trying again is still accepted.
  const [requestId, setRequestId] = useState(newRequestId);
  const [head, setHead] = useState({
    conversionDate: dayjs().format('YYYY-MM-DD'), batchNo: String(preset?.batchNo || '').trim(), coilWeightKg: '', rate: '',
    allowNegative: false,
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
  // Received on a GRN whose Incoming QC is pending (or rejected it): not stock,
  // so it can neither be cut nor entered manually until its QC posts it.
  const qcPendingBatch = lookupSettled ? (manualRes.meta?.qcPending || null) : null;
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
   * belong to a coil — the date, the circles counted — stays;
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
                : (receiptOnRecord || qcPendingBatch) ? 'blocked'
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
   * changes. The server measures Full and Partial against the same smaller
   * figure, so a shared coil is finished with a Full cut like any other.
   *
   * `pendingKg` is what earlier PARTIAL rounds cut without recording circles:
   * the Full cut's circles account for it too, so the coil's scrap and yield
   * are worked out over this round's weight plus it (see `basisKg`).
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
      // Unknown (null) until this coil's rounds have loaded.
      pendingKg: linFresh ? round2(lin.totals.pendingKg || 0) : null,
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
      pendingKg: round2(existingManual.pendingKg || 0),
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
        pendingKg: 0,
        otherOutKg: 0,
        status: cuttingStatusOf({ cutKg: 0, remainingKg: manualTotalNum }),
        manual: true,
        isNew: true,
      } : null;

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
   *   Partial cutting → the weight the operator typed. It must leave some of
   *                     the coil: the last of it is the Full cut, the round
   *                     that records the circles (the server refuses the same).
   *
   * "Cutting type" is the operator's instruction for THIS round. It is not the
   * coil's status, which stays derived from the weights (cuttingStatusOf).
   */
  const isFull = !!coilFacts && cutType === 'FULL';
  const isPartial = cutType === 'PARTIAL';
  const coilWt = isFull ? coilFacts.availableKg : Number(head.coilWeightKg || 0);
  /**
   * WHICH CUTS RECORD CIRCLES — the Full cut, for the whole coil, and a cut
   * with no receipt (no coil to finish later, so it is one entry). A Partial
   * round records only its weight, and step 2 is not shown for it.
   *
   * A Full cut's circles came off this round's weight AND what the earlier
   * partial rounds cut (`pendingKg`), so its scrap is worked out over both —
   * the same sum the server makes (`settledKg`). The form only uses it to
   * refuse circles heavier than the coil; scrap and yield are the history's.
   */
  const recordsCircles = isFull || untraceable;
  const pendingKg = isFull ? coilFacts.pendingKg : 0;
  const basisKg = recordsCircles ? round2(coilWt + (pendingKg || 0)) : 0;
  const scrap = round2(basisKg - circlesWeight);
  // A circle line is only complete with BOTH figures: the pieces are what goes
  // into circle stock (circles are counted, not weighed), and the weight is what
  // yield and scrap are worked out from.
  const validCircles = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && Number(c.pcs) > 0);
  const missingPcs = circles.filter((c) => c.sku && Number(c.weightKg) > 0 && !(Number(c.pcs) > 0));
  const overCut = recordsCircles && scrap < 0;
  // Once there is a coil, Full or Partial must be chosen on purpose — never
  // pre-selected. A cut with no receipt has nothing to choose: it is one entry.
  const cutTypeMissing = identified && !untraceable && !cutType;
  // Nothing left on the coil: a full cut has nothing to take.
  const fullImpossible = isFull && coilFacts.availableKg <= 0.001;
  // What the earlier rounds cut is only known once this coil's rounds have
  // loaded — until then a Full cut's scrap cannot be worked out.
  const basisLoading = isFull && pendingKg == null;
  // A Partial round that would take the last of the coil: that is the Full cut.
  const partialTakesAll = isPartial && !!coilFacts && coilWt > 0 && round2(coilFacts.availableKg - coilWt) <= 0.001;

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
   * Every cut still comes OUT OF RM STOCK, by grade, exactly as the server
   * checks it — a coil with no GRN is not a way round the stock check. The
   * coil's own remaining weight (above) is the first limit; this is the
   * second. Judged only once the grade's stock figure has loaded.
   */
  const gradeOnHand = Number(coil?.onHand || 0);
  const gradeShort = !untraceable && !!coil && Number.isFinite(coil.onHand)
    && coilWt > 0 && coilWt > gradeOnHand && !head.allowNegative;
  // The override switch is offered only where it changes something: a cut
  // with no receipt, or a grade whose stock is short (or once it is on).
  const showOverride = untraceable || gradeShort || head.allowNegative;
  // What this round leaves behind, for the "after this round" summary.
  const after = coilFacts && coilWt > 0 ? (() => {
    const remainingKg = round2(coilFacts.availableKg - coilWt);
    const totalCutKg = round2(coilFacts.alreadyCutKg + coilWt);
    return {
      remainingKg,
      totalCutKg,
      status: cuttingStatusOf({ cutKg: totalCutKg, remainingKg }),
    };
  })() : null;
  const badWeight = !isFull && head.coilWeightKg !== '' && !(coilWt > 0);

  // Belt and braces. The dropdown can only offer approved sizes, so this should
  // never be non-empty — but a stale list after a coil change, or a size the
  // client withdrew mid-shift, would otherwise reach the server as a 400 the
  // operator only discovers on save. The server stays the authority either way.
  const blockedCircles = validCircles.filter((c) => !allowedIds.has(String(c.sku.skuId)));
  // A Partial round asks for no circles; the others need complete, approved lines.
  const circlesReady = !recordsCircles
    || (validCircles.length > 0 && !missingPcs.length && !overCut && !blockedCircles.length);
  const ready = identified && !!coil && coilWt > 0 && circlesReady
    && !shortCoil && !gradeShort && !cutTypeMissing && !fullImpossible && !partialTakesAll && !basisLoading;
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
   *
   * Opened for one coil (`preset`), the form fills itself in — so it is
   * compared with how it stood once that coil was bound and its cutting type
   * chosen, and closing it straight away asks nothing.
   */
  const [openedOn] = useState(() => dayjs().format('YYYY-MM-DD'));
  const snapshot = JSON.stringify([
    head, circles, cutType, manualTotal, receipt?.id || null, boundManual?.id || null, pickedCoil?.skuId || null,
  ]);
  const [presetBaseline, setPresetBaseline] = useState(null);
  const dirty = preset?.batchNo
    ? (presetBaseline != null ? snapshot !== presetBaseline : batchKey(head.batchNo) !== batchKey(preset.batchNo))
    : (!!receipt || !!boundManual || !!pickedCoil || !!cutType
      || head.batchNo.trim() !== '' || head.coilWeightKg !== '' || head.rate !== ''
      || head.manualFallback || head.allowNegative
      || head.warehouse !== DEFAULT_RECEIVED_AT || head.conversionDate !== openedOn
      || manualTotal !== ''
      || circles.some((c) => c.sku || c.sizeLabel || c.pcs !== '' || c.weightKg !== ''));
  /**
   * HAS THIS COIL BEEN CUT BEFORE? — said plainly above the cutting type, so a
   * coil that was partially cut is never treated like a fresh one: how many
   * times, when last, how much is cut and how much is left; then the choice
   * is put as a question — cut some more (Partial) or finish it (Full).
   */
  const linRounds = receipt && linFresh ? (lineage.data?.data || []) : [];
  const lastCutAt = (linRounds.length ? linRounds[linRounds.length - 1].date : null) || existingManual?.lastCutAt || null;
  const cutBefore = !!coilFacts && !coilFacts.isNew && coilFacts.alreadyCutKg > 0.001;
  const coilDone = !!coilFacts && coilFacts.availableKg <= 0.001;
  const boundBatch = receipt?.batchNo || existingManual?.batchNo || '';

  // The page shows the coil's status in the dialog's header (RmImsConversion).
  const coilBrief = coilFacts && boundBatch ? `${boundBatch}|${coilFacts.status}|${coilFacts.availableKg}` : '';
  useEffect(() => {
    onStateChange?.({
      dirty,
      saving: isLoading,
      coil: coilBrief ? { batchNo: boundBatch, status: coilFacts.status, availableKg: coilFacts.availableKg } : null,
    });
  }, [dirty, isLoading, onStateChange, coilBrief]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * OPENED FOR ONE COIL — once that exact coil is bound, choose the cutting
   * type its row asked for (Full only while the coil has weight left), then
   * take the form as it stands as "untouched". If the coil is not the one
   * found (cut away meanwhile, or another coil typed), nothing is chosen.
   * Adjusted during render (React's "adjust state when something changes"),
   * so the form never paints a frame with the coil bound and no type chosen.
   */
  const [presetApplied, setPresetApplied] = useState(() => !preset?.batchNo);
  if (!presetApplied && identified && coilKey === preset.coilKey) {
    setPresetApplied(true);
    const canFull = !!coilFacts && coilFacts.availableKg > 0.001;
    if (preset.cutType === 'PARTIAL' || (preset.cutType === 'FULL' && canFull)) {
      setCutChoice({ coilKey, type: preset.cutType });
    }
  } else if (presetApplied && preset?.batchNo && presetBaseline == null) {
    setPresetBaseline(snapshot);
  }

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
    if (partialTakesAll) return enqueueSnackbar('This takes everything left on the coil. Choose Full cutting: it finishes the coil and records its circles.', { variant: 'warning' });
    if (shortCoil) return enqueueSnackbar(`Only ${num(available)} KG is available from this physical coil.`, { variant: 'error' });
    if (gradeShort) return enqueueSnackbar(`Only ${num(gradeOnHand)} KG of ${coil.skuCode} is in RM stock. Turn on "Allow cutting more coil than we hold" to override.`, { variant: 'error' });
    if (basisLoading) return enqueueSnackbar('Loading this coil\'s earlier rounds — save again in a moment.', { variant: 'info' });
    if (recordsCircles && missingPcs.length) return enqueueSnackbar('Enter the number of pieces for every circle produced.', { variant: 'warning' });
    if (recordsCircles && !validCircles.length) return enqueueSnackbar('Add at least one circle with pieces and a weight.', { variant: 'warning' });
    if (recordsCircles && overCut) return enqueueSnackbar('The circles weigh more than the coil they came from — check the weights.', { variant: 'error' });
    if (recordsCircles && blockedCircles.length) {
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
        // if it differs from `coilWeightKg`. A cut with no receipt sends none:
        // it is one entry, weight and circles together.
        cuttingType: untraceable ? undefined : (cutType || undefined),
        // No fallback to the grade's master rate: blank means "use this coil's
        // own receipt rate", which the server applies from the linked receipt.
        coilSkuId: coil.skuId, coilWeightKg: coilWt, rate: Number(head.rate || 0),
        allowNegative: head.allowNegative,
        warehouse: head.warehouse,
        // A Partial round sends no circles — they come with the Full cut.
        circles: recordsCircles ? validCircles.map((c) => ({
          circleSkuId: c.sku.skuId, sizeLabel: c.sizeLabel || c.sku.skuName,
          pcs: Number(c.pcs || 0), weightKg: Number(c.weightKg),
        })) : undefined,
      }).unwrap();
      const saved = res?.data || {};
      enqueueSnackbar(isPartial
        ? `Partial cut ${saved.conversionNumber || ''} saved — ${num(coilWt)} kg cut${after ? `, ${num(after.remainingKg)} kg left on the coil` : ''}. Enter its circles with the Full cut.`
        : isFull
          ? `Full cut ${saved.conversionNumber || ''} saved — the coil is finished. Yield ${num(saved.yieldRatioPct)}% for the whole coil.`
          : `Conversion ${saved.conversionNumber || ''} saved — yield ${num(saved.yieldRatioPct)}%.`, { variant: 'success' });
      if (saved.receiptBinding === 'AUTO' && saved.coilReceiptId) {
        enqueueSnackbar(`Linked to coil ${saved.batchNo || ''} from its goods receipt — open the coil to see every round.`, { variant: 'info' });
      }
      if (saved.manualCoil?.created) {
        enqueueSnackbar(`Manual coil ${saved.manualCoil.batchNo} recorded at ${num(saved.manualCoil.originalWeightKg)} kg. Type its batch number to cut its next round.`, { variant: 'info' });
      }
      /*
       * The next cut starts from the same clean form every time. In particular
       * none of these is a sticky preference: "No receipt available" is a
       * statement about ONE coil, and Received At is a fact about the cut just
       * saved (a JW001 cut must not leave the next coil sitting on JW001).
       */
      setReceipt(null);
      setBoundManual(null);
      setPendingChoice(null);
      setPickedCoil(null);
      setRequestId(newRequestId());
      setHead((h) => ({
        ...h, batchNo: '', coilWeightKg: '', rate: '', manualFallback: false,
        warehouse: DEFAULT_RECEIVED_AT,
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
      text: qcPendingBatch ? qcPendingBatch.message : receiptOnRecord ? `Batch ${receiptOnRecord.batchNo} is on goods receipt${receiptOnRecord.grnNumber ? ` ${receiptOnRecord.grnNumber}` : ''} (${receiptOnRecord.skuCode}), with nothing on it that can be cut here — and a coil with a GRN cannot be entered manually.` : '',
      color: STOCK_TOKENS.OUT_OF_STOCK.color,
    },
    new: {
      text: options.length
        ? 'No coil has exactly this batch number — pick one from the list, or enter the coil details manually.'
        : 'No matching coil/GRN found. Enter the coil details manually.',
      color: STOCK_TOKENS.LOW.color,
    },
    // Short on purpose: the coil's weights sit beside "Total coil weight".
    bound: receipt
      ? (coilFacts.availableKg <= 0.001
        // Found — but there is nothing left to cut.
        ? { text: 'Coil found · fully cut — nothing is left on it.', color: STOCK_TOKENS.OUT_OF_STOCK.color }
        : coilFacts.sharedLedger
          // One batch on two receipts of this coil grade: say what that limits.
          ? {
            text: `Coil found${receipt.grnNumber ? ` · ${receipt.grnNumber}` : ''} · this batch is on another receipt too — this coil can take up to its own ${num(coilFacts.availableKg)} kg.`,
            color: STOCK_TOKENS.LOW.color,
          }
          : { text: `Coil found${receipt.grnNumber ? ` · ${receipt.grnNumber}` : ''}`, color: STOCK_TOKENS.OK.color })
      : existingManual
        ? (existingManual.availableKg <= 0.001
          ? { text: 'Manual coil found (no GRN) · fully cut — nothing is left on it.', color: STOCK_TOKENS.OUT_OF_STOCK.color }
          : { text: 'Manual coil found (no GRN)', color: STOCK_TOKENS.OK.color })
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
   * WHAT THE COIL HAS LEFT — one line under "Total coil weight", read straight
   * from `coilFacts` (the goods receipt and the batch ledger: the same
   * remaining figure the server checks a round against). This is an entry
   * form, so the coil's figures are a line, not a panel of cards.
   */
  const coilLeftText = coilFacts && !coilFacts.isNew
    ? `Already cut ${num(coilFacts.alreadyCutKg)} kg · ${num(coilFacts.availableKg)} kg left`
    : null;

  return (
    <Stack spacing={1.25} sx={{ minWidth: 0, '& > *': { minWidth: 0 } }} data-testid="coil-to-circle-form">
      {/* ── Step 1 — the coil ── */}
      <Panel>
        <StepHead n={1} title="Which coil is being cut?"
          hint="Type or pick the batch number — the coil's details fill in by themselves."
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
            helperText={coilLeftText
              || (untraceable ? 'Not needed — no coil to keep it against.'
                : isNewCoil ? (manualTotalBad ? 'Enter the coil\'s weight — a number above 0 kg.' : 'The whole coil, before any cutting.')
                  : undefined)}
            FormHelperTextProps={helperSx(manualTotalBad ? STOCK_TOKENS.OUT_OF_STOCK.color
              : coilLeftText ? (coilFacts.availableKg > 0.001 ? '#0f766e' : STOCK_TOKENS.OUT_OF_STOCK.color) : O2D.sub)} />
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
                      ? 'Not traceable to a coil — one entry: the weight cut and its circles. Untick it to type the batch number.'
                      : 'Only for a coil with no batch number to type above.'}
                  </Typography>
                </Box>
              )} />
          </Box>
        )}

        {/* The coil that was found is said in the Batch Number line and its
            weights under "Total coil weight" — no separate panel, so the form
            reads as one form. Clearing the batch field lets go of the coil. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.25, mt: 1.5 }}>
          <TextField select size="small" label="Received At" value={head.warehouse}
            onChange={(e) => setHead((h) => ({ ...h, warehouse: e.target.value }))}>
            {RECEIVED_AT_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
          </TextField>
          {/* Filled from the coil's own record; asked only when it has none. */}
          <TextField size="small" type="number" label="Rate (₹ per kg)" value={head.rate}
            onChange={(e) => setHead((h) => ({ ...h, rate: e.target.value }))}
            helperText={(isNewCoil || untraceable || (existingManual && !existingManual.rate)) ? 'The rate paid for this coil, where known.' : undefined}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }} />
        </Box>

        {/* ── THIS CUTTING ROUND ────────────────────────────────────────────
            With a physical coil linked, the operator says what this round is:
            Full (everything left — the system fills the weight — and the
            circles of the whole coil in step 2) or Partial (type the weight;
            nothing else is asked, the rest stays for a later round). That
            choice is the INSTRUCTION for this round; the coil's status after it
            is still worked out from the weights, never from the choice. */}
        <Box data-testid="this-cutting-round" sx={{
          mt: 1.5, px: 1.5, py: 1.25, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt,
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 1.5, alignItems: 'start',
        }}>
          {/* Cut before: what has already happened to this coil, first. */}
          {cutBefore && (
            <Stack direction="row" spacing={1} alignItems="flex-start" data-testid="coil-cut-before"
              sx={{
                gridColumn: '1 / -1', px: 1.25, py: 0.9, borderRadius: '7px',
                border: `1px solid ${(coilDone ? STOCK_TOKENS.OUT_OF_STOCK : STOCK_TOKENS.LOW).border}`,
                bgcolor: (coilDone ? STOCK_TOKENS.OUT_OF_STOCK : STOCK_TOKENS.LOW).tint,
              }}>
              <Box sx={{ color: (coilDone ? STOCK_TOKENS.OUT_OF_STOCK : STOCK_TOKENS.LOW).color, display: 'flex', pt: 0.2 }}><History size={16} /></Box>
              <Typography sx={{ fontSize: '0.76rem', color: O2D.ink, lineHeight: 1.45 }}>
                {coilDone ? (
                  <><b>This coil is already fully cut</b> — {num(coilFacts.alreadyCutKg)} kg of {num(coilFacts.originalKg)} kg. Nothing is left on it to cut.</>
                ) : (
                  <>
                    <b>This coil was cut before</b>
                    {coilFacts.rounds ? ` — ${coilFacts.rounds} time${coilFacts.rounds === 1 ? '' : 's'}` : ''}
                    {lastCutAt ? `, last on ${dayjs(lastCutAt).format('DD MMM YYYY')}` : ''}
                    : {num(coilFacts.alreadyCutKg)} kg of {num(coilFacts.originalKg)} kg cut, <b>{num(coilFacts.availableKg)} kg left</b>.
                    {coilFacts.pendingKg > 0.001 && ` The circles of the ${num(coilFacts.pendingKg)} kg cut so far are entered with the full cut.`}
                  </>
                )}
              </Typography>
            </Stack>
          )}
          {/* Always on screen; usable only once there is a coil to cut. A
              "No receipt available" cut has no coil to finish later, so there
              is nothing to choose: it is one entry, weight and circles. */}
          {untraceable ? (
            <Box data-testid="cut-type-none">
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: O2D.ink }}>Cutting type</Typography>
              <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.4 }}>
                One entry — no coil to finish later, so enter the weight cut and the circles it produced.
              </Typography>
            </Box>
          ) : (
            <FormControl disabled={noCoil}>
              <FormLabel id="cut-type-label" sx={{ fontSize: '0.7rem', fontWeight: 800, color: O2D.ink, '&.Mui-focused': { color: O2D.ink }, '&.Mui-disabled': { color: O2D.faint } }}>
                {/* A coil cut before is asked what happens next; a fresh one, which cut. */}
                {cutBefore && !coilDone ? 'What do you want to do now?' : 'Cutting type'}
              </FormLabel>
              <RadioGroup row aria-labelledby="cut-type-label" value={cutType || ''}
                onChange={(e) => setCutType(e.target.value)}>
                <FormControlLabel value="PARTIAL" disabled={noCoil || coilDone} control={<Radio size="small" />}
                  label={(
                    <Box>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit' }}>
                        {cutBefore ? 'Partial cut again' : 'Partial cutting'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.62rem', color: O2D.sub }}>
                        {noCoil ? 'Choose the coil first'
                          : coilDone ? 'Nothing left on this coil'
                            : cutBefore ? 'Cut some more — enter only the weight' : 'Enter only the weight cut'}
                      </Typography>
                    </Box>
                  )} />
                <FormControlLabel value="FULL" disabled={noCoil || !coilFacts || coilFacts.availableKg <= 0.001}
                  control={<Radio size="small" />}
                  label={(
                    <Box>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'inherit' }}>
                        {cutBefore ? 'Full cut — finish it' : 'Full cutting'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.62rem', color: O2D.sub }}>
                        {!coilFacts ? (noCoil ? 'Choose the coil first' : 'Needs a physical coil')
                          : coilFacts.availableKg <= 0.001 ? 'Nothing left on this coil'
                            : cutBefore ? `Cut the remaining ${num(coilFacts.availableKg)} kg and enter all its circles`
                              : 'Cut the whole coil and enter its circles'}
                      </Typography>
                    </Box>
                  )} />
              </RadioGroup>
            </FormControl>
          )}

          {/* The weight this round takes. Full: the system's figure, read-only.
              Partial: typed. Sent as `coilWeightKg` — exactly what the server
              deducts from the coil for this round. */}
          <TextField size="small" type="number" label="Cut this round (kg)"
            value={isFull ? String(coilFacts.availableKg) : head.coilWeightKg}
            onChange={(e) => setHead((h) => ({ ...h, coilWeightKg: e.target.value }))}
            disabled={noCoil || cutTypeMissing}
            placeholder={noCoil ? 'Choose the coil first' : cutTypeMissing ? 'Choose Full or Partial first' : undefined}
            InputLabelProps={noCoil || cutTypeMissing ? { shrink: true } : undefined}
            error={shortCoil || gradeShort || badWeight || partialTakesAll}
            inputProps={{ min: 0, step: 'any', readOnly: isFull }}
            sx={isFull ? { '& .MuiInputBase-root': { bgcolor: O2D.surfaceAlt } } : { '& .MuiInputBase-root': { bgcolor: O2D.surface } }}
            // One line: what to do next, what is wrong, or what this round
            // leaves on the coil — the round's figures, without a panel for them.
            helperText={noCoil ? (untraceable ? 'Choose the coil being cut above first.'
              : isNewCoil ? 'Choose the coil and enter its total weight above first.'
                : batchState === 'ambiguous' ? 'Pick which coil this is from the Batch Number list first.'
                  : 'Enter the batch number above first.')
              : cutTypeMissing ? 'Choose Full or Partial.'
                : isFull ? 'All that is left on the coil — filled in for you.'
                  : badWeight ? 'Enter a weight above 0 kg.'
                    : partialTakesAll ? 'That is all that is left — choose Full cutting.'
                      : shortCoil ? (coilFacts
                        ? `Only ${num(available)} KG is available from this physical coil.`
                        : `Only ${num(available)} KG of ${coil.skuCode} is in RM stock.`)
                        : gradeShort ? `Only ${num(gradeOnHand)} KG of ${coil.skuCode} is in RM stock.`
                          : after ? `${num(after.remainingKg)} kg will be left on the coil.`
                            : coilFacts ? `Less than the ${num(coilFacts.availableKg)} kg left.`
                              : (coil ? `${num(coil.onHand)} in store.` : 'Pick a coil first.')}
            FormHelperTextProps={{ component: 'div', sx: { fontSize: '0.66rem', color: (shortCoil || gradeShort || badWeight || partialTakesAll) ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.sub, mx: 0 } }} />
        </Box>

        {/* Last in the round: the existing over-cut override — offered only
            where it changes something (see `showOverride`). */}
        {showOverride && (
          <FormControlLabel
            sx={{ mt: 0.75 }}
            control={<Switch size="small" checked={head.allowNegative}
              onChange={(e) => setHead((h) => ({ ...h, allowNegative: e.target.checked }))} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Allow cutting more coil than we hold</Typography>}
          />
        )}
        {/* The override is allowed, never silent: the negative balance it
            leaves is spelled out right under the switch that allowed it. */}
        {!overCut && overdrawn && (
          <Paper elevation={0} data-testid="overdrawn-warning" sx={{
            mt: 0.75, borderRadius: '8px', px: 1.5, py: 1,
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

      {/* ── Step 2 — the circles: only for a cut that records them. A Partial
          round records its weight alone; its circles come with the Full cut. ── */}
      {recordsCircles && (
      <Panel>
        <StepHead
          n={2}
          title={isFull ? 'Circles cut from this coil' : 'Circles cut'}
          // One line: which weight the circles are counted from. A coil cut
          // the old way already has some circles entered — only the rest now.
          hint={isFull
            ? (round2((coilFacts.roundsCutKg || 0) - (pendingKg || 0)) > 0.001
              ? `Enter the circles from the last ${num(basisKg)} kg — the earlier rounds' circles are already entered.`
              : `Enter every circle cut from the whole coil (${num(basisKg)} kg).`)
            : 'Enter the circles this cut produced.'}
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
          <Table size="small" sx={imsTableSx(620)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                {/* No "Size label" box: it was optional, and the circle's own
                    name is saved as its label (see submit). */}
                <TableCell><Th label="Circle produced" hint={H.circleProduced} /></TableCell>
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

        {/* No scrap / yield preview: this is the entry form. The server works
            out both for the whole coil (settledKg) and the history shows them.
            What stops a round being saved because of its circles is said next
            to the circles; the rest is on "Cut this round" in step 1. */}
        {missingPcs.length > 0 && (
          <Paper elevation={0} data-testid="missing-pcs-warning" sx={{
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
          <Paper elevation={0} data-testid="over-cut-warning" sx={{
            mt: 1.25, borderRadius: '8px', px: 1.5, py: 1,
            border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ color: STOCK_TOKENS.OUT_OF_STOCK.color, display: 'flex' }}><AlertTriangle size={16} /></Box>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                The circles weigh {num(Math.abs(scrap))}kg more than the {isFull ? `${num(basisKg)} kg of coil they came from` : 'coil'}. Metal cannot be created — check the weights.
              </Typography>
            </Stack>
          </Paper>
        )}
      </Panel>
      )}

      {/* ── Save / Cancel — straight after the circles. Scrap and yield are
          worked out on saving and shown in the history. ── */}
      {/* On a phone Save takes the rest of the row, so its label stays on one line. */}
      <Stack direction="row" justifyContent="flex-end" spacing={1} data-testid="form-footer">
        {onCancel && (
          <Button variant="outlined" onClick={onCancel} disabled={isLoading}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body, flexShrink: 0 }}>
            Cancel
          </Button>
        )}
        <Button variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand, whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
          {isPartial ? 'Save partial cut' : isFull ? 'Save full cut' : 'Save this conversion'}
        </Button>
      </Stack>
    </Stack>
  );
};

export default CoilToCircleForm;
