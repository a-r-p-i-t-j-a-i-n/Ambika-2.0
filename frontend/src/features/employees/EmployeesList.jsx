import React, { useState } from 'react';
import { Box, Typography, Paper, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Chip, InputAdornment, IconButton, Tooltip, CircularProgress } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Plus, UserCog, Search, RefreshCw, AlertCircle, Mail, ShieldCheck, Phone, Crown } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetEmployeesQuery, useCreateEmployeeMutation } from '../../store/api/authApi';
import { enqueueSnackbar } from 'notistack';

// Stored value (matches User.role enum) → display label shown to the user.
// MD is the root admin — keep the value as "MD" but label it clearly.
const ROLES = [
  { value: 'MD',                                       label: 'MD (Admin — full access)' },
  { value: 'Chief of Staff',                           label: 'Chief of Staff' },
  { value: 'EA',                                       label: 'EA' },
  { value: 'Factory Incharge (Palghar)',               label: 'Factory Incharge (Palghar)' },
  { value: 'Production Head',                          label: 'Production Head' },
  { value: 'QC Head',                                  label: 'QC Head' },
  { value: 'Store Manager',                            label: 'Store Manager' },
  { value: 'Data Entry Operator (Store & Prodn)',      label: 'Data Entry Operator (Store & Prodn)' },
  { value: 'Process Coordinator',                      label: 'Process Coordinator' },
  { value: 'Process Coordinator & Accounts',           label: 'Process Coordinator & Accounts' },
  { value: 'Accountant',                               label: 'Accountant' },
];

const fmtMobile = (m) => {
  if (!m) return '—';
  const s = String(m).replace(/\D/g, '');
  if (s.length === 10) return `+91 ${s.slice(0, 5)} ${s.slice(5)}`;
  return m;
};

