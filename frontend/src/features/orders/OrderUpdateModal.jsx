import React, { useState } from 'react';
import { 
  Drawer, 
  Box, 
  Typography, 
  IconButton, 
  Divider, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemIcon, 
  Button, 
  Chip,
  TextField,
  MenuItem,
  CircularProgress
} from '@mui/material';
import { X, CheckCircle2, Clock, AlertCircle, Save } from 'lucide-react';
import { useUpdateOrderMutation } from '../../store/api/orderApi';
import { useSnackbar } from 'notistack';

const WORKFLOW_STEPS = [
  { key: 'poEntry', label: 'PO Entry' },
  { key: 'inventoryCheck', label: 'Inventory Check' },
  { key: 'scheduling', label: 'PPC Scheduling' },
  { key: 'emailSchedule', label: 'Email Schedule' },
  { key: 'paymentCheck', label: 'Payment Check' },
  { key: 'ocEntry', label: 'OC Entry' },
  { key: 'productionFollowUp', label: 'Production Follow-up' },
  { key: 'loadingAdvice', label: 'Loading Advice' },
  { key: 'loadingFollowUp', label: 'Loading Follow-up' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'dispatchDetails', label: 'Dispatch Details' },
  { key: 'podFollowUp', label: 'POD Follow-up' },
  { key: 'paymentFollowUp', label: 'Payment Follow-up' },
];

const StatusIcon = ({ status }) => {
  if (status === 'DONE') return <CheckCircle2 size={20} color="#286abb" />; // Brand Blue
  if (status === 'DELAYED') return <AlertCircle size={20} color="#ef9696" />; // Brand Error
  return <Clock size={20} color="#0a0095" />; // Brand Deep Blue
};

const OrderUpdateModal = ({ open, onClose, order }) => {
  const [updateOrder, { isLoading }] = useUpdateOrderMutation();
  const { enqueueSnackbar } = useSnackbar();
  const [formData, setFormData] = useState(order || {});

  const handleStatusChange = (stepKey, newStatus) => {
    setFormData({
      ...formData,
      [stepKey]: {
        ...formData[stepKey],
        status: newStatus,
        completedAt: newStatus === 'DONE' ? new Date().toISOString() : formData[stepKey]?.completedAt
      }
    });
  };

  const handleSave = async () => {
    try {
      await updateOrder({ id: order._id, ...formData }).unwrap();
      enqueueSnackbar('Order updated successfully', { variant: 'success' });
      onClose();
    } catch (error) {
      enqueueSnackbar('Failed to update order', { variant: 'error' });
    }
  };

  if (!order) return null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      disableEnforceFocus
      PaperProps={{
        sx: { width: { xs: '100%', sm: 450 }, p: 0 }
      }}
    >
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Update Order Workflow</Typography>
          <Typography variant="caption" color="text.secondary">SO: {order.soNumber} | {order.partyName}</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <X size={20} />
        </IconButton>
      </Box>
      <Divider />

      <Box sx={{ p: 3, flexGrow: 1, overflowY: 'auto' }}>
        <List sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {WORKFLOW_STEPS.map((step) => {
            const stepData = formData[step.key] || { status: 'PENDING' };
            return (
              <ListItem 
                key={step.key}
                sx={{ 
                  borderRadius: 2, 
                  border: '1px solid #e2e8f0',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  p: 2
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <StatusIcon status={stepData.status} />
                    <Typography variant="body2" fontWeight={600}>{step.label}</Typography>
                  </Box>
                  <TextField
                    select
                    size="small"
                    value={stepData.status}
                    onChange={(e) => handleStatusChange(step.key, e.target.value)}
                    sx={{ width: 120 }}
                  >
                    <MenuItem value="PENDING">Pending</MenuItem>
                    <MenuItem value="DONE">Done</MenuItem>
                    <MenuItem value="DELAYED">Delayed</MenuItem>
                  </TextField>
                </Box>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Add remarks..."
                  value={stepData.remarks || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    [step.key]: { ...stepData, remarks: e.target.value }
                  })}
                  variant="standard"
                  InputProps={{ disableUnderline: true, sx: { fontSize: '0.8rem', color: 'text.secondary' } }}
                />
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Box sx={{ p: 3, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 2 }}>
        <Button 
          fullWidth 
          variant="outlined" 
          onClick={onClose}
          sx={{ borderRadius: 2 }}
        >
          Cancel
        </Button>
        <Button 
          fullWidth 
          variant="contained" 
          startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : <Save size={18} />}
          onClick={handleSave}
          disabled={isLoading}
          sx={{ borderRadius: 2 }}
        >
          Save Changes
        </Button>
      </Box>
    </Drawer>
  );
};

export default OrderUpdateModal;
