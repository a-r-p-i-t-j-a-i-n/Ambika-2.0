import React, { useState } from 'react';
import { Stack, Button, Skeleton } from '@mui/material';
import { Pencil, Boxes } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { ImsShell, StatusChip, O2D } from './imsMeta';
import ItemHistoryView from './ItemHistoryView';
import { useGetImsForecastQuery, useGetImsItemLedgerQuery } from '../../store/api/imsApi';
import PolicyDrawer from './PolicyDrawer';

/**
 * ONE CONSUMABLES & PACKAGING ITEM — opened from the eye on Stock & Master
 * Data: four cards and its history, one row per entry (ItemHistoryView, the
 * same page as Raw Material and Finished Goods). Its planning policy is edited
 * from the header.
 */
const ImsItemDetail = () => {
  const navigate = useNavigate();
  const { skuId } = useParams();
  const [editSku, setEditSku] = useState(null);

  // The item and its stock figures (the forecast's snapshot of today).
  const { data, isLoading } = useGetImsForecastQuery({ skuId, days: 30 });
  const sku = data?.data?.sku;
  const m = data?.data?.metrics || {};

  return (
    <ImsShell
      icon={Boxes}
      title={sku?.skuName || 'Item'}
      subtitle={sku ? `${sku.skuCode}${sku.category ? ` · ${sku.category}` : ''}${sku.unit ? ` · counted in ${sku.unit}` : ''}` : 'Loading item…'}
      onBack={() => navigate('/ims/stock')}
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
        <ItemHistoryView skuId={skuId} useLedger={useGetImsItemLedgerQuery}
          unit={sku.unit || ''} onHand={m.onHand} status={m.status} />
      )}
      <PolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </ImsShell>
  );
};

export default ImsItemDetail;
