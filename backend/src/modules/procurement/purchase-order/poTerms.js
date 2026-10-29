/**
 * Purchase Order Terms & Conditions — the block printed beside the authorised
 * signatory on every PO PDF (JSL and OTHER formats).
 *
 * Where the text comes from, in order:
 *  1. the PO's own `termsAndConditions` — every PO created from now on carries
 *     one (the format's default at creation time, or whatever the buyer edited
 *     it to), so a later change to the defaults never rewrites an existing PO;
 *  2. a PO saved before that field existed printed its Remarks as the T&C —
 *     it keeps printing exactly that;
 *  3. the format's default from Company Settings (poTermsJsl / poTermsOther).
 *
 * BUILT_IN_PO_TERMS is only the first-run value of those two settings: the
 * exact text the PDFs printed before the terms became editable. Change the
 * wording (e.g. the price-protection date) in Company Settings, not here.
 *
 * No imports — the CompanySettings model reads the built-in defaults from here.
 */
export const PO_TERMS_MAX = 4000;

export const BUILT_IN_PO_TERMS = Object.freeze({
  JSL: 'This order is under Price Protection Policy till 30th June 2026.',
  OTHER: '1. Kindly sign and fax back to mark a token of your confirmation.\n'
    + '2. Kindly mention the purchase order number on the tax invoice. Extra qty other than PO will not be accepted.',
});

// PO format → CompanySettings field holding that format's default terms.
export const PO_TERMS_SETTING_FIELDS = Object.freeze({ JSL: 'poTermsJsl', OTHER: 'poTermsOther' });

export const poTermsFormat = (fmt) => (fmt === 'JSL' ? 'JSL' : 'OTHER');

/** Line breaks kept as typed; Windows line endings, tabs and trailing blanks tidied. */
export const normalizePoTerms = (text) => String(text ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/\t/g, '    ')
  .replace(/[  ]+$/gm, '')
  .replace(/^\n+|\s+$/g, '');

/** Default terms for a format, from the loaded settings (or the built-in text). */
export const defaultPoTerms = (fmt, defaults) => {
  const f = poTermsFormat(fmt);
  return normalizePoTerms(defaults?.[f]) || BUILT_IN_PO_TERMS[f];
};

/** The Terms & Conditions a PO prints — see the order at the top of this file. */
export const resolvePoTerms = (po = {}, defaults) => {
  const own = normalizePoTerms(po.termsAndConditions);
  if (own) return own;
  if (po.termsAndConditions == null) {
    const legacy = normalizePoTerms(po.remarks);
    if (legacy) return legacy;
  }
  return defaultPoTerms(po.poFormatType, defaults);
};

// The PDF's built-in Helvetica only has the Windows-1252 characters; the rupee
// sign is not one of them, so it prints the way the rest of the PO does.
export const pdfSafePoTerms = (text) => String(text).replace(/₹\s?/g, 'Rs. ');
