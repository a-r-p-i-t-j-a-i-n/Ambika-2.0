import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import * as svc from './pricing.service.js';
import { previewCalculator } from './calculator.service.js';
import { companyPdfAssetsService } from './company-pdf-assets.js';

export const pricingController = {
  // ── Revisions ─────────────────────────────────────────────────
  submit: asyncHandler(async (req, res) => {
    const rev = await svc.submitRevision(req.body, req);
    res.status(201).json(ApiResponse.created(
      rev.status === 'LIVE' ? 'Price updated' : 'Submitted for MD approval',
      rev,
    ));
  }),
  approve: asyncHandler(async (req, res) => {
    const rev = await svc.approveRevision(req.params.id, req);
    res.json(ApiResponse.ok('Revision approved', rev));
  }),
  reject: asyncHandler(async (req, res) => {
    const rev = await svc.rejectRevision(req.params.id, req.body.reason, req);
    res.json(ApiResponse.ok('Revision rejected', rev));
  }),
  correct: asyncHandler(async (req, res) => {
    const rev = await svc.correctRevision(req.params.id, req.body, req);
    res.status(201).json(ApiResponse.created('Correction submitted', rev));
  }),

  // ── Master & history ──────────────────────────────────────────
  master: asyncHandler(async (req, res) => {
    const data = await svc.getPriceMaster(req.query);
    // Never let the browser serve a stale cached copy (party filters change the
    // result for the same-ish URL) — always revalidate, no 304-from-old-body.
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.json(ApiResponse.ok('Price master', data));
  }),
  history: asyncHandler(async (req, res) => {
    const data = await svc.getSkuHistory(req.params.id, req.query.priceType);
    res.json(ApiResponse.ok('History', data));
  }),

  // ── Phase-1 ─────────────────────────────────────────────────────
  updateRemarks: asyncHandler(async (req, res) => {
    const data = await svc.updateSkuRemarks(req.params.id, req.body.remarks);
    res.json(ApiResponse.ok('Remarks updated', data));
  }),
  reviewers: asyncHandler(async (_req, res) => {
    const data = await svc.getReviewers();
    res.json(ApiResponse.ok('Reviewers', data));
  }),
  exportData: asyncHandler(async (req, res) => {
    const data = await svc.getExportData(req.query);
    res.json(ApiResponse.ok('Export bundle', data));
  }),
  documents: asyncHandler(async (req, res) => {
    const data = await svc.listPricingDocuments(req.query);
    res.json(ApiResponse.ok('Documents', data));
  }),
  analytics: asyncHandler(async (req, res) => {
    const data = await svc.getPricingAnalytics(req.query);
    res.json(ApiResponse.ok('Analytics', data));
  }),
  priceAsOf: asyncHandler(async (req, res) => {
    const data = await svc.getPriceAsOf({
      skuId: req.params.id,
      date: req.query.date,
      priceType: req.query.priceType,
    });
    res.json(ApiResponse.ok('Price as of', data));
  }),

  // ── Approval Inbox ────────────────────────────────────────────
  pending: asyncHandler(async (_req, res) => {
    const data = await svc.getPendingApprovals();
    res.json(ApiResponse.ok('Pending revisions', data));
  }),

  // ── Calculator ────────────────────────────────────────────────
  preview: asyncHandler(async (req, res) => {
    const data = await previewCalculator(req.body);
    res.json(ApiResponse.ok('Preview', data));
  }),

  // ── Settings ──────────────────────────────────────────────────
  getSettings: asyncHandler(async (_req, res) => {
    const s = await svc.getSettings();
    res.json(ApiResponse.ok('Settings', s));
  }),
  updateSettings: asyncHandler(async (req, res) => {
    const s = await svc.updateSettings(req.body, req.user, req);
    res.json(ApiResponse.ok('Settings updated', s));
  }),

  // ── PO signatory images (authorised signature + company stamp) ──
  uploadPdfAsset: asyncHandler(async (req, res) => {
    const out = await companyPdfAssetsService.save(req.params.kind, req.file, req);
    res.json(ApiResponse.ok(req.params.kind === 'stamp' ? 'Company stamp saved' : 'Authorised signature saved', out));
  }),
  removePdfAsset: asyncHandler(async (req, res) => {
    const out = await companyPdfAssetsService.remove(req.params.kind, req);
    res.json(ApiResponse.ok(req.params.kind === 'stamp' ? 'Company stamp removed' : 'Authorised signature removed', out));
  }),
  getPdfAssetImage: asyncHandler(async (req, res) => {
    const { data, mimeType } = await companyPdfAssetsService.getImage(req.params.kind);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }),
};
