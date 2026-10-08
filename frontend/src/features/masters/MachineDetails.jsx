/**
 * Master Data → Machines → one machine.
 *
 * Left column: the machine's own master fields. Right column: its assigned
 * operators, where the many-to-many is edited. Removing an operator here breaks
 * only the assignment — the operator master is untouched.
 */
import React, { useState } from 'react';
import {
  Box, Button, CircularProgress, Grid, IconButton, Link as MuiLink, Paper, Stack, Typography, alpha,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Cpu, ExternalLink, Pencil, Users, Wrench } from 'lucide-react';
import { useSnackbar } from 'notistack';
import useSmartBack from '../../hooks/useSmartBack';
import {
  useGetMachineQuery,
  useAssignOperatorToMachineMutation,
  useUnassignOperatorFromMachineMutation,
} from '../../store/api/machineApi';
import { useGetMachineOperatorLookupQuery } from '../../store/api/machineOperatorApi';
import {
  O2D, BRAND, BRAND_DK, NAVY, Pill, Help, pageSx, panelSx, btnSx,
} from './components/masterUi';
import AssignmentPanel from './components/AssignmentPanel';
import MachineFormDrawer from './MachineFormDrawer';
import { MACHINE_STATUS_META, machineTypeMeta, MACHINE_FIELD_HELP as HELP } from './machineMeta';

const labelSx = {
  fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em',
  textTransform: 'uppercase', color: O2D.sub,
};
const valueSx = { fontSize: '0.86rem', fontWeight: 700, color: NAVY };

const Field = ({ label, hint, children }) => (
  <Box>
    <Typography sx={labelSx}>{label}<Help text={hint} /></Typography>
    <Box sx={{ mt: 0.3 }}>{children}</Box>
  </Box>
);

const Text = ({ children }) => (
  <Typography sx={valueSx}>{children || <span style={{ color: O2D.faint, fontWeight: 500 }}>—</span>}</Typography>
);

const SectionHeader = ({ icon: Icon, children }) => (
  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
    <Icon size={16} color={BRAND_DK} />
    <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: BRAND_DK }}>{children}</Typography>
  </Stack>
);

