// pages/suppliers/becus/index.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";

// ---------- WhatsApp (fallback tablette) ----------
// WhatsApp wa.me attend un numéro en format international SANS "+" et SANS espaces.
// Ex: +33 6 12 34 56 78 => 33612345678
function normalizeWhatsAppPhone(raw) {
  const digits = (raw ?? "").toString().replace(/[^0-9]/g, "");
  return digits;
}
function localWaKeyPhone() {
  return `wa_phone_${SUPPLIER_KEY}`;
}
function localWaKeyName() {
  return `wa_name_${SUPPLIER_KEY}`;
}
function readLocalWhatsApp() {
  if (typeof window === "undefined") return null;
  try {
    const p = window.localStorage.getItem(localWaKeyPhone()) || "";
    const n = window.localStorage.getItem(localWaKeyName()) || "";
    const phone = normalizeWhatsAppPhone(p);
    if (phone) return { phone, name: n || "Bécus" };
  } catch {}
  return readLocalWhatsApp() || { phone: "", name: "Bécus" };
}
function writeLocalWhatsApp(phoneRaw, nameRaw) {
  if (typeof window === "undefined") return;
  try {
    const phone = normalizeWhatsAppPhone(phoneRaw);
    if (phone) window.localStorage.setItem(localWaKeyPhone(), phone);
    else window.localStorage.removeItem(localWaKeyPhone());
    const n = (nameRaw ?? "").toString().trim();
    if (n) window.localStorage.setItem(localWaKeyName(), n);
    else window.localStorage.removeItem(localWaKeyName());
  } catch {}
}


// ---------- Dates (Bécus = Jeudi) ----------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function addDaysISO(iso, delta) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}
function nextThursdayISO(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun ... 4 Thu
  const target = 4;
  let add = (target - day + 7) % 7;
  if (add === 0) add = 7; // "prochain" jeudi
  d.setDate(d.getDate() + add);
  return toISODate(d);
}
function monthKey(iso) {
  const [y, m] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, 1);
  const months = [
    "Janvier","Février","Mars","Avril","Mai","Juin",
    "Juillet","Août","Septembre","Octobre","Novembre","Décembre"
  ];
  return { key: `${y}-${pad2(m)}`, label: `${months[dt.getMonth()]} ${y}` };
}

// ---------- Produit / Famille ----------
function normDept(x) {
  const s = (x ?? "").toString().trim().toLowerCase();
  if (!s) return "vente";
  if (s.startsWith("patis")) return "patiss";
  if (s.startsWith("pâtis")) return "patiss";
  if (s.startsWith("boul")) return "boulanger";
  if (s.startsWith("vent")) return "vente";
  return s;
}
function deptLabel(dept) {
  const d = normDept(dept);
  if (d === "boulanger") return "Boulanger";
  if (d === "patiss") return "Pâtissier";
  return "Vente";
}
function productName(p) {
  return (
    p?.name ||
    p?.title ||
    p?.label ||
    p?.designation ||
    p?.description ||
    p?.ref ||
    p?.code ||
    p?.id ||
    "Produit"
  ).toString();
}
function productEmoji(p) {
  return (p?.emoji ?? "").toString().trim() || "📦";
}
function productImage(p) {
  return (
    p?.image_url ||
    p?.photo_url ||
    p?.img_url ||
    p?.thumb_url ||
    p?.image ||
    p?.photo ||
    ""
  );
}

// ---------- WhatsApp ----------
function buildWhatsAppText({ supplierName, deliveryISO, items, productById }) {
  const lines = [];
  lines.push(`🧾 Commande ${supplierName} • Livraison ${deliveryISO}`);
  lines.push("");
  const buckets = { vente: [], boulanger: [], patiss: [] };
  for (const it of items) {
    const p = productById[it.product_id];
    const dept = normDept(p?.dept);
    buckets[dept] = buckets[dept] || [];
    buckets[dept].push({ p, qty: it.qty ?? it.quantity ?? 0 });
  }
  const addBucket = (k, title) => {
    const arr = buckets[k] || [];
    if (!arr.length) return;
    lines.push(`*${title}*`);
    for (const x of arr) {
      const name = productName(x.p);
      lines.push(`- ${name} x${x.qty}`);
    }
    lines.push("");
  };
  addBucket("vente", "Vente");
  addBucket("boulanger", "Boulanger");
  addBucket("patiss", "Pâtissier");
  return lines.join("\n").trim();
}

