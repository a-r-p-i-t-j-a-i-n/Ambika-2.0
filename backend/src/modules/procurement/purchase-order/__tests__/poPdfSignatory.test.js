/**
 * PO PDF authorised signatory block + Company Settings image validation —
 * pure rendering, no database. The images here are plain grey blocks built in
 * the test; they stand in for "an uploaded PNG/JPEG" and are not a signature.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import PDFDocument from 'pdfkit';

import { buildOtherPoPdfBuffer, buildJslPoPdfBuffer } from '../purchaseOrder.service.js';
import {
  inspectPdfAssetImage, isRenderablePdfImage, sniffImageType, PDF_ASSET_MAX_BYTES,
} from '../../../pricing/company-pdf-assets.js';

// Minimal PNG encoder (solid grey) — enough for PDFKit to embed.
const pngOf = (w, h, colorType, idat) => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
};
const grayPng = (w, h, channels = 3) => {
  const raw = Buffer.alloc((w * channels + 1) * h, 0x99);
  for (let y = 0; y < h; y++) raw[y * (w * channels + 1)] = 0; // filter byte: none
  return pngOf(w, h, channels === 4 ? 6 : 2, zlib.deflateSync(raw));
};

const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
const imageCount = (buf) => (buf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

// Collect every string drawn by a builder (content streams are compressed).
const drawnText = async (fn) => {
  const seen = [];
  const orig = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function (str, ...rest) {
    if (!this._inSpy) seen.push(String(str));
    this._inSpy = true;
    try { return orig.call(this, str, ...rest); } finally { this._inSpy = false; }
  };
  try { await fn(); } finally { PDFDocument.prototype.text = orig; }
  return seen;
};

const items = (n, fmt) => Array.from({ length: n }, (_, i) => (fmt === 'JSL'
  ? { grade: 'J4', width: '1250', finish: '2B', quantity: 100 + i, unit: 'Kgs', baseRate: 180, upfrontDiscount: 2, bonanzaDiscount: 1, finalPrice: 177, value: 17700 }
  : { itemName: `Item ${i + 1}`, quantity: 10, unit: 'Kgs', rate: 100, taxableAmount: 1000, gstRate: 18, taxAmount: 180, totalAmount: 1180 }));
const po = (fmt, n) => ({ poNumber: 'AGL/PO-T/26-27', poFormatType: fmt, poDate: new Date('2026-10-20'), vendorName: 'Vendor', items: items(n, fmt) });

const SIG = grayPng(300, 100);
const STAMP = grayPng(200, 200);
const BUILDERS = { OTHER: buildOtherPoPdfBuffer, JSL: buildJslPoPdfBuffer };

for (const [fmt, build] of Object.entries(BUILDERS)) {
  test(`${fmt}: both configured images are embedded`, async () => {
    const buf = await build(po(fmt, 2), { name: 'Co', signatureImage: SIG, stampImage: STAMP });
    assert.equal(imageCount(buf), 2);
  });

  test(`${fmt}: a missing image is simply left out, the other still prints`, async () => {
    assert.equal(imageCount(await build(po(fmt, 2), { name: 'Co', signatureImage: SIG })), 1);
    assert.equal(imageCount(await build(po(fmt, 2), { name: 'Co', stampImage: STAMP })), 1);
    assert.equal(imageCount(await build(po(fmt, 2), { name: 'Co' })), 0);
  });

  test(`${fmt}: an unreadable stored image does not break PDF generation`, async () => {
    const buf = await build(po(fmt, 2), { name: 'Co', signatureImage: Buffer.from('not an image'), stampImage: STAMP });
    assert.equal(imageCount(buf), 1);
  });

  test(`${fmt}: a short PO is one page, with or without images`, async () => {
    assert.equal(pageCount(await build(po(fmt, 2), { name: 'Co', signatureImage: SIG, stampImage: STAMP })), 1);
    assert.equal(pageCount(await build(po(fmt, 2), { name: 'Co' })), 1);
  });

  test(`${fmt}: images never change the page count of a long PO`, async () => {
    for (const n of [9, 10, 16, 17, 30, 45]) {
      const withImgs = pageCount(await build(po(fmt, n), { name: 'Co', signatureImage: SIG, stampImage: STAMP }));
      const without = pageCount(await build(po(fmt, n), { name: 'Co' }));
      assert.equal(withImgs, without, `n=${n}`);
    }
  });

  test(`${fmt}: the signatory block still reads "For <company>" / "Authorized Signatory"`, async () => {
    const text = await drawnText(() => build(po(fmt, 2), { name: 'Acme Ltd', signatureImage: SIG, stampImage: STAMP }));
    assert.ok(text.includes('For Acme Ltd'));
    assert.ok(text.includes('Authorized Signatory'));
  });
}

test('JSL no longer says "no signature required"', async () => {
  const text = await drawnText(() => buildJslPoPdfBuffer(po('JSL', 2), { name: 'Co', signatureImage: SIG, stampImage: STAMP }));
  assert.ok(!text.some((t) => /no signature required/i.test(t)));
  assert.ok(text.includes('This is a computer generated Purchase Order.'));
  assert.ok(text.includes('SUBJECT TO MUMBAI JURISDICTION'));
});

// ── Upload validation (Company Settings) ──
test('sniffImageType reads PNG / JPEG by content only', () => {
  assert.equal(sniffImageType(SIG), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

test('a valid PNG is accepted with its dimensions and hash', async () => {
  const meta = await inspectPdfAssetImage(SIG);
  assert.equal(meta.mimeType, 'image/png');
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 100);
  assert.equal(meta.sizeBytes, SIG.length);
  assert.match(meta.sha256, /^[0-9a-f]{64}$/);
});

test('empty, non-image, oversize, tiny and corrupt files are refused', async () => {
  await assert.rejects(inspectPdfAssetImage(Buffer.alloc(0)), { statusCode: 400 });
  await assert.rejects(inspectPdfAssetImage(Buffer.from('this is text renamed to .png')), { statusCode: 415 });
  await assert.rejects(inspectPdfAssetImage(Buffer.alloc(PDF_ASSET_MAX_BYTES + 1, 0x89)), { statusCode: 413 });
  await assert.rejects(inspectPdfAssetImage(grayPng(10, 10)), { statusCode: 422 });
  const truncated = SIG.subarray(0, 40); // valid PNG signature, broken body
  await assert.rejects(inspectPdfAssetImage(truncated), { statusCode: 422 });
});

// PDFKit decodes alpha PNGs in an async zlib callback that throws — an
// uncaught exception that would kill the server. Such files must be refused
// before PDFKit sees them (this test would crash the runner otherwise).
test('a corrupt RGBA PNG is refused, never handed to PDFKit', async () => {
  assert.equal((await inspectPdfAssetImage(grayPng(64, 64, 4))).mimeType, 'image/png');
  const corrupt = pngOf(64, 64, 6, Buffer.from('not deflate data at all'));
  await assert.rejects(inspectPdfAssetImage(corrupt), { statusCode: 422 });
  assert.equal(isRenderablePdfImage(corrupt), false);
  const short = pngOf(64, 64, 6, zlib.deflateSync(Buffer.alloc(100)));
  await assert.rejects(inspectPdfAssetImage(short), { statusCode: 422 });
});

test('a PNG header claiming huge dimensions is refused before inflating', async () => {
  const bomb = pngOf(60000, 60000, 6, zlib.deflateSync(Buffer.alloc(1000)));
  await assert.rejects(inspectPdfAssetImage(bomb), { statusCode: 422, message: /too large/ });
});
