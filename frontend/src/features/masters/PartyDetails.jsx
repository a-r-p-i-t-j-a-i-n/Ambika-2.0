import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Divider, Button,
  Chip, Avatar, List, ListItem, ListItemText, ListItemIcon,
  CircularProgress, IconButton, Tooltip, Stack,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import {
  ArrowLeft, Mail, Phone, MapPin, CreditCard,
  Clock, Package, User, Hash, Globe, CheckCircle2, Pencil, Receipt,
} from 'lucide-react';
import { useGetPartyByIdQuery } from '../../store/api/partyApi';
import { useGetSkusQuery } from '../../store/api/skuApi';
import { alpha } from '@mui/material/styles';
import PartyFormDrawer from './PartyFormDrawer';
import PartySkusDrawer from './PartySkusDrawer';
import { pageSx, panelSx, primaryBtnSx, BRAND, BRAND_DK, NAVY, O2D } from '../../components/pageKit';

const PartyDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/parties');
  const [editOpen, setEditOpen] = useState(false);
  const [skusOpen, setSkusOpen] = useState(false);

  const { data: partyRes, isLoading: partyLoading } = useGetPartyByIdQuery(id);
  const party = partyRes?.data; // API wraps the doc in { success, message, data }
  const { data: skusData } = useGetSkusQuery({ clientId: id, limit: 100 });

  if (partyLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!party) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6">Party not found</Typography>
        <Button startIcon={<ArrowLeft />} onClick={() => navigate('/parties')}>Back to List</Button>
      </Box>
    );
  }

  const sectionHeaderStyle = {
    mb: 1.75,
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    color: BRAND_DK,
    fontWeight: 800,
    fontSize: '0.88rem',
    letterSpacing: '-0.01em',
  };

  // Label / value pair. The label was 0.75rem semibold uppercase and the value
  // only 600 at body size, so the two lines carried nearly equal weight and the
  // eye had to work out which was the answer. Label is now quieter and smaller,
  // value darker and heavier.
  const infoLabelStyle = {
    color: O2D.sub,
    fontSize: '0.6rem',
    fontWeight: 800,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    mb: 0.25,
  };

  const infoValueStyle = {
    fontWeight: 700,
    fontSize: '0.86rem',
    color: NAVY,
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
  };

  // Status chip: brand-consistent tinted pill instead of MUI's solid success
  // colour, which rendered as a heavy green block competing with the party name.
  const statusTone = (party.status || 'ACTIVE') === 'ACTIVE'
    ? { color: '#15803d', label: party.status || 'ACTIVE' }
    : { color: O2D.sub, label: party.status };

  return (
    <Box sx={pageSx}>
      {/* Top Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <IconButton onClick={goBack} size="small"
          sx={{ width: 34, height: 34, borderRadius: '8px', flexShrink: 0, color: O2D.sub, bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, '&:hover': { color: BRAND, borderColor: alpha(BRAND, 0.4) } }}>
          <ArrowLeft size={17} />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* h4 (2.125rem) was larger than every other page title in the app. */}
            <Typography sx={{ fontSize: { xs: '1.15rem', md: '1.3rem' }, fontWeight: 800, color: NAVY, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {party.name}
            </Typography>
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', height: 21, px: 1,
              borderRadius: '6px', flexShrink: 0,
              bgcolor: alpha(statusTone.color, 0.1),
              border: `1px solid ${alpha(statusTone.color, 0.24)}`,
              color: statusTone.color,
              fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1,
            }}>
              {statusTone.label}
            </Box>
          </Box>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.2, color: O2D.sub, fontSize: '0.75rem', flexWrap: 'wrap' }}>
            <Hash size={12} />
            <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{party.code}</Box>
            <Box component="span" sx={{ color: O2D.faint }}>·</Box>
            <MapPin size={12} />
            <Box component="span">{party.location || party.address || '—'}</Box>
          </Stack>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<Pencil size={15} />} onClick={() => setEditOpen(true)} sx={primaryBtnSx}>
          Edit Vendor
        </Button>
      </Box>

      <Grid container spacing={1.5}>
        {/* Left Column - General Info */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ ...panelSx, p: 2 }}>
            <Typography variant="subtitle1" sx={sectionHeaderStyle}>
              <User size={18} /> General Information
            </Typography>
            
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box>
                <Typography sx={infoLabelStyle}>Contact Person</Typography>
                <Typography sx={infoValueStyle}>{party.contactPerson || 'Not Specified'}</Typography>
              </Box>
              <Box>
                <Typography sx={infoLabelStyle}>Primary Email</Typography>
                <Typography sx={infoValueStyle} className="flex items-center gap-1">
                  <Mail size={14} /> {party.email || 'N/A'}
                </Typography>
              </Box>
              <Box>
                <Typography sx={infoLabelStyle}>Phone Number</Typography>
                <Typography sx={infoValueStyle} className="flex items-center gap-1">
                  <Phone size={14} /> {party.phone || 'N/A'}
                </Typography>
              </Box>
              <Divider />
              <Box>
                <Typography sx={infoLabelStyle}>GST Number</Typography>
                <Typography sx={infoValueStyle}>{party.gstNo || 'Not Provided'}</Typography>
              </Box>
              <Box>
                <Typography sx={infoLabelStyle}>PAN Number</Typography>
                <Typography sx={infoValueStyle}>{party.panNo || 'Not Provided'}</Typography>
              </Box>
              <Box>
                <Typography sx={infoLabelStyle}>Place</Typography>
                <Typography sx={infoValueStyle}>{party.location || '—'}</Typography>
              </Box>
              <Box>
                <Typography sx={infoLabelStyle}>Full Address</Typography>
                <Typography sx={infoValueStyle} style={{ whiteSpace: 'pre-line' }}>{party.address || 'Not Provided'}</Typography>
              </Box>
            </Box>
          </Paper>

          <Paper sx={{ ...panelSx, p: 2, mt: 1.5 }}>
            <Typography variant="subtitle1" sx={sectionHeaderStyle}>
              <CreditCard size={18} /> Commercial Terms
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box sx={{ flex: 1, p: 2, bgcolor: alpha('#2563eb', 0.05), borderRadius: '12px', textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} color="primary.main">{party.creditPeriodDays}</Typography>
                <Typography variant="caption" fontWeight={700} color="text.secondary">Credit Days</Typography>
              </Box>
              <Box sx={{ flex: 1, p: 2, bgcolor: alpha('#7c3aed', 0.05), borderRadius: '12px', textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} color="#7c3aed">{party.approxDays || party.leadTimeDays || 0}</Typography>
                <Typography variant="caption" fontWeight={700} color="text.secondary">Approx Days</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
              <Box sx={{ flex: 1, p: 2, bgcolor: alpha('#0f766e', 0.05), borderRadius: '12px', textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} color="#0f766e">{party.gstRate ?? 0}%</Typography>
                <Typography variant="caption" fontWeight={700} color="text.secondary">GST Rate</Typography>
              </Box>
              <Box sx={{ flex: 1, p: 2, bgcolor: alpha('#b45309', 0.05), borderRadius: '12px', textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} color="#b45309">{party.tdsRate ?? 0}%</Typography>
                <Typography variant="caption" fontWeight={700} color="text.secondary">TDS Rate</Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Right Column - Addresses & Email Routing */}
        <Grid item xs={12} md={8}>
          <Grid container spacing={3}>
            {/* Address Section */}
            <Grid item xs={12}>
              <Paper sx={{ ...panelSx, p: 2 }}>
                <Typography variant="subtitle1" sx={sectionHeaderStyle}>
                  <MapPin size={18} /> Registered Addresses
                </Typography>
                <Grid container spacing={2}>
                  {(party.addresses || []).map((addr, idx) => (
                    <Grid item xs={12} sm={6} key={idx}>
                      <Box sx={{ p: 2, border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                        <Typography variant="caption" fontWeight={800} color="primary.main" sx={{ mb: 1, display: 'block' }}>
                          {addr.label.toUpperCase()}
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>{addr.line1}</Typography>
                        <Typography variant="body2" color="text.secondary">{addr.line2}</Typography>
                        <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                          {addr.city}, {addr.state} {addr.pin}
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>

            {/* Email Routing Section */}
            <Grid item xs={12}>
              <Paper sx={{ ...panelSx, p: 2 }}>
                <Typography variant="subtitle1" sx={sectionHeaderStyle}>
                  <Globe size={18} /> Specialized Email Routing (Dispatch)
                </Typography>
                <Grid container spacing={2}>
                  {[
                    { label: 'TO Emails', data: party.toEmails, color: '#2563eb' },
                    { label: 'CC Emails', data: party.ccEmails, color: '#7c3aed' },
                    { label: 'BCC Emails', data: party.bccEmails, color: '#64748b' },
                    { label: 'Accounts Emails', data: party.accountsEmails, color: '#0f766e' },
                  ].map((group, idx) => (
                    <Grid item xs={12} sm={6} md={3} key={idx}>
                      <Box sx={{ height: '100%' }}>
                        <Typography variant="caption" fontWeight={800} sx={{ color: group.color, mb: 1, display: 'block' }}>
                          {group.label}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(group.data || []).length > 0 ? group.data.map((m, i) => (
                            <Chip key={i} label={m} size="small" variant="outlined" sx={{ fontSize: '0.65rem', borderColor: alpha(group.color, 0.2) }} />
                          )) : (
                            <Typography variant="caption" color="text.disabled">None set</Typography>
                          )}
                        </Box>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>

            {/* Ordered SKUs (Sales) — imported from the Party Details sheet */}
            <Grid item xs={12}>
              <Paper sx={{ ...panelSx, p: 2 }}>
                <Typography variant="subtitle1" sx={sectionHeaderStyle}>
                  <Package size={18} /> Ordered SKUs ({party.orderedSkus?.length || 0}) — auto-fill on Sales Order
                </Typography>
                {party.orderedSkus?.length ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ '& th': { fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary' } }}>
                          <TableCell>SKU</TableCell>
                          <TableCell>Code</TableCell>
                          <TableCell>Unit</TableCell>
                          <TableCell align="right">Pcs / Box</TableCell>
                          <TableCell align="right">Weight / Box</TableCell>
                          <TableCell align="right">SP (₹)</TableCell>
                          <TableCell align="center">Linked</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {party.orderedSkus.map((s, i) => (
                          <TableRow key={s._id || i} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{s.skuName}</TableCell>
                            <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{s.skuCode || '—'}</Typography></TableCell>
                            <TableCell>{s.unit || 'Pcs'}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.pcsPerBox || '—'}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.weightPerBox || '—'}</TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{Number(s.sellingPrice || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell align="center">{s.skuId ? <CheckCircle2 size={15} color="#0f766e" /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box sx={{ py: 3, textAlign: 'center', color: 'text.disabled' }}>
                    <Package size={26} /><Typography variant="body2" sx={{ mt: 1 }}>No ordered SKUs recorded for this client.</Typography>
                  </Box>
                )}
              </Paper>
            </Grid>

            {/* Linked SKUs Section */}
            <Grid item xs={12}>
              <Paper sx={{ ...panelSx, p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ ...sectionHeaderStyle, mb: 0 }}>
                    <Package size={18} /> Linked SKUs ({skusData?.meta?.total || 0})
                  </Typography>
                  <Button size="small" variant="outlined" startIcon={<Pencil size={13} />}
                    onClick={() => setSkusOpen(true)} sx={{ borderRadius: '8px' }}>
                    Manage SKUs
                  </Button>
                </Box>
                <Grid container spacing={2}>
                  {skusData?.data?.map((sku) => (
                    <Grid item xs={12} sm={6} key={sku._id}>
                      <Paper variant="outlined" sx={{ p: 2, borderRadius: '12px', borderStyle: 'dashed', '&:hover': { borderColor: 'primary.main', bgcolor: alpha('#2563eb', 0.02) } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <Box>
                            <Typography variant="body2" fontWeight={700}>{sku.name}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{sku.code}</Typography>
                          </Box>
                          <Chip label={sku.unit} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                        </Box>
                        <Box sx={{ mt: 1.5, display: 'flex', gap: 2 }}>
                          <Box>
                            <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>Packing</Typography>
                            <Typography variant="caption" fontWeight={700}>{sku.pcsPerBox} Pcs / Box</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>Weight</Typography>
                            <Typography variant="caption" fontWeight={700}>{sku.weightPerBox} Kgs</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>Price</Typography>
                            <Typography variant="caption" fontWeight={700} sx={{ color: sku.sellingPrice ? 'success.main' : 'text.disabled' }}>
                              {sku.sellingPrice ? `₹ ${Number(sku.sellingPrice).toLocaleString('en-IN')}` : 'Not set'}
                            </Typography>
                          </Box>
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>

            {/* Vendor Products Section (Purchase FMS) */}
            <Grid item xs={12}>
              <Paper sx={{ ...panelSx, p: 2 }}>
                <Typography variant="subtitle1" sx={{ ...sectionHeaderStyle, color: '#b45309' }}>
                  <Receipt size={18} /> Vendor Products ({party.suppliedProducts?.length || 0})
                </Typography>
                {party.suppliedProducts?.length ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Product Name</TableCell>
                          <TableCell>SKU Code</TableCell>
                          <TableCell align="right">Rate</TableCell>
                          <TableCell>Unit</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {party.suppliedProducts.map((p, i) => (
                          <TableRow key={p._id || i} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{p.productName || '—'}</TableCell>
                            <TableCell>
                              <Typography variant="body2" color="primary.main" fontWeight={700}>{p.skuCode || '—'}</Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {Number(p.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>{p.unit || 'Pcs'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box sx={{ py: 4, textAlign: 'center', color: 'text.disabled' }}>
                    <Package size={28} />
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      No products added yet. Click “Edit Vendor” to add the products this vendor supplies.
                    </Typography>
                  </Box>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Grid>
      </Grid>

      <PartyFormDrawer open={editOpen} party={party} onClose={() => setEditOpen(false)} />
      <PartySkusDrawer open={skusOpen} party={party} onClose={() => setSkusOpen(false)} />
    </Box>
  );
};

export default PartyDetails;
