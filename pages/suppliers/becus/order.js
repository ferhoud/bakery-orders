// pages/suppliers/becus/order.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const SUPPLIER_NAME = "Bécus";
const QTY_MAX = 20;
const UI_TAG = "v-becus-ui-2026-02-08-3";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function isoToFR(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function getBecusDeliveryISO(now = new Date()) {
  const n = new Date(now);
  const day = n.getDay();
  const base = new Date(n);
  base.setHours(0, 0, 0, 0);
  const daysUntilThu = (4 - day + 7) % 7;
  base.setDate(base.getDate() + daysUntilThu);
  if (day === 4 && n.getHours() >= 8) base.setDate(base.getDate() + 7);
  return toISODate(base);
}
function getCutoffForDeliveryISO(deliveryISO) {
  const d = new Date(deliveryISO + "T00:00:00");
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
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

async function getOrCreateOrder(deliveryISO) {
  const r = await supabase
    .from("orders")
    .select("*")
    .eq("supplier_key", SUPPLIER_KEY)
    .eq("delivery_date", deliveryISO)
    .maybeSingle();
  if (!r.error && r.data) return r.data;

  const ins = await supabase
    .from("orders")
    .insert({ supplier_key: SUPPLIER_KEY, delivery_date: deliveryISO, status: "draft" })
    .select("*")
    .maybeSingle();
  if (ins.error) throw ins.error;
  return ins.data;
}

async function loadItemsMap(orderId) {
  const r = await supabase.from("order_items").select("*").eq("order_id", orderId).limit(5000);
  if (r.error) throw r.error;
  const map = {};
  for (const it of r.data || []) {
    const pid = String(it.product_id ?? it.productId ?? "");
    const qty = Number(it.qty ?? it.quantity ?? 0);
    if (pid && Number.isFinite(qty) && qty > 0) map[pid] = qty;
  }
  return map;
}

async function setItemQty(orderId, productId, qty) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q < 0) return;

  if (q <= 0) {
    const del = await supabase.from("order_items").delete().eq("order_id", orderId).eq("product_id", productId);
    if (!del.error) return;
    await supabase.from("order_items").delete().eq("order_id", orderId).eq("productId", productId);
    return;
  }

  const payload = { order_id: orderId, product_id: productId, qty: q };
  const up = await supabase.from("order_items").upsert(payload, { onConflict: "order_id,product_id" });
  if (!up.error) return;

  await supabase.from("order_items").delete().eq("order_id", orderId).eq("product_id", productId);
  const ins = await supabase.from("order_items").insert(payload);
  if (ins.error) throw ins.error;
}

