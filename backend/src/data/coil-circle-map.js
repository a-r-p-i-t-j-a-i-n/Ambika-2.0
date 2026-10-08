/**
 * COIL → CIRCLE MAP — which circle sizes a coil is approved to produce
 * ════════════════════════════════════════════════════════════════════
 *
 * Source: the client's Coil/Circle mapping sheet. This file is the single,
 * reviewable source of truth for that mapping — the Cut Coils screen reads it
 * through `GET /rm-ims/circle-options`, and `rmImsService.convert()` enforces
 * it before any stock moves. It exists in exactly one place on purpose: a copy
 * in the React component would drift the first time the client revises a size.
 *
 * WHY: the Circle dropdown used to offer every CIRCLE SKU in the master, so a
 * Cu 0.7 mm coil could be recorded as producing DD circles and the ledger
 * accepted it. The mapping turns an operator's slip into a rejected form.
 *
 * SCOPE — this file holds ONLY the coil→circle relationship. It does NOT
 * classify what is a coil and what is a circle: that is `SKU.itemType`
 * (RAW_MATERIAL vs CIRCLE) and stays the only classifier in the system.
 *
 * READ THIS BEFORE ADDING A ROW
 *   The mapping is business data, not a derivable rule. A circle is allowed
 *   ONLY because the client's sheet lists it — never because its code shares a
 *   prefix with the coil, nor because its thickness or diameter looks right.
 *   JSL202-06-825 is a real, active 0.6 mm circle whose code matches the
 *   JSL202-06 coil perfectly, and it is deliberately NOT mapped. Prefix
 *   matching would have silently approved it.
 *
 *   To change the mapping: edit the table below, nothing else. Then run
 *   `npm run audit:coil-map` to see what it means for the SKU master and for
 *   the conversions already recorded.
 *
 * Fields per circle:
 *   code         the circle SKU code, as it appears in the SKU master
 *   clientLabel  the description from the client's sheet. Diagnostics ONLY —
 *                the audit script quotes it when a code is missing from the
 *                master. Screens show the master's own `name`, so there is
 *                never a second source for an item's name.
 *
 * See DATA_NOTES at the bottom for what was checked against the live master.
 */

export const COIL_CIRCLE_MAP = Object.freeze({
  // ── DD (deep-drawing grade) ────────────────────────────────────────
  'JSL202-06': Object.freeze([ // DD 0.60 mm
    { code: 'JSL202-06-700', clientLabel: 'DD - 0.6mm - 7.00"' },
    { code: 'JSL202-06-725', clientLabel: 'DD - 0.6mm - 7.25"' },
    { code: 'JSL202-06-775', clientLabel: 'DD - 0.6mm - 7.75"' },
    { code: 'JSL202-06-850', clientLabel: 'DD - 0.6mm - 8.50"' },
    { code: 'JSL202-06-875', clientLabel: 'DD - 0.6mm - 8.75"' },
  ]),
  'JSL202-07': Object.freeze([ // DD 0.70 mm
    { code: 'JSL202-07-600', clientLabel: 'DD - 0.7mm - 6.00"' },
    { code: 'JSL202-07-925', clientLabel: 'DD - 0.7mm - 9.25"' },
  ]),
  'JSL202-08': Object.freeze([ // DD 0.80 mm
    { code: 'JSL202-08-1050', clientLabel: 'DD - 0.8mm - 10.50"' },
    { code: 'JSL202-08-850', clientLabel: 'DD - 0.8mm - 8.50"' },
    { code: 'JSL202-08-858', clientLabel: 'DD - 0.8mm - 8.58"' },
    { code: 'JSL202-08-900', clientLabel: 'DD - 0.8mm - 9.00"' },
    { code: 'JSL202-08-978', clientLabel: 'DD - 0.8mm - 9.78"' },
  ]),

  // ── Cu (copper-bearing grade) ──────────────────────────────────────
  'JSL204-07': Object.freeze([ // Cu 0.70 mm
    { code: 'JSL204-07-700', clientLabel: 'Cu - 0.7mm - 7.00"' },
    { code: 'JSL204-07-750', clientLabel: 'Cu - 0.7mm - 7.50"' },
    { code: 'JSL204-07-840', clientLabel: 'Cu - 0.7mm - 8.40"' },
  ]),
  'JSL204-08': Object.freeze([ // Cu 0.80 mm
    { code: 'JSL204-08-700', clientLabel: 'Cu - 0.8mm - 7.00"' },
    { code: 'JSL204-08-825', clientLabel: 'Cu - 0.8mm - 8.25"' },
    { code: 'JSL204-08-850', clientLabel: 'Cu - 0.8mm - 8.50"' },
    { code: 'JSL204-08-889', clientLabel: 'Cu - 0.8mm - 8.89"' },
    { code: 'JSL204-08-900', clientLabel: 'Cu - 0.8mm - 9.00"' },
    { code: 'JSL204-08-978', clientLabel: 'Cu - 0.8mm - 9.78"' },
  ]),
  'JSL204-10': Object.freeze([ // Cu 1.00 mm
    { code: 'JSL204-10-850', clientLabel: 'Cu - 1.0mm - 8.50"' },
    { code: 'JSL204-10-925', clientLabel: 'Cu - 1.0mm - 9.25"' },
  ]),
});

