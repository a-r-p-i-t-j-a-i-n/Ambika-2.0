/**
 * Scrap IMS routes — what each coil cut left behind, and the scrap the company
 * holds because of it.
 * Base path: /api/v1/scrap-ims
 *
 * Guarded with `protect` only, exactly as the Consumables, Raw Material and
 * Finished Goods routes are — the permission registry carries no Inventory
 * slugs at all, so adding one here alone would lock out every non-root user and
 * break parity with the three sibling modules. Giving the whole inventory
 * family real permissions is worth doing; doing it to scrap by itself is not.
 *
 * The GETs are the production register (one row per cut). The POSTs move the
 * scrap BALANCE, which is a different thing living in the shared stock ledger —
 * see the service header for why the two are kept apart.
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { scrapImsController as c } from './scrapIms.controller.js';
import {
  scrapOverviewQuerySchema, scrapDashboardQuerySchema, scrapRecordParamSchema,
  scrapMovementsQuerySchema, scrapOutHistoryQuerySchema, scrapInSchema, scrapOutSchema, scrapByCoilQuerySchema,
  createScrapBuyerSchema, scrapBuyerQuerySchema, scrapBuyerParamSchema,
} from './scrapIms.validation.js';

const router = Router();
router.use(protect);

// ── Production scrap: the register of cuts ──
router.get('/overview', validate(scrapOverviewQuerySchema, 'query'), c.getOverview);
router.get('/dashboard', validate(scrapDashboardQuerySchema, 'query'), c.getDashboard);
// Scrap grouped by the PHYSICAL coil it came off, keyed on coilReceiptId.
//
// Its own endpoint rather than a `groupBy=coil` flag on /overview, because it
// returns a different row shape AND a different summary — folding two shapes
// into one response is what leaves a client guessing which one it got. The
// dashboard's existing by-GRADE breakdown is untouched; both ship side by side.
//
// Declared before `/record/:id` for the usual reason: Express matches in order,
// and a literal path registered after a parameterised sibling at the same depth
// is a trap waiting for the next person who adds one.
router.get('/by-coil', validate(scrapByCoilQuerySchema, 'query'), c.getByCoil);
router.get('/record/:id', validate(scrapRecordParamSchema, 'params'), c.getRecord);

// ── Scrap stock: the balance and its ledger ──
router.get('/stock', c.getStock);
router.get('/movements', validate(scrapMovementsQuerySchema, 'query'), c.getMovements);
// The Scrap Out rows of that same ledger, shaped for the table under the form.
router.get('/scrap-out/history', validate(scrapOutHistoryQuerySchema, 'query'), c.getScrapOutHistory);

router.post('/scrap-in', validate(scrapInSchema), c.scrapIn);
router.post('/scrap-out', validate(scrapOutSchema), c.scrapOut);

// ── Scrap Buyer master: who scrap is sold to ──
// Here, under the module's own `protect`, rather than on the Party master: Party
// is the customer master for orders and invoices (see scrapBuyer.model.js), and
// its routes carry no authentication at all. POST is find-or-create, so the
// "Add new buyer" button on Scrap Out can never make a second copy of a buyer.
router.get('/buyers', validate(scrapBuyerQuerySchema, 'query'), c.listBuyers);
router.post('/buyers', validate(createScrapBuyerSchema), c.createBuyer);
router.get('/buyers/:id', validate(scrapBuyerParamSchema, 'params'), c.getBuyer);

export default router;
