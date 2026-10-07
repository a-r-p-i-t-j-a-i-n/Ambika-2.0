import asyncHandler from '../../middleware/asyncHandler.js';
import { scrapImsService } from './scrapIms.service.js';
import { scrapBuyerService } from './scrapBuyer.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const scrapImsController = {
  getOverview: asyncHandler(async (req, res) => {
    const { docs, pagination, summary } = await scrapImsService.getOverview(req.query);
    res.json(ApiResponse.ok('Scrap register', docs, { ...pagination, summary }));
  }),

  getDashboard: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Scrap dashboard', await scrapImsService.getDashboard(req.query)));
  }),

  getRecord: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Scrap record', await scrapImsService.getRecord(req.params.id)));
  }),

  // One row per physical received coil. The rows are the page; `summary` carries
  // the totals over every traced coil AND the untraceable bucket, which is never
  // dropped — see the service for why.
  getByCoil: asyncHandler(async (req, res) => {
    const { docs, summary } = await scrapImsService.getScrapByCoil(req.query);
    res.json(ApiResponse.ok('Scrap by physical coil', docs, summary));
  }),

  getStock: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Scrap stock', await scrapImsService.getScrapStock()));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination, summary } = await scrapImsService.getScrapMovements(req.query);
    res.json(ApiResponse.ok('Scrap movements', docs, { ...pagination, summary }));
  }),

  getScrapOutHistory: asyncHandler(async (req, res) => {
    const { docs, pagination, summary } = await scrapImsService.getScrapOutHistory(req.query);
    res.json(ApiResponse.ok('Scrap Out history', docs, { ...pagination, summary }));
  }),

  // A replay of a submission already recorded writes nothing and is answered
  // with 200 + what the first request did, so a double-click reads as success
  // rather than silently moving the stock a second time. This is the
  // Consumables/FG shape; RM's controller answers 201 even to a replay, which
  // tells the operator a second entry was created when none was.
  scrapIn: asyncHandler(async (req, res) => {
    const out = await scrapImsService.scrapIn(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Scrap added to stock', out));
  }),

  scrapOut: asyncHandler(async (req, res) => {
    const out = await scrapImsService.scrapOut(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Scrap issued out', out));
  }),

  listBuyers: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Scrap buyers', await scrapBuyerService.list(req.query)));
  }),

  getBuyer: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Scrap buyer', await scrapBuyerService.getById(req.params.id)));
  }),

  // 201 when a buyer was added; 200 with created:false when the same buyer was
  // already in the master — the screen selects it either way, and says which.
  createBuyer: asyncHandler(async (req, res) => {
    const out = await scrapBuyerService.create(req.body, req.user);
    if (!out.created) {
      const why = out.matchedOn === 'gstNo' ? 'GSTIN' : 'name';
      return res.json(ApiResponse.ok(`${out.buyer.name} is already in the buyer master (same ${why}) — selected it instead of adding a copy.`, out));
    }
    return res.status(201).json(ApiResponse.created('Scrap buyer added', out));
  }),
};

export default scrapImsController;
