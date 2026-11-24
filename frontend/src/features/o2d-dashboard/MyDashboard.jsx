/**
 * O2D Dashboard — my view (every doer; MD / full-view people can switch to it).
 *
 * The same layout as the company view, but only this person's own O2D tasks —
 * the rows of their My FMS Tasks (open ones plus those done in the last 30
 * days). No company-wide order counts or quantities. Tasks where they are only
 * the buddy are left out: the KPIs are about their own work.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { AlarmClock, CircleCheck, Clock, Hourglass, Layers, Timer } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetO2dFmsTasksQuery } from '../../store/api/o2dFmsApi';
import {
  clock, durLabel, EMPTY_TASK_FILTER, filterTasks, monthTasks, MY_STEP_MODES, myInsights, myKpis, myStepBars,
  pctOf, startOfDay, taskState, upcomingTasks,
} from './dashboardModel';
import { CHIP_TONE, GROUP_COLOR, SKU_COLORS, STAT_BG, T, WIDE } from './dashTheme';
import { fmtDateShort, fmtDateTime } from './format';
import {
  Bars, DashCard, DashHeader, DashPage, Donut, FilterBar, GhostButton, Insights, KpiTile, MiniSelect,
  OverviewItem, SplitRow, StatBox, ToneChip,
} from './components/DashUi';
import { CalendarGrid, CalendarNav } from './components/MonthCalendar';
import DashTable from './components/DashTable';
import { DayTasksDrawer } from './components/Drawers';

const STATE_CHIP = {
  OVERDUE: ['danger', 'Delayed'],
  DUE_TODAY: ['warn', 'Due today'],
  OPEN: ['info', 'Open'],
  DONE: ['ok', 'Done on time'],
  DONE_LATE: ['warn', 'Done late'],
};
const STATE_RANK = { OVERDUE: 0, DUE_TODAY: 1, OPEN: 2, DONE_LATE: 3, DONE: 4 };
const STATUS_VIA = { OPEN: 'Open tasks', ON_TRACK: 'On track', OVERDUE: 'Delayed', DUE_TODAY: 'Due today', DONE: 'Done · 30 days', DONE_LATE: 'Done late' };
const SHOW = { open: 'OPEN', dueToday: 'DUE_TODAY', delayed: 'OVERDUE', done: 'DONE', late: 'DONE_LATE' };
const STATUS_OPTIONS = [
  { value: '', label: 'All tasks' },
  { value: 'OPEN', label: 'Open' },
  { value: 'OVERDUE', label: 'Delayed' },
  { value: 'DUE_TODAY', label: 'Due today' },
  { value: 'DONE', label: 'Done · 30 days' },
  { value: 'DONE_LATE', label: 'Done late' },
];
const DONUT_HIGHLIGHT = { OVERDUE: ['OVERDUE'], ON_TRACK: ['ON_TRACK'], DUE_TODAY: ['ON_TRACK'], OPEN: ['OVERDUE', 'ON_TRACK'], DONE: ['DONE'], DONE_LATE: ['DONE'] };
const SPLIT_COLOR = { OVERDUE: GROUP_COLOR.OVERDUE, ON_TRACK: GROUP_COLOR.OPEN, DONE: GROUP_COLOR.COMPLETED };
const CAL_TONE = { OVERDUE: CHIP_TONE.danger, DUE_TODAY: CHIP_TONE.warn, OPEN: CHIP_TONE.info, DONE: CHIP_TONE.ok, DONE_LATE: CHIP_TONE.ok };
const STEP_EMPTY = { open: 'You have no open tasks in this view.', overdue: 'Nothing late in this view.', done: 'Nothing done in the last 30 days in this view.' };

const Code = ({ children }) => (
  <Box component="code" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, color: T.text, mr: 0.75 }}>{children}</Box>
);

const MyDashboard = ({ switcher }) => {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useGetO2dFmsTasksQuery('mine', {
    pollingInterval: 60000, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: 30,
  });
  const tasks = useMemo(() => (data?.data || []).filter((t) => !t.asBuddy), [data]);
  const now = useMemo(() => (data ? clock() : 0), [data]);

  // Opened from a tile on the Delegation Suite's Dashboard (?show=…): start on that tile's view.
  const [searchParams] = useSearchParams();
  const shown = SHOW[searchParams.get('show')];
  const [f, setF] = useState(() => ({ ...EMPTY_TASK_FILTER, status: shown || '' }));
  const [via, setVia] = useState(() => (shown ? STATUS_VIA[shown] : 'All tasks'));
  const [mode, setMode] = useState('open');
  const [month, setMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [dayOpen, setDayOpen] = useState(null);
  const tableRef = useRef(null);

  const kpis = useMemo(() => myKpis(tasks, now), [tasks, now]);
  const view = useMemo(() => filterTasks(tasks, f, now), [tasks, f, now]);
  const viewAnyStep = useMemo(() => filterTasks(tasks, { ...f, step: '' }, now), [tasks, f, now]);
  const bars = useMemo(() => myStepBars(viewAnyStep, mode, now), [viewAnyStep, mode, now]);
  const insights = useMemo(() => myInsights(tasks, now), [tasks, now]);
  const upcoming = useMemo(() => upcomingTasks(view, now), [view, now]);
  const byDay = useMemo(() => monthTasks(tasks, month.year, month.month), [tasks, month]);
  const split = useMemo(() => {
    const st = view.map((t) => taskState(t, now));
    const n = (...list) => st.filter((s) => list.includes(s)).length;
    return { total: st.length, overdue: n('OVERDUE'), onTrack: n('OPEN', 'DUE_TODAY'), done: n('DONE', 'DONE_LATE') };
  }, [view, now]);
  const stepOptions = useMemo(() => {
    const seen = new Map();
    tasks.forEach((t) => { if (!seen.has(t.stepCode)) seen.set(t.stepCode, t.stepName); });
    return [{ value: '', label: 'All steps' }, ...[...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([code, name]) => ({ value: code, label: `${code} ${name || ''}`.trim() }))];
  }, [tasks]);

  const scrollToList = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const reset = () => { setF(EMPTY_TASK_FILTER); setVia('All tasks'); };
  const toggleStatus = (s) => {
    const on = f.status === s;
    setF({ ...f, status: on ? '' : s });
    setVia(on ? 'All tasks' : STATUS_VIA[s]);
    scrollToList();
  };
  const toggleStep = (code) => {
    const on = f.step === code;
    setF({ ...f, step: on ? '' : code });
    setVia(on ? 'All tasks' : `Step ${code}`);
    scrollToList();
  };
  const pickDay = (ts) => {
    const on = f.day === ts;
    setF({ ...f, day: on ? null : ts });
    setVia(on ? 'All tasks' : fmtDateShort(ts));
    if (!on) setDayOpen(ts);
    scrollToList();
  };
  const openTask = (t) => { if (t.stepPath) navigate(t.stepPath); };
  const chipOf = (t) => { const [tone, text] = STATE_CHIP[taskState(t, now)]; return <ToneChip tone={tone}>{text}</ToneChip>; };

  const header = (
    <DashHeader title="O2D" subtitle="Order to Dispatch · my tasks">
      {switcher}
      <GhostButton onClick={reset}>Show all tasks</GhostButton>
    </DashHeader>
  );

  if (isLoading || (!data && !isError)) {
    return <DashPage>{header}<Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}><CircularProgress /></Box></DashPage>;
  }
  if (isError) {
    return (
      <DashPage>
        {header}
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Try again</Button>}>
          Your O2D tasks could not be loaded right now.
        </Alert>
      </DashPage>
    );
  }

  const delay = (t) => {
    const st = taskState(t, now);
    const planned = t.plannedAt ? new Date(t.plannedAt).getTime() : null;
    if (st === 'OVERDUE') return now - planned;
    if (st === 'DONE_LATE') return new Date(t.doneAt).getTime() - planned;
    return 0;
  };
  const columns = [
    { key: 'sno', label: 'S.No.', width: 64, render: (_t, i) => <Typography sx={{ fontSize: 13, color: T.muted }}>{i + 1}</Typography>, csv: () => '' },
    {
      key: 'order', label: 'Order', sortValue: (t) => t.soNumber || '',
      render: (t) => (
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>{t.soNumber || 'Intake'}</Typography>
          <Typography sx={{ fontSize: 12, color: T.text2 }}>{t.partyName || '—'}</Typography>
        </Box>
      ),
      csv: (t) => t.soNumber || 'Intake',
    },
    { key: 'party', label: 'Party', hidden: true, csv: (t) => t.partyName || '' },
    {
      key: 'step', label: 'Step', sortValue: (t) => t.stepCode,
      render: (t) => (
        <Box>
          <Box sx={{ whiteSpace: 'nowrap' }}><Code>{t.stepCode}</Code>{t.stepName}</Box>
          {t.dcNumber && <Typography sx={{ fontSize: 11.5, color: T.muted }}>{t.dcNumber}</Typography>}
        </Box>
      ),
      csv: (t) => `${t.stepCode} ${t.stepName || ''}${t.dcNumber ? ` (${t.dcNumber})` : ''}`,
    },
    { key: 'planned', label: 'Planned', sortValue: (t) => (t.plannedAt ? new Date(t.plannedAt).getTime() : null), render: (t) => fmtDateTime(t.plannedAt), csv: (t) => fmtDateTime(t.plannedAt) },
    { key: 'done', label: 'Done', sortValue: (t) => (t.doneAt ? new Date(t.doneAt).getTime() : null), render: (t) => fmtDateTime(t.doneAt), csv: (t) => (t.doneAt ? fmtDateTime(t.doneAt) : '') },
    {
      key: 'delay', label: 'Delay', align: 'right', sortValue: (t) => delay(t),
      render: (t) => { const d = delay(t); return d > 0 ? <Typography sx={{ fontSize: 13, color: '#c02626', fontWeight: 600 }}>{durLabel(d / 60000)}</Typography> : '—'; },
      csv: (t) => (delay(t) > 0 ? durLabel(delay(t) / 60000) : ''),
    },
    // Delayed, due today, open, then done — each by planned time.
    {
      key: 'status', label: 'Status', render: chipOf, csv: (t) => STATE_CHIP[taskState(t, now)][1],
      sortValue: (t) => STATE_RANK[taskState(t, now)] * 1e13 + (t.plannedAt ? new Date(t.plannedAt).getTime() : 9e12),
    },
  ];

  const delayRows = [
    { k: 'OVERDUE', title: `${split.overdue} delayed`, sub: 'past planned time', n: split.overdue },
    { k: 'ON_TRACK', title: `${split.onTrack} on track`, sub: 'open, within planned time', n: split.onTrack },
    { k: 'DONE', title: `${split.done} done`, sub: 'in the last 30 days', n: split.done },
  ];
  const openCount = split.overdue + split.onTrack;

  return (
    <DashPage>
      {header}

      {/* ── My KPI tiles ── */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))' }, [WIDE]: { gridTemplateColumns: 'repeat(6, minmax(0,1fr))' } }}>
        <KpiTile tone="blue" icon={Layers} value={kpis.open} label="My open tasks" active={f.status === 'OPEN'} onClick={() => toggleStatus('OPEN')} />
        <KpiTile tone="amber" icon={Hourglass} value={kpis.dueToday} label="Due today" active={f.status === 'DUE_TODAY'} onClick={() => toggleStatus('DUE_TODAY')} />
        <KpiTile tone="red" icon={AlarmClock} value={kpis.overdue} label="Delayed" active={f.status === 'OVERDUE'} onClick={() => toggleStatus('OVERDUE')} />
        <KpiTile tone="fuchsia" icon={CircleCheck} value={kpis.done} label="Done · last 30 days" active={f.status === 'DONE'} onClick={() => toggleStatus('DONE')} />
        <KpiTile tone="green" icon={Timer} value={kpis.onTimePct == null ? '—' : `${kpis.onTimePct}%`} label="Done on time" />
        <KpiTile tone="orange" icon={Clock} value={kpis.late} label="Done late" active={f.status === 'DONE_LATE'} onClick={() => toggleStatus('DONE_LATE')} />
      </Box>

      {/* ── Delay analytics | My tasks by step ── */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: '1fr', [WIDE]: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)' } }}>
        <DashCard title="Delay analytics">
          {(big) => (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, justifyContent: 'space-between' }}>
              <Box sx={{ display: 'grid', gap: 1, alignItems: 'center', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1.05fr) minmax(0,1fr)' } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {delayRows.map((d) => (
                    <SplitRow
                      key={d.k}
                      big={big}
                      color={SPLIT_COLOR[d.k]}
                      title={d.title}
                      sub={d.sub}
                      share={`${pctOf(d.n, split.total)}% of your tasks`}
                      active={f.status === d.k}
                      onClick={() => toggleStatus(d.k)}
                    />
                  ))}
                </Box>
                <Donut
                  size={big ? 300 : 190}
                  centerLabel="Delayed"
                  centerValue={`${pctOf(split.overdue, openCount)}%`}
                  highlight={DONUT_HIGHLIGHT[f.status]}
                  onSegment={toggleStatus}
                  segments={[
                    { key: 'ON_TRACK', label: 'On track', color: SPLIT_COLOR.ON_TRACK, value: split.onTrack },
                    { key: 'OVERDUE', label: 'Delayed', color: SPLIT_COLOR.OVERDUE, value: split.overdue },
                    { key: 'DONE', label: 'Done', color: SPLIT_COLOR.DONE, value: split.done },
                  ]}
                />
              </Box>
              <Insights lines={insights} big={big} />
            </Box>
          )}
        </DashCard>

        <DashCard
          title="My tasks by step"
          actions={<MiniSelect label="Show" value={mode} onChange={setMode} options={MY_STEP_MODES} sx={{ ml: 'auto' }} />}
        >
          {(big) => (
            <Bars
              bars={bars}
              colors={SKU_COLORS}
              height={big ? '46vh' : 330}
              selected={f.step}
              onSelect={toggleStep}
              emptyText={STEP_EMPTY[mode]}
            />
          )}
        </DashCard>
      </Box>

      {/* ── Quick Overview | My calendar ── */}
      {/* The calendar sets the row's height; Quick Overview matches it and scrolls. */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: '1fr', [WIDE]: { gridTemplateColumns: '1fr 1fr' } }}>
        <DashCard title="Quick Overview" sx={{ [WIDE]: { contain: 'size' } }}>
          {(big) => (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, flex: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0,1fr))' }, gap: 0.75 }}>
                <StatBox big={big} label="Open" value={kpis.open} bg={STAT_BG.blue} active={f.status === 'OPEN'} onClick={() => toggleStatus('OPEN')} />
                <StatBox big={big} label="Done" value={kpis.done} bg={STAT_BG.green} active={f.status === 'DONE'} onClick={() => toggleStatus('DONE')} />
                <StatBox big={big} label="Delayed" value={kpis.overdue} bg={STAT_BG.pink} active={f.status === 'OVERDUE'} onClick={() => toggleStatus('OVERDUE')} />
                <StatBox big={big} label="Due today" value={kpis.dueToday} bg={STAT_BG.amber} active={f.status === 'DUE_TODAY'} onClick={() => toggleStatus('DUE_TODAY')} />
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25, ...(big ? {} : { maxHeight: 320, [WIDE]: { maxHeight: 'none' } }) }}>
                {upcoming.length ? upcoming.map((t) => (
                  <OverviewItem
                    key={t.key}
                    big={big}
                    date={t.plannedAt ? fmtDateShort(t.plannedAt) : '—'}
                    person={t.partyName}
                    title={t.partyName || t.soNumber || '—'}
                    sub={`${t.stepCode} ${t.stepName}${t.soNumber ? ` · ${t.soNumber}` : ''}${t.dcNumber ? ` · ${t.dcNumber}` : ''}`}
                    overdue={taskState(t, now) === 'OVERDUE'}
                    onClick={() => openTask(t)}
                  />
                )) : <Typography sx={{ fontSize: 12.5, color: T.muted, p: 1 }}>No open tasks in this view.</Typography>}
              </Box>
            </Box>
          )}
        </DashCard>

        <DashCard title="My calendar" sx={{ [WIDE]: { minHeight: 486 } }} actions={<CalendarNav value={month} onChange={setMonth} />}>
          {(big) => (
            <Box>
              <CalendarGrid
                big={big}
                value={month}
                selectedDay={f.day}
                onDay={pickDay}
                eventsOf={(ts) => (byDay.get(ts) || []).map((t) => {
                  const tone = CAL_TONE[taskState(t, now)];
                  return { key: t.key, label: `${t.partyName || t.soNumber || '—'} · ${t.stepCode}`, title: `${t.partyName || ''} · ${t.stepCode} ${t.stepName}`, fg: tone.fg, bg: tone.bg };
                })}
              />
            </Box>
          )}
        </DashCard>
      </Box>

      {/* ── My tasks ── */}
      <Box ref={tableRef} sx={{ scrollMarginTop: 12 }}>
        <DashCard
          title="My tasks"
          expandable={false}
          actions={(
            <FilterBar chip={`${via} · ${view.length} tasks`} onClear={reset}>
              <MiniSelect
                label="Status"
                value={STATUS_OPTIONS.some((o) => o.value === f.status) ? f.status : ''}
                onChange={(v) => { setF({ ...f, status: v }); setVia(v ? STATUS_VIA[v] : 'All tasks'); }}
                options={STATUS_OPTIONS}
              />
              <MiniSelect
                label="Step"
                value={f.step}
                onChange={(v) => { setF({ ...f, step: v }); setVia(v ? `Step ${v}` : 'All tasks'); }}
                options={stepOptions}
              />
            </FilterBar>
          )}
        >
          <DashTable
            columns={columns.filter((c) => !c.hidden)}
            csvColumns={columns.filter((c) => c.key !== 'sno')}
            rows={view}
            rowKey={(t) => t.key}
            onRowClick={openTask}
            searchText={(t) => `${t.soNumber || ''} ${t.partyName || ''} ${t.stepCode} ${t.stepName || ''} ${t.dcNumber || ''}`}
            searchPlaceholder="Search order, party or step…"
            exportName="my-o2d-tasks"
            defaultSort={{ key: 'status', dir: 'asc' }}
            resetKey={JSON.stringify(f)}
            emptyText={tasks.length ? 'No tasks in this view.' : 'You have no O2D tasks right now.'}
          />
        </DashCard>
      </Box>

      <DayTasksDrawer
        day={dayOpen}
        tasks={dayOpen != null ? (byDay.get(startOfDay(dayOpen)) || []) : []}
        stateOf={(t) => ({ chip: chipOf(t) })}
        onOpenTask={openTask}
        onClose={() => setDayOpen(null)}
      />
    </DashPage>
  );
};

export default MyDashboard;
