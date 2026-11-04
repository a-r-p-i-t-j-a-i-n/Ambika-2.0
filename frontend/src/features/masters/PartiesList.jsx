import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, IconButton, Tooltip, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, Pencil, Package, Trash2, Users, Building2, Map as MapIcon, MapPin,
  CalendarClock, Download, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { useGetPartiesQuery, useDeletePartyMutation } from '../../store/api/partyApi';
import { usePermission } from '../../hooks/usePermission';
import { useMasterRights } from '../../utils/embed';
import { exportRowsToExcel } from '../../utils/exportMasterData';
import PartyFormDrawer from './PartyFormDrawer';
import {
  BRAND, BRAND_DK, DANGER,
  Pill, Empty, NoRows, gridSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';

// ── Look ─────────────────────────────────────────────────────────────────────
// This screen follows the approved "Parties Master" mock: a cool slate canvas,
// a four-up stat strip, filters and table in one card, and a credit-period
// colour band down the left edge of every row. Kept deliberately quiet: one
// brand blue for actions, neutral greys for data, and colour only where it
// means something (the credit-period bands, explained by the colour map).
const INK = '#0f172a';
const SLATE = '#334155';
const NEUTRAL = '#475569';   // grey data pills (approx days, SKUs)
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const LINE = '#e2e8f0';
const LINE_SOFT = '#eef2f6';
const HEAD_BG = '#f8fafc';
const CANVAS = '#f4f6fa';
const AMBER = '#b45309';

// Credit-period bands. `color` paints the pill text, `dot` the row edge and the
// legend swatch. A party with no credit period sits in no band.
const CREDIT_BANDS = [
  { key: 'upto15', label: 'Up to 15 days', max: 15, color: '#15803d', dot: '#16a34a' },
  { key: '16to30', label: '16 – 30 days',  max: 30, color: '#1d4ed8', dot: '#2563eb' },
  { key: '31to45', label: '31 – 45 days',  max: 45, color: AMBER,     dot: '#d97706' },
  { key: 'over45', label: 'Above 45 days', max: Infinity, color: DANGER, dot: '#e11d48' },
];
const bandOf = (days) => {
  const d = Number(days) || 0;
  return d > 0 ? CREDIT_BANDS.find((b) => d <= b.max) : null;
};

const PAGE_SIZES = [10, 25, 50, 100];

// Row helpers — the same fallbacks the columns display, so search, filters,
// sorting, stats and export all agree with what is on screen.
const locationOf = (r) => String(r.location || r.address || '').trim();
const approxOf = (r) => Number(r.approxDays || r.leadTimeDays || 0);
const skuCountOf = (r) => {
  const ordered = Array.isArray(r.orderedSkus) ? r.orderedSkus.length : 0;
  const supplied = Array.isArray(r.suppliedProducts) ? r.suppliedProducts.length : 0;
  return ordered || supplied;
};
const SORT_VALUE = {
  code: (r) => String(r.code || '').toLowerCase(),
  name: (r) => String(r.name || '').toLowerCase(),
  location: (r) => locationOf(r).toLowerCase(),
  creditPeriodDays: (r) => Number(r.creditPeriodDays) || 0,
  approxDays: approxOf,
  orderedSkus: skuCountOf,
};
const sortRows = (rows, sortModel) => {
  const [rule] = sortModel;
  const get = rule && SORT_VALUE[rule.field];
  if (!get) return rows;
  const dir = rule.sort === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a); const y = get(b);
    return (typeof x === 'number' ? x - y : x.localeCompare(y)) * dir;
  });
};

// ── Small pieces ─────────────────────────────────────────────────────────────

const StatCell = ({ icon, label, value }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, bgcolor: '#fff' }}>
    <Box sx={{
      width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
      display: 'grid', placeItems: 'center', color: BRAND,
      bgcolor: alpha(BRAND, 0.06), border: `1px solid ${alpha(BRAND, 0.14)}`,
    }}>
      {icon}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: MUTED, lineHeight: 1.2 }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.45rem', fontWeight: 800, color: INK, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
        {value}
      </Typography>
    </Box>
  </Box>
);

const FieldLabel = ({ children }) => (
  <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: SLATE, mb: 0.5 }}>{children}</Typography>
);

