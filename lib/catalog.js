// lib/catalog.js
export const CATEGORIES = [
  { key: "patiss", label: "Pâtisserie" },
  { key: "vente", label: "Vente" },
  { key: "boulanger", label: "Boulanger" },
];

export const catLabel = (key) => (CATEGORIES.find(c => c.key === key)?.label || key);
