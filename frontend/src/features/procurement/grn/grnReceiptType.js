import { howReceivedLabel } from './grnMeta';

/**
 * Material Receipt Type is chosen per GRN line (items[].howItemReceived). The
 * GRN header's howItemReceived is kept for GRNs saved before that move — their
 * lines carry none and read the header's value as their own.
 */

// A new row starts at the value the old header dropdown defaulted to.
export const DEFAULT_HOW_ITEM_RECEIVED = 'FULL_MATERIAL_RECEIVED';

/** A line's Material Receipt Type — its own, else the GRN header's (older GRNs). */
export const lineReceiptType = (it, grn) => it?.howItemReceived || grn?.howItemReceived || '';

/** One label for the whole GRN: the type every line shares, or "Per item (mixed)" when they differ. */
export const receiptTypeSummaryLabel = (grn) => {
  const types = [...new Set((grn?.items || []).map((it) => lineReceiptType(it, grn)).filter(Boolean))];
  return types.length > 1 ? 'Per item (mixed)' : howReceivedLabel(types[0] || grn?.howItemReceived);
};
