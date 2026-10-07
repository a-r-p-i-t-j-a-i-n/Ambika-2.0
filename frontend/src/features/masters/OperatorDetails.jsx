/**
 * Master Data → Machine Operators → one operator.
 *
 * The mirror of MachineDetails: the operator's own fields on the left, the
 * machines they run on the right. Unassigning a machine here breaks only the
 * link — the machine master is untouched.
 */
import React, { useState } from 'react';
import {
  Box, Button, CircularProgress, Grid, IconButton, Paper, Stack, Typography,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Cpu, HardHat, Pencil } from 'lucide-react';
import { useSnackbar } from 'notistack';
import useSmartBack from '../../hooks/useSmartBack';
import {
  useGetMachineOperatorQuery,
  useAssignMachineToOperatorMutation,
  useUnassignMachineFromOperatorMutation,
} from '../../store/api/machineOperatorApi';
import { useGetMachineLookupQuery } from '../../store/api/machineApi';
import {
  O2D, BRAND, BRAND_DK, NAVY, Pill, Help, pageSx, panelSx, btnSx,
} from './components/masterUi';
import AssignmentPanel from './components/AssignmentPanel';
import OperatorFormDrawer from './OperatorFormDrawer';
import {
  MACHINE_STATUS_META, machineTypeMeta, operatorStatusMeta, OPERATOR_FIELD_HELP as HELP,
} from './machineMeta';

const labelSx = {
  fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em',
  textTransform: 'uppercase', color: O2D.sub,
};

const Field = ({ label, hint, children }) => (
  <Box>
    <Typography sx={labelSx}>{label}<Help text={hint} /></Typography>
    <Box sx={{ mt: 0.3 }}>{children}</Box>
  </Box>
);

const Text = ({ children }) => (
  <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>
    {children || <span style={{ color: O2D.faint, fontWeight: 500 }}>—</span>}
  </Typography>
);

const OperatorDetails = () => {
  const { id } = useParams();
  const goBack = useSmartBack('/machine-operators');
  const { enqueueSnackbar } = useSnackbar();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading } = useGetMachineOperatorQuery(id);
  const operator = data?.data;

  // includeInactive so a retired machine already assigned can still be managed.
  const { data: machineLookup } = useGetMachineLookupQuery({ limit: 2000, includeInactive: 'true' });
  const [assignMachine, { isLoading: isAssigning }] = useAssignMachineToOperatorMutation();
  const [unassignMachine, { isLoading: isUnassigning }] = useUnassignMachineFromOperatorMutation();
  const busy = isAssigning || isUnassigning;

  const handleAdd = async (machineIds) => {
    for (const machineId of machineIds) {
      try {
        await assignMachine({ id, machineId }).unwrap();
      } catch (err) {
        enqueueSnackbar(err?.data?.message || 'Unable to assign machine', { variant: 'error' });
        return;
      }
    }
    enqueueSnackbar(machineIds.length > 1 ? 'Machines assigned' : 'Machine assigned', { variant: 'success' });
  };

  const handleRemove = async (machineId) => {
    try {
      await unassignMachine({ id, machineId }).unwrap();
      enqueueSnackbar('Machine unassigned — the machine master is unchanged', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to unassign machine', { variant: 'error' });
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ ...pageSx, alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={26} />
      </Box>
    );
  }

  if (!operator) {
    return (
      <Box sx={pageSx}>
        <Typography sx={{ fontWeight: 800, color: NAVY }}>Operator not found.</Typography>
        <Button onClick={goBack} sx={{ ...btnSx, alignSelf: 'flex-start' }}>Back to Machine Operators</Button>
      </Box>
    );
  }

  const status = operatorStatusMeta(operator.isActive);

  return (
    <Box sx={pageSx}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, gap: 1.5 }}>
        <IconButton
          onClick={goBack}
          sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: O2D.surface, border: `1px solid ${O2D.line}` }}
        >
          <ArrowLeft size={17} />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.3rem' }, fontWeight: 800, color: NAVY, letterSpacing: '-0.02em' }}>
              {operator.name}
            </Typography>
            <Pill color={status.color}>{status.label}</Pill>
          </Stack>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.sub, mt: 0.3 }}>
            {operator.department || 'No department'}
            {operator.code ? ` · ${operator.code}` : ''}
            {operator.shift ? ` · ${operator.shift} shift` : ''}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained" startIcon={<Pencil size={15} />} onClick={() => setEditOpen(true)}
          sx={{ ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK }, width: { xs: '100%', md: 'auto' } }}
        >
          Edit
        </Button>
      </Box>

      <Grid container spacing={1.5}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ ...panelSx, p: 2, flexGrow: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <HardHat size={16} color={BRAND_DK} />
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: BRAND_DK }}>Operator</Typography>
            </Stack>
            <Grid container spacing={1.75}>
              <Grid item xs={12}><Field label="Operator Name" hint={HELP.name}><Text>{operator.name}</Text></Field></Grid>
              <Grid item xs={6}><Field label="Code" hint={HELP.code}><Text>{operator.code}</Text></Field></Grid>
              <Grid item xs={6}><Field label="Shift" hint={HELP.shift}><Text>{operator.shift}</Text></Field></Grid>
              <Grid item xs={12}>
                <Field label="Department" hint={HELP.department}>
                  <Text>{operator.department}</Text>
                  {/* Three operators legitimately appear under two departments in the source. */}
                  {operator.departments?.length > 1 ? (
                    <Typography sx={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 600, mt: 0.3 }}>
                      Also recorded under: {operator.departments.filter((d) => d !== operator.department).join(', ')}
                    </Typography>
                  ) : null}
                </Field>
              </Grid>
              <Grid item xs={6}>
                <Field label="Status" hint={HELP.isActive}><Pill color={status.color}>{status.label}</Pill></Field>
              </Grid>
              <Grid item xs={6}>
                <Field label="Machines Run" hint={HELP.machineCount}><Text>{operator.machineCount ?? 0}</Text></Field>
              </Grid>
              {operator.remarks ? (
                <Grid item xs={12}><Field label="Remarks" hint={HELP.remarks}><Text>{operator.remarks}</Text></Field></Grid>
              ) : null}
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <AssignmentPanel
            title="Assigned Machines"
            titleHint={HELP.machines}
            subtitle="An operator can run many machines"
            icon={Cpu}
            assigned={operator.machines || []}
            options={machineLookup?.data || []}
            getPrimary={(m) => `${m.code} — ${m.name}`}
            getSecondary={(m) => {
              const st = MACHINE_STATUS_META[m.machineStatus];
              const type = machineTypeMeta(m.machineType).short;
              return [type, m.department, st && st.label !== 'In use' ? st.label : null].filter(Boolean).join(' · ');
            }}
            onAdd={handleAdd}
            onRemove={handleRemove}
            addLabel="Add Machine"
            pickerLabel="Search machines to assign"
            emptyHint="This operator is not assigned to any machine yet."
            busy={busy}
          />
        </Grid>
      </Grid>

      <OperatorFormDrawer open={editOpen} onClose={() => setEditOpen(false)} operator={operator} />
    </Box>
  );
};

export default OperatorDetails;
