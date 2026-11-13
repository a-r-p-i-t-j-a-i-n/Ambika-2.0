import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  Backdrop, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, IconButton, Box,
} from '@mui/material';
import { X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIndentQuery, useGetPurchaseOrderQuery, useGetProformaInvoiceByIdQuery, useGetGrnByIdQuery,
  useGetIncomingQcByIdQuery, useGetVendorInvoiceByIdQuery, useGetVoucherByIdQuery, useSubmitIndentMutation,
  useGetFollowUpsByPoQuery, useCreateFollowUpMutation, useGetGrnsByPoQuery, useGetTallyEntriesByVoucherQuery,
} from '../../store/api/procurementApi';
import { useStartServiceQc } from '../procurement/indents/useStartServiceQc';

/**
 * Runs one Purchase task's action right on My FMS Tasks: loads the record the
 * task waits on, then opens the same form its own page uses (IndentDetail,
 * PurchaseOrderDetail, GrnDetail, VoucherPanel, …) with that record. Saving
 * there moves the record on; the server's task sync then completes this task
 * and opens the next step's. `onDone` runs when the form closes, saved or not.
 */

const IndentFormDrawer = lazy(() => import('../procurement/indents/IndentFormDrawer'));
const IndentApprovalDialog = lazy(() => import('../procurement/indents/IndentApprovalDialog'));
const QuoteComparativeDialog = lazy(() => import('../procurement/indents/QuoteComparativeDialog'));
const QuotationApprovalDialog = lazy(() => import('../procurement/indents/QuotationApprovalDialog'));
const PurchaseOrderFormDrawer = lazy(() => import('../procurement/purchase-orders/PurchaseOrderFormDrawer'));
const PurchaseOrderApprovalDialog = lazy(() => import('../procurement/purchase-orders/PurchaseOrderApprovalDialog'));
const PurchaseOrderReleaseDialog = lazy(() => import('../procurement/purchase-orders/PurchaseOrderReleaseDialog'));
const FollowUpFormDrawer = lazy(() => import('../procurement/follow-ups/FollowUpFormDrawer'));
const FollowUpDoneDialog = lazy(() => import('../procurement/follow-ups/FollowUpDoneDialog'));
const FollowUpReadyForGrnDialog = lazy(() => import('../procurement/follow-ups/FollowUpReadyForGrnDialog'));
const ProformaInvoiceFormDrawer = lazy(() => import('../procurement/proforma-invoices/ProformaInvoiceFormDrawer'));
const ProformaInvoiceApprovalDialog = lazy(() => import('../procurement/proforma-invoices/ProformaInvoiceApprovalDialog'));
const AdvancePaymentFormDialog = lazy(() => import('../procurement/advance-payments/AdvancePaymentFormDialog'));
const GrnFormDialog = lazy(() => import('../procurement/grn/GrnFormDialog'));
const GrnQcSections = lazy(() => import('../procurement/grn/GrnQcSection').then((m) => ({ default: m.GrnQcSections })));
const VendorInvoiceFormDialog = lazy(() => import('../procurement/vendor-invoices/VendorInvoiceFormDialog'));
const VendorInvoiceApprovalDialog = lazy(() => import('../procurement/vendor-invoices/VendorInvoiceApprovalDialog'));
const VoucherFormDialog = lazy(() => import('../procurement/vouchers/VoucherFormDialog'));
const VoucherPanel = lazy(() => import('../procurement/vouchers/VoucherPanel'));
const TallyEntryFormDialog = lazy(() => import('../procurement/tally-entry/TallyEntryFormDialog'));
const TallyEntryCompleteDialog = lazy(() => import('../procurement/tally-entry/TallyEntryCompleteDialog'));
const FinalPaymentFormDialog = lazy(() => import('../procurement/final-payments/FinalPaymentFormDialog'));

const Loading = () => (
  <Backdrop open sx={{ zIndex: (t) => t.zIndex.modal + 1, color: '#fff' }}><CircularProgress color="inherit" /></Backdrop>
);

// A page section (GRN QC, voucher) shown in a dialog of its own.
const SectionDialog = ({ title, onClose, children }) => (
  <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 800 }}>
      {title}
      <IconButton size="small" onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
    </DialogTitle>
    <DialogContent dividers sx={{ bgcolor: '#f8fafc' }}>{children}</DialogContent>
    <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
  </Dialog>
);

// One click, then a confirm — for the steps whose page action is a single button.
const ConfirmDialog = ({ title, text, confirmLabel, busy, onConfirm, onClose }) => (
  <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
    <DialogTitle sx={{ fontWeight: 800 }}>{title}</DialogTitle>
    <DialogContent><Typography variant="body2">{text}</Typography></DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="contained" disableElevation onClick={onConfirm} disabled={busy}
        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}>
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

