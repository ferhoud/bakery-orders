// pages/suppliers/becus/history.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const SUPPLIER_LABEL = "Bécus";

// ---------- Helpers ----------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function isoToFR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function isoToDDMMYYYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
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
  return (p?.emoji || p?.icon || "").toString();
}
function productPrice(p) {
  const keys = ["price", "unit_price", "unitPrice", "tarif", "prix", "cost", "amount"];
  for (const k of keys) {
    const v = p?.[k];
    if (v == null) continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function fmtEUR(n) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  } catch {
    return `${Number(n || 0).toFixed(2)} €`;
  }
}

export default function BecusHistoryPage() {
  const router = useRouter();
  const dateISO = (router.query?.date || "").toString();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const [productsById, setProductsById] = useState({});
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      if (!dateISO) {
        setItems([]);
        setOrder(null);
        setLoading(false);
        return;
      }

      const { data: prods, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY);
      if (prodErr) throw prodErr;

      const map = {};
      for (const p of prods || []) map[String(p.id)] = p;
      setProductsById(map);

      const { data: o, error: oErr } = await supabase
        .from("orders")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .eq("delivery_date", dateISO)
        .maybeSingle();
      if (oErr) throw oErr;

      setOrder(o || null);

      if (!o?.id) {
        setItems([]);
        setLoading(false);
        return;
      }

      const { data: its, error: itErr } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", o.id)
        .limit(5000);
      if (itErr) throw itErr;

      const cleaned = [];
      for (const it of its || []) {
        const pid = String(it.product_id ?? "");
        const qty = Number(it.qty ?? 0);
        if (pid && Number.isFinite(qty) && qty > 0) cleaned.push({ product_id: pid, qty });
      }
      setItems(cleaned);
    } catch (e) {
      setErrorText((e?.message || "Erreur de chargement.").toString());
    } finally {
      setLoading(false);
    }
  }, [dateISO]);

  useEffect(() => {
    if (!router.isReady) return;
    load();
  }, [router.isReady, load]);

  const rows = useMemo(() => {
    const out = (items || []).map((it) => {
      const p = productsById[it.product_id] || null;
      const pr = productPrice(p);
      const qty = Number(it.qty || 0);
      const lineTotal = pr == null ? null : pr * qty;
      return {
        dept: deptLabel(p?.dept),
        name: productName(p),
        emoji: productEmoji(p),
        qty,
        price: pr,
        lineTotal,
      };
    });
    out.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));
    return out;
  }, [items, productsById]);

  const totalInfo = useMemo(() => {
    let sum = 0;
    let missingPrices = 0;
    for (const r of rows) {
      if (r.price == null) missingPrices++;
      else sum += (r.lineTotal || 0);
    }
    return { sum, missingPrices };
  }, [rows]);

  const exportCSV = useCallback(() => {
    const safe = (x) => (x ?? "").toString().replaceAll('"', '""');
    const lines = [];
    lines.push(["Famille", "Produit", "Quantité", "Prix", "Total"].join(";"));
    for (const r of rows) {
      lines.push([
        safe(r.dept),
        safe(`${r.emoji ? r.emoji + " " : ""}${r.name}`),
        String(r.qty),
        r.price == null ? "" : String(r.price),
        r.lineTotal == null ? "" : String(r.lineTotal),
      ].join(";"));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `becus_${dateISO}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [rows, dateISO]);

  const printPage = useCallback(() => window.print(), []);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.topbar}>
          <Link href="/suppliers/becus" style={styles.pillLink}>← Retour</Link>
          <div style={{ minWidth: 0 }}>
            <div style={styles.h1}>📄 Lecture commande {SUPPLIER_LABEL}</div>
            <div style={styles.h2}>Livraison : {dateISO ? isoToFR(dateISO) : "—"}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button style={styles.btn} onClick={exportCSV} disabled={!rows.length}>⬇️ Export CSV</button>
            <button style={styles.btn} onClick={printPage}>🖨️ Imprimer</button>
          </div>
        </div>

        <div style={styles.card}>
          {loading ? <div style={styles.mini}>Chargement…</div> : null}
          {errorText ? <div style={{ ...styles.mini, color: "#b91c1c" }}>{errorText}</div> : null}
          {!dateISO ? <div style={styles.mini}>Date manquante.</div> : null}
          {dateISO && !loading && !order?.id ? (
            <div style={styles.mini}>Aucune commande trouvée pour cette date.</div>
          ) : null}

          {rows.length ? (
            <>
              <div style={styles.totalBox}>
                <div style={{ fontWeight: 950 }}>
                  Total estimé : {fmtEUR(totalInfo.sum)}
                </div>
                {totalInfo.missingPrices ? (
                  <div style={styles.mini}>Prix manquants : {totalInfo.missingPrices}</div>
                ) : null}
              </div>

              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Famille</th>
                    <th style={styles.th}>Produit</th>
                    <th style={styles.th}>Quantité</th>
                    <th style={styles.th}>Prix</th>
                    <th style={styles.th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx}>
                      <td style={styles.td}>{r.dept}</td>
                      <td style={styles.td}>{r.emoji ? `${r.emoji} ` : ""}{r.name}</td>
                      <td style={styles.td}>{r.qty}</td>
                      <td style={styles.td}>{r.price == null ? "" : fmtEUR(r.price)}</td>
                      <td style={styles.td}>{r.lineTotal == null ? "" : fmtEUR(r.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                Astuce export: ajoute les prix progressivement dans la table products, et le total se calculera automatiquement.
              </div>
            </>
          ) : null}
        </div>

        <div style={{ textAlign: "center", marginTop: 12, fontSize: 11, opacity: 0.6 }}>
          “Commande Pour BM Boulangerie Livraison {isoToDDMMYYYY(dateISO)}” (format WhatsApp géré sur la page Bécus).
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f8fafc, #ffffff)",
    padding: 14,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0f172a",
  },
  container: { maxWidth: 980, margin: "0 auto" },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.9)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
    position: "sticky",
    top: 10,
    backdropFilter: "blur(10px)",
    zIndex: 5,
  },
  pillLink: {
    textDecoration: "none",
    padding: "9px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 950,
    color: "#0f172a",
  },
  h1: { fontSize: 18, fontWeight: 950 },
  h2: { fontSize: 12, fontWeight: 900, opacity: 0.65 },
  btn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  },
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
  },
  totalBox: {
    marginTop: 8,
    marginBottom: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(34,197,94,0.08)",
  },
  mini: { fontSize: 12, fontWeight: 850, opacity: 0.7 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
  },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    background: "rgba(15,23,42,0.04)",
    borderBottom: "1px solid rgba(15,23,42,0.10)",
    fontWeight: 950,
    fontSize: 12,
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(15,23,42,0.08)",
    fontWeight: 850,
    fontSize: 13,
  },
};
