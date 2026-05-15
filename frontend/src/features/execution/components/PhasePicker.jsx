import React from 'react';
import { Autocomplete, Box, Chip, Stack, TextField, Typography, alpha, useTheme } from '@mui/material';
import { CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import dayjs from 'dayjs';

// Builds a single Autocomplete-friendly option array from
// dispatchablePhases.grouped — each element is one phaseNo bucket.
const buildOptions = (data) => {
  if (!data?.grouped) return [];
  const opts = data.grouped.map((g) => ({
    kind: 'phase',
    phaseNo: g.phaseNo,
    plannedDate: g.plannedDate,
    totalPlanned: g.totalPlanned,
    totalEffective: g.totalEffective,
    totalCarryIn: g.totalCarryIn,
    totalActual: g.totalActual,
    totalPending: g.totalPending,
    skuCount: g.skuCount,
    skus: g.skus,
    // We pick the first phase's id as the dropdown's stable handle — but
    // when the user actually submits we still need ALL the per-SKU phase
    // rows so the DC payload can attach the right phaseId to each SKU.
    phaseId: g.skus?.[0]?.phaseId,
  }));
  // Add a synthetic "Unplanned" tail option.
  opts.push({ kind: 'unplanned' });
  return opts;
};

const PhasePicker = ({ data, value, onChange, isLoading }) => {
  const theme = useTheme();
  const options = buildOptions(data);

  return (
    <Autocomplete
      options={options}
      value={value}
      loading={isLoading}
      onChange={(_, opt) => onChange?.(opt)}
      getOptionLabel={(opt) => {
        if (!opt) return '';
        if (opt.kind === 'unplanned') return 'Unplanned (no plan link)';
        return `${opt.phaseNo} · ${opt.plannedDate ? dayjs(opt.plannedDate).format('DD MMM') : 'No date'} · pending ${Number(opt.totalPending || 0).toLocaleString('en-IN')}`;
      }}
      isOptionEqualToValue={(a, b) => (
        (a?.kind === 'unplanned' && b?.kind === 'unplanned')
        || (a?.phaseNo && a.phaseNo === b?.phaseNo)
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Which plan phase? *"
          placeholder="Select the phase this dispatch fulfils"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <Box sx={{ display: 'flex', alignItems: 'center', mr: 1, color: 'primary.main' }}>
                <CalendarClock size={14} />
              </Box>
            ),
          }}
        />
      )}
      renderOption={(props, opt) => (
        <li {...props} key={opt.kind === 'unplanned' ? '__unplanned' : opt.phaseNo}>
          {opt.kind === 'unplanned' ? (
            <Box sx={{
              width: '100%',
              p: 1, borderRadius: '8px',
              bgcolor: alpha(theme.palette.warning.main, 0.08),
              border: `1px dashed ${alpha(theme.palette.warning.main, 0.4)}`,
            }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AlertTriangle size={14} color={theme.palette.warning.main} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} color="warning.main">Unplanned dispatch</Typography>
                  <Typography variant="caption" color="text.secondary">Flag this DC as out-of-plan (risk panel will surface it)</Typography>
                </Box>
              </Stack>
            </Box>
          ) : (
            <Box sx={{ width: '100%' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
                <Box sx={{
                  width: 30, height: 22, borderRadius: '6px',
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  color: 'primary.main', display: 'grid', placeItems: 'center',
                  fontWeight: 800, fontSize: '0.72rem',
                }}>{opt.phaseNo}</Box>
                <Typography variant="body2" fontWeight={700}>
                  {opt.plannedDate ? dayjs(opt.plannedDate).format('DD MMM YYYY') : 'No date'}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${opt.skuCount} SKU${opt.skuCount > 1 ? 's' : ''}`}
                  sx={{ fontSize: '0.65rem', height: 18 }}
                />
                {Number(opt.totalPending || 0) === 0 && (
                  <Chip
                    size="small"
                    icon={<CheckCircle2 size={11} />}
                    label="Done"
                    color="success"
                    variant="outlined"
                    sx={{ fontSize: '0.65rem', height: 18 }}
                  />
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Plan {Number(opt.totalPlanned).toLocaleString('en-IN')}
                {Number(opt.totalCarryIn || 0) !== 0 && (
                  <> · Carry <strong style={{ color: Number(opt.totalCarryIn) > 0 ? theme.palette.error.main : theme.palette.success.main }}>{Number(opt.totalCarryIn) > 0 ? '+' : '−'}{Math.abs(Number(opt.totalCarryIn)).toLocaleString('en-IN')}</strong></>
                )}
                {' · Effective '}<strong>{Number(opt.totalEffective || opt.totalPlanned).toLocaleString('en-IN')}</strong>
                {' · Actual '}{Number(opt.totalActual).toLocaleString('en-IN')}
                {' · Pending '}<strong>{Number(opt.totalPending).toLocaleString('en-IN')}</strong>
              </Typography>
            </Box>
          )}
        </li>
      )}
    />
  );
};

export default PhasePicker;
