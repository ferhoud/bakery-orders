// pages/suppliers/becus/index.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";

/* -------------------- Helpers -------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function addDaysISO(iso, delta) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}
function fmtFRDash(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return "—";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}-${m}-${y}`;
}
function fmtFRSlash(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return "—";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}
function getBecusDeliveryISO(now = new Date()) {
  // Delivery day = Thursday.
  // Switch to next delivery after Thursday 08:00.
  const n = new Date(now);
  const day = n.getDay(); // 0 Sun ... 4 Thu
  const base = new Date(n);
  base.setHours(0, 0, 0, 0);

  const daysUntilThu = (4 - day + 7) % 7;
  base.setDate(base.getDate() + daysUntilThu); // this week's Thu (or today if Thu)

  if (day === 4 && n.getHours() >= 8) base.setDate(base.getDate() + 7);
  return toISODate(base);
}

function normDept(x) {
  const s = (x ?? "").toString().trim().toLowerCase();
  if (!s) return "vente";
  if (s.startsWith("patis") || s.startsWith("pâtis")) return "patiss";
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
  return (p?.emoji || p?.icon || "📦").toString();
}
function productImage(p) {
  return p?.image_url || p?.image || p?.photo || "";
}

/* -------------------- WhatsApp text -------------------- */
function buildWhatsAppText({ deliveryISO, items, productById }) {
  // Required header
  const header = `🧾 Commande Pour BM Boulangerie Livraison ${fmtFRDash(deliveryISO)}`;
  const lines = [header, ""];

  const buckets = { vente: [], boulanger: [], patiss: [] };
  for (const it of items) {
    const p = productById[it.product_id];
    const dept = normDept(p?.dept);
    (buckets[dept] ||= []).push({ p, qty: it.qty ?? it.quantity ?? 0 });
  }

  const addBucket = (k, title) => {
    const arr = buckets[k] || [];
    if (!arr.length) return;
    lines.push(`*${title}*`);
    for (const x of arr) {
      lines.push(`- ${productName(x.p)} x${x.qty}`);
    }
    lines.push("");
  };

  addBucket("vente", "Vente");
  addBucket("boulanger", "Boulanger");
  addBucket("patiss", "Pâtissier");

  return lines.join("\n").trim();
}

/* -------------------- Supabase helpers -------------------- */
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
    },
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
  return { phone: "", name: "Bécus" };
}

async function findOrderByDate(deliveryISO) {
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
      if (error && /Could not find/i.test(error.message || "")) continue;
    } catch (_) {}
  }
  return null;
}

async function listOrdersForHistory(limit = 80) {
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
  try {
    const { data } = await supabase.from("orders").select("*").eq("supplier_key", SUPPLIER_KEY).limit(limit);
    return data || [];
  } catch (_) {
    return [];
  }
}

async function listItemsForOrder(orderId) {
  const qtyCols = ["qty", "quantity"];
  const { data, error } = await supabase.from("order_items").select("*").eq("order_id", orderId);
  if (error) throw error;

  return (data || [])
    .map((r) => {
      let q = 0;
      for (const c of qtyCols) {
        if (r[c] != null) {
          q = Number(r[c]) || 0;
          break;
        }
      }
      return { ...r, qty: q };
    })
    .filter((r) => (r.qty ?? 0) > 0);
}

async function deleteItem(orderId, productId) {
  const { error } = await supabase.from("order_items").delete().eq("order_id", orderId).eq("product_id", productId);
  if (error) throw error;
}

function monthKey(iso) {
  const safe = (iso || "").slice(0, 10);
  if (!safe.includes("-")) return { key: "?", label: "Autre" };
  const [y, m] = safe.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, 1);
  const months = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ];
  return { key: `${y}-${pad2(m || 1)}`, label: `${months[dt.getMonth()]} ${y}` };
}

function groupHistoryByMonth(rows) {
  const groups = new Map();
  for (const r of rows) {
    const iso = (r._date || "").slice(0, 10);
    const mk = monthKey(iso);
    if (!groups.has(mk.key)) groups.set(mk.key, { key: mk.key, label: mk.label, rows: [] });
    groups.get(mk.key).rows.push(r);
  }
  const arr = Array.from(groups.values());
  return arr;
}

