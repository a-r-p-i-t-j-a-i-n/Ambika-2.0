import React from 'react';
import { Button, Box } from '@mui/material';
import { ShieldCheck } from 'lucide-react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useGetMdApprovalsQuery } from '../../../store/api/procurementApi';
import { isMdUser } from './mdApprovalMeta';

/**
 * "MD Approval" entry point for the Purchase FMS header — rendered for MD users
 * only (nothing at all for anyone else), with the count still awaiting the MD.
 */
const MdApprovalButton = () => {
  const navigate = useNavigate();
  const isMd = useSelector((s) => isMdUser(s.auth.user));
  const { data } = useGetMdApprovalsQuery({ limit: 1 }, { skip: !isMd });
  if (!isMd) return null;
  const pending = data?.data?.summary?.pending || 0;

  return (
    <Button
      variant="outlined"
      color="warning"
      data-testid="pfms-md-approval"
      startIcon={<ShieldCheck size={16} />}
      onClick={() => navigate('/purchase-fms/md-approvals')}
      sx={{ fontWeight: 700, px: 2, py: 1, borderRadius: '8px', whiteSpace: 'nowrap', bgcolor: 'background.paper' }}
    >
      MD Approval
      {pending > 0 && (
        <Box
          component="span"
          aria-label={`${pending} pending`}
          sx={{
            ml: 1, px: 0.75, minWidth: 20, height: 20, borderRadius: '10px', display: 'inline-grid', placeItems: 'center',
            bgcolor: 'warning.main', color: '#fff', fontSize: '0.7rem', fontWeight: 800, lineHeight: 1,
          }}
        >
          {pending}
        </Box>
      )}
    </Button>
  );
};

export default MdApprovalButton;
