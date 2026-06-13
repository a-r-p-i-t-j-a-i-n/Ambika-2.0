import React from 'react';
import { Chip } from '@mui/material';

/** Dropdown option sets shared across the Indent screens. */
export const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];

/**
 * Map a stored unit to its canonical UNITS casing (legacy data may hold "PCS",
 * "kg", etc.). Falls back to the first option so the select never goes
 * out-of-range. Returns '' for empty input.
 */
export const normalizeUnit = (u) => {
  if (!u) return '';
  const match = UNITS.find((opt) => opt.toLowerCase() === String(u).trim().toLowerCase());
  return match || UNITS[0];
};
export const DEPARTMENTS = ['Stores', 'Production', 'QC', 'Admin', 'Maintenance', 'Packing'];

export const APPROVAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

const APPROVAL_META = {
  DRAFT:            { label: 'Draft',            color: 'default' },
  PENDING_APPROVAL: { label: 'Pending Approval', color: 'warning' },
  APPROVED:         { label: 'Approved',         color: 'success' },
  REJECTED:         { label: 'Rejected',         color: 'error' },
};

const OVERALL_META = {
  INDENT_GENERATED:   { label: 'Indent Generated',   color: 'default' },
  INDENT_APPROVED:    { label: 'Indent Approved',    color: 'info' },
  QUOTE_PENDING:      { label: 'Quote Pending',      color: 'warning' },
  QUOTE_RECEIVED:     { label: 'Quote Received',     color: 'info' },
  QUOTE_NOT_REQUIRED: { label: 'Quote Not Required', color: 'default' },
  QUOTATION_APPROVED: { label: 'Quotation Approved', color: 'success' },
  QUOTATION_NOT_APPROVED: { label: 'Quotation Not Approved', color: 'error' },
  PO_READY:           { label: 'PO Ready',           color: 'success' },
  CLOSED:             { label: 'Closed',             color: 'default' },
};

const QUOTE_META = {
  PENDING:      { label: 'Pending',      color: 'warning' },
  RECEIVED:     { label: 'Received',     color: 'success' },
  NOT_REQUIRED: { label: 'Not Required', color: 'default' },
  APPROVED:     { label: 'Approved',     color: 'success' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

/**
 * Resolve an uploaded file URL. Files are served from the API host root
 * (e.g. http://host/uploads/...), NOT under /api/v1.
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';
export const fileHref = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const origin = API_BASE.replace(/\/api\/v1\/?$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
};

export const ApprovalChip = ({ status }) => {
  const m = pick(APPROVAL_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const OverallChip = ({ status }) => {
  const m = pick(OVERALL_META, status);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const QuoteChip = ({ status }) => {
  const m = pick(QUOTE_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

// Step 1.3 — Approved Quotation status.
const QUOTATION_APPROVAL_META = {
  YES:                    { label: 'Approved',      color: 'success' },
  QUOTATION_NOT_APPROVED: { label: 'Not Approved',  color: 'error' },
  PENDING:                { label: 'Pending',       color: 'warning' },
};

export const QuotationChip = ({ status }) => {
  const m = pick(QUOTATION_APPROVAL_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};
