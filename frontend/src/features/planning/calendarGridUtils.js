// Helpers shared by the Dispatch-style month grid (CalendarGrid.jsx).

// Client names eat a lot of width in a calendar cell. Drop the legal suffixes
// (Pvt / Ltd / Limited / Technologies…) and, if it's still long, keep just the
// first word — "Elin Electronics Limited." → "Elin", "Epack Durable Ltd" → "Epack Durable".
export const shortParty = (name) => {
  const raw = String(name || '—').trim();
  const cleaned = raw
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|technologies|industries|enterprises|works)\b\.?/gi, '')
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return raw;
  const two = words.slice(0, 2).join(' ');
  return two.length > 14 ? words[0] : two;
};

/** The weeks that hold the month's days (5 or 6 rows), Sunday first — as Dispatch. */
export const monthGridDays = (cursor) => {
  const startOfMonth = cursor.startOf('month');
  const start = startOfMonth.day(0); // back to the Sunday of the first week
  const weeks = Math.ceil((startOfMonth.day() + cursor.daysInMonth()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => start.add(i, 'day'));
};
