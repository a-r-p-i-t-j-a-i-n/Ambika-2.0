// ── Side panels: one indent (from the table / Quick Overview) and one day's
//    expected PO deliveries. The O2D Dashboard drawers' look (o2d-dashboard/
//    components/Drawers.jsx), on Purchase data. ──
import React from 'react';
import { Box, Button, Drawer, IconButton, Typography } from '@mui/material';
import { ExternalLink, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { startOfDay } from '../o2d-dashboard/dashboardModel';
import { T } from '../o2d-dashboard/dashTheme';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../o2d-dashboard/format';
import { ToneChip } from '../o2d-dashboard/components/DashUi';

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

const STEP_CHIP = {
  DONE: ['ok', 'Done'],
  IN_PROGRESS: ['info', 'In progress'],
  OVERDUE: ['danger', 'Overdue'],
  PENDING: ['neutral', 'Waiting'],
};

export const IndentDrawer = ({ row, onClose }) => {
  const navigate = useNavigate();
  const balance = row ? Math.max(0, row.orderedQty - row.receivedQty) : 0;
  const pct = row?.orderedQty ? Math.round((row.receivedQty / row.orderedQty) * 100) : 0;
  const hasPo = !!row?.poNumbers.length;
  return (
    <Panel
      open={!!row}
      onClose={onClose}
      title={row ? row.indentNumber : ''}
      subtitle={row ? `${row.vendorName !== '—' ? row.vendorName : (row.department || 'No PO yet')} · raised ${fmtDate(row.receivedAt)}` : ''}
      footer={row ? (
        <Button
          variant="contained"
          startIcon={<ExternalLink size={15} />}
          onClick={() => navigate(`/procurement/indents/${row.id}`)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', bgcolor: T.brand }}
        >
          Open indent
        </Button>
      ) : null}
    >
      {row && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
            <MiniKpi label="Ordered" value={fmtNum(row.orderedQty)} sub={hasPo ? 'Units on POs' : 'Units on indent'} />
            <MiniKpi label="Received" value={fmtNum(row.receivedQty)} sub={`${pct}% done`} color="#22a06b" />
            <MiniKpi label="Balance" value={fmtNum(balance)} sub="Still to receive" color={balance ? '#f08a24' : '#22a06b'} />
            <MiniKpi label="Value" value={fmtMoney(row.value)} sub={hasPo ? 'PO value' : 'No PO yet'} />
          </Box>

          {row.current && (
            <Box sx={{ ...lineSx, mt: 1.5, gridTemplateColumns: 'minmax(0,1fr) auto', bgcolor: row.group === 'OVERDUE' ? '#fdf2f4' : '#f1f6ff' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, color: T.text2, fontWeight: 600 }}>Now at</Typography>
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {row.current.code} {row.current.name}{row.current.ref && row.current.ref !== row.indentNumber ? ` · ${row.current.ref}` : ''}
                </Typography>
                <Typography sx={{ fontSize: 11, color: T.muted }}>
                  {row.current.ownerName || 'No doer'}{row.current.plannedAt ? ` · planned ${fmtDateTime(row.current.plannedAt)}` : ''}
                </Typography>
              </Box>
              {row.group === 'OVERDUE' ? <ToneChip tone="danger">Delayed</ToneChip> : <ToneChip tone="info">In progress</ToneChip>}
            </Box>
          )}
          {row.group === 'OVERDUE' && (row.late.delivery || row.late.followUp) && (
            <Typography sx={{ fontSize: 11.5, color: '#c02626', mt: 0.75 }}>
              {[row.late.delivery && 'A released PO is past its expected delivery date.', row.late.followUp && 'A follow-up is past its planned date.']
                .filter(Boolean).join(' ')}
            </Typography>
          )}

          <Heading>Items</Heading>
          {row.items.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {row.items.map((it, i) => (
                <Box key={`${it.sku}-${i}`} sx={lineSx}>
                  <Code>{it.poNumber || it.sku || '—'}</Code>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{it.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: T.muted }}>{hasPo ? `${fmtNum(it.received)} received` : 'Not on a PO yet'}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: T.text2, whiteSpace: 'nowrap' }}>
                    {fmtNum(it.qty)} {it.unit}{it.rate ? ` × ₹${fmtNum(it.rate)}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : <Typography sx={{ fontSize: 13, color: T.muted }}>No items yet.</Typography>}

          <Heading>Steps</Heading>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {row.steps.map((s) => {
              const [tone, text] = STEP_CHIP[s.status];
              return (
                <Box key={s.code} sx={lineSx}>
                  <Code>{s.code}</Code>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13, color: T.text }}>{s.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: T.muted }}>
                      {s.status === 'DONE' ? 'Done'
                        : s.status === 'PENDING' ? 'Not reached yet'
                          : `${s.ownerName || 'No doer'}${s.plannedAt ? ` · planned ${fmtDateTime(s.plannedAt)}` : ''}`}
                    </Typography>
                  </Box>
                  <ToneChip tone={tone}>{text}</ToneChip>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Panel>
  );
};

/** One calendar day: the released POs expected that day and what is still to come. */
export const DeliveryDayDrawer = ({ day, items, now, onOpenIndent, onClose }) => (
  <Panel
    open={day != null}
    onClose={onClose}
    title={day != null ? `Delivery plan · ${fmtDate(day)}` : ''}
    subtitle={`${items.length} ${items.length === 1 ? 'purchase order' : 'purchase orders'} expected`}
  >
    {!items.length && <Typography sx={{ fontSize: 13, color: T.muted }}>No deliveries expected on this day.</Typography>}
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map(({ row, po }) => {
        const late = day != null && day < startOfDay(now) && po.pending > 0;
        return (
          <Box
            key={`${row.id}-${po.poId}`}
            onClick={() => onOpenIndent(row)}
            sx={{ bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '10px', px: 1.25, py: 1, cursor: 'pointer', '&:hover': { bgcolor: T.surface2 } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: T.text }}>{po.vendor}</Typography>
                <Typography noWrap sx={{ fontSize: 11, color: T.muted }}>{po.poNumber} · {row.indentNumber}</Typography>
              </Box>
              {late ? <ToneChip tone="danger">Past due</ToneChip> : <ToneChip tone="info">Expected</ToneChip>}
            </Box>
            <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {po.items.map((it, i) => (
                <Box key={`${it.sku}-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 12.5, color: T.text2 }}>
                  <Typography noWrap sx={{ fontSize: 12.5, color: T.text2, minWidth: 0 }}>{it.name}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: T.text, whiteSpace: 'nowrap' }}>{fmtNum(it.qty)} {it.unit}</Typography>
                </Box>
              ))}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px dashed ${T.border}`, mt: 0.5, pt: 0.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: T.text2, letterSpacing: '0.04em' }}>STILL TO RECEIVE</Typography>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{fmtNum(po.pending)}</Typography>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  </Panel>
);

/** Item Delivery Calendar: one day's PO lines — scheduled (blue) or delivered (green). */
export const ItemDayDrawer = ({ day, title, events, indentsById, onOpenIndent, onClose }) => (
  <Panel
    open={day != null}
    onClose={onClose}
    title={title}
    subtitle={`${events.length} ${events.length === 1 ? 'item' : 'items'} · ${events.filter((e) => e.status === 'SCHEDULED').length} scheduled · ${events.filter((e) => e.status === 'DELIVERED').length} delivered`}
  >
    {!events.length && <Typography sx={{ fontSize: 13, color: T.muted }}>Nothing scheduled or delivered on this day for these filters.</Typography>}
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {events.map((e) => {
        const indent = e.indentIds.map((id) => indentsById.get(id)).find(Boolean);
        return (
          <Box
            key={e.key}
            data-status={e.status}
            onClick={indent ? () => onOpenIndent(indent) : undefined}
            sx={{ ...lineSx, gridTemplateColumns: 'minmax(0,1fr) auto', cursor: indent ? 'pointer' : 'default', '&:hover': indent ? { bgcolor: T.surface2 } : {} }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: e.status === 'DELIVERED' ? '#0f7a2f' : '#1d5fc4' }}>{e.item}</Typography>
              <Typography noWrap sx={{ fontSize: 11, color: T.muted }}>
                {e.vendor} · {e.poNumber}{indent ? ` · ${indent.indentNumber}` : ''}
              </Typography>
              <Typography sx={{ fontSize: 11, color: T.text2 }}>
                {e.status === 'DELIVERED' ? `${fmtNum(e.qty)} ${e.unit} received` : `${fmtNum(e.qty)} ${e.unit} still to receive (of ${fmtNum(e.ordered)})`}
              </Typography>
            </Box>
            {e.status === 'DELIVERED' ? <ToneChip tone="ok">Delivered</ToneChip> : <ToneChip tone="info">Scheduled</ToneChip>}
          </Box>
        );
      })}
    </Box>
  </Panel>
);
