/**
 * Service Completion (former Step 1.8A) removed: an approved internal-service
 * indent goes straight to Incoming QC.
 *
 * No database (this repo has no mongod harness). Covered: the eligibility rule
 * (serviceQcBlocker), the request schemas, the Doer-Assignment step catalog and
 * the retired create endpoint. The DB writes of createFromService / complete are
 * not exercised here.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { serviceQcBlocker, SERVICE_QC_ELIGIBLE_INDENT_STATUSES } from '../incomingQc.service.js';
import { createQcSchema, completeQcSchema } from '../incomingQc.validation.js';
import { FMS_CATALOG, getStep } from '../../../fms-doers/fmsCatalog.js';
import { serviceCompletionService } from '../../service-completion/serviceCompletion.service.js';

const ID = '64b7f0c2a1b2c3d4e5f60718';
const serviceIndent = (overallStatus) => ({ requestType: 'INTERNAL_SERVICE', overallStatus });

// ── Eligibility ──────────────────────────────────────────────────────────────
test('approved service indent (SERVICE_PENDING) can start QC without a Service Completion', () => {
  assert.equal(serviceQcBlocker(serviceIndent('SERVICE_PENDING')), null);
});

test('legacy SERVICE_COMPLETED indent (completed under the old step) is still QC-eligible', () => {
  assert.equal(serviceQcBlocker(serviceIndent('SERVICE_COMPLETED')), null);
  assert.deepEqual(SERVICE_QC_ELIGIBLE_INDENT_STATUSES, ['SERVICE_PENDING', 'SERVICE_COMPLETED']);
});

test('material indents cannot use the service QC path', () => {
  assert.match(serviceQcBlocker({ requestType: 'MATERIAL_PURCHASE', overallStatus: 'QUOTATION_APPROVED' }), /internal-service/);
});

test('service indent before quotation approval is blocked', () => {
  for (const s of ['QUOTE_PENDING', 'QUOTE_RECEIVED', 'QUOTATION_NOT_APPROVED']) {
    assert.match(serviceQcBlocker(serviceIndent(s)), /Approve the quotation/, s);
  }
});

test('a service already QC-checked cannot be QC-ed again', () => {
  for (const s of ['SERVICE_QC_PASSED', 'SERVICE_QC_FAILED', 'SERVICE_QC_PARTIAL']) {
    assert.ok(serviceQcBlocker(serviceIndent(s)), s);
  }
});

test('an open (non-cancelled) service QC blocks a duplicate', () => {
  assert.match(serviceQcBlocker(serviceIndent('SERVICE_PENDING'), { qcNumber: 'AGL/QC-007' }), /AGL\/QC-007/);
});

test('missing indent is reported', () => {
  assert.equal(serviceQcBlocker(null), 'Indent not found');
});

// ── Request schemas ──────────────────────────────────────────────────────────
test('create QC accepts exactly one source: GRN, indent, or legacy service completion', () => {
  assert.equal(createQcSchema.validate({ grnId: ID }).error, undefined);
  assert.equal(createQcSchema.validate({ indentId: ID }).error, undefined);
  assert.equal(createQcSchema.validate({ serviceCompletionId: ID }).error, undefined);
  assert.ok(createQcSchema.validate({}).error, 'no source');
  assert.ok(createQcSchema.validate({ grnId: ID, indentId: ID }).error, 'two sources');
});

test('complete QC accepts an optional service report', () => {
  const doc = { fileName: 'report.pdf', fileUrl: 'https://x/report.pdf', fileType: 'application/pdf' };
  assert.equal(completeQcSchema.validate({ overallResult: 'PASS', qcReportDocument: doc }).error, undefined);
  assert.equal(completeQcSchema.validate({ overallResult: 'PASS' }).error, undefined);
});

// ── Doer-Assignment catalog ──────────────────────────────────────────────────
test('Purchase FMS catalog no longer has a Service Completion step', () => {
  assert.equal(getStep('PURCHASE', 'SERVICE_COMPLETION'), null);
  assert.ok(!FMS_CATALOG.PURCHASE.steps.some((s) => s.code === '1.8A'));
});

test('Incoming QC step picks up GRNs (unchanged) and approved service indents', () => {
  const qc = getStep('PURCHASE', 'INCOMING_QC');
  assert.deepEqual(qc.sources.map((s) => s.entityType), ['GRN', 'INDENT']);
});

test('step sequence stays contiguous and GRN is still followed by Incoming QC', () => {
  const steps = FMS_CATALOG.PURCHASE.steps;
  steps.forEach((s, i) => assert.equal(s.sequence, i + 1));
  const at = (k) => steps.findIndex((s) => s.key === k);
  assert.equal(at('INCOMING_QC'), at('GRN') + 1);
  assert.equal(at('VENDOR_INVOICE'), at('INCOMING_QC') + 1);
});

// ── Retired endpoint ─────────────────────────────────────────────────────────
test('creating a new Service Completion is refused with a pointer to Incoming QC', async () => {
  await assert.rejects(() => serviceCompletionService.create({ indentId: ID }, {}), (err) => {
    assert.equal(err.statusCode, 410);
    assert.match(err.message, /Incoming QC/);
    return true;
  });
});
