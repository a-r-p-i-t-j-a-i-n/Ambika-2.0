import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Dialog, DialogContent,
  DialogTitle, DialogContentText, DialogActions, Table, TableHead, TableBody, TableRow, TableCell,
  CircularProgress, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Recycle, Plus, X, Disc3, CircleDashed, Trash2, ArrowUpRight, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { FIELD } from '../ims/imsFieldHelp';

import {
  RmShell, Panel, TableScroll, KpiTile, EmptyNote, Th, KindChip, YieldChip, ScrapChip, yieldBand,
  O2D, O2D_TIP, STOCK_TOKENS, num, imsTableSx,
} from './rmImsMeta';
import { useGetRmConversionsQuery } from '../../store/api/rmImsApi';
import CuttingHistoryPanel from './CuttingHistoryPanel';
import CoilToCircleForm from './CoilToCircleForm';

const H = FIELD.rm;

/**
 * ALL CONVERSIONS — every recorded cut, one row per cut, newest first.
 *
 * Kept, collapsed, under the history: it is the only list on this page that
 * also shows the cuts naming no physical coil (the spreadsheet-era imports and
 * "No receipt available"), which the coil history above deliberately does not
 * turn into rounds. Fetched only once opened.
 */
const AllConversionsPanel = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: convRes, isFetching, isError } = useGetRmConversionsQuery({ limit: 50 }, { skip: !open });
  const conversions = convRes?.data || [];
  const totals = convRes?.meta || {};

  return (
    <Panel title="All conversions" icon={Recycle} dense
      hint={!open ? 'Every recorded cut, one row per cut — including older cuts that name no physical coil.'
        : totals.conversionCount > conversions.length
          ? `The ${num(conversions.length)} most recent of ${num(totals.conversionCount)} cuts. The totals cover all of them.`
          : 'Every coil cut so far, newest first.'}
      actions={(
        <Button size="small" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="all-conversions-toggle"
          startIcon={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
          {open ? 'Hide' : 'Show'}
        </Button>
      )}>
      {open && (
        <>
          {isFetching && !convRes && (
            <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={18} /></Stack>
          )}
          {isError && (
            <EmptyNote icon={AlertTriangle} tone="#b91c1c" dense title="Could not load the conversions" hint="Close and reopen this section to try again." />
          )}
          {convRes && (
            <>
              {/* These four cover EVERY recorded cut, not just the rows listed
                  below, so the subtitle says how many — otherwise the reader
                  assumes the two match. */}
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ p: 1.25 }}>
                <KpiTile label="Coil consumed" value={`${num(totals.coilKg)} kg`}
                  sub={totals.conversionCount ? `Across all ${num(totals.conversionCount)} recorded cuts` : 'Across recorded conversions'}
                  color="#0f766e" icon={Disc3} />
                <KpiTile label="Circles produced" value={`${num(totals.circlesKg)} kg`} sub="Added back to stock" color="#4338ca" icon={CircleDashed} />
                <KpiTile label="Scrap" value={`${num(totals.scrapKg)} kg`} sub="Offcuts and losses" color="#b45309" icon={Trash2} />
                <KpiTile label="Average yield" value={`${num(totals.avgYield)}%`} sub="Higher is better"
                  color={yieldBand(totals.avgYield).color} icon={Recycle} />
              </Stack>
              <TableScroll>
                <Table size="small" sx={imsTableSx(1060)}>
                  <TableHead>
                    <TableRow>
                      <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                      <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                      <TableCell>Batch</TableCell>
                      <TableCell>Coil</TableCell>
                      <TableCell><Th label="Came from" hint={H.reference} /></TableCell>
                      <TableCell align="right">Coil used</TableCell>
                      <TableCell align="right">Circles made</TableCell>
                      <TableCell align="right">Scrap</TableCell>
                      <TableCell><Th label="Yield" hint={H.yieldPct} /></TableCell>
                      <TableCell>Scrap checked?</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {conversions.length === 0 && (
                      <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                        <EmptyNote icon={Recycle} title="No coils cut yet"
                          hint="Record the first one with “+ Coil to Circle” and it will be listed here." />
                      </TableCell></TableRow>
                    )}
                    {conversions.map((c, i) => (
                      <TableRow key={c._id} hover>
                        <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: O2D.ink }}>{dayjs(c.conversionDate).format('DD MMM YYYY')}</TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{c.batchNo || '—'}</Typography>
                          <Typography sx={{ fontSize: '0.65rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>{c.conversionNumber}</Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 220 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <KindChip kind="COIL" withHint={false} />
                            <Typography noWrap sx={{ fontSize: '0.78rem', color: O2D.body }} title={c.coilSkuName}>{c.coilSkuCode}</Typography>
                          </Stack>
                        </TableCell>
                        {/* Traceable back to the delivery, where the cut recorded it. */}
                        <TableCell sx={{ maxWidth: 190 }}>
                          {c.manualCoil ? (
                            // A manual-entry coil: traceable to the coil, with no
                            // GRN, PO or supplier — and none is shown.
                            <Tooltip arrow slotProps={O2D_TIP}
                              title={`Manual entry — no goods receipt · ${num(c.manualCoil.originalWeightKg)} kg in total${c.manualCoil.warehouse ? ` · ${c.manualCoil.warehouse}` : ''}`}>
                              <Box
                                role="button" tabIndex={0}
                                onClick={() => navigate(`/rm-ims/coil/${c.manualCoilId}`)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/rm-ims/coil/${c.manualCoilId}`); }}
                                sx={{ minWidth: 0, cursor: 'pointer', borderRadius: '4px', '&:hover .lin': { textDecoration: 'underline' } }}
                              >
                                <Typography noWrap className="lin" sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.brand }}>Manual entry</Typography>
                                <Typography noWrap sx={{ fontSize: '0.64rem', color: O2D.sub }}>no GRN · {c.manualCoil.batchNo}</Typography>
                              </Box>
                            </Tooltip>
                          ) : c.receipt ? (
                            <Tooltip arrow slotProps={O2D_TIP} title={[
                              c.receipt.grnNumber && `GRN ${c.receipt.grnNumber}`,
                              c.receipt.poNumber && `PO ${c.receipt.poNumber}`,
                              c.receipt.supplier,
                              c.receipt.receivedDate && `received ${dayjs(c.receipt.receivedDate).format('DD MMM YYYY')}`,
                              c.receipt.unitCost && `₹${num(c.receipt.unitCost)}/kg`,
                            ].filter(Boolean).join(' · ') || 'Goods receipt recorded'}>
                              {/* The link is offered ONLY where a physical receipt is
                                  known. A row with no `coilReceiptId` has a grade and
                                  not a coil, and a link that opened "some coil of this
                                  material" would be a lie dressed as traceability. */}
                              <Box
                                role="button" tabIndex={0}
                                onClick={() => navigate(`/rm-ims/coil/${c.coilReceiptId}`)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/rm-ims/coil/${c.coilReceiptId}`); }}
                                sx={{
                                  minWidth: 0, cursor: 'pointer', borderRadius: '4px',
                                  '&:hover .lin': { textDecoration: 'underline' },
                                }}
                              >
                                <Typography noWrap className="lin" sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.brand }}>
                                  {c.receipt.grnNumber || c.receipt.poNumber || c.receipt.movementNumber}
                                </Typography>
                                <Typography noWrap sx={{ fontSize: '0.64rem', color: O2D.sub }}>
                                  {c.receipt.supplier || c.receipt.warehouse || '—'}
                                </Typography>
                              </Box>
                            </Tooltip>
                          ) : (
                            <Tooltip arrow slotProps={O2D_TIP}
                              title="This cut names no goods receipt, so its scrap cannot be traced to a physical coil. Every historical cut is like this, and nothing is guessed after the fact.">
                              <Typography sx={{ fontSize: '0.7rem', color: O2D.faint, cursor: 'help' }}>untraceable</Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.coilWeightKg)} kg</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#4338ca', fontWeight: 700 }}>{num(c.circlesWeightKg)} kg</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{num(c.scrapKg)} kg</TableCell>
                        <TableCell><YieldChip pct={c.yieldRatioPct} /></TableCell>
                        <TableCell><ScrapChip state={c.scrapVerified} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            </>
          )}
        </>
      )}
    </Panel>
  );
};

