import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { useSmartBack } from '../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, Tooltip, CircularProgress, TextField, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowLeft, Pencil, Hash, MapPin, CalendarClock, Hourglass, Percent, BadgePercent,
  User, Mail, Phone, FileText, CreditCard, Send, Copy, Package, History, Plus, Trash2, Search, X,
} from 'lucide-react';
import { useGetPartyByIdQuery, useRemovePartyOrderedSkuMutation } from '../../store/api/partyApi';
import { useGetOrdersByPartyQuery } from '../../store/api/orderApi';
import PartyFormDrawer from './PartyFormDrawer';
import PartyAddSkusDialog from './PartyAddSkusDialog';
import PartyOrderHistory from './PartyOrderHistory';
import PartyPill from './PartyPill';
import { TONE, cardSx, thSx, tdSx, numSx, money, unitTone, searchTerms, matchesAny } from './partyUi';
import { useMasterRights } from '../../utils/embed';
import { pageSx, primaryBtnSx, BRAND, BRAND_DK, NAVY, O2D } from '../../components/pageKit';

/**
 * Party detail — one screen that reads top to bottom:
 *   1. who (name, status, code, place) and Edit — the name in the page's
 *      own navy, no initials badge;
 *   2. the four commercial numbers (credit days, approx days, GST, TDS);
 *   3. General Information and Email Routing side by side;
 *   4. one card, two tabs:
 *      • Ordered SKUs — the SKUs this party orders (they fill in on its new
 *        Sales Orders): search, Add SKUs from the SKU master, remove;
 *      • Order History — every Sales Order it placed, item by item, with
 *        search and Excel export (PartyOrderHistory).
 * Vendor products are still edited in "Edit Vendor".
 */

const addressLine = (a) => {
  const text = [a.line1, a.line2, a.city, a.state].filter(Boolean).join(', ');
  return a.pin ? `${text}${text ? ' - ' : ''}${a.pin}` : text;
};
// Same address written twice (the sheet's full address and a registered one)?
const plain = (s = '') => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameAddress = (a, b) => {
  const x = plain(a);
  const y = plain(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

/** One of the four commercial numbers. */
const StatTile = ({ icon, label, value, color, last }) => {
  const Icon = icon;
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.6, minWidth: 0,
      background: `linear-gradient(90deg, ${alpha(color, 0.07)}, ${alpha(color, 0.015)})`,
      borderRight: { md: last ? 0 : `1px solid ${O2D.lineSoft}` },
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '10px', flexShrink: 0, display: 'grid', placeItems: 'center',
        bgcolor: O2D.surface, color, border: `1px solid ${alpha(color, 0.2)}`, boxShadow: `0 2px 6px ${alpha(color, 0.12)}`,
      }}>
        <Icon size={19} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: O2D.sub, lineHeight: 1.2 }}>{label}</Typography>
        <Typography sx={{ fontSize: '1.45rem', fontWeight: 800, color, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      </Box>
    </Box>
  );
};

/** A card with a coloured top line and an icon header. */
const Panel = ({ icon, title, note, accent, children }) => {
  const Icon = icon;
  return (
    <Paper sx={{ ...cardSx, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: 3, background: `linear-gradient(90deg, ${accent[0]}, ${accent[1]})` }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.4, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Box sx={{
          width: 32, height: 32, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
          color: accent[0], bgcolor: alpha(accent[0], 0.08), border: `1px solid ${alpha(accent[0], 0.18)}`,
        }}>
          <Icon size={16} />
        </Box>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: NAVY }}>
          {title}
          {note && <Box component="span" sx={{ fontWeight: 500, color: O2D.sub }}> ({note})</Box>}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Paper>
  );
};

