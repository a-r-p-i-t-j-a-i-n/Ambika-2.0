import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import * as svc from './quote.service.js';

export const quoteController = {
  list: asyncHandler(async (req, res) => {
    const data = await svc.listQuotes(req.query);
    res.json(ApiResponse.ok('Quotes', data));
  }),
  get: asyncHandler(async (req, res) => {
    const data = await svc.getQuote(req.params.id);
    res.json(ApiResponse.ok('Quote', data));
  }),
  create: asyncHandler(async (req, res) => {
    const data = await svc.createQuote(req.body, req.user);
    res.status(201).json(ApiResponse.created('Quote saved', data));
  }),
  update: asyncHandler(async (req, res) => {
    const data = await svc.updateQuote(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Quote updated', data));
  }),
  send: asyncHandler(async (req, res) => {
    const data = await svc.sendQuote(req.params.id, req.user);
    res.json(ApiResponse.ok('Quote sent', data));
  }),
  accept: asyncHandler(async (req, res) => {
    const data = await svc.acceptQuote(req.params.id, req.user);
    res.json(ApiResponse.ok('Quote accepted', data));
  }),
  reject: asyncHandler(async (req, res) => {
    const data = await svc.rejectQuote(req.params.id, req.body.reason, req.user);
    res.json(ApiResponse.ok('Quote rejected', data));
  }),
  delete: asyncHandler(async (req, res) => {
    const data = await svc.deleteQuote(req.params.id);
    res.json(ApiResponse.ok('Quote deleted', data));
  }),
};
