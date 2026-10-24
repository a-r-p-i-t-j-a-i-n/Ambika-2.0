import React from 'react';
import { Stack, Skeleton } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { RmShell, StatusChip, KindChip, uomOf } from './rmImsMeta';
import ItemHistoryView from '../ims/ItemHistoryView';
import { useGetRmItemDetailQuery, useGetRmMovementsQuery } from '../../store/api/rmImsApi';

/**
 * ONE RAW MATERIAL ITEM — opened from the eye on Stock & Master Data: four
 * cards and its history, one row per entry (ItemHistoryView, shared with
 * Consumables & Packaging and Finished Goods).
 */
const RmImsItemDetail = () => {
  const { skuId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useGetRmItemDetailQuery(skuId);
  const d = data?.data;
  const sku = d?.sku;
  const m = d?.metrics || {};

  if (isLoading || !d) {
    return (
      <RmShell icon={Layers} title="Item" subtitle="Loading item…" onBack={() => navigate('/rm-ims/stock')} backLabel="Back to the stock list">
        <Skeleton variant="rounded" height={340} />
      </RmShell>
    );
  }

  const unit = uomOf({ unit: sku.unit, kind: sku.kind });
  return (
    <RmShell
      icon={Layers}
      title={sku.skuName}
      subtitle={`${sku.skuCode} · ${sku.kind === 'CIRCLE' ? 'Circle' : 'Coil'} · counted in ${unit}`}
      onBack={() => navigate('/rm-ims/stock')}
      backLabel="Back to the stock list"
      actions={<Stack direction="row" spacing={0.75} alignItems="center"><KindChip kind={sku.kind} /><StatusChip status={m.status} /></Stack>}
    >
      {/* RM movements, narrowed to this item, answer the same shape as a ledger. */}
      <ItemHistoryView skuId={skuId} useLedger={useGetRmMovementsQuery}
        unit={unit} onHand={m.onHand} status={m.status} places={d.locations || []} />
    </RmShell>
  );
};

export default RmImsItemDetail;
