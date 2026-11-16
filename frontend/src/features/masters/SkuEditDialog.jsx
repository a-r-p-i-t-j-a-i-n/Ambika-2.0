import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Edit3 } from 'lucide-react';
import { useGetSkuByIdQuery } from '../../store/api/skuApi';
import { useMasterRights } from '../../utils/embed';
import SkuDialogShell from './SkuDialogShell';
import SkuForm from './SkuForm';

/**
 * Edit SKU — the same large centered dialog as Register SKU, over the SKU
 * Master (route /skus/:id/edit, a child of /skus). Loads the SKU fresh from
 * GET /skus/:id and edits it with the same form, prefill, checks and save
 * call (SkuForm).
 */
const SkuEditDialog = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const close = () => navigate('/skus');
  // Inside the Delegation Suite, its lock icon can switch SKU Master → Edit off
  // for this person — the list hides Edit then; a direct link is refused here
  // too (the server also refuses the save).
  const { canEdit } = useMasterRights('skuMaster');
  const { data, isLoading, isFetching, error } = useGetSkuByIdQuery(id, {
    skip: !id || !canEdit,
    refetchOnMountOrArgChange: true,
  });
  const sku = data?.data || null;
  const subtitle = sku ? [sku.code, sku.name].filter(Boolean).join(' · ') : 'Update the item’s details';

  // Loading / refused / not-found states sit in the dialog body, with Close below.
  const message = (content) => (
    <>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 2.5 }}>{content}</Box>
      <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', px: 3, py: 1.75, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={close} sx={{ minWidth: 110 }}>Close</Button>
      </Box>
    </>
  );

  let body;
  if (!canEdit) {
    body = message(<Alert severity="warning">Editing SKUs is switched off for you.</Alert>);
  } else if (isLoading || (isFetching && !sku)) {
    body = message(
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">Loading SKU…</Typography>
      </Stack>,
    );
  } else if (error || !sku) {
    body = message(<Alert severity="error">{error?.data?.message || 'SKU not found — it may have been deleted.'}</Alert>);
  } else {
    body = <SkuForm active sku={sku} onDone={close} onCancel={close} />;
  }

  return (
    <SkuDialogShell
      onClose={close}
      testId="sku-edit-dialog"
      icon={Edit3}
      title={sku ? `Edit SKU · ${sku.code}` : 'Edit SKU Item'}
      subtitle={subtitle}
    >
      {body}
    </SkuDialogShell>
  );
};

export default SkuEditDialog;
