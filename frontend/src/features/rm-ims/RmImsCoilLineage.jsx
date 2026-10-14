import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Button, Alert, Collapse, IconButton, Tooltip, Chip,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Disc3, Scissors, Recycle, CircleDashed, AlertTriangle, ChevronRight, ChevronDown,
  ArrowUpRight, ScrollText, Download,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, KpiTile, EmptyNote, Th, Help, YieldChip,
  O2D, O2D_TIP, num, imsTableSx,
} from './rmImsMeta';
// The scrap chips, not copies of them. A disposition means exactly the same
// thing here as it does in the Scrap register, and a second set of tokens would
// be the one that still said "Job work" the day the client renamed it.
import { LocationChip, DispositionChip } from '../scrap-ims/scrapImsMeta';
import { useGetRmCoilLineageQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const kg = (v) => (v == null ? '—' : `${num(v)} kg`);
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

/** One figure with its name and a definition — the same shape Scrap Detail uses. */
const Metric = ({ label, value, hint, sub, tone }) => (
  <Box sx={{ minWidth: 132, flex: '1 1 132px', p: 1.1, borderRadius: '8px', border: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface }}>
    <Stack direction="row" spacing={0.4} alignItems="center">
      <Typography sx={{ fontSize: '0.63rem', fontWeight: 800, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      {hint && <Help text={hint} />}
    </Stack>
    <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: tone || O2D.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
      {value}
    </Typography>
    {sub && <Typography noWrap sx={{ fontSize: '0.62rem', color: O2D.faint }}>{sub}</Typography>}
  </Box>
);

/**
 * ONE PHYSICAL COIL, END TO END.
 *
 * The screen the client asked for in their own words: open a received coil and
 * read off how many times it was cut, how much went in each time, what came out
 * as circles, what was left as scrap, and how much coil remained after every
 * round.
 *
 * Every figure on this page is DERIVED on the server from the goods receipt,
 * the conversions that name it and their scrap records. Nothing here is stored
 * as a counter, which is why the page can never drift from the ledger — see
 * backend `coilLineage.js`.
 */
const RmImsCoilLineage = () => {
  const { receiptId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useGetRmCoilLineageQuery(receiptId, { skip: !receiptId });

  // Round 1 opens by default on a coil cut once — a single collapsed row is a
  // click that tells the reader nothing they could not already see.
  const [open, setOpen] = useState(() => new Set());
  const toggle = (n) => setOpen((p) => {
    const next = new Set(p);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });

  const rounds = data?.data || [];
  const meta = data?.meta || {};
  const r = meta.receipt;
  const t = meta.totals || {};
  const other = meta.otherMovements || [];

  if (isLoading) {
    return (
      <RmShell icon={Disc3} title="Coil history" subtitle="Loading…"
        onBack={() => navigate('/rm-ims/conversion')} backLabel="Back to Cut coils">
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={320} />
      </RmShell>
    );
  }

  if (isError || !r) {
    return (
      <RmShell icon={Disc3} title="Coil history" subtitle="This coil could not be opened"
        onBack={() => navigate('/rm-ims/conversion')} backLabel="Back to Cut coils">
        <Alert severity="error" icon={<AlertTriangle size={17} />} sx={{ borderRadius: '8px' }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
            {error?.data?.message || 'That received coil could not be found.'}
          </Typography>
          <Typography sx={{ fontSize: '0.74rem' }}>
            A coil is opened by its goods receipt. If you arrived here from an older link, search the coil again in Cut coils.
          </Typography>
        </Alert>
      </RmShell>
    );
  }

  const exportCsv = () => {
    const header = ['Round', 'Date', 'Conversion', 'Cut (kg)', 'Circles (kg)', 'Scrap (kg)', 'Yield %', 'Remaining after (kg)', 'Where', 'Checked'];
    const lines = rounds.map((x) => [
      x.roundNo, x.date ? dayjs(x.date).format('YYYY-MM-DD') : '', x.conversionNumber,
      x.cutKg, x.circlesKg, x.scrapKg, x.yieldPct ?? '', x.remainingAfterKg,
      x.location || '', x.disposition || '',
    ]);
    const csv = [header, ...lines].map((x) => x.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `coil_${r.batchNo || r.movementNumber}_rounds.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // A manual-entry coil has no goods receipt — said once, and no receipt
  // paperwork is shown for it, because there is none.
  const isManual = r.source === 'MANUAL';
  const identity = [
    isManual && 'Manual entry — no GRN',
    r.grnNo && `GRN ${r.grnNo}`,
    r.poNo && `PO ${r.poNo}`,
    r.indentCode && `Indent ${r.indentCode}`,
    r.supplier,
  ].filter(Boolean).join(' · ');

  return (
    <RmShell
      icon={Disc3}
      title={`Coil ${r.batchNo || r.movementNumber}`}
      subtitle={`${r.itemName} · ${r.skuCode} · ${isManual ? 'entered' : 'received'} ${day(r.receivedDate)}${identity ? ` · ${identity}` : ''}`}
      onBack={() => navigate('/rm-ims/conversion')}
      backLabel="Back to Cut coils"
      actions={(
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rounds.length}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Export rounds
          </Button>
          <Button size="small" variant="outlined" startIcon={<Recycle size={14} />}
            onClick={() => navigate('/scrap-ims/records')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Scrap master data
          </Button>
        </Stack>
      )}
    >
      {/* ── What this coil is, and where it came from ── */}
      <Paper elevation={0} sx={{ p: 1.25, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Batch ${r.batchNo || '—'}`}
            sx={{ height: 22, fontWeight: 800, fontSize: '0.68rem', borderRadius: '999px', fontFamily: 'ui-monospace, monospace' }} />
          <Chip size="small" variant="outlined" label={isManual ? 'Manual entry · no GRN' : r.movementNumber}
            sx={{ height: 22, fontWeight: 700, fontSize: '0.66rem', borderRadius: '999px', fontFamily: 'ui-monospace, monospace', color: O2D.sub }} />
          {r.warehouse && <Chip size="small" variant="outlined" label={`Received at ${r.warehouse}`} sx={{ height: 22, fontSize: '0.66rem', borderRadius: '999px', color: O2D.sub }} />}
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, ml: { sm: 'auto' } }}>
            {t.rounds === 0
              ? 'This coil has not been cut yet — it is whole.'
              : `Cut ${num(t.rounds)} time${t.rounds === 1 ? '' : 's'}${t.fullyCut ? ' — nothing left of it.' : `, ${kg(t.remainingKg)} still on the floor.`}`}
          </Typography>
        </Stack>
      </Paper>

      {/* The one case where the numbers below would mislead if left unexplained. */}
      {t.overCut && (
        <Alert severity="error" icon={<AlertTriangle size={17} />} sx={{ borderRadius: '8px' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>More has been cut from this coil than ever arrived.</Typography>
          <Typography sx={{ fontSize: '0.74rem' }}>
            It was received at {kg(t.receivedKg)} but {kg(t.cutKg)} has been cut, leaving {kg(t.remainingKg)}. That is a data
            fault, not a coil — someone has booked a cut against the wrong batch, or a receipt is missing. It is shown rather
            than hidden so it can be corrected.
          </Typography>
        </Alert>
      )}

      {/* The derived remainder and the ledger's own balance, when they differ.
          Suppressed when there are no rounds at all: the empty state in the
          table below explains that case properly, and two banners saying the
          same thing in different words is worse than one. */}
      {t.reconciles === false && rounds.length > 0 && (
        <Alert severity="warning" icon={<AlertTriangle size={17} />} sx={{ borderRadius: '8px' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
            The cutting rounds account for {kg(t.remainingKg)}, but the stock ledger says {kg(t.ledgerAvailableKg)}.
          </Typography>
          <Typography sx={{ fontSize: '0.74rem' }}>
            Something other than a cut has moved this batch — a correction, an issue, or a cut booked without naming this
            receipt. The movements are listed at the bottom of this page.
          </Typography>
        </Alert>
      )}

      {/* ── The coil's totals ── */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <KpiTile label={isManual ? 'Total coil weight' : 'Received'} value={kg(t.receivedKg)} icon={Disc3}
          sub={isManual ? 'Entered for the whole coil (no GRN)' : 'What physically arrived'} />
        <KpiTile label="Total cut" value={kg(t.cutKg)} icon={Scissors} color="#0f766e"
          sub={`${num(t.rounds)} cutting round${t.rounds === 1 ? '' : 's'}`} />
        <KpiTile label="Output / circles" value={kg(t.circlesKg)} icon={CircleDashed} color="#4338ca"
          sub="Usable blanks produced" />
        <KpiTile label="Total scrap" value={kg(t.scrapKg)} icon={Recycle} color="#b45309"
          sub={t.scrapPct != null ? `${num(t.scrapPct)}% of what was cut` : 'Nothing cut yet'} />
        <KpiTile label="Remaining" value={kg(t.remainingKg)} icon={Disc3}
          color={t.overCut ? '#b91c1c' : t.fullyCut ? O2D.sub : '#15803d'}
          sub="Received minus everything cut" />
      </Stack>

      <Panel title="The coil" hint="Its identity, what it cost, and the paperwork it arrived on.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Item" value={r.skuCode} sub={r.itemName} />
          <Metric label="Batch no" value={r.batchNo || '—'} hint={H.batchNo} />
          <Metric label={isManual ? 'Total coil weight' : 'Received'} value={kg(r.receivedWeightKg)} sub={day(r.receivedDate)} />
          <Metric label="Rate" value={r.unitCost ? `₹${num(r.unitCost)} / kg` : '—'}
            hint="The rate actually paid for THIS coil, off its own goods receipt — not the item's average cost." />
          <Metric label="GRN" value={r.grnNo || (isManual ? 'None — manual entry' : '—')} sub={r.indentCode ? `Indent ${r.indentCode}` : null} />
          <Metric label="PO" value={r.poNo || '—'} sub={r.piNo ? `PI ${r.piNo}` : null} />
          <Metric label="Supplier" value={r.supplier || '—'} />
          <Metric label="Average yield" value={t.avgYieldPct != null ? `${num(t.avgYieldPct)}%` : '—'}
            sub="Circles ÷ coil cut, across every round" />
        </Stack>
      </Panel>

      {/* ── The rounds ── */}
      <Panel
        title="Cutting rounds"
        icon={Scissors}
        hint={rounds.length
          ? 'Every time this coil went to the machine, oldest first. Open a round to see the circles it produced and the scrap it left.'
          : 'This coil has not been cut yet.'}
      >
        <TableScroll>
          <Table size="small" sx={imsTableSx(940)}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }} />
                <TableCell align="center" sx={{ width: 70, whiteSpace: 'nowrap' }}>Round</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>Date</TableCell>
                <TableCell align="right"><Th label="Cut (kg)" hint="How much coil went into the machine in this round." /></TableCell>
                <TableCell align="right"><Th label="Output (kg)" hint="Weight of the usable circles this round produced." /></TableCell>
                <TableCell align="right"><Th label="Scrap (kg)" hint="Cut weight minus circle weight — the offcut this round left behind." /></TableCell>
                <TableCell align="right"><Th label="Yield" hint={H.yieldPct} /></TableCell>
                <TableCell align="right">
                  <Th label="Remaining (kg)" hint="What was left of the coil after this round: received weight minus everything cut up to and including it. Scrap is NOT subtracted again — it was already part of the cut weight." />
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>Scrap</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rounds.length === 0 && (
                <TableRow><TableCell colSpan={9} sx={{ border: 0, p: 0 }}>
                  {/* Two very different situations look identical here — an
                      untouched coil and a historical one — so they are told
                      apart by the ledger rather than given one vague message.
                      A coil the ledger has fully consumed with no rounds to
                      show was cut before cuts recorded which coil they came
                      off, and saying so beats implying it is still intact. */}
                  {t.ledgerAvailableKg <= 0 && t.receivedKg > 0 ? (
                    <EmptyNote
                      icon={AlertTriangle}
                      title="This coil was used up before cuts recorded which coil they came from"
                      hint="The stock ledger shows nothing left of it, but no cutting round names this goods receipt — so its rounds, and the scrap they produced, cannot be shown. Historical cuts are not linked to a coil after the fact, because a batch number written on a label is not proof of which delivery it came from. The movements that consumed it are listed below."
                    />
                  ) : (
                    <EmptyNote icon={Scissors} title="This coil has not been cut"
                      hint="All of it is still on the floor. Cut it in Cut coils and each round will appear here." />
                  )}
                </TableCell></TableRow>
              )}
              {rounds.map((x) => {
                const isOpen = open.has(x.roundNo) || rounds.length === 1;
                return (
                  <React.Fragment key={x.conversionId}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => toggle(x.roundNo)}>
                      <TableCell sx={{ width: 40 }}>
                        <IconButton size="small" sx={{ color: O2D.sub }}
                          aria-label={isOpen ? `Hide round ${x.roundNo}` : `Show round ${x.roundNo}`}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </IconButton>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{
                          width: 24, height: 24, borderRadius: '50%', display: 'inline-grid', placeItems: 'center',
                          fontSize: '0.7rem', fontWeight: 800, bgcolor: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4',
                        }}>{x.roundNo}</Box>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{day(x.date)}</Typography>
                        <Typography sx={{ fontSize: '0.64rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{x.conversionNumber}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: O2D.ink }}>{num(x.cutKg)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>{num(x.circlesKg)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#b45309' }}>{num(x.scrapKg)}</TableCell>
                      <TableCell align="right">{x.yieldPct != null ? <YieldChip pct={x.yieldPct} /> : '—'}</TableCell>
                      <TableCell align="right" sx={{
                        fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                        color: x.remainingAfterKg < 0 ? '#b91c1c' : x.remainingAfterKg === 0 ? O2D.sub : O2D.ink,
                      }}>{num(x.remainingAfterKg)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {x.location && <LocationChip location={x.location} />}
                          {x.disposition && <DispositionChip disposition={x.disposition} />}
                          {!x.location && !x.disposition && <Typography sx={{ fontSize: '0.7rem', color: O2D.faint }}>—</Typography>}
                        </Stack>
                      </TableCell>
                    </TableRow>

                    {/* ── What this round actually produced ── */}
                    <TableRow>
                      <TableCell colSpan={9} sx={{ p: 0, border: 0 }}>
                        <Collapse in={isOpen} unmountOnExit>
                          <Box sx={{ px: 2, py: 1.25, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.lineSoft}` }}>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.ink }}>
                                Round {x.roundNo} · {x.conversionNumber}
                              </Typography>
                              {x.coilMovementNumber && (
                                <Tooltip arrow slotProps={O2D_TIP} title="The ledger row that took this weight off the coil.">
                                  <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace', cursor: 'help' }}>
                                    coil out {x.coilMovementNumber}
                                  </Typography>
                                </Tooltip>
                              )}
                              {x.scrapStockMovementId ? (
                                <Tooltip arrow slotProps={O2D_TIP}
                                  title="This round's offcut was put into scrap stock, because it was cut in-house. Job-work offcuts stay with the job worker and create no stock.">
                                  <Chip size="small" label="Scrap stocked" sx={{ height: 20, fontSize: '0.64rem', fontWeight: 700, borderRadius: '999px', bgcolor: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }} />
                                </Tooltip>
                              ) : (
                                <Tooltip arrow slotProps={O2D_TIP}
                                  title="No scrap stock was created for this round — either it was cut by a job worker, or the cut produced no offcut.">
                                  <Chip size="small" variant="outlined" label="No scrap stock" sx={{ height: 20, fontSize: '0.64rem', borderRadius: '999px', color: O2D.sub }} />
                                </Tooltip>
                              )}
                              {x.scrapRecordId && (
                                <Button size="small" endIcon={<ArrowUpRight size={13} />}
                                  onClick={(e) => { e.stopPropagation(); navigate(`/scrap-ims/record/${x.scrapRecordId}`); }}
                                  sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.7rem', ml: 'auto', minHeight: 0, py: 0.1 }}>
                                  Open the scrap record
                                </Button>
                              )}
                            </Stack>

                            <TableScroll>
                              <Table size="small" sx={imsTableSx(620)}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Circle</TableCell>
                                    <TableCell>Size</TableCell>
                                    <TableCell align="right"><Th label="Pieces" hint={H.pieces} /></TableCell>
                                    <TableCell align="right"><Th label="Weight (kg)" hint={H.weightKg} /></TableCell>
                                    <TableCell>Movement</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {x.circles.length === 0 && (
                                    <TableRow><TableCell colSpan={5} sx={{ border: 0, p: 0 }}>
                                      <EmptyNote dense icon={CircleDashed} title="No circles recorded for this round" />
                                    </TableCell></TableRow>
                                  )}
                                  {x.circles.map((c, i) => (
                                    <TableRow key={`${x.conversionId}-${c.skuCode}-${i}`}>
                                      <TableCell sx={{ maxWidth: 220 }}>
                                        <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.ink }}>{c.itemName}</Typography>
                                        <Typography sx={{ fontSize: '0.63rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{c.skuCode}</Typography>
                                      </TableCell>
                                      <TableCell sx={{ fontSize: '0.72rem', color: O2D.sub }}>{c.sizeLabel || '—'}</TableCell>
                                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.pcs)}</TableCell>
                                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(c.weightKg)}</TableCell>
                                      <TableCell sx={{ fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace', color: O2D.sub }}>{c.movementNumber || '—'}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableScroll>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>

      {/* ── Everything else that touched this batch ── */}
      {other.length > 0 && (
        <Panel
          title="Other movements against this batch"
          icon={ScrollText}
          hint="Not cutting rounds — corrections, issues, or a cut booked without naming this receipt. These are why the ledger balance can differ from the figure the rounds account for."
        >
          <TableScroll>
            <Table size="small" sx={imsTableSx(760)}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>Date</TableCell>
                  <TableCell>Movement</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell>Where</TableCell>
                  <TableCell>Why</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {other.map((m) => (
                  <TableRow key={m.movementId} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{day(m.movementDate)}</TableCell>
                    <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: O2D.sub }}>{m.movementNumber}</TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700, color: m.movementType === 'IN' ? '#15803d' : '#b45309' }}>{m.txnType}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {m.movementType === 'IN' ? '+' : '−'}{num(m.quantity)}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: O2D.sub }}>{m.warehouse || '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: O2D.sub, maxWidth: 260 }}>
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                        {m.reason || m.remarks || m.refNumber || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {/* ── Where to go next ── */}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Button size="small" variant="outlined" startIcon={<Scissors size={14} />} onClick={() => navigate('/rm-ims/conversion')}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Cut this coil
        </Button>
        {r.skuId && (
          <Button size="small" variant="outlined" startIcon={<Disc3 size={14} />} onClick={() => navigate(`/rm-ims/item/${r.skuId}`)}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Open {r.skuCode} in Raw Material
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<Recycle size={14} />} onClick={() => navigate('/scrap-ims')}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Scrap overview
        </Button>
      </Stack>
    </RmShell>
  );
};

export default RmImsCoilLineage;
