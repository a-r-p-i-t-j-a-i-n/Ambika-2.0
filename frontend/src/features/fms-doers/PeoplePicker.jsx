import React from 'react';
import { Box, Typography, TextField, Autocomplete, Chip, Tooltip, createFilterOptions } from '@mui/material';
import { PFMS } from '../procurement/pfmsTheme';

/**
 * Multi-person picker of FMS → Doer Assignment (main doers / buddies), shared
 * by the O2D and Purchase grids. People: { id, name, email, role, offLabel?,
 * sameName? }. `offLabel` people (inactive, not in Delegation…) stay visible in
 * red but cannot be picked. `noteOf(p)` (optional) adds an amber warning to a
 * person, e.g. a step permission they lack — they can still be picked.
 */

// Search by name, email or role.
const filterPeople = createFilterOptions({ stringify: (p) => `${p.name || ''} ${p.email || ''} ${p.role || ''}` });

// Two accounts can share a name (one made in the ERP, one from a Delegation
// sign-in); a chip then carries the email too, so the right one is picked.
const chipLabel = (p) => (p.sameName && p.email ? `${p.name} · ${p.email}` : p.name);

const PeoplePicker = ({ people, personById, selected, onChange, placeholder, error, noteOf, inputProps }) => (
  <Autocomplete
    multiple
    size="small"
    options={people}
    value={selected.map((id) => personById.get(id)).filter(Boolean)}
    onChange={(_e, list) => onChange(list.map((p) => p.id))}
    getOptionLabel={(p) => p?.name || ''}
    filterOptions={filterPeople}
    getOptionDisabled={(p) => !!p.offLabel}
    isOptionEqualToValue={(a, b) => a.id === b.id}
    filterSelectedOptions
    disableCloseOnSelect
    renderOption={(props, p) => {
      const note = noteOf?.(p);
      return (
        <li {...props} key={p.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600}>{p.name}{p.offLabel ? ` (${p.offLabel})` : ''}</Typography>
            {p.email && (
              <Typography variant="caption" component="div" sx={{ color: p.sameName ? '#b45309' : PFMS.sub, wordBreak: 'break-all' }}>
                {p.email}
              </Typography>
            )}
            {p.role && <Typography variant="caption" component="div" sx={{ color: PFMS.sub }}>{p.role}</Typography>}
            {note && <Typography variant="caption" component="div" sx={{ color: '#b45309', fontWeight: 600 }}>{note}</Typography>}
          </Box>
        </li>
      );
    }}
    renderTags={(value, getTagProps) => value.map((p, index) => {
      const { key, ...tagProps } = getTagProps({ index });
      const note = noteOf?.(p);
      return (
        <Tooltip key={key} title={`${p.email || ''}${p.offLabel ? ` — ${p.offLabel}, replace with a Delegation employee` : ''}${note ? ` — ${note}` : ''}`} arrow disableInteractive>
          <Chip {...tagProps} size="small" label={p.offLabel ? `${chipLabel(p)} — ${p.offLabel}` : chipLabel(p)}
            color={p.offLabel ? 'error' : (note ? 'warning' : 'default')} variant={p.offLabel || note ? 'outlined' : 'filled'}
            sx={{ fontWeight: 600, height: 24, maxWidth: 280 }} />
        </Tooltip>
      );
    })}
    renderInput={(params) => (
      <TextField {...params} placeholder={selected.length ? '' : placeholder} error={!!error}
        inputProps={{ ...params.inputProps, ...(inputProps || {}) }} />
    )}
    sx={{ minWidth: 230, maxWidth: 320 }}
  />
);

export default PeoplePicker;
