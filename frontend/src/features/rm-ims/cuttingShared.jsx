import React, { useMemo, useState } from 'react';
import {
  Box, Stack, Typography, TextField, MenuItem, Button, Chip, Autocomplete, InputAdornment, Badge, Collapse, Tooltip,
  Paper, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Search, SlidersHorizontal, RotateCcw, Filter } from 'lucide-react';
import { O2D, O2D_TIP, num, panelSx } from './rmImsMeta';
import { LOCATION_TOKENS } from '../scrap-ims/scrapImsMeta';
import { LOCATION_OPTIONS, RECORD_TYPES } from './cuttingFilters';

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

/**
 * The filter bar: search, the dates, circle SKU, cutting location and record
 * type on the bar; batch number and cutting status behind "More filters"
 * (opened by itself while one of them is set). On a phone everything but the
 * search folds behind one "Filters" button that counts what is set.
 *
 *   filters      what useCuttingFilters() returned;
 *   circleList   the circle-SKU query result its "Circle SKU" picker offers;
 *   testId       the bar's own test id;
 *   children     shown under the bar — notes about how the filters match.
 */
export const CuttingFilterBar = ({ filters, circleList, testId, children }) => {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [moreOpen, setMoreOpen] = useState(false);
  const {
    input, setText, setNow, reset, dateError, anyFilter, activeCount, secondaryActive,
  } = filters;
  const circleOptions = useMemo(() => circleList.data?.data || [], [circleList.data]);
  const circleValue = useMemo(
    () => circleOptions.find((c) => c.skuId === input.circleSkuId) || null,
    [circleOptions, input.circleSkuId],
  );
  const tid = (k) => `filter-${k}`;
  const fid = (k) => `history-filter-${k}`;
  // What "Filters" (phone) or "More filters" counts and keeps open.
  const hiddenActive = compact ? activeCount - (input.search ? 1 : 0) : secondaryActive;
  const showMore = moreOpen || hiddenActive > 0;

  const search = (
    <Field id={fid('search')} label="Search" basis={compact ? '1 1 100%' : '2 1 190px'}>
      <TextField id={fid('search')} size="small" fullWidth value={input.search} sx={fieldSx}
        onChange={(e) => setText('search', e.target.value)} placeholder="Batch no., conversion, GRN, SKU, supplier…"
        inputProps={{ 'data-testid': tid('search') }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.sub} /></InputAdornment> }} />
    </Field>
  );
  const dates = [
    <Field key="from" id={fid('from')} label="From date">
      <TextField id={fid('from')} size="small" fullWidth type="date" value={input.from} sx={fieldSx}
        onChange={(e) => setNow('from', e.target.value)}
        inputProps={{ 'data-testid': tid('from'), max: input.to || undefined }} />
    </Field>,
    <Field key="to" id={fid('to')} label="To date">
      <TextField id={fid('to')} size="small" fullWidth type="date" value={input.to} sx={fieldSx}
        onChange={(e) => setNow('to', e.target.value)}
        error={dateError} helperText={dateError ? 'Must be on or after "From date"' : undefined}
        FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.66rem' } }}
        inputProps={{ 'data-testid': tid('to'), min: input.from || undefined }} />
    </Field>,
  ];
  const circle = (
    <Field id={fid('circle')} label="Circle SKU" basis="1.2 1 145px">
      <Autocomplete
        id={fid('circle')} size="small" options={circleOptions} value={circleValue}
        onChange={(_, v) => setNow('circleSkuId', v?.skuId || '')}
        loading={circleList.isFetching}
        noOptionsText={circleList.isError ? 'Could not load circle sizes' : 'No circle has been produced yet'}
        getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
        renderOption={(props, o) => (
          <li {...props} key={o.skuId}>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{o.skuCode}</Typography>
              <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.skuName} · {num(o.rounds)} round{o.rounds === 1 ? '' : 's'}</Typography>
            </Box>
          </li>
        )}
        renderInput={(p) => (
          <TextField {...p} placeholder="All circle SKUs" sx={fieldSx}
            inputProps={{ ...p.inputProps, 'data-testid': tid('circle') }}
            helperText={circleList.isError ? 'Could not load circle sizes — the other filters still work.' : undefined}
            FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.64rem', color: '#b91c1c' } }} />
        )}
      />
    </Field>
  );
  const location = (
    <Field id={fid('location')} label="Cutting location">
      <TextField id={fid('location')} select size="small" fullWidth value={input.location} sx={fieldSx}
        onChange={(e) => setNow('location', e.target.value)} SelectProps={selectProps(fid('location'), tid('location'))}>
        <MenuItem value="">All locations</MenuItem>
        {LOCATION_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </Field>
  );
  const recordType = (
    <Field id={fid('entry-type')} label="Record type">
      <TextField id={fid('entry-type')} select size="small" fullWidth value={input.entryType} sx={fieldSx}
        onChange={(e) => setNow('entryType', e.target.value)} SelectProps={selectProps(fid('entry-type'), tid('entry-type'))}>
        {RECORD_TYPES.map((o) => <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </Field>
  );
  const batch = (
    <Field id={fid('batch')} label="Batch number" basis="0 1 280px">
      <TextField id={fid('batch')} size="small" fullWidth value={input.batchNo} sx={fieldSx}
        onChange={(e) => setText('batchNo', e.target.value)} placeholder="Full or part of it"
        inputProps={{ 'data-testid': tid('batch') }} />
    </Field>
  );
  const status = (
    <Field id={fid('status')} label="Cutting status" basis="0 1 220px">
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
  // Fields wrap onto as many rows as the width needs; inputs and buttons stay
  // bottom-aligned under their labels.
  const row = { display: 'flex', flexWrap: 'wrap', gap: 1.25, alignItems: 'flex-end' };

  return (
    <Paper elevation={0} sx={{ ...panelSx, px: { xs: 1.25, md: 1.75 }, py: 1.5 }} data-testid={testId}>
      {compact ? (
        // Phone: the search, then one button for every other filter.
        <>
          <Box sx={row}>{search}{buttons}</Box>
          <Collapse in={showMore}>
            <Box sx={{ ...row, mt: 1.25 }}>{dates}{circle}{location}{recordType}{batch}{status}</Box>
          </Collapse>
        </>
      ) : (
        <>
          <Box sx={row}>{search}{dates}{circle}{location}{recordType}{buttons}</Box>
          <Collapse in={showMore}>
            <Box sx={{ ...row, mt: 1.25 }}>{batch}{status}</Box>
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
