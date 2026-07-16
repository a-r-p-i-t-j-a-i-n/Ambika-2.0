import React from 'react';
import { Paper, Stack, TextField, MenuItem, Button, Chip } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { PPC_ACCENT } from './dprMeta';

// Default range = last 30 IST days.
export const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(from), to: iso(to) };
};

const PRESETS = [
  { label: 'Today', days: 0 }, { label: '7d', days: 6 }, { label: '30d', days: 29 }, { label: '90d', days: 89 },
];

/**
 * Shared date-range + optional extra-filter bar for every DPR dashboard.
 * `extra` renders additional controls (e.g. a machine picker) inline.
 */
const DateRangeBar = ({ value, onChange, onRefresh, extra, isFetching }) => {
  const applyPreset = (days) => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    onChange({ ...value, from: iso(from), to: iso(to) });
  };
  return (
    <Paper elevation={0} sx={{ p: 1.25, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }}
          value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} sx={{ width: 160 }} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }}
          value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} sx={{ width: 160 }} />
        <Stack direction="row" spacing={0.5}>
          {PRESETS.map((p) => (
            <Chip key={p.label} label={p.label} size="small" onClick={() => applyPreset(p.days)}
              sx={{ fontWeight: 700, cursor: 'pointer' }} variant="outlined" />
          ))}
        </Stack>
        {extra}
        <Button size="small" variant="outlined" startIcon={<RefreshCw size={15} />} onClick={onRefresh}
          disabled={isFetching} sx={{ ml: 'auto', color: PPC_ACCENT, borderColor: PPC_ACCENT }}>
          Refresh
        </Button>
      </Stack>
    </Paper>
  );
};

export default DateRangeBar;
