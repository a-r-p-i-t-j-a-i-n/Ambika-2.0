import React, { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Autocomplete, Box, Button, Checkbox, CircularProgress, Drawer, IconButton, InputAdornment, InputBase, ListItemText, Menu, MenuItem,
  Pagination, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, alpha,
} from '@mui/material';
import {
  ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Clock, Columns2, Download, ExternalLink, FileText, GitBranch,
  Mail, MapPin, Receipt, RotateCcw, Search, ShoppingCart, Truck, Wallet, X,
} from 'lucide-react';
import { useGetBoardConsignmentsQuery, useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { pageSx, fieldSx, ghostBtnSx, TYPE, NAVY, BRAND, DANGER, O2D } from '../../components/pageKit';

/**
 * Split FMS — an order is dispatched in parts; each actual dispatch (one
 * delivery challan) is a split with its own run of steps 2.06 → 2.13.
 * Pick a step, see every split on it as one table row. Read-only: challans
 * come from the Step Board's per-challan ledger, planned date / assignee from
 * the order's O2D process; the work itself is done in O2D FMS.
 */

const STEPS = [
  { code: '2.06', name: 'Actual Dispatch',        icon: Truck,        color: '#2563eb' },
  { code: '2.07', name: 'Invoice & E-way Bill',   icon: FileText,     color: '#7c3aed' },
  { code: '2.08', name: 'Email Invoice',          icon: Mail,         color: '#0e7490' },
  { code: '2.09', name: 'Track Delivery',         icon: MapPin,       color: '#c2410c' },
  { code: '2.10', name: 'Payment Follow-up',      icon: Clock,        color: '#be123c' },
  { code: '2.11', name: 'Payment & Tally',        icon: CheckCircle2, color: '#15803d' },
  { code: '2.12', name: 'Transport Bill',         icon: Receipt,      color: '#4338ca' },
  { code: '2.13', name: 'Transport Bill Payment', icon: Wallet,       color: '#b45309' },
];

const DAY = 864e5;
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const amt = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase() : '');
const fmtDate = (d) => fmtDay(d) || '—';
const fmtDT = (d) => (d ? `${fmtDay(d)} ${fmtTime(d)}` : '—');
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
const localDay = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const nameOf = (u) => (u && typeof u === 'object' ? u.name : null);

// Is the step done FOR THIS challan — same reading as the O2D Step Board.
const RECORD = {
  '2.06': (c) => ({ done: true, at: c.dcDate, by: c.createdByName }),
  '2.07': (c) => ({ done: !!c.invoice?.invoiceNo, at: c.invoice?.date }),
  '2.08': (c) => ({ done: c.invoice?.emailStatus === 'SENT', at: c.invoice?.emailSentAt }),
  '2.09': (c) => ({ done: !!c.delivery?.delivered, at: c.delivery?.date }),
  '2.10': (c) => ({ done: c.payment?.followUpStatus === 'DONE', at: c.payment?.followUpDate }),
  '2.11': (c) => ({ done: !!(c.payment?.confirmed || c.payment?.outcome === 'RECEIVED'), at: c.payment?.receivedDate }),
  '2.12': (c) => ({ done: c.transport?.receiptStatus === 'DONE' }),
  '2.13': (c) => ({ done: c.transport?.paymentStatus === 'DONE' }),
};
const stepOf = (c, code, planned) => {
  if (c.cancelled) return { key: 'cancelled', at: c.cancelledAt, by: c.cancelledByName };
  const log = c.log?.[code];
  if (log?.status === 'CANCELLED') return { key: 'cancelled', at: log.doneAt, by: log.doneByName };
  const rec = RECORD[code](c);
  if (log || rec.done) return { key: 'done', at: log?.doneAt || rec.at, by: log?.doneByName || rec.by };
  return { key: planned && new Date(planned) < new Date() ? 'overdue' : 'pending' };
};
// A split as it stands on one step: planned date + assignee from the order's process.
const withStep = (s, code, stepBySo) => {
  const step = stepBySo.get(`${s.soNumber}|${code}`);
  const planned = step?.planned || null;
  return {
    ...s, planned, state: stepOf(s, code, planned),
    assignedTo: (step?.assignees || []).map(nameOf).filter(Boolean).join(', ') || step?.ownerName || '',
  };
};

