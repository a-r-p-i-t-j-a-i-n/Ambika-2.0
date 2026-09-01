import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Button, IconButton, TextField,
  Tabs, Tab, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  LinearProgress, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  alpha, useTheme, CircularProgress,
} from '@mui/material';
import {
  Factory, ChevronLeft, ChevronRight, RefreshCw, Sparkles, Plus, ArrowRight,
  Settings2, ClipboardList, LayoutGrid, CheckCircle2, TriangleAlert, Clock,
  PackageCheck, Boxes, ListChecks,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import { useReturnToTask } from '../o2d-fms/useReturnToTask';
import {
  useGetPpcBoardQuery, useGeneratePpcPlansMutation, useUpdatePpcPlanMutation,
  useSavePpcDailyEntryMutation, useMovePpcWipMutation,
} from '../../store/api/ppcApi';

const STAGES = [
  { key: 'cutting',   label: 'Cutting' },
  { key: 'drawing',   label: 'Drawing' },
  { key: 'buffing',   label: 'Buffing' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'packing',   label: 'Packing' },
];
const stageLabel = (k) => (k === 'done' ? 'FG Ready' : (STAGES.find((s) => s.key === k)?.label || k));
const nextStage = (k) => {
  const i = STAGES.findIndex((s) => s.key === k);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1].key : 'done';
};

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

const STATUS_META = (theme) => ({
  NOT_PLANNED: { label: 'Not planned', color: theme.palette.text.secondary, bg: alpha(theme.palette.text.primary, 0.06), icon: Clock },
  ON_TRACK:    { label: 'On track',    color: theme.palette.success.dark,   bg: alpha(theme.palette.success.main, 0.12), icon: CheckCircle2 },
  BEHIND:      { label: 'Behind',      color: theme.palette.error.dark,     bg: alpha(theme.palette.error.main, 0.12),   icon: TriangleAlert },
  DONE:        { label: 'Done',        color: theme.palette.primary.dark,   bg: alpha(theme.palette.primary.main, 0.12), icon: PackageCheck },
});

// ── KPI pill ──────────────────────────────────────────────────────────
const Kpi = ({ label, value, hint, color, icon: Icon, theme }) => (
  <Paper sx={{
    flex: '1 1 150px', minWidth: 142, p: 1.3, borderRadius: 2,
    border: `1px solid ${theme.palette.divider}`,
    background: 'linear-gradient(180deg,#ffffff 0%,#f7f9ff 100%)',
  }}>
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{
        width: 26, height: 26, borderRadius: 1.25, flexShrink: 0,
        display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color,
      }}>
        <Icon size={14} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'text.secondary' }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
          {hint && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{hint}</Typography>}
        </Stack>
      </Box>
    </Stack>
  </Paper>
);

