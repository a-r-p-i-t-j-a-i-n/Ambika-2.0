/**
 * "Received At" — where Raw Material physically sits.
 *
 * The client's sheet records a Received At against every RM receipt and every
 * scrap line, and it only ever holds two values: the plant, and the job worker
 * who cuts most of the coil. They map onto the stock engine's existing
 * `warehouse` field, so nothing new is invented — the two codes the sheet
 * already uses are simply given names.
 *
 * This lives in its own file, with no MUI or icon imports, for one reason: the
 * GRN Complete dialog needs the SAME list and the SAME default, and reaching
 * for it through rmImsMeta would pull the whole IMS component surface into the
 * procurement bundle. rmImsMeta re-exports both names, so every existing RM
 * import keeps working unchanged.
 *
 * The server validates against its own copy of this list
 * (RM_RECEIVED_AT_LOCATIONS in inventoryStock.model.js) — that is the
 * authority; this is the matching vocabulary for the screens.
 */
export const RECEIVED_AT_OPTIONS = [
  { value: 'PLG01', label: 'PLG01 — Plant',    hint: 'Our own works — the default for anything received or issued in-house.' },
  { value: 'JW001', label: 'JW001 — Job work', hint: 'The outside job worker who cuts coil into circles.' },
];

export const DEFAULT_RECEIVED_AT = 'PLG01';