const TONE = {
  good: { color: '#15803d', bg: '#ecfdf5' },
  late: { color: '#c2410c', bg: '#fff7ed' },
  bad:  { color: DANGER,    bg: '#fff1f2' },
  calm: { color: '#475569', bg: '#f1f5f9' },
};
// Done → early / late against the planned date; open → overdue / due in.
const timeliness = ({ state, planned }) => {
  if (state.key === 'cancelled') return { label: 'Cancelled', ...TONE.bad };
  if (state.key === 'done') {
    if (!planned || !state.at) return { label: 'Done', ...TONE.good };
    const n = Math.round((new Date(state.at) - new Date(planned)) / DAY);
    if (n > 0) return { label: `Late · ${days(n)}`, ...TONE.late };
    return { label: n < 0 ? `Early · ${days(-n)}` : 'On time', ...TONE.good };
  }
  if (!planned) return { label: 'Pending', ...TONE.calm };
  if (state.key === 'overdue') {
    const n = Math.floor((Date.now() - new Date(planned)) / DAY);
    return { label: n > 0 ? `Overdue · ${days(n)}` : 'Overdue', ...TONE.bad };
  }
  return { label: `Due in ${days(Math.max(1, Math.ceil((new Date(planned) - Date.now()) / DAY)))}`, ...TONE.calm };
};

const AVATAR = [['#eff6ff', '#1d4ed8'], ['#fff7ed', '#c2410c'], ['#f5f3ff', '#6d28d9'], ['#ecfdf5', '#047857'], ['#fdf2f8', '#be185d'], ['#ecfeff', '#0e7490']];
const initials = (s) => s.split(/\s+/).filter((w) => /^[a-z]/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatarOf = (s) => AVATAR[[...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % AVATAR.length];

const Pill = ({ label, color, bg }) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.1, py: 0.35, borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, color, bgcolor: bg, whiteSpace: 'nowrap' }}>
    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />{label}
  </Box>
);
const SplitBar = ({ no, of }) => (
  <Stack direction="row" spacing={1.25} alignItems="center">
    <Box component="span" title="See this order's splits"
      sx={{ fontWeight: 700, color: BRAND, borderBottom: `1px dashed ${alpha(BRAND, 0.5)}` }}>{no} / {of}</Box>
    <Stack direction="row" spacing={0.4}>
      {Array.from({ length: Math.min(of, 6) }, (_, i) => <Box key={i} sx={{ width: 14, height: 4, borderRadius: 2, bgcolor: i < no ? BRAND : '#e2e8f0' }} />)}
    </Stack>
  </Stack>
);
const Party = ({ name }) => {
  if (!name) return '—';
  const [bg, fg] = avatarOf(name);
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>
        {initials(name) || '?'}
      </Box>
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
    </Stack>
  );
};
const Challan = ({ r }) => {
  if (!r.dcNumber) return '—';
  return r.pdfUrl
    ? <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: BRAND, fontWeight: 700, textDecoration: 'none' }}>{r.dcNumber}</a>
    : <Box component="span" sx={{ color: BRAND, fontWeight: 700 }}>{r.dcNumber}</Box>;
};
const When = ({ at }) => (at ? (
  <Box>
    <Box sx={{ color: NAVY, fontWeight: 500 }}>{fmtDay(at)}</Box>
    <Box sx={{ fontSize: '0.72rem', color: O2D.sub }}>{fmtTime(at)}</Box>
  </Box>
) : '—');
const Docs = ({ urls }) => (urls?.length ? (
  <Stack direction="row" spacing={1}>
    {urls.map((u, i) => (
      <a key={u} href={u} target="_blank" rel="noopener noreferrer" style={{ color: BRAND, fontWeight: 700, fontSize: '0.78rem' }}>
        {urls.length > 1 ? `File ${i + 1}` : 'View'}
      </a>
    ))}
  </Stack>
) : '—');
const docs = (key) => ({ text: (r) => (r.invoice?.[key] || []).join(' ') || '—', render: (r) => <Docs urls={r.invoice?.[key]} /> });
const emailText = (r) => ({ SENT: 'Sent', FAILED: 'Failed' }[r.invoice?.emailStatus] || '—');
const receiptText = (r) => (r.transport?.receiptStatus === 'DONE' ? 'Received' : r.transport?.receiptStatus || '—');
const actualAt = (r) => (r.state.key === 'done' ? r.state.at : null);

