import Joi from 'joi';
import { APPROVAL_DOCUMENT_TYPE, APPROVAL_SIGNATURE_TYPE } from './approval.model.js';
import { APPROVAL_VIEW_STATUS } from './approval.policy.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const approvalParamSchema = Joi.object({
  documentType: Joi.string().valid(...Object.values(APPROVAL_DOCUMENT_TYPE)).required(),
  documentId:   objectId.required(),
});

export const approvalListQuerySchema = Joi.object({
  status:       Joi.string().valid(...Object.values(APPROVAL_VIEW_STATUS)).allow(''),
  documentType: Joi.string().valid(...Object.values(APPROVAL_DOCUMENT_TYPE)).allow(''),
  vendor:       Joi.string().trim().max(200).allow(''),
  from:         Joi.date().iso().allow('', null),
  to:           Joi.date().iso().allow('', null),
  search:       Joi.string().trim().max(200).allow(''),
  page:         Joi.number().integer().min(1).default(1),
  limit:        Joi.number().integer().min(1).max(200).default(25),
});

export const signDocumentSchema = Joi.object({
  signatureImageBase64: Joi.string().required(),
  // Both are normalized client-side to the same PNG data URL shape — this is
  // stored purely for audit, never used to branch the PDF-embedding logic.
  signatureType: Joi.string().valid(...Object.values(APPROVAL_SIGNATURE_TYPE)).default(APPROVAL_SIGNATURE_TYPE.DRAWN),
  remarks: Joi.string().trim().max(500).allow('', null),
});

export const replaceSignatureSchema = Joi.object({
  signatureImageBase64: Joi.string().required(),
  signatureType: Joi.string().valid(...Object.values(APPROVAL_SIGNATURE_TYPE)).default(APPROVAL_SIGNATURE_TYPE.DRAWN),
  reason: Joi.string().trim().min(1).max(500).required(),
});

export const removeSignatureSchema = Joi.object({
  reason: Joi.string().trim().min(1).max(500).required(),
});