async function getSupplierWhatsApp() {
  // Try suppliers table first, then supplier_contacts
  const tryTables = [
    async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .or(`key.eq.${SUPPLIER_KEY},supplier_key.eq.${SUPPLIER_KEY},slug.eq.${SUPPLIER_KEY}`)
        .limit(1);
      return data?.[0] || null;
    },
    async () => {
      const { data } = await supabase
        .from("supplier_contacts")
        .select("*")
        .or(`key.eq.${SUPPLIER_KEY},supplier_key.eq.${SUPPLIER_KEY},slug.eq.${SUPPLIER_KEY}`)
        .limit(1);
      return data?.[0] || null;
    }
  ];
  for (const fn of tryTables) {
    try {
      const row = await fn();
      if (row) {
        const phone =
          row.whatsapp_phone ||
          row.whatsapp ||
          row.phone_whatsapp ||
          row.phone ||
          row.mobile ||
          "";
        const name = row.name || row.display_name || row.label || "Bécus";
        if (phone) return { phone: phone.toString(), name };
        return { phone: "", name };
      }
    } catch (_) {}
  }
  return readLocalWhatsApp() || { phone: "", name: "Bécus" };
}

// ---------- Orders / Items (orders + order_items) ----------
async function findOrderByDate(deliveryISO) {
  // primary: orders(supplier_key, delivery_date)
  const variants = [
    { supplierCol: "supplier_key", dateCol: "delivery_date" },
    { supplierCol: "supplier_key", dateCol: "delivery_day" },
    { supplierCol: "supplier", dateCol: "delivery_date" },
    { supplierCol: "supplier", dateCol: "delivery_day" },
  ];

  for (const v of variants) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq(v.supplierCol, SUPPLIER_KEY)
        .eq(v.dateCol, deliveryISO)
        .limit(1);
      if (!error && data && data[0]) return data[0];
      // If column missing, error message contains "Could not find the '<col>' column"
      if (error && /Could not find/i.test(error.message || "")) continue;
    } catch (_) {}
  }
  return readLocalWhatsApp() || { phone: "", name: "Bécus" };
}

async function listOrdersForHistory(limit = 80) {
  // try order by delivery_date else created_at
  const sorts = ["delivery_date", "delivery_day", "created_at"];
  for (const col of sorts) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .order(col, { ascending: false })
        .limit(limit);
      if (!error && Array.isArray(data)) return data;
      if (error && /Could not find/i.test(error.message || "")) continue;
    } catch (_) {}
  }
  // fallback without order
  try {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("supplier_key", SUPPLIER_KEY)
      .limit(limit);
    return data || [];
  } catch (_) {
    return [];
  }
}

async function listItemsForOrder(orderId) {
  const qtyCols = ["qty", "quantity"];
  // fetch raw items
  const { data, error } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);
  if (error) throw error;

  // normalize qty
  return (data || []).map((r) => {
    let q = 0;
    for (const c of qtyCols) {
      if (r[c] != null) {
        q = Number(r[c]) || 0;
        break;
      }
    }
    return { ...r, qty: q };
  }).filter(r => (r.qty ?? 0) > 0);
}

async function deleteItem(orderId, productId) {
  // Delete only one line for that product (if duplicates exist, delete all)
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("order_id", orderId)
    .eq("product_id", productId);
  if (error) throw error;
}