// Columns every step shows, then each step's own (left → right, scrolls sideways).
// `text` feeds the cell and the export; `render` only dresses the cell.
const BASE_COLUMNS = [
  { label: 'Split', text: (r) => `${r.no} / ${r.of}`, render: (r) => <SplitBar no={r.no} of={r.of} /> },
  { label: 'PO No.', text: (r) => r.poNumber || '—', strong: true },
  { label: 'SO No.', text: (r) => r.soNumber || '—' },
  { label: 'Party', text: (r) => r.partyName || '—', render: (r) => <Party name={r.partyName} />, wide: true },
  { label: 'Challan No.', text: (r) => r.dcNumber || '—', render: (r) => <Challan r={r} /> },
  { label: 'Dispatch Qty', align: 'right', text: (r) => `${num(r.totalQty)} pcs`,
    render: (r) => <><Box component="b" sx={{ color: NAVY }}>{num(r.totalQty)}</Box> <Box component="span" sx={{ color: O2D.sub }}>pcs</Box></> },
  { label: 'Planned', text: (r) => fmtDT(r.planned), render: (r) => <When at={r.planned} /> },
  { label: 'Actual', text: (r) => fmtDT(actualAt(r)), render: (r) => <When at={actualAt(r)} /> },
  { label: 'Timeliness', text: (r) => r.time.label, render: (r) => <Pill {...r.time} /> },
  { label: 'Assigned To', text: (r) => r.assignedTo || '—', wide: true },
  { label: 'Done By', text: (r) => (['done', 'cancelled'].includes(r.state.key) && r.state.by) || '—' },
];
const STEP_COLUMNS = {
  '2.06': [
    { label: 'Dispatch Plan', text: (r) => r.phaseNo || '—' },
    { label: 'SKU', text: (r) => (r.skuNames || []).join(' / ') || '—', wide: true },
    { label: 'SKU Qty', text: (r) => (r.skuQtys || []).map(num).join(' / ') || '—' },
    { label: 'Transport Type', text: (r) => r.transportType || '—' },
    { label: 'Transporter', text: (r) => r.transporterName || '—', wide: true },
    { label: 'L.R. No.', text: (r) => r.lrNo || '—' },
    { label: 'Remarks', text: (r) => r.remark || '—', wide: true },
  ],
  '2.07': [
    { label: 'Invoice No.', text: (r) => r.invoice?.invoiceNo || '—', strong: true },
    { label: 'Invoice Date', text: (r) => fmtDate(r.invoice?.date) },
    { label: 'Invoice Amt', align: 'right', text: (r) => (r.invoice ? amt(r.invoice.amount) : '—') },
    { label: 'Invoice', ...docs('invoiceUrls') },
    { label: 'E-way Bill', ...docs('ewayBillUrls') },
    { label: 'PDIR', ...docs('pdirUrls') },
  ],
  '2.08': [
    { label: 'Invoice No.', text: (r) => r.invoice?.invoiceNo || '—', strong: true },
    { label: 'Invoice Amt', align: 'right', text: (r) => (r.invoice ? amt(r.invoice.amount) : '—') },
    { label: 'Email', text: emailText,
      render: (r) => (emailText(r) === '—' ? '—' : <Pill label={emailText(r)} {...(emailText(r) === 'Sent' ? TONE.good : TONE.bad)} />) },
    { label: 'Sent At', text: (r) => fmtDT(r.invoice?.emailSentAt) },
  ],
  '2.09': [
    { label: 'Transporter', text: (r) => r.transporterName || '—', wide: true },
    { label: 'L.R. No.', text: (r) => r.lrNo || '—' },
    { label: 'Delivery Status', text: (r) => r.delivery?.status || 'Pending' },
    { label: 'Delivery Date', text: (r) => fmtDT(r.delivery?.date) },
    { label: 'New Date to Track', text: (r) => (r.delivery?.delivered ? '—' : fmtDT(r.delivery?.newTrackDate)) },
  ],
  '2.10': [
    { label: 'Invoice No.', text: (r) => r.invoice?.invoiceNo || '—', strong: true },
    { label: 'Invoice Amt', align: 'right', text: (r) => (r.invoice ? amt(r.invoice.amount) : '—') },
    { label: 'Balance', align: 'right', text: (r) => (r.invoice ? amt(r.invoice.balance) : '—') },
    { label: 'Follow-up', text: (r) => (r.payment?.followUpStatus === 'DONE' ? 'Done' : r.payment?.followUpStatus ? 'Pending' : '—') },
    { label: 'Follow-up Date', text: (r) => fmtDT(r.payment?.followUpDate) },
  ],
  '2.11': [
    { label: 'Invoice No.', text: (r) => r.invoice?.invoiceNo || '—', strong: true },
    { label: 'Invoice Amt', align: 'right', text: (r) => (r.invoice ? amt(r.invoice.amount) : '—') },
    { label: 'Payment', text: (r) => ({ RECEIVED: 'Received', NOT_RECEIVED: 'Not received' }[r.payment?.outcome] || (r.payment ? 'Pending' : '—')) },
    { label: 'Amt Received', align: 'right', text: (r) => (r.payment ? amt(r.payment.received) : '—') },
    { label: 'Received Date', text: (r) => fmtDate(r.payment?.receivedDate) },
  ],
  '2.12': [
    { label: 'Transporter', text: (r) => r.transporterName || '—', wide: true },
    { label: 'L.R. No.', text: (r) => r.lrNo || '—' },
    { label: 'Bill Receipt', text: receiptText },
  ],
  '2.13': [
    { label: 'Transporter', text: (r) => r.transporterName || '—', wide: true },
    { label: 'Bill Receipt', text: receiptText },
    { label: 'Bill Payment', text: (r) => (r.transport?.paymentStatus === 'DONE' ? 'Paid' : r.transport?.paymentStatus || '—') },
  ],
};

