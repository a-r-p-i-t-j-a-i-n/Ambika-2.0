import React, { useState } from 'react';
import { Stack, Button, Skeleton } from '@mui/material';
import { Pencil, Boxes } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { FgShell, StatusChip, O2D } from './fgImsMeta';
import ItemHistoryView from '../ims/ItemHistoryView';
import { useGetFgForecastQuery, useGetFgItemLedgerQuery } from '../../store/api/fgImsApi';
import FgPolicyDrawer from './FgPolicyDrawer';

/**
 * ONE FINISHED GOOD — opened from the eye on Stock & Master Data: four cards
 * and its history, one row per entry (ItemHistoryView, the same page as Raw
 * Material and Consumables & Packaging). Its planning policy is edited from
 * the header.
 */
const FgImsItemDetail = () => {
  const goBack = useSmartBack('/fg-ims/stock');
  const { skuId } = useParams();
  const [editSku, setEditSku] = useState(null);

  // The item and its stock figures (the forecast's snapshot of today).
  const { data, isLoading } = useGetFgForecastQuery({ skuId, days: 30 });
  const sku = data?.data?.sku;
  const m = data?.data?.metrics || {};

  return (
    <FgShell
      icon={Boxes}
      title={sku?.skuName || 'Finished good'}
      subtitle={sku ? `${sku.skuCode}${sku.category ? ` · ${sku.category}` : ''}${sku.unit ? ` · counted in ${sku.unit}` : ''}` : 'Loading item…'}
      onBack={goBack}
      backLabel="Back to the stock list"
      actions={(
        <Stack direction="row" spacing={0.75} alignItems="center">
          {m.status && <StatusChip status={m.status} />}
          <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setEditSku(skuId)}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Edit planning policy
          </Button>
        </Stack>
      )}
    >
      {isLoading || !sku ? <Skeleton variant="rounded" height={340} /> : (
        <ItemHistoryView skuId={skuId} useLedger={useGetFgItemLedgerQuery}
          unit={sku.unit || ''} onHand={m.onHand} status={m.status} />
      )}
      <FgPolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </FgShell>
  );
};

export default FgImsItemDetail;
