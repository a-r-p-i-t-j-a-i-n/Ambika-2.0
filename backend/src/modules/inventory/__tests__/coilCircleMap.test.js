/**
 * COIL → CIRCLE MAPPING — the rule that decides which circles a coil may produce.
 *
 * What is under test is the RULE, not a round-trip through mongod: the mapping
 * and its check were written as pure functions in `src/data/coil-circle-map.js`
 * precisely so the client's sheet can be asserted line by line without a
 * database this repo has no harness for. `describeCircleMapRefusal` is asserted
 * too, because that message IS the whole feedback an API caller gets.
 *
 * WHAT IS NOT COVERED HERE, stated plainly:
 *   • that `convert()` throws before `decreaseStock` — the ordering is visible
 *     in the source (the check sits above the submission claim) but proving it
 *     needs a transaction, so it is verified against the running API instead.
 *   • that the dropdown only offers these codes — a browser concern.
 *
 * The expected lists below are transcribed from the client's sheet by hand, NOT
 * derived from COIL_CIRCLE_MAP. A test that read the map to check the map would
 * pass no matter what the map said.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COIL_CIRCLE_MAP, MAP_VERDICT,
  normalizeSkuCode, allowedCircleCodesForCoil, isCircleAllowedForCoil,
  checkCirclesAgainstCoil, allMappedCircleCodes, mappedCoilCodes,
} from '../../../data/coil-circle-map.js';
import { describeCircleMapRefusal } from '../rmIms.service.js';

// ── The client's sheet, transcribed independently of the implementation ──
const SHEET = {
  'JSL202-06': ['JSL202-06-700', 'JSL202-06-725', 'JSL202-06-775', 'JSL202-06-850', 'JSL202-06-875'],
  'JSL202-07': ['JSL202-07-600', 'JSL202-07-925'],
  'JSL202-08': ['JSL202-08-1050', 'JSL202-08-850', 'JSL202-08-858', 'JSL202-08-900', 'JSL202-08-978'],
  'JSL204-07': ['JSL204-07-700', 'JSL204-07-750', 'JSL204-07-840'],
  'JSL204-08': ['JSL204-08-700', 'JSL204-08-825', 'JSL204-08-850', 'JSL204-08-889', 'JSL204-08-900', 'JSL204-08-978'],
  'JSL204-10': ['JSL204-10-850', 'JSL204-10-925'],
};

test('the map holds exactly the coils and circles the client supplied', () => {
  assert.deepEqual(mappedCoilCodes().sort(), Object.keys(SHEET).sort());
  assert.equal(allMappedCircleCodes().length, 23, '23 approved circles across 6 coils');
  for (const [coil, circles] of Object.entries(SHEET)) {
    assert.deepEqual(allowedCircleCodesForCoil(coil), circles, `${coil} list matches the sheet`);
  }
});

test('every coil accepts every circle on its own row', () => {
  let asserted = 0;
  for (const [coil, circles] of Object.entries(SHEET)) {
    for (const circle of circles) {
      assert.equal(isCircleAllowedForCoil(coil, circle), true, `${coil} should allow ${circle}`);
      asserted += 1;
    }
    // and all of them together, which is what a multi-row conversion sends
    assert.equal(checkCirclesAgainstCoil(coil, circles).ok, true, `${coil} should allow all its rows at once`);
  }
  assert.equal(asserted, 23);
});

test('a circle from another coil is refused, for every coil', () => {
  // Each coil is offered one circle from every OTHER coil's row. This is the
  // mistake the mapping exists to stop — a Cu coil recorded as cutting DD.
  for (const coil of Object.keys(SHEET)) {
    for (const [otherCoil, circles] of Object.entries(SHEET)) {
      if (otherCoil === coil) continue;
      for (const circle of circles) {
        assert.equal(
          isCircleAllowedForCoil(coil, circle), false,
          `${coil} must NOT allow ${circle} (it belongs to ${otherCoil})`,
        );
      }
    }
  }
});

test('the worked example from the requirement', () => {
  assert.equal(checkCirclesAgainstCoil('JSL204-07', ['JSL204-07-750']).ok, true);

  const bad = checkCirclesAgainstCoil('JSL204-07', ['JSL204-08-850']);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, MAP_VERDICT.CIRCLE_NOT_ALLOWED);
  assert.deepEqual(bad.offending, ['JSL204-08-850']);
  assert.match(
    describeCircleMapRefusal(bad),
    /^JSL204-08-850 cannot be produced from coil JSL204-07\./,
  );
});

test('a shared code prefix is NOT a mapping', () => {
  // JSL202-06-825 is a real, active 0.6 mm circle whose code matches the
  // JSL202-06 coil exactly. The client did not list it, so it is refused.
  // Any implementation that string-matched the prefix would fail here.
  assert.equal(isCircleAllowedForCoil('JSL202-06', 'JSL202-06-825'), false);
  assert.equal(isCircleAllowedForCoil('JSL202-07', 'JSL202-07-725'), false);
  // ...while the sibling sizes that ARE listed still pass, so the refusal above
  // is about the sheet and not about the prefix failing to match at all.
  assert.equal(isCircleAllowedForCoil('JSL202-06', 'JSL202-06-850'), true);
  assert.equal(isCircleAllowedForCoil('JSL202-07', 'JSL202-07-600'), true);
});

test('an unmapped coil approves nothing — it does not fall back to every circle', () => {
  // JSL204-06 (Cu 0.60 mm) is a real, active coil the client's sheet omits.
  assert.equal(allowedCircleCodesForCoil('JSL204-06'), null, 'null means "no instruction", not "no circles"');

  const v = checkCirclesAgainstCoil('JSL204-06', ['JSL204-08-700']);
  assert.equal(v.ok, false);
  assert.equal(v.reason, MAP_VERDICT.COIL_UNMAPPED);
  assert.deepEqual(v.allowed, [], 'an unmapped coil must never report circles as allowed');
  assert.match(describeCircleMapRefusal(v), /No approved circle sizes are configured for coil JSL204-06/);

  // Not even a circle that is valid for some other coil gets through.
  assert.equal(isCircleAllowedForCoil('JSL204-06', 'JSL204-08-700'), false);
  // Nor does an empty conversion quietly succeed on an unmapped coil.
  assert.equal(checkCirclesAgainstCoil('JSL204-06', []).ok, false);
});

test('an unknown or empty coil code is refused, not crashed on', () => {
  for (const coil of ['', null, undefined, '   ', 'NOT-A-SKU', 'JSL999-99']) {
    const v = checkCirclesAgainstCoil(coil, ['JSL204-07-700']);
    assert.equal(v.ok, false, `${JSON.stringify(coil)} must not pass`);
    assert.equal(v.reason, MAP_VERDICT.COIL_UNMAPPED);
  }
});

test('codes are compared the way the SKU master stores them', () => {
  assert.equal(normalizeSkuCode('  jsl204-07 '), 'JSL204-07');
  assert.equal(normalizeSkuCode(null), '');
  assert.equal(isCircleAllowedForCoil(' jsl204-07 ', ' jsl204-07-750 '), true);
  assert.equal(checkCirclesAgainstCoil('jsl202-08', ['jsl202-08-1050']).ok, true);
});

test('EVERY row is checked — a later row cannot slip past an earlier good one', () => {
  const rows = ['JSL204-08-700', 'JSL204-08-825', 'JSL204-08-850', 'JSL204-08-889', 'JSL202-08-900'];
  const v = checkCirclesAgainstCoil('JSL204-08', rows);
  assert.equal(v.ok, false, 'four approved rows must not carry a fifth unapproved one');
  assert.deepEqual(v.offending, ['JSL202-08-900']);

  // Two wrong rows are both named, so the operator fixes both in one go.
  const two = checkCirclesAgainstCoil('JSL204-08', ['JSL204-08-700', 'JSL202-08-900', 'JSL204-10-925']);
  assert.deepEqual(two.offending, ['JSL202-08-900', 'JSL204-10-925']);
  assert.match(describeCircleMapRefusal(two), /^JSL202-08-900, JSL204-10-925 cannot be produced from coil JSL204-08\./);

  // The same wrong circle on three rows is one mistake, reported once.
  const dup = checkCirclesAgainstCoil('JSL204-07', ['JSL204-08-850', 'JSL204-08-850', 'JSL204-08-850']);
  assert.deepEqual(dup.offending, ['JSL204-08-850']);
});

test('the refusal message names the approved alternatives', () => {
  const v = checkCirclesAgainstCoil('JSL204-07', ['JSL202-06-700']);
  const msg = describeCircleMapRefusal(v);
  assert.match(msg, /Approved circles for this coil: JSL204-07-700, JSL204-07-750, JSL204-07-840\./);
  // An accepted verdict produces no message at all.
  assert.equal(describeCircleMapRefusal(checkCirclesAgainstCoil('JSL204-07', ['JSL204-07-700'])), '');
});

test('the map cannot be mutated at runtime', () => {
  // Frozen on purpose: the mapping is client business data, and a module that
  // could be edited in place would make a wrong approval impossible to trace.
  assert.throws(() => { COIL_CIRCLE_MAP['JSL204-06'] = []; }, TypeError);
  assert.throws(() => { COIL_CIRCLE_MAP['JSL204-07'].push({ code: 'X' }); }, TypeError);
  assert.equal(allowedCircleCodesForCoil('JSL204-07').length, 3);
});
