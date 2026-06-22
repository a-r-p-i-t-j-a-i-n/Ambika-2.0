import React from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

dayjs.extend(customParseFormat);

/**
 * Shared DD/MM/YYYY date input for Purchase FMS.
 *
 * The user can BOTH type DD/MM/YYYY manually AND pick from the calendar popup
 * (MUI X DatePicker + AdapterDayjs). The component talks to its parent purely
 * in ISO YYYY-MM-DD (so API params and backend storage are unchanged).
 *
 * Props:
 *  - value      : ISO date string ('YYYY-MM-DD') or '' (also tolerates full ISO)
 *  - onChange   : called with an ISO 'YYYY-MM-DD' string, or '' when cleared
 *  - label, fullWidth, required, disabled, size, sx
 *  - error, helperText → merged with the picker's own invalid-date validation
 *  - openOnClick → also open the calendar when the input field itself is clicked
 *                  (not only the calendar icon)
 *  - ...rest    → forwarded to the underlying TextField via slotProps
 */

const DISPLAY = 'DD/MM/YYYY';

/** 'YYYY-MM-DD' (or full ISO) → dayjs|null. */
export const isoToDayjs = (iso) => {
  if (!iso) return null;
  const d = dayjs(String(iso).slice(0, 10), 'YYYY-MM-DD', true);
  return d.isValid() ? d : null;
};

/** '2026-06-15' → '15/06/2026'. Returns '' if not parseable. */
export const formatIsoToDDMMYYYY = (iso) => {
  const d = isoToDayjs(iso);
  return d ? d.format(DISPLAY) : '';
};

/** '15/06/2026' → '2026-06-15'. Returns '' if incomplete or not a real date. */
export const parseDDMMYYYYToIso = (display) => {
  if (!display) return '';
  const d = dayjs(String(display).trim(), DISPLAY, true);
  return d.isValid() ? d.format('YYYY-MM-DD') : '';
};

const DateInputDDMMYYYY = ({
  value = '',
  onChange,
  label,
  fullWidth = false,
  required = false,
  disabled = false,
  size = 'small',
  sx,
  error: errorProp = false,
  helperText = '',
  openOnClick = false,
  ...rest
}) => {
  const [invalid, setInvalid] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const handleChange = (val, context) => {
    // val is a dayjs object (or null). context.validationError flags bad input.
    if (val == null) { setInvalid(false); onChange?.(''); return; }
    if (context?.validationError || !val.isValid()) { setInvalid(true); return; }
    setInvalid(false);
    onChange?.(val.format('YYYY-MM-DD'));
  };

  const showError = invalid || !!errorProp;
  const helper = invalid ? 'Enter a valid date (dd/mm/yyyy)' : helperText;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        label={label}
        value={isoToDayjs(value)}
        onChange={handleChange}
        format={DISPLAY}
        disabled={disabled}
        {...(openOnClick ? { open, onOpen: () => setOpen(true), onClose: () => setOpen(false) } : {})}
        slotProps={{
          textField: {
            size,
            sx,
            fullWidth,
            required,
            error: showError,
            helperText: helper,
            placeholder: 'dd/mm/yyyy',
            // Open the calendar when the input field is clicked (not just the icon).
            ...(openOnClick && !disabled ? { onClick: () => setOpen(true) } : {}),
            ...rest,
          },
          field: { clearable: !required },
        }}
      />
    </LocalizationProvider>
  );
};

export default DateInputDDMMYYYY;
