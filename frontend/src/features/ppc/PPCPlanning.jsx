import React, { useState, useMemo } from 'react';
import { Box, Typography, Paper, TextField, MenuItem, Button } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Download, Calendar } from 'lucide-react';
import { useGetPpcMonthDataQuery } from '../../store/api/ppcApi';
import dayjs from 'dayjs';

const PPCPlanning = () => {
  const [currentDate, setCurrentDate] = useState(dayjs());
  const year = currentDate.year();
  const month = currentDate.month() + 1;

  const { data, isLoading } = useGetPpcMonthDataQuery({ year, month });

  const dynamicColumns = useMemo(() => {
    const daysInMonth = currentDate.daysInMonth();
    const cols = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      cols.push({
        field: `plan_${dateStr}`,
        headerName: `${String(i).padStart(2, '0')}`,
        width: 60,
        align: 'center',
        headerAlign: 'center',
        sortable: false,
        renderCell: (params) => {
          const planData = params.row.dailyPlan?.find(p => p.date.startsWith(dateStr));
          const plan = planData?.dispPlan;
          const actual = planData?.dispActual;
          return (
            <Box sx={{ textAlign: 'center', lineHeight: 1.3 }}>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: '#2563eb' }}>{plan || '-'}</Typography>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 500, color: actual ? '#059669' : '#94a3b8' }}>{actual || '-'}</Typography>
            </Box>
          );
        }
      });
    }
    return cols;
  }, [currentDate, year, month]);

  const baseColumns = [
    { field: 'soNumber', headerName: 'SO #', width: 130,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography>
    },
    { field: 'partyName', headerName: 'PARTY', width: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography>
    },
    { field: 'skuName', headerName: 'SKU', width: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={500} noWrap>{p.value}</Typography>
    },
    { field: 'orderQty', headerName: 'ORD QTY', width: 80, type: 'number', align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value?.toLocaleString('en-IN') || '-'}</Typography>
    },
    { field: 'balanceQty', headerName: 'BAL QTY', width: 80, type: 'number', align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={600} color="error.main">{p.value?.toLocaleString('en-IN') || '-'}</Typography>
    },
    { field: 'totalQtyToProduce', headerName: 'TO PROD', width: 80, type: 'number', align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={600} color="warning.dark">{p.value?.toLocaleString('en-IN') || '-'}</Typography>
    },
  ];

  const columns = [...baseColumns, ...dynamicColumns];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>PPC Schedule vs Supply</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Production planning & dispatch tracking matrix</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField select size="small" value={month} onChange={(e) => setCurrentDate(currentDate.month(e.target.value - 1))}
            sx={{ width: { xs: 'calc(50% - 6px)', sm: 130 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <MenuItem key={i + 1} value={i + 1}>{dayjs().month(i).format('MMMM')}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" value={year} onChange={(e) => setCurrentDate(currentDate.year(e.target.value))}
            sx={{ width: { xs: 'calc(50% - 6px)', sm: 100 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}>
            {[2024, 2025, 2026, 2027].map((y) => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </TextField>
          <Button fullWidth={false} variant="outlined" startIcon={<Download size={16} />} 
            sx={{ width: { xs: '100%', sm: 'auto' }, borderColor: '#e2e8f0', color: '#475569', bgcolor: '#fff', '&:hover': { bgcolor: '#f1f5f9' } }}>
            Export
          </Button>
        </Box>
      </Box>

      {/* Data Grid */}
      <Paper sx={{ flexGrow: 1, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(row) => `${row.orderId}_${row.skuId}`}
          loading={isLoading}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={40}
          sx={{ border: 0 }}
        />
      </Paper>
    </Box>
  );
};

export default PPCPlanning;
