import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Tabs, Tab, TextField, InputAdornment,
  alpha, useTheme, Tooltip, IconButton, Skeleton, Badge, Dialog, DialogContent,
  Divider, Button, MenuItem,
} from '@mui/material';
import {
  FolderOpen, FileText, Image as ImageIcon, FileSpreadsheet, FileType,
  Mail, Paperclip, Search, Calendar, User as UserIcon, ExternalLink, X,
  Download, Filter, Users, Truck, BadgeCheck,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetPricingDocumentsQuery } from '../../store/api/pricingApi';
import { fmtINR } from '../../utils/formatters';

const CATEGORIES = [
  { key: '',           label: 'All',                 icon: FolderOpen, color: '#475569' },
  { key: 'CUSTOMER',   label: 'Customer Revisions',  icon: Users,      color: '#2563eb' },
  { key: 'SUPPLIER_RM',label: 'Supplier RM',         icon: Truck,      color: '#ea580c' },
  { key: 'APPROVED',   label: 'Approved Quotations', icon: BadgeCheck, color: '#16a34a' },
];

const FILE_ICONS = {
  PDF:    { Icon: FileText,        color: '#dc2626' },
  IMAGE:  { Icon: ImageIcon,       color: '#8b5cf6' },
  SHEET:  { Icon: FileSpreadsheet, color: '#16a34a' },
  DOC:    { Icon: FileType,        color: '#2563eb' },
  EMAIL:  { Icon: Mail,            color: '#0891b2' },
  OTHER:  { Icon: Paperclip,       color: '#64748b' },
};

