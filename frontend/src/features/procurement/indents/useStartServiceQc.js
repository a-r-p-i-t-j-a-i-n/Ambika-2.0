import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { useCreateIncomingQcMutation } from '../../../store/api/procurementApi';

// Internal-service indents awaiting the service QC. SERVICE_COMPLETED is the
// legacy state from the retired Service Completion step (1.8A).
export const SERVICE_QC_READY = ['SERVICE_PENDING', 'SERVICE_COMPLETED'];
export const canStartServiceQc = (indent) =>
  indent?.requestType === 'INTERNAL_SERVICE' && SERVICE_QC_READY.includes(indent?.overallStatus);

/**
 * Start the Incoming QC (Step 1.9) for an approved internal-service indent and
 * open it — the QC records the completion evidence and the Pass / Fail verdict.
 */
export const useStartServiceQc = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [createQc, { isLoading }] = useCreateIncomingQcMutation();

  const startServiceQc = async (indent) => {
    try {
      const res = await createQc({ indentId: indent._id }).unwrap();
      enqueueSnackbar('Service QC started', { variant: 'success' });
      const id = res?.data?._id;
      navigate(id ? `/procurement/incoming-qc/${id}` : '/purchase-fms/grn?view=qc');
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to start service QC', { variant: 'error' });
    }
  };

  return { startServiceQc, starting: isLoading };
};