const cardSx = { bgcolor: '#fff', border: `1px solid ${O2D.line}`, borderRadius: '16px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' };
const labelSx = { fontSize: '0.78rem', fontWeight: 700, color: NAVY, mb: 0.75 };
const headSx = {
  bgcolor: '#f8fafc', color: O2D.sub, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', whiteSpace: 'nowrap', py: 1.5, borderBottom: `1px solid ${O2D.line}`,
};
const cellSx = { fontSize: '0.84rem', color: '#334155', whiteSpace: 'nowrap', py: 1.6, borderBottom: `1px solid ${O2D.lineSoft}` };
const PAGE = 25;

const Info = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
    <Box sx={{ fontSize: '0.86rem', color: NAVY, fontWeight: 600, mt: 0.25, wordBreak: 'break-word' }}>{children || '—'}</Box>
  </Box>
);

// One order: every split of it, and the picked split's details + its run through 2.06 → 2.13.
const SplitDrawer = ({ group, active, onPick, onClose, stepBySo }) => {
  const navigate = useNavigate();
  const s = group?.find((g) => g.dcId === active) || group?.[0];
  const total = (group || []).reduce((sum, g) => sum + Number(g.totalQty || 0), 0);
  return (
    <Drawer anchor="right" open={!!group} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 580 }, bgcolor: '#f8fafc' } }}>
      {s && (
        <>
          <Box sx={{ p: 2.5, bgcolor: '#fff', borderBottom: `1px solid ${O2D.line}` }}>
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', color: O2D.sub }}>ORDER</Typography>
                <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: NAVY }}>{s.poNumber || s.soNumber || '—'}</Typography>
                <Typography sx={{ fontSize: '0.84rem', color: O2D.sub }}>{[s.soNumber, s.partyName].filter(Boolean).join(' · ')}</Typography>
              </Box>
              <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
            </Stack>
            <Typography sx={{ fontSize: '0.8rem', color: O2D.sub, mt: 1.5, mb: 1 }}>
              <Box component="b" sx={{ color: NAVY }}>{group.length}</Box> split{group.length === 1 ? '' : 's'} · <Box component="b" sx={{ color: NAVY }}>{num(total)}</Box> pcs dispatched
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {group.map((g) => {
                const on = g.dcId === s.dcId;
                return (
                  <Box key={g.dcId} component="button" type="button" onClick={() => onPick(g.dcId)} aria-pressed={on}
                    sx={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', px: 1.5, py: 1, borderRadius: '10px',
                      border: `1px solid ${on ? BRAND : O2D.line}`, bgcolor: on ? alpha(BRAND, 0.06) : '#fff' }}>
                    <Box sx={{ fontSize: '0.8rem', fontWeight: 800, color: on ? BRAND : NAVY }}>Split {g.no}</Box>
                    <Box sx={{ fontSize: '0.72rem', color: O2D.sub, whiteSpace: 'nowrap' }}>{g.dcNumber || '—'} · {num(g.totalQty)} pcs</Box>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box sx={{ p: 2.5, display: 'grid', gap: 2 }}>
            <Box sx={{ ...cardSx, p: 2 }}>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: NAVY, mb: 1.5 }}>Split {s.no} of {s.of}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.75 }}>
                <Info label="Challan No."><Challan r={s} /></Info>
                <Info label="Dispatched on">{s.dcDate && fmtDT(s.dcDate)}</Info>
                <Info label="Dispatch Qty">{`${num(s.totalQty)} pcs`}</Info>
                <Info label="Dispatch Plan">{s.phaseNo}</Info>
                <Info label="Transport Type">{s.transportType}</Info>
                <Info label="Transporter">{s.transporterName}</Info>
                <Info label="L.R. No.">{s.lrNo}</Info>
                <Info label="Invoice No.">{s.invoice?.invoiceNo}</Info>
                <Info label="Invoice Amt">{s.invoice && amt(s.invoice.amount)}</Info>
                <Info label="Balance">{s.invoice && amt(s.invoice.balance)}</Info>
              </Box>
              {!!s.skuNames?.length && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: O2D.sub, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>Items</Typography>
                  {s.skuNames.map((n, i) => (
                    <Stack key={`${n}-${i}`} direction="row" justifyContent="space-between" spacing={2}
                      sx={{ py: 0.75, borderTop: i ? `1px solid ${O2D.lineSoft}` : 0, fontSize: '0.84rem' }}>
                      <Box sx={{ color: NAVY }}>{n}</Box>
                      <Box sx={{ color: NAVY, fontWeight: 700, whiteSpace: 'nowrap' }}>{num(s.skuQtys?.[i])} pcs</Box>
                    </Stack>
                  ))}
                </Box>
              )}
              {s.remark && <Box sx={{ mt: 2 }}><Info label="Remarks">{s.remark}</Info></Box>}
            </Box>

            <Box sx={{ ...cardSx, p: 2 }}>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: NAVY, mb: 1 }}>Steps 2.06 → 2.13</Typography>
              {STEPS.map((st, i) => {
                const r = withStep(s, st.code, stepBySo);
                const time = timeliness(r);
                const done = r.state.key === 'done';
                const Icon = st.icon;
                return (
                  <Stack key={st.code} direction="row" spacing={1.5} sx={{ py: 1.25, borderTop: i ? `1px solid ${O2D.lineSoft}` : 0 }}>
                    <Box sx={{ width: 32, height: 32, borderRadius: '9px', flexShrink: 0, display: 'grid', placeItems: 'center',
                      bgcolor: done ? st.color : alpha(st.color, 0.1), color: done ? '#fff' : st.color }}>
                      <Icon size={16} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={1} justifyContent="space-between">
                        <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: NAVY }}>
                          <Box component="span" sx={{ color: st.color, mr: 0.75 }}>{st.code}</Box>{st.name}
                        </Typography>
                        <Pill {...time} />
                      </Stack>
                      <Typography sx={{ fontSize: '0.75rem', color: O2D.sub, mt: 0.25 }}>
                        Planned {fmtDT(r.planned)} · Actual {fmtDT(actualAt(r))}
                        {r.state.by ? ` · Done by ${r.state.by}` : ''}{r.assignedTo ? ` · Assigned to ${r.assignedTo}` : ''}
                      </Typography>
                    </Box>
                    <IconButton size="small" title={`Open step ${st.code} in O2D FMS`} onClick={() => navigate(`/o2d-fms/steps/${st.code}`)} sx={{ alignSelf: 'center' }}>
                      <ExternalLink size={14} />
                    </IconButton>
                  </Stack>
                );
              })}
            </Box>
          </Box>
        </>
      )}
    </Drawer>
  );
};

