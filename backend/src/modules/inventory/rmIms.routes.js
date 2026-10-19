/**
 * RM IMS routes — Raw Material (Coil + Circle) inventory.
 * Base path: /api/v1/rm-ims  (built on the shared inventory stock engine)
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { rmImsController as c } from './rmIms.controller.js';
import {
  rmOverviewQuerySchema, rmForecastQuerySchema, rmHistoryQuerySchema, rmSkuParamSchema,
  rmPolicySchema, rmReceiveSchema, rmIssueSchema, rmConvertSchema,
  rmMovementQuerySchema, rmConversionsQuerySchema, rmReceivedCoilsQuerySchema,
  rmCircleOptionsQuerySchema, rmCoilLineageParamSchema, rmCuttingHistoryQuerySchema,
  rmManualCoilLookupQuerySchema, rmCuttingCirclesQuerySchema, rmConversionLedgerQuerySchema,
} from './rmIms.validation.js';

const router = Router();
router.use(protect);

router.get('/overview', validate(rmOverviewQuerySchema, 'query'), c.getOverview);
router.get('/dashboard', c.getDashboard);
router.get('/reorder', validate(rmOverviewQuerySchema, 'query'), c.getReorderList);
router.get('/item/:skuId', validate(rmSkuParamSchema, 'params'), c.getItemDetail);
router.get('/history/:skuId', validate(rmSkuParamSchema, 'params'), validate(rmHistoryQuerySchema, 'query'), c.getStockHistory);
router.get('/forecast/:skuId', validate(rmSkuParamSchema, 'params'), validate(rmForecastQuerySchema, 'query'), c.getForecast);
router.get('/movements', validate(rmMovementQuerySchema, 'query'), c.getMovements);
router.get('/conversions', validate(rmConversionsQuerySchema, 'query'), c.getConversions);
// The physical coils on the floor, for the Cut Coils picker. Read-only: it
// reads GRN_IN movements back, it does not create a second stock record.
router.get('/received-coils', validate(rmReceivedCoilsQuerySchema, 'query'), c.getReceivedCoils);
// Manual Entry — No GRN: is this batch already a manual coil (continue its
// rounds) or a received coil (cut it from its GRN instead)? Read-only.
router.get('/manual-coils/lookup', validate(rmManualCoilLookupQuerySchema, 'query'), c.lookupManualCoil);
// Which circles the identified coil may produce, from the client's mapping.
// Read-only, like the lookup above it — the dropdown asks, it never writes.
router.get('/circle-options', validate(rmCircleOptionsQuerySchema, 'query'), c.getCircleOptions);
// One physical coil's whole cutting history — every round, in order, with what
// each one cut, produced, scrapped and left behind. Read-only and derived: it
// recomputes from the receipt, its conversions and their scrap records, and
// stores nothing. Registered BEFORE nothing else that could shadow it — the
// sibling `/item/:skuId` is a different literal prefix, so order is not load
// bearing here, but the path is kept distinct from it for exactly that reason.
router.get('/coil/:receiptId/lineage', validate(rmCoilLineageParamSchema, 'params'), c.getCoilLineage);
// Every physical coil cut so far, one row per coil — the list under the Cut
// Coils form. Read-only and derived, like the lineage it drills into.
router.get('/cutting-history', validate(rmCuttingHistoryQuerySchema, 'query'), c.getCuttingHistory);
// Every recorded cut in ONE table: a row per physical coil (its rounds on
// expand) and a row per cut that names no coil — the Coil to Circle page's
// history. Read-only and derived.
router.get('/conversion-ledger', validate(rmConversionLedgerQuerySchema, 'query'), c.getConversionLedger);
// The circle SKUs those coils' rounds actually produced — the Cutting History
// "Circle SKU" filter offers these, so it never offers a size with no rows.
// `?scope=all`: the circles of EVERY recorded cut, the imported ones included —
// what the All conversions "Circle SKU" filter offers.
router.get('/cutting-history/circles', validate(rmCuttingCirclesQuerySchema, 'query'), c.getCuttingHistoryCircles);

router.get('/policy/:skuId', validate(rmSkuParamSchema, 'params'), c.getPolicy);
router.put('/policy/:skuId', validate(rmSkuParamSchema, 'params'), validate(rmPolicySchema), c.upsertPolicy);

router.post('/receive', validate(rmReceiveSchema), c.receive);
router.post('/issue', validate(rmIssueSchema), c.issue);
router.post('/convert', validate(rmConvertSchema), c.convert);

export default router;
