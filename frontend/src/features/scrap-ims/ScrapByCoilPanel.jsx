import React, { useState } from 'react';
import {
  Box, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Tooltip, TablePagination, Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Disc3, Scissors, HelpCircle } from 'lucide-react';
import dayjs from 'dayjs';
import {
  Panel, TableScroll, EmptyNote, Th, YieldChip, SCRAP_ACCENT,
  O2D, O2D_TIP, num, kg, imsTableSx,
} from './scrapImsMeta';
import { useGetScrapByCoilQuery } from '../../store/api/scrapImsApi';

/**
 * SCRAP BY PHYSICAL COIL.
 *
 * The client's question, in their words: "is particular physical coil se total
 * kitna scrap nikla?" — how much scrap came off THAT coil, the 2,000 kg one
 * that arrived on a particular GRN with a particular batch number.
 *
 * ── NOT THE SAME AS "SCRAP BY COIL GRADE" ──────────────────────────────────
 * The panel next to this one groups by SKU code: "how much scrap does
 * JSL204-08 produce as a material?". That is the client's Summary Scrap sheet
 * and it keeps working exactly as it did. This groups by the GOODS RECEIPT,
 * which is the physical coil. Both are labelled, because two tables of scrap
 * totals that do not add up to each other need to say why on their face.
 *
 * ── UNTRACEABLE IS SHOWN, NOT FILTERED ─────────────────────────────────────
 * Most historical scrap names a batch and no receipt, so it cannot be put
 * against a coil. It is reported as its own figure rather than dropped —
 * otherwise this table's total would silently disagree with every other scrap
 * figure in the module, for a reason nobody could see.
 */