/** Why a set of circles was refused. `OK` carries no offending codes. */
export const MAP_VERDICT = Object.freeze({
  OK: 'OK',
  /** The coil itself is absent from the client's sheet. */
  COIL_UNMAPPED: 'COIL_UNMAPPED',
  /** The coil is mapped, but at least one circle is not on its list. */
  CIRCLE_NOT_ALLOWED: 'CIRCLE_NOT_ALLOWED',
});

/**
 * SKU codes are stored upper-case and trimmed by the SKU model, but they reach
 * us from typed input, query strings and imports. Compare them the way the
 * master stores them, so `jsl204-07 ` is the same coil as `JSL204-07`.
 */
export const normalizeSkuCode = (code) => String(code ?? '').trim().toUpperCase();

/**
 * The circles a coil may produce, or `null` when the client's sheet says
 * nothing about this coil at all.
 *
 * `null` and `[]` mean different things and callers must keep them apart:
 * `null` is "we have no instruction for this coil", which is NOT a licence to
 * offer every circle. No coil is mapped to an empty list today.
 */
export const allowedCirclesForCoil = (coilCode) => {
  const row = COIL_CIRCLE_MAP[normalizeSkuCode(coilCode)];
  return row || null;
};

/** The allowed circle codes for a coil, as a plain array. `null` when unmapped. */
export const allowedCircleCodesForCoil = (coilCode) => {
  const row = allowedCirclesForCoil(coilCode);
  return row ? row.map((c) => c.code) : null;
};

/** Is this one circle approved for this one coil? An unmapped coil approves nothing. */
export const isCircleAllowedForCoil = (coilCode, circleCode) => {
  const allowed = allowedCircleCodesForCoil(coilCode);
  if (!allowed) return false;
  return allowed.includes(normalizeSkuCode(circleCode));
};

/**
 * Check EVERY circle on a conversion against its coil.
 *
 * Returns a verdict rather than throwing, so the rule can be unit-tested
 * without the express error stack and so the service decides the HTTP shape.
 * Every offending code is collected, not just the first — an operator who got
 * two rows wrong should be told about both.
 *
 * @param {string}   coilCode
 * @param {string[]} circleCodes  one entry per circle row, in row order
 * @returns {{ ok: boolean, reason: string, coilCode: string, offending: string[], allowed: string[] }}
 */
export const checkCirclesAgainstCoil = (coilCode, circleCodes = []) => {
  const coil = normalizeSkuCode(coilCode);
  const allowed = allowedCircleCodesForCoil(coil);

  if (!allowed) {
    return {
      ok: false, reason: MAP_VERDICT.COIL_UNMAPPED, coilCode: coil, offending: [], allowed: [],
    };
  }

  // De-duplicated, because the same wrong circle on three rows is one mistake.
  const offending = [...new Set(
    circleCodes.map(normalizeSkuCode).filter((c) => c && !allowed.includes(c)),
  )];

  return {
    ok: offending.length === 0,
    reason: offending.length ? MAP_VERDICT.CIRCLE_NOT_ALLOWED : MAP_VERDICT.OK,
    coilCode: coil, offending, allowed,
  };
};

/** Every circle code the sheet mentions, across all coils. Used by the audit script. */
export const allMappedCircleCodes = () => [...new Set(
  Object.values(COIL_CIRCLE_MAP).flat().map((c) => c.code),
)];

/** Every coil code the sheet maps. */
export const mappedCoilCodes = () => Object.keys(COIL_CIRCLE_MAP);

/**
 * Can this coil be cut into circles at all? True only when the client's sheet
 * lists it. Cut Coils uses this to offer only eligible coils; it says nothing
 * about whether the SKU belongs in RM stock generally — it still does.
 */
export const isCoilMapped = (coilCode) => allowedCirclesForCoil(coilCode) !== null;

export default COIL_CIRCLE_MAP;

/*
 * DATA_NOTES — checked against the live SKU master on 2026-10-05
 * ────────────────────────────────────────────────────────────────────
 * 1. All 6 coil codes and all 23 circle codes in this file exist in the `skus`
 *    collection, are active, and carry the expected itemType (RAW_MATERIAL /
 *    CIRCLE). No SKU had to be created for this mapping.
 *
 * 2. JSL204-06 (Cu 0.60 mm) is an active coil in the master that the client's
 *    sheet does NOT map. By decision it is a hard reject: it cannot be cut
 *    until the client supplies its circle sizes. One historical conversion
 *    recorded JSL204-06 → JSL204-08-700; it is left exactly as it is.
 *
 * 3. Two active CIRCLE SKUs appear on no coil's list and are therefore
 *    unselectable anywhere: JSL202-06-825 (DD - 0.6mm - 8.25") and
 *    JSL202-07-725 (DD - 0.7mm - 7.25"). Raised with the client; no SKU was
 *    deactivated or deleted.
 *
 * 4. Of 481 conversions already recorded, 2 circle lines disagree with this
 *    mapping — the JSL204-06 line above, and JSL204-08 → JSL202-08-900 (a DD
 *    circle from a Cu coil, which looks like the exact data-entry slip this
 *    mapping now prevents). Historical records are NOT migrated or corrected
 *    by this change; `npm run audit:coil-map` reports them on demand.
 */