const CodeChip = ({ children }) => (
  <Box sx={{
    display: 'inline-flex', alignItems: 'center', alignSelf: 'center', height: 20, px: 0.9,
    borderRadius: '5px', bgcolor: HEAD_BG, border: `1px solid ${LINE}`,
    color: SLATE, fontSize: '0.66rem', fontWeight: 800, whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  }}>
    {children}
  </Box>
);

const RowAction = ({ title, color, onClick, children }) => (
  <Tooltip title={title}>
    <IconButton size="small" onClick={onClick}
      sx={{
        width: 30, height: 30, borderRadius: '8px', color,
        border: `1px solid ${alpha(color, 0.3)}`, bgcolor: alpha(color, 0.05),
        '&:hover': { bgcolor: alpha(color, 0.12) },
      }}>
      {children}
    </IconButton>
  </Tooltip>
);

const inputSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: '#fff', borderRadius: '8px', fontSize: '0.82rem', height: 36,
    '& fieldset': { borderColor: LINE },
    '&:hover fieldset': { borderColor: alpha(BRAND, 0.4) },
  },
};

const tableSx = {
  ...gridSx,
  '--DataGrid-containerBackground': HEAD_BG,
  '& .MuiDataGrid-columnHeaders': { borderBottom: `1px solid ${LINE}` },
  '& .MuiDataGrid-columnHeader': { bgcolor: HEAD_BG, '&:focus, &:focus-within': { outline: 'none' } },
  '& .MuiDataGrid-columnHeaderTitle': {
    fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: SLATE,
  },
  '& .MuiDataGrid-columnSeparator': { color: LINE },
  // Sort arrows stay visible on every sortable header, as in the mock.
  '& .MuiDataGrid-columnHeader--sortable .MuiDataGrid-iconButtonContainer': { visibility: 'visible', width: 'auto' },
  '& .MuiDataGrid-columnHeader--sortable:not(.MuiDataGrid-columnHeader--sorted) .MuiDataGrid-sortButton': { opacity: 0.45 },
  '& .MuiDataGrid-sortButton': { color: FAINT, p: 0.25 },
  '& .MuiDataGrid-columnHeader--sorted .MuiDataGrid-sortButton': { color: BRAND },
  '& .MuiDataGrid-cell': {
    display: 'flex', alignItems: 'center',
    borderBottom: `1px solid ${LINE_SOFT}`,
    '&:focus, &:focus-within': { outline: 'none' },
  },
  '& .MuiDataGrid-row': { cursor: 'pointer', '--band': 'transparent' },
  '& .MuiDataGrid-row:hover': { bgcolor: alpha(BRAND, 0.035) },
  // Credit-period colour band down the left edge of the row.
  '& .MuiDataGrid-cell[data-field="__sno"]': { boxShadow: 'inset 3px 0 0 var(--band)' },
  ...Object.fromEntries(CREDIT_BANDS.map((b) => [`& .band-${b.key}`, { '--band': b.dot }])),
};

const UnsortedIcon = () => <ArrowUpDown size={12} />;
const AscIcon = () => <ArrowUp size={12} />;
const DescIcon = () => <ArrowDown size={12} />;

const EXPORT_COLUMNS = [
  { field: 'code', headerName: 'Code' },
  { field: 'name', headerName: 'Party name' },
  { field: 'location', headerName: 'Location' },
  { field: 'creditPeriodDays', headerName: 'Credit period (days)' },
  { field: 'approxDays', headerName: 'Approx days' },
  { field: 'skus', headerName: 'SKUs' },
];
const exportValue = (col, r) => {
  switch (col.field) {
    case 'location': return locationOf(r);
    case 'approxDays': return approxOf(r) || '';
    case 'skus': return skuCountOf(r) || '';
    default: return r[col.field] ?? '';
  }
};

// ── Page ─────────────────────────────────────────────────────────────────────

