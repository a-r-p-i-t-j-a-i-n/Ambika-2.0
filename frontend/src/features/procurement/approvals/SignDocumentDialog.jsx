import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  CircularProgress, Stepper, Step, StepLabel, Alert, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { PenTool, CheckCircle2, X, Upload } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSignDocumentMutation } from '../../../store/api/procurementApi';
import SignaturePad from './SignaturePad';
import SignatureUpload from './SignatureUpload';
import { PFMS } from '../pfmsTheme';

const STEPS = ['Draw Signature', 'Confirmation'];
const METHODS = { DRAW: 'DRAW', UPLOAD: 'UPLOAD' };

/**
 * Generic MD sign-off dialog — driven purely by (documentType, documentId),
 * with zero document-specific logic. Reused, unmodified, for GRN and Voucher
 * (and any future document type the approval engine is attached to).
 *
 * Two signature capture methods share one Preview → Confirmation → Sign
 * workflow: SignaturePad (draw) and SignatureUpload (upload PNG/JPG/JPEG/
 * WEBP) both expose the same {isEmpty, clear, toDataUrl} ref contract and
 * both ultimately produce a plain PNG data URL, so everything past
 * `handleNext` — preview, confirmation copy, the sign API call — is
 * completely unaware of which method produced it. Only `signatureType` is
 * threaded through, for the backend's audit record.
 */
const SignDocumentDialog = ({ open, onClose, documentType, documentId, documentTitle }) => {
  const { enqueueSnackbar } = useSnackbar();
  const drawRef = useRef(null);
  const uploadRef = useRef(null);
  const [method, setMethod] = useState(METHODS.DRAW);
  const [step, setStep] = useState(0);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [signDocument, { isLoading }] = useSignDocumentMutation();

  const activeRef = method === METHODS.DRAW ? drawRef : uploadRef;

  useEffect(() => {
    if (open) { setStep(0); setSignatureDataUrl(''); setMethod(METHODS.DRAW); }
  }, [open]);

  const handleMethodChange = (_e, next) => {
    if (!next) return; // ToggleButtonGroup fires null when clicking the already-selected option
    setMethod(next);
  };

  const handleNext = () => {
    if (activeRef.current?.isEmpty()) {
      enqueueSnackbar(
        method === METHODS.DRAW ? 'Please draw a signature first' : 'Please upload a signature image first',
        { variant: 'warning' },
      );
      return;
    }
    setSignatureDataUrl(activeRef.current.toDataUrl());
    setStep(1);
  };

  const handleConfirmSign = async () => {
    try {
      await signDocument({
        documentType, documentId, signatureImageBase64: signatureDataUrl,
        signatureType: method === METHODS.DRAW ? 'DRAWN' : 'UPLOADED',
      }).unwrap();
      enqueueSnackbar('Document signed — MD Approved', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to sign document', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Sign Document
        {documentTitle && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{documentTitle}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {step === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Your signature will be embedded permanently into the document's PDF.
            </Typography>
            <ToggleButtonGroup value={method} exclusive onChange={handleMethodChange} size="small" sx={{ mb: 2 }} fullWidth>
              <ToggleButton value={METHODS.DRAW}>
                <PenTool size={15} style={{ marginRight: 6 }} /> Draw Signature
              </ToggleButton>
              <ToggleButton value={METHODS.UPLOAD}>
                <Upload size={15} style={{ marginRight: 6 }} /> Upload Signature
              </ToggleButton>
            </ToggleButtonGroup>

            {method === METHODS.DRAW ? <SignaturePad ref={drawRef} /> : <SignatureUpload ref={uploadRef} />}
          </Box>
        )}

        {step === 1 && (
          <Box>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Are you sure you want to sign this document?</Typography>
              <Typography sx={{ fontWeight: 700, fontSize: '0.8rem', mb: 0.5 }}>Once signed:</Typography>
              <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2.5 }}>
                <Typography component="li" variant="body2">This document will become officially approved.</Typography>
                <Typography component="li" variant="body2">Your signature will be permanently embedded into the PDF.</Typography>
                <Typography component="li" variant="body2">This action will be recorded in the audit trail.</Typography>
              </Box>
            </Alert>
            {signatureDataUrl && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px', p: 1.5, display: 'inline-block', bgcolor: PFMS.surfaceAlt }}>
                <img src={signatureDataUrl} alt="Your signature" style={{ height: 60, display: 'block' }} />
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {step === 0 && (
          <>
            <Button startIcon={<X size={16} />} onClick={() => onClose?.(false)}>Cancel</Button>
            <Button variant="contained" startIcon={<PenTool size={16} />} onClick={handleNext}>Continue</Button>
          </>
        )}
        {step === 1 && (
          <>
            <Button onClick={() => setStep(0)} disabled={isLoading}>Back</Button>
            <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
            <Button variant="contained" color="success"
              startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
              onClick={handleConfirmSign} disabled={isLoading}>
              Sign Document
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default SignDocumentDialog;