const PricingDocuments = () => {
  const theme = useTheme();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [uploader, setUploader] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [preview, setPreview] = useState(null);

  const query = useMemo(() => ({
    category, search,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(uploader ? { uploader } : {}),
  }), [category, search, from, to, uploader]);

  const { data, isFetching } = useGetPricingDocumentsQuery(query);
  const items = data?.data?.items || [];
  const counts = data?.data?.categoryCounts || { CUSTOMER: 0, SUPPLIER_RM: 0, APPROVED: 0 };

  const isImagePreview = (item) => item.fileType === 'IMAGE' && item.attachmentUrl;
  const isPdfPreview   = (item) => item.fileType === 'PDF'   && item.attachmentUrl;

  const handleOpen = (item) => {
    if (isImagePreview(item) || isPdfPreview(item)) setPreview(item);
    else window.open(item.attachmentUrl, '_blank');
  };

  const activeFilterCount = (from ? 1 : 0) + (to ? 1 : 0) + (uploader ? 1 : 0);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 6 },
      }}>
        <Box aria-hidden sx={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          top: -160, right: -120,
          background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)',
        }} />
        <Stack direction="row" spacing={2.5} alignItems="center" sx={{ position: 'relative' }}>
          <Box sx={{
            width: 52, height: 52, borderRadius: 2.5,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
          }}>
            <FolderOpen size={26} color="#fff" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Pricing Documents
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5, maxWidth: 720 }}>
              Every proof, quotation, email confirmation and RM-cost sheet attached
              to a price revision — auto-organised by source.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -2.5, md: -3.5 }, position: 'relative', pb: 5 }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden', boxShadow: '0 10px 28px rgba(30, 58, 138, 0.08)' }}>
          {/* Tabs */}
          <Tabs
            value={category}
            onChange={(_, v) => setCategory(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              px: 1, borderBottom: `1px solid ${theme.palette.divider}`,
              '& .MuiTab-root': {
                textTransform: 'none', fontWeight: 700, fontSize: '0.86rem',
                minHeight: 56, gap: 1,
              },
              '& .Mui-selected': { color: theme.palette.primary.dark },
            }}
          >
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const count = c.key === '' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[c.key];
              return (
                <Tab
                  key={c.key || 'all'}
                  value={c.key}
                  label={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Icon size={15} color={c.color} />
                      <span>{c.label}</span>
                      <Chip
                        label={count}
                        size="small"
                        sx={{
                          height: 18, fontSize: '0.66rem', fontWeight: 800,
                          color: c.color,
                          bgcolor: alpha(c.color, 0.10),
                          border: `1px solid ${alpha(c.color, 0.22)}`,
                        }}
                      />
                    </Stack>
                  }
                />
              );
            })}
          </Tabs>

          {/* Toolbar */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
            sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}
          >
            <TextField
              size="small"
              placeholder="Search SKU, file name, reason, uploader…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ width: { xs: '100%', md: 360 }, '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} color={theme.palette.text.secondary} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ flex: 1 }} />

            <Badge color="primary" badgeContent={activeFilterCount} invisible={!activeFilterCount} overlap="circular">
              <Button
                size="small"
                variant="outlined"
                startIcon={<Filter size={14} />}
                onClick={() => setShowFilters((v) => !v)}
                sx={{
                  fontWeight: 700, borderRadius: 1.25, textTransform: 'none',
                  bgcolor: showFilters ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                }}
              >
                Filters
              </Button>
            </Badge>

            <Typography sx={{
              fontSize: '0.74rem', color: 'text.secondary', fontWeight: 600,
              px: 1.25, py: 0.5, borderRadius: 1,
              bgcolor: alpha(theme.palette.text.primary, 0.04),
            }}>
              {isFetching ? 'Loading…' : `${items.length} document${items.length === 1 ? '' : 's'}`}
            </Typography>
          </Stack>

          {/* Expandable filter row */}
          {showFilters && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.03), borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <TextField label="From" type="date" size="small" value={from}
                onChange={(e) => setFrom(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ minWidth: 160 }} />
              <TextField label="To" type="date" size="small" value={to}
                onChange={(e) => setTo(e.target.value)}
                InputLabelProps={{ shrink: true }} sx={{ minWidth: 160 }} />
              <TextField label="Uploader contains" size="small" value={uploader}
                onChange={(e) => setUploader(e.target.value)}
                placeholder="e.g. Gaurav"
                sx={{ minWidth: 220, flex: 1 }} />
              <Button
                size="small"
                onClick={() => { setFrom(''); setTo(''); setUploader(''); }}
                sx={{ fontWeight: 700, color: theme.palette.error.dark, textTransform: 'none' }}
              >
                Clear
              </Button>
            </Stack>
          )}

          {/* Grid */}
          <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
            {isFetching ? (
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 2,
              }}>
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
                ))}
              </Box>
            ) : items.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center', color: 'text.disabled' }}>
                <FolderOpen size={36} style={{ opacity: 0.4, marginBottom: 8 }} />
                <Typography sx={{ fontWeight: 700 }}>No documents in this view</Typography>
                <Typography sx={{ fontSize: '0.82rem' }}>
                  Attach a proof when filing a price revision and it appears here automatically.
                </Typography>
              </Box>
            ) : (
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 2,
              }}>
                {items.map((item) => (
                  <DocumentCard
                    key={item._id}
                    item={item}
                    theme={theme}
                    onOpen={() => handleOpen(item)}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      {/* Lightbox preview for images / PDFs */}
      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2.5, overflow: 'hidden' } }}
      >
        {preview && (
          <>
            <Stack direction="row" alignItems="center" spacing={1.5}
              sx={{ p: 1.5, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: alpha(theme.palette.primary.main, 0.04) }}
            >
              <Box sx={{
                width: 32, height: 32, borderRadius: 1.5,
                display: 'grid', placeItems: 'center',
                bgcolor: alpha(FILE_ICONS[preview.fileType]?.color || '#64748b', 0.10),
                color: FILE_ICONS[preview.fileType]?.color || '#64748b',
              }}>
                {React.createElement(FILE_ICONS[preview.fileType]?.Icon || Paperclip, { size: 16 })}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.88rem' }} noWrap>
                  {preview.attachmentName || 'Untitled'}
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }} noWrap>
                  {preview.skuCode} · {preview.skuName} · {dayjs(preview.createdAt).format('DD MMM YYYY · hh:mm A')}
                </Typography>
              </Box>
              <Tooltip title="Open in new tab"><IconButton onClick={() => window.open(preview.attachmentUrl, '_blank')}><ExternalLink size={14} /></IconButton></Tooltip>
              <Tooltip title="Download"><IconButton component="a" href={preview.attachmentUrl} download={preview.attachmentName}><Download size={14} /></IconButton></Tooltip>
              <Tooltip title="Close"><IconButton onClick={() => setPreview(null)}><X size={14} /></IconButton></Tooltip>
            </Stack>
            <DialogContent sx={{ p: 0, bgcolor: '#0f172a', minHeight: 480, display: 'grid', placeItems: 'center' }}>
              {preview.fileType === 'IMAGE' ? (
                <img src={preview.attachmentUrl} alt={preview.attachmentName} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
              ) : (
                <Box component="iframe"
                  src={preview.attachmentUrl}
                  title={preview.attachmentName}
                  sx={{ width: '100%', height: '70vh', border: 0 }}
                />
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
};

// ── DocumentCard ─────────────────────────────────────────────────────
const DocumentCard = ({ item, theme, onOpen }) => {
  const fi = FILE_ICONS[item.fileType] || FILE_ICONS.OTHER;
  const Icon = fi.Icon;
  const change = item.changePercent || 0;
  const up = change > 0;
  const down = change < 0;

  return (
    <Box
      onClick={onOpen}
      sx={{
        p: 1.75,
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.paper,
        cursor: 'pointer',
        transition: 'all 0.18s',
        display: 'flex', flexDirection: 'column', gap: 1,
        '&:hover': {
          borderColor: alpha(theme.palette.primary.main, 0.4),
          boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.10)}`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      {/* Thumbnail row */}
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box sx={{
          width: 44, height: 44, borderRadius: 1.5,
          display: 'grid', placeItems: 'center',
          bgcolor: alpha(fi.color, 0.10),
          color: fi.color,
          flexShrink: 0,
        }}>
          <Icon size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.primary' }} noWrap>
            {item.attachmentName || 'Untitled file'}
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
            {item.fileType} · {dayjs(item.createdAt).format('DD MMM YYYY')}
          </Typography>
        </Box>
      </Stack>

      <Divider sx={{ my: 0.5 }} />

      {/* SKU + price */}
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{
            fontFamily: 'ui-monospace, monospace', fontWeight: 800,
            fontSize: '0.78rem', color: theme.palette.primary.dark,
          }} noWrap>
            {item.skuCode}
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>
            {item.skuName}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
            {fmtINR(item.newPrice)}
          </Typography>
          {(up || down) && (
            <Typography sx={{
              fontSize: '0.66rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: up ? theme.palette.success.dark : theme.palette.error.dark,
            }}>
              {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
            </Typography>
          )}
        </Box>
      </Stack>

      {/* Footer */}
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 'auto', pt: 0.5, color: 'text.secondary' }}>
        <UserIcon size={11} />
        <Typography sx={{ fontSize: '0.7rem' }} noWrap>{item.requestedByName || '—'}</Typography>
        <Box sx={{ flex: 1 }} />
        {item.categories.includes('APPROVED') && (
          <Tooltip title="Approved by MD">
            <Chip
              size="small"
              icon={<BadgeCheck size={10} style={{ marginLeft: 6 }} />}
              label="Approved"
              sx={{
                height: 18, fontWeight: 700, fontSize: '0.62rem',
                color: theme.palette.success.dark,
                bgcolor: alpha(theme.palette.success.main, 0.10),
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          </Tooltip>
        )}
      </Stack>
    </Box>
  );
};

export default PricingDocuments;
