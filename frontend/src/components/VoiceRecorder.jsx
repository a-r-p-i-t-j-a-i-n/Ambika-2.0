import React, { useRef, useState } from 'react';
import { Button, Stack, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Mic, Square, Trash2, Check, RotateCcw } from 'lucide-react';

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Voice note recorder with a REVIEW step:
 *   Record → Stop → preview (listen) → either Re-record (discard) or Use (upload).
 * Nothing is uploaded until the user confirms with "Use this note".
 */
const VoiceRecorder = ({ onRecorded, disabled }) => {
  const [phase, setPhase] = useState('idle'); // idle | recording | review
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { url, file }

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const cleanupStream = () => streamRef.current?.getTracks().forEach((t) => t.stop());

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) { setError('Recording not supported in this browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type });
        setPreview({ url: URL.createObjectURL(blob), file });
        setPhase('review');
        cleanupStream();
      };
      rec.start();
      recRef.current = rec;
      setPhase('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not start recording.');
    }
  };

  const stop = () => {
    clearInterval(timerRef.current);
    try { recRef.current?.stop(); } catch { /* ignore */ }
  };

  const discard = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPhase('idle');
    setSeconds(0);
  };

  const use = () => {
    if (preview?.file) onRecorded?.(preview.file);
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPhase('idle');
    setSeconds(0);
  };

  if (phase === 'review') {
    return (
      <Stack spacing={1} sx={{ p: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 2, width: '100%' }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>Review your voice note before uploading:</Typography>
        <audio controls src={preview.url} style={{ width: '100%' }} />
        <Stack direction="row" spacing={1}>
          <Button size="small" color="inherit" startIcon={<RotateCcw size={14} />} onClick={discard}>Re-record</Button>
          <Button size="small" variant="contained" color="success" startIcon={<Check size={15} />} onClick={use}>Use this note</Button>
          <Tooltip title="Discard"><IconButton size="small" color="error" onClick={discard}><Trash2 size={15} /></IconButton></Tooltip>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {phase !== 'recording' ? (
        <Button size="small" variant="outlined" startIcon={<Mic size={15} />} onClick={start} disabled={disabled}>
          Record voice note
        </Button>
      ) : (
        <Button size="small" variant="contained" color="error" startIcon={<Square size={14} />} onClick={stop}
          sx={{ animation: 'pulse 1.2s infinite', '@keyframes pulse': { '50%': { opacity: 0.6 } } }}>
          Stop
        </Button>
      )}
      {phase === 'recording' && (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'error.main' }}>{mmss(seconds)}</Typography>
        </Stack>
      )}
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Stack>
  );
};

export default VoiceRecorder;