/**
 * COIL TO CIRCLE — the Cut Coils page.
 *
 * Opens on the history: every physical coil cut so far, filterable by batch,
 * cutting date, circle produced and location. Recording a new cutting round is
 * one click away — "+ Coil to Circle" opens the entry form in a dialog, the
 * same form with the same rules it always had (CoilToCircleForm.jsx).
 *
 * The dialog closes on a successful save; the history and its cards refresh
 * themselves through RTK Query's tags, and the page points at the coil just
 * cut. Closing a form with something entered asks first; it cannot be closed
 * at all while a save is in flight. Filters on the history are untouched by
 * any of this — the history stays mounted underneath the dialog.
 *
 * `?new=1` opens the form straight away, for the "Cut a coil" shortcuts
 * elsewhere in RM IMS.
 */
const RmImsConversion = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(() => params.get('new') === '1');
  const [formState, setFormState] = useState({ dirty: false, saving: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lastCut, setLastCut] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // The shortcut has done its job once the form is open; a reload of this
  // page should land on the history, not reopen the form.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openForm = () => {
    setFormState({ dirty: false, saving: false });
    setFormOpen(true);
  };
  const closeForm = () => { setConfirmDiscard(false); setFormOpen(false); };
  // Every way out — Close, Cancel, Esc, a click outside — comes through here.
  const requestClose = () => {
    if (formState.saving) return;
    if (formState.dirty) setConfirmDiscard(true);
    else closeForm();
  };
  const onFormState = useCallback((s) => setFormState(s), []);
  const onSaved = (saved) => {
    const coilId = saved.coilReceiptId || saved.manualCoilId;
    setLastCut({
      coilId: coilId || null,
      batchNo: saved.batchNo || '',
      conversionNumber: saved.conversionNumber || '',
    });
    setRefreshKey((k) => k + 1);
    closeForm();
  };

  return (
    <RmShell
      icon={Recycle}
      title="Coil to Circle"
      subtitle="View cutting records, track remaining coil weight and record new cutting rounds."
      actions={(
        <Button variant="contained" disableElevation onClick={openForm} startIcon={<Plus size={16} />}
          data-testid="open-coil-to-circle"
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '7px', bgcolor: O2D.brand, px: 2, py: 0.75, fontSize: '0.82rem' }}>
          Coil to Circle
        </Button>
      )}
    >
      {/* Straight from the save to the coil that was just cut. */}
      {lastCut && (
        <Paper elevation={0} data-testid="last-cut-banner" sx={{
          borderRadius: '8px', px: 1.5, py: 0.9,
          border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
        }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Disc3 size={15} /></Box>
            <Typography sx={{ fontSize: '0.75rem', color: O2D.body }}>
              {lastCut.conversionNumber ? <>Conversion <b>{lastCut.conversionNumber}</b> saved</> : 'Saved'}
              {lastCut.batchNo ? <> against coil <b>{lastCut.batchNo}</b></> : ''}. The history below is up to date.
            </Typography>
            {lastCut.coilId && (
              <Button size="small" endIcon={<ArrowUpRight size={13} />} sx={{ ml: { sm: 'auto' }, textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}
                onClick={() => navigate(`/rm-ims/coil/${lastCut.coilId}`)}>
                See every round on this coil
              </Button>
            )}
            <Button size="small" color="inherit" onClick={() => setLastCut(null)}
              sx={{ ml: lastCut.coilId ? 0 : { sm: 'auto' }, textTransform: 'none', fontSize: '0.72rem', color: O2D.sub }}>Dismiss</Button>
          </Stack>
        </Paper>
      )}

      <CuttingHistoryPanel refreshKey={refreshKey} />

      <AllConversionsPanel />

      {/* ── The entry form ── */}
      <Dialog
        open={formOpen}
        onClose={requestClose}
        fullScreen={fullScreen}
        maxWidth={false}
        scroll="paper"
        aria-labelledby="coil-to-circle-form-title"
        PaperProps={{
          'data-testid': 'coil-to-circle-dialog',
          sx: {
            width: '100%', maxWidth: 1180, height: fullScreen ? '100%' : '94vh',
            m: fullScreen ? 0 : 2, borderRadius: fullScreen ? 0 : '12px', bgcolor: O2D.canvas,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}
          sx={{ px: { xs: 1.5, md: 2 }, py: 1.1, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '7px', display: 'grid', placeItems: 'center', bgcolor: `${O2D.brand}1a`, color: O2D.brand, flexShrink: 0 }}>
            <Recycle size={17} />
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography id="coil-to-circle-form-title" sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
              Coil to Circle — record a cutting round
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              One entry takes the coil out of stock, puts the circles in, and records the scrap.
            </Typography>
          </Box>
          <Tooltip arrow slotProps={O2D_TIP} title={formState.saving ? 'Saving — wait for it to finish' : 'Close'}>
            <span>
              <IconButton onClick={requestClose} disabled={formState.saving} aria-label="Close the Coil to Circle form" data-testid="close-coil-to-circle">
                <X size={18} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <DialogContent sx={{ p: { xs: 1.25, md: 1.75 }, bgcolor: O2D.canvas }}>
          <CoilToCircleForm onSaved={onSaved} onCancel={requestClose} onStateChange={onFormState} />
        </DialogContent>
      </Dialog>

      {/* ── Closing a form with something entered ── */}
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth="xs" fullWidth
        aria-labelledby="discard-coil-to-circle-title" PaperProps={{ 'data-testid': 'discard-dialog' }}>
        <DialogTitle id="discard-coil-to-circle-title" sx={{ fontSize: '0.95rem', fontWeight: 800 }}>Discard this entry?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.8rem' }}>
            The coil, weights and circles entered in this form have not been saved and will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Button onClick={() => setConfirmDiscard(false)} autoFocus sx={{ textTransform: 'none', fontWeight: 700 }}>Keep editing</Button>
          <Button onClick={closeForm} color="error" variant="contained" disableElevation sx={{ textTransform: 'none', fontWeight: 700 }}>
            Discard
          </Button>
        </DialogActions>
      </Dialog>
    </RmShell>
  );
};

export default RmImsConversion;
