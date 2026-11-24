/**
 * Shared fixture helper — take an APPROVED indent through the QUOTED path (Step 1.2 "Quote Required? = Yes"
 * → Step 1.3) so its items are PO-eligible WITHOUT a vendor fixed (or with one).
 *
 * Why: "Quote Required? = No" now needs a vendor that already supplied each item, so a fixture that wants
 * items "open to any vendor on the PO form" (or a vendor that never supplied the SKU) goes through a
 * quotation instead. A vendor named on a Step 1.2 quotation file is ELIGIBLE for that item (quoted OR
 * previously supplied — indent/itemVendorHistory.js eligibleVendorsForItems).
 *
 *   post(path, body)   → the response data (throws on >= 400); path is /procurement/...
 *   quoteVendor        → { id, name } named on every quotation file (omit for untagged files)
 *   approveVendorId    → the vendor Step 1.3 approves each item for (omit: Step 1.3 vendor stays open)
 */
export const quoteAndApprove = async (post, indent, { quoteVendor = null, approveVendorId = null, tag = 'q' } = {}) => {
  const files = (it, i) => [{
    fileName: `${tag}-${i}.pdf`, fileUrl: `https://example.invalid/e2e/${tag}-${String(it._id)}.pdf`, fileType: 'application/pdf',
    ...(quoteVendor ? { vendorId: String(quoteVendor.id), vendorName: quoteVendor.name } : {}),
  }];
  await post(`/procurement/indents/${indent._id}/quote-comparative`, {
    statusDone: 'YES',
    itemQuotations: indent.items.map((it, i) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES', quotationDocuments: files(it, i),
    })),
  });
  await post(`/procurement/indents/${indent._id}/approve-quotation`, {
    itemApprovedQuotations: indent.items.map((it, i) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES',
      approvedQuotationDocuments: files(it, i).map(({ fileName, fileUrl, fileType }) => ({ fileName, fileUrl, fileType })),
      ...(approveVendorId ? { vendorId: String(approveVendorId) } : {}),
      actualAt: new Date().toISOString().slice(0, 10), remarks: 'e2e',
    })),
  });
};
