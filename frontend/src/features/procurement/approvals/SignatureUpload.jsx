import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import { Upload, X } from 'lucide-react';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ACCEPT_ATTR = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Checkerboard background so a transparent PNG's preserved transparency is
// visibly obvious in the preview, not just assumed.
const TRANSPARENCY_BG = {
  backgroundImage:
    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), '
    + 'linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

/** Auto-trim transparent/near-white margins around the signature ink. */
const trimCanvas = (canvas) => {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      const isNearWhite = data[i] > 248 && data[i + 1] > 248 && data[i + 2] > 248;
      if (alpha > 10 && !isNearWhite) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < left || bottom < top) return canvas; // nothing detected — return untouched
  const pad = 6;
  const cropX = Math.max(0, left - pad);
  const cropY = Math.max(0, top - pad);
  const cropW = Math.min(width, right + pad) - cropX;
  const cropH = Math.min(height, bottom + pad) - cropY;
  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  trimmed.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return trimmed;
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read this file'));
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not decode this image'));
  img.src = src;
});

/**
 * Upload an existing handwritten signature image (PNG/JPG/JPEG/WEBP, max 5MB).
 * Every format is normalized client-side — decoded onto a canvas, auto-
 * trimmed, and re-exported as a PNG data URL — so by the time the backend
 * sees it, an uploaded signature is byte-for-byte the same shape as a drawn
 * one (`data:image/png;base64,...`). This is what lets the sign pipeline and
 * PDF embedding stay completely unaware of which method was used; WEBP
 * decodes natively via <img>/canvas in every evergreen browser, so no server-
 * side image library is needed just to normalize formats.
 *
 * Same {isEmpty, clear, toDataUrl} ref contract as SignaturePad so
 * SignDocumentDialog can treat both input methods interchangeably.
 */
const SignatureUpload = forwardRef((_props, ref) => {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useImperativeHandle(ref, () => ({
    isEmpty: () => !preview,
    clear: () => { setPreview(''); setError(''); if (fileRef.current) fileRef.current.value = ''; },
    toDataUrl: () => preview,
  }));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type — use PNG, JPG, JPEG, or WEBP');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError('Image is too large — maximum size is 5 MB');
      return;
    }

    setProcessing(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = await loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const trimmed = trimCanvas(canvas);
      setPreview(trimmed.toDataURL('image/png'));
    } catch (err) {
      setError(err.message || 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Box>
      <input ref={fileRef} type="file" accept={ACCEPT_ATTR} hidden onChange={handleFile} />
      {preview ? (
        <Box sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: '10px', p: 2, bgcolor: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 260, height: 100, display: 'grid', placeItems: 'center', borderRadius: '8px', ...TRANSPARENCY_BG }}>
            <img src={preview} alt="Signature preview" style={{ maxWidth: '95%', maxHeight: '90%', objectFit: 'contain' }} />
          </Box>
          <Button size="small" startIcon={<X size={14} />} onClick={() => { setPreview(''); setError(''); }}>
            Remove &amp; choose another
          </Button>
        </Box>
      ) : (
        <Box sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: '10px', p: 4, bgcolor: '#fafafa', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <Button variant="outlined" startIcon={processing ? <CircularProgress size={14} /> : <Upload size={16} />}
            onClick={() => fileRef.current?.click()} disabled={processing}>
            Choose Image
          </Button>
          <Typography variant="caption" color="text.disabled">PNG, JPG, JPEG, or WEBP — max 5 MB</Typography>
        </Box>
      )}
      {error && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{error}</Typography>}
    </Box>
  );
});

SignatureUpload.displayName = 'SignatureUpload';
export default SignatureUpload;
