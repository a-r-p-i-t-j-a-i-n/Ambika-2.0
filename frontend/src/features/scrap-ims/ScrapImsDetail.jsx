import React from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell, Button, Alert,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { Recycle, AlertTriangle, ArrowUpRight, CircleDashed } from 'lucide-react';
import dayjs from 'dayjs';
import {
  ScrapShell, SCRAP_ACCENT, Panel, TableScroll, EmptyNote, Th, Help,
  LocationChip, DispositionChip, BatchStatusChip, kg, SCRAP_UOM, yieldBand,
  O2D, num, imsTableSx,
} from './scrapImsMeta';
import { useGetScrapRecordQuery } from '../../store/api/scrapImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.scrap;

/** One figure with its name and a definition — same shape as RM's Item Detail. */
const Metric = ({ label, value, hint, sub, tone }) => (
  <Box sx={{ minWidth: 138, flex: '1 1 138px', p: 1.1, borderRadius: '8px', border: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface }}>
    <Stack direction="row" spacing={0.4} alignItems="center">
      <Typography sx={{ fontSize: '0.63rem', fontWeight: 800, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      {hint && <Help text={hint} />}
    </Stack>
    <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: tone || O2D.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
      {value}
    </Typography>
    {sub && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>{sub}</Typography>}
  </Box>
);

const ScrapImsDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useGetScrapRecordQuery(id);
  const r = data?.data;

  if (isLoading || !r) {
    return (
      <ScrapShell icon={Recycle} title="Scrap record" subtitle="Loading…"
        onBack={() => navigate('/scrap-ims/records')} backLabel="Back to the scrap register">
        <Skeleton variant="rounded" height={320} />
      </ScrapShell>
    );
  }

  const uncut = r.batchStatus === 'UNCUT';
  // An uncut coil was never cut, so it reads "recorded" — saying "cut" would
  // contradict the warning this same page shows right below the heading.
  const when = `${uncut ? 'recorded' : 'cut'} ${r.scrapDate ? dayjs(r.scrapDate).format('DD MMM YYYY') : 'date unknown'}`;

  return (
    <ScrapShell
      icon={Recycle}
      title={`Batch ${r.batchNo}`}
      subtitle={`${r.coilSkuName} · ${r.coilSkuCode} · ${when}`}
      onBack={() => navigate('/scrap-ims/records')}
      backLabel="Back to the scrap register"
    >
      <Paper elevation={0} sx={{ p: 1.25, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <LocationChip location={r.location} />
          <DispositionChip disposition={r.disposition} />
          <BatchStatusChip batchStatus={r.batchStatus} />
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, ml: { sm: 'auto' } }}>
            {r.isPhysicalScrap
              ? 'In-house cutting — this is scrap Ambika physically holds.'
              : 'Job-work cutting — the offcuts stayed with the job worker.'}
          </Typography>
        </Stack>
      </Paper>

      {/* An uncut coil is the one case where the numbers below would mislead. */}
      {uncut && (
        <Alert severity="warning" icon={<AlertTriangle size={17} />} sx={{ borderRadius: '8px' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>This coil was never cut, so no scrap came off it.</Typography>
          <Typography sx={{ fontSize: '0.74rem' }}>
            The client's sheet computes scrap as <b>coil weight − circle weight</b>. With no circles recorded, that
            makes the whole {kg(r.coilWeightKg)} coil look like scrap. It is excluded from every scrap total in this
            module, and the coil is treated as intact.
          </Typography>
        </Alert>
      )}

      <Panel title="The cut" hint="Coil in, circles out, and what was left.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Coil weight" value={kg(r.coilWeightKg)} hint={H.coilWeight} />
          <Metric label="Circles produced" value={uncut ? '—' : kg(r.circlesWeightKg)} hint={H.circlesWeight} />
          <Metric label="Scrap" value={uncut ? 'not scrap' : kg(r.scrapKg)}
            tone={uncut ? O2D.faint : SCRAP_ACCENT}
            hint="Coil weight minus circle weight. Nothing weighs the scrap separately — the client derives it the same way." />
          <Metric label="Yield" value={r.yieldRatioPct != null ? `${num(r.yieldRatioPct)}%` : '—'}
            tone={yieldBand(r.yieldRatioPct, r.disposition)?.color}
            sub={yieldBand(r.yieldRatioPct, r.disposition)?.label}
            hint={H.yieldPct} />
          <Metric label="Checked?" value={r.disposition === 'PENDING' ? 'Not yet' : r.disposition === 'JOB_WORK' ? 'Job work' : r.disposition === 'DONE' ? 'Verified' : 'Rejected'}
            sub={r.verifiedAt ? dayjs(r.verifiedAt).format('DD MMM YYYY') : null}
            hint="The only figure in the client's scrap sheet that a person types. Everything else on this page is derived." />
          <Metric label="UOM" value={SCRAP_UOM} hint={H.unit} />
        </Stack>
      </Panel>

      <Panel title="Circles produced from this coil"
        hint={uncut ? 'None — this coil was not cut.' : `${num(r.circles.length)} size${r.circles.length === 1 ? '' : 's'} came off this batch.`}>
        <TableScroll>
          <Table size="small" sx={imsTableSx(720)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell>Circle</TableCell>
                <TableCell>Size label</TableCell>
                <TableCell align="right"><Th label="Pieces" hint={H.pieces} /></TableCell>
                <TableCell align="right"><Th label="Weight (kg)" hint={H.weightKg} /></TableCell>
                <TableCell>Movement</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {r.circles.length === 0 && (
                <TableRow><TableCell colSpan={6} sx={{ border: 0 }}>
                  <EmptyNote icon={CircleDashed} title="No circles recorded"
                    hint={uncut ? 'This coil was never cut.' : 'The conversion behind this batch has no circle lines.'} />
                </TableCell></TableRow>
              )}
              {r.circles.map((c, i) => (
                <TableRow key={c._id || i} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{c.circleSkuName}</Typography>
                    <Typography sx={{ fontSize: '0.64rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{c.circleSkuCode}</Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.73rem', color: O2D.sub }}>{c.sizeLabel || '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.pcs)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(c.weightKg)}</TableCell>
                  <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', color: O2D.sub }}>{c.movementNumber || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>

      <Panel title="Where this came from" hint="Scrap is recorded, not stocked. The coil deduction it caused lives in the Raw Material ledger.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ alignItems: 'center' }}>
          <Metric label="Conversion" value={r.conversionNumber || '—'} sub={r.conversion ? 'Coil → circle cut' : 'no conversion document'} />
          {/* Whether this scrap can be pinned to one physical coil at all. Said
              plainly on the record itself, because it is the difference between
              "80 kg came off coil TX89165708" and a number nobody can source. */}
          <Metric
            label="Physical coil"
            value={r.coilReceiptId ? (r.batchNo || 'Linked') : 'Untraceable'}
            tone={r.coilReceiptId ? undefined : O2D.faint}
            sub={r.coilReceiptId ? 'Traced to its goods receipt' : 'No goods receipt recorded'}
            hint={r.coilReceiptId
              ? 'This cut records the exact goods receipt it consumed, so its scrap rolls up against that one physical coil.'
              : 'This record names a batch but not a goods receipt, so it cannot be attributed to a physical coil. Every row imported from the client’s workbook is in this position, and nothing is guessed after the fact — it is reported under “Untraceable” instead.'}
          />
          <Metric label="Coil rate" value={r.coilRate ? `₹${num(r.coilRate)} / kg` : '—'}
            hint="The COIL's rate, not a scrap rate. The source carries no price for scrap, so scrap cannot be valued." />
          <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }} flexWrap="wrap" useFlexGap>
            {/* The PHYSICAL coil, where this record names one. Offered only
                then: a record with no `coilReceiptId` knows the grade and not
                the coil, and a link that opened "some coil of this material"
                would be a lie dressed up as traceability. Every imported
                historical row is in that position, and nothing is guessed. */}
            {r.coilReceiptId && (
              <Button size="small" variant="contained" disableElevation endIcon={<ArrowUpRight size={14} />}
                onClick={() => navigate(`/rm-ims/coil/${r.coilReceiptId}`)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}>
                See this coil's full cutting history
              </Button>
            )}
            {r.coilSkuId && (
              <Button size="small" variant="outlined" endIcon={<ArrowUpRight size={14} />}
                onClick={() => navigate(`/rm-ims/item/${r.coilSkuId}`)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
                Open the coil in Raw Material
              </Button>
            )}
          </Stack>
        </Stack>
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsDetail;