const PartiesList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [sortModel, setSortModel] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [creditFilter, setCreditFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editParty, setEditParty] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // party pending confirmation

  // The parties master is small, so the whole list is loaded once (same query
  // the O2D screens use) and searched, filtered, sorted and paged here. That is
  // what lets the stat strip and the Location dropdown cover every party.
  const { data, isLoading } = useGetPartiesQuery({ limit: 1000 });
  const allParties = useMemo(() => data?.data || [], [data]);
  const [deleteParty, { isLoading: isDeleting }] = useDeletePartyMutation();
  // Inside the Delegation Suite, its lock icon can switch Edit off and Delete
  // on for this person (Parties); delete needs masters.deleteParty.
  const rights = useMasterRights('parties');
  const canEdit = rights.canEdit;
  const canDelete = usePermission('masters.deleteParty') && rights.canDelete;

  const stats = useMemo(() => {
    const places = new Set(allParties.map((r) => locationOf(r).toLowerCase()).filter(Boolean));
    const credits = allParties.map((r) => Number(r.creditPeriodDays) || 0).filter((d) => d > 0);
    return {
      parties: data?.meta?.total ?? allParties.length,
      locations: places.size,
      skus: allParties.reduce((sum, r) => sum + skuCountOf(r), 0),
      avgCredit: credits.length ? Math.round(credits.reduce((a, b) => a + b, 0) / credits.length) : null,
    };
  }, [allParties, data]);

  // Distinct places, first-seen spelling kept, case-insensitive.
  const locationOptions = useMemo(() => {
    const seen = new Map();
    allParties.forEach((r) => {
      const loc = locationOf(r);
      if (loc && !seen.has(loc.toLowerCase())) seen.set(loc.toLowerCase(), loc);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [allParties]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allParties.filter((r) => {
      if (q && ![r.name, r.code, locationOf(r), r.contactPerson].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (locationFilter && locationOf(r).toLowerCase() !== locationFilter.toLowerCase()) return false;
      if (creditFilter && bandOf(r.creditPeriodDays)?.key !== creditFilter) return false;
      return true;
    });
  }, [allParties, searchTerm, locationFilter, creditFilter]);

  const sorted = useMemo(() => sortRows(filtered, sortModel), [filtered, sortModel]);

  const total = sorted.length;
  const { pageSize } = paginationModel;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(paginationModel.page, pageCount - 1); // a delete can empty the last page
  const pageRows = withSno(sorted.slice(page * pageSize, (page + 1) * pageSize), { page, pageSize });
  const rangeText = total ? `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}` : '0 of 0';

  const firstPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const goPage = (p) => setPaginationModel((m) => ({ ...m, page: p }));

  const openCreate = () => { setEditParty(null); setDrawerOpen(true); };
  const openEdit = (party) => { setEditParty(party); setDrawerOpen(true); };

  const confirmDelete = async () => {
    if (!deleteTarget?._id) return;
    try {
      await deleteParty(deleteTarget._id).unwrap();
      enqueueSnackbar(`"${deleteTarget.name}" deleted.`, { variant: 'success' });
      setDeleteTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not delete this party.', { variant: 'error' });
    }
  };

  const handleExport = () => {
    exportRowsToExcel({
      columns: EXPORT_COLUMNS,
      rows: sorted,
      displayVal: exportValue,
      sheetName: 'Parties',
      fileName: `parties_${dayjs().format('YYYY-MM-DD')}.xlsx`,
    });
  };

  const columns = [
    { ...SNO_COLUMN, align: 'left', headerAlign: 'left' },
    { field: 'code', headerName: 'Code', width: 150,
      renderCell: (p) => (p.value ? <CodeChip>{p.value}</CodeChip> : <Empty />)
    },
    { field: 'name', headerName: 'Party name', flex: 1, minWidth: 260,
      renderCell: (p) => (
        <Typography noWrap sx={{ alignSelf: 'center', fontSize: '0.82rem', fontWeight: 700, color: INK }}>{p.value}</Typography>
      )
    },
    { field: 'location', headerName: 'Location', width: 165,
      renderCell: (p) => {
        const loc = locationOf(p.row);
        return loc ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0, color: MUTED }}>
            <MapPin size={13} style={{ flexShrink: 0, color: FAINT }} />
            <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 500, color: MUTED }}>{loc}</Typography>
          </Box>
        ) : <Empty />;
      }
    },
    { field: 'creditPeriodDays', headerName: 'Credit period', width: 135,
      renderCell: (p) => {
        const band = bandOf(p.value);
        return band ? <Pill color={band.color}>{p.value} days</Pill> : <Empty />;
      }
    },
    { field: 'approxDays', headerName: 'Approx days', width: 130,
      renderCell: (p) => {
        const d = approxOf(p.row);
        return d ? <Pill color={NEUTRAL}>{d} days</Pill> : <Empty />;
      }
    },
    { field: 'orderedSkus', headerName: 'SKUs', width: 90,
      renderCell: (p) => {
        const ordered = Array.isArray(p.row.orderedSkus) ? p.row.orderedSkus.length : 0;
        const n = skuCountOf(p.row);
        if (!n) return <Empty />;
        return (
          <Pill color={NEUTRAL} icon={<Package size={12} />}
            title={ordered ? `${ordered} ordered SKU(s)` : `${n} supplied product(s)`}>
            {n}
          </Pill>
        );
      }
    },
    ...(canEdit || canDelete ? [{ field: '__actions', headerName: 'Actions', width: canEdit && canDelete ? 100 : 80,
      align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: (p) => (
        <Box sx={{ display: 'inline-flex', gap: 0.75, alignSelf: 'center' }}>
          {canEdit && (
            <RowAction title="Edit vendor / party" color={BRAND}
              onClick={(e) => { e.stopPropagation(); openEdit(p.row); }}>
              <Pencil size={14} />
            </RowAction>
          )}
          {canDelete && (
            <RowAction title="Delete party" color={DANGER}
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.row); }}>
              <Trash2 size={14} />
            </RowAction>
          )}
        </Box>
      )
    }] : []),
  ];

  const cardSx = { borderRadius: '12px', border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', bgcolor: '#fff' };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: { xs: 1.5, sm: 2.25 }, minHeight: '100vh', bgcolor: CANVAS }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 42, height: 42, borderRadius: '11px', flexShrink: 0, display: 'grid', placeItems: 'center',
            bgcolor: alpha(BRAND, 0.06), border: `1px solid ${alpha(BRAND, 0.14)}`, color: BRAND,
          }}>
            <Building2 size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.35rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Parties Master
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', color: MUTED, fontWeight: 500, mt: 0.25 }}>
              Manage customer directory and credit terms
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
          <Button variant="outlined" startIcon={<Download size={15} />} onClick={handleExport} disabled={!total}
            sx={{ ...btnSx, flex: { xs: 1, sm: 'none' }, bgcolor: '#fff', color: BRAND, borderColor: alpha(BRAND, 0.25), '&:hover': { borderColor: BRAND, bgcolor: alpha(BRAND, 0.04) } }}>
            Export
          </Button>
          <Button variant="contained" startIcon={<Plus size={15} />} onClick={openCreate}
            sx={{ ...btnSx, flex: { xs: 1, sm: 'none' }, bgcolor: BRAND, boxShadow: `0 2px 6px ${alpha(BRAND, 0.3)}`, '&:hover': { bgcolor: BRAND_DK } }}>
            Add Party
          </Button>
        </Box>
      </Box>

      {/* Stat strip */}
      <Paper sx={{
        ...cardSx, overflow: 'hidden', display: 'grid', gap: '1px', bgcolor: LINE,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
      }}>
        <StatCell icon={<Users size={18} />} label="Total Parties" value={stats.parties} />
        <StatCell icon={<MapIcon size={18} />} label="Locations" value={stats.locations} />
        <StatCell icon={<Package size={18} />} label="Total SKUs" value={stats.skus} />
        <StatCell icon={<CalendarClock size={18} />} label="Avg Credit Period"
          value={stats.avgCredit == null ? '—' : `${stats.avgCredit} days`} />
      </Paper>

      {/* Filters + table */}
      <Paper sx={{ ...cardSx, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.25, p: 2 }}>
          <Box sx={{ flex: 1 }}>
            <FieldLabel>Search</FieldLabel>
            <TextField fullWidth size="small" placeholder="Search by party name, code or location" value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); firstPage(); }}
              sx={inputSx}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={FAINT} /></InputAdornment> }}
            />
          </Box>
          <Box sx={{ width: { xs: '100%', md: 155 } }}>
            <FieldLabel>Location</FieldLabel>
            <TextField select fullWidth size="small" value={locationFilter}
              onChange={(e) => { setLocationFilter(e.target.value); firstPage(); }}
              sx={inputSx} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">All</MenuItem>
              {locationOptions.map((loc) => <MenuItem key={loc} value={loc}>{loc}</MenuItem>)}
            </TextField>
          </Box>
          <Box sx={{ width: { xs: '100%', md: 155 } }}>
            <FieldLabel>Credit period</FieldLabel>
            <TextField select fullWidth size="small" value={creditFilter}
              onChange={(e) => { setCreditFilter(e.target.value); firstPage(); }}
              sx={inputSx} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">All</MenuItem>
              {CREDIT_BANDS.map((b) => <MenuItem key={b.key} value={b.key}>{b.label}</MenuItem>)}
            </TextField>
          </Box>
        </Box>

        <Box sx={{ borderTop: `1px solid ${LINE}` }}>
          <DataGrid
            rows={pageRows}
            columns={columns}
            getRowId={(row) => row._id}
            getRowClassName={(p) => { const b = bandOf(p.row.creditPeriodDays); return b ? `band-${b.key}` : ''; }}
            loading={isLoading}
            autoHeight
            hideFooter
            paginationMode="server"
            sortingMode="server"
            rowCount={total}
            paginationModel={{ page, pageSize }}
            pageSizeOptions={PAGE_SIZES}
            sortModel={sortModel}
            onSortModelChange={(m) => { setSortModel(m); firstPage(); }}
            onRowClick={(params) => navigate(`/parties/${params.id}`)}
            disableRowSelectionOnClick
            disableColumnMenu
            rowHeight={48}
            columnHeaderHeight={40}
            slots={{
              columnUnsortedIcon: UnsortedIcon,
              columnSortedAscendingIcon: AscIcon,
              columnSortedDescendingIcon: DescIcon,
              noRowsOverlay: () => (
                <NoRows icon={Users} title={allParties.length ? 'No parties match' : 'No parties yet'}
                  hint={allParties.length ? 'Clear the search or filters to see every party.' : 'Add a party to get started.'} />
              ),
            }}
            sx={tableSx}
          />
        </Box>

        {/* Footer */}
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          px: 2, py: 1, borderTop: `1px solid ${LINE}`, bgcolor: HEAD_BG,
        }}>
          <Typography sx={{ fontSize: '0.76rem', color: MUTED, fontWeight: 500 }}>
            Showing {total} of {allParties.length} parties
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: '0.76rem', color: MUTED, fontWeight: 500 }}>Rows per page</Typography>
            <TextField select size="small" value={pageSize}
              onChange={(e) => setPaginationModel({ page: 0, pageSize: Number(e.target.value) })}
              sx={{ ...inputSx, '& .MuiOutlinedInput-root': { ...inputSx['& .MuiOutlinedInput-root'], height: 30, fontSize: '0.78rem' } }}>
              {PAGE_SIZES.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </TextField>
            <Typography sx={{ fontSize: '0.76rem', color: MUTED, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {rangeText}
            </Typography>
            <Box sx={{ display: 'flex' }}>
              <IconButton size="small" disabled={page === 0} onClick={() => goPage(page - 1)} aria-label="Previous page">
                <ChevronLeft size={16} />
              </IconButton>
              <IconButton size="small" disabled={page >= pageCount - 1} onClick={() => goPage(page + 1)} aria-label="Next page">
                <ChevronRight size={16} />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Colour map */}
      <Paper sx={{ ...cardSx, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2.5, rowGap: 0.75, px: 2, py: 1.25 }}>
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: SLATE }}>
          Colour map · Credit period
        </Typography>
        {CREDIT_BANDS.map((b) => (
          <Box key={b.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '3px', bgcolor: b.dot }} />
            <Typography sx={{ fontSize: '0.76rem', color: MUTED, fontWeight: 500 }}>{b.label}</Typography>
          </Box>
        ))}
      </Paper>

      <PartyFormDrawer
        open={drawerOpen}
        party={editParty}
        onClose={() => { setDrawerOpen(false); setEditParty(null); }}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => !isDeleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete party?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <b>{deleteTarget?.name}</b> will be removed from the parties list. This won't affect existing
            orders or records that already reference it, and it can be restored by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={isDeleting} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button onClick={confirmDelete} variant="contained" color="error" disabled={isDeleting}
            startIcon={isDeleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} />}
            sx={{ textTransform: 'none', fontWeight: 700 }}>
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PartiesList;
