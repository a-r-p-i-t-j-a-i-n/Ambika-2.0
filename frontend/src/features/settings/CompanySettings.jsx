import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Button, Stack, CircularProgress, Alert,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, alpha,
} from '@mui/material';
import { Building2, Signature, Stamp, Upload, Trash2, ImageOff, FileText, Pencil } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import {
  useGetCompanySettingsQuery,
  useUpdateCompanySettingsMutation,
  useUploadCompanyPdfAssetMutation,
  useRemoveCompanyPdfAssetMutation,
} from '../../store/api/pricingApi';
import PoTermsDialog from '../procurement/purchase-orders/PoTermsDialog';
import { PO_FORMAT_LABEL } from '../procurement/purchase-orders/poTerms';
import {
  PageHero, pageSx, panelSx, primaryBtnSx, ghostBtnSx, TYPE, BRAND, DANGER, NAVY, O2D,
} from '../../components/pageKit';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/+$/, '');
const MAX_BYTES = 1024 * 1024; // mirrors the backend limit (company-pdf-assets.js)
const ACCEPT = ['image/png', 'image/jpeg'];

const ASSETS = [
  {
    kind: 'signature', field: 'authorisedSignature', icon: Signature, title: 'Authorised signature',
    hint: 'A scan of the authorised signatory\'s signature. A transparent PNG looks best.',
  },
  {
    kind: 'stamp', field: 'companyStamp', icon: Stamp, title: 'Company stamp',
    hint: 'The company seal / rubber stamp. A square, transparent PNG looks best.',
  },
];

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtWhen = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// The image is admin-only on the server (no public URL), so it is fetched with
// the session token and shown from a local object URL.
// State is keyed by the image hash, so a replaced/removed image never shows the
// previous preview while the new one loads.
const NO_PREVIEW = { url: '', failed: false };
const useAssetPreview = (kind, sha256) => {
  const [loaded, setLoaded] = useState({ key: '', ...NO_PREVIEW });
  useEffect(() => {
    if (!sha256) return undefined;
    let objectUrl = '';
    let cancelled = false;
    fetch(`${API_BASE}/pricing/settings/pdf-assets/${kind}/image`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      cache: 'no-store',
    })
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.blob(); })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key: sha256, url: objectUrl, failed: false });
      })
      .catch(() => { if (!cancelled) setLoaded({ key: sha256, url: '', failed: true }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [kind, sha256]);
  return sha256 && loaded.key === sha256 ? loaded : NO_PREVIEW;
};

const AssetCard = ({ def, asset }) => {
  const inputRef = useRef(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [upload, { isLoading: uploading }] = useUploadCompanyPdfAssetMutation();
  const [remove, { isLoading: removing }] = useRemoveCompanyPdfAssetMutation();
  const { url, failed } = useAssetPreview(def.kind, asset?.sha256);
  const Icon = def.icon;
  const busy = uploading || removing;

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!ACCEPT.includes(file.type)) { enqueueSnackbar('Only PNG or JPEG images are accepted.', { variant: 'error' }); return; }
    if (file.size > MAX_BYTES) { enqueueSnackbar('Image is larger than 1 MB. Please upload a smaller PNG or JPEG.', { variant: 'error' }); return; }
    try {
      await upload({ kind: def.kind, file }).unwrap();
      enqueueSnackbar(`${def.title} saved`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || `Could not save the ${def.title.toLowerCase()}`, { variant: 'error' });
    }
  };

  const onRemove = async () => {
    try {
      await remove(def.kind).unwrap();
      enqueueSnackbar(`${def.title} removed`, { variant: 'success' });
      setConfirmOpen(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || `Could not remove the ${def.title.toLowerCase()}`, { variant: 'error' });
    }
  };

  return (
    <Paper elevation={0} sx={{ ...panelSx, p: 2, flex: 1, minWidth: 0 }} data-testid={`pdf-asset-card-${def.kind}`}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Icon size={17} color={BRAND} />
        <Typography sx={TYPE.sectionTitle}>{def.title}</Typography>
      </Stack>
      <Typography sx={{ ...TYPE.caption, mb: 1.5 }}>{def.hint}</Typography>

      {/* Checkerboard so a transparent PNG's edges are visible. */}
      <Box
        sx={{
          height: 140, borderRadius: '8px', border: `1px solid ${O2D.line}`,
          display: 'grid', placeItems: 'center', overflow: 'hidden', mb: 1.25,
          backgroundColor: '#fff',
          backgroundImage: 'linear-gradient(45deg,#f1f0ec 25%,transparent 25%),linear-gradient(-45deg,#f1f0ec 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f0ec 75%),linear-gradient(-45deg,transparent 75%,#f1f0ec 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
        }}
      >
        {asset && url && (
          <Box component="img" src={url} alt={`${def.title} preview`} data-testid={`pdf-asset-preview-${def.kind}`}
            sx={{ maxWidth: '90%', maxHeight: 120, objectFit: 'contain' }} />
        )}
        {asset && !url && !failed && <CircularProgress size={22} />}
        {asset && failed && <Typography sx={TYPE.caption}>Preview unavailable</Typography>}
        {!asset && (
          <Stack alignItems="center" spacing={0.5} data-testid={`pdf-asset-empty-${def.kind}`}>
            <ImageOff size={22} color={O2D.sub} />
            <Typography sx={TYPE.caption}>Not uploaded — PO PDFs print without it</Typography>
          </Stack>
        )}
      </Box>

      {asset && (
        <Typography sx={{ ...TYPE.caption, mb: 1.25, wordBreak: 'break-word' }} data-testid={`pdf-asset-meta-${def.kind}`}>
          {asset.fileName} · {asset.width}×{asset.height}px · {fmtSize(asset.sizeBytes)}
          <br />
          Uploaded {fmtWhen(asset.uploadedAt)}{asset.uploadedByName ? ` by ${asset.uploadedByName}` : ''}
        </Typography>
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg" hidden onChange={onPick}
          data-testid={`pdf-asset-input-${def.kind}`} />
        <Button variant="contained" disabled={busy} onClick={() => inputRef.current?.click()}
          startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <Upload size={15} />}
          sx={primaryBtnSx} data-testid={`pdf-asset-upload-${def.kind}`}>
          {asset ? 'Replace' : 'Upload'}
        </Button>
        {asset && (
          <Button variant="outlined" disabled={busy} onClick={() => setConfirmOpen(true)} startIcon={<Trash2 size={15} />}
            sx={{ ...ghostBtnSx, color: DANGER, '&:hover': { borderColor: DANGER, bgcolor: alpha(DANGER, 0.04) } }}
            data-testid={`pdf-asset-remove-${def.kind}`}>
            Remove
          </Button>
        )}
      </Stack>

      <Dialog open={confirmOpen} onClose={() => !removing && setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, color: NAVY }}>Remove {def.title.toLowerCase()}?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={TYPE.body}>
            Purchase Order PDFs generated from now on will print without it. PDFs of POs already released are not changed.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={removing} sx={ghostBtnSx} variant="outlined">Cancel</Button>
          <Button onClick={onRemove} disabled={removing} variant="contained" data-testid={`pdf-asset-remove-confirm-${def.kind}`}
            sx={{ ...primaryBtnSx, bgcolor: DANGER, '&:hover': { bgcolor: DANGER } }}>
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

// Default PO Terms & Conditions per format. Copied onto each new PO; a buyer
// can still change one PO's copy from the PO form / PO detail.
const PO_TERMS_DEFAULTS = [
  { format: 'JSL', field: 'poTermsJsl', title: 'JSL purchase orders' },
  { format: 'OTHER', field: 'poTermsOther', title: 'Other purchase orders' },
];

const PoTermsDefaultCard = ({ def, value }) => {
  const [open, setOpen] = useState(false);
  const [update, { isLoading }] = useUpdateCompanySettingsMutation();
  const onSave = async (text) => {
    try {
      await update({ [def.field]: text }).unwrap();
      enqueueSnackbar(`Default terms for ${def.title} saved`, { variant: 'success' });
      setOpen(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not save the default terms', { variant: 'error' });
    }
  };
  return (
    <Paper elevation={0} sx={{ ...panelSx, p: 2, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
      data-testid={`po-terms-default-${def.format}`}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <FileText size={17} color={BRAND} />
        <Typography sx={TYPE.sectionTitle}>{def.title}</Typography>
      </Stack>
      <Typography sx={{ ...TYPE.body, whiteSpace: 'pre-line', wordBreak: 'break-word', flex: 1, mb: 1.5 }}
        data-testid={`po-terms-default-text-${def.format}`}>
        {value || '—'}
      </Typography>
      <Box>
        <Button variant="outlined" startIcon={<Pencil size={15} />} sx={ghostBtnSx} onClick={() => setOpen(true)}
          data-testid={`po-terms-default-edit-${def.format}`}>
          Edit default terms
        </Button>
      </Box>
      <PoTermsDialog
        open={open}
        onClose={() => setOpen(false)}
        onSave={onSave}
        saving={isLoading}
        initialText={value}
        title="Default Terms & Conditions"
        formatLabel={PO_FORMAT_LABEL[def.format]}
        note="Copied onto every new PO of this format. POs already created keep the terms they have — edit one PO's terms from that PO."
      />
    </Paper>
  );
};

const CompanySettings = () => {
  const { data, isLoading, isError, refetch } = useGetCompanySettingsQuery();
  const settings = data?.data;

  return (
    <Box sx={pageSx}>
      <PageHero
        icon={Building2}
        title="Company Settings"
        subtitle="Company-wide details used on generated documents."
      />

      <Paper elevation={0} sx={{ ...panelSx, p: 2 }}>
        <Typography sx={TYPE.sectionTitle}>Purchase Order signatory</Typography>
        <Typography sx={{ ...TYPE.body, mt: 0.5, mb: 2, maxWidth: 820 }}>
          Printed in the Authorized Signatory section of every Purchase Order PDF (JSL and Other formats) — preview,
          release and download. PNG or JPEG, up to 1 MB. A PO that has already been released keeps the PDF it was
          sent with.
        </Typography>

        {isLoading && <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={26} /></Box>}
        {isError && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Retry</Button>}>
            Could not load company settings.
          </Alert>
        )}
        {settings && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {ASSETS.map((def) => <AssetCard key={def.kind} def={def} asset={settings[def.field] || null} />)}
          </Stack>
        )}
      </Paper>

      <Paper elevation={0} sx={{ ...panelSx, p: 2, mt: 2 }}>
        <Typography sx={TYPE.sectionTitle}>Purchase Order Terms &amp; Conditions</Typography>
        <Typography sx={{ ...TYPE.body, mt: 0.5, mb: 2, maxWidth: 820 }}>
          The default terms printed on each new PO, by PO format — for example the price-protection date on JSL POs.
          A PO keeps the terms it was created with; to change one PO, use Edit Terms &amp; Conditions on that PO.
        </Typography>
        {settings && (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {PO_TERMS_DEFAULTS.map((def) => <PoTermsDefaultCard key={def.field} def={def} value={settings[def.field] || ''} />)}
          </Stack>
        )}
      </Paper>
    </Box>
  );
};

export default CompanySettings;
