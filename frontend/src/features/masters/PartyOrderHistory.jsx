import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  Box, Typography, Button, TextField, InputAdornment, IconButton, CircularProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, TablePagination,
} from '@mui/material';
import { Search, X, Download, History } from 'lucide-react';
import { useGetOrdersByPartyQuery } from '../../store/api/orderApi';
import { useGetOrderIntakesQuery } from '../../store/api/orderIntakeApi';
import { exportRowsToExcel } from '../../utils/exportMasterData';
import PartyPill from './PartyPill';
import { TONE, thSx, tdSx, numSx, money, qty, searchTerms, matchesAny } from './partyUi';
import { BRAND, BRAND_DK, O2D } from '../../components/pageKit';

/**
 * Party → Order History: every Sales Order this party has placed, one row per
 * item (date, SO / PO, SKU, ordered / dispatched / balance, rate, amount,
 * status, and how the order came in — from Order Intake). Search takes several
 * terms at once (commas); Export writes the rows shown to Excel, one field per
 * column.
 */

const STATUS = {
  RECEIVED: { label: 'Received', color: TONE.blue },
  PLANNING: { label: 'Planning', color: TONE.violet },
  IN_PROGRESS: { label: 'In progress', color: TONE.amber },
  COMPLETED: { label: 'Completed', color: TONE.green },
  SHORT_CLOSED: { label: 'Short closed', color: TONE.slate },
  CANCELLED: { label: 'Cancelled', color: TONE.rose },
};
const statusOf = (s) => STATUS[s] || { label: s ? s.replace(/_/g, ' ').toLowerCase() : '—', color: TONE.slate };

const VIA = { PHONE: 'Call', EMAIL: 'Email', WHATSAPP: 'WhatsApp', MEETING: 'Meeting', OTHER: 'Other' };

const day = (d, f = 'DD MMM YYYY') => (d ? dayjs(d).format(f) : '');

// Excel: every field in its own column.
const EXPORT_COLUMNS = [
  { headerName: 'Order Date', get: (r) => day(r.orderDate, 'DD-MM-YYYY') },
  { headerName: 'SO No.', get: (r) => r.soNumber || '' },
  { headerName: 'PO No.', get: (r) => r.poNumber || '' },
  { headerName: 'PO Date', get: (r) => day(r.poDate, 'DD-MM-YYYY') },
  { headerName: 'Status', get: (r) => statusOf(r.status).label },
  { headerName: 'Came Via', get: (r) => r.via || '' },
  { headerName: 'SKU Name', get: (r) => r.skuName || '' },
  { headerName: 'SKU Code', get: (r) => r.skuCode || '' },
  { headerName: 'Ordered Qty', get: (r) => Number(r.qty || 0) },
  { headerName: 'Dispatched Qty', get: (r) => Number(r.dispatched || 0) },
  { headerName: 'Balance Qty', get: (r) => Number(r.balance || 0) },
  { headerName: 'Rate (₹)', get: (r) => Number(r.rate || 0) },
  { headerName: 'Amount (₹)', get: (r) => Number(r.amount || 0) },
  { headerName: 'Place', get: (r) => r.place || '' },
  { headerName: 'Transport', get: (r) => r.transport || '' },
  { headerName: 'Financial Year', get: (r) => r.fy || '' },
  { headerName: 'Remark', get: (r) => r.remark || '' },
];

