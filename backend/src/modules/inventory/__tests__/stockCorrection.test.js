/**
 * Stock correction — the Joi boundary in front of stockCorrectionService, which
 * IMS module an item belongs to (what a correction may touch), and the scrap
 * record a scrap correction writes. The posting itself needs a database and is
 * exercised by the e2e fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stockCorrectionSchema, stockCorrectionSkuQuerySchema } from '../stockCorrection.validation.js';
import { moduleOf, CORRECTION_MODULES } from '../stockCorrection.service.js';
import ScrapRecord from '../scrapRecord.model.js';

const line = { skuId: '507f1f77bcf86cd799439011', warehouse: 'plg01', systemQty: 100, physicalQty: 98 };
const v = (body) => stockCorrectionSchema.validate(body);

test('a correction needs at least one line; the reason is optional', () => {
  assert.equal(v({ lines: [line] }).error, undefined);
  assert.equal(v({ lines: [line], reason: '' }).error, undefined);
  assert.equal(v({ lines: [line], reason: 'Counted on the floor' }).error, undefined);
  assert.ok(v({ lines: [] }).error);
  assert.ok(v({}).error);
});

test('each line names the item, the location, the system figure and the count', () => {
  assert.equal(v({ lines: [line] }).value.lines[0].warehouse, 'PLG01');
  assert.ok(v({ lines: [{ ...line, skuId: 'JSL202-07' }] }).error);
  assert.ok(v({ lines: [{ ...line, warehouse: undefined }] }).error);
  assert.ok(v({ lines: [{ ...line, systemQty: undefined }] }).error);
  assert.ok(v({ lines: [{ ...line, physicalQty: undefined }] }).error);
});

test('a physical count can be zero but never below it; the system figure may be negative', () => {
  assert.equal(v({ lines: [{ ...line, physicalQty: 0 }] }).error, undefined);
  assert.match(v({ lines: [{ ...line, physicalQty: -1 }] }).error.message, /below zero/);
  // A records problem the correction is there to fix.
  assert.equal(v({ lines: [{ ...line, systemQty: -151, physicalQty: 0 }] }).error, undefined);
});

test('the item search takes a module RM / CP / FG / SCRAP, any case', () => {
  assert.equal(stockCorrectionSkuQuerySchema.validate({ module: 'rm', search: 'JSL' }).value.module, 'RM');
  assert.equal(stockCorrectionSkuQuerySchema.validate({ module: 'scrap' }).value.module, 'SCRAP');
  assert.ok(stockCorrectionSkuQuerySchema.validate({ module: 'WIP' }).error);
});

test('only circles, Consumables & Packaging and Finished Goods stock can be corrected', () => {
  // Coils are kept by weight, coil by coil; their scrap is corrected under Scrap.
  assert.equal(moduleOf('RAW_MATERIAL'), null);
  assert.equal(moduleOf('CIRCLE').key, 'RM');
  assert.equal(moduleOf('CONSUMABLE').key, 'CP');
  assert.equal(moduleOf('PACKING').key, 'CP');
  assert.equal(moduleOf('FINISHED_GOOD').key, 'FG');
  // Scrap is corrected per coil SKU on Scrap master data, not as an item's stock.
  assert.equal(moduleOf('SCRAP'), null);
  assert.equal(moduleOf('WIP_MATERIAL'), null);
  assert.equal(moduleOf('SERVICE'), null);
  assert.equal(CORRECTION_MODULES.find((m) => m.key === 'RM').defaultWarehouse, 'PLG01');
});

test('a line is stock unless it says scrap; a scrap line is a coil SKU at a cutting location', () => {
  assert.equal(v({ lines: [line] }).value.lines[0].kind, 'STOCK');
  const scrap = v({ lines: [{ ...line, kind: 'scrap', warehouse: 'jw001', systemQty: 6042.67, physicalQty: 6000 }] });
  assert.equal(scrap.error, undefined);
  assert.equal(scrap.value.lines[0].kind, 'SCRAP');
  assert.equal(scrap.value.lines[0].warehouse, 'JW001');
  assert.ok(v({ lines: [{ ...line, kind: 'HEAP' }] }).error);
});

test('only a scrap CORRECTION may lower scrap; a cut never records below zero', () => {
  const rec = (extra) => new ScrapRecord({ location: 'PLG01', coilSkuCode: 'JSL202-06', ...extra }).validateSync();
  assert.equal(rec({ entryType: 'CORRECTION', scrapKg: -42.67 }), undefined);
  assert.match(rec({ scrapKg: -1 }).errors.scrapKg.message, /below zero/);
  assert.match(rec({ entryType: 'CUT', scrapKg: -1 }).errors.scrapKg.message, /below zero/);
  assert.equal(rec({ scrapKg: 12.5 }), undefined);
});
