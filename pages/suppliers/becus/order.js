// pages/suppliers/becus/order.js
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

/**
 * BECUS ORDER — RESTORED CLEAN LAYOUT (NO 3 family columns)
 * - Catalogue: public.products (supplier_key='becus') grouped/filtered by dept
 * - Order: public.orders + public.order_items (NO orders.content/selected/etc)
 * - UI: left catalogue (single list) + right summary (by family)
 */

const SUPPLIER = { key: "becus", label: "Bécus", icon: "🥖" };

const ORDER_TABLE = "orders";
const ITEMS_TABLE = "order_items";
const PRODUCTS_TABLE = "products";

const FAMILY_TABS = ["TOUS", "Vente", "Boulanger", "Pâtissier"];
const QTY_MAX = 20;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  return `${dd.getFullYear()}-${pad2(dd.getMonth() + 1)}-${pad2(dd.getDate())}`;
}
function frDate(iso) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
function getBecusDeliveryISO(now) {
  // Delivery day = Thursday.
  // Switch to next delivery after Thursday 08:00 (so after delivery we prepare next week).
  const n = new Date(now);
  const day = n.getDay(); // 0 Sun ... 4 Thu
  const base = new Date(n);
  base.setHours(0, 0, 0, 0);

  const daysUntilThu = (4 - day + 7) % 7;
  base.setDate(base.getDate() + daysUntilThu); // this week's Thu (or today if Thu)

  if (day === 4 && n.getHours() >= 8) {
    base.setDate(base.getDate() + 7);
  }
  return toISODate(base);
}

function getCutoffForDelivery(deliveryISO) {
  const d = new Date(deliveryISO + "T00:00:00");
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d;
}
function clampQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > QTY_MAX) return QTY_MAX;
  return n;
}
function normDept(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("boul")) return "Boulanger";
  if (s.includes("patis") || s.includes("pât")) return "Pâtissier";
  if (s.includes("vente")) return "Vente";
  return "Vente";
}
function pickName(p) {
  return p?.name ?? p?.label ?? p?.title ?? p?.designation ?? p?.libelle ?? p?.sku ?? p?.id;
}
function pickEmoji(p) {
  return p?.emoji ?? p?.icon ?? "📦";
}
function pickImage(p) {
  const keys = ["photo_url", "image_url", "img_url", "thumbnail_url", "thumb_url", "photo", "image", "picture", "img"];
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function getOrCreateOrder(deliveryISO) {
  const r = await supabase
    .from(ORDER_TABLE)
    .select("*")
    .eq("supplier_key", SUPPLIER.key)
    .eq("delivery_date", deliveryISO)
    .maybeSingle();
  if (!r.error && r.data) return r.data;

  const ins = await supabase
    .from(ORDER_TABLE)
    .insert({ supplier_key: SUPPLIER.key, delivery_date: deliveryISO, status: "draft" })
    .select("*")
    .maybeSingle();
  if (!ins.error && ins.data) return ins.data;

  const rr = await supabase
    .from(ORDER_TABLE)
    .select("*")
    .eq("supplier_key", SUPPLIER.key)
    .eq("delivery_date", deliveryISO)
    .maybeSingle();
  if (!rr.error && rr.data) return rr.data;

  throw new Error(ins.error?.message || r.error?.message || "Impossible de créer/charger la commande");
}

async function loadProducts() {
  const r = await supabase
    .from(PRODUCTS_TABLE)
    .select("*")
    .eq("supplier_key", SUPPLIER.key)
    .order("dept", { ascending: true })
    .order("name", { ascending: true })
    .limit(5000);
  if (r.error) throw r.error;

  const list = [];
  const map = new Map();
  for (const p of r.data || []) {
    const obj = {
      id: String(p.id),
      name: String(pickName(p) || p.id),
      dept: normDept(p.dept),
      emoji: pickEmoji(p),
      image: pickImage(p),
    };
    list.push(obj);
    map.set(obj.id, obj);
  }
  return { list, map };
}

async function loadItems(orderId) {
  const r = await supabase.from(ITEMS_TABLE).select("*").eq("order_id", orderId).limit(5000);
  if (r.error) throw r.error;
  const m = new Map();
  for (const it of r.data || []) {
    const pid = String(it.product_id ?? it.productId ?? it.product_uuid ?? it.product ?? "");
    const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.qte ?? 0);
    if (pid && qty > 0) m.set(pid, qty);
  }
  return m;
}

