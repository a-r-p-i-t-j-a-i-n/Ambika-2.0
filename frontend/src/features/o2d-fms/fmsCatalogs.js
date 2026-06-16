// The FMS catalogs the step builder & templates can switch between. Each catalog
// is an independent set of steps (see StepDefinition.fmsKey on the backend).
//   V1            → "FMS 1.0", the original O2D flow.
//   CURRENT_SHEET → mirror of the client's live Google-sheet flow (13 steps).
export const FMS_CATALOGS = [
  { key: 'V1',            label: 'FMS 1.0',           desc: 'The original O2D step flow.' },
  { key: 'CURRENT_SHEET', label: 'Current Sheet FMS', desc: "Mirror of the client's live sheet flow." },
];

export const DEFAULT_FMS_KEY = 'V1';

export const fmsLabel = (key) => FMS_CATALOGS.find((f) => f.key === key)?.label || key;
