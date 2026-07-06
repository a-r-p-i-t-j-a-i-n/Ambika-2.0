/**
 * Generic Digital Approval & Signature routes (Purchase FMS).
 * Base path: /api/v1/approvals
 *
 * Reused across every registered document type (see approval.registry.js) —
 * `:documentType` is validated against the APPROVAL_DOCUMENT_TYPE enum, so a
 * new document type never needs its own route file, only its own adapter
 * registration in that document's own service module.
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { requireApprovalRole } from './approval.middleware.js';
import { approvalController as c } from './approval.controller.js';
import {
  approvalParamSchema,
  signDocumentSchema,
  replaceSignatureSchema,
  removeSignatureSchema,
} from './approval.validation.js';

const router = Router();
router.use(protect);

router.get('/:documentType/:documentId',
  validate(approvalParamSchema, 'params'), c.getByDocument);

// v1: single approval level (MD) for every registered document type, so the
// role is hardcoded here. A future multi-level chain would look up the
// document's current level instead of a static role.
router.post('/:documentType/:documentId/sign',
  validate(approvalParamSchema, 'params'), validate(signDocumentSchema),
  requireApprovalRole('MD'), c.sign);

router.post('/:documentType/:documentId/replace',
  validate(approvalParamSchema, 'params'), validate(replaceSignatureSchema),
  requireApprovalRole('MD'), c.replaceSignature);

router.post('/:documentType/:documentId/remove',
  validate(approvalParamSchema, 'params'), validate(removeSignatureSchema),
  requireApprovalRole('MD'), c.removeSignature);

export default router;
