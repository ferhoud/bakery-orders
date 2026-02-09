// pages/suppliers/becus/history.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const UI_TAG = "v-becus-history-2026-02-09-readonly-grouped-fix1";

function pad2(n) {
  const s = String(n ?? "");
  return s.length === 1 ? `0${s}` : s;
}

function safeISO(x) {
  const s = (x ?? "").toString();
  // accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function frDate(iso) {
  const s = safeISO(iso);
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

function monthKey(iso) {
  const s = safeISO(iso);
  return s ? s.slice(0, 7) : "????-??";
}

function frMonthLabel(ym) {
  // ym = YYYY-MM
  const [y, m] = (ym || "").split("-");
  const mm = Number(m);
  const names = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  const name = names[mm - 1] || "mois ?";
  return `${name} ${y || ""}`.trim();
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

function productThumb(p) {
  return (
    p?.image_url ||
    p?.photo_url ||
    p?.image ||
    p?.thumbnail ||
    p?.imageUrl ||
    p?.imageURL ||
    p?.picture ||
    p?.pic ||
    p?.url ||
    ""
  ).toString();
}

function ProductIcon({ p, size = 20 }) {
  const [broken, setBroken] = useState(false);
  const url = productThumb(p);

  const box = {
    width: size,
    height: size,
    borderRadius: 7,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    border: url && !broken ? "1px solid rgba(15,23,42,0.12)" : "1px solid rgba(15,23,42,0.06)",
    background: "#fff",
    flex: "0 0 auto",
  };

  if (url && !broken) {
    return (
      <span style={box}>
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  return (
    <span style={box}>
      <span style={{ fontSize: Math.max(12, Math.floor(size * 0.55)), lineHeight: 1 }}>📦</span>
    </span>
  );
}

export default function BecusHistoryPage() {
  const router = useRouter();
  const orderId = typeof router.query.id === "string" ? router.query.id : "";
  const back = `/suppliers/${SUPPLIER_KEY}`;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");

  // detail view
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);

  const productById = useMemo(() => {
    const map = {};
    for (const p of products || []) {
      const keys = [p?.id, p?.uuid, p?.product_id, p?.productId, p?.external_id, p?.externalId];
      for (const k of keys) {
        const s = (k ?? "").toString().trim();
        if (!s) continue;
        map[s] = p;
      }
    }
    return map;
  }, [products]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await supabase
        .from("orders")
        .select("id,supplier_key,delivery_date,status,sent_at,created_at")
        .eq("supplier_key", SUPPLIER_KEY)
        .in("status", ["sent", "archived"])
        .order("delivery_date", { ascending: false })
        .limit(400);

      if (r.error) throw r.error;
      setOrders(r.data || []);
    } catch (e) {
      setErr(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    setLoading(true);
    setErr("");
    try {
      const [or, pr] = await Promise.all([
        supabase.from("orders").select("*").eq("id", id).maybeSingle(),
        supabase.from("products").select("*").eq("supplier_key", SUPPLIER_KEY).limit(5000),
      ]);
      if (or.error) throw or.error;
      if (pr.error) throw pr.error;

      setOrder(or.data || null);
      setProducts(pr.data || []);

      const ir = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: true })
        .limit(5000);

      if (ir.error) throw ir.error;

      const rows = (ir.data || []).map((it) => ({
        product_id: (it.product_id ?? it.productId ?? "").toString(),
        qty: Number(it.qty ?? it.quantity ?? 0),
      })).filter((x) => x.product_id && Number.isFinite(x.qty) && x.qty > 0);

      setItems(rows);
    } catch (e) {
      setErr(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (orderId) loadDetail(orderId);
    else loadList();
  }, [router.isReady, orderId, loadList, loadDetail]);

  const grouped = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    const filtered = !q
      ? orders
      : (orders || []).filter((o) => {
          const s = `${o.delivery_date || ""} ${o.status || ""}`.toLowerCase();
          return s.includes(q);
        });

    const map = new Map();
    for (const o of filtered || []) {
      const k = monthKey(o.delivery_date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    }
    const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
    return keys.map((k) => ({ key: k, label: frMonthLabel(k), orders: map.get(k) || [] }));
  }, [orders, search]);

  const statusLabel = (s) => {
    const x = (s || "").toString();
    if (x === "sent") return "Envoyée";
    if (x === "archived") return "Archivée";
    if (x === "draft") return "Brouillon";
    return x || "—";
  };

  // ---------- Detail view ----------
  if (orderId) {
    const deliveryISO = safeISO(order?.delivery_date);
    const title = `Archive Bécus • ${frDate(deliveryISO)}`;

    return (
      <div style={styles.page}>
        <style jsx global>{`
          @media print {
            .noPrint { display: none !important; }
            body { background: #fff !important; }
          }
        `}</style>

        <div style={styles.wrap}>
          <div className="noPrint" style={styles.topbar}>
            <Link href={back} style={styles.pillLink}>← Retour</Link>
            <div style={{ flex: 1 }} />
            <button onClick={() => window.print()} style={styles.pillBtn}>🖨️ Imprimer</button>
          </div>

          <div style={styles.card}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{title}</h1>
              <span style={styles.badge}>{statusLabel(order?.status)}</span>
            </div>
            <div style={styles.meta}>
              <div><b>Livraison:</b> {frDate(deliveryISO)}</div>
              <div><b>Commande:</b> #{order?.id || "—"}</div>
            </div>

            {err ? <div style={styles.err}>{err}</div> : null}
            {loading ? <div style={styles.small}>Chargement…</div> : null}

            {!loading && !err ? (
              <div style={{ marginTop: 12 }}>
                {!items.length ? (
                  <div style={styles.small}>Aucun article.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {items.map((it) => {
                      const p = productById[it.product_id];
                      return (
                        <div key={`${it.product_id}`} style={styles.itemRow}>
                          <ProductIcon p={p} size={22} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {productName(p) || it.product_id}
                            </div>
                            <div style={styles.small}>{it.product_id}</div>
                          </div>
                          <div style={styles.qty}>x{it.qty}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, opacity: 0.6 }}>
            UI: {UI_TAG}
          </div>
        </div>
      </div>
    );
  }

  // ---------- List view ----------
  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.topbar}>
          <Link href={back} style={styles.pillLink}>← Retour Bécus</Link>
          <div style={{ flex: 1 }} />
          <Link href={`/products?supplier=${SUPPLIER_KEY}&back=${encodeURIComponent(back)}`} style={styles.pillLink}>📦 Produits Bécus</Link>
        </div>

        <div style={styles.card}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Archives Bécus</h1>
            <span style={styles.badge}>Lecture seule</span>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (date, statut)…"
              style={styles.input}
            />
            <button onClick={loadList} style={styles.pillBtn}>↻ Rafraîchir</button>
          </div>

          {err ? <div style={styles.err}>{err}</div> : null}
          {loading ? <div style={styles.small}>Chargement…</div> : null}

          {!loading && !err ? (
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {!grouped.length ? (
                <div style={styles.small}>Aucune archive.</div>
              ) : (
                grouped.map((g, idx) => (
                  <details key={g.key} open={idx === 0} style={styles.group}>
                    <summary style={styles.groupSum}>
                      <span style={{ fontWeight: 900 }}>{g.label}</span>
                      <span style={styles.small}>({g.orders.length})</span>
                    </summary>

                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {g.orders.map((o) => (
                        <div key={o.id} style={styles.orderRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900 }}>{frDate(o.delivery_date)}</div>
                            <div style={styles.small}>{statusLabel(o.status)}</div>
                          </div>
                          <div style={{ flex: 1 }} />
                          <Link href={`/suppliers/${SUPPLIER_KEY}/history?id=${encodeURIComponent(o.id)}`} style={styles.pillLink}>
                            👁️ Lire
                          </Link>
                        </div>
                      ))}
                    </div>
                  </details>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, opacity: 0.6 }}>
          UI: {UI_TAG}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
    padding: 14,
    fontFamily: `"Inter", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`,
    color: "#0f172a",
  },
  wrap: { maxWidth: 980, margin: "0 auto" },
  topbar: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  card: {
    background: "#ffffffcc",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: 12,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(15,23,42,0.04)",
  },
  input: {
    flex: "1 1 240px",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    outline: "none",
    fontSize: 14,
    background: "#fff",
  },
  pillLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    textDecoration: "none",
    fontWeight: 900,
    background: "#fff",
    color: "#0f172a",
  },
  pillBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    fontWeight: 900,
    background: "#fff",
    cursor: "pointer",
  },
  small: { fontSize: 13, opacity: 0.75, marginTop: 10 },
  meta: { marginTop: 10, display: "grid", gap: 6, fontSize: 13, opacity: 0.85 },
  err: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(220, 38, 38, 0.28)",
    background: "rgba(220, 38, 38, 0.08)",
    color: "#991b1b",
    fontWeight: 700,
    fontSize: 13,
  },
  group: {
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 14,
    padding: 10,
    background: "#fff",
  },
  groupSum: {
    cursor: "pointer",
    listStyle: "none",
    outline: "none",
    display: "flex",
    gap: 10,
    alignItems: "baseline",
  },
  orderRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
  itemRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
  qty: {
    fontWeight: 1000,
    padding: "4px 10px",
    borderRadius: 999,
    background: "#0f172a",
    color: "#fff",
    fontSize: 12,
  },
};
