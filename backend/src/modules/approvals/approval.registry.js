/**
 * Registry mapping an approval document type to its adapter — this is what
 * keeps `approval.service.js` a generic engine with zero document-specific
 * logic. Each document module (GRN, Voucher, …) calls `registerApprovalDocument`
 * once, at import time, wiring itself into the shared engine; the engine only
 * ever calls back into whatever the registry hands it.
 *
 * Adapter shape:
 *   model             — the document's Mongoose model (for lookups + the
 *                        denormalized mirror-field update)
 *   numberField        — field on the parent doc used as its display number
 *                        (e.g. 'grnNumber') — used as a documentNumber fallback
 *   mirrorStatusField  — field on the parent doc mirroring approval status
 *                        (NOT_REQUIRED | READY_FOR_MD_APPROVAL | MD_APPROVED)
 *   pdfUrlField        — field on the parent doc holding its "current" PDF URL
 *                        (e.g. 'grnPdfUrl') — the engine repoints this at the
 *                        signed PDF once signed, so every existing consumer of
 *                        that field keeps working unchanged
 *   pdfFileNameField   — sibling filename field (e.g. 'grnPdfFileName')
 *   uploadFolder       — storage folder used for the generated PDFs (e.g. 'grns')
 *   buildPdfBuffer(doc, {signature}) — async, returns a PDF Buffer. `signature`
 *                        is null for the unsigned snapshot, or
 *                        {imageBuffer, signedByName, designation, signedAt}
 *                        once signed. Adapters resolve their own company/
 *                        template context — the engine never touches it.
 */

const registry = new Map();

export const registerApprovalDocument = (documentType, adapter) => {
  registry.set(documentType, adapter);
};

export const getApprovalDocument = (documentType) => {
  const adapter = registry.get(documentType);
  if (!adapter) throw new Error(`No approval adapter registered for document type "${documentType}"`);
  return adapter;
};

export const isApprovalDocumentRegistered = (documentType) => registry.has(documentType);
