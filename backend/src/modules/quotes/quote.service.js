import dayjs from 'dayjs';
import Quote from './quote.model.js';
import CompanySettings from '../pricing/company-settings.model.js';
import { previewCalculator } from '../pricing/calculator.service.js';
import { AppError } from '../../utils/apiResponse.js';

const nextQuoteNumber = async (prefix = 'Q') => {
  const year = dayjs().format('YY');
  const month = dayjs().format('MM');
  const stem = `${prefix}-${year}${month}`;
  const last = await Quote
    .findOne({ quoteNumber: new RegExp(`^${stem}-`) })
    .sort({ createdAt: -1 }).lean();
  let seq = 1;
  if (last?.quoteNumber) {
    const match = last.quoteNumber.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${stem}-${String(seq).padStart(3, '0')}`;
};

export const createQuote = async (body, actor) => {
  const settings = await CompanySettings.getSingleton();

  // Re-run the preview server-side so the numbers are authoritative.
  const preview = await previewCalculator({
    asOfDate: body.asOfDate,
    priceType: body.priceType,
    lines: body.lines,
  });

  const quoteNumber = await nextQuoteNumber(settings.quoteSeriesPrefix || 'Q');
  const validUntil = body.validUntil
    || dayjs(body.asOfDate || new Date()).add(settings.quoteValidityDays || 15, 'day').toDate();

  const quote = await Quote.create({
    quoteNumber,
    asOfDate: body.asOfDate || new Date(),
    validUntil,
    priceType: body.priceType || 'SELLING',
    partyId: body.partyId || null,
    partyName: body.partyName || '',
    poReference: body.poReference || '',
    lines: preview.lines,
    totals: preview.totals,
    gstBreakdown: preview.gstBreakdown,
    notes: body.notes || '',
    status: body.send ? 'SENT' : 'DRAFT',
    sentAt: body.send ? new Date() : null,
    createdBy: actor._id,
    createdByName: actor.name,
  });

  return quote.toObject();
};

export const updateQuote = async (id, body, actor) => {
  const quote = await Quote.findById(id);
  if (!quote) throw new AppError('Quote not found', 404);
  if (!['DRAFT'].includes(quote.status)) {
    throw new AppError(`Quote is ${quote.status} — only DRAFT quotes can be edited.`, 400);
  }
  if (body.lines || body.asOfDate || body.priceType) {
    const preview = await previewCalculator({
      asOfDate: body.asOfDate || quote.asOfDate,
      priceType: body.priceType || quote.priceType,
      lines: body.lines || quote.lines,
    });
    quote.lines = preview.lines;
    quote.totals = preview.totals;
    quote.gstBreakdown = preview.gstBreakdown;
    if (body.asOfDate) quote.asOfDate = body.asOfDate;
    if (body.priceType) quote.priceType = body.priceType;
  }
  if (body.partyId !== undefined) quote.partyId = body.partyId;
  if (body.partyName !== undefined) quote.partyName = body.partyName;
  if (body.poReference !== undefined) quote.poReference = body.poReference;
  if (body.notes !== undefined) quote.notes = body.notes;
  if (body.validUntil !== undefined) quote.validUntil = body.validUntil;
  quote.updatedBy = actor._id;
  await quote.save();
  return quote.toObject();
};

export const listQuotes = async ({ status, partyId, from, to } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (partyId) filter.partyId = partyId;
  if (from || to) filter.asOfDate = {};
  if (from) filter.asOfDate.$gte = new Date(from);
  if (to)   filter.asOfDate.$lte = new Date(to);

  const rows = await Quote.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  // Auto-expire (lightweight client-side flag; we don't mutate DB here for performance)
  const today = new Date();
  return rows.map((q) => ({
    ...q,
    isExpired: q.status !== 'CONVERTED_TO_SO' && q.status !== 'ACCEPTED' && new Date(q.validUntil) < today,
  }));
};

export const getQuote = async (id) => {
  const q = await Quote.findById(id).lean();
  if (!q) throw new AppError('Quote not found', 404);
  return q;
};

export const sendQuote = async (id, actor) => {
  const q = await Quote.findById(id);
  if (!q) throw new AppError('Quote not found', 404);
  if (q.status !== 'DRAFT') {
    throw new AppError(`Quote is ${q.status} — only DRAFT quotes can be sent.`, 400);
  }
  q.status = 'SENT';
  q.sentAt = new Date();
  q.updatedBy = actor._id;
  await q.save();
  return q.toObject();
};

export const acceptQuote = async (id, actor) => {
  const q = await Quote.findById(id);
  if (!q) throw new AppError('Quote not found', 404);
  if (!['SENT', 'DRAFT'].includes(q.status)) {
    throw new AppError(`Cannot accept a ${q.status} quote.`, 400);
  }
  q.status = 'ACCEPTED';
  q.acceptedAt = new Date();
  q.updatedBy = actor._id;
  await q.save();
  return q.toObject();
};

export const rejectQuote = async (id, reason, actor) => {
  const q = await Quote.findById(id);
  if (!q) throw new AppError('Quote not found', 404);
  q.status = 'REJECTED';
  q.notes = (q.notes ? q.notes + '\n' : '') + `Rejected: ${reason || ''}`;
  q.updatedBy = actor._id;
  await q.save();
  return q.toObject();
};

export const deleteQuote = async (id) => {
  const q = await Quote.findById(id);
  if (!q) throw new AppError('Quote not found', 404);
  if (q.status === 'CONVERTED_TO_SO') {
    throw new AppError('Cannot delete a quote that was converted to a Sales Order.', 400);
  }
  await q.deleteOne();
  return { ok: true };
};

export const markConverted = async (id, soId, actor) => {
  const q = await Quote.findById(id);
  if (!q) throw new AppError('Quote not found', 404);
  q.status = 'CONVERTED_TO_SO';
  q.convertedToSo = soId;
  q.convertedAt = new Date();
  q.updatedBy = actor?._id;
  await q.save();
  return q.toObject();
};