const MachineDetails = () => {
  const { id } = useParams();
  const goBack = useSmartBack('/machines');
  const { enqueueSnackbar } = useSnackbar();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading } = useGetMachineQuery(id);
  const machine = data?.data;

  const { data: operatorLookup } = useGetMachineOperatorLookupQuery({ limit: 2000 });
  const [assignOperator, { isLoading: isAssigning }] = useAssignOperatorToMachineMutation();
  const [unassignOperator, { isLoading: isUnassigning }] = useUnassignOperatorFromMachineMutation();
  const busy = isAssigning || isUnassigning;

  const handleAdd = async (operatorIds) => {
    for (const operatorId of operatorIds) {
      try {
        await assignOperator({ id, operatorId }).unwrap();
      } catch (err) {
        enqueueSnackbar(err?.data?.message || 'Unable to assign operator', { variant: 'error' });
        return;
      }
    }
    enqueueSnackbar(operatorIds.length > 1 ? 'Operators assigned' : 'Operator assigned', { variant: 'success' });
  };

  const handleRemove = async (operatorId) => {
    try {
      await unassignOperator({ id, operatorId }).unwrap();
      enqueueSnackbar('Operator unassigned — the operator master is unchanged', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to unassign operator', { variant: 'error' });
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ ...pageSx, alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={26} />
      </Box>
    );
  }

  if (!machine) {
    return (
      <Box sx={pageSx}>
        <Typography sx={{ fontWeight: 800, color: NAVY }}>Machine not found.</Typography>
        <Button onClick={goBack} sx={{ ...btnSx, alignSelf: 'flex-start' }}>Back to Machines</Button>
      </Box>
    );
  }

  const status = MACHINE_STATUS_META[machine.machineStatus] || MACHINE_STATUS_META.IN_USE;
  const type = machineTypeMeta(machine.machineType);

  return (
    <Box sx={pageSx}>
      {/* Header */}
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
              {machine.name}
            </Typography>
            <Pill color={status.color} title={status.meaning}>{status.label}</Pill>
            <Pill color={type.color} title={machine.machineType}>{type.short}</Pill>
          </Stack>
          <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', fontWeight: 700, color: BRAND, mt: 0.3 }}>
            {machine.uid || machine.code}
            {machine.department ? <span style={{ color: O2D.sub, fontFamily: 'inherit' }}> · {machine.department}</span> : null}
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
        {/* Master fields */}
        <Grid item xs={12} md={5}>
          <Stack spacing={1.5}>
            <Paper sx={{ ...panelSx, p: 2, flexGrow: 0 }}>
              <SectionHeader icon={Cpu}>Machine</SectionHeader>
              <Grid container spacing={1.75}>
                <Grid item xs={6}><Field label="Machine Code" hint={HELP.code}><Text>{machine.code}</Text></Field></Grid>
                <Grid item xs={6}><Field label="Machine Type" hint={HELP.machineType}><Text>{machine.machineType}</Text></Field></Grid>
                <Grid item xs={12}><Field label="Machine UID (generated)" hint={HELP.uid}><Text>{machine.uid}</Text></Field></Grid>
                <Grid item xs={6}><Field label="Department / Section" hint={HELP.department}><Text>{machine.department}</Text></Field></Grid>
                <Grid item xs={6}><Field label="Make" hint={HELP.make}><Text>{machine.make}</Text></Field></Grid>
                <Grid item xs={6}>
                  <Field label="Capacity" hint={HELP.capacity}>
                    <Text>
                      {machine.capacity}
                      {machine.capacity && !machine.capacityUnit ? (
                        <Typography component="span" sx={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600, ml: 0.5 }}>
                          (no unit in source)
                        </Typography>
                      ) : null}
                    </Text>
                  </Field>
                </Grid>
                <Grid item xs={6}><Field label="Installation Year" hint={HELP.installationYear}><Text>{machine.installationYear}</Text></Field></Grid>
                <Grid item xs={6}><Field label="Default SPM" hint={HELP.defaultSpm}><Text>{machine.defaultSpm || 0}</Text></Field></Grid>
                <Grid item xs={6}>
                  <Field label="Status" hint={HELP.machineStatus}>
                    <Pill color={status.color} title={status.meaning}>{status.label}</Pill>
                  </Field>
                </Grid>
              </Grid>
            </Paper>

            <Paper sx={{ ...panelSx, p: 2, flexGrow: 0 }}>
              <SectionHeader icon={Wrench}>Maintenance</SectionHeader>
              <Grid container spacing={1.75}>
                <Grid item xs={6}><Field label="AMC" hint={HELP.amc}><Text>{machine.amc || 'Not recorded'}</Text></Field></Grid>
                <Grid item xs={6}><Field label="Maintenance Manual" hint={HELP.maintenanceManual}><Text>{machine.maintenanceManual || 'Not recorded'}</Text></Field></Grid>
                <Grid item xs={12}><Field label="Maintenance Manual Type" hint={HELP.maintenanceManualType}><Text>{machine.maintenanceManualType}</Text></Field></Grid>
                <Grid item xs={6}>
                  <Field label="Daily CLIT Sheet" hint={HELP.dailyClitSheet}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Pill color={machine.dailyClitSheet ? '#15803d' : O2D.sub}>
                        {machine.dailyClitSheet ? 'Yes' : 'No'}
                      </Pill>
                      {machine.dailyClitLink ? (
                        <MuiLink href={machine.dailyClitLink} target="_blank" rel="noopener" sx={{ display: 'inline-flex', color: BRAND }}>
                          <ExternalLink size={14} />
                        </MuiLink>
                      ) : null}
                    </Stack>
                  </Field>
                </Grid>
                <Grid item xs={6}>
                  <Field label="Half-Yearly PM" hint={HELP.halfYearlyPm}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Pill color={machine.halfYearlyPm ? '#15803d' : O2D.sub}>
                        {machine.halfYearlyPm ? 'Yes' : 'No'}
                      </Pill>
                      {machine.halfYearlyPmLink ? (
                        <MuiLink href={machine.halfYearlyPmLink} target="_blank" rel="noopener" sx={{ display: 'inline-flex', color: BRAND }}>
                          <ExternalLink size={14} />
                        </MuiLink>
                      ) : null}
                    </Stack>
                  </Field>
                </Grid>
                {machine.remarks ? (
                  <Grid item xs={12}><Field label="Remarks" hint={HELP.remarks}><Text>{machine.remarks}</Text></Field></Grid>
                ) : null}
              </Grid>
            </Paper>
          </Stack>
        </Grid>

        {/* Assigned operators */}
        <Grid item xs={12} md={7}>
          <AssignmentPanel
            title="Assigned Operators"
            titleHint={HELP.operators}
            subtitle="A machine can have many operators"
            icon={Users}
            assigned={machine.operators || []}
            options={operatorLookup?.data || []}
            getPrimary={(o) => o.name}
            getSecondary={(o) => [o.department, o.shift].filter(Boolean).join(' · ')}
            onAdd={handleAdd}
            onRemove={handleRemove}
            addLabel="Add Operator"
            pickerLabel="Search operators to assign"
            emptyHint="No operator assigned to this machine yet."
            busy={busy}
          />
        </Grid>
      </Grid>

      <MachineFormDrawer open={editOpen} onClose={() => setEditOpen(false)} machine={machine} />
    </Box>
  );
};

export default MachineDetails;
