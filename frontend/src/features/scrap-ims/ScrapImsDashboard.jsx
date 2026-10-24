import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell, Button, Tooltip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  Recycle, Factory, Truck, Scissors, AlertTriangle, ArrowRight, TrendingUp, ClipboardCheck, Warehouse,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts';
import dayjs from 'dayjs';
import {
  ScrapShell, SCRAP_ACCENT, Panel, TableScroll, KpiTile, EmptyNote, Th,
  LocationChip, DispositionChip, YieldChip, kg,
  yieldBand, YIELD_GOOD_PCT, YIELD_HIGH_PCT,
  O2D, num, imsTableSx,
} from './scrapImsMeta';
import ScrapByCoilPanel from './ScrapByCoilPanel';
import { useGetScrapDashboardQuery, useGetScrapStockQuery } from '../../store/api/scrapImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.scrap;

const ScrapImsDashboard = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useGetScrapDashboardQuery({});
  // The balance, which is a different number from the production total above it
  // — see the note at the top of the page.
  const { data: stockRes } = useGetScrapStockQuery();
  const stock = stockRes?.data;
  const d = data?.data;
  const s = d?.summary;

  const monthly = useMemo(
    () => (d?.monthly || []).slice(-18).map((m) => ({ ...m, label: dayjs(`${m.month}-01`).format('MMM YY') })),
    [d],
  );

  if (isLoading || !d) {
    return (
      <ScrapShell icon={Recycle} title="Scrap" subtitle="Loading the scrap position…">
        <Skeleton variant="rounded" height={340} />
      </ScrapShell>
    );
  }

  const plant = s.byLocation.PLG01;
  const jobWork = s.byLocation.JW001;

  return (
    <ScrapShell
      icon={Recycle}
      title="Scrap"
      subtitle="What each coil cut left behind — how much, where, and whether it was checked."
      actions={(
        <Button size="small" variant="outlined" endIcon={<ArrowRight size={14} />} onClick={() => navigate('/scrap-ims/records')}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Scrap master data
        </Button>
      )}
    >
      {/* The one thing a reader must understand before reading any number. */}
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: SCRAP_ACCENT, display: 'flex', pt: 0.15 }}><Recycle size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            These figures are the <b>production record</b> — how much every cut left behind, and at what yield.
            They are <b>not the scrap balance</b>: only <b>in-house</b> cutting leaves scrap Ambika physically
            holds, so only in-house scrap goes into stock. Job-work offcuts stay with the job worker and are
            counted here for yield alone. For how much scrap is actually in the yard, see the{' '}
            <Box component="span" onClick={() => navigate('/scrap-ims/movements')}
              sx={{ color: SCRAP_ACCENT, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              scrap movement
            </Box>.
          </Typography>
        </Stack>
      </Paper>

      {/* ── KPIs. Every one of these counts CUT batches only. ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Scrap generated" value={kg(s.scrapKg)} sub={`Across ${num(s.batchesCut)} cuts`}
          color={SCRAP_ACCENT} icon={Recycle} />
        {/* The balance, not the production total. Deliberately next to it, so
            nobody has to wonder why the two differ. */}
        <KpiTile label="Scrap in stock" value={kg(stock?.totalKg || 0)} sub="On hand now · in-house + manual"
          color="#0f766e" icon={Warehouse} onClick={() => navigate('/scrap-ims/movements')} />
        <KpiTile label="In-house (PLG01)" value={kg(s.inHouseScrapKg)} sub={`${num(plant.batches)} cuts · physically held`}
          color="#0f766e" icon={Factory} onClick={() => navigate('/scrap-ims/records?location=PLG01')} />
        <KpiTile label="Job work (JW001)" value={kg(s.jobWorkScrapKg)} sub={`${num(jobWork.batches)} cuts · not held`}
          color="#7c3aed" icon={Truck} onClick={() => navigate('/scrap-ims/records?location=JW001')} />
        <KpiTile label="Coil cut" value={kg(s.coilKg)} sub="Weight into the machine" color={O2D.brand} icon={Scissors} />
        <KpiTile label="Average yield" value={`${num(s.avgYield)}%`} sub={`Per cut · ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% is normal`}
          color={yieldBand(s.avgYield)?.color || "#15803d"} icon={TrendingUp} />
        {s.uncutBatches > 0 && (
          <KpiTile label="Coils not cut" value={num(s.uncutBatches)} sub="Flagged — not counted as scrap"
            color="#b45309" icon={AlertTriangle} onClick={() => navigate('/scrap-ims/history?batchStatus=UNCUT')} />
        )}
      </Stack>

      {/* ── Where it came from ── */}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} sx={{ alignItems: 'stretch' }}>
        <Panel title="Where the cutting happened" hint="In-house scrap is stock Ambika has. Job-work scrap never came back."
          sx={{ flex: 1 }}>
          <Stack spacing={1}>
            {['PLG01', 'JW001'].map((loc) => {
              const row = s.byLocation[loc];
              const share = s.scrapKg > 0 ? Math.round((row.scrapKg / s.scrapKg) * 100) : 0;
              return (
                <Box key={loc} sx={{ p: 1.1, borderRadius: '8px', border: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.6 }}>
                    <LocationChip location={loc} />
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink, ml: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                      {kg(row.scrapKg)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, minWidth: 34, textAlign: 'right' }}>{share}%</Typography>
                  </Stack>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: O2D.lineSoft, overflow: 'hidden' }}>
                    <Box sx={{ width: `${share}%`, height: '100%', bgcolor: loc === 'PLG01' ? '#0f766e' : '#7c3aed' }} />
                  </Box>
                  <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.5 }}>
                    {num(row.batches)} cuts · average yield {num(row.avgYield)}%
                    {row.isPhysicalScrap ? ' · held by Ambika' : ' · stayed with the job worker'}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Panel>

        <Panel title="How it was checked" hint="Only verified scrap leaves coil stock — that rule lives in Raw Material."
          sx={{ flex: 1 }}>
          {d.byDisposition.length === 0 ? (
            <EmptyNote icon={ClipboardCheck} title="Nothing recorded yet" hint="Scrap appears here as coils are cut." />
          ) : (
            <Stack spacing={0.75}>
              {d.byDisposition.map((x) => (
                <Stack key={`${x.disposition}-${x.location}`} direction="row" spacing={1} alignItems="center"
                  sx={{ p: 0.9, borderRadius: '7px', border: `1px solid ${O2D.lineSoft}` }}>
                  <DispositionChip disposition={x.disposition} />
                  <LocationChip location={x.location} withHint={false} />
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, ml: 'auto' }}>{num(x.count)} cuts</Typography>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, fontVariantNumeric: 'tabular-nums', minWidth: 96, textAlign: 'right' }}>
                    {kg(x.scrapKg)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Panel>
      </Stack>

      {/* ── Trend ── */}
      <Panel title="Scrap over time" hint="Kilograms of scrap per month, from cuts only.">
        {monthly.length === 0 ? (
          <EmptyNote icon={TrendingUp} title="No history yet" hint="Monthly scrap appears once coils have been cut." />
        ) : (
          <Box sx={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: O2D.sub }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: O2D.sub }} tickLine={false} axisLine={false} width={64} />
                <RTooltip
                  formatter={(v, n) => (n === 'scrapKg' ? [`${num(v)} kg`, 'Scrap'] : [v, n])}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${O2D.line}` }}
                />
                <Bar dataKey="scrapKg" fill={SCRAP_ACCENT} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Panel>

      {/* ── By PHYSICAL coil — "how much scrap came off THAT coil?" ──
          New, and deliberately placed above the by-grade table: it is the
          question the client actually asks on the floor. The grade table below
          is untouched and keeps its own meaning. */}
      <ScrapByCoilPanel />

      {/* ── By coil GRADE ──
          Unchanged. Groups on the SKU code, which is the MATERIAL, and stays
          comparable with the client's Summary Scrap sheet. The title now says
          "grade" out loud, because two scrap tables whose totals do not match
          each other have to say why on their face — this one counts every cut
          of a material, including the historical ones that name no coil. */}
      <Panel title="Scrap by coil grade (SKU)"
        hint="Which GRADE of metal loses the most, and how well it cuts — every cut on record, including those that name no physical coil. For one particular coil, see the table above.">
        <TableScroll>
          <Table size="small" sx={imsTableSx(820)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell>Coil grade</TableCell>
                <TableCell align="right"><Th label="Coil cut" hint={H.coilCut} /></TableCell>
                <TableCell align="right"><Th label="Scrap" hint={H.scrapKg} /></TableCell>
                <TableCell align="right"><Th label="Scrap %" hint={H.scrapPct} /></TableCell>
                <TableCell align="right"><Th label="Average yield" hint={H.avgYield} /></TableCell>
                <TableCell align="right">Cuts</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.byCoil.length === 0 && (
                <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyNote icon={Scissors} title="No cuts recorded" hint="Cut a coil in Raw Material and it will appear here." />
                </TableCell></TableRow>
              )}
              {d.byCoil.map((c, i) => (
                <TableRow key={c.coilSkuCode} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }}>{c.coilSkuName}</Typography>
                    <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{c.coilSkuCode}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{kg(c.coilKg)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: O2D.ink }}>{kg(c.scrapKg)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                    {c.coilKg > 0 ? `${Math.round((c.scrapKg / c.coilKg) * 100)}%` : '—'}
                  </TableCell>
                  <TableCell align="right"><YieldChip pct={c.avgYield} /></TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{num(c.batches)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>

      {/* ── The uncut coils. Few, but each one is a real question. ── */}
      {d.uncut.length > 0 && (
        <Panel
          title={`${num(d.uncut.length)} coils recorded with no cut`}
          hint="These coils were never cut, so no scrap came off them. The client's sheet reports the whole coil as scrap because its circle weight is blank — they are excluded from every figure above."
          icon={AlertTriangle}
        >
          <TableScroll>
            <Table size="small" sx={imsTableSx(760)}>
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                  <TableCell><Th label="Where" hint={H.location} /></TableCell>
                  <TableCell>Coil</TableCell>
                  <TableCell align="right"><Th label="Coil weight" hint={H.coilWeight} /></TableCell>
                  <TableCell><Th label="Checked?" hint={H.scrapVerified} /></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.uncut.map((u, i) => (
                  <TableRow key={u._id} hover sx={{ bgcolor: '#fffbeb' }}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{u.batchNo}</TableCell>
                    <TableCell sx={{ fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{u.scrapDate ? dayjs(u.scrapDate).format('DD MMM YYYY') : '—'}</TableCell>
                    <TableCell><LocationChip location={u.location} /></TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{u.coilSkuName}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{kg(u.coilWeightKg)}</TableCell>
                    <TableCell><DispositionChip disposition={u.disposition} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {/* ── Recent ── */}
      <Panel title="Latest cuts" hint="The most recent coils cut, newest first."
        actions={(
          <Button size="small" onClick={() => navigate('/scrap-ims/history')}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: SCRAP_ACCENT }}>
            Full cut history
          </Button>
        )}
      >
        <TableScroll>
          <Table size="small" sx={imsTableSx(940)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Coil</TableCell>
                <TableCell><Th label="Where" hint={H.location} /></TableCell>
                <TableCell align="right">Coil in</TableCell>
                <TableCell align="right">Circles out</TableCell>
                <TableCell align="right">Scrap</TableCell>
                <TableCell align="right">Yield</TableCell>
                <TableCell><Th label="Checked?" hint={H.scrapVerified} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.recent.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={Recycle} title="No cuts recorded yet" hint="Record a coil cut in Raw Material and it will appear here." />
                </TableCell></TableRow>
              )}
              {d.recent.map((r, i) => (
                <TableRow key={r._id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/scrap-ims/record/${r._id}`)}>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                  <TableCell sx={{ fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{r.scrapDate ? dayjs(r.scrapDate).format('DD MMM YYYY') : '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{r.batchNo}</TableCell>
                  <TableCell sx={{ maxWidth: 190 }}>
                    <Typography noWrap sx={{ fontSize: '0.76rem', color: O2D.ink }}>{r.coilSkuName}</Typography>
                  </TableCell>
                  <TableCell><LocationChip location={r.location} withHint={false} /></TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{kg(r.coilWeightKg)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{kg(r.circlesWeightKg)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: SCRAP_ACCENT }}>{kg(r.scrapKg)}</TableCell>
                  <TableCell align="right"><YieldChip pct={r.yieldRatioPct} disposition={r.disposition} /></TableCell>
                  <TableCell><DispositionChip disposition={r.disposition} withHint={false} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsDashboard;