const PartyOrderHistory = ({ party }) => {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(50);

  const { data, isLoading, isError } = useGetOrdersByPartyQuery({ partyId: party._id, limit: 1000, sort: '-orderDate' });
  // How each order came in (Call / Email / WhatsApp…). Needs the "view orders"
  // right; without it the column just stays empty.
  const { data: intakeRes } = useGetOrderIntakesQuery({ partyId: party._id, limit: 1000 });

  const rows = useMemo(() => {
    const viaByOrder = new Map((intakeRes?.data || [])
      .filter((i) => i.linkedSalesOrderId)
      .map((i) => [String(i.linkedSalesOrderId?._id || i.linkedSalesOrderId), VIA[i.channel] || i.channel || '']));
    return (data?.data || []).flatMap((o) => (o.items || []).map((it, i) => ({
      key: `${o._id}-${it._id || i}`,
      orderId: o._id,
      orderDate: o.orderDate,
      soNumber: o.soNumber,
      poNumber: o.poNumber,
      poDate: o.poDate,
      status: o.status,
      via: viaByOrder.get(String(o._id)) || '',
      place: o.place || o.location,
      transport: o.transport,
      fy: o.financialYear,
      skuName: it.skuName,
      skuCode: it.skuCode,
      qty: it.orderQty,
      dispatched: it.dispatchedQty,
      balance: it.balanceQty,
      rate: it.rate,
      amount: Number(it.orderQty || 0) * Number(it.rate || 0),
      remark: it.remark,
    })));
  }, [data, intakeRes]);

  const shown = useMemo(() => {
    const terms = searchTerms(text);
    return rows.filter((r) => matchesAny(terms,
      `${r.skuName || ''} ${r.skuCode || ''} ${r.soNumber || ''} ${r.poNumber || ''} ${statusOf(r.status).label} ${r.via}`.toLowerCase()));
  }, [rows, text]);

  const orders = new Set(shown.map((r) => r.orderId)).size;
  const value = shown.reduce((sum, r) => sum + r.amount, 0);
  const pageRows = shown.slice(page * perPage, page * perPage + perPage);

  const exportExcel = () => exportRowsToExcel({
    columns: EXPORT_COLUMNS,
    rows: shown,
    displayVal: (c, r) => c.get(r),
    sheetName: 'Order History',
    fileName: `${party.code || party.name} - Order History.xlsx`,
  });

  if (isLoading) {
    return <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>;
  }
  if (isError) {
    return <Typography sx={{ py: 5, textAlign: 'center', fontSize: '0.86rem', color: O2D.sub }}>Couldn&apos;t load the order history. Please try again.</Typography>;
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 2, py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <TextField
          size="small"
          value={text}
          onChange={(e) => { setText(e.target.value); setPage(0); }}
          placeholder="Search SKU, SO or PO no. — commas for several"
          sx={{ flex: '1 1 320px', maxWidth: 520, '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '0.84rem', bgcolor: O2D.surface } }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            endAdornment: text ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => { setText(''); setPage(0); }} aria-label="Clear search"><X size={14} /></IconButton>
              </InputAdornment>
            ) : null,
          }}
          inputProps={{ 'aria-label': 'Search order history' }}
        />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportExcel} disabled={!shown.length}
          sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 800 }}>
          Export Excel
        </Button>
      </Box>

      {!rows.length ? (
        <Box sx={{ py: 5, textAlign: 'center', color: O2D.faint }}>
          <History size={28} />
          <Typography sx={{ mt: 1, fontSize: '0.84rem', color: O2D.sub }}>No sales orders for this party yet.</Typography>
        </Box>
      ) : !shown.length ? (
        <Typography sx={{ py: 5, textAlign: 'center', fontSize: '0.84rem', color: O2D.sub }}>Nothing matches “{text}”.</Typography>
      ) : (
        <>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 1040 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>SO / PO No.</TableCell>
                  <TableCell sx={thSx}>SKU</TableCell>
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>Ordered</TableCell>
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>Dispatched</TableCell>
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>Balance</TableCell>
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>Rate (₹)</TableCell>
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>Amount (₹)</TableCell>
                  <TableCell sx={thSx}>Status</TableCell>
                  <TableCell sx={thSx}>Came Via</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r, i) => {
                  // The order's own details on its first row only — its items read as one group.
                  const first = i === 0 || pageRows[i - 1].orderId !== r.orderId;
                  const st = statusOf(r.status);
                  const cell = { ...tdSx, ...(first && i > 0 ? { borderTop: `2px solid ${O2D.line}` } : {}) };
                  return (
                    <TableRow key={r.key} hover data-order={r.soNumber}>
                      <TableCell sx={{ ...cell, whiteSpace: 'nowrap', color: O2D.body }}>{first ? day(r.orderDate) : ''}</TableCell>
                      <TableCell sx={{ ...cell, whiteSpace: 'nowrap' }}>
                        {first && (
                          <>
                            <Box component="button" type="button" onClick={() => navigate(`/orders/${r.orderId}`)}
                              sx={{ p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 800, color: BRAND, '&:hover': { textDecoration: 'underline' } }}>
                              {r.soNumber}
                            </Box>
                            {r.poNumber && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>PO {r.poNumber}</Typography>}
                          </>
                        )}
                      </TableCell>
                      <TableCell sx={cell}>
                        <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: BRAND_DK }}>{r.skuName || '—'}</Typography>
                        {r.skuCode && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, fontWeight: 600 }}>{r.skuCode}</Typography>}
                      </TableCell>
                      <TableCell sx={{ ...numSx, ...cell, textAlign: 'right', fontWeight: 800 }}>{qty(r.qty)}</TableCell>
                      <TableCell sx={{ ...numSx, ...cell, textAlign: 'right' }}>{qty(r.dispatched)}</TableCell>
                      <TableCell sx={{ ...numSx, ...cell, textAlign: 'right', color: Number(r.balance) > 0 ? TONE.amber : O2D.faint }}>{qty(r.balance)}</TableCell>
                      <TableCell sx={{ ...numSx, ...cell, textAlign: 'right' }}>{money(r.rate)}</TableCell>
                      <TableCell sx={{ ...numSx, ...cell, textAlign: 'right', fontWeight: 800 }}>{money(r.amount)}</TableCell>
                      <TableCell sx={cell}>{first && <PartyPill color={st.color}>{st.label}</PartyPill>}</TableCell>
                      <TableCell sx={{ ...cell, color: O2D.body, whiteSpace: 'nowrap' }}>{first ? (r.via || '—') : ''}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, pl: 2, borderTop: `1px solid ${O2D.lineSoft}`, bgcolor: '#fbfcfe' }}>
            <Typography sx={{ fontSize: '0.74rem', color: O2D.sub }} data-summary>
              {orders} order{orders === 1 ? '' : 's'} · {shown.length} item{shown.length === 1 ? '' : 's'} · ₹{money(value)}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <TablePagination
              component="div"
              count={shown.length}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={perPage}
              onRowsPerPageChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
              rowsPerPageOptions={[25, 50, 100]}
              sx={{ border: 0, '& .MuiTablePagination-toolbar': { minHeight: 44 } }}
            />
          </Box>
        </>
      )}
    </>
  );
};

export default PartyOrderHistory;
