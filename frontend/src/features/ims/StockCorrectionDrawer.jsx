import React, { useMemo, useRef, useState } from 'react';
import {
  Dialog, Box, Stack, Typography, TextField, MenuItem, Button, Autocomplete, Checkbox, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell, Chip, Tooltip, CircularProgress, useMediaQuery,
  createFilterOptions,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ClipboardCheck, X, Search, Trash2, Save, ArrowRight } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import {
  O2D, O2D_TIP, STOCK_TOKENS, num, newRequestId, TableScroll, EmptyNote, imsTableSx,
} from './imsMeta';
import { useGetStockCorrectionSkusQuery, useCorrectStockMutation } from '../../store/api/stockCorrectionApi';

/**
 * STOCK CORRECTION — the popup that opens, centred, from IMS → Stock Correction.
 *
 * The system says 100, the shelf holds 98. Pick the items (search by code or
 * name, several at once), type what was physically counted, add a remark if
 * you like, save. The stock becomes the count in whichever module the item
 * belongs to — Raw Material, Consumables & Packaging or Finished Goods — and
 * every screen shows it. Who and when are recorded by the server.
 *
 * "All items" is those three. Scrap is its own pick: the coil SKUs of Scrap
 * master data, each with the scrap weight its cuts left (kg, per cutting
 * location), corrected the same way — recorded → weighed.
 *
 * One line per item AND location, because stock is held per location and a
 * count is of one shelf. Each line keeps the system figure it was counted
 * against; if the stock moved meanwhile the server refuses that line rather
 * than correct the wrong base (stockCorrection.service.js).
 */

const MODULES = [
  { value: '', label: 'All items' },
  { value: 'RM', label: 'Raw Material' },
  { value: 'CP', label: 'Consumables & Packaging' },
  { value: 'FG', label: 'Finished Goods' },
  // Scrap master data: each coil SKU's scrap weight, not an item's stock.
  { value: 'SCRAP', label: 'Scrap' },
];
const MODULE_TONE = {
  RM: { label: 'Raw Material', group: 'Raw Material', color: '#1d4ed8' },
  CP: { label: 'Consumables', group: 'Consumables & Packaging', color: '#0f766e' },
  FG: { label: 'Finished Goods', group: 'Finished Goods', color: '#7c3aed' },
  SCRAP: { label: 'Scrap', group: 'Scrap — by coil SKU', color: '#b45309' },
};
// The order the list is grouped in.
const MODULE_ORDER = ['RM', 'CP', 'FG', 'SCRAP'];

/**
 * THE ITEM LIST, WINDOWED — only the rows in view are on the page.
 *
 * Every item of three modules is a long list, and an option is a checkbox and
 * two lines of text; mounting all of them on every tick is what made
 * picking feel stuck. Rows are a fixed height, so the list knows where each
 * one sits and renders the ~12 in view (plus a few either side) as it scrolls.
 * Autocomplete hands groups over as plain objects (renderGroup returns its
 * params), which are flattened here into a header row and its options.
 */