const ScrapByCoilPanel = ({ filters = {}, limit = 25 }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(limit);

  const { data, isFetching, isError, error } = useGetScrapByCoilQuery({
    ...filters, page: page + 1, limit: rowsPerPage,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const traced = meta.traced || {};
  const untraceable = meta.untraceable || {};
  const pg = meta.pagination || {};

  return (
    <Panel
      title="Scrap by physical coil"
      icon={Disc3}
      hint="One row per coil actually received — the 2,000 kg coil on a particular GRN, not the grade. Open a row to see every cutting round it went through."
      dense
      actions={(
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Chip size="small" label={`${num(traced.coils || 0)} coils traced`}
            sx={{ height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', bgcolor: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4' }} />
          {/* Always rendered, even at zero, so the reader is told there is none
              rather than left wondering whether the figure is missing. */}
          <Tooltip arrow slotProps={O2D_TIP}
            title="Scrap recorded against a batch number but no goods receipt, so it cannot be attributed to a physical coil. Almost all of it is history imported from the client's workbook, and none of it is guessed into a coil after the fact.">
            <Chip
              size="small" icon={<HelpCircle size={11} />}
              label={`${kg(untraceable.scrapKg || 0)} untraceable`}
              sx={{
                height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', cursor: 'help',
                bgcolor: (untraceable.scrapKg || 0) > 0 ? '#fef3c7' : O2D.surfaceAlt,
                color: (untraceable.scrapKg || 0) > 0 ? '#b45309' : O2D.sub,
                border: `1px solid ${(untraceable.scrapKg || 0) > 0 ? '#fde68a' : O2D.line}`,
                '& .MuiChip-icon': { color: 'inherit', ml: 0.6, mr: -0.2 },
              }}
            />
          </Tooltip>
        </Stack>
      )}
    >
      <TableScroll>
        <Table size="small" sx={imsTableSx(1060)}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 58, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell>Coil / batch</TableCell>
              <TableCell>Item</TableCell>
              <TableCell align="right"><Th label="Received" hint="What this physical coil weighed when it arrived, off its own goods receipt." /></TableCell>
              <TableCell align="right"><Th label="Cut" hint="Everything cut off this coil, across every round." /></TableCell>
              <TableCell align="right"><Th label="Output" hint="Weight of the usable circles this coil has produced so far." /></TableCell>
              <TableCell align="right"><Th label="Scrap" hint="Total scrap from this one physical coil — the figure the client asked for." /></TableCell>
              <TableCell align="right"><Th label="Scrap %" hint="Scrap as a share of what was CUT, not of what arrived. A coil half of which is still on the floor has not had the chance to scrap the rest." /></TableCell>
              <TableCell align="right"><Th label="Yield" hint="Circles ÷ coil cut, weighted across every round on this coil." /></TableCell>
              <TableCell align="right"><Th label="Remaining" hint="Received minus everything cut. Scrap is NOT subtracted again — it was already part of the cut weight." /></TableCell>
              <TableCell align="right"><Th label="Rounds" hint="How many times this coil has been to the machine." /></TableCell>
              <TableCell>Supplier / GRN</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !rows.length && (
              <TableRow><TableCell colSpan={12} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
            )}
            {!isFetching && !rows.length && (
              <TableRow><TableCell colSpan={12} sx={{ border: 0, p: 0 }}>
                <EmptyNote
                  icon={Scissors}
                  title={isError ? 'Could not load scrap by physical coil.' : 'No scrap is traced to a physical coil yet'}
                  hint={isError ? (error?.data?.message || 'The server did not answer. Refresh the page to try again.')
                    : (untraceable.scrapKg || 0) > 0
                    ? `${kg(untraceable.scrapKg)} of scrap is on record, but none of it names a goods receipt. Cuts booked from now on pick the coil, so they will appear here.`
                    : 'Cut a coil in Raw Material and it will appear here.'}
                />
              </TableCell></TableRow>
            )}
            {rows.map((c, i) => (
              <TableRow
                key={c.coilId || c.coilReceiptId} hover sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/rm-ims/coil/${c.coilId || c.coilReceiptId}`)}
                data-testid="scrap-by-coil-row" data-batch={c.batchNo}
              >
                <TableCell align="center" sx={{ width: 58, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                  {page * rowsPerPage + i + 1}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography sx={{ fontSize: '0.77rem', fontWeight: 800, color: O2D.brand, fontFamily: 'ui-monospace, monospace' }}>
                    {c.batchNo || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.63rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>
                    {c.coilSource === 'MANUAL' ? 'Manual entry · no GRN' : (c.movementNumber || '')}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 200 }}>
                  <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.ink }}>{c.itemName}</Typography>
                  <Typography sx={{ fontSize: '0.63rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{c.skuCode}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                  {c.receiptMissing
                    ? (
                      <Tooltip arrow slotProps={O2D_TIP} title="The goods receipt behind this coil has been removed, so its arrival weight is unknown. The cutting figures are still real.">
                        <Box component="span" sx={{ cursor: 'help', color: O2D.faint }}>unknown</Box>
                      </Tooltip>
                    )
                    : kg(c.receivedKg)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>{kg(c.cutKg)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#4338ca' }}>{kg(c.circlesKg)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: SCRAP_ACCENT }}>{kg(c.scrapKg)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                  {c.scrapPct != null ? `${num(c.scrapPct)}%` : '—'}
                </TableCell>
                <TableCell align="right">{c.avgYieldPct != null ? <YieldChip pct={c.avgYieldPct} /> : '—'}</TableCell>
                <TableCell align="right" sx={{
                  fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                  color: c.receiptMissing ? O2D.faint : c.remainingKg < 0 ? '#b91c1c' : c.remainingKg === 0 ? O2D.sub : O2D.ink,
                }}>
                  {c.receiptMissing ? '—' : kg(c.remainingKg)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: O2D.ink }}>{num(c.rounds)}</TableCell>
                <TableCell sx={{ maxWidth: 190 }}>
                  <Typography noWrap sx={{ fontSize: '0.73rem', color: O2D.body }}>{c.supplier || '—'}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.63rem', color: O2D.sub }}>
                    {[c.grnNo && `GRN ${c.grnNo}`, c.lastCutAt && `last cut ${dayjs(c.lastCutAt).format('DD MMM YY')}`].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      {(pg.total || 0) > rowsPerPage && (
        <TablePagination
          component="div" count={pg.total || 0} page={page} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Coils per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      )}

      {/* The untraceable figure, spelled out under the table as well as in the
          header chip — a reader scrolling the rows should not have to scroll
          back up to learn that a quarter of a million kilograms is not here. */}
      {(untraceable.scrapKg || 0) > 0 && (
        <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surfaceAlt }}>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
            <b>{kg(untraceable.scrapKg)}</b> of scrap across {num(untraceable.records)} record
            {untraceable.records === 1 ? '' : 's'} is <b>untraceable</b> — it names a batch number but no goods receipt,
            so it cannot be put against a physical coil. It is counted in every other scrap total in this module and is
            shown here so this table is not mistaken for the whole picture. Nothing is attached to a coil by guesswork.
          </Typography>
        </Box>
      )}
    </Panel>
  );
};

export default ScrapByCoilPanel;