const EmployeesList = () => {
  const { data, isLoading, isError, refetch, error } = useGetEmployeesQuery();
  const [createEmployee, { isLoading: isCreating }] = useCreateEmployeeMutation();

  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);
  const blankForm = { name: '', email: '', mobile: '', password: '', role: 'MD' };
  const [formData, setFormData] = useState(blankForm);
  const [formError, setFormError] = useState('');

  const handleOpen = () => setOpen(true);
  const handleClose = () => {
    setOpen(false);
    setFormData(blankForm);
    setFormError('');
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (formError) setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Client-side mobile check — server enforces the canonical rule.
    const cleaned = formData.mobile.replace(/[\s\-()+]/g, '').replace(/^91/, '').replace(/^0/, '');
    if (!/^[6-9]\d{9}$/.test(cleaned)) {
      setFormError('Mobile must be a valid 10-digit Indian number (used for WhatsApp alerts).');
      return;
    }
    try {
      await createEmployee({ ...formData, mobile: cleaned }).unwrap();
      enqueueSnackbar('Employee created successfully', { variant: 'success' });
      handleClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create employee', { variant: 'error' });
    }
  };

  const filteredRows = React.useMemo(() => {
    if (!data?.data) return [];
    const q = searchTerm.toLowerCase();
    return data.data.filter(row =>
      row.name.toLowerCase().includes(q) ||
      row.email.toLowerCase().includes(q) ||
      row.role.toLowerCase().includes(q) ||
      (row.mobile || '').includes(q)
    );
  }, [data, searchTerm]);

  const columns = [
    { 
      field: 'name', 
      headerName: 'EMPLOYEE', 
      flex: 1, 
      minWidth: 200,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ 
            width: 32, 
            height: 32, 
            borderRadius: '50%', 
            bgcolor: alpha('#2563eb', 0.1), 
            color: '#2563eb', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.75rem'
          }}>
            {p.value.split(' ').map(n => n[0]).join('').toUpperCase()}
          </Box>
          <Typography variant="body2" fontWeight={600}>{p.value}</Typography>
        </Box>
      )
    },
    {
      field: 'email',
      headerName: 'EMAIL',
      flex: 1,
      minWidth: 220,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Mail size={14} color="#64748b" />
          <Typography variant="body2" color="text.secondary">{p.value}</Typography>
        </Box>
      )
    },
    {
      field: 'mobile',
      headerName: 'MOBILE',
      width: 170,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Phone size={14} color="#64748b" />
          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', color: 'text.secondary' }}>
            {fmtMobile(p.value)}
          </Typography>
        </Box>
      )
    },
    {
      field: 'role',
      headerName: 'DESIGNATION',
      width: 240,
      renderCell: (p) => {
        const isMd = p.value === 'MD';
        return (
          <Chip
            icon={isMd ? <Crown size={14} style={{ marginLeft: 8 }} /> : <ShieldCheck size={14} style={{ marginLeft: 8 }} />}
            label={isMd ? 'MD (Admin)' : p.value}
            size="small"
            sx={{
              fontWeight: 700,
              bgcolor: isMd ? alpha('#f59e0b', 0.12) : alpha('#2563eb', 0.08),
              color: isMd ? '#b45309' : '#2563eb',
              '& .MuiChip-icon': { color: 'inherit' },
            }}
          />
        );
      }
    },
    { 
      field: 'isActive', 
      headerName: 'STATUS', 
      width: 120,
      renderCell: (p) => (
        <Chip 
          label={p.value ? 'Active' : 'Inactive'} 
          size="small" 
          variant="outlined"
          color={p.value ? 'success' : 'default'}
          sx={{ fontWeight: 700, fontSize: '0.7rem', height: 24 }}
        />
      )
    },
  ];

  if (isError && error?.status === 401) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2, p: 3 }}>
        <AlertCircle size={48} color="#ef4444" />
        <Typography variant="h6" fontWeight={700}>Session Expired or Unauthorized</Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          It looks like your session has expired or you don't have permission to view this page.<br />
          Please try logging out and logging back in.
        </Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>Retry Access</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>Employee Directory</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Manage organization accounts, access levels and roles</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField
            size="small"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ 
              width: { xs: '100%', sm: 300 },
              '& .MuiOutlinedInput-root': { 
                bgcolor: '#fff',
                borderRadius: '12px'
              } 
            }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Search size={18} color="#94a3b8" /></InputAdornment>
            }}
          />
          <Tooltip title="Refresh List">
            <IconButton onClick={refetch} sx={{ bgcolor: '#fff', border: '1px solid #e2e8f0' }}>
              <RefreshCw size={18} />
            </IconButton>
          </Tooltip>
          <Button 
            variant="contained" 
            startIcon={<Plus size={18} />} 
            onClick={handleOpen}
            sx={{ borderRadius: '12px', px: 3, fontWeight: 700 }}
          >
            Add Account
          </Button>
        </Box>
      </Box>

      {/* Data Grid */}
      <Paper sx={{ 
        flexGrow: 1, 
        borderRadius: '20px', 
        overflow: 'hidden', 
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
      }}>
        <DataGrid
          rows={filteredRows}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          disableRowSelectionOnClick
          rowHeight={64}
          columnHeaderHeight={52}
          sx={{ 
            border: 0,
            '& .MuiDataGrid-columnHeaders': {
              bgcolor: '#f1f5f9',
              color: '#475569',
              fontWeight: 800,
              textTransform: 'uppercase',
              fontSize: '0.75rem'
            },
            '& .MuiDataGrid-cell:focus': {
              outline: 'none'
            }
          }}
        />
      </Paper>

      {/* Create Modal */}
      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '20px' } }}>
        <DialogTitle sx={{ fontWeight: 800, pt: 3, px: 3, fontSize: '1.25rem' }}>
          Create New Account
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent sx={{ px: 3, py: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Fill in the details below to create a new employee profile.</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <TextField
                label="Full Name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                fullWidth
                InputProps={{ sx: { borderRadius: '12px' } }}
              />
              <TextField
                label="Email Address"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
                fullWidth
                InputProps={{ sx: { borderRadius: '12px' } }}
              />
              <TextField
                label="Mobile Number"
                name="mobile"
                value={formData.mobile}
                onChange={handleChange}
                required
                fullWidth
                placeholder="9876543210"
                helperText={formError || 'Used for WhatsApp notifications. 10-digit Indian number.'}
                error={!!formError}
                InputProps={{
                  sx: { borderRadius: '12px' },
                  startAdornment: (
                    <InputAdornment position="start">
                      <Phone size={16} color="#64748b" />
                      <Typography sx={{ ml: 0.75, fontSize: '0.85rem', color: 'text.secondary', fontWeight: 600 }}>+91</Typography>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="Password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                fullWidth
                InputProps={{ sx: { borderRadius: '12px' } }}
              />
              <TextField
                select
                label="Assigned Role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                required
                fullWidth
                helperText={formData.role === 'MD' ? 'MD has full administrative access — including creating other accounts.' : ' '}
                SelectProps={{ sx: { borderRadius: '12px' } }}
              >
                {ROLES.map((r) => (
                  <MenuItem key={r.value} value={r.value}>
                    {r.value === 'MD' && <Crown size={14} style={{ marginRight: 8, color: '#b45309' }} />}
                    {r.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 3 }}>
            <Button onClick={handleClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
            <Button 
              type="submit" 
              variant="contained" 
              disabled={isCreating}
              sx={{ borderRadius: '12px', px: 4, fontWeight: 700 }}
            >
              {isCreating ? <CircularProgress size={24} color="inherit" /> : 'Create Profile'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default EmployeesList;
