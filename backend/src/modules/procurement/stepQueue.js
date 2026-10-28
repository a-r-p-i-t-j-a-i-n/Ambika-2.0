/**
 * "Awaiting this step" queues (rules + row shape: stepQueue.rules.js). Each
 * queue reads the documents with the SAME rule the doer tasks use
 * (fms-doers/fmsCatalog.js) or the module's own eligibility calculation, and
 * drops any document whose step record already exists — that one is listed on
 * the step's own table. Read-only.
 */
import { getStep } from '../fms-doers/fmsCatalog.js';
import ProformaInvoice from './proforma-invoice/proformaInvoice.model.js';
import PurchaseFollowUp from './follow-up/followUp.model.js';
import PurchaseTallyEntry from './tally-entry/tallyEntry.model.js';
import VendorVoucher from './voucher/voucher.model.js';
import { vendorInvoiceService } from './vendor-invoice/vendorInvoice.service.js';
import { AppError } from '../../utils/apiResponse.js';
import { STEP_QUEUES, toQueueRow, filterQueueRows } from './stepQueue.rules.js';

const live = { isDeleted: { $ne: true } };

/** [{ entityType, doc }] from a catalog step's sources. */
const fromCatalog = async (stepKey) => {
  const step = getStep('PURCHASE', stepKey);
  const lists = await Promise.all(step.sources.map(async (s) => (await s.find()).map((doc) => ({ entityType: s.entityType, doc }))));
  return lists.flat();
};

const idSet = (ids) => new Set(ids.filter(Boolean).map(String));

const SOURCES = {
  async FOLLOW_UP() {
    const items = await fromCatalog('MATERIAL_FOLLOWUP');
    if (!items.length) return [];
    const started = idSet(await PurchaseFollowUp.find({ ...live, poId: { $in: items.map((i) => i.doc._id) } }).distinct('poId'));
    return items.filter((i) => !started.has(String(i.doc._id)));
  },

  async ADVANCE_PAYMENT() {
    // Same status the Advance Payment module accepts a payment for.
    const pis = await ProformaInvoice.find({ ...live, piStatus: 'READY_FOR_ADVANCE_PAYMENT' }).lean();
    return pis.map((doc) => ({ entityType: 'PI', doc }));
  },

  async GRN() {
    // grn.service create() also needs a Final Material Date before the first
    // GRN (the PO's own, else the latest follow-up's) — resolved the same way
    // so the row only offers Create GRN when the server would accept it.
    const items = await fromCatalog('GRN');
    const needFu = items.filter((i) => i.doc.readyForGrnAt && !i.doc.finalMaterialDate).map((i) => i.doc._id);
    const fuDated = needFu.length
      ? idSet(await PurchaseFollowUp.find({ ...live, poId: { $in: needFu }, finalMaterialDate: { $ne: null } }).distinct('poId'))
      : new Set();
    return items.map(({ entityType, doc }) => ({
      entityType,
      doc: {
        ...doc,
        hasFinalMaterialDate: Boolean(doc.readyForGrnAt && (doc.finalMaterialDate || fuDated.has(String(doc._id)))),
      },
    }));
  },

  INCOMING_QC: () => fromCatalog('INCOMING_QC'),

  async VENDOR_INVOICE() {
    const qcs = await vendorInvoiceService.getInvoiceableQcs({});
    return qcs.map((doc) => ({ entityType: 'QC', doc }));
  },

  async TALLY_ENTRY() {
    const items = await fromCatalog('TALLY_ENTRY');
    if (!items.length) return [];
    const entered = idSet(await PurchaseTallyEntry.find({
      ...live, voucherId: { $in: items.map((i) => i.doc._id) }, tallyEntryStatus: { $ne: 'CANCELLED' },
    }).distinct('voucherId'));
    return items.filter((i) => !entered.has(String(i.doc._id)));
  },

  async FINAL_PAYMENT() {
    // The doer-task rule (fmsCatalog FINAL_PAYMENT) minus its MD condition, so
    // a voucher still waiting for the MD is listed as WAITING, not hidden.
    const vouchers = await VendorVoucher.find({
      ...live,
      tallyEntryStatus: 'COMPLETED',
      voucherStatus: { $nin: ['FULLY_PAID', 'SHORT_CLOSED', 'CANCELLED'] },
      balanceAmount: { $gt: 0 },
    }).lean();
    return vouchers.map((doc) => ({ entityType: 'VOUCHER', doc }));
  },
};

export const stepQueueService = {
  async list(queueKey, query = {}) {
    const def = STEP_QUEUES[queueKey];
    if (!def) throw new AppError(`Unknown step queue ${queueKey}`, 404);
    const items = await SOURCES[queueKey]();
    const rows = items.map(({ entityType, doc }) => toQueueRow(queueKey, doc, entityType));
    return { label: def.label, ...filterQueueRows(rows, query) };
  },
};
