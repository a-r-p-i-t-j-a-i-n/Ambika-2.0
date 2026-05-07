import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch } from '../../hooks/DispatchContext';
import { Box, Typography, Card, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, IconButton } from '@mui/material';
import { ArrowLeft, Send } from 'lucide-react';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';

export default function OrderDetailTimeline() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { state, getTimelineForOrder, submitExecution } = useDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const timeline = getTimelineForOrder(orderId);
  const order = state.orders.find(o => o.id === orderId);
  const [open, setOpen] = useState(false);
  const [activePlan, setActivePlan] = useState(null);
  const [actualQty, setActualQty] = useState('');
  const [reference, setReference] = useState('');
  const [execDate, setExecDate] = useState(dayjs().format('YYYY-MM-DD'));

  if (!order) return <Typography>Order not found</Typography>;

  const handleOpen = (plan) => {
    setActivePlan(plan);
    setActualQty(plan.expectedTotal.toString());
    setReference('');
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!reference) { enqueueSnackbar('Reference number required', { variant: 'error' }); return; }
    const qty = Number(actualQty);
    if (isNaN(qty) || qty < 0) { enqueueSnackbar('Invalid quantity', { variant: 'error' }); return; }
    submitExecution(activePlan.id, qty, execDate, reference);
    enqueueSnackbar('Execution logged', { variant: 'success' });
    setOpen(false);
  };

  return (
    <Box>
      <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/dispatch-execution')} sx={{ mb: 2 }}>Back to Orders</Button>
      <Typography variant="h4" fontWeight={800}>{order.id} - {order.customer}</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>Commitment: {order.totalQty.toLocaleString()} units</Typography>

      <Card>
        <TableContainer>
          <Table>
            <TableHead sx={{ bgcolor: 'background.default' }}>
              <TableRow>
                <TableCell>Schedule</TableCell><TableCell>Plan</TableCell><TableCell>Rollover</TableCell><TableCell>Target</TableCell><TableCell>Actual</TableCell><TableCell>Variance</TableCell><TableCell>Ref #</TableCell><TableCell>Status</TableCell><TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {timeline.map((row, idx) => (
                <TableRow key={row.id}>
                  <TableCell>{dayjs(row.date).format('DD MMM YYYY')}</TableCell>
                  <TableCell>{row.plannedQty.toLocaleString()}</TableCell>
                  <TableCell>{row.inheritedCarry > 0 ? `+${row.inheritedCarry.toLocaleString()}` : '-'}</TableCell>
                  <TableCell><strong>{row.expectedTotal.toLocaleString()}</strong></TableCell>
                  <TableCell>{row.actualQty > 0 ? row.actualQty.toLocaleString() : '-'}</TableCell>
                  <TableCell>{row.resultCarryForward > 0 ? `-${row.resultCarryForward.toLocaleString()}` : '-'}</TableCell>
                  <TableCell>{row.referenceNumber || '-'}</TableCell>
                  <TableCell><Chip label={row.status} color={row.statusColor} size="small" /></TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" disabled={row.actualQty > 0 || (idx > 0 && timeline[idx-1].actualQty === 0)} onClick={() => handleOpen(row)}>Enter Log</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record Dispatch</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Reference Number" required value={reference} onChange={(e) => setReference(e.target.value)} fullWidth />
            <TextField label="Actual Quantity" type="number" value={actualQty} onChange={(e) => setActualQty(e.target.value)} fullWidth />
            <TextField label="Dispatch Date" type="date" value={execDate} onChange={(e) => setExecDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained">Save Log</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}