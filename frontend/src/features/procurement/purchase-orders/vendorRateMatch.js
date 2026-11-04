/**
 * Vendor-Master rate matching for Purchase Orders (Step 1.4).
 *
 * Pure helpers (no React): given a vendor's `products[]` catalog and a line, decide
 * which catalog product the line maps to. Used by the JSL format only (its base rate
 * and grade / width / finish come from the Jindal catalog). The OTHER format does not
 * match the catalog here: its rate comes from the server's vendor-rate lookup
 * (poRateLookup.js), which also respects the line's unit.
 */

// Normalize a string for tolerant comparison: trim, lowercase, collapse spaces.
export const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Match a PO / indent line to a vendor-catalog product, in priority order:
 *   1. skuCode      — exact, case-insensitive, trimmed   (highest)
 *   2. skuId        — productId exact match
 *   3. productName  — exact, normalized (trim + case-insensitive)
 *   4. productName  — loose contains (either direction)
 *   5. JSL only     — grade + width + finish tokens vs product name / notes
 * Returns { product, reason }: product is null when nothing matched, with
 * `reason` explaining why (used for the no-rate warning + debug logging).
 */
export const matchVendorProductDetailed = (products = [], line = {}) => {
  if (!products.length) return { product: null, reason: 'Vendor Master has no products for this vendor' };
  const { skuCode, skuId, itemName, grade, width, finish } = line;

  if (skuCode) {
    const want = String(skuCode).trim().toUpperCase();
    const bySku = products.find((p) => p.skuCode && String(p.skuCode).trim().toUpperCase() === want);
    if (bySku) return { product: bySku, reason: '' };
  }
  if (skuId) {
    const byId = products.find((p) => p.skuId && String(p.skuId) === String(skuId));
    if (byId) return { product: byId, reason: '' };
  }
  if (itemName) {
    const n = norm(itemName);
    const exact = products.find((p) => p.productName && norm(p.productName) === n);
    if (exact) return { product: exact, reason: '' };
    const loose = products.find((p) => p.productName && (norm(p.productName).includes(n) || n.includes(norm(p.productName))));
    if (loose) return { product: loose, reason: '' };
  }
  // JSL spec fallback — match grade/width/finish tokens against name + notes.
  const specTokens = [grade, width, finish].filter(Boolean).map(norm);
  if (specTokens.length) {
    const bySpec = products.find((p) => {
      const hay = `${norm(p.productName)} ${norm(p.notes)}`;
      return specTokens.every((t) => hay.includes(t));
    });
    if (bySpec) return { product: bySpec, reason: '' };
  }
  const tried = [skuCode && `SKU "${skuCode}"`, itemName && `name "${itemName}"`].filter(Boolean).join(', ');
  return { product: null, reason: tried ? `No catalog product matched ${tried}` : 'Line has no SKU or name to match against' };
};

// Back-compat wrapper — returns just the product (or null).
export const matchVendorProduct = (products = [], line = {}) => matchVendorProductDetailed(products, line).product;
