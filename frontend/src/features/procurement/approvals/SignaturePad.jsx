import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Eraser, Undo2 } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

/**
 * Digital handwritten signature pad — mouse, laptop touchpad, touchscreen,
 * and stylus all work out of the box via react-signature-canvas's pointer-
 * event handling. Exposes {isEmpty, clear, toDataUrl} via ref; toDataUrl()
 * returns a transparent-background PNG data URL (never plain text) —
 * `getTrimmedCanvas()` crops to the drawn strokes.
 *
 * Fixed pixel canvas size (rather than 100% width) avoids the classic
 * signature_pad gotcha where CSS-stretching the canvas distorts strokes —
 * the surrounding Box scrolls horizontally as a safety net on narrow screens.
 */
const CANVAS_W = 460;
const CANVAS_H = 180;

const SignaturePad = forwardRef((_props, ref) => {
  const padRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    clear: () => { padRef.current?.clear(); setIsEmpty(true); },
    toDataUrl: () => (padRef.current?.isEmpty() ? '' : padRef.current.getTrimmedCanvas().toDataURL('image/png')),
  }));

  const refreshEmpty = () => setIsEmpty(padRef.current?.isEmpty() ?? true);

  const handleUndo = () => {
    const data = padRef.current?.toData() || [];
    if (!data.length) return;
    data.pop();
    padRef.current?.fromData(data);
    refreshEmpty();
  };

  const handleClear = () => { padRef.current?.clear(); setIsEmpty(true); };

  return (
    <Box>
      <Box sx={{ border: '2px dashed', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff', overflowX: 'auto' }}>
        <SignatureCanvas
          ref={padRef}
          penColor="#0b2545"
          canvasProps={{ width: CANVAS_W, height: CANVAS_H, style: { display: 'block', touchAction: 'none' } }}
          onEnd={refreshEmpty}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="caption" color="text.disabled">
          Draw your signature above using a mouse, trackpad, touchscreen, or stylus.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" startIcon={<Undo2 size={14} />} onClick={handleUndo} disabled={isEmpty}>Undo</Button>
          <Button size="small" startIcon={<Eraser size={14} />} onClick={handleClear} disabled={isEmpty}>Clear</Button>
        </Box>
      </Box>
    </Box>
  );
});

SignaturePad.displayName = 'SignaturePad';
export default SignaturePad;
