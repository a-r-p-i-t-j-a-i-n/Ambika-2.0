import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip, Box } from '@mui/material';

/**
 * The ⋮ menu shared by every Purchase FMS list. It owns its open / closed
 * state, so opening or closing it re-renders only this menu — never the page
 * or its DataGrid (every row of which is rendered, see rowActionsColumn.js).
 *
 *   const menuRef = useRef(null);
 *   const openMenu = (e, row) => { e.stopPropagation(); menuRef.current?.open(e.currentTarget, row); };
 *   const closeMenu = () => menuRef.current?.close();
 *   <RowActionsMenu ref={menuRef} actionsFor={actionsFor} />
 *
 * `actionsFor(row)` returns { key, label, icon, fn, danger?, disabled?, hint?, divider? }.
 * A disabled item can carry a `hint` (why), shown on hover. Picking an item
 * closes the menu first, then runs it.
 */
const RowActionsMenu = forwardRef(({ actionsFor }, ref) => {
  const [state, setState] = useState({ anchor: null, row: null });
  const close = () => setState((s) => (s.anchor ? { ...s, anchor: null } : s));

  useImperativeHandle(ref, () => ({
    open: (anchor, row) => setState({ anchor, row }),
    close,
  }), []);

  const items = state.row ? actionsFor(state.row) : [];
  return (
    <Menu
      anchorEl={state.anchor}
      open={Boolean(state.anchor)}
      onClose={close}
      // No scroll lock (the page would jump by the scrollbar's width) and a
      // short transition, so the menu opens and closes without a stutter.
      disableScrollLock
      transitionDuration={{ enter: 120, exit: 80 }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      TransitionProps={{ onExited: () => setState((s) => (s.anchor ? s : { anchor: null, row: null })) }}
      slotProps={{ paper: { sx: { minWidth: 210, mt: 0.5, borderRadius: '8px', boxShadow: '0 8px 24px rgba(15,23,42,0.14)' } } }}
    >
      {items.flatMap((a) => {
        const item = (
          <MenuItem key={a.key} disabled={a.disabled}
            onClick={() => { close(); a.fn?.(); }}
            sx={{ py: 0.9, ...(a.danger ? { color: 'error.main' } : {}) }}>
            <ListItemIcon sx={a.danger ? { color: 'error.main' } : undefined}>{a.icon}</ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.86rem', fontWeight: 600 }}>{a.label}</ListItemText>
          </MenuItem>
        );
        const shown = a.disabled && a.hint
          ? <Tooltip key={a.key} title={a.hint} placement="left"><Box component="span" sx={{ display: 'block' }}>{item}</Box></Tooltip>
          : item;
        return a.divider ? [<Divider key={`${a.key}-divider`} sx={{ my: 0.5 }} />, shown] : [shown];
      })}
    </Menu>
  );
});

RowActionsMenu.displayName = 'RowActionsMenu';
export default RowActionsMenu;
