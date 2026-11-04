import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSnackbar } from 'notistack';
import { useGetAdvancePaymentPdfMutation } from '../../../store/api/procurementApi';
import PdfViewerModal from '../common/PdfViewerModal';

/**
 * Preview / download an Advance Payment's PDF. The server renders it fresh from
 * the payment records on every request (GET /advance-payments/:id/pdf), so the
 * file always matches the data — nothing stored, nothing stale.
 *
 *   const pdf = useAdvancePaymentPdf();
 *   pdf.preview(row)   → in-app viewer (with Open in tab / Download)
 *   pdf.download(row)  → saves "<payment no>.pdf"
 *   {pdf.modal}        → render once next to the list
 */
const fileNameOf = (row) => `${String(row?.paymentNumber || 'advance-payment').replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;

const useAdvancePaymentPdf = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [getPdf] = useGetAdvancePaymentPdfMutation();
  const [view, setView] = useState(null); // { url, title, fileName, loading }
  const urlRef = useRef(null);

  const revoke = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; } };
  useEffect(() => revoke, []);

  const fetchBlob = useCallback(async (row) => {
    try {
      return await getPdf({ id: row._id }).unwrap();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not generate the payment PDF', { variant: 'error' });
      return null;
    }
  }, [getPdf, enqueueSnackbar]);

  const preview = useCallback(async (row) => {
    revoke();
    setView({ url: '', title: `Advance Payment ${row.paymentNumber || ''}`.trim(), fileName: fileNameOf(row), loading: true });
    const blob = await fetchBlob(row);
    if (!blob) { setView(null); return; }
    urlRef.current = URL.createObjectURL(blob);
    setView((v) => (v ? { ...v, url: urlRef.current, loading: false } : v));
  }, [fetchBlob]);

  const download = useCallback(async (row) => {
    const blob = await fetchBlob(row);
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = fileNameOf(row);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }, [fetchBlob]);

  const modal = (
    <PdfViewerModal open={Boolean(view)} onClose={() => { revoke(); setView(null); }}
      url={view?.url} title={view?.title} fileName={view?.fileName} loading={Boolean(view?.loading)} />
  );

  return { preview, download, modal };
};

export default useAdvancePaymentPdf;
