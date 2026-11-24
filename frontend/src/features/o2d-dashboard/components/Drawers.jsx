// ── Side panels: one order (from the table / Quick Overview) and one day's dispatch plan ──
import React from 'react';
import { Box, Button, CircularProgress, Drawer, IconButton, Typography } from '@mui/material';
import { ExternalLink, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessByIdQuery } from '../../../store/api/o2dFmsApi';
import { clock } from '../dashboardModel';
import { T } from '../dashTheme';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../format';
import { ToneChip } from './DashUi';

const Panel = ({ open, onClose, title, subtitle, children, footer }) => (
  <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, bgcolor: T.page } }}>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 2.5, py: 2, bgcolor: '#fff', borderBottom: `1px solid ${T.border}` }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 800, color: T.heading }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: 12.5, color: T.text2, mt: 0.25 }}>{subtitle}</Typography>}
      </Box>
      <IconButton size="small" onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
    </Box>
    <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>{children}</Box>
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2.5, py: 1.5, bgcolor: '#fff', borderTop: `1px solid ${T.border}` }}>
      {footer}
      <Button onClick={onClose} variant="outlined" sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}>Close</Button>
    </Box>
  </Drawer>
);

const MiniKpi = ({ label, value, sub, color }) => (
  <Box sx={{ bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '10px', px: 1.25, py: 1 }}>
    <Typography sx={{ fontSize: 11, color: T.text2, fontWeight: 600 }}>{label}</Typography>
    <Typography sx={{ fontSize: String(value).length > 10 ? 15 : 18, fontWeight: 800, color: color || T.text, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
      {value}
    </Typography>
    <Typography sx={{ fontSize: 10.5, color: T.muted }}>{sub}</Typography>
  </Box>
);

const lineSx = {
  display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) auto', gap: 1.25, alignItems: 'center',
  px: 1.25, py: 1, borderRadius: '10px', bgcolor: '#fff', border: `1px solid ${T.border}`, fontSize: 13,
};
const Heading = ({ children }) => (
  <Typography sx={{ fontSize: 13, fontWeight: 700, color: T.text, mt: 2, mb: 1 }}>{children}</Typography>
);
const Code = ({ children }) => (
  <Box component="code" sx={{ fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: T.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
    {children}
  </Box>
);

const stepChip = (s, now) => {
  if (s.status === 'DONE') return <ToneChip tone="ok">Done</ToneChip>;
  if (s.status === 'DELAYED') return <ToneChip tone="warn">Done late</ToneChip>;
  if (s.status === 'SKIPPED') return <ToneChip tone="neutral">Skipped</ToneChip>;
  const late = s.planned && new Date(s.planned).getTime() < now;
  if (s.status === 'IN_PROGRESS' || s.startedAt) {
    return late ? <ToneChip tone="danger">Overdue</ToneChip> : <ToneChip tone="info">In progress</ToneChip>;
  }
  return <ToneChip tone="neutral">Waiting</ToneChip>;
};

const OrderSteps = ({ processId }) => {
  const { data, isFetching, isError } = useGetProcessByIdQuery(processId, { skip: !processId });
  if (!processId) return <Typography sx={{ fontSize: 13, color: T.muted }}>This order has no O2D steps.</Typography>;
  if (isFetching && !data) return <CircularProgress size={20} />;
  if (isError || !data?.data) return <Typography sx={{ fontSize: 13, color: T.muted }}>The steps could not be loaded right now.</Typography>;
  const now = clock();
  const steps = [...(data.data.steps || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {steps.map((s) => (
        <Box key={s._id || s.stepCode} sx={lineSx}>
          <Code>{s.stepCode}</Code>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{s.name || s.stepCode}</Typography>
            <Typography sx={{ fontSize: 11, color: T.muted }}>
              {s.actual ? `Done ${fmtDateTime(s.actual)}` : s.planned ? `Planned ${fmtDateTime(s.planned)}` : 'Not reached yet'}
            </Typography>
          </Box>
          {stepChip(s, now)}
        </Box>
      ))}
    </Box>
  );
};

export const OrderDrawer = ({ row, onClose }) => {
  const navigate = useNavigate();
  const balance = row ? Math.max(0, row.orderedQty - row.dispatchedQty) : 0;
  const fulfil = row?.orderedQty ? Math.round((row.dispatchedQty / row.orderedQty) * 100) : 0;
  return (
    <Panel
      open={!!row}
      onClose={onClose}
      title={row ? row.soNumber || 'Order (not yet a sales order)' : ''}
      subtitle={row ? `${row.partyName} · received ${fmtDate(row.receivedAt)}` : ''}
      footer={row?.processId ? (
        <Button
          variant="contained"
          startIcon={<ExternalLink size={15} />}
          onClick={() => navigate(`/o2d-fms/process/${row.processId}`)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', bgcolor: T.brand }}
        >
          Open O2D process
        </Button>
      ) : null}
    >
      {row && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
            <MiniKpi label="Ordered" value={fmtNum(row.orderedQty)} sub="Units" />
            <MiniKpi label="Dispatched" value={fmtNum(row.dispatchedQty)} sub={`${fulfil}% done`} color="#22a06b" />
            <MiniKpi label="Balance" value={fmtNum(balance)} sub="Still to ship" color={balance ? '#f08a24' : '#22a06b'} />
            <MiniKpi label="Value" value={fmtMoney(row.value)} sub="Order value" />
          </Box>

          {row.current && (
            <Box sx={{ ...lineSx, mt: 1.5, gridTemplateColumns: 'minmax(0,1fr) auto', bgcolor: row.group === 'OVERDUE' ? '#fdf2f4' : '#f1f6ff' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, color: T.text2, fontWeight: 600 }}>Now at</Typography>
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {row.current.code} {row.current.name}{row.current.dcNumber ? ` · ${row.current.dcNumber}` : ''}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.muted }}>
                  {row.current.ownerName || 'No doer'}{row.current.plannedAt ? ` · planned ${fmtDateTime(row.current.plannedAt)}` : ''}
                </Typography>
              </Box>
              {row.group === 'OVERDUE' ? <ToneChip tone="danger">Delayed</ToneChip> : <ToneChip tone="info">In progress</ToneChip>}
            </Box>
          )}

          <Heading>Items</Heading>
          {row.items.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {row.items.map((it, i) => (
                <Box key={`${it.sku}-${i}`} sx={lineSx}>
                  <Code>{it.sku || '—'}</Code>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{it.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: T.muted }}>{fmtNum(it.dispatched)} dispatched</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: T.text2, whiteSpace: 'nowrap' }}>{fmtNum(it.qty)} × ₹{fmtNum(it.rate)}</Typography>
                </Box>
              ))}
            </Box>
          ) : <Typography sx={{ fontSize: 13, color: T.muted }}>No items yet.</Typography>}

          <Heading>Steps</Heading>
          <OrderSteps processId={row.processId} />
        </>
      )}
    </Panel>
  );
};

/** My view: the tasks due (or done) on one calendar day; a click opens the task. */
export const DayTasksDrawer = ({ day, tasks, stateOf, onOpenTask, onClose }) => (
  <Panel
    open={day != null}
    onClose={onClose}
    title={day != null ? `My tasks · ${fmtDate(day)}` : ''}
    subtitle={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
  >
    {!tasks.length && <Typography sx={{ fontSize: 13, color: T.muted }}>No tasks on this day.</Typography>}
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {tasks.map((t) => {
        const st = stateOf(t);
        return (
          <Box
            key={t.key}
            onClick={() => onOpenTask(t)}
            sx={{ ...lineSx, gridTemplateColumns: '60px minmax(0,1fr) auto', cursor: t.stepPath ? 'pointer' : 'default', '&:hover': { bgcolor: T.surface2 } }}
          >
            <Code>{t.stepCode}</Code>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{t.partyName || '—'} · {t.soNumber || 'Intake'}</Typography>
              <Typography noWrap sx={{ fontSize: 11, color: T.muted }}>
                {t.stepName}{t.dcNumber ? ` · ${t.dcNumber}` : ''}
              </Typography>
            </Box>
            {st.chip}
          </Box>
        );
      })}
    </Box>
  </Panel>
);
