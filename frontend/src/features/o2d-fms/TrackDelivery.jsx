import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Paper, Stack, Typography, Autocomplete, TextField, Button, MenuItem, Chip, CircularProgress, Divider,
} from '@mui/material';
import { Truck, Save } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useSearchParams } from 'react-router-dom';
import O2dStepShell from './components/O2dStepShell';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useTrackDeliveryMutation } from '../../store/api/o2dFulfillmentApi';
import { useReturnToTask } from './useReturnToTask';
import { useFmsGate } from './FmsGate';

/** Step 2.9 — Track delivery: pick a challan, update delivery status & dates. */
const TrackDelivery = () => {
  const { data: challansRes } = useGetChallansQuery({ limit: 300, sort: '-dcDate' });
  const challans = useMemo(() => challansRes?.data || [], [challansRes]);
  const [track, { isLoading }] = useTrackDeliveryMutation();
  const { finishToTask } = useReturnToTask();
  const [searchParams] = useSearchParams();
  const soParam = searchParams.get('so') || '';

  const dcParam = searchParams.get('dc') || '';
  const [dc, setDc] = useState(null);
  const gate = useFmsGate({ soNumber: dc?.soNumber || soParam, action: 'TRACK_DELIVERY' });

  // Came from a "Do it now" / consignment card → auto-select the challan: exact DC
  // (?dc) first, else the order's latest challan (?so).
  // Keyed on the so/dc TARGET, not a "already picked" flag: this route stays mounted
  // when only the query string changes, so guarding on `dc` would keep showing the
  // first consignment when the user opens a later one (?dc=DC-071 → ?dc=DC-073).
  const presetRef = useRef('');
  useEffect(() => {
    const target = `${dcParam}|${soParam}`;
    if (!dcParam && !soParam) return;
    if (presetRef.current === target || !challans.length) return;
    const match = (dcParam && challans.find((c) => c.dcNumber === dcParam))
      || (soParam && challans.find((c) => c.soNumber === soParam));
    if (match) { presetRef.current = target; setDc(match); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soParam, dcParam, challans]);
  const [status, setStatus] = useState('Delivered');
  const [deliveryDate, setDeliveryDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [newTrackDate, setNewTrackDate] = useState('');

  const save = async () => {
    if (!dc) return enqueueSnackbar('Select a delivery challan first.', { variant: 'warning' });
    try {
      await track({
        dcId: dc._id,
        status,
        deliveryDate: status === 'Delivered' ? deliveryDate : undefined,
        newTrackDate: status === 'Not Delivered' ? (newTrackDate || undefined) : undefined,
      }).unwrap();
      enqueueSnackbar(`Delivery for ${dc.dcNumber} updated.`, { variant: 'success' });
      setTimeout(() => finishToTask({ soNumber: dc.soNumber, action: 'TRACK_DELIVERY' }), 600);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not update delivery.', { variant: 'error' });
    }
  };

  return (
    <O2dStepShell icon={Truck} step="Step 2.9" title="Track Delivery" subtitle="Update the delivery status of a dispatch." gate={gate}>
      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Autocomplete
          options={challans}
          value={dc}
          onChange={(_, v) => setDc(v)}
          getOptionLabel={(o) => (o ? `${o.dcNumber} — ${o.partyName} (SO ${o.soNumber || '—'})` : '')}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          renderInput={(p) => <TextField {...p} label="Unique ID / Delivery Challan" placeholder="Search DC / SO / party…" size="small" />}
        />
        {dc && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={`Party: ${dc.partyName || '—'}`} />
            <Chip size="small" label={`Qty: ${dc.totalQuantityPcs ?? '—'} pcs`} />
            <Chip size="small" label={`Current: ${dc.deliveryStatus || dc.status}`} />
          </Stack>
        )}
      </Paper>

      {dc && (
        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack spacing={2}>
            <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} size="small" sx={{ maxWidth: 240 }}>
              <MenuItem value="Delivered">Delivered</MenuItem>
              <MenuItem value="Not Delivered">Not Delivered</MenuItem>
              <MenuItem value="Cancelled">Cancelled</MenuItem>
            </TextField>
            {status === 'Delivered' && (
              <TextField label="Delivery Date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} sx={{ maxWidth: 240 }} />
            )}
            {status === 'Not Delivered' && (
              <TextField label="New Date to Track" type="date" value={newTrackDate} onChange={(e) => setNewTrackDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} sx={{ maxWidth: 240 }} />
            )}
            <Divider />
            <Stack direction="row" justifyContent="flex-end">
              <Button variant="contained" startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={isLoading || gate.blocked} onClick={save} sx={{ fontWeight: 700, px: 3 }}>
                {isLoading ? 'Saving…' : 'Update Delivery'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
    </O2dStepShell>
  );
};

export default TrackDelivery;
