import React, { useState } from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

/**
 * Plain-language answer to "why a Vendor Invoice AND a Payment Voucher?" plus
 * the invoice-to-payment lifecycle. Presentation only — no workflow rule lives
 * here; the stages mirror what the server already enforces.
 */
export const LIFECYCLE = [
  { key: 'invoice', title: 'Record supplier invoice', sub: 'Validate the bill against GRN / PO, then approve' },
  { key: 'voucher', title: 'Prepare & approve voucher', sub: 'Draft is prepared on approval — Review & Post' },
  { key: 'tally',   title: 'Post to Tally', sub: 'Tally Entry on the posted voucher' },
  { key: 'payment', title: 'Record payment', sub: 'Part or full payments (needs MD approval)' },
  { key: 'balance', title: 'Track balance', sub: 'Outstanding until fully paid or short-closed' },
];

const STORE_KEY = 'pfms.invoiceVoucherExplainer.hidden';
const readHidden = () => { try { return window.localStorage.getItem(STORE_KEY) === '1'; } catch { return false; } };
const writeHidden = (v) => { try { window.localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch { /* optional convenience */ } };

const Term = ({ title, children }) => (
  <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: PFMS.ink }}>{title}</Typography>
    <Typography variant="body2" sx={{ color: PFMS.sub }}>{children}</Typography>
  </Box>
);

const InvoiceVoucherExplainer = () => {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => setHidden((h) => { writeHidden(!h); return !h; });
  return (
    <Paper data-testid="invoice-voucher-explainer" sx={{ ...pfmsCardSx, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: PFMS.ink }}>
          How Vendor Invoice and Payment Voucher fit together
        </Typography>
        <Button size="small" onClick={toggle} endIcon={hidden ? <ChevronDown size={14} /> : <ChevronUp size={14} />}>
          {hidden ? 'Show' : 'Hide'}
        </Button>
      </Box>
      {!hidden && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
            <Term title="Vendor Invoice — the supplier's bill">
              What the vendor billed us, checked against the GRN / PO and QC-accepted quantities. Approving it makes it payable.
            </Term>
            <Term title="Payment Voucher — our accounting document">
              Prepared automatically as a draft when the invoice is approved. It is posted, signed by the MD, entered in Tally and paid — in one or more payments.
            </Term>
            <Term title="Expense & Direct Purchase vouchers">
              Bills with no vendor invoice step (office expenses, direct purchases) start straight as a voucher under All Payment Vouchers.
            </Term>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(5, minmax(0, 1fr))' }, gap: 1, mt: 1.5 }}>
            {LIFECYCLE.map((s, i) => (
              <Box key={s.key} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surface, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: 'primary.main' }}>{i + 1}</Typography>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: PFMS.ink }}>{s.title}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: PFMS.sub }}>{s.sub}</Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Paper>
  );
};

export default InvoiceVoucherExplainer;
