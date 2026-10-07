/**
 * Assigned-items panel, shared by the Machine detail (its operators) and the
 * Operator detail (its machines). One component so both directions of the
 * many-to-many behave and read identically.
 *
 * Duplicate prevention is belt-and-braces: already-assigned options are
 * disabled in the picker, so a duplicate cannot be submitted from here, and the
 * server rejects one with a 409 regardless.
 */
import React, { useState } from 'react';
import {
  Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, IconButton,
  Paper, Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { Plus, X } from 'lucide-react';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER, Help, fieldSx, btnSx, panelSx,
} from './masterUi';

const AssignmentPanel = ({
  title,
  titleHint,
  subtitle,
  icon: Icon,
  assigned = [],
  options = [],
  getPrimary,
  getSecondary,
  onAdd,
  onRemove,
  addLabel = 'Add',
  pickerLabel = 'Search to assign',
  emptyHint = 'Nobody assigned yet.',
  busy = false,
  canEdit = true,
}) => {
  const [pending, setPending] = useState([]);

  const assignedIds = new Set(assigned.map((a) => String(a._id)));

  const handleAdd = async () => {
    if (!pending.length) return;
    await onAdd(pending.map((p) => p._id));
    setPending([]);
  };

  return (
    <Paper sx={{ ...panelSx, p: 2, flexGrow: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        {Icon ? <Icon size={16} color={BRAND_DK} /> : null}
        <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: BRAND_DK }}>
          {title}<Help text={titleHint} />
        </Typography>
        <Chip
          size="small"
          label={assigned.length}
          sx={{
            height: 20, fontSize: '0.68rem', fontWeight: 800,
            bgcolor: alpha(assigned.length ? BRAND : O2D.sub, 0.1),
            color: assigned.length ? BRAND : O2D.sub,
          }}
        />
        {subtitle ? (
          <Typography sx={{ fontSize: '0.74rem', color: O2D.sub, ml: 'auto' }}>{subtitle}</Typography>
        ) : null}
      </Stack>

      {/* Currently assigned */}
      {assigned.length === 0 ? (
        <Typography sx={{ fontSize: '0.8rem', color: O2D.faint, py: 1 }}>{emptyHint}</Typography>
      ) : (
        <Stack spacing={0.5} sx={{ mb: canEdit ? 2 : 0 }}>
          {assigned.map((item) => (
              <Stack
                key={item._id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1.25, py: 0.75, borderRadius: '8px',
                  border: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surfaceAlt,
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY }}>
                    {getPrimary(item)}
                  </Typography>
                  {getSecondary?.(item) ? (
                    <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                      {getSecondary(item)}
                    </Typography>
                  ) : null}
                </Box>
                {canEdit && (
                  <Tooltip title="Remove this assignment">
                    <span>
                      <IconButton
                        size="small"
                        disabled={busy}
                        onClick={() => onRemove(item._id)}
                        sx={{ color: DANGER, '&:hover': { bgcolor: alpha(DANGER, 0.1) } }}
                      >
                        <X size={15} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Stack>
          ))}
        </Stack>
      )}

      {/* Picker */}
      {canEdit && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            sx={{ ...fieldSx, flex: 1, width: '100%' }}
            options={options}
            value={pending}
            onChange={(_e, v) => setPending(v)}
            getOptionLabel={(o) => getPrimary(o) || ''}
            isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
            getOptionDisabled={(o) => assignedIds.has(String(o._id))}
            renderOption={(props, option, { selected }) => {
              const already = assignedIds.has(String(option._id));
              // eslint-disable-next-line react/prop-types
              const { key, ...rest } = props;
              return (
                <li key={key} {...rest}>
                  <Checkbox size="small" checked={selected || already} sx={{ p: 0.5, mr: 0.5 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 700, color: NAVY }}>
                      {getPrimary(option)}
                    </Typography>
                    {getSecondary?.(option) ? (
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                        {already ? 'Already assigned' : getSecondary(option)}
                      </Typography>
                    ) : null}
                  </Box>
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...rest } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    {...rest}
                    size="small"
                    label={getPrimary(option)}
                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700 }}
                  />
                );
              })
            }
            renderInput={(params) => <TextField {...params} placeholder={pickerLabel} />}
          />
          <Button
            variant="contained"
            disabled={busy || !pending.length}
            onClick={handleAdd}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <Plus size={15} />}
            sx={{ ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK }, width: { xs: '100%', sm: 'auto' } }}
          >
            {addLabel}
          </Button>
        </Stack>
      )}
    </Paper>
  );
};

export default AssignmentPanel;
