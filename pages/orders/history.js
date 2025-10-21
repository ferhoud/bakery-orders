// pages/orders/history.js
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

/* ---------- Helpers ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
function formatHumanDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function ymKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function groupByYearMonth(rows = []) {
  const byYM = {};
  for (const r of rows) {
    const key = ymKey(r.delivery_date);
    if (!byYM[key]) byYM[key] = [];
    byYM[key].push(r);
  }
  // tri descendant à l’intérieur de chaque mois
  for (const k of Object.keys(byYM)) {
    byYM[k].sort((a, b) => new Date(b.delivery_date) - new Date(a.delivery_date));
  }
  // tri des mois (desc)
  const keys = Object.keys(byYM).sort((a, b) => b.localeCompare(a));
  return { keys, byYM };
}
function frToE164Path(n) {
  let d = (n || "").replace(/\D+/g, "");
  if (/^0\d{9}$/.test(d)) d = "33" + d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}
function buildWhatsHeader(supplierLabel, deliveryISO) {
  return `Commande pour BM Boulangerie Rambouillet, pour '${formatHumanDate(deliveryISO)}', envoyé a '${supplierLabel}'`;
}
function buildWhatsBody(items = []) {
  const lines = items.map((it) => `• ${it.qty} × ${it.product_name}`);
  const footer = "merci de confirmer la reception (obligatoire)";
  return ["" /* ligne vide après l’en-tête */, ...lines, "", footer].join("\n");
}

/* ---------- Styles simples ---------- */
const PAGE = { maxWidth: 1100, margin: "0 auto", padding: 16 };
const CARD = { background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 14 };
const BTN = (bg = "#111") => ({ background: bg, color: "#fff", border: "none", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 800 });
const SMALL = { fontSize: 12, color: "#64748b" };

export default function OrdersHistory() {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState({}); // { key: {label, phone} }
  const [open, setOpen] = useState({});           // { orderId: bool }
  const [cache, setCache] = useState({});         // { orderId: { items, text } }

  // Suppliers (pour label/phone)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("suppliers").select("key,label,name,whatsapp_phone,phone");
      const map = {};
      for (const r of data || []) {
        const label = r.label || r.name || r.key;
        const phone = r.whatsapp_phone || r.phone || "";
        map[r.key] = { label, phone };
      }
      setSuppliers(map);
    })();
  }, []);

  // Ordres envoyés uniquement
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, supplier_key, supplier, delivery_date, status, created_at")
        .eq("status", "sent")
        .order("delivery_date", { ascending: false })
        .limit(2000);
      if (!error) setOrders(data || []);
    })();
  }, []);

  const { keys, byYM } = useMemo(() => groupByYearMonth(orders), [orders]);

  async function ensurePreview(o) {
    if (cache[o.id]) return cache[o.id];
    const { data: items } = await supabase
      .from("order_items")
      .select("product_name, qty")
      .eq("order_id", o.id)
      .order("product_name", { ascending: true });
    const label = suppliers[o.supplier_key]?.label || o.supplier || o.supplier_key;
    const header = buildWhatsHeader(label, o.delivery_date);
    const text = [header, buildWhatsBody(items || [])].join("\n");
    const entry = { items: items || [], text, label };
    setCache((c) => ({ ...c, [o.id]: entry }));
    return entry;
  }

  async function toggle(o) {
    if (!open[o.id]) await ensurePreview(o);
    setOpen((v) => ({ ...v, [o.id]: !v[o.id] }));
  }

  function openWhatsApp(o) {
    const entry = cache[o.id];
    const phone = suppliers[o.supplier_key]?.phone || "";
    const digits = frToE164Path(phone);
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(entry?.text || "")}`
      : `whatsapp://send?text=${encodeURIComponent(entry?.text || "")}`;
    if (typeof window !== "undefined") window.location.href = url;
  }

  async function copyText(o) {
    try {
      const t = cache[o.id]?.text || "";
      await navigator.clipboard?.writeText(t);
      alert("Message copié ✅");
    } catch {
      alert("Impossible de copier — sélectionne le texte manuellement.");
    }
  }

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Link href="/"><button style={BTN("#6b7280")}>← Accueil</button></Link>
        <h2 style={{ margin: 0 }}>Historique des commandes (lecture seule)</h2>
      </div>

      {keys.length === 0 && <div style={SMALL}>Aucune commande envoyée pour l’instant.</div>}

      <div style={{ display: "grid", gap: 14 }}>
        {keys.map((ym) => {
          const [year, month] = ym.split("-");
          const mois = new Date(`${ym}-01`).toLocaleDateString("fr-FR", { month: "long" });
          const list = byYM[ym] || [];
          return (
            <div key={ym} style={CARD}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>
                {mois} {year} — {list.length} commande{list.length > 1 ? "s" : ""}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {list.map((o) => {
                  const label = suppliers[o.supplier_key]?.label || o.supplier || o.supplier_key;
                  return (
                    <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800 }}>{label}</div>
                        <div style={SMALL}>Livraison {formatHumanDate(o.delivery_date)}</div>
                        <span style={{ marginLeft: "auto", ...SMALL, fontWeight: 800, color: "#059669" }}>envoyée</span>
                      </div>

                      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button style={BTN("#111")} onClick={() => toggle(o)}>
                          {open[o.id] ? "Masquer l’aperçu" : "📄 Aperçu du message"}
                        </button>
                        {open[o.id] && (
                          <>
                            <button style={BTN("#0d6efd")} onClick={() => copyText(o)}>Copier le message</button>
                            {suppliers[o.supplier_key]?.phone && (
                              <button style={BTN("#25D366")} onClick={() => openWhatsApp(o)}>Ouvrir WhatsApp</button>
                            )}
                          </>
                        )}
                      </div>

                      {open[o.id] && (
                        <pre
                          style={{
                            marginTop: 10,
                            whiteSpace: "pre-wrap",
                            background: "#f8fafc",
                            border: "1px solid #e5e7eb",
                            borderRadius: 8,
                            padding: 12,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          }}
                        >
{cache[o.id]?.text}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
