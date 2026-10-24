import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Stack, Typography, TextField, MenuItem, Button, Chip, Autocomplete, InputAdornment, Badge, Collapse, Tooltip,
  Paper, useMediaQuery, Popover, ButtonBase, Divider, ListSubheader, MenuList,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Search, SlidersHorizontal, RotateCcw, Filter, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import dayjs from 'dayjs';
import { O2D, O2D_TIP, num, panelSx } from './rmImsMeta';
import { LOCATION_TOKENS } from '../scrap-ims/scrapImsMeta';
import { LOCATION_OPTIONS, RECORD_TYPES, SORTS } from './cuttingFilters';

/**
 * The Coil to Circle history's filter bar and location chip:
 *
 *   useCuttingFilters()   (cuttingFilters.js) what the filters show, what has
 *                         been sent, and the page — back to the first page on
 *                         every change;
 *   CuttingFilterBar      the filter bar itself;
 *   WhereCut              a cutting location as a chip (PLG01 / JW001).
 */

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'PARTIALLY_CUT', label: 'Partially cut' },
  { value: 'FULLY_CUT', label: 'Fully cut' },
];
const fieldSx = {
  // One height for every field — text, date, select and picker — so the row lines up.
  '& .MuiInputBase-root': { bgcolor: O2D.surface, borderRadius: '7px', minHeight: 40 },
  '& .MuiInputBase-root:not(.MuiAutocomplete-inputRoot)': { height: 40 },
  '& .MuiInputBase-input': { fontSize: '0.8rem' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: O2D.line },
};
const labelSx = { display: 'block', mb: 0.5, fontSize: '0.72rem', fontWeight: 700, color: O2D.body, lineHeight: 1.3 };
const buttonSx = { textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap', height: 40, borderRadius: '7px' };

/** A field with its label above it — the label names the field for assistive tech too. */
const Field = ({ id, label, children, basis = '1 1 130px' }) => (
  <Box sx={{ minWidth: 0, flex: basis }}>
    <Typography component="label" id={`${id}-label`} htmlFor={id} sx={labelSx}>{label}</Typography>
    {children}
  </Box>
);
// A select is named by its label and the value it shows, as MUI's own labels did.
const selectProps = (id, testId) => ({
  displayEmpty: true,
  'data-testid': testId,
  SelectDisplayProps: { 'aria-labelledby': `${id}-label ${id}` },
});

// ── Date & sort ──────────────────────────────────────────────────────────────

const ISO = 'YYYY-MM-DD';
// Weeks run Monday to Sunday.
const mondayOf = (d) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');
const weekRange = (monday) => [monday.format(ISO), monday.add(6, 'day').format(ISO)];
const monthRange = (m) => [m.startOf('month').format(ISO), m.endOf('month').format(ISO)];
const weekText = (monday) => `${monday.format('DD MMM')} – ${monday.add(6, 'day').format('DD MMM YYYY')}`;

/** Which kind of range a from–to is: none, a whole week, a whole month, or custom. */
const rangeKind = (from, to) => {
  if (!from && !to) return 'none';
  if (from && to) {
    const f = dayjs(from);
    const t = dayjs(to);
    if (f.isSame(mondayOf(f), 'day') && t.isSame(f.add(6, 'day'), 'day')) return 'week';
    if (f.isSame(f.startOf('month'), 'day') && t.isSame(f.endOf('month'), 'day')) return 'month';
  }
  return 'custom';
};
/** A from–to as it reads on the field: All dates, a week, a month, or the days. */
const describeRange = (from, to) => {
  const kind = rangeKind(from, to);
  if (kind === 'none') return 'All dates';
  if (kind === 'week') return `Week ${weekText(dayjs(from))}`;
  if (kind === 'month') return dayjs(from).format('MMMM YYYY');
  if (from && to) return from === to ? dayjs(from).format('DD MMM YYYY') : `${dayjs(from).format('DD MMM')} – ${dayjs(to).format('DD MMM YYYY')}`;
  return from ? `From ${dayjs(from).format('DD MMM YYYY')}` : `Until ${dayjs(to).format('DD MMM YYYY')}`;
};

/** One choice in the Date & sort list: a tick when it is the one in force. */
const Choice = ({ selected, onClick, children, sub, more, testId }) => (
  <MenuItem selected={selected} onClick={onClick} data-testid={testId} sx={{ py: 0.7, gap: 1, minHeight: 0 }}>
    <Box sx={{ width: 16, display: 'flex', color: O2D.brand, flexShrink: 0 }}>{selected && <Check size={14} />}</Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: selected ? 700 : 500, color: O2D.ink }}>{children}</Typography>
      {sub && <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{sub}</Typography>}
    </Box>
    {more && <ChevronRight size={14} color={O2D.sub} />}
  </MenuItem>
);
const subheadSx = { lineHeight: '28px', fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub, bgcolor: O2D.surface };
const BackRow = ({ onClick, title }) => (
  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, py: 0.75, borderBottom: `1px solid ${O2D.lineSoft}` }}>
    <Button size="small" onClick={onClick} startIcon={<ChevronLeft size={14} />}
      sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', minWidth: 0, px: 0.75, color: O2D.body }}>
      Back
    </Button>
    <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink }}>{title}</Typography>
  </Stack>
);