function useMounted() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

/* -------------------- Error Boundary (no more white screen) -------------------- */
class PageBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, message: (err?.message || "Erreur inconnue").toString() };
  }
  componentDidCatch(err) {
    // eslint-disable-next-line no-console
    console.error("Bécus page crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.page}>
          <div style={styles.container}>
            <div style={styles.card}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Erreur sur la page Bécus</div>
              <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 800 }}>{this.state.message}</div>
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href={`/suppliers/becus?v=${Date.now()}`} style={styles.pillBtn}>
                  🔄 Recharger
                </a>
                <a href={`/suppliers/becus/order?v=${Date.now()}`} style={{ ...styles.pillBtn, background: "#fff7ed" }}>
                  🧡 Ouvrir Produits Bécus
                </a>
                <a href="/" style={styles.pillBtn}>
                  ← Accueil
                </a>
              </div>
              <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 700 }}>
                Astuce (tablette/PWA) : si tu vois encore l&apos;ancienne version, vide le cache du site ou supprime les données
                du site puis relance.
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* -------------------- Page -------------------- */
function BecusHome() {
  const router = useRouter();
  const mounted = useMounted();

  const [deliveryISO, setDeliveryISO] = useState("");
  useEffect(() => {
    if (!mounted) return;
    setDeliveryISO(getBecusDeliveryISO(new Date()));
  }, [mounted]);

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
    if (!deliveryISO) return;
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
      if (prevISO) {
        const po = await findOrderByDate(prevISO);
        setPrevOrder(po);
        if (po?.id) {
          const pits = await listItemsForOrder(po.id);
          setPrevItems(pits);
        } else {
          setPrevItems([]);
        }
      } else {
        setPrevOrder(null);
        setPrevItems([]);
      }

      // History list
      const hist = await listOrdersForHistory(120);
      const cleaned = (hist || [])
        .map((r) => {
          const date =
            r.delivery_date ||
            r.delivery_day ||
            r.date ||
            r.day ||
            r.created_at?.slice?.(0, 10) ||
            "";
          return { ...r, _date: date };
        })
        .filter((r) => r._date);
      setHistory(cleaned);
    } catch (e) {
      setErrorText((e?.message || "Erreur de chargement.").toString());
    } finally {
      setLoading(false);
    }
  }, [deliveryISO, prevISO]);

  useEffect(() => {
    if (!mounted) return;
    if (!deliveryISO) return;
    loadAll();
  }, [mounted, deliveryISO, loadAll]);

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
    const prevMap = {};
    for (const it of prevItems) prevMap[it.product_id] = it.qty ?? it.quantity ?? 0;
    const curMap = {};
    for (const it of items) curMap[it.product_id] = it.qty ?? it.quantity ?? 0;

    const allIds = new Set([...Object.keys(prevMap), ...Object.keys(curMap)]);
    const rows = [];
    for (const pid of allIds) {
      const p = productById[pid] || null;
      const dept = normDept(p?.dept);
      const prev = Number(prevMap[pid] || 0);
      const cur = Number(curMap[pid] || 0);
      if (prev === 0 && cur === 0) continue;
      rows.push({ product_id: pid, p, dept, prev, cur, delta: cur - prev });
    }
    rows.sort((a, b) => productName(a.p).localeCompare(productName(b.p), "fr"));
    return rows;
  }, [prevItems, items, productById]);

  const groupedHistory = useMemo(() => {
    const rows = (history || [])
      .map((r) => ({ ...r, _date: (r._date || "").slice(0, 10) }))
      .filter((r) => r._date);
    return groupHistoryByMonth(rows);
  }, [history]);

  const openCatalogue = useCallback(() => {
    router.push(`/suppliers/becus/order?date=${encodeURIComponent(deliveryISO || "")}`);
  }, [router, deliveryISO]);

  const openHistory = useCallback(
    (iso) => {
      router.push(`/suppliers/becus/history?date=${encodeURIComponent((iso || "").slice(0, 10))}`);
    },
    [router]
  );

  const canSendWhatsApp = useMemo(() => {
    const phone = (wa?.phone || "").toString().trim();
    return items.length > 0 && !!phone;
  }, [items.length, wa?.phone]);

  const sendWhatsApp = useCallback(async () => {
    setErrorText("");
    try {
      if (!canSendWhatsApp) {
        if (!items.length) {
          setErrorText("Ajoute au moins 1 produit avant d’envoyer.");
          return;
        }
        setErrorText("Numéro WhatsApp manquant (table suppliers / supplier_contacts).");
        return;
      }
      const phone = (wa.phone || "").replace(/[^\d+]/g, "");
      const text = buildWhatsAppText({
        deliveryISO,
        items,
        productById,
      });
      const url = `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErrorText((e?.message || "Envoi WhatsApp impossible.").toString());
    }
  }, [wa, deliveryISO, items, productById, canSendWhatsApp]);

  const removeItem = useCallback(
    async (productId) => {
      if (!order?.id) return;
      setErrorText("");
      try {
        await deleteItem(order.id, productId);
        // reload items only (fast)
        const its = await listItemsForOrder(order.id);
        setItems(its);
      } catch (e) {
        setErrorText((e?.message || "Suppression impossible.").toString());
      }
    },
    [order?.id]
  );

  if (!mounted) return null;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Top header */}
        <div style={styles.topRow}>
          <div style={styles.leftTitle}>
            <Link href="/" style={styles.pillLink}>
              ← Accueil
            </Link>
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.h1}>🥖 Bécus</h1>
              <div style={styles.sub}>Livraison : {fmtFRSlash(deliveryISO)}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={openCatalogue} style={{ ...styles.pillBtn, ...styles.pillBtnPrimary }}>
              📦 Produits Bécus
            </button>
          </div>
        </div>

        {/* Status banner */}
        <div style={styles.banner}>
          <strong style={{ fontSize: 16 }}>Statut</strong>
          <span style={styles.badge}>✅ Ouvert jusqu&apos;au mercredi 12:00</span>
          {loading ? <span style={styles.smallMeta}>Chargement…</span> : null}
          {errorText ? <span style={{ ...styles.smallMeta, color: "#b91c1c" }}>{errorText}</span> : null}
        </div>

        {/* 1) Commande en cours */}
        <div style={styles.card}>
          <div style={styles.cardTitleRow}>
            {/* left */}
            <button onClick={openCatalogue} style={{ ...styles.pillBtn, background: "#fff7ed", borderColor: "#fdba74" }}>
              ➕ Ajouter Produits
            </button>

            {/* center */}
            <div style={styles.centerTitle}>
              <div style={styles.cardTitleCentered}>Commande en cours</div>
              <div style={styles.centerDate}>{fmtFRDash(deliveryISO)}</div>
            </div>

            {/* right */}
            <button
              onClick={sendWhatsApp}
              disabled={!canSendWhatsApp}
              style={{
                ...styles.pillBtn,
                background: canSendWhatsApp ? "#16a34a" : "#e5e7eb",
                borderColor: canSendWhatsApp ? "#16a34a" : "#e5e7eb",
                color: canSendWhatsApp ? "#fff" : "#6b7280",
              }}
              title={!items.length ? "Ajoute au moins 1 produit pour activer l’envoi." : ""}
            >
              💬 Envoyer WhatsApp
            </button>
          </div>

          <div style={styles.familyGrid} className="_becus_familygrid">
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
                          <div style={styles.itemName}>{productName(p)}</div>
                          <div style={styles.itemQty}>x{it.qty ?? it.quantity ?? 0}</div>
                          <button
                            onClick={() => removeItem(it.product_id)}
                            style={styles.removeBtn}
                            title="Retirer"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>

          <div style={styles.hint}>Astuce : tu peux retirer un produit ici avec ✕, sans ouvrir “Ajouter Produits”.</div>
        </div>

        {/* 2) Semaine dernière */}
        <div style={styles.card}>
          <div>
            <h2 style={styles.cardTitle}>Semaine dernière</h2>
            <div style={styles.cardDate}>{fmtFRSlash(prevISO)}</div>
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

              <div style={styles.hint}>(Comparaison automatique : S-1 vs cette semaine.)</div>
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
              <div key={g.key} style={{ marginTop: 12 }}>
                <div style={styles.historyMonth}>{g.label}</div>
                {g.rows.map((r) => {
                  const iso = (r._date || "").slice(0, 10);
                  const status = (r.status || r.state || r.phase || "").toString() || "draft";
                  return (
                    <div key={r.id || iso} style={styles.historyRow}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{fmtFRSlash(iso)}</div>
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
}

export default function BecusHomePage() {
  return (
    <PageBoundary>
      <BecusHome />
    </PageBoundary>
  );
}

/* -------------------- Styles -------------------- */
const styles = {
  page: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#111827",
    background: "linear-gradient(180deg, #f0f9ff 0%, #ffffff 32%, #ffffff 100%)",
    minHeight: "100vh",
    paddingBottom: 32,
  },
  container: { width: "min(1400px, calc(100vw - 32px))", margin: "18px auto 0" },

  topRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    flexWrap: "wrap",
  },
  leftTitle: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  h1: { fontSize: 26, fontWeight: 900, margin: 0, lineHeight: 1.1 },
  sub: { fontSize: 14, color: "#475569", fontWeight: 800, marginTop: 2 },

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
    fontWeight: 900,
    boxShadow: "0 8px 20px rgba(17,24,39,.06)",
    whiteSpace: "nowrap",
  },
  pillBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111827",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(17,24,39,.06)",
    whiteSpace: "nowrap",
  },
  pillBtnPrimary: { background: "#0ea5e9", borderColor: "#0ea5e9", color: "#fff" },

  banner: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    padding: "12px 14px",
    background: "#ffffff",
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    boxShadow: "0 10px 30px rgba(17,24,39,.06)",
    marginBottom: 14,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#dcfce7",
    color: "#166534",
    fontWeight: 900,
    border: "1px solid #bbf7d0",
  },
  smallMeta: { fontSize: 12, color: "#6b7280", fontWeight: 800 },

  card: {
    background: "#fff",
    borderRadius: 22,
    border: "1px solid #e5e7eb",
    boxShadow: "0 12px 38px rgba(17,24,39,.06)",
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 18, margin: 0, fontWeight: 950 },
  cardDate: { fontSize: 13, color: "#6b7280", fontWeight: 900, marginTop: 2 },

  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  centerTitle: { display: "flex", alignItems: "center", gap: 10, justifyContent: "center", flex: 1, minWidth: 260 },
  cardTitleCentered: { fontSize: 18, fontWeight: 950, textAlign: "center" },
  centerDate: { fontSize: 13, color: "#64748b", fontWeight: 950, textAlign: "center" },

  familyGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 10 },
  familyBox: { border: "1px solid #eef2f7", borderRadius: 18, padding: 10, background: "#f8fafc" },
  familyTitle: { fontSize: 14, fontWeight: 950, marginBottom: 8, color: "#0f172a" },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "40px 1fr auto 30px",
    gap: 10,
    alignItems: "center",
    padding: "8px 8px",
    borderRadius: 14,
    background: "#fff",
    border: "1px solid #eef2f7",
    marginBottom: 8,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    background: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  itemName: { fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemQty: { fontWeight: 950, color: "#0f172a" },
  removeBtn: {
    border: "1px solid #fee2e2",
    background: "#fff1f2",
    color: "#b91c1c",
    borderRadius: 10,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontWeight: 950,
  },

  hint: { marginTop: 8, fontSize: 12, color: "#64748b", fontWeight: 900 },

  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, marginTop: 10, overflow: "hidden" },
  th: { textAlign: "left", fontWeight: 950, padding: "10px 10px", borderBottom: "1px solid #e5e7eb", color: "#334155" },
  td: { padding: "10px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 800, color: "#0f172a" },
  deltaPos: { color: "#166534", fontWeight: 950 },
  deltaNeg: { color: "#b91c1c", fontWeight: 950 },

  historyMonth: { fontWeight: 950, color: "#334155", marginBottom: 6 },
  historyRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 16,
    border: "1px solid #eef2f7",
    background: "#f8fafc",
    marginBottom: 8,
  },
  statusPill: {
    display: "inline-flex",
    marginTop: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontWeight: 900,
    color: "#475569",
    fontSize: 12,
  },
};
