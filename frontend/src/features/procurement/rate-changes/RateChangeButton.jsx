import React from 'react';
import { Button, Box } from '@mui/material';
import { Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetRateChangesQuery } from '../../../store/api/procurementApi';
import { RATE_CHANGE_PATH } from './rateChangeMeta';

/**
 * "Rate Changes" entry point in the Purchase FMS header, with the number of
 * requests still pending. Shown to every Purchase FMS user (doers follow their
 * requests here); only approvers see Approve / Reject inside.
 */
const RateChangeButton = () => {
  const navigate = useNavigate();
  const { data } = useGetRateChangesQuery({ limit: 1, status: 'PENDING' });
  const pending = data?.data?.summary?.PENDING || 0;
  return (
    <Button
      variant="outlined"
      data-testid="pfms-rate-changes"
      startIcon={<Scale size={16} />}
      onClick={() => navigate(RATE_CHANGE_PATH)}
      sx={{ fontWeight: 700, px: 2, py: 1, borderRadius: '8px', whiteSpace: 'nowrap', bgcolor: 'background.paper' }}
    >
      Rate Changes
      {pending > 0 && (
        <Box component="span" aria-label={`${pending} pending`} data-testid="pfms-rate-changes-count"
          sx={{
            ml: 1, px: 0.75, minWidth: 20, height: 20, borderRadius: '10px', display: 'inline-grid', placeItems: 'center',
            bgcolor: 'warning.main', color: '#fff', fontSize: '0.7rem', fontWeight: 800, lineHeight: 1,
          }}>
          {pending}
        </Box>
      )}
    </Button>
  );
};

export default RateChangeButton;