const Header = ({ tab, onExport }) => {
  const navigate = useNavigate();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={2}>
      <Stack direction="row" spacing={1.75} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: BRAND, color: '#fff', flexShrink: 0, boxShadow: `0 6px 14px ${alpha(BRAND, 0.25)}` }}>
          <GitBranch size={22} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: '1.4rem', fontWeight: 800, color: NAVY, lineHeight: 1.2 }}>Split FMS</Typography>
          <Typography sx={{ fontSize: '0.86rem', color: O2D.sub }}>Every dispatch of an order is a split. Pick a step to see all splits on it.</Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box sx={{ display: 'flex', p: 0.5, borderRadius: '10px', bgcolor: '#eef2f7' }}>
          {[['o2d', 'O2D'], ['purchase', 'Purchase']].map(([v, l]) => (
            <Box key={v} component="button" type="button" onClick={() => navigate(`/split-fms/${v}`)} aria-pressed={tab === v}
              sx={{ border: 0, cursor: 'pointer', font: 'inherit', px: 2, py: 0.75, borderRadius: '8px', fontSize: '0.86rem', fontWeight: 700,
                bgcolor: tab === v ? '#fff' : 'transparent', color: tab === v ? BRAND : O2D.sub, boxShadow: tab === v ? '0 1px 3px rgba(15,23,42,0.12)' : 'none' }}>
              {l}
            </Box>
          ))}
        </Box>
        {onExport && (
          <Button variant="outlined" startIcon={<Download size={16} />} onClick={onExport} sx={{ ...ghostBtnSx, height: 40 }}>Export</Button>
        )}
      </Stack>
    </Stack>
  );
};