/**
 * DATE & SORT — one field for the row order and the dates the cuts are from.
 * Shared with Scrap master data, which passes its own `sorts`.
 *
 *   Sort   latest to oldest (the default), oldest to latest, coil SKU A → Z;
 *   Date   all dates · Weekly (pick a week, Monday–Sunday) · Monthly (pick a
 *          month) · Custom date (a calendar for from and to).
 *
 * Whatever is picked becomes the same `from` / `to` (and `sort`) the table
 * has always been asked with, so the server's filtering is unchanged; the
 * field reads what is in force — e.g. "October 2026 · Latest first".
 */
export const DateSortField = ({
  id, input, setNow, setMany, testId, sorts = SORTS,
}) => {
  const [anchor, setAnchor] = useState(null);
  const [view, setView] = useState('main');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const fromRef = useRef(null);
  const close = () => setAnchor(null);
  const pickRange = ([from, to]) => { setMany({ from, to }); close(); };
  const openCustom = () => { setCustom({ from: input.from, to: input.to }); setView('custom'); };
  // Custom date: straight to the calendar, where the browser allows it.
  useEffect(() => {
    if (view !== 'custom' || !fromRef.current) return;
    fromRef.current.focus();
    try { fromRef.current.showPicker?.(); } catch { /* the browser decides when a picker may open */ }
  }, [view]);

  const sort = sorts.find((s) => s.value === input.sort) || sorts[0];
  const kind = rangeKind(input.from, input.to);
  const label = `${describeRange(input.from, input.to)} · ${sort.short}`;
  const today = dayjs();
  const weeks = Array.from({ length: 12 }, (_, i) => mondayOf(today).subtract(i, 'week'));
  const months = Array.from({ length: 18 }, (_, i) => today.startOf('month').subtract(i, 'month'));
  const isRange = (r) => input.from === r[0] && input.to === r[1];
  const customBad = !!(custom.from && custom.to && custom.from > custom.to);
  const showPicker = (e) => { try { e.target.showPicker?.(); } catch { /* not every browser */ } };

  return (
    <>
      <Tooltip arrow slotProps={O2D_TIP} title={label} disableInteractive>
        <ButtonBase id={id} onClick={(e) => { setAnchor(e.currentTarget); setView('main'); }}
          aria-haspopup="dialog" aria-expanded={!!anchor} aria-labelledby={`${id}-label ${id}`} data-testid={testId}
          sx={{
            width: '100%', height: 40, px: 1.1, gap: 0.75, justifyContent: 'flex-start', borderRadius: '7px',
            border: `1px solid ${anchor ? O2D.brand : O2D.line}`, bgcolor: O2D.surface, color: O2D.ink, fontSize: '0.8rem',
            '&:hover': { borderColor: O2D.ink },
          }}>
          <CalendarDays size={15} color={O2D.sub} style={{ flexShrink: 0 }} />
          <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
          <ChevronDown size={15} color={O2D.sub} style={{ flexShrink: 0 }} />
        </ButtonBase>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, width: 290, borderRadius: '8px', border: `1px solid ${O2D.line}` } } }}>
        {view === 'main' && (
          <MenuList dense data-testid="date-sort-menu" sx={{ py: 0.5 }}>
            <ListSubheader sx={subheadSx}>Sort</ListSubheader>
            {sorts.map((s) => (
              <Choice key={s.value || 'latest'} selected={sort.value === s.value} testId={`sort-${s.value || 'latest'}`}
                sub={s.value === '' ? 'Default' : undefined}
                onClick={() => { setNow('sort', s.value); close(); }}>
                {s.label}
              </Choice>
            ))}
            <Divider sx={{ my: 0.5 }} />
            <ListSubheader sx={subheadSx}>Date</ListSubheader>
            <Choice selected={kind === 'none'} testId="date-all" onClick={() => pickRange(['', ''])}>All dates</Choice>
            <Choice selected={kind === 'week'} more testId="date-weekly" onClick={() => setView('week')}
              sub={kind === 'week' ? weekText(dayjs(input.from)) : 'Pick a week'}>
              Weekly
            </Choice>
            <Choice selected={kind === 'month'} more testId="date-monthly" onClick={() => setView('month')}
              sub={kind === 'month' ? dayjs(input.from).format('MMMM YYYY') : 'Pick a month'}>
              Monthly
            </Choice>
            <Choice selected={kind === 'custom'} more testId="date-custom" onClick={openCustom}
              sub={kind === 'custom' ? describeRange(input.from, input.to) : 'Pick from and to on a calendar'}>
              Custom date
            </Choice>
          </MenuList>
        )}
        {view === 'week' && (
          <>
            <BackRow onClick={() => setView('main')} title="Which week?" />
            <MenuList dense sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5 }} data-testid="date-week-list">
              {weeks.map((m, i) => {
                const r = weekRange(m);
                return (
                  <Choice key={r[0]} selected={isRange(r)} onClick={() => pickRange(r)}
                    sub={i === 0 ? 'This week' : i === 1 ? 'Last week' : undefined}>
                    {weekText(m)}
                  </Choice>
                );
              })}
            </MenuList>
          </>
        )}
        {view === 'month' && (
          <>
            <BackRow onClick={() => setView('main')} title="Which month?" />
            <MenuList dense sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5 }} data-testid="date-month-list">
              {months.map((m, i) => {
                const r = monthRange(m);
                return (
                  <Choice key={r[0]} selected={isRange(r)} onClick={() => pickRange(r)}
                    sub={i === 0 ? 'This month' : i === 1 ? 'Last month' : undefined}>
                    {m.format('MMMM YYYY')}
                  </Choice>
                );
              })}
            </MenuList>
          </>
        )}
        {view === 'custom' && (
          <>
            <BackRow onClick={() => setView('main')} title="Custom date" />
            <Stack spacing={1.25} sx={{ p: 1.5 }} data-testid="date-custom-form">
              <TextField size="small" type="date" label="From" value={custom.from} inputRef={fromRef} sx={fieldSx}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} onClick={showPicker}
                InputLabelProps={{ shrink: true }} inputProps={{ max: custom.to || undefined, 'data-testid': 'date-custom-from' }} />
              <TextField size="small" type="date" label="To" value={custom.to} sx={fieldSx}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} onClick={showPicker}
                error={customBad} helperText={customBad ? '"To" must be on or after "From".' : undefined}
                FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.66rem' } }}
                InputLabelProps={{ shrink: true }} inputProps={{ min: custom.from || undefined, 'data-testid': 'date-custom-to' }} />
              <Button variant="contained" disableElevation disabled={(!custom.from && !custom.to) || customBad}
                onClick={() => pickRange([custom.from, custom.to])} data-testid="date-custom-apply"
                sx={{ ...buttonSx, bgcolor: O2D.brand }}>
                Apply
              </Button>
            </Stack>
          </>
        )}
      </Popover>
    </>
  );
};

