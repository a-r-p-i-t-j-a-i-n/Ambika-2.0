import React, { useState } from 'react';
import {
  Box, TextField, Popover, MenuList, MenuItem, Typography, InputAdornment,
} from '@mui/material';
import { ChevronDown, Check } from 'lucide-react';
import { O2D } from './imsMeta';
import {
  NO_QTY_RANGE, QTY_PRESETS, parseQtyText, describeQtyRange, sameQtyRange,
} from './qtyRange';

/**
 * AVAILABLE QTY — narrow a stock list to the items holding below, above or
 * between given quantities. One field: open it and type —
 *
 *   "10"     →  Exactly 10  ·  Below 10  ·  Above 10
 *   "10-20"  →  Between 10 and 20 (both included)
 *   nothing  →  quick picks (Below 10, Above 100…) and Any quantity
 *
 * Enter takes the first offer. `value` / `onChange` carry { mode, a, b }
 * (qtyRange.js), which the page matches against each row's on-hand.
 */
const QtyRangeFilter = ({ value = NO_QTY_RANGE, onChange, label = 'Available qty', sx }) => {
  const [anchor, setAnchor] = useState(null);
  const [text, setText] = useState('');
  const parsed = parseQtyText(text);

  // What the menu offers for what is typed.
  let offers;
  if (parsed?.kind === 'range') offers = [{ mode: 'range', a: parsed.a, b: parsed.b }];
  // Exactly first, so Enter on "10" shows the items holding exactly 10.
  else if (parsed?.kind === 'number') offers = [{ mode: 'exact', a: parsed.n }, { mode: 'below', a: parsed.n }, { mode: 'above', a: parsed.n }];
  else offers = [NO_QTY_RANGE, ...QTY_PRESETS];

  const pick = (r) => { onChange?.(r.mode ? r : NO_QTY_RANGE); setAnchor(null); setText(''); };
  // "Below 10", "Above 100", "Between 10 and 20" — the field then reads "10 – 20".
  const offerText = (r) => (r.mode === 'range' ? `Between ${describeQtyRange(r).replace(' – ', ' and ')}` : describeQtyRange(r));

  return (
    <>
      <TextField size="small" label={label} value={describeQtyRange(value)}
        onClick={(e) => setAnchor(e.currentTarget)}
        InputProps={{
          readOnly: true,
          endAdornment: <InputAdornment position="end"><ChevronDown size={15} color={O2D.sub} /></InputAdornment>,
        }}
        inputProps={{ style: { cursor: 'pointer' }, 'data-testid': 'qty-range-filter' }}
        sx={{ minWidth: 165, cursor: 'pointer', ...sx }} />
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => { setAnchor(null); setText(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, width: 270, borderRadius: '8px', border: `1px solid ${O2D.line}` } } }}>
        <Box sx={{ p: 1.25, pb: 0.5 }}>
          <TextField autoFocus fullWidth size="small" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Type 10, or a range like 10-20"
            onKeyDown={(e) => { if (e.key === 'Enter' && parsed) pick(offers[0]); }}
            inputProps={{ 'aria-label': 'Quantity or range', 'data-testid': 'qty-range-input' }} />
          <Typography sx={{ fontSize: '0.62rem', color: text && !parsed ? '#b91c1c' : O2D.faint, mt: 0.5 }}>
            {text && !parsed ? 'Type a number like 10, or a range like 10-20.' : 'A number offers exactly / below / above; a range is both ends included.'}
          </Typography>
        </Box>
        <MenuList dense sx={{ py: 0.5 }}>
          {offers.map((r) => {
            const on = sameQtyRange(r, value) || (!r.mode && !value?.mode);
            return (
              <MenuItem key={`${r.mode}-${r.a}-${r.b}`} selected={on} onClick={() => pick(r)} sx={{ gap: 1, fontSize: '0.8rem' }}>
                <Box sx={{ width: 16, display: 'flex', color: O2D.brand }}>{on && <Check size={14} />}</Box>
                {offerText(r)}
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>
    </>
  );
};

export default QtyRangeFilter;
