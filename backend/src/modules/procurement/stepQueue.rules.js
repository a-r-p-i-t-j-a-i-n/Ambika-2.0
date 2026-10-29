/**
 * "Awaiting this step" queues for the Purchase FMS step screens — pure rules,
 * no DB access (stepQueue.js fetches the source documents).
 *
 * Every step from Follow-ups on lists its OWN records (follow-ups, advance
 * payments, GRNs, …), and those exist only once somebody records the first one.
 * Until then the upstream record that is waiting there (a released PO, an
 * approved PI, a QC-accepted GRN, a posted voucher, …) showed on none of the
 * step's tables. A queue lists those upstream records with their real status —
 * it never creates or changes anything, and a record leaves the queue as soon
 * as the step's own record exists (it then shows in the step's list instead).
 *
 * Row states:
 *   READY        the step's doer can act now
 *   IN_PROGRESS  the step was started but not finished (e.g. a draft QC)
 *   WAITING      blocked on someone else first (the MD's approval)
 */

export const QUEUE_STATES = ['READY', 'IN_PROGRESS', 'WAITING'];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * One definition per queue: which document type it lists and how a document
 * becomes a row. `action` names the step's existing create dialog the row may
 * open (frontend), only when that dialog's own guards would accept the record.
 */
export const STEP_QUEUES = {
  // Step 1.5 — released POs with no follow-up logged yet.
  FOLLOW_UP: {
    label: 'Awaiting first follow-up',
    entityType: 'PO',
    toRow: (po) => ({
      number: po.poNumber || po.draftNumber || '',
      refs: [po.indentNumber && `Indent ${po.indentNumber}`].filter(Boolean),
      vendorName: po.vendorName || '',
      date: po.releasedAt || po.poDate || po.createdAt || null,
      dueDate: po.expectedDeliveryDate || null,
      amount: num(po.grandTotal ?? po.totalAmount),
      state: 'READY',
      statusLabel: 'Follow-up not started',
      link: `/procurement/purchase-orders/${po._id}`,
      action: 'START_FOLLOW_UP',
    }),
  },

  // Step 1.7 — PIs ready for their advance. Mirrors the PI detail page: a PI
  // already sent to the MD waits there; any other one can be paid (the first
  // payment attempt sends it to the MD when it still needs approval).
  ADVANCE_PAYMENT: {
    label: 'Awaiting advance payment',
    entityType: 'PI',
    toRow: (pi) => {
      const waitingMd = pi.mdApprovalStatus === 'READY_FOR_MD_APPROVAL';
      const paid = Number(pi.paidAmount) || 0;
      return {
        number: pi.piNumber || '',
        refs: [pi.poNumber && `PO ${pi.poNumber}`].filter(Boolean),
        vendorName: pi.vendorName || '',
        date: pi.piDate || pi.createdAt || null,
        amount: num(pi.balanceAmount),
        state: waitingMd ? 'WAITING' : 'READY',
        statusLabel: waitingMd ? 'Waiting for MD approval' : (paid > 0 ? 'Part paid — balance due' : 'Advance pending'),
        link: `/procurement/proforma-invoices/${pi._id}`,
        action: waitingMd ? null : 'RECORD_ADVANCE',
      };
    },
  },

  // Step 1.8 — POs whose material is ready for GRN (doer-task rule). The first
  // GRN also needs a Final Material Date (`hasFinalMaterialDate`, resolved by
  // stepQueue.js like grn.service create()); without one the follow-up must
  // record it first.
  GRN: {
    label: 'Awaiting GRN',
    entityType: 'PO',
    toRow: (po) => {
      const partial = po.poStatus === 'PARTIAL_RECEIVED';
      const blocked = !partial && po.hasFinalMaterialDate === false;
      return {
        number: po.poNumber || '',
        refs: [po.indentNumber && `Indent ${po.indentNumber}`].filter(Boolean),
        vendorName: po.vendorName || '',
        date: po.readyForGrnAt || po.finalMaterialDate || po.releasedAt || po.createdAt || null,
        dueDate: po.expectedDeliveryDate || null,
        amount: num(po.grandTotal ?? po.totalAmount),
        state: blocked ? 'WAITING' : 'READY',
        statusLabel: partial ? 'Partly received — next GRN' : (blocked ? 'Final Material Date missing' : 'Ready for GRN'),
        link: `/procurement/purchase-orders/${po._id}`,
        action: blocked ? null : 'CREATE_GRN',
      };
    },
  },

  // Step 1.9 — received GRNs with QC pending, and internal-service indents
  // waiting for their QC. QC is entered on the GRN page / the indent.
  INCOMING_QC: {
    label: 'Awaiting QC',
    entityType: 'GRN',
    toRow: (doc, entityType) => {
      if (entityType === 'INDENT') {
        return {
          number: doc.indentNumber || '',
          refs: ['Internal service'],
          vendorName: doc.approvedVendors?.[0]?.vendorName || '',
          date: doc.timestamp || doc.createdAt || null,
          amount: null,
          state: 'READY',
          statusLabel: doc.overallStatus === 'SERVICE_COMPLETED' ? 'Service completed — QC pending' : 'Service QC pending',
          link: `/procurement/indents/${doc._id}`,
          action: null,
        };
      }
      const started = (doc.qcIds?.length || 0) > 0 || Boolean(doc.qcId);
      return {
        number: doc.grnNumber || '',
        refs: [doc.poNumber && `PO ${doc.poNumber}`, doc.isWithoutPo && 'Without PO'].filter(Boolean),
        vendorName: doc.vendorName || '',
        date: doc.grnDate || doc.createdAt || null,
        amount: null,
        state: started ? 'IN_PROGRESS' : 'READY',
        statusLabel: started ? `QC started${doc.qcNumber ? ` (${doc.qcNumber})` : ''}` : 'Ready for QC',
        link: `/procurement/grns/${doc._id}`,
        action: null,
      };
    },
  },

  // Step 1.10 — QC-accepted material not yet (fully) invoiced. Rows come from
  // the Vendor Invoice module's own invoiceable calculation.
  VENDOR_INVOICE: {
    label: 'Awaiting invoice',
    entityType: 'QC',
    toRow: (qc) => ({
      number: qc.grnNumber || qc.qcNumber || '',
      refs: [qc.qcNumber && `QC ${qc.qcNumber}`, qc.poNumber && `PO ${qc.poNumber}`].filter(Boolean),
      vendorName: qc.vendorName || '',
      date: qc.qcDate || qc.grnDate || null,
      amount: null,
      pendingQty: num(qc.totalPendingInvoiceQty),
      state: 'READY',
      statusLabel: (Number(qc.totalPendingInvoiceQty) || 0) < (Number(qc.totalAccepted) || 0) ? 'Part invoiced' : 'Invoice pending',
      link: `/procurement/incoming-qc/${qc._id}`,
      action: 'CREATE_INVOICE',
    }),
  },

  // Step 1.12 — posted vouchers with no Tally entry yet.
  TALLY_ENTRY: {
    label: 'Awaiting Tally entry',
    entityType: 'VOUCHER',
    toRow: (v) => ({
      number: v.voucherNumber || '',
      refs: [v.invoiceNumber && `Invoice ${v.invoiceNumber}`].filter(Boolean),
      vendorName: v.vendorName || v.partyName || '',
      date: v.postedAt || v.voucherDate || v.createdAt || null,
      amount: num(v.netPayableAmount ?? v.totalAmount),
      state: 'READY',
      statusLabel: 'Tally entry pending',
      link: `/procurement/vouchers/${v._id}`,
      action: 'CREATE_TALLY_ENTRY',
    }),
  },

  // Step 1.13 — Tally-completed vouchers with a balance to pay. Payment waits
  // for the MD (finalPayment.service.js), so an unapproved one is WAITING.
  FINAL_PAYMENT: {
    label: 'Awaiting final payment',
    entityType: 'VOUCHER',
    toRow: (v) => {
      const approved = v.approvalStatus === 'MD_APPROVED';
      const paid = Number(v.paidAmount) || 0;
      return {
        number: v.voucherNumber || '',
        refs: [v.invoiceNumber && `Invoice ${v.invoiceNumber}`].filter(Boolean),
        vendorName: v.vendorName || v.partyName || '',
        date: v.postedAt || v.voucherDate || v.createdAt || null,
        amount: num(v.balanceAmount),
        state: approved ? 'READY' : 'WAITING',
        statusLabel: approved ? (paid > 0 ? 'Part paid — balance due' : 'Payment pending') : 'Waiting for MD approval',
        link: `/procurement/vouchers/${v._id}`,
        action: approved ? 'RECORD_FINAL_PAYMENT' : null,
      };
    },
  },
};

