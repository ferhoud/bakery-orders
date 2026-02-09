// lib/supplierDates.js
const pad2 = (n) => String(n).padStart(2, "0");
export const fmtISODate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function parseISO(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nextAllowedFrom(dateObj, allowedWeekdays = [4]) {
  // allowedWeekdays: 0..6 (0=dimanche). Bécus = [4] (jeudi).
  const d = new Date(dateObj);
  for (let i = 0; i < 14; i++) {
    if (allowedWeekdays.includes(d.getDay())) return fmtISODate(d);
    d.setDate(d.getDate() + 1);
  }
  return fmtISODate(d);
}

export function prevAllowedFrom(dateObj, allowedWeekdays = [4]) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 14; i++) {
    if (allowedWeekdays.includes(d.getDay())) return fmtISODate(d);
    d.setDate(d.getDate() - 1);
  }
  return fmtISODate(d);
}

/** Normalise la date de livraison pour un fournisseur.
 * - Si queryDelivery est vide ou passée -> on force le prochain jour autorisé.
 * - Retourne aussi la "semaine dernière" (dernier jour autorisé avant aujourd'hui).
 */
export function normalizeSupplierDelivery({ queryDelivery, allowedWeekdays }) {
  const today = new Date();
  const todayISO = fmtISODate(today);

  let deliveryISO = null;
  const q = parseISO(queryDelivery);
  if (!q) {
    deliveryISO = nextAllowedFrom(today, allowedWeekdays);
  } else {
    const qISO = fmtISODate(q);
    deliveryISO = qISO < todayISO ? nextAllowedFrom(today, allowedWeekdays) : qISO;
  }

  const lastDeliveryISO = prevAllowedFrom(today, allowedWeekdays);
  return { deliveryISO, lastDeliveryISO, todayISO };
}
