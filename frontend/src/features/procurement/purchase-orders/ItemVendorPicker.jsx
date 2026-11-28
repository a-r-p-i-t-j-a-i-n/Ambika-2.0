import React, { useMemo, useState } from 'react';
import {
  Autocomplete, Box, Button, CircularProgress, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { Plus } from 'lucide-react';
import { fmtDate } from './poMeta';
import { newVendorOptions, previousVendorCaption, previousVendorOptions } from './itemVendor';

/**
 * The two ways to choose the vendor of an approved indent item — nothing is chosen for the user.
 *
 *   Select Previous Vendor   the vendors that really supplied this item before: placed POs (row.previousVendors),
 *                            active vendors only, latest purchase first, each with its purchase reference.
 *   Add New Vendor           any other ACTIVE vendor from the Vendor Master. Works when the item has no purchase
 *                            history — the vendor does not have to have supplied it before.
 *
 * A quotation (or a vendor named on its file) is not a vendor selection and is never offered as one.
 * The server re-checks the vendor (active Vendor Master record) whichever option was used.
 *
 * Props: row (approved-item row: previousVendors / itemName / unit) · vendors (Vendor Master list) · loading ·
 * value (the chosen vendor, or null to start empty) · onChange(vendor|null) · onCreateVendor (optional: opens
 * "create a vendor & rate") · testId (prefix for the test ids).
 * Optional, for a caller whose "previous" list is not the placed-PO list (Step 1.3: vendors that quoted for the item
 * or supplied it before): previousOptions (a ready list of { _id, name, … }) · previousCaption(option) → the line
 * under each previous vendor · noPreviousText · createLabel · disabled · inputTestId (fixed id for the input).
 */
const sameVendor = (a, b) => !!a && !!b && String(a._id) === String(b._id);

const ItemVendorPicker = ({
  row, vendors = [], loading = false, value = null, onChange, onCreateVendor, testId = 'vendor-pick',
  previousOptions = null, previousCaption = null, noPreviousText = '', createLabel = 'Create vendor & rate', disabled = false, inputTestId = '',
}) => {
  const previous = useMemo(() => previousOptions || previousVendorOptions(row, vendors), [previousOptions, row, vendors]);
  const everyone = useMemo(() => newVendorOptions(vendors), [vendors]);
  const previousIds = useMemo(() => new Set(previous.map((o) => String(o._id))), [previous]);
  // The user's own choice of option wins; until then start on Previous when the item has any, else on Add New.
  const [picked, setPicked] = useState(null);
  const mode = picked || (value && !previousIds.has(String(value._id)) ? 'new' : previous.length ? 'previous' : 'new');

  const base = mode === 'previous' ? previous : everyone;
  const options = value && !base.some((o) => sameVendor(o, value)) ? [value, ...base] : base;

  const filterOptions = (opts, { inputValue }) => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => [o.name, o.code, o.contactPerson, o.phone, o.email, o.gstNo, o.location].some((f) => String(f || '').toLowerCase().includes(q)));
  };

  return (
    <Box data-testid={testId} data-mode={mode} sx={{ minWidth: 0 }}>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={mode}
        disabled={disabled}
        onChange={(_e, next) => next && setPicked(next)}
        sx={{
          mb: 0.75,
          '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', py: 0.4, lineHeight: 1.25 },
          '& .MuiToggleButton-root.Mui-selected': { bgcolor: 'rgba(29, 78, 216, 0.12)', color: '#1d4ed8', borderColor: 'rgba(29, 78, 216, 0.45)' },
        }}
      >
        <ToggleButton value="previous" data-testid={`${testId}-mode-previous`}>
          Select Previous Vendor{previous.length ? ` (${previous.length})` : ''}
        </ToggleButton>
        <ToggleButton value="new" data-testid={`${testId}-mode-new`}>Add New Vendor</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'previous' && !previous.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} data-testid={`${testId}-no-previous`}>
          {loading ? 'Loading vendors…' : (noPreviousText || 'No previous vendor has supplied this item — use Add New Vendor.')}
        </Typography>
      ) : (
        <Autocomplete
          size="small"
          options={options}
          value={value}
          loading={loading}
          disabled={disabled}
          onChange={(_e, o) => onChange?.(o)}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => sameVendor(o, v)}
          filterOptions={filterOptions}
          noOptionsText={loading ? 'Loading vendors…' : mode === 'previous' ? 'No previous vendor' : 'No matching vendor'}
          renderOption={(props, o) => (
            <Box component="li" {...props} key={o._id} sx={{ display: 'block !important', py: 0.75 }} data-testid={`${testId}-option`}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="body2" fontWeight={700}>{o.name}</Typography>
                {mode === 'new' && previousIds.has(String(o._id)) ? (
                  <Typography variant="caption" sx={{ color: '#0f766e', fontWeight: 700, whiteSpace: 'nowrap' }}>Supplied before</Typography>
                ) : null}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {mode === 'previous'
                  ? ((previousCaption ? previousCaption(o) : previousVendorCaption(o._previous || previous.find((p) => sameVendor(p, o))?._previous, fmtDate)) || '—')
                  : ([o.gstNo && `GST: ${o.gstNo}`, o.phone, o.location].filter(Boolean).join(' · ') || '—')}
              </Typography>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={mode === 'previous' ? 'Select a previous vendor' : 'Select a vendor from the Vendor Master'}
              inputProps={{
                ...params.inputProps,
                'aria-label': mode === 'previous' ? 'Previous vendor' : 'Vendor from the Vendor Master',
                'data-testid': inputTestId || `${testId}-${mode}-input`,
              }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (<>{loading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>),
              }}
            />
          )}
        />
      )}

      {mode === 'new' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary" data-testid={`${testId}-new-hint`}>
            Any active vendor in the Vendor Master — it need not have supplied this item before.
          </Typography>
          {onCreateVendor ? (
            <Button size="small" startIcon={<Plus size={13} />} onClick={onCreateVendor} data-testid={`${testId}-create`}
              sx={{ textTransform: 'none', py: 0, fontSize: '0.72rem', fontWeight: 700 }}>
              {createLabel}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

export default ItemVendorPicker;