/**
 * The filter bar, on one line: search (any text), Date & sort, coil SKU,
 * circle SKU and cutting location; record type, batch number and cutting
 * status behind "More filters" — also one line — opened by itself while one
 * of them is set. On a phone everything but the search folds behind one
 * "Filters" button that counts what is set.
 *
 *   filters      what useCuttingFilters() returned;
 *   circleList   the circle-SKU query result its "Circle SKU" picker offers;
 *   coilList     the coil-SKU query result its "Coil SKU" picker offers;
 *   testId       the bar's own test id;
 *   children     shown under the bar — notes about how the filters match.
 */
export const CuttingFilterBar = ({
  filters, circleList, coilList, testId, children,
}) => {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [moreOpen, setMoreOpen] = useState(false);
  const {
    input, setText, setNow, setMany, reset, anyFilter, activeCount, secondaryActive,
  } = filters;
  const circleOptions = useMemo(() => circleList.data?.data || [], [circleList.data]);
  const circleValue = useMemo(
    () => circleOptions.find((c) => c.skuId === input.circleSkuId) || null,
    [circleOptions, input.circleSkuId],
  );
  const coilOptions = useMemo(() => coilList?.data?.data || [], [coilList?.data]);
  const coilValue = useMemo(
    () => coilOptions.find((c) => c.skuId === input.coilSkuId) || null,
    [coilOptions, input.coilSkuId],
  );
  const tid = (k) => `filter-${k}`;
  const fid = (k) => `history-filter-${k}`;
  // What "Filters" (phone) or "More filters" counts and keeps open.
  const hiddenActive = compact ? activeCount - (input.search ? 1 : 0) : secondaryActive;
  const showMore = moreOpen || hiddenActive > 0;

  const search = (
    <Field id={fid('search')} label="Search" basis={compact ? '1 1 100%' : '1 1 150px'}>
      <TextField id={fid('search')} size="small" fullWidth value={input.search} sx={fieldSx}
        onChange={(e) => setText('search', e.target.value)} placeholder="Anything — batch, SKU, GRN, supplier…"
        inputProps={{ 'data-testid': tid('search') }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.sub} /></InputAdornment> }} />
    </Field>
  );
  // The row order and the dates, in one field (see DateSortField).
  const dateSort = (
    <Field id={fid('date-sort')} label="Date & sort" basis={compact ? '1 1 100%' : '0 1 185px'}>
      <DateSortField id={fid('date-sort')} input={input} setNow={setNow} setMany={setMany} testId={tid('date-sort')} />
    </Field>
  );
  const coil = (
    <Field id={fid('coil')} label="Coil SKU" basis={compact ? '1 1 100%' : '0 1 135px'}>
      <Autocomplete
        id={fid('coil')} size="small" options={coilOptions} value={coilValue}
        onChange={(_, v) => setNow('coilSkuId', v?.skuId || '')}
        loading={coilList?.isFetching}
        noOptionsText={coilList?.isError ? 'Could not load coil SKUs' : 'No coil has been cut yet'}
        getOptionLabel={(o) => (o ? o.skuCode : '')}
        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
        slotProps={{ popper: { sx: { minWidth: 240 } } }}
        renderOption={(props, o) => (
          <li {...props} key={o.skuId}>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{o.skuCode}</Typography>
              <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.skuName} · {num(o.cuts)} cut{o.cuts === 1 ? '' : 's'}</Typography>
            </Box>
          </li>
        )}
        renderInput={(p) => (
          <TextField {...p} placeholder="All coils" sx={fieldSx}
            inputProps={{ ...p.inputProps, 'data-testid': tid('coil') }} />
        )}
      />
    </Field>
  );
  const circle = (
    <Field id={fid('circle')} label="Circle SKU" basis={compact ? '1 1 100%' : '0 1 140px'}>
      <Autocomplete
        id={fid('circle')} size="small" options={circleOptions} value={circleValue}
        onChange={(_, v) => setNow('circleSkuId', v?.skuId || '')}
        loading={circleList.isFetching}
        noOptionsText={circleList.isError ? 'Could not load circle sizes' : 'No circle has been produced yet'}
        // The code in the box (it is narrow); code and name in the list.
        getOptionLabel={(o) => (o ? o.skuCode : '')}
        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
        slotProps={{ popper: { sx: { minWidth: 260 } } }}
        renderOption={(props, o) => (
          <li {...props} key={o.skuId}>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{o.skuCode}</Typography>
              <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.skuName} · {num(o.rounds)} round{o.rounds === 1 ? '' : 's'}</Typography>
            </Box>
          </li>
        )}
        renderInput={(p) => (
          <TextField {...p} placeholder="All circles" sx={fieldSx}
            inputProps={{ ...p.inputProps, 'data-testid': tid('circle') }}
            helperText={circleList.isError ? 'Could not load circle sizes — the other filters still work.' : undefined}
            FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.64rem', color: '#b91c1c' } }} />
        )}
      />
    </Field>
  );
  const location = (
    <Field id={fid('location')} label="Cutting location" basis={compact ? '1 1 100%' : '0 1 130px'}>
      <TextField id={fid('location')} select size="small" fullWidth value={input.location} sx={fieldSx}
        onChange={(e) => setNow('location', e.target.value)} SelectProps={selectProps(fid('location'), tid('location'))}>
        <MenuItem value="">All locations</MenuItem>
        {LOCATION_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </Field>
  );
  const recordType = (
    <Field id={fid('entry-type')} label="Record type" basis={compact ? '1 1 100%' : '0 1 230px'}>
      <TextField id={fid('entry-type')} select size="small" fullWidth value={input.entryType} sx={fieldSx}
        onChange={(e) => setNow('entryType', e.target.value)} SelectProps={selectProps(fid('entry-type'), tid('entry-type'))}>
        {RECORD_TYPES.map((o) => <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </Field>
  );
  const batch = (
    <Field id={fid('batch')} label="Batch number" basis={compact ? '1 1 100%' : '0 1 220px'}>
      <TextField id={fid('batch')} size="small" fullWidth value={input.batchNo} sx={fieldSx}
        onChange={(e) => setText('batchNo', e.target.value)} placeholder="Full or part of it"
        inputProps={{ 'data-testid': tid('batch') }} />
    </Field>
  );
  const status = (
    <Field id={fid('status')} label="Cutting status" basis={compact ? '1 1 100%' : '0 1 180px'}>
      <TextField id={fid('status')} select size="small" fullWidth value={input.status} sx={fieldSx}
        onChange={(e) => setNow('status', e.target.value)} SelectProps={selectProps(fid('status'), tid('status'))}>
        {STATUS_OPTIONS.map((o) => <MenuItem key={o.value || 'any'} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </Field>
  );
  const buttons = (
    <Stack direction="row" spacing={0.75} sx={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
      <Button onClick={() => setMoreOpen((v) => !v)} aria-expanded={showMore} data-testid="filter-more"
        startIcon={(
          <Badge color="primary" badgeContent={hiddenActive} invisible={!hiddenActive}
            sx={{ '& .MuiBadge-badge': { fontSize: '0.58rem', height: 15, minWidth: 15 } }}>
            {compact ? <Filter size={14} /> : <SlidersHorizontal size={14} />}
          </Badge>
        )}
        sx={{ ...buttonSx, flex: { xs: 1, sm: 'none' }, px: 1.5, bgcolor: O2D.surfaceAlt, color: O2D.ink, border: `1px solid ${O2D.line}`, '&:hover': { bgcolor: O2D.band } }}>
        {compact ? 'Filters' : 'More filters'}
      </Button>
      <Button onClick={reset} disabled={!anyFilter} startIcon={<RotateCcw size={14} />} data-testid={tid('reset')}
        sx={{ ...buttonSx, flex: { xs: 1, sm: 'none' }, px: 1.25, color: O2D.body }}>
        Reset
      </Button>
    </Stack>
  );
  // One line on a desktop: the search takes what the narrow fields leave.
  // Only a narrow window wraps it; inputs and buttons stay bottom-aligned
  // under their labels.
  const row = { display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-end' };

  return (
    <Paper elevation={0} sx={{ ...panelSx, px: { xs: 1.25, md: 1.5 }, py: 1.25 }} data-testid={testId}>
      {compact ? (
        // Phone: the search, then one button for every other filter.
        <>
          <Box sx={row}>{search}{buttons}</Box>
          <Collapse in={showMore}>
            <Box sx={{ ...row, mt: 1.25 }}>{dateSort}{coil}{circle}{location}{recordType}{batch}{status}</Box>
          </Collapse>
        </>
      ) : (
        <>
          <Box sx={row}>{search}{dateSort}{coil}{circle}{location}{buttons}</Box>
          <Collapse in={showMore}>
            <Box sx={{ ...row, mt: 1 }}>{recordType}{batch}{status}</Box>
          </Collapse>
        </>
      )}
      {children}
    </Paper>
  );
};

/** Where a coil or a cut was cut. A coil whose rounds were cut in both places says so. */
export const WhereCut = ({ location }) => {
  if (!location) return <Typography sx={{ fontSize: '0.7rem', color: O2D.faint }}>—</Typography>;
  if (location === 'MIXED') {
    return (
      <Tooltip arrow slotProps={O2D_TIP} title="Some rounds were cut at PLG01 and some at JW001. Open the coil to see each round's location.">
        <Chip size="small" label="Mixed" sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, color: O2D.body, border: `1px solid ${O2D.line}` }} />
      </Tooltip>
    );
  }
  // The location CODE (PLG01 / JW001), in the Scrap module's own colours and
  // with its own explanation of who owns the offcut.
  const t = LOCATION_TOKENS[location];
  if (!t) return <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>{location}</Typography>;
  const Icon = t.icon;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" icon={<Icon size={12} />} label={`${location} · ${t.short}`}
        sx={{
          height: 22, fontWeight: 700, fontSize: '0.66rem', borderRadius: '6px',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
          '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
        }} />
    </Tooltip>
  );
};
