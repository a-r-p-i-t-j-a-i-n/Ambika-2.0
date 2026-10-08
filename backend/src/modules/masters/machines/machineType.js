/**
 * Machine family inference, shared by the master service and the Excel importer.
 *
 * `machineType` is a *controlled* vocabulary (MACHINE_TYPES, 9 values) that
 * ProcessRoute rows are matched against — it is deliberately NOT the same thing
 * as the machine's display `name`, which comes verbatim from the master sheet and
 * carries capacity in its text ("Hydrualic Press - 100Tn", "Lathe Machine").
 * Lifted out of scripts/seed_ppc_dpr_masters.js so both writers agree.
 */
import { MACHINE_TYPES } from '../../ppc/dpr.constants.js';

export { MACHINE_TYPES };

export const DEFAULT_MACHINE_TYPE = 'Manual / Other';

/** Infer the family from the code prefix (3-letter codes first, so SAP ≠ S). */
export const machineTypeFromCode = (code) => {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('CCP')) return 'Circle Cutting Press';
  if (c.startsWith('DAP')) return 'Double Action Press';
  if (c.startsWith('SAP')) return 'Single Action Press';
  if (c.startsWith('HYP')) return 'Hydraulic Press';
  if (c.startsWith('BF')) return 'Buffing Motor';
  if (/^S\d/.test(c)) return 'Spinning / Rolling Machine';
  if (/^C\d/.test(c)) return 'Cutting Machine';
  if (/^L\d/.test(c)) return 'Lathe';
  return DEFAULT_MACHINE_TYPE;
};