/** General Information row: icon, label, value (grey "Not provided" when empty). */
const InfoRow = ({ icon, color, label, value, children }) => {
  const Icon = icon;
  const empty = !children && !value;
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px minmax(0, 1fr)' }, alignItems: 'center',
      columnGap: 2, rowGap: 0.5, px: 2, py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}`, '&:last-of-type': { borderBottom: 0 },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <Box sx={{
          width: 26, height: 26, borderRadius: '7px', flexShrink: 0, display: 'grid', placeItems: 'center',
          color, bgcolor: alpha(color, 0.08), border: `1px solid ${alpha(color, 0.16)}`,
        }}>
          <Icon size={13} />
        </Box>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.body }}>{label}</Typography>
      </Box>
      {children || (
        <Typography sx={{ fontSize: '0.86rem', fontWeight: empty ? 500 : 700, color: empty ? O2D.faint : NAVY, overflowWrap: 'anywhere' }}>
          {empty ? 'Not provided' : value}
        </Typography>
      )}
    </Box>
  );
};

/** An email address with a copy button. */
const EmailChip = ({ email, color, onCopy }) => (
  <Box sx={{
    display: 'inline-flex', alignItems: 'center', gap: 0.75, maxWidth: '100%', pl: 1.1, pr: 0.5, py: 0.4,
    borderRadius: '7px', bgcolor: alpha(color, 0.05), border: `1px solid ${alpha(color, 0.18)}`,
  }}>
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: BRAND_DK, overflowWrap: 'anywhere' }}>{email}</Typography>
    <Tooltip title="Copy">
      <IconButton size="small" onClick={() => onCopy(email)} aria-label={`Copy ${email}`}
        sx={{ p: 0.4, color: O2D.faint, '&:hover': { color } }}>
        <Copy size={13} />
      </IconButton>
    </Tooltip>
  </Box>
);

const PartyDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/parties');
  const { enqueueSnackbar } = useSnackbar();
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState('ordered');
  const [historySeen, setHistorySeen] = useState(false);
  const [skuText, setSkuText] = useState('');
  const [removing, setRemoving] = useState(null); // the Ordered SKU row asked to remove
  // Delegation Suite lock icon → Parties → Edit (also adds / removes Ordered SKUs).
  const { canEdit } = useMasterRights('parties');

  const { data: partyRes, isLoading: partyLoading } = useGetPartyByIdQuery(id);
  const party = partyRes?.data; // API wraps the doc in { success, message, data }
  // The Order History count on its tab, once that tab has been opened (the
  // same request the tab itself makes, so it is fetched once).
  const { data: ordersRes } = useGetOrdersByPartyQuery({ partyId: id, limit: 1000, sort: '-orderDate' }, { skip: !historySeen });
  const [removeSku, { isLoading: removingNow }] = useRemovePartyOrderedSkuMutation();

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

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      enqueueSnackbar('Copied', { variant: 'success', autoHideDuration: 1200 });
    } catch {
      enqueueSnackbar("Couldn't copy — select the text instead", { variant: 'warning' });
    }
  };

  const confirmRemove = async () => {
    try {
      const res = await removeSku({ id: party._id, itemId: removing._id }).unwrap();
      enqueueSnackbar(res?.message || 'Removed', { variant: 'success' });
      setRemoving(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || "Couldn't remove it. Please try again.", { variant: 'error' });
    }
  };

  const status = String(party.status || (party.isActive === false ? 'INACTIVE' : 'ACTIVE'));
  const statusColor = status === 'ACTIVE' ? TONE.green : O2D.sub;
  const statusLabel = status.charAt(0) + status.slice(1).toLowerCase();

  // The sheet's full address first, then any registered address that is not
  // the same one written again.
  const addresses = [];
  if (party.address) addresses.push({ label: 'Primary', text: party.address });
  (party.addresses || []).forEach((a) => {
    const text = addressLine(a);
    if (text && !addresses.some((x) => sameAddress(x.text, text))) addresses.push({ label: a.label || 'Address', text });
  });

  const routing = [
    { label: 'TO emails', data: party.toEmails, color: TONE.blue },
    { label: 'CC emails', data: party.ccEmails, color: TONE.violet },
    { label: 'BCC emails', data: party.bccEmails, color: TONE.slate },
    { label: 'Accounts emails', data: party.accountsEmails, color: TONE.green },
  ];

  const ordered = party.orderedSkus || [];
  const skuTerms = searchTerms(skuText);
  const orderedShown = ordered.filter((s) => matchesAny(skuTerms, `${s.skuName || ''} ${s.skuCode || ''}`.toLowerCase()));
  const notInMaster = ordered.filter((s) => !s.skuId).length;
  const orderCount = ordersRes?.data?.length;

  const tabs = [
    { key: 'ordered', label: 'Ordered SKUs', icon: Package, count: ordered.length },
    { key: 'history', label: 'Order History', icon: History, count: orderCount },
  ];
  const openTab = (key) => {
    setTab(key);
    if (key === 'history') setHistorySeen(true);
  };

  return (
    <Box sx={pageSx}>
      {/* ── Who ───────────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <IconButton onClick={goBack} size="small" aria-label="Back"
          sx={{ width: 36, height: 36, borderRadius: '9px', flexShrink: 0, color: O2D.sub, bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, '&:hover': { color: BRAND, borderColor: alpha(BRAND, 0.4) } }}>
          <ArrowLeft size={17} />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: { xs: '1.15rem', md: '1.35rem' }, fontWeight: 800, color: NAVY, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {party.name}
            </Typography>
            <PartyPill color={statusColor} dot>{statusLabel}</PartyPill>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.6, flexWrap: 'wrap' }}>
            {party.code && <PartyPill color={TONE.code} icon={Hash}>{party.code}</PartyPill>}
            {party.location && <PartyPill color={TONE.blue} icon={MapPin}>{party.location}</PartyPill>}
          </Box>
        </Box>
        {canEdit && (
          <Button variant="contained" startIcon={<Pencil size={15} />} onClick={() => setEditOpen(true)}
            sx={{ ...primaryBtnSx, flexShrink: 0, flexBasis: { xs: '100%', sm: 'auto' } }}>
            Edit Vendor
          </Button>
        )}
      </Box>

      {/* ── The four commercial numbers ──────────────────────────────────── */}
      <Paper sx={{ ...cardSx, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
        <StatTile icon={CalendarClock} label="Credit Days" value={party.creditPeriodDays ?? 0} color={TONE.blue} />
        <StatTile icon={Hourglass} label="Approx Days" value={party.approxDays || party.leadTimeDays || 0} color={TONE.violet} />
        <StatTile icon={Percent} label="GST Rate" value={`${party.gstRate ?? 0}%`} color={TONE.green} />
        <StatTile icon={BadgePercent} label="TDS Rate" value={`${party.tdsRate ?? 0}%`} color={TONE.amber} last />
      </Paper>

      {/* ── Details and email routing ────────────────────────────────────── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        <Panel icon={User} title="General Information" accent={[TONE.indigo, TONE.blue]}>
          <InfoRow icon={User} color={TONE.violet} label="Contact person" value={party.contactPerson} />
          <InfoRow icon={Mail} color={TONE.blue} label="Primary email" value={party.email} />
          <InfoRow icon={Phone} color={TONE.green} label="Phone number" value={party.phone} />
          <InfoRow icon={FileText} color={TONE.amber} label="GST number" value={party.gstNo} />
          <InfoRow icon={CreditCard} color={TONE.indigo} label="PAN number" value={party.panNo} />
          <InfoRow icon={MapPin} color={TONE.rose} label="Address">
            {addresses.length ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {addresses.map((a, i) => (
                  <Box key={i}>
                    <PartyPill color={TONE.rose} sx={{ height: 20, mb: 0.5 }}>{a.label}</PartyPill>
                    <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: NAVY, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                      {a.text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography sx={{ fontSize: '0.86rem', color: O2D.faint }}>Not provided</Typography>
            )}
          </InfoRow>
        </Panel>

        <Panel icon={Send} title="Email Routing" note="Dispatch" accent={[TONE.teal, TONE.green]}>
          {routing.map((group) => (
            <Box key={group.label} sx={{
              display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px minmax(0, 1fr)' }, alignItems: 'center',
              columnGap: 2, rowGap: 0.75, px: 2, py: 1.6, borderBottom: `1px solid ${O2D.lineSoft}`, '&:last-of-type': { borderBottom: 0 },
            }}>
              <Box><PartyPill color={group.color}>{group.label}</PartyPill></Box>
              {(group.data || []).length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, minWidth: 0 }}>
                  {group.data.map((m) => <EmailChip key={m} email={m} color={group.color} onCopy={copy} />)}
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.84rem', color: O2D.faint }}>None set</Typography>
              )}
            </Box>
          ))}
        </Panel>
      </Box>

      {/* ── Ordered SKUs · Order History ─────────────────────────────────── */}
      <Paper sx={cardSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1.5, borderBottom: `1px solid ${O2D.line}` }}>
          <Box role="tablist" aria-label="Party SKUs and orders" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
            {tabs.map((t) => {
              const active = tab === t.key;
              const TIcon = t.icon;
              return (
                <Box key={t.key} component="button" type="button" role="tab" aria-selected={active}
                  onClick={() => openTab(t.key)}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.9, px: 1.5, py: 1.4, border: 0, bgcolor: 'transparent',
                    cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit', fontSize: '0.88rem', fontWeight: 800,
                    color: active ? BRAND : O2D.sub, borderBottom: `2px solid ${active ? BRAND : 'transparent'}`, mb: '-1px',
                    '&:hover': { color: active ? BRAND : NAVY },
                    '&:focus-visible': { outline: `2px solid ${alpha(BRAND, 0.5)}`, outlineOffset: -2, borderRadius: '6px' },
                  }}>
                  <TIcon size={16} />
                  {t.label}
                  {t.count !== undefined && (
                    <Box component="span" sx={{
                      minWidth: 20, height: 20, px: 0.6, borderRadius: '10px', display: 'inline-grid', placeItems: 'center',
                      fontSize: '0.68rem', fontWeight: 800,
                      bgcolor: active ? alpha(BRAND, 0.1) : '#f1f5f9', color: active ? BRAND : O2D.sub,
                    }}>
                      {t.count}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          {tab === 'ordered' && (
            <Box sx={{ ml: 'auto', py: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
              <PartyPill color={TONE.blue}>Auto-fills on Sales Order</PartyPill>
              {canEdit && (
                <Button size="small" variant="contained" startIcon={<Plus size={15} />} onClick={() => setAddOpen(true)}
                  sx={{ ...primaryBtnSx, height: 32 }}>
                  Add SKUs
                </Button>
              )}
            </Box>
          )}
        </Box>

        {tab === 'ordered' && (ordered.length ? (
          <>
            {ordered.length > 6 && (
              <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
                <TextField
                  size="small"
                  value={skuText}
                  onChange={(e) => setSkuText(e.target.value)}
                  placeholder="Search SKU name or code — commas for several"
                  sx={{ width: '100%', maxWidth: 460, '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '0.84rem' } }}
                  InputProps={{
                    startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
                    endAdornment: skuText ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSkuText('')} aria-label="Clear search"><X size={14} /></IconButton>
                      </InputAdornment>
                    ) : null,
                  }}
                  inputProps={{ 'aria-label': 'Search ordered SKUs' }}
                />
              </Box>
            )}
            {orderedShown.length ? (
              <TableContainer>
                <Table size="small" sx={{ minWidth: 560 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...thSx, width: 64 }}>S.No.</TableCell>
                      <TableCell sx={thSx}>SKU</TableCell>
                      <TableCell sx={thSx}>Unit</TableCell>
                      <TableCell sx={{ ...thSx, textAlign: 'right' }}>Price (₹)</TableCell>
                      <TableCell sx={thSx}>Last ordered</TableCell>
                      {canEdit && <TableCell sx={{ ...thSx, width: 56 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderedShown.map((s, i) => (
                      <TableRow key={s._id || i} hover data-sku={s.skuCode || s.skuName}>
                        <TableCell sx={{ ...tdSx, color: O2D.sub, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</TableCell>
                        <TableCell sx={tdSx}>
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: BRAND_DK }}>{s.skuName || '—'}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                            {s.skuCode && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, fontWeight: 700 }}>{s.skuCode}</Typography>}
                            {!s.skuId && (
                              <Tooltip title="Not tied to the SKU master yet — add it from “Add SKUs” to link it">
                                <Box component="span" sx={{ fontSize: '0.68rem', fontWeight: 700, color: O2D.faint }}>· not in SKU master</Box>
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell sx={tdSx}><PartyPill color={unitTone(s.unit || 'Pcs')}>{s.unit || 'Pcs'}</PartyPill></TableCell>
                        <TableCell sx={{ ...numSx, fontWeight: 800 }}>{money(s.sellingPrice)}</TableCell>
                        <TableCell sx={{ ...tdSx, color: s.lastOrderedAt ? O2D.body : O2D.faint, whiteSpace: 'nowrap' }}>
                          {s.lastOrderedAt ? dayjs(s.lastOrderedAt).format('DD MMM YYYY') : 'Not yet'}
                        </TableCell>
                        {canEdit && (
                          <TableCell sx={{ ...tdSx, textAlign: 'right' }}>
                            <Tooltip title="Remove from this party">
                              <IconButton size="small" onClick={() => setRemoving(s)} aria-label={`Remove ${s.skuName || s.skuCode}`}
                                sx={{ color: O2D.faint, '&:hover': { color: TONE.rose, bgcolor: alpha(TONE.rose, 0.08) } }}>
                                <Trash2 size={15} />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography sx={{ py: 4, textAlign: 'center', fontSize: '0.84rem', color: O2D.sub }}>Nothing matches “{skuText}”.</Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 2, py: 1.1, borderTop: `1px solid ${O2D.lineSoft}`, bgcolor: '#fbfcfe', fontSize: '0.74rem', color: O2D.sub }}>
              <span>{ordered.length} SKU{ordered.length === 1 ? '' : 's'} · fill in on this party&apos;s new Sales Orders</span>
              {notInMaster > 0 && <span>· {notInMaster} not in the SKU master</span>}
            </Box>
          </>
        ) : (
          <Box sx={{ py: 5, textAlign: 'center', color: O2D.faint }}>
            <Package size={28} />
            <Typography sx={{ mt: 1, fontSize: '0.84rem', color: O2D.sub }}>
              No ordered SKUs yet.{canEdit ? ' Use “Add SKUs” to add the items this party orders.' : ''}
            </Typography>
          </Box>
        ))}

        {tab === 'history' && <PartyOrderHistory party={party} />}
      </Paper>

      <PartyFormDrawer open={editOpen} party={party} onClose={() => setEditOpen(false)} />
      <PartyAddSkusDialog open={addOpen} party={party} onClose={() => setAddOpen(false)} />

      <Dialog open={Boolean(removing)} onClose={removingNow ? undefined : () => setRemoving(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: '12px' } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 800, color: NAVY }}>
          Remove {removing?.skuName || removing?.skuCode}?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.86rem', color: O2D.body }}>
            It stops filling in on new Sales Orders for {party.name}. Past orders are not changed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoving(null)} disabled={removingNow} sx={{ textTransform: 'none', fontWeight: 800, color: O2D.sub }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmRemove} disabled={removingNow} data-remove-confirm
            sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '8px', boxShadow: 'none' }}>
            {removingNow ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PartyDetails;