export default function BecusOrderPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const dateParam = useMemo(() => (router.query?.date || "").toString(), [router.query]);
  const deliveryISO = useMemo(() => {
    if (dateParam) return dateParam;
    if (!mounted) return "";
    return getBecusDeliveryISO(now);
  }, [dateParam, mounted, now]);

  const cutoff = useMemo(() => (deliveryISO ? getCutoffForDeliveryISO(deliveryISO) : null), [deliveryISO]);
  const isBeforeCutoff = useMemo(() => {
    if (!cutoff) return true;
    return now.getTime() <= cutoff.getTime();
  }, [now, cutoff]);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  const orderStatus = useMemo(() => (order?.status || "draft").toString(), [order]);
  const canEdit = useMemo(() => {
    if (orderStatus === "archived") return false;
    return !!isBeforeCutoff;
  }, [orderStatus, isBeforeCutoff]);

  const load = useCallback(async () => {
    if (!deliveryISO) return;
    setLoading(true);
    setErrorText("");
    try {
      const { data: prodData, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .order("dept", { ascending: true })
        .limit(5000);
      if (prodErr) throw prodErr;
      setProducts(prodData || []);

      const o = await getOrCreateOrder(deliveryISO);
      setOrder(o);

      const map = await loadItemsMap(o.id);
      setSelected(map);
    } catch (e) {
      setErrorText((e?.message || "Erreur de chargement.").toString());
    } finally {
      setLoading(false);
    }
  }, [deliveryISO]);

  useEffect(() => {
    if (!mounted) return;
    if (!router.isReady) return;
    if (!deliveryISO) return;
    load();
  }, [mounted, router.isReady, deliveryISO, load]);

  const [q, setQ] = useState("");
  const filteredProducts = useMemo(() => {
    const qq = (q || "").toLowerCase().trim();
    if (!qq) return products || [];
    return (products || []).filter((p) => productName(p).toLowerCase().includes(qq));
  }, [q, products]);

  const deptTabs = useMemo(() => ["vente", "boulanger", "patiss"], []);
  const [dept, setDept] = useState("vente");

  const visibleProducts = useMemo(() => {
    return filteredProducts.filter((p) => normDept(p.dept) === dept);
  }, [filteredProducts, dept]);

  const toggleChecked = useCallback(
    async (pid) => {
      if (!order?.id) return;
      if (!canEdit) return;

      const id = String(pid);
      const cur = Number(selected?.[id] ?? 0);
      const next = cur > 0 ? 0 : 1;

      setSelected((prev) => ({ ...prev, [id]: next }));
      setSaving(true);
      try {
        await setItemQty(order.id, id, next);
      } catch (e) {
        setErrorText((e?.message || "Erreur de sauvegarde").toString());
      } finally {
        setSaving(false);
      }
    },
    [order?.id, canEdit, selected]
  );

  const incQty = useCallback(
    async (pid) => {
      if (!order?.id) return;
      if (!canEdit) return;

      const id = String(pid);
      const cur = Number(selected?.[id] ?? 0);
      const next = Math.min(QTY_MAX, cur + 1);

      setSelected((prev) => ({ ...prev, [id]: next }));
      setSaving(true);
      try {
        await setItemQty(order.id, id, next);
      } catch (e) {
        setErrorText((e?.message || "Erreur de sauvegarde").toString());
      } finally {
        setSaving(false);
      }
    },
    [order?.id, canEdit, selected]
  );

  const decQty = useCallback(
    async (pid) => {
      if (!order?.id) return;
      if (!canEdit) return;

      const id = String(pid);
      const cur = Number(selected?.[id] ?? 0);
      const next = Math.max(0, cur - 1);

      setSelected((prev) => ({ ...prev, [id]: next }));
      setSaving(true);
      try {
        await setItemQty(order.id, id, next);
      } catch (e) {
        setErrorText((e?.message || "Erreur de sauvegarde").toString());
      } finally {
        setSaving(false);
      }
    },
    [order?.id, canEdit, selected]
  );

  if (!mounted) return null;

  const cutoffText = cutoff
    ? `${pad2(cutoff.getDate())}/${pad2(cutoff.getMonth() + 1)}/${cutoff.getFullYear()} ${pad2(
        cutoff.getHours()
      )}:${pad2(cutoff.getMinutes())}`
    : "";

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.topbar}>
          <Link href={`/suppliers/${SUPPLIER_KEY}`} style={styles.pillLink}>
            ← Retour
          </Link>

          <div style={{ minWidth: 0 }}>
            <div style={styles.h1}>Produits {SUPPLIER_NAME}</div>
            <div style={styles.h2}>
              Livraison : <strong>{deliveryISO ? isoToFR(deliveryISO) : "—"}</strong>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <span
            style={{
              ...styles.pill,
              background: canEdit ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              borderColor: canEdit ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)",
            }}
          >
            {canEdit ? "✅ Ouvert" : "⛔ Fermé"}
          </span>
          <span style={styles.mini}>Cutoff : {cutoffText}</span>
        </div>

        {errorText ? <div style={styles.err}>{errorText}</div> : null}
        {loading ? <div style={styles.mini}>Chargement…</div> : null}

        <div style={styles.filters}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit…" style={styles.search} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {deptTabs.map((k) => (
              <button
                key={k}
                onClick={() => setDept(k)}
                style={{
                  ...styles.tab,
                  background: dept === k ? "#0ea5e9" : "#fff",
                  color: dept === k ? "#fff" : "#0f172a",
                }}
              >
                {deptLabel(k)}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={styles.mini}>{saving ? "Sauvegarde…" : "Coche, puis ajuste avec + / −"}</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {visibleProducts.map((p) => {
            const pid = String(p.id);
            const qty = Number(selected?.[pid] ?? 0);
            const checked = qty > 0;

            return (
              <div
                key={pid}
                style={{
                  ...styles.row,
                  cursor: canEdit ? "pointer" : "not-allowed",
                  opacity: canEdit ? 1 : 0.75,
                  background: checked ? "rgba(34,197,94,0.10)" : "rgba(15,23,42,0.03)",
                  borderColor: checked ? "rgba(34,197,94,0.35)" : "rgba(15,23,42,0.08)",
                }}
                onClick={() => {
                  if (canEdit) toggleChecked(pid);
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                  <span style={{ width: 22, textAlign: "center" }}>{productEmoji(p) || "📦"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.pName}>{productName(p)}</div>
                    <div style={styles.mini}>{deptLabel(p.dept)}</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEdit}
                    onChange={() => toggleChecked(pid)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  <button
                    style={styles.qtyBtn}
                    disabled={!checked || !canEdit}
                    onClick={(e) => {
                      e.stopPropagation();
                      decQty(pid);
                    }}
                  >
                    −
                  </button>

                  <div style={{ minWidth: 34, textAlign: "center", fontWeight: 800 }}>{checked ? qty : ""}</div>

                  <button
                    style={styles.qtyBtn}
                    disabled={!checked || !canEdit}
                    onClick={(e) => {
                      e.stopPropagation();
                      incQty(pid);
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, ...styles.mini }}>UI: {UI_TAG}</div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f8fafc, #ffffff)",
    padding: 14,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
    color: "#0f172a",
  },
  container: { maxWidth: 980, margin: "0 auto" },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
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
    fontWeight: 650,
    color: "#0f172a",
  },
  h1: { fontSize: 18, fontWeight: 800 },
  h2: { fontSize: 12, fontWeight: 650, opacity: 0.65 },
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(34,197,94,0.25)",
    fontWeight: 650,
    fontSize: 12,
  },
  mini: { fontSize: 12, fontWeight: 600, opacity: 0.7 },
  err: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(239,68,68,0.25)",
    background: "rgba(239,68,68,0.08)",
    color: "#991B1B",
    fontWeight: 700,
  },
  filters: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12 },
  search: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    minWidth: 260,
    fontWeight: 650,
    outline: "none",
  },
  tab: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    fontWeight: 650,
    cursor: "pointer",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
  },
  pName: { fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
};