const O2dSplits = () => {
  const navigate = useNavigate();
  const { data: consRes, isLoading, isError } = useGetBoardConsignmentsQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  // Same query as the Step Board, so the two share one cached copy.
  const { data: procRes } = useGetProcessesQuery({ limit: 300, sort: '-createdAt', view: 'list' }, { pollingInterval: 60_000, skipPollingIfUnfocused: true });

  const [code, setCode] = useState('2.06');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim().toLowerCase());
  const [party, setParty] = useState(null);
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState(() => new Set());
  const [colsEl, setColsEl] = useState(null);
  const [openSplit, setOpenSplit] = useState(null); // dcId whose order's splits are shown

  // Each challan once, numbered within its order (Split 1 = first dispatch).
  const splits = useMemo(() => {
    const list = Array.isArray(consRes) ? consRes : (consRes?.data || []);
    const bySo = new Map();
    list.forEach((c) => {
      const key = c.soNumber || c.poNumber || String(c.dcId);
      if (!bySo.has(key)) bySo.set(key, []);
      bySo.get(key).push(c);
    });
    const out = [];
    bySo.forEach((group, orderKey) => {
      group.sort((a, b) => new Date(a.dcDate || 0) - new Date(b.dcDate || 0));
      group.forEach((c, i) => out.push({
        ...c, orderKey, no: i + 1, of: group.length,
        hay: [c.poNumber, c.soNumber, c.partyName, c.dcNumber, c.invoice?.invoiceNo, c.transporterName, c.lrNo, c.phaseNo, ...(c.skuNames || [])]
          .filter(Boolean).join(' ').toLowerCase(),
      }));
    });
    return out.sort((a, b) => new Date(b.dcDate || 0) - new Date(a.dcDate || 0));
  }, [consRes]);

  const stepBySo = useMemo(() => {
    const map = new Map();
    (procRes?.data || []).forEach((p) => (p.steps || []).forEach((s) => {
      if (p.soNumber && s.stepCode >= '2.06' && s.stepCode <= '2.13') map.set(`${p.soNumber}|${s.stepCode}`, s);
    }));
    return map;
  }, [procRes]);

  const parties = useMemo(() => [...new Set(splits.map((s) => s.partyName).filter(Boolean))].sort(), [splits]);

  // Search, party and dates narrow every step; a step card's number is what is still open there.
  const { rows, openCount } = useMemo(() => {
    const words = q ? q.split(/\s+/) : [];
    const base = splits.filter((s) => words.every((w) => s.hay.includes(w)) && (!party || s.partyName === party)
      && (!from || localDay(s.dcDate) >= from) && (!to || localDay(s.dcDate) <= to));
    const open = {};
    let current = [];
    STEPS.forEach((st) => {
      const withState = base.map((s) => withStep(s, st.code, stepBySo));
      open[st.code] = withState.filter((r) => r.state.key === 'pending' || r.state.key === 'overdue').length;
      if (st.code === code) current = withState;
    });
    const shown = status === 'all' ? current
      : current.filter((r) => (status === 'pending' ? ['pending', 'overdue'].includes(r.state.key) : r.state.key === status));
    return { rows: shown.map((r) => ({ ...r, time: timeliness(r) })), openCount: open };
  }, [splits, stepBySo, q, party, from, to, status, code]);

  const orderSplits = useMemo(() => {
    const key = openSplit && splits.find((s) => s.dcId === openSplit)?.orderKey;
    return key ? splits.filter((s) => s.orderKey === key).sort((a, b) => a.no - b.no) : null;
  }, [openSplit, splits]);

  const step = STEPS.find((s) => s.code === code);
  const columns = [...BASE_COLUMNS, ...STEP_COLUMNS[code]];
  const shownCols = columns.filter((c) => !hidden.has(c.label));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages);
  const first = (pg - 1) * PAGE;
  const pageRows = rows.slice(first, first + PAGE);

  const filtering = !!(q || party || from || to || status !== 'all');
  const reset = () => { setSearch(''); setParty(null); setFrom(''); setTo(''); setStatus('all'); setPage(1); };
  const toggleCol = (label) => setHidden((h) => {
    const next = new Set(h);
    if (!next.delete(label)) next.add(label);
    return next;
  });

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [shownCols.map((c) => esc(c.label)).join(','), ...rows.map((r) => shownCols.map((c) => esc(c.text(r))).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `split-fms-${code}-${localDay(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <Header tab="o2d" onExport={rows.length ? exportCsv : undefined} />

      <Box sx={{ ...cardSx, p: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', color: O2D.sub }}>ORDER-TO-DISPATCH PIPELINE</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: O2D.sub, display: { xs: 'none', sm: 'block' } }}>
            {STEPS.length} steps · number = splits pending there
          </Typography>
        </Stack>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto', pb: 0.5 }}>
          {STEPS.map((st, i) => {
            const on = st.code === code;
            const Icon = st.icon;
            const open = openCount[st.code] || 0;
            return (
              <React.Fragment key={st.code}>
                {i > 0 && <ChevronRight size={16} color="#94a3b8" style={{ flexShrink: 0 }} />}
                <Box component="button" type="button" onClick={() => { setCode(st.code); setPage(1); }} aria-pressed={on}
                  sx={{ flex: '1 0 172px', textAlign: 'left', cursor: 'pointer', font: 'inherit', p: 1.75, borderRadius: '12px',
                    border: `1px solid ${on ? BRAND : O2D.line}`, bgcolor: on ? alpha(BRAND, 0.05) : '#fff',
                    boxShadow: on ? `0 0 0 3px ${alpha(BRAND, 0.08)}` : 'none', transition: 'border-color .15s, background-color .15s',
                    '&:hover': { borderColor: on ? BRAND : alpha(BRAND, 0.4) } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                    <Box sx={{ width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', bgcolor: on ? st.color : alpha(st.color, 0.1), color: on ? '#fff' : st.color }}>
                      <Icon size={18} />
                    </Box>
                    <Box title={`${open} split${open === 1 ? '' : 's'} pending at this step`}
                      sx={{ minWidth: 26, px: 0.9, borderRadius: '999px', fontSize: '0.75rem', fontWeight: 800, lineHeight: '22px', textAlign: 'center',
                        bgcolor: on ? st.color : alpha(st.color, 0.1), color: on ? '#fff' : st.color }}>
                      {open}
                    </Box>
                  </Stack>
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', color: st.color }}>STEP {st.code}</Typography>
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{st.name}</Typography>
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
      </Box>

      <Box sx={{ ...cardSx, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: { xs: 2, md: 2.5 }, pt: 2.25, pb: 1.75 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: NAVY }}>{step.name}</Typography>
          <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', bgcolor: alpha(BRAND, 0.08), color: BRAND, fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap' }}>Step {code}</Box>
          <Typography sx={{ fontSize: '0.84rem', color: O2D.sub, whiteSpace: 'nowrap' }}>{rows.length} split{rows.length === 1 ? '' : 's'}</Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" startIcon={<Columns2 size={16} />} onClick={(e) => setColsEl(e.currentTarget)} sx={{ ...ghostBtnSx, height: 40 }}>Columns</Button>
          <Menu anchorEl={colsEl} open={!!colsEl} onClose={() => setColsEl(null)} PaperProps={{ sx: { maxHeight: 380 } }}>
            {columns.map((c) => (
              <MenuItem key={c.label} dense onClick={() => toggleCol(c.label)}>
                <Checkbox size="small" checked={!hidden.has(c.label)} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={c.label} primaryTypographyProps={{ fontSize: '0.84rem' }} />
              </MenuItem>
            ))}
          </Menu>
        </Stack>

        <Box sx={{ px: { xs: 2, md: 2.5 }, pb: 2, display: 'grid', gap: 1.5, alignItems: 'end',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: 'minmax(220px,1.6fr) minmax(170px,1fr) minmax(140px,0.8fr) minmax(280px,1.4fr) auto' } }}>
          <Box>
            <Typography sx={labelSx}>Search</Typography>
            <TextField fullWidth size="small" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="PO, SO, party, challan, invoice, SKU, transporter, LR…" sx={fieldSx}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={O2D.sub} /></InputAdornment> }} />
          </Box>
          <Box>
            <Typography sx={labelSx}>Party</Typography>
            <Autocomplete size="small" options={parties} value={party} onChange={(_, v) => { setParty(v); setPage(1); }}
              renderInput={(p) => <TextField {...p} placeholder="All parties" sx={fieldSx} />} />
          </Box>
          <Box>
            <Typography sx={labelSx}>Status</Typography>
            <TextField select fullWidth size="small" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={fieldSx}>
              <MenuItem value="all">All status</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
              <MenuItem value="done">Done</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </TextField>
          </Box>
          <Box>
            <Typography sx={labelSx}>Dispatched between</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 40, px: 1.5, border: `1px solid ${O2D.line}`, borderRadius: '8px', bgcolor: '#fff', '&:focus-within': { borderColor: BRAND } }}>
              <CalendarDays size={16} color={O2D.sub} style={{ flexShrink: 0 }} />
              <InputBase type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                inputProps={{ 'aria-label': 'Dispatched from', max: to || undefined }} sx={{ flex: 1, minWidth: 0, fontSize: '0.84rem' }} />
              <ArrowRight size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
              <InputBase type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
                inputProps={{ 'aria-label': 'Dispatched to', min: from || undefined }} sx={{ flex: 1, minWidth: 0, fontSize: '0.84rem' }} />
            </Box>
          </Box>
          <Button onClick={reset} disabled={!filtering} startIcon={<RotateCcw size={15} />} sx={{ textTransform: 'none', fontWeight: 700, height: 40, justifySelf: 'start' }}>
            Reset
          </Button>
        </Box>

        {isLoading ? (
          <Box sx={{ py: 6, display: 'grid', placeItems: 'center', borderTop: `1px solid ${O2D.line}` }}><CircularProgress size={26} /></Box>
        ) : isError ? (
          <Typography sx={{ ...TYPE.body, color: DANGER, p: 3, borderTop: `1px solid ${O2D.line}` }}>Splits couldn’t be loaded. Refresh to try again.</Typography>
        ) : !rows.length ? (
          <Box sx={{ p: 4, textAlign: 'center', borderTop: `1px solid ${O2D.line}` }}>
            <Typography sx={TYPE.sectionTitle}>{splits.length ? 'Nothing matches these filters' : 'No dispatches yet'}</Typography>
            <Typography sx={{ ...TYPE.caption, mt: 0.5 }}>{splits.length ? 'Change the search or reset the filters.' : 'Each actual dispatch (step 2.06) shows here as a split.'}</Typography>
          </Box>
        ) : (
          <>
            <TableContainer sx={{ maxHeight: 'calc(100vh - 300px)', minHeight: 260, borderTop: `1px solid ${O2D.line}` }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {shownCols.map((col) => (
                      <TableCell key={col.label} align={col.align} sx={{ ...headSx, minWidth: col.wide ? 180 : undefined }}>{col.label}</TableCell>
                    ))}
                    <TableCell sx={headSx} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.dcId} hover sx={{ cursor: 'pointer' }}
                      onClick={(e) => { if (!e.target.closest('a,button')) setOpenSplit(r.dcId); }}>
                      {shownCols.map((col) => (
                        <TableCell key={col.label} align={col.align} title={col.wide ? col.text(r) : undefined}
                          sx={{ ...cellSx, ...(col.strong ? { fontWeight: 700, color: NAVY } : null), ...(col.wide ? { maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' } : null) }}>
                          {col.render ? col.render(r) : col.text(r)}
                        </TableCell>
                      ))}
                      <TableCell sx={cellSx}>
                        <Button size="small" endIcon={<ExternalLink size={13} />} onClick={() => navigate(`/o2d-fms/steps/${code}`)}
                          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.76rem', minWidth: 0 }}>
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ px: { xs: 2, md: 2.5 }, py: 1.75, borderTop: `1px solid ${O2D.line}` }}>
              <Typography sx={{ fontSize: '0.84rem', color: O2D.sub }}>
                Showing <Box component="b" sx={{ color: NAVY }}>{first + 1}–{first + pageRows.length}</Box> of <Box component="b" sx={{ color: NAVY }}>{rows.length}</Box> splits
              </Typography>
              {pages > 1 && <Pagination count={pages} page={pg} onChange={(_, p) => setPage(p)} shape="rounded" variant="outlined" color="primary" />}
            </Stack>
          </>
        )}
      </Box>

      <SplitDrawer group={orderSplits} active={openSplit} onPick={setOpenSplit} onClose={() => setOpenSplit(null)} stepBySo={stepBySo} />
    </>
  );
};

const PurchaseSoon = () => {
  const navigate = useNavigate();
  return (
    <>
      <Header tab="purchase" />
      <Box sx={{ ...cardSx, p: 4, textAlign: 'center' }}>
        <Box sx={{ width: 42, height: 42, mx: 'auto', mb: 1.25, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.08), color: BRAND }}>
          <ShoppingCart size={20} />
        </Box>
        <Typography sx={TYPE.sectionTitle}>Purchase splits are coming next</Typography>
        <Typography sx={{ ...TYPE.caption, mt: 0.5, mb: 2 }}>Until then, follow purchase work in Purchase FMS.</Typography>
        <Button variant="outlined" sx={ghostBtnSx} onClick={() => navigate('/purchase-fms')}>Open Purchase FMS</Button>
      </Box>
    </>
  );
};

const SplitFms = () => {
  const { fms } = useParams();
  return <Box sx={pageSx}>{fms === 'purchase' ? <PurchaseSoon /> : <O2dSplits />}</Box>;
};

export default SplitFms;
