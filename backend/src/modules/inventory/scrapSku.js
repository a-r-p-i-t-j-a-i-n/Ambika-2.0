import SKU from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * The scrap item.
 *
 * Scrap is stocked as ONE generic SKU, not one per coil grade. That is what the
 * source data supports: the client's Summary Scrap sheet records a weight per
 * cut and nothing that identifies the scrap itself — no scrap code, no scrap
 * rate, no grade. Mixed offcuts go into one heap and are sold by weight, so one
 * balance in kilograms is the honest model. Per-grade scrap remains possible
 * later by adding SKUs; nothing here forecloses it.
 *
 * The code is one that already exists. `SSMC-SCRAP` was created as a Finished
 * Good and later soft-deleted by the SKU-master cleanup, and `SKU.code` carries
 * a GLOBAL unique index with no soft-delete filter — so a second `SSMC-SCRAP`
 * can never be inserted. The row is revived and reclassified by
 * `scripts/ensureScrapSku.js` rather than duplicated.
 */
export const SCRAP_SKU_CODE = 'SSMC-SCRAP';

/** Scrap is weighed, never counted. Spelled as RM spells it, not 'KG'/'Kgs'. */
export const SCRAP_UNIT = 'KGS';

export const SCRAP_SKU_DEFAULTS = {
  name: 'Scrap',
  itemType: 'SCRAP',
  unit: SCRAP_UNIT,
  category: 'Metal scrap',
};

/**
 * Resolved once per process. The scrap SKU is master data keyed by an immutable
 * unique code, so re-reading it on every stock entry buys nothing — and the
 * lookup would otherwise sit on the hot path of a transaction.
 *
 * Only a SUCCESSFUL lookup is cached: if the SKU has not been seeded yet, every
 * call keeps trying, so running the seed script fixes the running server
 * without a restart.
 */
let cached = null;

/**
 * The scrap SKU, or a clear instruction if it is missing.
 *
 * Deliberately never creates it. Seeding master data as a side effect of a
 * stock entry would put a SKU insert inside a stock transaction, where a
 * rollback would take the item master with it — and would hide a
 * misconfigured environment behind a row that silently appeared.
 */
export const resolveScrapSku = async () => {
  if (cached) return cached;

  const sku = await SKU.findOne({ code: SCRAP_SKU_CODE, isDeleted: { $ne: true } })
    .select('_id code name unit itemType').lean();

  if (!sku) {
    throw new AppError(
      'The Scrap item is not set up yet, so scrap stock cannot be moved. '
      + 'Ask an administrator to run: npm run seed:scrap-sku -- --commit',
      503,
    );
  }

  cached = sku;
  return sku;
};

/** Test/script hook — drop the memoised SKU so the next call re-reads it. */
export const resetScrapSkuCache = () => { cached = null; };
