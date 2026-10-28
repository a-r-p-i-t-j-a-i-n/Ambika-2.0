import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Eye, MoreVertical } from 'lucide-react';
import { PFMS } from '../pfmsTheme';

/**
 * The row action cell shared by every Purchase FMS DataGrid list:
 *
 *   [optional workflow buttons] [eye — quick view] [⋮ — more actions]
 *
 * Right-aligned with fixed button sizes, so the eye and the ⋮ sit in the same
 * place on every row of every list. A row without a quick view keeps an empty
 * slot where the eye would be, so the ⋮ never shifts. The full detail page
 * ("View") and any PDF preview live inside the ⋮ menu, never as row buttons.
 * Column definition + grid wiring: ./rowActionsColumn.js (sizes kept in sync).
 */
const BUTTON = 30;
const GAP = 4;

const quickViewSx = (t) => ({
  flexShrink: 0, width: BUTTON, height: BUTTON, borderRadius: '6px', color: 'primary.main',
  bgcolor: alpha(t.palette.primary.main, 0.08), border: `1px solid ${alpha(t.palette.primary.main, 0.3)}`,
  '&:hover': { bgcolor: alpha(t.palette.primary.main, 0.16) },
});
const menuSx = {
  flexShrink: 0, width: BUTTON, height: BUTTON, borderRadius: '6px', color: PFMS.sub,
  border: '1px solid transparent',
};

const RowActionsCell = ({
  rowId, label, onQuickView, quickViewLabel = 'Quick view', quickViewTestId = 'row-quick-view',
  onMenu, children,
}) => (
  <Box data-testid="row-actions" data-row-id={rowId}
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: `${GAP}px`, width: '100%', height: '100%', minWidth: 0 }}>
    {children}
    {onQuickView ? (
      <Tooltip title={quickViewLabel}>
        <IconButton size="small" aria-label={`${quickViewLabel} for ${label}`} data-testid={quickViewTestId}
          onClick={(e) => { e.stopPropagation(); onQuickView(); }} sx={quickViewSx}>
          <Eye size={16} strokeWidth={2.2} />
        </IconButton>
      </Tooltip>
    ) : (
      <Box aria-hidden sx={{ width: BUTTON, flexShrink: 0 }} />
    )}
    <Tooltip title="More actions">
      <IconButton size="small" aria-label={`More actions for ${label}`} aria-haspopup="menu" data-testid="row-more-actions"
        onClick={(e) => { e.stopPropagation(); onMenu(e); }} sx={menuSx}>
        <MoreVertical size={16} />
      </IconButton>
    </Tooltip>
  </Box>
);

export default RowActionsCell;