const PPCPlanning = () => {
  const theme = useTheme();
  const statusMeta = STATUS_META(theme);
  const [period, setPeriod] = useState(dayjs());
  const [tab, setTab] = useState(0);
  const [entryDate, setEntryDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [entryDraft, setEntryDraft] = useState({});
  const [settingsRow, setSettingsRow] = useState(null);
  const [moveCtx, setMoveCtx] = useState(null);

  // ── FMS step 2.03 (stock check / production feasibility) opens this screen from
  // its task's "Do it now". Carry that context so the doer is never stranded here:
  // they see WHICH order they came for, and one button takes them back to the task,
  // where the checklist auto-ticks and they only Mark done.
  const [searchParams] = useSearchParams();
  const fmsSo = searchParams.get('so') || '';
  const { active: fromFmsTask, finishToTask } = useReturnToTask();

  const year = period.year();
  const month = period.month() + 1;

  const { data, isFetching, refetch } = useGetPpcBoardQuery({ year, month });
  const rows = data?.data?.rows || [];
  const kpis = data?.data?.kpis || {};
  const plannedRows = useMemo(() => rows.filter((r) => r.planId), [rows]);

  const [generate, { isLoading: generating }] = useGeneratePpcPlansMutation();
  const [updatePlan] = useUpdatePpcPlanMutation();
  const [saveDaily, { isLoading: savingDaily }] = useSavePpcDailyEntryMutation();
  const [moveWip, { isLoading: moving }] = useMovePpcWipMutation();

  const handleGenerate = async () => {
    try {
      const res = await generate({ year, month }).unwrap();
      enqueueSnackbar(res?.message || 'Plans generated', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to generate plans', { variant: 'error' });
    }
  };

  const producedForDate = (row, dateStr) => {
    const d = (row.days || []).find((x) => dayjs(x.date).format('YYYY-MM-DD') === dateStr);
    return d ? d.producedQty : 0;
  };
  const targetForDate = (row, dateStr) => {
    const d = (row.days || []).find((x) => dayjs(x.date).format('YYYY-MM-DD') === dateStr);
    return d ? d.targetQty : 0;
  };

  const handleSaveDaily = async () => {
    const entries = plannedRows.map((r) => ({
      planId: r.planId,
      producedQty: Number(
        entryDraft[r.planId] !== undefined ? entryDraft[r.planId] : producedForDate(r, entryDate),
      ) || 0,
    }));
    try {
      await saveDaily({ date: entryDate, entries }).unwrap();
      setEntryDraft({});
      enqueueSnackbar('Daily production saved', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg,#0b2545 0%,#1e3a8a 55%,#1d4ed8 100%)',
        px: { xs: 2.5, md: 3 }, pt: { xs: 2.5, md: 2.75 }, pb: { xs: 4, md: 4.5 },
      }}>
        <Stack direction="row" spacing={1.75} alignItems="center">
          <Box sx={{
            width: 40, height: 40, borderRadius: 2, flexShrink: 0,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)',
          }}>
            <Factory size={20} color="#fff" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, lineHeight: 1.15 }}>
              PPC — Production Control
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.78rem', mt: 0.25 }}>
              What the factory must make, the daily target, and where every batch is on the floor.
            </Typography>
          </Box>

          {/* Month nav */}
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{
            bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 1.5, px: 0.5, py: 0.25,
          }}>
            <IconButton size="small" onClick={() => setPeriod((p) => p.subtract(1, 'month'))} sx={{ color: '#fff' }}>
              <ChevronLeft size={16} />
            </IconButton>
            <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '0.82rem', minWidth: 96, textAlign: 'center' }}>
              {period.format('MMM YYYY')}
            </Typography>
            <IconButton size="small" onClick={() => setPeriod((p) => p.add(1, 'month'))} sx={{ color: '#fff' }}>
              <ChevronRight size={16} />
            </IconButton>
          </Stack>

          <Tooltip title="Refresh">
            <IconButton onClick={refetch} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }}>
              <RefreshCw size={15} />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={13} color="inherit" /> : <Sparkles size={15} />}
            onClick={handleGenerate}
            disabled={generating}
            sx={{
              fontWeight: 700, background: 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.25)', color: '#fff', boxShadow: 'none',
              '&:hover': { background: 'rgba(255,255,255,0.24)' },
            }}
          >
            Generate Plans
          </Button>
        </Stack>
      </Box>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <Box sx={{ mx: { xs: 1.5, md: 2.5 }, mt: { xs: -2.75, md: -3 }, position: 'relative' }}>
        <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
          <Kpi theme={theme} label="To Produce"  value={fmt(kpis.totalToProduce)} icon={Factory}      color={theme.palette.primary.main}  hint={`${kpis.skuCount || 0} SKUs`} />
          <Kpi theme={theme} label="Produced"    value={fmt(kpis.totalProduced)}  icon={CheckCircle2}  color={theme.palette.success.dark} />
          <Kpi theme={theme} label="Balance"     value={fmt(kpis.totalBalance)}   icon={ClipboardList} color={theme.palette.warning.dark} />
          <Kpi theme={theme} label="Behind"      value={fmt(kpis.behindCount)}    icon={TriangleAlert} color={theme.palette.error.dark}   hint="SKUs" />
          <Kpi theme={theme} label="Today"       value={`${fmt(kpis.todayProduced)} / ${fmt(kpis.todayTarget)}`} icon={Clock} color={theme.palette.info.dark} hint="done / target" />
          <Kpi theme={theme} label="In WIP"      value={fmt(kpis.totalWip)}       icon={Boxes}         color={theme.palette.secondary.main} hint="on the floor" />
        </Stack>
      </Box>

      {/* ── Came from an FMS task (step 2.03) ──────────────────── */}
      {(fromFmsTask || fmsSo) && (
        <Paper elevation={0} sx={{
          mx: { xs: 1.5, md: 2.5 }, mt: 2, p: 1.4, borderRadius: 2,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
          bgcolor: alpha(theme.palette.primary.main, 0.06),
        }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
            <ClipboardList size={18} color={theme.palette.primary.dark} style={{ flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: theme.palette.primary.dark }}>
                You&apos;re here for an FMS step{fmsSo ? ` — order ${fmsSo}` : ''}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                Check finished-goods stock and production feasibility, then go back to the task — its
                checklist ticks itself and you only need to Mark done.
              </Typography>
            </Box>
            <Button
              size="small" variant="contained" startIcon={<ListChecks size={14} />}
              onClick={() => finishToTask({ soNumber: fmsSo })}
              sx={{ fontWeight: 800, textTransform: 'none', whiteSpace: 'nowrap', boxShadow: 'none' }}
            >
              Done → back to task
            </Button>
          </Stack>
        </Paper>
      )}

      {/* ── Panel ──────────────────────────────────────────────── */}
      <Paper sx={{ mx: { xs: 1.5, md: 2.5 }, mt: 2, mb: 3, borderRadius: 3, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: `1px solid ${theme.palette.divider}`, px: 1.5,
            '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.84rem', minHeight: 48 } }}
        >
          <Tab icon={<LayoutGrid size={15} />} iconPosition="start" label="Production Board" />
          <Tab icon={<Boxes size={15} />} iconPosition="start" label="Shop-Floor (WIP)" />
          <Tab icon={<ClipboardList size={15} />} iconPosition="start" label="Daily Entry" />
        </Tabs>

        {isFetching && <LinearProgress />}

        {/* Banner: demand exists but not planned */}
        {!isFetching && rows.length > 0 && kpis.unplannedCount > 0 && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{
            px: 2, py: 1.25, bgcolor: alpha(theme.palette.warning.main, 0.08),
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}>
            <TriangleAlert size={16} color={theme.palette.warning.dark} />
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: theme.palette.warning.dark, flex: 1 }}>
              {kpis.unplannedCount} SKU(s) have order demand but no production plan yet.
            </Typography>
            <Button size="small" variant="contained" color="warning" onClick={handleGenerate} disabled={generating}
              sx={{ fontWeight: 700, textTransform: 'none' }}>
              Generate Plans
            </Button>
          </Stack>
        )}

        {/* ── TAB 0: Production Board ─────────────────────────── */}
        {tab === 0 && (
          <TableContainer sx={{ maxHeight: '64vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
                  <TableCell>SKU</TableCell>
                  <TableCell>Group</TableCell>
                  <TableCell align="right">Order Demand</TableCell>
                  <TableCell align="right">To Produce</TableCell>
                  <TableCell align="right">Produced</TableCell>
                  <TableCell align="right">Balance</TableCell>
                  <TableCell align="center">Today</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>Achievement</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Plan</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const meta = statusMeta[r.status] || statusMeta.NOT_PLANNED;
                  const Icon = meta.icon;
                  return (
                    <TableRow key={r.skuId} hover>
                      <TableCell>
                        <Typography sx={{ fontFamily: 'ui-monospace,monospace', fontWeight: 800, fontSize: '0.78rem', color: theme.palette.primary.dark }}>
                          {r.skuCode}
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }} noWrap>{r.skuName}</Typography>
                      </TableCell>
                      <TableCell>
                        {r.category ? (
                          <Chip size="small" label={r.category} sx={{ height: 20, fontSize: '0.66rem', fontWeight: 700 }} />
                        ) : '—'}
                      </TableCell>
                      <TableCell align="right"><Num v={r.openBalance} /></TableCell>
                      <TableCell align="right"><Num v={r.netToProduce} bold /></TableCell>
                      <TableCell align="right"><Num v={r.produced} color={theme.palette.success.dark} /></TableCell>
                      <TableCell align="right"><Num v={r.balance} color={r.balance > 0 ? theme.palette.warning.dark : 'text.disabled'} /></TableCell>
                      <TableCell align="center">
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(r.todayProduced)}<Box component="span" sx={{ color: 'text.disabled', fontWeight: 600 }}> / {fmt(r.todayTarget)}</Box>
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(100, r.achievementPct)}
                            sx={{ flex: 1, height: 7, borderRadius: 4,
                              bgcolor: alpha(theme.palette.text.primary, 0.08),
                              '& .MuiLinearProgress-bar': { bgcolor: meta.color } }}
                          />
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, minWidth: 32, color: meta.color }}>
                            {r.achievementPct}%
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" icon={<Icon size={11} style={{ marginLeft: 6 }} />} label={meta.label}
                          sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', color: meta.color, bgcolor: meta.bg, '& .MuiChip-icon': { color: 'inherit' } }} />
                      </TableCell>
                      <TableCell align="center">
                        {r.planId ? (
                          <Tooltip title="Adjust FG stock, WIP & buffer">
                            <IconButton size="small" onClick={() => setSettingsRow(r)}>
                              <Settings2 size={15} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <Chip size="small" label="No plan" sx={{ height: 20, fontSize: '0.64rem' }} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={10}>
                    <EmptyState icon={Factory} title="No production demand this month"
                      hint="SKUs with pending order quantity will appear here automatically." />
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* ── TAB 1: WIP shop-floor board ─────────────────────── */}
        {tab === 1 && (
          <TableContainer sx={{ maxHeight: '64vh' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
                  <TableCell>SKU</TableCell>
                  <TableCell align="center">Start</TableCell>
                  {STAGES.map((s) => <TableCell key={s.key} align="center">{s.label}</TableCell>)}
                  <TableCell align="center">FG Ready</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {plannedRows.map((r) => (
                  <TableRow key={r.skuId} hover>
                    <TableCell>
                      <Typography sx={{ fontFamily: 'ui-monospace,monospace', fontWeight: 800, fontSize: '0.76rem', color: theme.palette.primary.dark }}>
                        {r.skuCode}
                      </Typography>
                      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>{r.skuName}</Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Start a batch into Cutting">
                        <IconButton size="small" color="primary"
                          onClick={() => setMoveCtx({ row: r, from: 'start', to: 'cutting' })}>
                          <Plus size={15} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                    {STAGES.map((s) => {
                      const qty = r.wip?.[s.key] || 0;
                      return (
                        <TableCell key={s.key} align="center">
                          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center">
                            <Box sx={{
                              minWidth: 42, py: 0.35, borderRadius: 1,
                              bgcolor: qty > 0 ? alpha(theme.palette.primary.main, 0.1) : alpha(theme.palette.text.primary, 0.04),
                              color: qty > 0 ? theme.palette.primary.dark : 'text.disabled',
                              fontWeight: 800, fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums',
                            }}>
                              {fmt(qty)}
                            </Box>
                            {qty > 0 && (
                              <Tooltip title={`Advance to ${stageLabel(nextStage(s.key))}`}>
                                <IconButton size="small"
                                  onClick={() => setMoveCtx({ row: r, from: s.key, to: nextStage(s.key) })}>
                                  <ArrowRight size={13} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                      );
                    })}
                    <TableCell align="center">
                      <Chip size="small" icon={<PackageCheck size={12} style={{ marginLeft: 6 }} />} label={fmt(r.produced)}
                        sx={{ height: 24, fontWeight: 800, fontSize: '0.74rem',
                          color: theme.palette.success.dark, bgcolor: alpha(theme.palette.success.main, 0.12),
                          '& .MuiChip-icon': { color: 'inherit' } }} />
                    </TableCell>
                  </TableRow>
                ))}
                {!isFetching && plannedRows.length === 0 && (
                  <TableRow><TableCell colSpan={8}>
                    <EmptyState icon={Boxes} title="No production plans yet"
                      hint='Click "Generate Plans" to create plans, then track each batch through the stages here.' />
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* ── TAB 2: Daily production entry ───────────────────── */}
        {tab === 2 && (
          <Box>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <TextField
                type="date" size="small" label="Production date"
                value={entryDate}
                onChange={(e) => { setEntryDate(e.target.value); setEntryDraft({}); }}
                InputLabelProps={{ shrink: true }}
              />
              <Box sx={{ flex: 1 }} />
              <Button variant="contained" onClick={handleSaveDaily}
                disabled={savingDaily || plannedRows.length === 0}
                startIcon={savingDaily ? <CircularProgress size={13} color="inherit" /> : <CheckCircle2 size={15} />}
                sx={{ fontWeight: 700, textTransform: 'none' }}>
                Save Day
              </Button>
            </Stack>
            <TableContainer sx={{ maxHeight: '58vh' }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Target this day</TableCell>
                    <TableCell align="right">Produced this day</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plannedRows.map((r) => {
                    const draftVal = entryDraft[r.planId];
                    const value = draftVal !== undefined ? draftVal : producedForDate(r, entryDate);
                    const target = targetForDate(r, entryDate);
                    return (
                      <TableRow key={r.skuId} hover>
                        <TableCell>
                          <Typography sx={{ fontFamily: 'ui-monospace,monospace', fontWeight: 800, fontSize: '0.76rem', color: theme.palette.primary.dark }}>
                            {r.skuCode}
                          </Typography>
                          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>{r.skuName}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'text.secondary' }}>{fmt(target)}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number" size="small" value={value}
                            onChange={(e) => setEntryDraft((d) => ({ ...d, [r.planId]: e.target.value }))}
                            sx={{ width: 110 }}
                            inputProps={{ min: 0, style: { textAlign: 'right', fontWeight: 700 } }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isFetching && plannedRows.length === 0 && (
                    <TableRow><TableCell colSpan={3}>
                      <EmptyState icon={ClipboardList} title="No production plans yet"
                        hint='Generate plans first, then log the floor output here each day.' />
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Paper>

      {/* ── Plan settings dialog ───────────────────────────────── */}
      <PlanSettingsDialog
        row={settingsRow}
        onClose={() => setSettingsRow(null)}
        onSave={async (patch) => {
          try {
            await updatePlan({ id: settingsRow.planId, ...patch }).unwrap();
            enqueueSnackbar('Plan updated', { variant: 'success' });
            setSettingsRow(null);
          } catch (err) {
            enqueueSnackbar(err?.data?.message || 'Failed to update', { variant: 'error' });
          }
        }}
      />

      {/* ── WIP move dialog ────────────────────────────────────── */}
      <MoveDialog
        ctx={moveCtx}
        busy={moving}
        onClose={() => setMoveCtx(null)}
        onConfirm={async (qty) => {
          try {
            await moveWip({ planId: moveCtx.row.planId, from: moveCtx.from, to: moveCtx.to, qty }).unwrap();
            enqueueSnackbar('Stage updated', { variant: 'success' });
            setMoveCtx(null);
          } catch (err) {
            enqueueSnackbar(err?.data?.message || 'Failed to move', { variant: 'error' });
          }
        }}
      />
    </Box>
  );
};

// ── Small cells & states ─────────────────────────────────────────────
const Num = ({ v, bold, color }) => (
  <Typography sx={{
    fontSize: '0.82rem', fontWeight: bold ? 800 : 600,
    color: color || 'text.primary', fontVariantNumeric: 'tabular-nums',
  }}>
    {v == null ? '—' : Number(v).toLocaleString('en-IN')}
  </Typography>
);

const EmptyState = ({ icon: Icon, title, hint }) => (
  <Stack alignItems="center" sx={{ py: 6, color: 'text.disabled', gap: 0.5 }}>
    <Icon size={34} style={{ opacity: 0.4 }} />
    <Typography sx={{ fontWeight: 800, fontSize: '0.92rem' }}>{title}</Typography>
    <Typography sx={{ fontSize: '0.8rem', textAlign: 'center', maxWidth: 420 }}>{hint}</Typography>
  </Stack>
);

// ── Plan settings dialog ─────────────────────────────────────────────
const PlanSettingsDialog = ({ row, onClose, onSave }) => {
  const [fgStock, setFgStock] = useState(0);
  const [openingWip, setOpeningWip] = useState(0);
  const [bufferPct, setBufferPct] = useState(3);

  React.useEffect(() => {
    if (row) {
      setFgStock(row.fgStock || 0);
      setOpeningWip(row.openingWip || 0);
      setBufferPct(row.bufferPct ?? 3);
    }
  }, [row]);

  if (!row) return null;
  const base = Math.max(0, (row.openBalance || 0) - Number(fgStock || 0) - Number(openingWip || 0));
  const preview = Math.ceil(base * (1 + (Number(bufferPct) || 0) / 100));

  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem' }}>
        Plan settings — {row.skuName}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 2 }}>
          Open order demand: <strong>{fmt(row.openBalance)}</strong> pcs. Production target is
          demand minus stock & WIP, plus a safety buffer.
        </Typography>
        <Stack spacing={2}>
          <TextField label="FG stock (ready jars)" type="number" size="small" fullWidth
            value={fgStock} onChange={(e) => setFgStock(e.target.value)} inputProps={{ min: 0 }} />
          <TextField label="Opening WIP (already in pipeline)" type="number" size="small" fullWidth
            value={openingWip} onChange={(e) => setOpeningWip(e.target.value)} inputProps={{ min: 0 }} />
          <TextField label="Safety buffer %" type="number" size="small" fullWidth
            value={bufferPct} onChange={(e) => setBufferPct(e.target.value)} inputProps={{ min: 0, max: 50 }} />
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.07) }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary' }}>
              New production target
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', color: 'primary.dark' }}>
              {fmt(preview)} pcs
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 700 }}>Cancel</Button>
        <Button variant="contained" sx={{ fontWeight: 700 }}
          onClick={() => onSave({
            fgStock: Number(fgStock) || 0,
            openingWip: Number(openingWip) || 0,
            bufferPct: Number(bufferPct) || 0,
          })}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ── WIP move dialog ──────────────────────────────────────────────────
const MoveDialog = ({ ctx, busy, onClose, onConfirm }) => {
  const [qty, setQty] = useState('');

  React.useEffect(() => {
    if (ctx) {
      const cur = ctx.from === 'start' ? '' : String(ctx.row.wip?.[ctx.from] || '');
      setQty(cur);
    }
  }, [ctx]);

  if (!ctx) return null;
  const max = ctx.from === 'start' ? null : (ctx.row.wip?.[ctx.from] || 0);
  const title = ctx.from === 'start'
    ? `Start a batch — ${ctx.row.skuName}`
    : `Advance — ${ctx.row.skuName}`;

  return (
    <Dialog open={!!ctx} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem' }}>{title}</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Chip label={stageLabel(ctx.from)} size="small" sx={{ fontWeight: 700 }} />
          <ArrowRight size={16} />
          <Chip label={stageLabel(ctx.to)} size="small" color="primary" sx={{ fontWeight: 700 }} />
        </Stack>
        <TextField
          autoFocus type="number" size="small" fullWidth label="Quantity (pcs)"
          value={qty} onChange={(e) => setQty(e.target.value)}
          inputProps={{ min: 1, ...(max != null ? { max } : {}) }}
          helperText={max != null ? `Available at ${stageLabel(ctx.from)}: ${fmt(max)}` : 'Pieces entering production'}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 700 }}>Cancel</Button>
        <Button variant="contained" disabled={busy || !(Number(qty) > 0)} sx={{ fontWeight: 700 }}
          onClick={() => onConfirm(Number(qty))}>
          {ctx.to === 'done' ? 'Mark Produced' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PPCPlanning;
