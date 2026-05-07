/**
 * Indian Fiscal Year utility (April – March).
 * E.g. for a date in Feb 2025 → FY "24-25"
 *      for a date in Jun 2025 → FY "25-26"
 */

/**
 * Get fiscal year string for a given date.
 * @param {Date} date — defaults to now
 * @returns {string} e.g. "25-26"
 */
export function getFiscalYear(date = new Date()) {
  const d = new Date(date);
  const month = d.getMonth(); // 0-indexed: 0=Jan, 3=Apr
  const year  = d.getFullYear();

  const startYear = month >= 3 ? year : year - 1; // Apr onwards = current year start
  const endYear   = startYear + 1;

  const fmt = (y) => String(y).slice(-2); // last 2 digits
  return `${fmt(startYear)}-${fmt(endYear)}`;
}

/**
 * Get the start and end dates for a fiscal year.
 * @param {string} fy — e.g. "24-25"
 * @returns {{ start: Date, end: Date }}
 */
export function getFiscalYearRange(fy) {
  const [startShort, endShort] = fy.split('-').map(Number);
  const century = startShort < 50 ? 2000 : 1900;
  const startYear = century + startShort;
  const endYear   = century + endShort;

  return {
    start: new Date(startYear, 3, 1),    // April 1
    end:   new Date(endYear, 2, 31, 23, 59, 59), // March 31
  };
}
