import React, { useEffect, useState } from 'react';
import {
  Autocomplete, TextField, Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, CircularProgress, InputAdornment,
} from '@mui/material';
import { Store, Save } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { O2D } from './scrapImsMeta';
import { useGetScrapBuyersQuery, useCreateScrapBuyerMutation } from '../../store/api/scrapImsApi';

/**
 * "Sold to / Buyer" — pick a buyer from the Scrap Buyer master, or add one
 * without leaving Scrap Out.
 *
 * Built the way the Transporter picker on Dispatch Entry is (an "+ Add …" row
 * inside the list that opens a small dialog and selects what it saved), with
 * two differences that matter here: the value is the buyer RECORD, keyed by
 * its id, not a typed name; and the list is searched on the server, by name,
 * code, contact person, phone or GSTIN.
 *
 * The server's create is find-or-create, so "Add new buyer" can never make a
 * second copy of someone already in the master — if the name (ignoring case
 * and spacing) or the GSTIN matches, the existing buyer is selected instead and
 * the operator is told so.
 */
const EMPTY = { name: '', contactPerson: '', phone: '', email: '', address: '', state: '', gstNo: '' };

const detailLine = (b) => [b.code, b.contactPerson, b.phone, b.gstNo && `GSTIN ${b.gstNo}`].filter(Boolean).join(' · ');

const ScrapBuyerPicker = ({ value, onChange, error = false, helperText }) => {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(null); // the dialog's form, or null when closed
  const [touched, setTouched] = useState(false);

  // Debounced, so typing "Shree Metal" is one request, not eleven.
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useGetScrapBuyersQuery({ search: search || undefined, limit: 50 });
  const buyers = data?.data || [];
  const [createBuyer, { isLoading: saving }] = useCreateScrapBuyerMutation();

  const openAdd = (name = '') => { setTouched(false); setDraft({ ...EMPTY, name }); };
  const setD = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const nameError = touched && (draft?.name || '').trim().length < 2;

  const save = async () => {
    setTouched(true);
    if ((draft?.name || '').trim().length < 2) return;
    try {
      const res = await createBuyer(Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, String(v || '').trim() || undefined]),
      )).unwrap();
      const buyer = res?.data?.buyer;
      if (buyer) onChange(buyer);
      enqueueSnackbar(res?.message || (res?.data?.created ? 'Buyer added.' : 'Buyer selected.'),
        { variant: res?.data?.created ? 'success' : 'info' });
      setDraft(null);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the buyer.', { variant: 'error' });
    }
  };

  return (
    <>
      <Autocomplete
        value={value || null}
        options={buyers}
        loading={isFetching}
        inputValue={input}
        // 'reset' is MUI writing the chosen buyer's name into the box — keep it,
        // or the field would go on showing the half-typed search text.
        onInputChange={(_, v) => setInput(v)}
        // The server has already filtered; this only adds the "+ Add" row.
        filterOptions={(opts) => {
          const typed = input.trim();
          const exact = opts.some((o) => (o.name || '').toLowerCase() === typed.toLowerCase());
          if (typed && !exact) return [...opts, { addNew: true, name: typed, addLabel: `+ Add "${typed}" as a new buyer` }];
          if (!typed) return [...opts, { addNew: true, name: '', addLabel: '+ Add a new buyer' }];
          return opts;
        }}
        getOptionLabel={(o) => (o?.addNew ? o.addLabel : (o?.name || ''))}
        isOptionEqualToValue={(o, v) => String(o?._id) === String(v?._id)}
        onChange={(_, val) => {
          if (val?.addNew) { openAdd(val.name); return; }
          onChange(val || null);
        }}
        renderOption={(props, option) => (
          <li {...props} key={option._id || option.addLabel}>
            {option.addNew ? (
              <Typography sx={{ fontWeight: 700, color: 'primary.main', fontSize: '0.8rem' }}>{option.addLabel}</Typography>
            ) : (
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: '0.8rem' }}>{option.name}</Typography>
                {detailLine(option) && (
                  <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{detailLine(option)}</Typography>
                )}
              </Box>
            )}
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params} size="small" label="Sold to / Buyer *" placeholder="Search name, code, contact, phone or GSTIN…"
            error={error}
            helperText={helperText ?? 'Not listed? Pick “+ Add a new buyer” — it is saved to the buyer master and selected here.'}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: error ? undefined : O2D.sub, mx: 0 } }}
            InputProps={{
              ...params.InputProps,
              startAdornment: (<><InputAdornment position="start"><Store size={13} /></InputAdornment>{params.InputProps.startAdornment}</>),
              endAdornment: (<>{isFetching ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>),
            }}
          />
        )}
      />

      <Dialog open={!!draft} onClose={() => !saving && setDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 800 }}>Add scrap buyer</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, mb: 1.5 }}>
            Saved to the Scrap Buyer master and selected on this Scrap Out. If this buyer is already in the master
            (same name or GSTIN), that one is selected instead — no copy is made.
          </Typography>
          {draft && (
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              <TextField size="small" label="Buyer / company name *" value={draft.name} autoFocus
                onChange={(e) => setD('name', e.target.value)} onBlur={() => setTouched(true)}
                error={nameError} helperText={nameError ? 'Buyer name is required (at least 2 characters).' : ' '}
                inputProps={{ maxLength: 200 }} />
              <TextField size="small" label="Contact person" value={draft.contactPerson}
                onChange={(e) => setD('contactPerson', e.target.value)} inputProps={{ maxLength: 100 }} />
              <TextField size="small" label="Mobile / phone" value={draft.phone}
                onChange={(e) => setD('phone', e.target.value)} inputProps={{ maxLength: 30 }} />
              <TextField size="small" label="Email" value={draft.email}
                onChange={(e) => setD('email', e.target.value)} inputProps={{ maxLength: 200 }} />
              <TextField size="small" label="Address" value={draft.address} multiline minRows={2}
                onChange={(e) => setD('address', e.target.value)} inputProps={{ maxLength: 500 }} />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                <TextField size="small" label="State" value={draft.state}
                  onChange={(e) => setD('state', e.target.value)} inputProps={{ maxLength: 50 }} />
                {/* A GSTIN identifies one business, so the master matches on it —
                    a placeholder like "NA" would match every other buyer given "NA". */}
                <TextField size="small" label="GSTIN" value={draft.gstNo}
                  onChange={(e) => setD('gstNo', e.target.value.toUpperCase())} inputProps={{ maxLength: 20 }}
                  helperText="Leave blank if none — don't type NA."
                  FormHelperTextProps={{ sx: { fontSize: '0.64rem', mx: 0 } }} />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDraft(null)} disabled={saving} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disableElevation onClick={save} disabled={saving}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
            Save &amp; select
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ScrapBuyerPicker;
