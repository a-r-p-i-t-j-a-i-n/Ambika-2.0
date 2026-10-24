/**
 * Vendor invoice numbering safeguard — is the "one live invoice number per
 * vendor" unique index really in the database?
 *
 * Mongoose builds schema indexes automatically, but it swallows a failed build
 * (each model's init() gets a no-op catch, and nothing here listens for the
 * 'index' event), so the app would otherwise run on without the index — and
 * without any protection against two concurrent invoices taking one number.
 * The outcome of that automatic build is therefore NOT trusted: this guard
 * reads the collection's indexes (listIndexes — read-only; it never creates,
 * drops or syncs an index) and compares the index against the schema's exact
 * declaration.
 *
 * Writes that can bring a number into use (create, number change) call
 * assertInvoiceNumberProtection() and are refused with 503 until the index is
 * confirmed. A failed check is retried after FAILED_RECHECK_MS, so writes resume
 * once an administrator restores the index — no restart needed. A confirmed
 * index is re-read after OK_RECHECK_MS, so one dropped later is noticed.
 * Status for /api/health: getInvoiceNumberIndexStatus() (in memory, no DB hit).
 */
import VendorInvoice from './vendorInvoice.model.js';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';

export const INVOICE_NUMBER_INDEX_NAME = 'uniq_live_vendor_invoice_number';
const OK_RECHECK_MS = 5 * 60 * 1000;
const FAILED_RECHECK_MS = 30 * 1000;

/** The index exactly as vendorInvoice.model.js declares it — the single source of truth. */
export const expectedInvoiceNumberIndex = () => {
  const [key, options] = VendorInvoice.schema.indexes().find(([, o]) => o?.name === INVOICE_NUMBER_INDEX_NAME) || [];
  return key ? { name: INVOICE_NUMBER_INDEX_NAME, key, unique: !!options.unique, partialFilterExpression: options.partialFilterExpression } : null;
};

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const keyJson = (key) => JSON.stringify(Object.entries(key || {}).map(([k, v]) => [k, Number(v)]));

/**
 * Compare a collection's listIndexes() result with the expected index.
 * @returns {{ ok: boolean, problem: string }}
 */
export const evaluateInvoiceNumberIndex = (indexes = [], expected = expectedInvoiceNumberIndex()) => {
  if (!expected) return { ok: false, problem: `The schema no longer declares "${INVOICE_NUMBER_INDEX_NAME}".` };
  const found = indexes.find((i) => i.name === expected.name);
  if (!found) {
    const lookalike = indexes.find((i) => keyJson(i.key) === keyJson(expected.key));
    return {
      ok: false,
      problem: lookalike
        ? `Index "${expected.name}" is missing; an index on the same fields exists as "${lookalike.name}" with different options.`
        : `Index "${expected.name}" is missing from the vendorinvoices collection.`,
    };
  }
  const issues = [];
  if (keyJson(found.key) !== keyJson(expected.key)) issues.push(`fields ${JSON.stringify(found.key)} instead of ${JSON.stringify(expected.key)}`);
  if (found.unique !== true) issues.push('not unique');
  if (!sameJson(found.partialFilterExpression, expected.partialFilterExpression)) {
    issues.push(`partial filter ${JSON.stringify(found.partialFilterExpression ?? null)} instead of ${JSON.stringify(expected.partialFilterExpression)}`);
  }
  if (found.collation) issues.push(`unexpected collation ${JSON.stringify(found.collation)}`);
  return issues.length
    ? { ok: false, problem: `Index "${expected.name}" is incorrect: ${issues.join('; ')}.` }
    : { ok: true, problem: '' };
};

const defaultDeps = {
  // Let Mongoose's own automatic build settle first — its result is only diagnostic.
  awaitAutoIndex: () => VendorInvoice.init(),
  readIndexes: () => VendorInvoice.collection.indexes(),
  now: () => Date.now(),
};

const state = { status: 'PENDING', problem: '', autoIndexError: '', checkedAt: null };
let inflight = null;

/** In-memory status for health checks. status: PENDING | OK | FAILED. */
export const getInvoiceNumberIndexStatus = () => ({
  index: INVOICE_NUMBER_INDEX_NAME,
  status: state.status,
  problem: state.problem,
  checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
});

/** Read the database and update the status. Concurrent callers share one check. */
export const verifyInvoiceNumberIndex = (deps = defaultDeps) => {
  if (inflight) return inflight;
  inflight = (async () => {
    const before = state.status;
    try {
      try {
        await deps.awaitAutoIndex();
        state.autoIndexError = '';
      } catch (err) {
        state.autoIndexError = err?.message || String(err);
      }
      let indexes = [];
      try {
        indexes = await deps.readIndexes();
      } catch (err) {
        // A collection that doesn't exist yet has no indexes — that is "missing", not an outage.
        if (err?.code !== 26 && err?.codeName !== 'NamespaceNotFound') throw err;
      }
      const result = evaluateInvoiceNumberIndex(indexes);
      state.status = result.ok ? 'OK' : 'FAILED';
      state.problem = result.ok ? '' : `${result.problem}${state.autoIndexError ? ` (automatic index build reported: ${state.autoIndexError})` : ''}`;
    } catch (err) {
      state.status = 'FAILED';
      state.problem = `Could not read the vendorinvoices indexes: ${err?.message || err}`;
    }
    state.checkedAt = deps.now();
    if (state.status === 'OK' && before !== 'OK') {
      logger.info(`[vendor-invoice] numbering safeguard verified — index "${INVOICE_NUMBER_INDEX_NAME}" present and correct`);
    } else if (state.status === 'FAILED') {
      logger.error(
        `[vendor-invoice] NUMBERING SAFEGUARD NOT IN PLACE — ${state.problem} `
        + 'Creating vendor invoices and changing invoice numbers are refused (503) until the index exists with the '
        + 'exact specification declared in vendorInvoice.model.js. Never use syncIndexes() to fix this.',
      );
    }
    return getInvoiceNumberIndexStatus();
  })().finally(() => { inflight = null; });
  return inflight;
};

/**
 * Gate for writes that can bring an invoice number into use. Resolves when the
 * index is confirmed; otherwise throws a 503 the user sees as a clear message.
 */
export const assertInvoiceNumberProtection = async (deps = defaultDeps) => {
  const age = state.checkedAt == null ? Infinity : deps.now() - state.checkedAt;
  const due = state.status === 'PENDING'
    || (state.status === 'FAILED' && age >= FAILED_RECHECK_MS)
    || (state.status === 'OK' && age >= OK_RECHECK_MS);
  if (due) await verifyInvoiceNumberIndex(deps);
  if (state.status !== 'OK') {
    throw new AppError(
      'Vendor invoice numbering safeguard is not in place, so new invoices and invoice-number changes are paused. '
      + 'Please contact the administrator.',
      503,
    );
  }
};

/** Tests only: forget the cached status. */
export const resetInvoiceNumberIndexGuard = () => {
  Object.assign(state, { status: 'PENDING', problem: '', autoIndexError: '', checkedAt: null });
  inflight = null;
};
