/**
 * Machine + Machine Operator presentation metadata — labels and colours.
 *
 * Dependency-free (same reasoning as itemTypeMeta.js) so any screen can import
 * the maps without dragging a DataGrid screen in behind them.
 *
 * Every colour is taken from the palette already in use across the app; none is
 * invented. Status follows the house rule that colour tracks STATE:
 *   green  = usable            (same green as "done"/"healthy" elsewhere)
 *   amber  = present but idle  (same amber as "thin"/"late")
 *   red    = gone              (same red as "out of stock"/"critical")
 */

/** Machine.machineStatus — the enum in backend/.../masters/machines/machine.model.js. */
export const MACHINE_STATUS_META = {
  IN_USE:     { label: 'In use',       color: '#15803d', meaning: 'Running on the floor' },
  NOT_IN_USE: { label: 'Not in use',   color: '#b45309', meaning: 'Still owned, currently idle' },
  SCRAP:      { label: 'Scrap / Dead', color: '#b91c1c', meaning: 'Retired — kept for history only' },
};

/** Widest label is "Scrap / Dead"; holds the column to one pill width. */
export const MACHINE_STATUS_PILL_WIDTH = 92;

export const MACHINE_STATUS_OPTIONS = Object.entries(MACHINE_STATUS_META)
  .map(([value, m]) => ({ value, label: m.label, color: m.color, meaning: m.meaning }));

/**
 * Machine family colours. `short` keeps the grid pill narrow — the full name
 * goes in the pill's tooltip, so nothing is lost.
 */
export const MACHINE_TYPE_META = {
  'Circle Cutting Press':       { short: 'Circle Press',  color: '#4338ca' },
  'Double Action Press':        { short: 'Double Action', color: '#1d4ed8' },
  'Single Action Press':        { short: 'Single Action', color: '#0369a1' },
  'Spinning / Rolling Machine': { short: 'Spinning',      color: '#0f766e' },
  'Cutting Machine':            { short: 'Cutting',       color: '#b45309' },
  'Hydraulic Press':            { short: 'Hydraulic',     color: '#7c3aed' },
  'Buffing Motor':              { short: 'Buffing',       color: '#c2410c' },
  'Lathe':                      { short: 'Lathe',         color: '#475569' },
  'Manual / Other':             { short: 'Other',         color: '#6b7280' },
};

/** Widest short label is "Double Action". */
export const MACHINE_TYPE_PILL_WIDTH = 100;

export const machineTypeMeta = (type) =>
  MACHINE_TYPE_META[type] || { short: type || 'Other', color: '#6b7280' };

/**
 * Assignment-count tone: neutral when a machine has nobody on it (a fact worth
 * noticing, not an error — 14 machines legitimately have no operator), brand
 * blue once it does.
 */
export const countTone = (n) => (n > 0 ? '#1d4ed8' : '#6b7280');

/** Operator activity. Operators have no status of their own in the source sheet. */
export const OPERATOR_STATUS_META = {
  true:  { label: 'Active',   color: '#15803d' },
  false: { label: 'Inactive', color: '#6b7280' },
};

export const operatorStatusMeta = (isActive) => OPERATOR_STATUS_META[isActive !== false];

/**
 * Field explanations — the single source of truth for every hover tooltip in
 * both sub-modules. The grid headers, the add/edit drawers and the detail pages
 * all read from these maps, so a field is described once and reads the same
 * everywhere.
 *
 * Each note says what the field is AND what the source sheet actually contains,
 * because several columns are sparse or empty and that is worth knowing before
 * anyone concludes data is missing.
 */
export const MACHINE_FIELD_HELP = {
  code: 'Short code the shop floor and the DPR work in, e.g. DAP01. Unique — no two live machines can share one.',
  name: 'The machine name as written on the master sheet, e.g. "Double Action Press".',
  uid: 'Generated, never typed: always "<Machine Code> - <Machine Name>". It matched the sheet’s own Machine UID column on all 109 rows.',
  machineType: 'Controlled family, inferred from the code prefix (SAP → Single Action Press). Process routes are matched against it, which is why it is kept separate from the name.',
  department: 'The department or section the machine sits in, from the sheet’s Department/Section column. 17 distinct values.',
  make: 'Manufacturer. Blank for every machine on the source sheet — fill it in as you learn it.',
  capacity: 'Kept exactly as written on the sheet: "5 HP", "50 Ton", or a bare number. Parsed into a value and unit wherever it can be.',
  capacityUnit: 'Parsed from the capacity text. The DAP presses read "4.5" and "3.5" with no unit on the sheet, so none is guessed.',
  installationYear: 'Year the machine was installed. The source data runs 2010–2026.',
  machineStatus: 'In use = running · Not in use = owned but idle · Scrap / Dead = retired. Retiring keeps the machine and all its history; it is never deleted.',
  amc: 'Whether an annual maintenance contract covers this machine. Recorded on only 6 rows of the source sheet.',
  maintenanceManual: 'Whether a maintenance manual exists for this machine.',
  maintenanceManualType: 'What kind of maintenance manual it is. Blank for every machine on the source sheet.',
  dailyClitSheet: 'Whether a daily CLIT (Clean, Lubricate, Inspect, Tighten) sheet is kept for this machine.',
  dailyClitLink: 'Link to the daily CLIT sheet. The source sheet carried a link on 2 machines.',
  halfYearlyPm: 'Whether half-yearly preventive maintenance has been carried out.',
  halfYearlyPmLink: 'Link to the half-yearly PM check sheet.',
  defaultSpm: 'Fallback strokes per minute. The DPR uses it when an operation does not specify its own.',
  operatorCount: 'How many operators are currently assigned. A machine can have many — HYP02 has 7 and C05 has 8. Grey means nobody is assigned yet.',
  operators: 'Operators currently assigned to this machine. Removing one breaks only the assignment — the operator master is left untouched.',
  remarks: 'Free-text notes. Not part of the source sheet.',
  actions: 'Edit this machine, or delete it. Deleting is a soft delete — to retire a machine while keeping it visible, set its status to Scrap / Dead instead.',
};

export const OPERATOR_FIELD_HELP = {
  name: 'The operator’s name, from the sheet’s Machine Operator column. Identity is the name — spacing and capitalisation are ignored when checking for duplicates.',
  code: 'Optional employee code. The source sheet gives operators no code, so this is blank unless you add one.',
  department: 'The department this operator works in, taken from the machine rows they appear on.',
  departments: 'Every department this operator appears under. Three operators — Appoo, Bhola and Rambabu — legitimately span two.',
  shift: 'Optional shift label. Used by the DPR; not present on the source sheet.',
  isActive: 'Active operators appear in the assignment pickers. Switch someone off when they leave the floor — their history and assignments stay intact.',
  machineCodes: 'Codes of the machines this operator runs. Derived from the assignment records, never typed in.',
  machineCount: 'How many machines this operator runs. One operator can run many — Appoo runs both DAP01 and HYP04.',
  machines: 'Machines currently assigned to this operator. Removing one breaks only the assignment — the machine master is left untouched.',
  remarks: 'Free-text notes. Not part of the source sheet.',
  actions: 'Edit this operator, or delete them. If someone has merely left a machine, unassign them instead; if they have left the floor, switch them to Inactive.',
};

export default MACHINE_STATUS_META;