// ---------- UI ----------
const styles = {
  page: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#111827",
    background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 22%, #ffffff 100%)",
    minHeight: "100vh",
    paddingBottom: 32,
  },
  container: {
    width: "min(1400px, calc(100vw - 32px))",
    margin: "18px auto 0",
  },
  topRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  leftTitle: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  h1: { fontSize: 26, fontWeight: 800, margin: 0, lineHeight: 1.1 },
  sub: { fontSize: 14, color: "#6b7280", fontWeight: 600, marginTop: 2 },
  pillLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    textDecoration: "none",
    color: "#111827",
    fontWeight: 700,
    boxShadow: "0 8px 20px rgba(17,24,39,.06)",
    whiteSpace: "nowrap",
  },
  pillBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(17,24,39,.06)",
    whiteSpace: "nowrap",
  },
  pillBtnPrimary: {
    background: "linear-gradient(180deg, #e8f3ff 0%, #ffffff 90%)",
    border: "1px solid #bfdcff",
  },
  banner: {
    borderRadius: 16,
    padding: "12px 14px",
    border: "1px solid #b7e4c7",
    background: "linear-gradient(180deg, #e9fbf0 0%, #f7fff9 100%)",
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
    boxShadow: "0 10px 24px rgba(17,24,39,.05)",
    marginBottom: 14,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #86efac",
    background: "#dcfce7",
    color: "#065f46",
    fontWeight: 800,
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  smallMeta: { color: "#6b7280", fontSize: 13, fontWeight: 700 },
  card: {
    borderRadius: 18,
    border: "1px solid #edf2f7",
    background: "#fff",
    boxShadow: "0 14px 34px rgba(17,24,39,.08)",
    padding: 16,
    marginTop: 14,
  },
  cardTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle: { margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: -0.2 },
  cardDate: { marginTop: 4, color: "#6b7280", fontWeight: 700 },
  familyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  familyBox: {
    borderRadius: 16,
    border: "1px solid #eef2f7",
    background: "linear-gradient(180deg, #fbfdff 0%, #ffffff 80%)",
    padding: 12,
    minWidth: 0,
  },
  familyTitle: { fontWeight: 900, marginBottom: 10, color: "#111827" },
  itemRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid #eef2f7",
    background: "#fff",
    marginBottom: 10,
    minWidth: 0,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  name: {
    fontWeight: 900,
    fontSize: 14,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  right: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" },
  qty: { fontWeight: 900, color: "#111827", whiteSpace: "nowrap" },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "linear-gradient(180deg, #fff1f2 0%, #ffffff 90%)",
    cursor: "pointer",
    fontWeight: 900,
    display: "grid",
    placeItems: "center",
  },
  hint: { marginTop: 10, color: "#6b7280", fontWeight: 700, fontSize: 13 },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, marginTop: 12 },
  th: { textAlign: "left", padding: "10px 10px", fontSize: 12, color: "#6b7280", fontWeight: 900, borderBottom: "1px solid #eef2f7" },
  td: { padding: "10px 10px", borderBottom: "1px solid #eef2f7", fontWeight: 700, verticalAlign: "top" },
  deltaPos: { color: "#16a34a", fontWeight: 900 },
  deltaNeg: { color: "#dc2626", fontWeight: 900 },
  historyMonth: { marginTop: 10, marginBottom: 8, fontWeight: 900, color: "#111827" },
  historyRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 12px",
    borderRadius: 16,
    border: "1px solid #eef2f7",
    background: "#fff",
    marginBottom: 10,
  },
  statusPill: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#6b7280",
    fontWeight: 900,
    fontSize: 12,
  },
  pillBtnWAOn: {
    background: "#16a34a",
    borderColor: "#16a34a",
    color: "#ffffff",
  },
  pillBtnWAOff: {
    background: "#f3f4f6",
    borderColor: "rgba(15,23,42,0.14)",
    color: "#64748b",
  },
  waSetup: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    border: "1px dashed rgba(15,23,42,0.22)",
    background: "rgba(255,255,255,0.85)",
  },
  waInput: {
    minWidth: 220,
    flex: "1 1 220px",
    padding: 10,
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.18)",
    fontWeight: 900,
    outline: "none",
  },
  waSaveBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #0ea5e9",
    background: "#0ea5e9",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  waClearBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.18)",
    background: "#fff",
    color: "#0f172a",
    fontWeight: 900,
    cursor: "pointer",
  },

};

function useMounted() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

