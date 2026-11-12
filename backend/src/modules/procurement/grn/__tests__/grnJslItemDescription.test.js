import test from 'node:test';
import assert from 'node:assert/strict';
import { grnLineName } from '../grn.service.js';

const jslPo = { poFormatType: 'JSL' };
const otherPo = { poFormatType: 'OTHER' };
const jslLine = { itemName: '304 1250 2B', itemDescription: 'SS coil' };

test('JSL line: the GRN shows the real item description, not the Grade Width Finish label', () => {
  assert.equal(grnLineName(jslPo, jslLine, '304 1250 2B'), 'SS coil');
  assert.equal(grnLineName(jslPo, jslLine, ''), 'SS coil');
  assert.equal(grnLineName(jslPo, { ...jslLine, itemDescription: '  SS coil  ' }), 'SS coil');
});

test('JSL line raised before itemDescription existed keeps the name it had', () => {
  assert.equal(grnLineName(jslPo, { itemName: '304 1250 2B', itemDescription: '' }, '304 1250 2B'), '304 1250 2B');
  assert.equal(grnLineName(jslPo, { itemName: '304 1250 2B' }), '304 1250 2B');
});

test('OTHER PO line is untouched, even if it carries an itemDescription', () => {
  assert.equal(grnLineName(otherPo, { itemName: 'Cu 0.70 mm', itemDescription: 'x' }, 'Cu 0.70 mm'), 'Cu 0.70 mm');
  assert.equal(grnLineName({}, { itemName: 'Cu 0.70 mm' }), 'Cu 0.70 mm');
});