async function setItemQty(orderId, productId, qty) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q < 0) return;

  if (q <= 0) {
    const del = await supabase.from(ITEMS_TABLE).delete().eq("order_id", orderId).eq("product_id", productId);
    if (!del.error) return;
    await supabase.from(ITEMS_TABLE).delete().eq("order_id", orderId).eq("productId", productId);
    return;
  }

  const payload = { order_id: orderId, product_id: productId, qty: q };
  const up = await supabase.from(ITEMS_TABLE).upsert(payload, { onConflict: "order_id,product_id" });
  if (!up.error) return;

  await supabase.from(ITEMS_TABLE).delete().eq("order_id", orderId).eq("product_id", productId);
  const ins = await supabase.from(ITEMS_TABLE).insert(payload);
  if (ins.error) throw ins.error;
}

function groupSelected(selectedItems) {
  const by = { Vente: [], Boulanger: [], Pâtissier: [] };
  for (const it of selectedItems) {
    if (it.dept === "Boulanger") by.Boulanger.push(it);
    else if (it.dept === "Pâtissier") by.Pâtissier.push(it);
    else by.Vente.push(it);
  }
  return by;
}

export default function BecusOrderPage() {
  const router = useRouter();
  const [now, setNow] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [familyFilter, setFamilyFilter] = useState("TOUS");
  const [search, setSearch] = useState("");

  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [productsMap, setProductsMap] = useState(new Map());
  const [itemsMap, setItemsMap] = useState(new Map());

  const saveTimer = useRef(null);

  useEffect(() => setNow(new Date()), []);

  const deliveryISO = useMemo(() => {
    const q = router.query?.date;
    if (typeof q === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    return now ? getBecusDeliveryISO(now) : null;
  }, [router.query, now]);

  const cutoff = useMemo(() => (deliveryISO ? getCutoffForDelivery(deliveryISO) : null), [deliveryISO]);
  const isBeforeCutoff = useMemo(() => (now && cutoff ? now.getTime() <= cutoff.getTime() : true), [now, cutoff]);

  const orderStatus = useMemo(() => (order?.status || order?.state || "draft").toString(), [order]);

  const canEdit = useMemo(() => {
    if (orderStatus === "archived") return false;
    // Allowed until cutoff (draft or sent). After cutoff => locked.
    return !!isBeforeCutoff;
  }, [orderStatus, isBeforeCutoff]);

  const reload = useCallback(async () => {
    if (!deliveryISO) return;
    setLoading(true);
    setError("");

    try {
      const o = await getOrCreateOrder(deliveryISO);
      setOrder(o);

      const { list, map } = await loadProducts();
      setProducts(list);
      setProductsMap(map);

      const im = await loadItems(o.id);
      setItemsMap(im);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [deliveryISO]);

  useEffect(() => {
    if (!deliveryISO) return;
    reload();
  }, [deliveryISO, reload]);

  const filteredProducts = useMemo(() => {
    let list = products || [];
    if (familyFilter !== "TOUS") {
      list = list.filter((p) => p.dept === familyFilter);
    }
    const s = String(search || "").trim().toLowerCase();
    if (s) {
      list = list.filter((p) => p.name.toLowerCase().includes(s));
    }
    return list;
  }, [products, familyFilter, search]);

  const selectedItems = useMemo(() => {
    const out = [];
    for (const [pid, qty] of itemsMap.entries()) {
      const p = productsMap.get(pid);
      out.push({
        id: pid,
        qty,
        name: p?.name || pid,
        dept: p?.dept || "Vente",
        emoji: p?.emoji || "📦",
        image: p?.image || null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return out;
  }, [itemsMap, productsMap]);

  const grouped = useMemo(() => groupSelected(selectedItems), [selectedItems]);

  const toggleChecked = useCallback(
    (pid) => {
      if (!order?.id) return;
      
      if (!canEdit) return;const cur = itemsMap.get(pid) || 0;
      const next = cur > 0 ? 0 : 1;
      // optimistic
      setItemsMap((prev) => {
        const m = new Map(prev);
        if (next <= 0) m.delete(pid);
        else m.set(pid, next);
        return m;
      });

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await setItemQty(order.id, pid, next);
        } catch (e) {
          setError(String(e?.message || e));
          // refetch
          const im = await loadItems(order.id);
          setItemsMap(im);
        } finally {
          setSaving(false);
        }
      }, 150);
    },
    [order, itemsMap]
  );

  const incQty = useCallback(
    (pid) => {
      if (!order?.id) return;
      
      if (!canEdit) return;const cur = clampQty(itemsMap.get(pid) || 0);
      const next = Math.min(QTY_MAX, Math.max(1, cur + 1));

      setItemsMap((prev) => {
        const m = new Map(prev);
        m.set(pid, next);
        return m;
      });

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await setItemQty(order.id, pid, next);
        } catch (e) {
          setError(String(e?.message || e));
          const im = await loadItems(order.id);
          setItemsMap(im);
        } finally {
          setSaving(false);
        }
      }, 150);
    },
    [order, itemsMap]
  );

  const decQty = useCallback(
    (pid) => {
      if (!order?.id) return;
      
      if (!canEdit) return;const cur = clampQty(itemsMap.get(pid) || 0);
      const next = cur - 1;

      setItemsMap((prev) => {
        const m = new Map(prev);
        if (next <= 0) m.delete(pid);
        else m.set(pid, next);
        return m;
      });

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await setItemQty(order.id, pid, next);
        } catch (e) {
          setError(String(e?.message || e));
          const im = await loadItems(order.id);
          setItemsMap(im);
        } finally {
          setSaving(false);
        }
      }, 150);
    },
    [order, itemsMap]
  );

  const clearAll = useCallback(async () => {
    if (!order?.id) return;
      if (!canEdit) return;
    const ok = confirm("Vider la commande ?");
    if (!ok) return;

    setSaving(true);
    try {
      const del = await supabase.from(ITEMS_TABLE).delete().eq("order_id", order.id);
      if (del.error) throw del.error;
      setItemsMap(new Map());
    } catch (e) {
      setError(String(e?.message || e));
      const im = await loadItems(order.id);
      setItemsMap(im);
    } finally {
      setSaving(false);
    }
  }, [order]);

  if (!now) return <div style={{ padding: 24 }}>Chargement…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: "18px auto", padding: "0 16px 46px" }}>
      <div style={topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Link href={`/suppliers/${SUPPLIER.key}`} style={linkPill}>← Retour</Link>
          <div style={{ fontSize: 22, fontWeight: 900, minWidth: 0 }}>
            {SUPPLIER.icon} {SUPPLIER.label}
            <span style={{ fontSize: 14, fontWeight: 800, color: "rgba(15,23,42,0.55)", marginLeft: 10 }}>
              Livraison : {deliveryISO ? frDate(deliveryISO) : "—"}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={clearAll} style={btnDanger} disabled={saving || !canEdit}>Vider</button>
</div>
      </div>

      <div style={statusBox}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>Statut</div>
          <span style={pill}>{orderStatus === "archived" ? "📦 Archivée" : (isBeforeCutoff ? (orderStatus === "sent" ? "✅ Envoyée (modif possibles)" : "✅ Ouvert (brouillon)") : "⛔ Fermé (cutoff dépassé)")}</span>
          {saving ? <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 800 }}>Sauvegarde…</span> : null}
          <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 800, fontSize: 12 }}>
            Prêt • Cutoff: mercredi 12:00 (J-1)
          </span>
        </div>
      </div>

      {error ? <div style={errBox}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16, alignItems: "start" }}>
        {/* CATALOGUE */}
        <div style={card}>
          <div style={cardHead}>
            <div>
              <div style={cardTitle}>Catalogue</div>
              <div style={subTitle}>Coche à gauche puis ajuste la quantité (tactile friendly)</div>
            </div>
            <div style={{ fontWeight: 900, color: "rgba(15,23,42,0.55)" }}>{products.length} produit(s)</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {FAMILY_TABS.map((f) => {
              const active = familyFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFamilyFilter(f)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: active ? "1px solid rgba(59,130,246,0.45)" : "1px solid rgba(15,23,42,0.10)",
                    background: active ? "rgba(59,130,246,0.12)" : "#fff",
                    fontWeight: 900,
                    cursor: canEdit ? "pointer" : "not-allowed",
                  }}
                >
                  {f === "TOUS" ? "Tous" : f}
                </button>
              );
            })}
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit…"
            style={searchInput}
          />

          {loading ? (
            <div style={muted}>Chargement…</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filteredProducts.map((p) => {
                const qty = clampQty(itemsMap.get(p.id) || 0);
                const checked = qty > 0;

                return (
                  <div
                    key={p.id}
                    onClick={() => { if (canEdit) toggleChecked(p.id); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 12px",
                      borderRadius: 14,
                      background: checked ? "rgba(34,197,94,0.08)" : "rgba(2,6,23,0.02)",
                      border: "1px solid rgba(15,23,42,0.06)",
                      cursor: canEdit ? "pointer" : "not-allowed",
                      userSelect: "none",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <input type="checkbox" checked={checked} readOnly style={{ width: 22, height: 22 }} />
                      {p.image && (p.image.startsWith("http") || p.image.startsWith("data:image")) ? (
                        <img
                          src={p.image}
                          alt=""
                          style={imgStyle}
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span style={{ width: 28, textAlign: "center" }}>{p.emoji}</span>
                      )}
                      <div style={itemName}>{p.name}</div>
                    </div>

                    <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <button disabled={!checked || !canEdit} onClick={() => decQty(p.id)} style={qtyBtnStyle(!checked)}>−</button>
                      <div style={qtyBoxStyle}>{checked ? qty : 0}</div>
                      <button disabled={!checked || !canEdit} onClick={() => incQty(p.id)} style={qtyBtnStyle(!checked)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SUMMARY */}
        <div style={{ ...card, position: "sticky", top: 16, height: "fit-content" }}>
          <div style={cardHead}>
            <div>
              <div style={cardTitle}>Commande en cours</div>
              <div style={subTitle}>{deliveryISO ? frDate(deliveryISO) : ""}</div>
            </div>
            <div style={{ fontWeight: 900, color: "rgba(15,23,42,0.55)" }}>{selectedItems.length} article(s)</div>
          </div>

          {selectedItems.length === 0 ? (
            <div style={muted}>Aucun produit sélectionné.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {["Vente", "Boulanger", "Pâtissier"].map((dept) => {
                const items = grouped[dept] || [];
                if (!items.length) return null;
                return (
                  <div key={dept} style={deptBox}>
                    <div style={deptTitle}>{dept}</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {items.map((it) => (
                        <div key={it.id} style={sumRow}>
                          <div style={{ display: "flex", gap: 8, minWidth: 0, alignItems: "center" }}>
                            {it.image && (it.image.startsWith("http") || it.image.startsWith("data:image")) ? (
                              <img
                                src={it.image}
                                alt=""
                                style={{ ...imgStyle, width: 24, height: 24 }}
                                onError={(e) => (e.currentTarget.style.display = "none")}
                              />
                            ) : (
                              <span>{it.emoji}</span>
                            )}
                            <span style={itemName}>{it.name}</span>
                          </div>
                          <div style={{ fontWeight: 900 }}>x{it.qty}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12, color: "rgba(15,23,42,0.55)", fontSize: 13, fontWeight: 800 }}>
            Astuce: après un envoi, tu peux rajouter des quantités et renvoyer (ça fera les rajouts).
          </div>
        </div>
      </div>
    </div>
  );
}

/* styles */
const topbar = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};
const linkPill = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "#fff",
  fontWeight: 800,
  textDecoration: "none",
  color: "rgba(15,23,42,0.9)",
  boxShadow: "0 6px 18px rgba(15,23,42,0.05)",
};
const statusBox = {
  borderRadius: 18,
  border: "1px solid rgba(34,197,94,0.30)",
  background: "rgba(34,197,94,0.08)",
  padding: 14,
  marginBottom: 16,
};
const pill = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(34,197,94,0.35)",
  background: "rgba(34,197,94,0.12)",
  fontSize: 13,
  fontWeight: 900,
};
const errBox = { marginBottom: 10, color: "rgba(239,68,68,0.95)", fontWeight: 900 };
const card = {
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
  minWidth: 0,
};
const cardHead = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 };
const cardTitle = { fontSize: 18, fontWeight: 900 };
const subTitle = { fontSize: 13, fontWeight: 800, color: "rgba(15,23,42,0.55)" };
const searchInput = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.12)",
  outline: "none",
  marginBottom: 12,
  fontWeight: 800,
};
const itemName = {
  fontWeight: 900,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};
const imgStyle = {
  width: 28,
  height: 28,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid rgba(15,23,42,0.10)",
};
const qtyBtnStyle = (disabled) => ({
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "#fff",
  fontWeight: 900,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});
const qtyBoxStyle = {
  minWidth: 36,
  textAlign: "center",
  fontWeight: 900,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "#fff",
};
const deptBox = { border: "1px solid rgba(15,23,42,0.08)", borderRadius: 14, padding: 12, minWidth: 0 };
const deptTitle = { fontSize: 13, fontWeight: 900, color: "rgba(15,23,42,0.75)", marginBottom: 10 };
const sumRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.06)",
  background: "rgba(2,6,23,0.02)",
  minWidth: 0,
};
const muted = { color: "rgba(15,23,42,0.55)", fontWeight: 800 };
const btnDanger = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(239,68,68,0.25)",
  background: "rgba(239,68,68,0.08)",
  fontWeight: 900,
  cursor: canEdit ? "pointer" : "not-allowed",
};