export default function BecusHome() {
  const router = useRouter();
  const mounted = useMounted();

  const deliveryISO = useMemo(() => nextThursdayISO(new Date()), []);
  const prevISO = useMemo(() => addDaysISO(deliveryISO, -7), [deliveryISO]);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [products, setProducts] = useState([]);
  const [productById, setProductById] = useState({});
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [prevOrder, setPrevOrder] = useState(null);
  const [prevItems, setPrevItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [wa, setWa] = useState({ phone: "", name: "Bécus" });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      // Catalogue products (Bécus)
      const { data: prodData, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .order("dept", { ascending: true });
      if (prodErr) throw prodErr;
      const prods = prodData || [];
      const map = {};
      for (const p of prods) map[p.id] = p;
      setProducts(prods);
      setProductById(map);

      // WhatsApp contact
      const waInfo = await getSupplierWhatsApp();
      setWa(waInfo);
      setWaDraft((waInfo?.phone || "").toString());

      // Current order
      const o = await findOrderByDate(deliveryISO);
      setOrder(o);
      if (o?.id) {
        const its = await listItemsForOrder(o.id);
        setItems(its);
      } else {
        setItems([]);
      }

      // Previous week
      const po = await findOrderByDate(prevISO);
      setPrevOrder(po);
      if (po?.id) {
        const pits = await listItemsForOrder(po.id);
        setPrevItems(pits);
      } else {
        setPrevItems([]);
      }

      // History list
      const hist = await listOrdersForHistory(120);
      // Keep only those with a date field we can display
      const cleaned = (hist || []).map((r) => {
        const date =
          r.delivery_date ||
          r.delivery_day ||
          r.date ||
          r.day ||
          r.created_at?.slice?.(0, 10) ||
          "";
        return { ...r, _date: date };
      }).filter(r => r._date);
      setHistory(cleaned);
    } catch (e) {
      setErrorText((e?.message || "Erreur de chargement.").toString());
    } finally {
      setLoading(false);
    }
  }, [deliveryISO, prevISO]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const itemsByDept = useMemo(() => {
    const buckets = { vente: [], boulanger: [], patiss: [] };
    for (const it of items) {
      const p = productById[it.product_id] || null;
      const d = normDept(p?.dept);
      (buckets[d] ||= []).push({ it, p });
    }
    return buckets;
  }, [items, productById]);

  const prevCompare = useMemo(() => {
    // Compare S-1 vs current by product_id
    const mPrev = new Map();
    const mCur = new Map();
    for (const it of prevItems) mPrev.set(it.product_id, it.qty || 0);
    for (const it of items) mCur.set(it.product_id, it.qty || 0);

    const ids = new Set([...mPrev.keys(), ...mCur.keys()]);
    const rows = [];
    for (const id of ids) {
      const p = productById[id] || null;
      rows.push({
        product_id: id,
        p,
        dept: normDept(p?.dept),
        prev: mPrev.get(id) || 0,
        cur: mCur.get(id) || 0,
        delta: (mCur.get(id) || 0) - (mPrev.get(id) || 0),
      });
    }
    // sort by dept then name
    rows.sort((a, b) => {
      const da = a.dept, db = b.dept;
      if (da !== db) return da.localeCompare(db);
      return productName(a.p).localeCompare(productName(b.p));
    });
    return rows;
  }, [prevItems, items, productById]);

  const groupedHistory = useMemo(() => {
    const groups = new Map();
    for (const r of history) {
      const mk = monthKey(r._date);
      if (!groups.has(mk.key)) groups.set(mk.key, { label: mk.label, rows: [] });
      groups.get(mk.key).rows.push(r);
    }
    // sort keys desc
    const keys = Array.from(groups.keys()).sort().reverse();
    return keys.map(k => groups.get(k));
  }, [history]);

  const removeFromHome = useCallback(async (productId) => {
    if (!order?.id) return;
    setErrorText("");
    try {
      // optimistic UI
      setItems((prev) => prev.filter((x) => x.product_id !== productId));
      await deleteItem(order.id, productId);
      // reload current items (and prev compare stays consistent)
      const its = await listItemsForOrder(order.id);
      setItems(its);
    } catch (e) {
      setErrorText((e?.message || "Suppression impossible.").toString());
      // refresh to resync
      await loadAll();
    }
  }, [order?.id, loadAll]);

  const openCatalogue = useCallback(() => {
    router.push(`/suppliers/becus/order?date=${encodeURIComponent(deliveryISO)}`);
  }, [router, deliveryISO]);

  const openHistory = useCallback((iso) => {
    router.push(`/suppliers/becus/history?date=${encodeURIComponent(iso)}`);
  }, [router]);

  const sendWhatsApp = useCallback(async () => {
    setErrorText("");
    try {
      const waInfo = wa || { phone: "", name: "Bécus" };
      const phone = normalizeWhatsAppPhone(waInfo.phone || "");
      const text = buildWhatsAppText({
        supplierName: waInfo.name || "Bécus",
        deliveryISO,
        items,
        productById,
      });
      if (!phone) {
        setErrorText("Numéro WhatsApp manquant. Renseigne-le ci-dessous (sur cette tablette) puis réessaie.");
        return;
      }
      const url = `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErrorText((e?.message || "Envoi WhatsApp impossible.").toString());
    }
  }, [wa, deliveryISO, items, productById]);

  if (!mounted) return null;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.topRow}>
          <div style={styles.leftTitle}>
            <Link href="/" style={styles.pillLink}>← Accueil</Link>
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.h1}>🥖 Bécus</h1>
              <div style={styles.sub}>Livraison : {deliveryISO.split("-").reverse().join("/")}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={openCatalogue} style={{ ...styles.pillBtn, ...styles.pillBtnPrimary }}>
              📦 Catalogue
            </button>
            <button
              onClick={sendWhatsApp}
              disabled={!canSendWhatsApp}
              style={{
                ...styles.pillBtn,
                ...(canSendWhatsApp ? styles.pillBtnWAOn : styles.pillBtnWAOff),
                opacity: canSendWhatsApp ? 1 : 0.75,
                cursor: canSendWhatsApp ? "pointer" : "not-allowed",
              }}
              title={!canSendWhatsApp ? "WhatsApp inactif: numéro ou produits manquants" : "Envoyer via WhatsApp"}
            >
              💬 Envoyer WhatsApp
            </button>
            <Link href="/admin" style={styles.pillLink}>🛠️ Admin</Link>
          </div>
        </div>

        <div style={styles.banner}>
          <strong style={{ fontSize: 16 }}>Statut</strong>
          <span style={styles.badge}>✅ Ouvert jusqu&apos;au mercredi 12:00</span>
{loading ? <span style={styles.smallMeta}>Chargement…</span> : null}
          {errorText ? (
            <span style={{ ...styles.smallMeta, color: "#b91c1c" }}>{errorText}</span>
          ) : null}

          {!normalizeWhatsAppPhone(wa?.phone || "") ? (
            <div style={styles.waSetup}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>
                📌 Numéro WhatsApp Bécus non configuré (sur cette tablette)
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={waDraft}
                  onChange={(e) => setWaDraft(e.target.value)}
                  placeholder="Ex: +33 6 12 34 56 78"
                  inputMode="tel"
                  style={styles.waInput}
                />
                <button
                  onClick={() => {
                    const cleaned = normalizeWhatsAppPhone(waDraft);
                    if (!cleaned) {
                      setErrorText("Entre un numéro WhatsApp valide (international).");
                      return;
                    }
                    writeLocalWhatsApp(cleaned, wa?.name || "Bécus");
                    setWa({ ...(wa || {}), phone: cleaned, name: wa?.name || "Bécus" });
                    setErrorText("");
                  }}
                  style={styles.waSaveBtn}
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => {
                    writeLocalWhatsApp("", "");
                    setWa({ ...(wa || {}), phone: "", name: wa?.name || "Bécus" });
                    setWaDraft("");
                    setErrorText("Numéro effacé. Renseigne-le pour activer WhatsApp.");
                  }}
                  style={styles.waClearBtn}
                >
                  Effacer
                </button>
              </div>
              <div style={styles.smallMeta}>
                Astuce: on enlève automatiquement espaces et “+”. Format final = 33612345678.
              </div>
            </div>
          ) : null}
        </div>

        {/* 1) Commande en cours */}
        <div style={styles.card}>
          <div style={styles.cardTitleRow}>
            <div>
              <h2 style={styles.cardTitle}>Commande en cours</h2>
              <div style={styles.cardDate}>{deliveryISO.split("-").reverse().join("/")}</div>
            </div>
            <button onClick={openCatalogue} style={styles.pillBtn}>Modifier / Voir</button>
          </div>

          <div style={styles.familyGrid}>
            {["vente", "boulanger", "patiss"].map((dept) => {
              const label = deptLabel(dept);
              const list = itemsByDept[dept] || [];
              return (
                <div key={dept} style={styles.familyBox}>
                  <div style={styles.familyTitle}>{label}</div>
                  {list.length === 0 ? (
                    <div style={{ color: "#6b7280", fontWeight: 700, fontSize: 13 }}>Aucun produit.</div>
                  ) : (
                    list.map(({ it, p }) => {
                      const img = productImage(p);
                      return (
                        <div key={it.product_id} style={styles.itemRow} title={productName(p)}>
                          <div style={styles.iconBox}>
                            {img ? <img src={img} alt="" style={styles.img} /> : <span>{productEmoji(p)}</span>}
                          </div>
                          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                            <div style={styles.name}>{productName(p)}</div>
                          </div>
                          <div style={styles.right}>
                            <div style={styles.qty}>x{it.qty}</div>
                            <button
                              style={styles.removeBtn}
                              onClick={() => removeFromHome(it.product_id)}
                              aria-label="Retirer"
                              title="Retirer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          <div style={styles.hint}>
            Astuce : tu peux retirer un produit ici avec ✕, sans ouvrir &quot;Modifier / Voir&quot;.
          </div>
        </div>

        {/* 2) Semaine dernière */}
        <div style={styles.card}>
          <div>
            <h2 style={styles.cardTitle}>Semaine dernière</h2>
            <div style={styles.cardDate}>{prevISO.split("-").reverse().join("/")}</div>
          </div>

          {!prevOrder?.id ? (
            <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 800 }}>Aucune commande S-1.</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Produit</th>
                    <th style={styles.th}>S-1</th>
                    <th style={styles.th}>Cette semaine</th>
                    <th style={styles.th}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {prevCompare.map((r) => {
                    const name = productName(r.p);
                    const delta = r.delta;
                    return (
                      <tr key={r.product_id}>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 900 }}>{name}</div>
                          <div style={{ color: "#6b7280", fontWeight: 800, fontSize: 12 }}>{deptLabel(r.dept)}</div>
                        </td>
                        <td style={styles.td}>{r.prev}</td>
                        <td style={styles.td}>{r.cur}</td>
                        <td style={styles.td}>
                          {delta === 0 ? (
                            <span style={{ color: "#6b7280", fontWeight: 900 }}>0</span>
                          ) : delta > 0 ? (
                            <span style={styles.deltaPos}>+{delta}</span>
                          ) : (
                            <span style={styles.deltaNeg}>{delta}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={styles.hint}>
                (Comparaison automatique : S-1 vs cette semaine.)
              </div>
            </div>
          )}
        </div>

        {/* 3) Historique */}
        <div style={styles.card}>
          <div>
            <h2 style={styles.cardTitle}>Historique</h2>
            <div style={styles.cardDate}>par mois</div>
          </div>

          {groupedHistory.length === 0 ? (
            <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 800 }}>Aucune commande.</div>
          ) : (
            groupedHistory.map((g) => (
              <div key={g.label} style={{ marginTop: 12 }}>
                <div style={styles.historyMonth}>{g.label}</div>
                {g.rows.map((r) => {
                  const iso = r._date;
                  const status = (r.status || r.state || r.phase || "").toString() || "draft";
                  return (
                    <div key={r.id || iso} style={styles.historyRow}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>
                          {iso.split("-").reverse().join("/")}
                        </div>
                        <div style={styles.statusPill}>{status}</div>
                      </div>
                      <button style={styles.pillBtn} onClick={() => openHistory(iso)}>
                        Ouvrir
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; }
        @media (max-width: 980px) {
          ._becus_familygrid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );

  const hasItems = useMemo(() => {
    const arr = items || [];
    return arr.some((x) => {
      const q = Number(x.qty ?? x.quantity ?? 0);
      return q > 0;
    });
  }, [items]);

  const canSendWhatsApp = !!(hasItems && normalizeWhatsAppPhone(wa?.phone || ""));
}