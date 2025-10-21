// lib/date.js
// Semaine avec lundi comme 1er jour
export function startOfWeek(inputDate) {
  const d = new Date(inputDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=dim ... 6=sam
  const delta = (day + 6) % 7; // décaler pour que lundi=0
  d.setDate(d.getDate() - delta);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(n || 0));
  return d;
}

export function fmtISODate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// (Optionnel, si tu t'en sers ailleurs)
export const SHIFT_LABELS = {
  MORNING: "7h",
  MIDDAY: "6h",
  EVENING: "7h",
  SUNDAY_EXTRA: "9h-13h30",
};
