/**
 * "Save PO Directly" is MD-only (poDirectSave.js) — pure rule, no database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isMdForDirectSave, DIRECT_SAVE_MD_ONLY } from '../poDirectSave.js';

test('a user holding the MD role may save a PO directly', () => {
  assert.equal(isMdForDirectSave({ role: 'MD', roles: ['MD'] }), true);
  assert.equal(isMdForDirectSave({ role: 'EA', roles: ['PLANNER', 'MD'] }), true);
});

test('a pre-migration user with only the legacy role MD counts as MD', () => {
  assert.equal(isMdForDirectSave({ role: 'MD' }), true);
  assert.equal(isMdForDirectSave({ role: 'MD', roles: [] }), true);
});

test('a user whose MD role was removed is not MD, despite the stale legacy field', () => {
  assert.equal(isMdForDirectSave({ role: 'MD', roles: ['VIEWER'] }), false);
});

test('non-MD users are refused, whatever permissions they hold', () => {
  assert.equal(isMdForDirectSave({ role: 'EA', roles: ['PLANNER'] }), false);
  assert.equal(isMdForDirectSave({ role: 'EA', roles: ['VIEWER'], permissionGrants: ['procurement.approve', '*'] }), false);
  assert.equal(isMdForDirectSave({ role: 'EA' }), false);
  assert.equal(isMdForDirectSave({ roles: ['md'] }), false);
});

test('no authenticated user is never MD', () => {
  assert.equal(isMdForDirectSave(null), false);
  assert.equal(isMdForDirectSave(undefined), false);
});

test('the refusal tells the user to save a draft for approval', () => {
  assert.match(DIRECT_SAVE_MD_ONLY, /Only the MD/);
  assert.match(DIRECT_SAVE_MD_ONLY, /draft/);
  assert.match(DIRECT_SAVE_MD_ONLY, /approval/);
});