export const QUEUE_KEYS = Object.keys(STEP_QUEUES);

/** A queue row for `doc` (the raw document is kept as `record` for the dialogs' presets). */
export const toQueueRow = (queueKey, doc, entityType = STEP_QUEUES[queueKey].entityType) => ({
  _id: String(doc._id),
  entityType,
  ...STEP_QUEUES[queueKey].toRow(doc, entityType),
  record: doc,
});

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dayStart = (d) => new Date(`${d}T00:00:00`);
const dayEnd = (d) => new Date(`${d}T23:59:59.999`);

/**
 * Filters, counts and pages queue rows the same way the step lists do on the
 * server: search (number / refs / vendor), vendor, date range, then state.
 * `stateCounts` is counted BEFORE the state filter so the state tiles keep
 * their numbers while one of them is selected; `total` is after every filter.
 */
export const filterQueueRows = (rows, { search, vendor, from, to, state, page = 1, limit = 25 } = {}) => {
  const re = search ? new RegExp(escapeRegex(String(search).trim()), 'i') : null;
  const fromAt = from ? dayStart(from) : null;
  const toAt = to ? dayEnd(to) : null;
  const narrowed = rows.filter((r) => {
    if (re && ![r.number, r.vendorName, ...(r.refs || [])].some((t) => t && re.test(t))) return false;
    if (vendor && r.vendorName !== vendor) return false;
    const at = r.date ? new Date(r.date) : null;
    if (fromAt && (!at || at < fromAt)) return false;
    if (toAt && (!at || at > toAt)) return false;
    return true;
  });
  const stateCounts = Object.fromEntries(QUEUE_STATES.map((s) => [s, 0]));
  narrowed.forEach((r) => { stateCounts[r.state] = (stateCounts[r.state] || 0) + 1; });
  const matching = state ? narrowed.filter((r) => r.state === state) : narrowed;
  matching.sort((a, b) => (new Date(b.date || 0) - new Date(a.date || 0)) || String(b.number).localeCompare(String(a.number)));

  const safeLimit = Math.max(1, Number(limit) || 25);
  const total = matching.length;
  const totalPages = Math.ceil(total / safeLimit);
  const safePage = Math.max(1, Number(page) || 1);
  const docs = matching.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  const vendors = [...new Set(rows.map((r) => r.vendorName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    docs,
    stateCounts,
    unfilteredTotal: rows.length,
    vendors,
    pagination: { total, page: safePage, limit: safeLimit, totalPages, hasNext: safePage < totalPages, hasPrev: safePage > 1 },
  };
};