const SubmitIndent = ({ indent, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [submitIndent, { isLoading }] = useSubmitIndentMutation();
  const submit = async () => {
    try {
      await submitIndent(indent._id).unwrap();
      enqueueSnackbar('Submitted for approval', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to submit', { variant: 'error' });
    }
  };
  const lines = indent.items?.length || 0;
  return (
    <ConfirmDialog title={`Submit indent ${indent.indentNumber || ''}`.trim()}
      text={`Send this indent${lines ? ` (${lines} item${lines === 1 ? '' : 's'})` : ''} to the approver? To change it first, use Edit Indent.`}
      confirmLabel="Submit for Approval" busy={isLoading} onConfirm={submit} onClose={onClose} />
  );
};

const StartServiceQc = ({ indent, onClose }) => {
  const { startServiceQc, starting } = useStartServiceQc();
  return (
    <ConfirmDialog title={`Service QC — ${indent.indentNumber || 'indent'}`}
      text="Start the Incoming QC for this internal-service indent? Its QC page opens, where you attach the service report and record Pass / Fail."
      confirmLabel="Start Service QC" busy={starting}
      onConfirm={async () => { await startServiceQc(indent); onClose(); }} onClose={onClose} />
  );
};

// Steps whose record may already have its own open record (follow-up, draft
// GRN, pending Tally Entry) finish that one — as its page does — rather than
// create a second. Decided once from the first load: saving changes the list
// underneath, and the open form must not switch to another while it closes.
const useOnce = (ready, decide) => {
  const [choice, setChoice] = useState(null);
  if (!choice && ready) setChoice(decide());
  return choice;
};

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// Step 1.5 — PurchaseOrderDetail's "Update Follow-up", same rules: a confirmed
// follow-up → Mark Ready for GRN; the active (PENDING / RESCHEDULED) one →
// Mark Done (Final Material Date, or the next follow-up date); none yet → start
// one for the expected delivery date and mark it, or, with no date, the new
// follow-up form. A PO holds one active follow-up (the server refuses a second).
const FollowUpStep = ({ po, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, isError } = useGetFollowUpsByPoQuery(po._id);
  const [createFollowUp, { isLoading: starting }] = useCreateFollowUpMutation();
  const [started, setStarted] = useState(null);
  const plan = useOnce(!isLoading && (data || isError), () => {
    const list = data?.data || [];
    const active = list.find((f) => ['PENDING', 'RESCHEDULED'].includes(f.followUpStatus));
    const ready = list.find((f) => f.followUpStatus === 'DONE' && f.finalMaterialDate);
    return ready && po.followUpStatus !== 'READY_FOR_GRN' ? { kind: 'ready', followUp: ready }
      : active ? { kind: 'done', followUp: active }
        : po.expectedDeliveryDate ? { kind: 'start' }
          : { kind: 'new' };
  });
  if (!plan) return <Loading />;
  if (plan.kind === 'ready') return <FollowUpReadyForGrnDialog open followUp={plan.followUp} onClose={onClose} />;
  if (plan.kind === 'done') return <FollowUpDoneDialog open followUp={plan.followUp} onClose={onClose} />;
  if (plan.kind === 'new') return <FollowUpFormDrawer open presetPo={po} onClose={onClose} />;
  if (started) return <FollowUpDoneDialog open followUp={started} onClose={onClose} />;
  const start = async () => {
    try {
      const res = await createFollowUp({ poId: po._id, plannedAt: po.expectedDeliveryDate }).unwrap();
      setStarted(res?.data);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to start the follow-up', { variant: 'error' });
      onClose();
    }
  };
  return (
    <ConfirmDialog title={`Follow-up — ${po.poNumber || 'PO'}`}
      text={`Start the vendor follow-up for this PO (expected delivery ${fmtDay(po.expectedDeliveryDate)}), then record what the vendor said?`}
      confirmLabel="Start Follow-up" busy={starting} onConfirm={start} onClose={onClose} />
  );
};

// Step 1.8 — as PurchaseOrderDetail: a draft GRN on this PO → its GRN + QC form; else a new GRN.
const GrnStep = ({ po, onClose }) => {
  const { data, isLoading, isError } = useGetGrnsByPoQuery(po._id);
  const choice = useOnce(!isLoading && (data || isError), () => {
    const draft = (data?.data || []).find((g) => g.grnStatus === 'DRAFT');
    return draft ? { draft } : { draft: null };
  });
  if (!choice) return <Loading />;
  return choice.draft
    ? <GrnFormDialog open grn={choice.draft} onClose={onClose} />
    : <GrnFormDialog open presetPo={po} onClose={onClose} />;
};

// Step 1.12 — as VoucherPanel: a pending Tally Entry on this voucher → complete
// it (the server allows one per voucher); else a new one.
const TallyStep = ({ voucher, onClose }) => {
  const { data, isLoading, isError } = useGetTallyEntriesByVoucherQuery(voucher._id);
  const choice = useOnce(!isLoading && (data || isError), () => {
    const pending = (data?.data || []).find((t) => t.tallyEntryStatus === 'PENDING');
    return pending ? { pending } : { pending: null };
  });
  if (!choice) return <Loading />;
  return choice.pending
    ? <TallyEntryCompleteDialog open entry={choice.pending} onClose={onClose} />
    : <TallyEntryFormDialog open presetVoucher={voucher} onClose={onClose} />;
};

// What the QC page hands the invoice form (IncomingQCDetail does the same).
const qcPreset = (qc) => ({ _id: qc._id, qcNumber: qc.qcNumber, vendorName: qc.vendorName, grnNumber: qc.grnNumber, poNumber: qc.poNumber, piId: qc.piId });

// action key → the form, open, holding the record.
const FORMS = {
  INDENT_SUBMIT: (r, close) => <SubmitIndent indent={r} onClose={close} />,
  INDENT_EDIT: (r, close) => <IndentFormDrawer open indent={r} onClose={close} />,
  INDENT_APPROVE: (r, close) => <IndentApprovalDialog open indent={r} onClose={close} />,
  QUOTE_COMPARATIVE: (r, close) => <QuoteComparativeDialog open indent={r} onClose={close} />,
  QUOTATION_APPROVE: (r, close) => <QuotationApprovalDialog open indent={r} onClose={close} />,
  PO_CREATE: (r, close) => <PurchaseOrderFormDrawer open presetIndent={r} onClose={close} />,
  PO_APPROVE: (r, close) => <PurchaseOrderApprovalDialog open po={r} onClose={close} />,
  PO_RELEASE: (r, close) => <PurchaseOrderReleaseDialog open po={r} onClose={close} />,
  FOLLOW_UP: (r, close) => <FollowUpStep po={r} onClose={close} />,
  PI_APPROVE: (r, close) => <ProformaInvoiceApprovalDialog open pi={r} onClose={close} />,
  PI_EDIT: (r, close) => <ProformaInvoiceFormDrawer open pi={r} onClose={close} />,
  ADVANCE_PAYMENT: (r, close) => <AdvancePaymentFormDialog open pi={r} onClose={close} />,
  GRN_CREATE: (r, close) => <GrnStep po={r} onClose={close} />,
  GRN_QC: (r, close) => (
    <SectionDialog title={`Incoming QC — GRN ${r.grnNumber || ''}`.trim()} onClose={close}>
      <GrnQcSections grn={r} />
    </SectionDialog>
  ),
  SERVICE_QC: (r, close) => <StartServiceQc indent={r} onClose={close} />,
  INVOICE_CREATE: (r, close) => <VendorInvoiceFormDialog open presetQc={qcPreset(r)} onClose={close} />,
  INVOICE_APPROVE: (r, close) => <VendorInvoiceApprovalDialog open invoice={r} onClose={close} />,
  INVOICE_EDIT: (r, close) => <VendorInvoiceFormDialog open invoice={r} onClose={close} />,
  VOUCHER_CREATE: (r, close) => <VoucherFormDialog open presetInvoice={r} onClose={close} />,
  VOUCHER_POST: (r, close) => (
    <SectionDialog title={`Voucher ${r.voucherNumber || ''}`.trim()} onClose={close}>
      <VoucherPanel voucherId={r._id} embedded />
    </SectionDialog>
  ),
  TALLY_ENTRY: (r, close) => <TallyStep voucher={r} onClose={close} />,
  FINAL_PAYMENT: (r, close) => <FinalPaymentFormDialog open presetVoucher={r} onClose={close} />,
};

// The record the task waits on — only its own type's query runs.
const useTaskRecord = ({ entityType: type, entityId }) => {
  const id = String(entityId);
  const byType = {
    INDENT: useGetIndentQuery(id, { skip: type !== 'INDENT' }),
    PO: useGetPurchaseOrderQuery(id, { skip: type !== 'PO' }),
    PI: useGetProformaInvoiceByIdQuery(id, { skip: type !== 'PI' }),
    GRN: useGetGrnByIdQuery(id, { skip: type !== 'GRN' }),
    QC: useGetIncomingQcByIdQuery(id, { skip: type !== 'QC' }),
    INVOICE: useGetVendorInvoiceByIdQuery(id, { skip: type !== 'INVOICE' }),
    VOUCHER: useGetVoucherByIdQuery(id, { skip: type !== 'VOUCHER' }),
  };
  const q = byType[type];
  if (!q) return { record: null, isLoading: false, isError: true };
  return { record: q.data?.data || null, isLoading: q.isLoading, isError: q.isError };
};

// Mounted with a `key` per task + action.
const PurchaseTaskRunner = ({ task, actionKey, onDone }) => {
  const { enqueueSnackbar } = useSnackbar();
  const { record, isLoading, isError } = useTaskRecord(task);
  const form = FORMS[actionKey];
  const failed = !form || isError || (!isLoading && (!record || record.isDeleted));

  useEffect(() => {
    if (!failed) return;
    enqueueSnackbar(task.linkIssue || 'This record could not be opened here — open it from its page', { variant: 'warning' });
    onDone();
  }, [failed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return null;
  if (isLoading || !record) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <Box component="span" data-testid="purchase-task-form" data-action={actionKey} sx={{ display: 'none' }} />
      {form(record, onDone)}
    </Suspense>
  );
};

export default PurchaseTaskRunner;
