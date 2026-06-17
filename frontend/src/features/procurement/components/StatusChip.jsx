import React from 'react';
import { Box } from '@mui/material';

/**
 * Shared, enterprise status badge for the entire Purchase FMS.
 *
 * ONE component, ONE color system — no module-specific colors. Every status
 * resolves to a semantic tone (light background + dark text, WCAG-friendly,
 * no neon / no pink). Same height, radius, weight, padding everywhere.
 *
 * Usage:  <StatusChip status="APPROVED" />
 *         <StatusChip status={po.poStatus} label="Released to Vendor" />
 *         <StatusChip status="X" tone="purple" />   // explicit tone override
 */

// Semantic tones — light tint bg + dark readable text.
const TONES = {
  neutral: { bg: '#eef2f6', fg: '#475569' }, // gray
  amber:   { bg: '#fef3c7', fg: '#b45309' }, // amber (pending)
  blue:    { bg: '#dbeafe', fg: '#1d4ed8' }, // blue (approved)
  indigo:  { bg: '#e0e7ff', fg: '#4338ca' }, // indigo (in progress)
  green:   { bg: '#dcfce7', fg: '#15803d' }, // green (success / completed)
  teal:    { bg: '#ccfbf1', fg: '#0f766e' }, // teal (released)
  orange:  { bg: '#ffedd5', fg: '#c2410c' }, // orange (partial)
  cyan:    { bg: '#cffafe', fg: '#0e7490' }, // cyan (ready for GRN)
  red:     { bg: '#fee2e2', fg: '#b91c1c' }, // red (failed / rejected / cancelled)
  purple:  { bg: '#f3e8ff', fg: '#7e22ce' }, // purple (short closed)
};

// Canonical status token → [label, tone]. Covers every Purchase FMS status.
const STATUS = {
  // ── Neutral (draft / inactive) ──
  DRAFT:                 ['Draft', 'neutral'],
  INDENT_GENERATED:      ['Generated', 'neutral'],
  NOT_STARTED:           ['Not Started', 'neutral'],
  NOT_RECEIVED:          ['Not Received', 'neutral'],
  NOT_RELEASED:          ['Not Released', 'neutral'],
  NOT_REQUIRED:          ['Not Required', 'neutral'],
  QUOTE_NOT_REQUIRED:    ['Not Required', 'neutral'],
  PI_NOT_REQUIRED:       ['PI Not Required', 'neutral'],
  CLOSED:                ['Closed', 'neutral'],

  // ── Amber (pending) ──
  PENDING:               ['Pending', 'amber'],
  PENDING_APPROVAL:      ['Pending Approval', 'amber'],
  QUOTE_PENDING:         ['Quote Pending', 'amber'],
  PAYMENT_PENDING:       ['Payment Pending', 'amber'],

  // ── Blue (approved / received) ──
  APPROVED:                  ['Approved', 'blue'],
  INDENT_APPROVED:           ['Approved', 'blue'],
  QUOTATION_APPROVED:        ['Quotation Approved', 'blue'],
  PI_APPROVED:               ['PI Approved', 'blue'],
  PI_RECEIVED:               ['PI Received', 'blue'],
  RECEIVED:                  ['Received', 'blue'],
  QUOTE_RECEIVED:            ['Quote Received', 'blue'],
  POSTED:                    ['Posted', 'blue'],
  READY_FOR_ADVANCE_PAYMENT: ['Ready For Payment', 'blue'],
  RESCHEDULED:               ['Rescheduled', 'blue'],

  // ── Indigo (in progress) ──
  IN_PROGRESS:           ['In Progress', 'indigo'],

  // ── Green (success / completed) ──
  COMPLETED:             ['Completed', 'green'],
  PAYMENT_COMPLETED:     ['Payment Completed', 'green'],
  PASSED:                ['Passed', 'green'],
  PASS:                  ['Pass', 'green'],
  DONE:                  ['Done', 'green'],
  YES:                   ['Approved', 'green'],
  FULLY_RECEIVED:        ['Fully Received', 'green'],
  FULLY_PAID:            ['Fully Paid', 'green'],
  FULL_PAYMENT:          ['Full Payment', 'green'],
  MATCHED:               ['Matched', 'green'],

  // ── Teal (released) ──
  RELEASED:              ['Released', 'teal'],
  RELEASED_TO_VENDOR:    ['Released to Vendor', 'teal'],

  // ── Orange (partial) ──
  PARTIAL:               ['Partial', 'orange'],
  PARTIAL_RECEIVED:      ['Partial Received', 'orange'],
  PARTIALLY_PAID:        ['Partially Paid', 'orange'],
  PART_PAYMENT:          ['Part Payment', 'orange'],
  PARTIAL_PASS:          ['Partial Pass', 'orange'],
  SHORT:                 ['Short', 'orange'],

  // ── Cyan (ready for GRN) ──
  READY_FOR_GRN:         ['Ready For GRN', 'cyan'],
  PO_READY:              ['PO Ready', 'cyan'],

  // ── Red (failed / rejected / cancelled) ──
  FAILED:                  ['Failed', 'red'],
  FAIL:                    ['Fail', 'red'],
  REJECTED:                ['Rejected', 'red'],
  CANCELLED:               ['Cancelled', 'red'],
  QUOTATION_NOT_APPROVED:  ['Not Approved', 'red'],
  EXCESS:                  ['Excess', 'red'],

  // ── Purple (short closed) ──
  SHORT_CLOSED:               ['Short Closed', 'purple'],
  SHORT_PAYMENT_COMPLETED:    ['Short Closed', 'purple'],
};

const prettify = (s) => String(s || '—')
  .replace(/_/g, ' ')
  .replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

const StatusChip = ({ status, label, tone }) => {
  const key = String(status || '').toUpperCase();
  const [mappedLabel, mappedTone] = STATUS[key] || [null, 'neutral'];
  const t = TONES[tone || mappedTone] || TONES.neutral;
  const text = label || mappedLabel || prettify(status);
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 22,
        px: 1,
        borderRadius: '6px',
        bgcolor: t.bg,
        color: t.fg,
        fontSize: '0.68rem',
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      {text}
    </Box>
  );
};

export default StatusChip;
export { TONES };
