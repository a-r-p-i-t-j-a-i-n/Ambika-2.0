// Number / date text for the O2D Dashboard (Indian grouping, short dates).
import { AVATAR_COLORS } from './dashTheme';

export const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
export const fmtMoney = (n) => `₹ ${fmtNum(n)}`;
export const fmtDateShort = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : '—');

export const initials = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
};

// The same person always gets the same colour.
export const avatarColor = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

/** Rows → CSV download. `columns`: [{ label, csv(row) }]. */
export const downloadCsv = (fileName, columns, rows) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => cell(c.label)), ...rows.map((r) => columns.map((c) => cell(c.csv(r))))];
  // A byte-order mark first, so Excel reads ₹ and Indian names correctly.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + lines.map((l) => l.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
