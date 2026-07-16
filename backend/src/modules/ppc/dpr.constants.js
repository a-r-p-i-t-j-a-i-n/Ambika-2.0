/**
 * DPR / OEE canonical reference lists — the single source of truth for the
 * shop-floor Daily Production Report. These mirror the client's Excel columns
 * exactly (order preserved), so a DPR document round-trips to their sheet.
 *
 * The frontend keeps its own copy of the human labels in dprMeta.jsx (it can't
 * import backend code); the *keys* here are what persist to the database, so
 * treat them as stable — never rename a key, only add.
 */

// The 13 hourly production buckets, in the sheet's column order (08:30 → 09:00
// next day). The operator enters produced pieces hour-by-hour; the sum is the
// shift's Production Qty.
export const HOUR_SLOTS = [
  '0830-0930', '0930-1030', '1030-1130', '1130-1230', '1230-0100',
  '0100-0200', '0200-0300', '0300-0400', '0400-0500', '0500-0600',
  '0600-0700', '0700-0800', '0800-0900',
];

export const HOUR_SLOT_LABELS = {
  '0830-0930': '08:30–09:30', '0930-1030': '09:30–10:30', '1030-1130': '10:30–11:30',
  '1130-1230': '11:30–12:30', '1230-0100': '12:30–01:00', '0100-0200': '01:00–02:00',
  '0200-0300': '02:00–03:00', '0300-0400': '03:00–04:00', '0400-0500': '04:00–05:00',
  '0500-0600': '05:00–06:00', '0600-0700': '06:00–07:00', '0700-0800': '07:00–08:00',
  '0800-0900': '08:00–09:00',
};

// Planned downtime — legitimate, scheduled non-production time. Subtracted from
// Available Time to give Net Available Time (it does NOT hurt Availability).
export const PLANNED_REASONS = [
  { key: 'mc_pm',        label: 'M/c PM' },
  { key: 'shutdown',     label: 'Shutdown / No Plan' },
  { key: 'lunch_tea',    label: 'Lunch & Tea Time' },
  { key: 'training',     label: 'Training / Meeting' },
  { key: 'cleaning_5s',  label: '5S / M/c Cleaning' },
  { key: 'plan_down_1',  label: 'Plan Downtime 1' },
  { key: 'plan_down_2',  label: 'Plan Downtime 2' },
];

// Unplanned downtime / idle time — the losses that DO hurt Availability. This is
// the full reason catalogue from the sheet (order preserved).
export const DOWNTIME_REASONS = [
  { key: 'no_operator',      label: 'No Operator / No Manpower' },
  { key: 'coil_unloading',   label: 'Coil Unloading' },
  { key: 'no_material',      label: 'No Material' },
  { key: 'material_shifting', label: 'Material Shifting' },
  { key: 'mc_breakdown',     label: 'M/C Breakdown' },
  { key: 'tool_breakdown',   label: 'Tool Breakdown' },
  { key: 'tool_changeover',  label: 'Tool Changeover' },
  { key: 'thessy_changing',  label: 'Thessy Changing' },
  { key: 'die_setup',        label: 'Die Setup' },
  { key: 'die_punch',        label: 'Die Punch' },
  { key: 'die_polish',       label: 'Die Polish' },
  { key: 'die_change',       label: 'Die Change' },
  { key: 'die_ring_ct_pol',  label: 'Die Ring Ct. Pol.' },
  { key: 'material_packing', label: 'Material Packing' },
  { key: 'punch_change',     label: 'Punch Change' },
  { key: 'cutting_circle',   label: 'Cutting Circle' },
  { key: 'tool_dhar',        label: 'Tool Dhar' },
  { key: 'setting_punch',    label: 'Setting Punch' },
  { key: 'box_packing',      label: 'Box Packing' },
  { key: 'power_cut',        label: 'Power Cut' },
  { key: 'soap_mixing',      label: 'Soap Mixing' },
  { key: 'circle_unloading', label: 'Circle Unloading' },
  { key: 'chun_packing',     label: 'Chun Packing' },
  { key: 'freshen_up',       label: 'Freshen Up' },
  { key: 'material_counting', label: 'Material Counting' },
  { key: 'machine_prob',     label: 'Machine Prob' },
  { key: 'other_loss',       label: 'Other Loss' },
  { key: 'machine_setting',  label: 'Machine Setting' },
  { key: 'paper_polish',     label: 'Paper Polish' },
  { key: 'press_setting',    label: 'Press Setting' },
  { key: 'circle_shifting',  label: 'Circle Shifing' },
  { key: 'material_repair',  label: 'Material Repair' },
  { key: 'die_prob',         label: 'Die Prob' },
  { key: 'material_checking', label: 'Material checking' },
  { key: 'no_tool',          label: 'No Tool' },
  { key: 'box_loading',      label: 'Box Loading' },
  { key: 'setting_coil',     label: 'Setting Coil' },
];

// Rejection / defect types (the "Defects (Rejection Pcs)" block). Their sum is
// the Total Rej Qty that drives the Quality ratio.
export const DEFECT_TYPES = [
  { key: 'side_cut',        label: 'Side Cut' },
  { key: 'bend',            label: 'Bend' },
  { key: 'scratch',         label: 'Scratch' },
  { key: 'pressure',        label: 'Pressure' },
  { key: 'dent',            label: 'Dent' },
  { key: 'patti_bardi',     label: 'Patti Bardi' },
  { key: 'crack',           label: 'Crack' },
  { key: 'goba_prob',       label: 'Goba Prob' },
  { key: 'burr',            label: 'Burr' },
  { key: 'press_line',      label: 'Press Line' },
  { key: 'punching_miss',   label: 'Punching Miss' },
  { key: 'outpatti',        label: 'Outpatti' },
  { key: 'dent_scratch',    label: 'Dent / Scratch' },
  { key: 'rolling_line',    label: 'Rolling Line' },
  { key: 'rolling_goba',    label: 'Rolling Goba' },
  { key: 'inside_ragdi',    label: 'Inside Ragdi' },
  { key: 'file_mark',       label: 'File Mark' },
  { key: 'scrap',           label: 'Scrap' },
  { key: 'circle',          label: 'Circle' },
  { key: 'others',          label: 'Others' },
  { key: 'setting_pcs',     label: 'Setting Pcs' },
  { key: 'patti_chimati',   label: 'Patti Chimati' },
  { key: 'dimension_ng',    label: 'Dimension NG' },
  { key: 'patti_problem',   label: 'Patti Problem' },
  { key: 'chun_mar_bottom', label: 'Chun Mar On Bottom' },
];

export const SHIFTS = ['A', 'B', 'C', 'G']; // G = General / day shift

// Machine families seen in the Process Master "Machine" column. Used to group
// machines and to sanity-check that a machine can run a given operation.
export const MACHINE_TYPES = [
  'Circle Cutting Press',
  'Double Action Press',
  'Single Action Press',
  'Spinning / Rolling Machine',
  'Cutting Machine',
  'Hydraulic Press',
  'Buffing Motor',
  'Lathe',
  'Manual / Other',
];

// Quick lookup maps (key → label) for validation / display.
export const PLANNED_KEYS = new Set(PLANNED_REASONS.map((r) => r.key));
export const DOWNTIME_KEYS = new Set(DOWNTIME_REASONS.map((r) => r.key));
export const DEFECT_KEYS = new Set(DEFECT_TYPES.map((r) => r.key));

export default {
  HOUR_SLOTS, HOUR_SLOT_LABELS, PLANNED_REASONS, DOWNTIME_REASONS,
  DEFECT_TYPES, SHIFTS, MACHINE_TYPES,
};
