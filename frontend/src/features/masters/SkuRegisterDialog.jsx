import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PackagePlus } from 'lucide-react';
import { PRIMARY_TYPE_OPTIONS } from './itemTypeMeta';
import SkuDialogShell from './SkuDialogShell';
import SkuForm from './SkuForm';

/**
 * Register SKU — a large centered dialog over the SKU Master (route
 * /skus/new, a child of /skus, so the list stays mounted beneath it). Same
 * fields, checks and save call as Edit SKU (SkuForm). `?type=` pre-selects the
 * Item Type of the SKU Master tab the user came from (incl. OTHER).
 */
const SkuRegisterDialog = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('type');
  const defaultType = PRIMARY_TYPE_OPTIONS.some((o) => o.value === requested) ? requested : 'FINISHED_GOOD';
  const close = () => navigate('/skus');

  return (
    <SkuDialogShell
      onClose={close}
      testId="sku-register-dialog"
      icon={PackagePlus}
      title="Register New SKU"
      subtitle="Pick the type, enter a code & name · Validation enforced"
    >
      <SkuForm active sku={null} defaultType={defaultType} onDone={close} onCancel={close} />
    </SkuDialogShell>
  );
};

export default SkuRegisterDialog;