const OPTION_H = 48;
const GROUP_H = 30;
const LIST_MAX_H = 384;
const VirtualListbox = React.forwardRef(function VirtualListbox(props, ref) {
  const { children, style, ...other } = props;
  const items = useMemo(() => {
    const out = [];
    (Array.isArray(children) ? children : [children]).forEach((g) => {
      if (!g) return;
      if (g.group !== undefined) {
        out.push({ key: `group-${g.key}`, header: g.group });
        (g.children || []).forEach((el) => out.push({ key: el.key, el }));
      } else {
        out.push({ key: g.key, el: g });
      }
    });
    return out;
  }, [children]);
  const offsets = useMemo(() => {
    let y = 0;
    return items.map((it) => { const top = y; y += it.header ? GROUP_H : OPTION_H; return top; });
  }, [items]);
  const total = items.length ? offsets[items.length - 1] + (items[items.length - 1].header ? GROUP_H : OPTION_H) : 0;
  const height = Math.min(LIST_MAX_H, total);
  const [scrollTop, setScrollTop] = useState(0);
  const top = Math.min(scrollTop, Math.max(0, total - height));
  // The first row in view (binary search over the fixed offsets).
  let lo = 0;
  let hi = items.length - 1;
  let first = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= top) { first = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const start = Math.max(0, first - 4);
  let end = first;
  while (end < items.length && offsets[end] < top + height) end += 1;
  end = Math.min(items.length, end + 4);

  return (
    <div ref={ref} {...other}
      style={{ ...style, height, maxHeight: 'none', overflowY: 'auto', position: 'relative', padding: 0 }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>
        {items.slice(start, end).map((it, i) => (
          <div key={it.key} style={{ position: 'absolute', top: offsets[start + i], left: 0, right: 0, height: it.header ? GROUP_H : OPTION_H }}>
            {it.header ? (
              <Box sx={{
                height: GROUP_H, px: 1.5, display: 'flex', alignItems: 'center', bgcolor: O2D.surfaceAlt,
                fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub,
                borderBottom: `1px solid ${O2D.lineSoft}`,
              }}>{it.header}</Box>
            ) : it.el}
          </div>
        ))}
      </div>
    </div>
  );
});
// The search box matches the code or the name, anywhere in it, any case.
const filterByCodeOrName = createFilterOptions({ stringify: (o) => `${o.skuCode} ${o.skuName}` });
const LOCATION_LABEL = { PLG01: 'PLG01 — In-house', JW001: 'JW001 — Job work', MAIN: 'Main store' };
const isScrap = (sku) => sku.module === 'SCRAP';
const locationText = (w) => LOCATION_LABEL[w] || w;

const ModuleChip = ({ module }) => {
  const t = MODULE_TONE[module];
  if (!t) return null;
  return (
    <Chip size="small" label={t.label}
      sx={{ height: 19, fontSize: '0.6rem', fontWeight: 700, borderRadius: '999px', bgcolor: `${t.color}12`, color: t.color, border: `1px solid ${t.color}33` }} />
  );
};

/**
 * One row per location the item is held at — or its usual one, if none yet.
 * `id`, not skuId, is the item: a coil is offered twice — its stock under Raw
 * Material, its scrap under Scrap — and those are two different corrections.
 */
const rowsOf = (sku) => (sku.stocks?.length ? sku.stocks : [{ warehouse: sku.defaultWarehouse, qtyOnHand: 0 }])
  .map((st) => ({ key: `${sku.id}|${st.warehouse}`, sku, warehouse: st.warehouse, systemQty: Number(st.qtyOnHand || 0) }));

const StockCorrectionDrawer = ({ open, onClose }) => {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const [module, setModule] = useState('');
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState([]);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  // The submission id, kept only while the same counts are re-sent: an
  // identical retry (the reply was lost) is recognised as already saved, and
  // anything edited after a failed save is a new submission.
  const attempt = useRef({ sig: '', id: '' });
  const [correct, { isLoading }] = useCorrectStockMutation();

  // EVERY item of the three modules and every scrap coil SKU, loaded fresh each
  // time the popup opens (it is mounted only while open); the search box and
  // the module pick filter that list in the browser as you type. Ticking an item asks nothing more:
  // its figures are already here, and the server re-checks each one on save.
  const found = useGetStockCorrectionSkusQuery({ limit: 5000 }, { skip: !open, refetchOnMountOrArgChange: true });
  const allItems = useMemo(() => [...(found.data?.data || [])].sort((a, b) => (
    MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module) || a.skuCode.localeCompare(b.skuCode)
  )), [found.data]);
  const byId = useMemo(() => new Map(allItems.map((s) => [s.id, s])), [allItems]);

  // All items is the stock of RM, CP and FG; Scrap shows only when picked. A
  // picked item stays offered (ticked) whatever the pick.
  const options = useMemo(() => {
    const keep = new Set(selected.map((s) => s.id));
    return allItems.filter((s) => (module ? s.module === module : !isScrap(s)) || keep.has(s.id));
  }, [allItems, module, selected]);

  // Each line against the latest figure loaded (after a refused save, the new one).
  const rows = useMemo(
    () => selected.flatMap((s) => rowsOf(byId.get(s.id) || s)),
    [selected, byId],
  );
  const lineOf = (r) => {
    const raw = counts[r.key];
    if (raw === undefined || raw === '') return null;
    const physical = Number(raw);
    return Number.isFinite(physical) ? { physical, diff: Math.round((physical - r.systemQty) * 100) / 100 } : null;
  };
  const entered = rows.filter((r) => lineOf(r));
  const changing = entered.filter((r) => Math.abs(lineOf(r).diff) > 0.001);
  const negative = entered.some((r) => lineOf(r).physical < 0);
  const ready = changing.length > 0 && !negative;

  const reset = () => {
    setSelected([]); setCounts({}); setReason(''); setInput(''); setModule('');
    attempt.current = { sig: '', id: '' };
  };
  const removeSku = (id) => {
    setSelected((p) => p.filter((s) => s.id !== id));
    setCounts((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith(`${id}|`))));
  };

  const submit = async () => {
    if (!ready) return;
    const lines = changing.map((r) => ({
      kind: isScrap(r.sku) ? 'SCRAP' : 'STOCK',
      skuId: r.sku.skuId, warehouse: r.warehouse, systemQty: r.systemQty, physicalQty: lineOf(r).physical,
    }));
    const body = { reason: reason.trim() || undefined, lines };
    const sig = JSON.stringify(body);
    if (attempt.current.sig !== sig) attempt.current = { sig, id: newRequestId() };
    try {
      const res = await correct({ ...body, clientRequestId: attempt.current.id }).unwrap();
      const d = res?.data || {};
      // Name what moved, so the operator sees the new figure land:
      // "JSL202-06-775 0 → 50", "JSL202-06 scrap 6,042.67 → 6,000 kg".
      const moved = (d.results || []).filter((r) => !r.unchanged);
      const detail = moved.slice(0, 3).map((r) => (r.kind === 'SCRAP'
        ? `${r.skuCode} scrap ${num(r.before)} → ${num(r.after)} kg`
        : `${r.skuCode} ${num(r.before)} → ${num(r.after)}`)).join(', ')
        + (moved.length > 3 ? ` and ${moved.length - 3} more` : '');
      enqueueSnackbar(d.duplicate
        ? 'Already saved — this correction was submitted twice, so stock was not changed again.'
        : `Corrected${d.correctionNumber ? ` (${d.correctionNumber})` : ''} — ${detail || `${d.changed} item${d.changed === 1 ? '' : 's'} updated`}.`,
      { variant: d.duplicate ? 'info' : 'success' });
      reset();
      onClose();
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the correction — check the counts and try again.', { variant: 'error' });
      // A line counted against a figure that has since moved: show the new one.
      if (e?.status === 409) found.refetch();
    }
  };

  const fieldSx = { '& .MuiInputBase-root': { bgcolor: O2D.surface, borderRadius: '7px', fontSize: '0.8rem' } };

  return (
    // A popup in the middle of the screen (full screen on a phone), as tall as
    // the form and never taller than the screen — its rows scroll inside.
    <Dialog open={open} onClose={isLoading ? undefined : onClose} fullScreen={phone} maxWidth={false}
      aria-labelledby="stock-correction-title"
      PaperProps={{
        sx: {
          width: '100%', maxWidth: 880, maxHeight: phone ? '100%' : '90vh', m: phone ? 0 : 2,
          borderRadius: phone ? 0 : '12px', bgcolor: O2D.canvas, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        },
      }}>
      {/* ── Header ── */}
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: `${O2D.brand}14`, color: O2D.brand, flexShrink: 0 }}>
          <ClipboardCheck size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id="stock-correction-title" sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>Stock correction</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
            Set an item's stock to what is physically there — circles, Consumables & Packaging or Finished Goods. Pick Scrap to correct a coil SKU's scrap weight.
          </Typography>
        </Box>
        <IconButton onClick={onClose} disabled={isLoading} aria-label="Close stock correction"><X size={18} /></IconButton>
      </Stack>

      {/* ── The form ── */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Autocomplete
            multiple disableCloseOnSelect
            options={options} value={selected}
            onChange={(_, v) => {
              setSelected(v);
              const keep = new Set(v.map((s) => s.id));
              setCounts((c) => Object.fromEntries(Object.entries(c).filter(([k]) => keep.has(k.split('|')[0]))));
            }}
            inputValue={input}
            onInputChange={(_, v, why) => { if (why !== 'reset') setInput(v); }}
            filterOptions={filterByCodeOrName}
            groupBy={(o) => MODULE_TONE[o.module]?.group || 'Other'}
            // The list is windowed (VirtualListbox): groups arrive as plain
            // objects so it can lay out each header and its rows itself.
            renderGroup={(params) => params}
            ListboxComponent={VirtualListbox}
            loading={found.isFetching}
            loadingText="Loading every item…"
            noOptionsText={found.isError ? 'Could not load the items — close and open the form again.' : 'No item matches this code or name'}
            getOptionLabel={(o) => `${o.skuCode} — ${o.skuName}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderTags={() => null}
            // The group header names the module, so a row is the item and its
            // figure — labelled, as stock and scrap are not the same thing.
            renderOption={(props, o, { selected: on }) => (
              <li {...props} key={o.id} style={{ ...props.style, height: OPTION_H, boxSizing: 'border-box', borderBottom: `1px solid ${O2D.lineSoft}` }}>
                <Checkbox size="small" checked={on} sx={{ mr: 0.75, p: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink }}>{o.skuCode}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.68rem', color: O2D.sub }}>{o.skuName}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right', ml: 1, whiteSpace: 'nowrap' }}>
                  <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.body, fontVariantNumeric: 'tabular-nums' }}>
                    {num(o.totalOnHand)} {isScrap(o) ? 'kg' : o.unit}
                  </Typography>
                  <Typography sx={{ fontSize: '0.6rem', color: O2D.faint }}>{isScrap(o) ? 'scrap' : 'in stock'}</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => (
              <TextField {...p} size="small" sx={fieldSx}
                placeholder={selected.length
                  ? `${selected.length} selected — search to add more…`
                  : `Search ${allItems.length ? `${num(options.length)} items` : 'items'} by code or name…`}
                InputProps={{
                  ...p.InputProps,
                  startAdornment: <><Search size={15} color={O2D.sub} style={{ marginLeft: 6 }} />{p.InputProps.startAdornment}</>,
                  endAdornment: <>{found.isFetching ? <CircularProgress size={13} /> : null}{p.InputProps.endAdornment}</>,
                }}
                inputProps={{ ...p.inputProps, 'data-testid': 'correction-search' }} />
            )}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <TextField select size="small" value={module} onChange={(e) => setModule(e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ ...fieldSx, width: 200, flexShrink: 0 }} inputProps={{ 'aria-label': 'Which items' }}>
            {MODULES.map((m) => <MenuItem key={m.value || 'all'} value={m.value}>{m.label}</MenuItem>)}
          </TextField>
        </Stack>

        <Box sx={{ borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, overflow: 'hidden' }}>
          <TableScroll>
            <Table size="small" sx={imsTableSx(700)}>
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ width: 50 }}>S.No.</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell align="center">In system</TableCell>
                  <TableCell align="center">Physical count</TableCell>
                  <TableCell align="center">Change</TableCell>
                  <TableCell sx={{ width: 40 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                    <EmptyNote icon={ClipboardCheck} dense title="No item picked yet"
                      hint="Search above and tick the items you counted — you can pick several at once." />
                  </TableCell></TableRow>
                )}
                {rows.map((r, i) => {
                  const line = lineOf(r);
                  const diff = line?.diff ?? null;
                  const tone = diff == null || Math.abs(diff) <= 0.001 ? O2D.sub : diff > 0 ? STOCK_TOKENS.OK.color : STOCK_TOKENS.OUT_OF_STOCK.color;
                  const firstOfSku = i === 0 || rows[i - 1].sku.id !== r.sku.id;
                  const scrap = isScrap(r.sku);
                  return (
                    <TableRow key={r.key} hover data-testid="correction-row">
                      <TableCell align="center" sx={{ color: O2D.sub, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</TableCell>
                      <TableCell sx={{ maxWidth: 230 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink }}>{r.sku.skuCode}</Typography>
                          <ModuleChip module={r.sku.module} />
                        </Stack>
                        <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }} title={r.sku.skuName}>
                          {scrap ? `Scrap weight · ${r.sku.skuName}` : r.sku.skuName}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.74rem', color: O2D.body, whiteSpace: 'nowrap' }}>{locationText(r.warehouse)}</TableCell>
                      <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 700, color: r.systemQty < 0 ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.ink }}>
                        {num(r.systemQty)} <Box component="span" sx={{ fontSize: '0.66rem', fontWeight: 600, color: O2D.sub }}>{scrap ? 'kg' : r.sku.unit}</Box>
                      </TableCell>
                      <TableCell align="center" sx={{ width: 140 }}>
                        <TextField size="small" type="number" value={counts[r.key] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [r.key]: e.target.value }))}
                          error={!!line && line.physical < 0}
                          inputProps={{ min: 0, style: { textAlign: 'center', width: 90, fontWeight: 800 }, 'aria-label': `${scrap ? 'Scrap weight' : 'Physical count'} — ${r.sku.skuCode} at ${r.warehouse}`, 'data-testid': 'correction-count' }}
                          placeholder={scrap ? 'Weight kg' : 'Count'} />
                      </TableCell>
                      <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {diff == null ? <Box component="span" sx={{ color: O2D.faint }}>—</Box> : (
                          <Tooltip arrow slotProps={O2D_TIP} title={Math.abs(diff) <= 0.001 ? 'Matches the system — nothing will change.' : `${scrap ? 'The scrap' : 'The stock'} will go from ${num(r.systemQty)} to ${num(line.physical)}${scrap ? ' kg' : ''}.`}>
                            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center" sx={{ cursor: 'help' }}>
                              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: tone }}>
                                {Math.abs(diff) <= 0.001 ? 'No change' : `${diff > 0 ? '+' : '−'}${num(Math.abs(diff))}`}
                              </Typography>
                              {Math.abs(diff) > 0.001 && <><ArrowRight size={12} color={O2D.faint} /><Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{num(line.physical)}</Typography></>}
                            </Stack>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ pl: 0 }}>
                        {firstOfSku && (
                          <Tooltip arrow slotProps={O2D_TIP} title="Remove this item">
                            <IconButton size="small" onClick={() => removeSku(r.sku.id)} sx={{ color: O2D.faint, '&:hover': { color: STOCK_TOKENS.OUT_OF_STOCK.color } }}>
                              <Trash2 size={15} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        </Box>

        <TextField fullWidth size="small" label="Reason / remark (optional)" value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="e.g. Physical count on 24 Oct"
          multiline minRows={2} inputProps={{ maxLength: 300 }} sx={{ ...fieldSx, mt: 1.75 }} />
      </Box>

      {/* ── Save ── */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: O2D.surface, borderTop: `1px solid ${O2D.line}` }}>
        <Typography sx={{ fontSize: '0.72rem', color: ready ? STOCK_TOKENS.OK.color : O2D.sub, fontWeight: 700, mr: 'auto' }}>
          {!rows.length ? 'Pick the items you counted.'
            : negative ? 'A count cannot be below zero.'
              : changing.length ? `${changing.length} item${changing.length === 1 ? '' : 's'} will change · saved with your name and the time.`
                : 'Enter the physical count where it differs from the system.'}
        </Typography>
        <Button onClick={onClose} disabled={isLoading} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={submit} disabled={!ready || isLoading}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }} data-testid="correction-save">
          Save correction
        </Button>
      </Stack>
    </Dialog>
  );
};

export default StockCorrectionDrawer;
