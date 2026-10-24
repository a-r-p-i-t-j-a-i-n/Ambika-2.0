import asyncHandler from '../../middleware/asyncHandler.js';
import { rmImsService } from './rmIms.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const rmImsController = {
  getOverview: asyncHandler(async (req, res) => {
    const { docs, summary, inTransit } = await rmImsService.getOverview(req.query);
    // `inTransit` rides in the meta so the screen can report the open-PO lines
    // this module could not attribute to an item. They are never dropped.
    res.json(ApiResponse.ok('RM IMS overview', docs, { ...summary, inTransit }));
  }),

  getDashboard: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('RM IMS dashboard', await rmImsService.getDashboard()));
  }),

  getItemDetail: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Raw material item', await rmImsService.getItemDetail(req.params.skuId)));
  }),

  getStockHistory: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock history', await rmImsService.getStockHistory(req.params.skuId, req.query)));
  }),

  getForecast: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock forecast', await rmImsService.getForecast(req.params.skuId, req.query.days)));
  }),

  getReorderList: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Reorder list', await rmImsService.getReorderList(req.query)));
  }),

  getPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy', await rmImsService.getPolicy(req.params.skuId)));
  }),

  upsertPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy saved', await rmImsService.upsertPolicy(req.params.skuId, req.body, req.user)));
  }),

  receive: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock added', await rmImsService.receive(req.body, req.user)));
  }),

  issue: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock issued', await rmImsService.issue(req.body, req.user)));
  }),

  convert: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Coil converted to circles', await rmImsService.convert(req.body, req.user)));
  }),

  getConversions: asyncHandler(async (req, res) => {
    const { docs, totals } = await rmImsService.listConversions(req.query);
    res.json(ApiResponse.ok('Coil conversions', docs, totals));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await rmImsService.getMovements(req.query);
    res.json(ApiResponse.ok('RM IMS movements', docs, pagination));
  }),

  getReceivedCoils: asyncHandler(async (req, res) => {
    const { docs, summary } = await rmImsService.listReceivedCoils(req.query);
    res.json(ApiResponse.ok('Received coils', docs, summary));
  }),

  // One physical coil, end to end. `rounds` is the list the screen draws; the
  // coil's own identity and its totals travel as meta, which is the shape every
  // other list endpoint in this module already uses.
  getCoilLineage: asyncHandler(async (req, res) => {
    const { rounds, ...meta } = await rmImsService.getCoilLineage(req.params.receiptId);
    res.json(ApiResponse.ok('Coil cutting history', rounds, meta));
  }),

  // One row per physical coil that has been cut at least once in the app;
  // totals, the untraceable count and pagination travel as meta.
  getCuttingHistory: asyncHandler(async (req, res) => {
    const { docs, summary } = await rmImsService.listCuttingHistory(req.query);
    res.json(ApiResponse.ok('Cutting history', docs, summary));
  }),

  getConversionLedger: asyncHandler(async (req, res) => {
    const { docs, summary } = await rmImsService.listConversionLedger(req.query);
    res.json(ApiResponse.ok('Conversion ledger', docs, summary));
  }),

  getCuttingHistoryCircles: asyncHandler(async (req, res) => {
    const docs = await rmImsService.listCuttingHistoryCircles(req.query);
    res.json(ApiResponse.ok(req.query.scope === 'all'
      ? 'Circle SKUs produced by every recorded cut'
      : 'Circle SKUs produced by traceable cutting rounds', docs));
  }),

  getCuttingHistoryCoils: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Coil SKUs of every recorded cut', await rmImsService.listCuttingHistoryCoils()));
  }),

  // The circle sizes approved for one coil. `circles` is the list the dropdown
  // offers; the rest travels as meta because it is what the screen needs to
  // explain an EMPTY list rather than leave the operator staring at one.
  getCircleOptions: asyncHandler(async (req, res) => {
    const { circles, ...meta } = await rmImsService.listCircleOptions(req.query);
    res.json(ApiResponse.ok('Approved circle sizes for this coil', circles, meta));
  }),

  // Manual Entry — No GRN. `manualCoil` is the coil this batch already names
  // (null for a new one); a goods receipt carrying the batch travels as meta,
  // because the screen must refuse manual entry for it and say why.
  lookupManualCoil: asyncHandler(async (req, res) => {
    const { manualCoil, ...meta } = await rmImsService.lookupManualCoil(req.query);
    res.json(ApiResponse.ok('Manual coil lookup', manualCoil, meta));
  }),
};
