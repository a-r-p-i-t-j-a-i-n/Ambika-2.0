// India calendar date for date-only form defaults — the app's day convention
// (FollowUpDoneDialog, backend followUp.dates.js istDayKey). `toISOString()`
// gives the UTC date, which is still YESTERDAY from 00:00 to 05:30 IST.
const IST_TZ = 'Asia/Kolkata';

/** Today's date in India as 'YYYY-MM-DD' (the date inputs' value format). */
export const istTodayStr = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: IST_TZ });
