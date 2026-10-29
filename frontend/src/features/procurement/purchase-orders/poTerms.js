// PO Terms & Conditions — mirrors backend purchase-order/poTerms.js.
export const PO_TERMS_MAX = 4000;

export const PO_FORMAT_LABEL = { JSL: 'JSL', OTHER: 'Other' };

/**
 * The terms a saved PO prints: its own copy; a PO saved before it had one
 * prints its Remarks; otherwise the format's default (`defaults` = { JSL, OTHER }).
 */
export const effectivePoTerms = (po, defaults) => {
  const own = (po?.termsAndConditions || '').trim();
  if (own) return own;
  if (po?.termsAndConditions == null && (po?.remarks || '').trim()) return po.remarks.trim();
  return defaults?.[po?.poFormatType === 'JSL' ? 'JSL' : 'OTHER'] || '';
};
