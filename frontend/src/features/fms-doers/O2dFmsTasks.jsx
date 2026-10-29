import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Button, Skeleton,
  Table, TableHead, TableBody, TableRow, TableCell, Pagination, Tooltip, alpha,
} from '@mui/material';
import {
  ClipboardList, AlertCircle, CalendarClock, CheckCircle2, History, ChevronRight,
  Search, ListFilter, UserRound, CalendarDays, ArrowUpDown, Truck, Play, ArrowRight, Inbox, RefreshCw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetO2dFmsTasksQuery } from '../../store/api/o2dFmsApi';
import { useHiddenSteps, stepKey } from '../../utils/embed';

/**
 * FMS → My FMS Tasks, O2D FMS. Every O2D step waiting on this person (per
 * order up to dispatch, then per delivery challan) and the ones they finished
 * in the last 30 days — one row each, with the buttons that do the work: the
 * same screens as the Step Board (Dispatch Plan + Generate Dispatch Plan PDF on
 * 2.04, Track Delivery on 2.09, …), or Do Task for a step done on its own page
 * (checklist → Mark Done). A row moves to Completed by itself once the work is
 * saved. Managers can switch to everybody's tasks (the page header's My / All).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZES = [5, 10, 20, 50, 100, 200, 500];
const DEFAULT_PAGE_SIZE = 10;
// A filter at its default stays out of the address.
const FILTER_DEFAULTS = { q: '', status: 'open', by: 'anyone', due: 'any', sort: 'newest', page: 1, size: DEFAULT_PAGE_SIZE };
const oneOf = (value, options, fallback) => (options.some((o) => o.value === value) ? value : fallback);
const BLUE = '#1d6cf2';
const INK = '#0f172a';
const SUB = '#64748b';
const LINE = '#e5e9f2';

// Button names on the rows (same screens as the Step Board): short on the
// button, the full name on hover.
const ACTION_LABELS = {
  ORDER_INTAKE: ['Order Intake', 'Order Intake'],
  ORDER_ENTRY: ['Order Entry', 'Sales Order Entry'],
  DISPATCH_PLAN: ['Dispatch Plan', 'Dispatch Planning'],
  DISPATCH_PLAN_PDF: ['Dispatch Plan PDF', 'Generate Dispatch Plan PDF'],
  EMAIL_DISPATCH_SCHEDULE: ['Email Schedule', 'Email Dispatch Schedule'],
  ACTUAL_DISPATCH: ['Dispatch Items', 'Actual Dispatch (challan)'],
  CHALLAN_PDF: ['Challan PDF', 'Generate Challan PDF'],
  INVOICE_ENTRY: ['Invoice & Eway', 'Create Invoice & Eway Bill'],
  INVOICE_EMAIL: ['Email Invoice', 'Email Invoice & Eway Bill'],
  TRACK_DELIVERY: ['Track Delivery', 'Track Delivery'],
  PAYMENT_FOLLOWUP: ['Payment Follow-up', 'Payment Follow-up'],
  PAYMENT_RECEIPT: ['Receive Payment', 'Receive Payment & Tally Entry'],
  TRANSPORT_BILL_RECEIVE: ['Receive Bill', 'Receive Transport Bill'],
  TRANSPORT_BILL_STATUS: ['Bill Payment', 'Transport Bill Payment Status'],
};

// One size for every row button — fixed width, one line.
const ActionButton = ({ primary = false, label, title, onClick }) => (
  <Tooltip title={title && title !== label ? title : ''} placement="left" disableInteractive>
    <Button
      size="small" variant={primary ? 'contained' : 'outlined'} disableElevation onClick={onClick}
      startIcon={primary ? <Play size={12} /> : <ArrowRight size={12} />}
      sx={{
        width: 148, height: 28, px: 1.25, borderRadius: 1.5, justifyContent: 'flex-start',
        textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', lineHeight: 1, whiteSpace: 'nowrap',
        '& .MuiButton-startIcon': { mr: 0.75, ml: 0 },
        ...(primary
          ? { bgcolor: BLUE, backgroundImage: 'none', boxShadow: 'none', '&:hover': { bgcolor: '#1557c9', backgroundImage: 'none', boxShadow: 'none' } }
          : { color: BLUE, borderColor: alpha(BLUE, 0.4), '&:hover': { borderColor: BLUE, bgcolor: alpha(BLUE, 0.04) } }),
      }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Box>
    </Button>
  </Tooltip>
);

const STATUS = {
  pending:  { label: 'Pending',        color: '#b45309', bg: '#fff7e6', dot: '#f59e0b' },
  progress: { label: 'In Progress',    color: '#1d4ed8', bg: '#eaf1ff', dot: '#2563eb' },
  overdue:  { label: 'Overdue',        color: '#b91c1c', bg: '#fdecec', dot: '#dc2626' },
  done:     { label: 'Completed',      color: '#047857', bg: '#e7f8f0', dot: '#10b981' },
  late:     { label: 'Completed Late', color: '#6d28d9', bg: '#f1ebff', dot: '#7c3aed' },
};

const STATUS_FILTERS = [
  { value: 'open', label: 'Open (to do)' },
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'progress', label: 'In Progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'late', label: 'Completed Late' },
];
const DUE_FILTERS = [
  { value: 'any', label: 'Any date' },
  { value: 'past', label: 'Past due' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Next 7 days' },
];
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'dueSoon', label: 'Due date (soonest)' },
  { value: 'dueLate', label: 'Due date (latest)' },
];

// Read the clock outside render bodies (one value per list build).
const clock = () => Date.now();
const ms = (d) => (d ? new Date(d).getTime() : null);
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

const statusOf = (r, now) => {
  if (r.state === 'done') return ms(r.plannedAt) && ms(r.doneAt) > ms(r.plannedAt) ? 'late' : 'done';
  if (ms(r.plannedAt) && ms(r.plannedAt) < now) return 'overdue';
  return r.inProgress ? 'progress' : 'pending';
};

const ASSIGNER_NONE = '__plan__';
const assignerKey = (r) => r.assignedBy?.id || ASSIGNER_NONE;
const assignerName = (r) => r.assignedBy?.name || 'Doer Assignment';

const people = (list) => {
  const names = (list || []).map((p) => p.name).filter(Boolean);
  if (!names.length) return '';
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
};

// A short card — icon, name, count — so the task rows get the room.
const StatCard = ({ title, value, icon, tone, active, onClick }) => {
  const Icon = icon;
  return (
  <Box
    role="button" tabIndex={0} onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    sx={{
      flex: '1 1 160px', minWidth: 160, px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer',
      bgcolor: alpha(tone, 0.06), border: `1px solid ${active ? tone : alpha(tone, 0.22)}`,
      boxShadow: active ? `0 0 0 2px ${alpha(tone, 0.25)}` : 'none',
      transition: 'border-color .15s, box-shadow .15s',
      '&:hover': { borderColor: tone },
    }}
  >
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha(tone, 0.14), color: tone, flexShrink: 0 }}>
        <Icon size={18} strokeWidth={2.2} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 700, color: SUB }}>{title}</Typography>
        <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: INK, lineHeight: 1.15 }}>{value}</Typography>
      </Box>
      <ChevronRight size={15} color={SUB} />
    </Stack>
  </Box>
  );
};

const FilterSelect = ({ icon, label, value, onChange, options, minWidth = 170 }) => {
  const Icon = icon;
  return (
  <TextField
    select size="small" value={value} onChange={(e) => onChange(e.target.value)}
    sx={{ minWidth, flex: '1 1 auto', '& .MuiInputBase-root': { height: 40, borderRadius: 2, bgcolor: '#fff' } }}
    SelectProps={{
      renderValue: (v) => (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ fontSize: '0.82rem' }}>
          <Icon size={16} color={SUB} />
          <span style={{ color: SUB }}>{label}:</span>
          <b style={{ color: INK }}>{options.find((o) => o.value === v)?.label || v}</b>
        </Stack>
      ),
    }}
  >
    {options.map((o) => <MenuItem key={o.value} value={o.value} sx={{ fontSize: '0.84rem' }}>{o.label}</MenuItem>)}
  </TextField>
  );
};

const StatusChip = ({ status, row }) => {
  const s = STATUS[status];
  const chip = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.45, borderRadius: 999, bgcolor: s.bg, color: s.color, fontSize: '0.74rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.dot }} />
      {s.label}
    </Box>
  );
  if (row.state !== 'done') return chip;
  return <Tooltip title={`Done ${fmtDate(row.doneAt)} ${fmtTime(row.doneAt)}${row.doneByName ? ` by ${row.doneByName}` : ''}`}>{chip}</Tooltip>;
};

// `scope`: 'mine', or 'all' — the page offers All only to those allowed it,
// and the server checks the same.
const O2dFmsTasks = ({ scope = 'mine' }) => {
  const navigate = useNavigate();
  const hidden = useHiddenSteps('o2d');

  // The filters live in the address (?status=overdue&by=…&page=2&size=50), so
  // Back from a task's screen — or a refresh — returns to exactly this view.
  // Each change replaces the entry (one event, one update), so Back still
  // goes to the page before. Values at their default stay out of the address.
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const status = oneOf(params.get('status'), STATUS_FILTERS, FILTER_DEFAULTS.status);
  const assigner = params.get('by') || FILTER_DEFAULTS.by;
  const due = oneOf(params.get('due'), DUE_FILTERS, FILTER_DEFAULTS.due);
  const sort = oneOf(params.get('sort'), SORTS, FILTER_DEFAULTS.sort);
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : DEFAULT_PAGE_SIZE;
  const setFilters = (patch) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => {
      const value = v == null ? '' : String(v);
      if (!value || value === String(FILTER_DEFAULTS[k])) next.delete(k);
      else next.set(k, value);
    });
    return next;
  }, { replace: true });
  // A new filter starts on page 1.
  const setSearch = (v) => setFilters({ q: v, page: 1 });
  const setStatus = (v) => setFilters({ status: v, page: 1 });
  const setAssigner = (v) => setFilters({ by: v, page: 1 });
  const setDue = (v) => setFilters({ due: v, page: 1 });
  const setSort = (v) => setFilters({ sort: v, page: 1 });
  const setPage = (p) => setFilters({ page: p });
  const setPageSize = (n) => setFilters({ size: n, page: 1 });

  const { data, isLoading, isFetching, isError, refetch } = useGetO2dFmsTasksQuery(
    scope,
    { pollingInterval: 60_000, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: 30 },
  );

  // Rows with their status; steps switched off for this person in the
  // Delegation Suite (lock icon) are left out.
  const { rows, now } = useMemo(() => {
    const t = clock();
    const list = (data?.data || [])
      .filter((r) => !hidden.has(stepKey(r.stepCode)))
      .map((r) => ({ ...r, status: statusOf(r, t) }));
    return { rows: list, now: t };
  }, [data, hidden]);

  const assigners = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => seen.set(assignerKey(r), assignerName(r)));
    return [{ value: 'anyone', label: 'Anyone' },
      ...[...seen].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [rows]);

  // Card counts.
  const cards = useMemo(() => {
    const today0 = startOfDay(now);
    const plannedToday = (r) => ms(r.plannedAt) >= today0 && ms(r.plannedAt) < today0 + DAY_MS;
    return {
      total: rows.length,
      overdue: rows.filter((r) => r.status === 'overdue').length,
      today: rows.filter((r) => r.state === 'open' && plannedToday(r)).length,
      done: rows.filter((r) => r.state === 'done').length,
      late: rows.filter((r) => r.status === 'late').length,
    };
  }, [rows, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today0 = startOfDay(now);
    const dueOk = (r) => {
      const p = ms(r.plannedAt);
      if (due === 'any') return true;
      if (p == null) return false;
      if (due === 'past') return p < today0;
      if (due === 'today') return p >= today0 && p < today0 + DAY_MS;
      if (due === 'tomorrow') return p >= today0 + DAY_MS && p < today0 + 2 * DAY_MS;
      return p >= today0 && p < today0 + 7 * DAY_MS;
    };
    const statusOk = (r) => {
      if (status === 'all') return true;
      if (status === 'open') return r.state === 'open';
      if (status === 'completed') return r.state === 'done';
      return r.status === status;
    };
    const list = rows.filter((r) => statusOk(r)
      && (assigner === 'anyone' || assignerKey(r) === assigner)
      && dueOk(r)
      && (!q || [r.soNumber, r.poNumber, r.partyName, r.dcNumber, r.stepName, r.stepCode, people(r.doers)]
        .some((v) => String(v || '').toLowerCase().includes(q))));
    const by = {
      newest: (a, b) => (ms(b.openedAt) || 0) - (ms(a.openedAt) || 0),
      oldest: (a, b) => (ms(a.openedAt) || 0) - (ms(b.openedAt) || 0),
      dueSoon: (a, b) => (ms(a.plannedAt) ?? Infinity) - (ms(b.plannedAt) ?? Infinity),
      dueLate: (a, b) => (ms(b.plannedAt) ?? -Infinity) - (ms(a.plannedAt) ?? -Infinity),
    }[sort];
    return [...list].sort(by);
  }, [rows, now, search, status, assigner, due, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize);

  // A card is a shortcut to its filter (one update for all of it).
  const pickCard = (key) => setFilters({
    page: 1,
    due: key === 'today' ? 'today' : 'any',
    status: { total: 'all', overdue: 'overdue', today: 'open', done: 'completed', late: 'late' }[key],
  });
  const activeCard = due === 'today' && status === 'open' ? 'today'
    : ({ all: 'total', overdue: 'overdue', completed: 'done', late: 'late' })[status] || null;

  const th = { fontSize: '0.72rem', fontWeight: 800, color: INK, letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: `1px solid ${LINE}`, py: 1.5, whiteSpace: 'nowrap', bgcolor: '#f8faff' };
  const td = { borderBottom: `1px solid ${LINE}`, py: 1.6 };

  return (
    <Stack spacing={1.5}>
      {/* Cards */}
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.25}>
        <StatCard title="Total Tasks" value={cards.total} icon={ClipboardList} tone="#2563eb" active={activeCard === 'total'} onClick={() => pickCard('total')} />
        <StatCard title="Overdue" value={cards.overdue} icon={AlertCircle} tone="#dc2626" active={activeCard === 'overdue'} onClick={() => pickCard('overdue')} />
        <StatCard title="Due Today" value={cards.today} icon={CalendarClock} tone="#f59e0b" active={activeCard === 'today'} onClick={() => pickCard('today')} />
        <StatCard title="Completed" value={cards.done} icon={CheckCircle2} tone="#10b981" active={activeCard === 'done'} onClick={() => pickCard('done')} />
        <StatCard title="Completed Late" value={cards.late} icon={History} tone="#7c3aed" active={activeCard === 'late'} onClick={() => pickCard('late')} />
      </Stack>

      {/* Filters */}
      <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.5, border: `1px solid ${LINE}` }}>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.25}>
          <TextField
            size="small" value={search} placeholder="Search order, challan, party or step…"
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: '2 1 260px', '& .MuiInputBase-root': { height: 40, borderRadius: 2 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={17} color={SUB} /></InputAdornment> }}
          />
          <FilterSelect icon={ListFilter} label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} />
          <FilterSelect icon={UserRound} label="Assigned By" value={assigner} onChange={setAssigner} options={assigners} minWidth={200} />
          <FilterSelect icon={CalendarDays} label="Due Date" value={due} onChange={setDue} options={DUE_FILTERS} />
          <FilterSelect icon={ArrowUpDown} label="Sort" value={sort} onChange={setSort} options={SORTS} />
        </Stack>
      </Paper>

      {/* Table */}
      <Paper elevation={0} sx={{ borderRadius: 2.5, border: `1px solid ${LINE}`, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 1180 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...th, width: 48, pl: 2.5 }}>#</TableCell>
                <TableCell sx={th}>Task Name</TableCell>
                <TableCell sx={th}>Source</TableCell>
                <TableCell sx={th}>Current Step</TableCell>
                <TableCell sx={th}>Assigned To</TableCell>
                <TableCell sx={th}>Due Date</TableCell>
                <TableCell sx={th}>Status</TableCell>
                <TableCell sx={{ ...th, pr: 2.5 }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && [0, 1, 2, 3].map((i) => (
                <TableRow key={i}><TableCell colSpan={8} sx={td}><Skeleton height={34} /></TableCell></TableRow>
              ))}
              {!isLoading && isError && (
                <TableRow><TableCell colSpan={8} sx={{ ...td, py: 6, textAlign: 'center' }}>
                  <Typography sx={{ fontWeight: 700, color: INK }}>Could not load your FMS tasks.</Typography>
                  <Button size="small" startIcon={<RefreshCw size={14} />} onClick={refetch} sx={{ mt: 1, textTransform: 'none' }}>Try again</Button>
                </TableCell></TableRow>
              )}
              {!isLoading && !isError && shown.length === 0 && (
                <TableRow><TableCell colSpan={8} sx={{ ...td, py: 7, textAlign: 'center' }}>
                  <Inbox size={34} color="#94a3b8" />
                  <Typography sx={{ fontWeight: 700, color: INK, mt: 1 }}>
                    {rows.length ? 'No tasks match these filters' : 'No O2D tasks here yet'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8rem', color: SUB }}>
                    {rows.length ? 'Clear the search or pick another filter.' : 'A task shows here as soon as an O2D step is waiting on you.'}
                  </Typography>
                </TableCell></TableRow>
              )}
              {!isLoading && !isError && shown.map((r, i) => {
                const tint = r.status === 'overdue' ? '#fff6f6' : (r.state === 'open' && ms(r.plannedAt) && ms(r.plannedAt) < startOfDay(now) + DAY_MS) ? '#fffbf2' : '#fff';
                const actions = r.state === 'open' ? (r.actions || []) : [];
                return (
                  <TableRow key={r.key} sx={{ bgcolor: tint, '&:hover': { bgcolor: alpha(BLUE, 0.03) } }}>
                    <TableCell sx={{ ...td, pl: 2.5, color: SUB, fontWeight: 700 }}>{(current - 1) * pageSize + i + 1}</TableCell>
                    <TableCell sx={td}>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box sx={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(STATUS[r.status].dot, 0.12), color: STATUS[r.status].dot }}>
                          <ClipboardList size={18} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: INK }}>{r.stepName}</Typography>
                          <Typography sx={{ fontSize: '0.74rem', color: SUB }}>
                            {[r.soNumber || 'New order', r.dcNumber, r.partyName].filter(Boolean).join(' · ')}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={td}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 999, bgcolor: '#f3edff', color: '#6d28d9', fontSize: '0.74rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <Truck size={14} /> O2D FMS
                      </Box>
                    </TableCell>
                    <TableCell sx={{ ...td, color: '#475569', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      Step {r.stepNo} of {r.stepTotal} · {r.stepCode}
                    </TableCell>
                    <TableCell sx={td}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#f1f5f9', color: SUB, flexShrink: 0 }}><UserRound size={15} /></Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.84rem', color: people(r.doers) ? INK : SUB, fontStyle: people(r.doers) ? 'normal' : 'italic' }}>
                            {people(r.doers) || 'Unassigned'}
                          </Typography>
                          {r.asBuddy && <Typography sx={{ fontSize: '0.68rem', color: '#7c3aed', fontWeight: 700 }}>You are the buddy</Typography>}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ ...td, whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CalendarDays size={16} color={r.status === 'overdue' ? '#dc2626' : SUB} />
                        <Box>
                          <Typography sx={{ fontSize: '0.84rem', fontWeight: r.status === 'overdue' ? 700 : 500, color: r.status === 'overdue' ? '#dc2626' : '#334155' }}>{fmtDate(r.plannedAt)}</Typography>
                          {r.plannedAt && <Typography sx={{ fontSize: '0.7rem', color: SUB }}>{fmtTime(r.plannedAt)}</Typography>}
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={td}><StatusChip status={r.status} row={r} /></TableCell>
                    <TableCell sx={{ ...td, pr: 2.5, width: 172 }}>
                      <Stack spacing={0.5} alignItems="flex-start">
                        {r.state === 'done' ? (
                          <ActionButton label="View Step" title="Open this step" onClick={() => navigate(r.stepPath)} />
                        ) : actions.length ? actions.map((a, ai) => {
                          const [label, title] = ACTION_LABELS[a.key] || [a.label, a.label];
                          return <ActionButton key={a.key} primary={ai === 0} label={label} title={title} onClick={() => navigate(a.path)} />;
                        }) : (
                          <ActionButton primary label="Do Task" title="Open the step — checklist, then Mark Done" onClick={() => navigate(r.stepPath)} />
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${LINE}`, flexWrap: 'wrap', rowGap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Typography sx={{ fontSize: '0.82rem', color: SUB }}>
              {filtered.length
                ? `Showing ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)} of ${filtered.length} task${filtered.length === 1 ? '' : 's'}`
                : 'No tasks'}
              {isFetching && !isLoading ? ' · refreshing…' : ''}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ fontSize: '0.82rem', color: SUB, whiteSpace: 'nowrap' }}>Rows per page</Typography>
              <TextField
                select size="small" value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                sx={{ width: 78, '& .MuiInputBase-root': { height: 32, borderRadius: 1.5, fontSize: '0.82rem' } }}
              >
                {PAGE_SIZES.map((n) => <MenuItem key={n} value={n} sx={{ fontSize: '0.82rem' }}>{n}</MenuItem>)}
              </TextField>
            </Stack>
          </Stack>
          {pageCount > 1 && (
            <Pagination count={pageCount} page={current} onChange={(_e, p) => setPage(p)} shape="rounded" color="primary" size="small" />
          )}
        </Stack>
      </Paper>
    </Stack>
  );
};

export default O2dFmsTasks;
