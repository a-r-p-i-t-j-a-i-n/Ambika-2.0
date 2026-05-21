/**
 * Item classifier — derives an `itemType` from a SKU code.
 *
 * Used by the backfill migration to set `itemType` on SKUs that were created
 * before the field existed. The rules read the code's shape/prefix:
 *
 *   JSL###-##-###  → CIRCLE         (three segments — a cut circle)
 *   JSL###-##      → RAW_MATERIAL   (two segments — a sheet grade)
 *   PK… / ML…      → PACKING        (box / partition / sticker / bag)
 *   CO-… / BB-…    → CONSUMABLE     (buff / brush / bearing / belt / oil …)
 *   anything else  → FINISHED_GOOD  (PP1500-202, ST1000-202, MG1650-304 …)
 *
 * The rules are deterministic and side-effect free so the migration can run
 * a dry-run and show exactly what every row would become.
 */

export const classifyByCode = (rawCode = '') => {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null; // caller decides what to do with an un-coded row

  if (/^JSL\d+-\d+-\d+/.test(code)) return 'CIRCLE';
  if (/^JSL\d+-\d+$/.test(code))    return 'RAW_MATERIAL';
  if (/^(PK|ML)/.test(code))        return 'PACKING';
  if (/^(CO-|BB-)/.test(code))      return 'CONSUMABLE';

  return 'FINISHED_GOOD';
};

export default classifyByCode;
