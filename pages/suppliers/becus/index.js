// pages/suppliers/becus/index.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const SHOP_LABEL = "BM Boulangerie";
const UI_TAG = "v-becus-ui-2026-02-09-archives-products-fix";

// ---------- Dates (Bécus = Jeudi) ----------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toISODate(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function addDaysISO(iso, delta) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}
function isoToDDMMYYYY(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
function isoToFR(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function getBecusDeliveryISO(now = new Date()) {
  // Delivery = Thursday
  // Switch to next delivery after Thursday 08:00
  const n = new Date(now);
  const day = n.getDay(); // 0..6 (Sun..Sat)

  const base = new Date(n);
  base.setHours(0, 0, 0, 0);

  const daysUntilThu = (4 - day + 7) % 7;
  base.setDate(base.getDate() + daysUntilThu); // this week's Thu (or today if Thu)

  if (day === 4 && n.getHours() >= 8) base.setDate(base.getDate() + 7);
  return toISODate(base);
}
function getCutoffForDeliveryISO(deliveryISO) {
  // Wednesday 12:00
  const d = new Date(deliveryISO + "T00:00:00");
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

// ---------- Products helpers ----------
function normDept(x) {
  const s = (x ?? "").toString().trim().toLowerCase();
  if (!s) return "vente";
  if (s.startsWith("patis") || s.startsWith("pâtis")) return "patiss";
  if (s.startsWith("boul")) return "boulanger";
  if (s.startsWith("vent")) return "vente";
  return s;
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
    ""
  )
    .toString()
    .trim();
}

function deptFallbackEmoji(dept) {
  const d = normDept(dept);
  if (d === "boulanger") return "🥖";
  if (d === "patiss") return "🍰";
  // vente / défaut
  return "🧺";
}

function ProductIcon({ p, size = 20 }) {
  const url = productThumb(p);
  const emoji = productEmoji(p) || deptFallbackEmoji(p?.dept) || "📦";

  const box = {
    width: size,
    height: size,
    borderRadius: 6,
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  };

  if (url) {
    return (
      <span style={{ ...box, border: "1px solid rgba(15,23,42,0.10)", background: "#fff" }}>
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </span>
    );
  }

  return <span style={{ width: size, textAlign: "center", lineHeight: `${size}px` }}>{emoji}</span>;
}

function normKey(x) {
  const s = (x ?? "").toString().trim().toLowerCase();
  if (!s) return "";
  // UUIDs parfois avec / sans tirets selon les tables
  return s.replace(/-/g, "");
}

function buildProductIndex(products) {
  const map = {};
  for (const p of products || []) {
    const add = (v) => {
      const k = normKey(v);
      if (k) map[k] = p;
    };

    // id & uuid (et variantes)
    add(p?.id);
    add(p?.uuid);
    add(p?.product_id);
    add(p?.productId);
    add(p?.code);
    add(p?.sku);
    add(p?.ref);
    add(p?.external_id);
    add(p?.externalId);

    // aussi stocker la forme brute (si jamais)
    const raw = (p?.id ?? "").toString().trim().toLowerCase();
    if (raw) map[raw] = p;
    const rawUuid = (p?.uuid ?? "").toString().trim().toLowerCase();
    if (rawUuid) map[rawUuid] = p;
  }
  return map;
}

function itemsFromMap(map) {
  return Object.entries(map || {})
    .map(([product_id, qty]) => ({ product_id: String(product_id), qty: Number(qty || 0) }))
    .filter((it) => Number(it.qty || 0) > 0);
}

function productPrice(p) {
  const v = p?.price ?? p?.unit_price ?? p?.unitPrice ?? p?.prix ?? p?.tarif ?? null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------- WhatsApp helpers ----------
function normalizePhoneForWa(phoneRaw) {
  const s = (phoneRaw ?? "").toString().trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}
function waLink(phone, text) {
  const p = normalizePhoneForWa(phone);
  const t = encodeURIComponent(text || "");
  const p2 = p.startsWith("+") ? p.slice(1) : p;
  return `https://wa.me/${p2}?text=${t}`;
}
function buildFullOrderText({ deliveryISO, items, productById }) {
  const lines = [];
  lines.push(`🧾 Commande Pour ${SHOP_LABEL} Livraison ${isoToDDMMYYYY(deliveryISO)}`);
  lines.push("");

  const buckets = { vente: [], boulanger: [], patiss: [] };
  for (const it of items) {
    const pid = String(it.product_id ?? it.productId ?? "");
    const qty = Number(it.qty ?? it.quantity ?? 0);
    const p = productById[pid];
    const dept = normDept(p?.dept);
    (buckets[dept] = buckets[dept] || []).push({ p, qty });
  }

  const addBucket = (k, title) => {
    const arr = buckets[k] || [];
    if (!arr.length) return;
    lines.push(`*${title}*`);
    for (const x of arr) lines.push(`- ${productName(x.p)} x${x.qty}`);
    lines.push("");
  };

  addBucket("vente", "Vente");
  addBucket("boulanger", "Boulanger");
  addBucket("patiss", "Pâtissier");

  return lines.join("\n").trim();
}
function buildDeltaText({ deliveryISO, deltaAdd, deltaDown, productById }) {
  const header = `🧾 Modification commande ${SHOP_LABEL} Livraison ${isoToDDMMYYYY(deliveryISO)}`;
  const lines = [header, ""];

  if (deltaDown.length) {
    lines.push("Merci de modifier la commande comme suit :");
    for (const d of deltaDown) {
      const name = productName(productById[d.product_id]);
      if (d.newQty <= 0) lines.push(`- Supprimer : ${name}`);
      else lines.push(`- ${name} : ${d.oldQty} → ${d.newQty}`);
    }
    lines.push("");
  }

  if (deltaAdd.length) {
    lines.push("Merci de rajouter sur la même commande les articles suivants :");
    for (const a of deltaAdd) lines.push(`- ${productName(productById[a.product_id])} x${a.addQty}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

// ---------- Storage helpers ----------
function snapKey(kind, deliveryISO) {
  return `becus_${kind}_${deliveryISO}`;
}
function loadSnap(kind, deliveryISO) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(snapKey(kind, deliveryISO));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}
function saveSnap(kind, deliveryISO, map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(snapKey(kind, deliveryISO), JSON.stringify(map || {}));
  } catch {}
}

// ---------- Supabase helpers ----------
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

async function loadItems(orderId) {
  const r = await supabase.from("order_items").select("*").eq("order_id", orderId).limit(5000);
  if (r.error) throw r.error;
  const items = (r.data || []).map((it) => ({
    product_id: String(it.product_id ?? it.productId ?? ""),
    qty: Number(it.qty ?? it.quantity ?? 0),
  }));
  return items.filter((it) => it.product_id && Number.isFinite(it.qty) && it.qty > 0);
}

async function fetchProducts() {
  const r = await supabase
    .from("products")
    .select("*")
    .eq("supplier_key", SUPPLIER_KEY)
    .order("dept", { ascending: true })
    .limit(5000);
  if (r.error) throw r.error;
  return r.data || [];
}

async function getSupplierWhatsApp() {
  // Local override (per device)
  if (typeof window !== "undefined") {
    const local = (localStorage.getItem("whatsapp_override_becus") || "").trim();
    if (local) return { phone: local, source: "local" };
  }

  // Try suppliers then supplier_contacts (best-effort, RLS may block)
  const tries = [
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

  for (const fn of tries) {
    try {
      const row = await fn();
      if (row) {
        const phone = row.whatsapp_phone || row.whatsapp || row.phone_whatsapp || row.phone || row.mobile || "";
        if (phone) return { phone: phone.toString(), source: "db" };
      }
    } catch {}
  }

  return { phone: "", source: "none" };
}

async function upsertItem(orderId, productId, qty) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q < 0) return;
  if (q <= 0) {
    await supabase.from("order_items").delete().eq("order_id", orderId).eq("product_id", productId);
    return;
  }
  const payload = { order_id: orderId, product_id: productId, qty: q };
  const up = await supabase.from("order_items").upsert(payload, { onConflict: "order_id,product_id" });
  if (up.error) {
    await supabase.from("order_items").delete().eq("order_id", orderId).eq("product_id", productId);
    const ins = await supabase.from("order_items").insert(payload);
    if (ins.error) throw ins.error;
  }
}

function mapFromItems(items) {
  const m = {};
  for (const it of items || []) m[String(it.product_id)] = Number(it.qty || 0);
  return m;
}

// ---------- DB snapshots (shared across devices) ----------
async function fetchSnapshot(orderId, kind) {
  try {
    const r = await supabase
      .from("order_item_snapshots")
      .select("product_id,qty")
      .eq("order_id", orderId)
      .eq("kind", kind)
      .limit(5000);
    if (r.error) return {};
    const m = {};
    for (const row of r.data || []) {
      const pid = String(row.product_id ?? "");
      const q = Number(row.qty ?? 0);
      if (pid) m[pid] = Number.isFinite(q) ? q : 0;
    }
    return m;
  } catch {
    return {};
  }
}
async function writeSnapshot(orderId, kind, map) {
  try {
    const rows = Object.entries(map || {}).map(([product_id, qty]) => ({
      order_id: orderId,
      kind,
      product_id: String(product_id),
      qty: Number(qty || 0),
      updated_at: new Date().toISOString(),
    }));

    // Upsert current rows
    if (rows.length) {
      await supabase.from("order_item_snapshots").upsert(rows, {
        onConflict: "order_id,kind,product_id",
      });

      // Delete removed rows (best-effort)
      const ids = rows.map((r) => String(r.product_id));
      const list = `(${ids.map((x) => `"${x.replace(/"/g, '\\"')}"`).join(",")})`;
      await supabase
        .from("order_item_snapshots")
        .delete()
        .eq("order_id", orderId)
        .eq("kind", kind)
        .not("product_id", "in", list);
    } else {
      // Nothing -> delete all snapshot rows for that kind
      await supabase.from("order_item_snapshots").delete().eq("order_id", orderId).eq("kind", kind);
    }
  } catch {
    // ignore
  }
}

function computeTotal(items, productById) {
  let total = 0;
  let hasPrice = false;
  for (const it of items) {
    const price = productPrice(productById[normKey(it.product_id)] || productById[it.product_id]);
    if (price == null) continue;
    hasPrice = true;
    total += price * Number(it.qty || 0);
  }
  return hasPrice ? total : null;
}
function formatEUR(n) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
  } catch {
    return `${Math.round(n * 100) / 100} €`;
  }
}

export default function BecusHome() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const deliveryISO = useMemo(() => {
    if (!mounted) return "";
    return getBecusDeliveryISO(now);
  }, [mounted, now]);

  const prevDeliveryISO = useMemo(() => {
    if (!deliveryISO) return "";
    return addDaysISO(deliveryISO, -7);
  }, [deliveryISO]);

  const cutoff = useMemo(() => (deliveryISO ? getCutoffForDeliveryISO(deliveryISO) : null), [deliveryISO]);
  const isBeforeCutoff = useMemo(() => {
    if (!cutoff) return true;
    return now.getTime() <= cutoff.getTime();
  }, [now, cutoff]);

  const afterThu08 = useMemo(() => {
    if (!mounted) return false;
    const d = new Date(now);
    return d.getDay() === 4 ? d.getHours() >= 8 : d.getDay() > 4; // Thu after 8, or Fri/Sat
  }, [mounted, now]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [whats, setWhats] = useState({ phone: "", source: "none" });

  // DB snapshots (shared) + local snapshots (fallback)
  const [dbSnap, setDbSnap] = useState({ initial: null, last: null, ready: false, source: "db" });

  // For "Semaine dernière"
  const [prevOrder, setPrevOrder] = useState(null);
  const [prevItems, setPrevItems] = useState([]);
  const [missing, setMissing] = useState({});
  const [busy, setBusy] = useState(false);

  // UI
  const [showPhoneEditor, setShowPhoneEditor] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [showInitialDetails, setShowInitialDetails] = useState(true);
  const [waConfirm, setWaConfirm] = useState(null); // { kind: "initial"|"delta", map: {pid:qty}, createdAt }

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  // Force SW update on version change (helps stop "ancienne version")
  useEffect(() => {
    if (!mounted) return;
    try {
      const buildId = window.__NEXT_DATA__?.buildId || "";
      const key = "last_next_build_id";
      const prev = localStorage.getItem(key) || "";
      if (buildId && prev && prev !== buildId) {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker
            .getRegistrations()
            .then((regs) => Promise.all(regs.map((r) => r.unregister())))
            .finally(() => {
              localStorage.setItem(key, buildId);
              window.location.reload();
            });
        } else {
          localStorage.setItem(key, buildId);
        }
      } else if (buildId) {
        localStorage.setItem(key, buildId);
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.update().catch(() => {})));
        }
      }
    } catch {}
  }, [mounted]);

  const productById = useMemo(() => buildProductIndex(products), [products]);

  const orderStatus = useMemo(() => (order?.status || "draft").toString(), [order]);
  const isSent = useMemo(() => orderStatus === "sent" || !!order?.sent_at || !!order?.sentAt, [orderStatus, order]);

  useEffect(() => {
    if (!mounted) return;
    if (isSent) setShowInitialDetails(false);
  }, [mounted, isSent]);

  const canEdit = useMemo(() => !!isBeforeCutoff, [isBeforeCutoff]);

  const itemsCount = useMemo(() => items.reduce((a, it) => a + Number(it.qty || 0), 0), [items]);
  const total = useMemo(() => computeTotal(items, productById), [items, productById]);

  const resolveProduct = useCallback(
    (pid) => {
      const k = normKey(pid);
      return (k && productById[k]) || productById[(pid ?? "").toString()] || null;
    },
    [productById]
  );

  const initialSnapLocal = useMemo(() => (deliveryISO ? loadSnap("initial", deliveryISO) : null), [deliveryISO]);


  // Référence confirmée (commande envoyée) : elle ne doit changer qu'après confirmation WhatsApp
const confirmedBaseMap = useMemo(() => {
  if (!isSent) return null;

  const dbLast = dbSnap?.last && Object.keys(dbSnap.last).length ? dbSnap.last : null;
  const dbIni = dbSnap?.initial && Object.keys(dbSnap.initial).length ? dbSnap.initial : null;

  if (dbLast) return dbLast;
  if (dbIni) return dbIni;

  // Fallback local (per-device) : uniquement "initial" pour éviter qu'une page annexe écrase la référence
  const localIni = initialSnapLocal && Object.keys(initialSnapLocal).length ? initialSnapLocal : null;
  return localIni;
}, [isSent, dbSnap?.last, dbSnap?.initial, initialSnapLocal]);

const initialDisplayItems = useMemo(() => {
  if (!isSent) return items;
  return confirmedBaseMap ? itemsFromMap(confirmedBaseMap) : items;
}, [isSent, confirmedBaseMap, items]);

const displayCount = useMemo(
  () => initialDisplayItems.reduce((a, it) => a + Number(it.qty || 0), 0),
  [initialDisplayItems]
);
const displayTotal = useMemo(() => computeTotal(initialDisplayItems, productById), [initialDisplayItems, productById]);

const showInitialWarning = useMemo(() => isSent && !confirmedBaseMap, [isSent, confirmedBaseMap]);

  const loadAll = useCallback(async () => {
    if (!deliveryISO) return;
    setLoading(true);
    setErr("");
    try {
      const [prods, wa, o] = await Promise.all([fetchProducts(), getSupplierWhatsApp(), getOrCreateOrder(deliveryISO)]);
      setProducts(prods);
      setWhats(wa);
      setOrder(o);

      const its = await loadItems(o.id);
      setItems(its);

      const sent = (o?.status || "draft") === "sent" || !!o?.sent_at || !!o?.sentAt;

      // Load shared snapshots if possible (so Ajout/Modification works on any device)
      if (sent) {
        const [ini, lst] = await Promise.all([fetchSnapshot(o.id, "initial"), fetchSnapshot(o.id, "last")]);
        // IMPORTANT: ne jamais "auto-seed" sans action explicite (sinon la référence bouge toute seule)
        setDbSnap({ initial: ini || {}, last: lst || {}, ready: true, source: "db" });
      } else {
        setDbSnap({ initial: null, last: null, ready: false, source: "none" });
      }

      // S-1
      if (afterThu08 && prevDeliveryISO) {
        const pr = await supabase
          .from("orders")
          .select("*")
          .eq("supplier_key", SUPPLIER_KEY)
          .eq("delivery_date", prevDeliveryISO)
          .maybeSingle();
        if (!pr.error && pr.data) {
          setPrevOrder(pr.data);
          const pits = await loadItems(pr.data.id);
          setPrevItems(pits);
        } else {
          setPrevOrder(null);
          setPrevItems([]);
        }
      } else {
        setPrevOrder(null);
        setPrevItems([]);
      }
    } catch (e) {
      setErr((e?.message || "Erreur de chargement").toString());
    } finally {
      setLoading(false);
    }
  }, [deliveryISO, afterThu08, prevDeliveryISO]);

  useEffect(() => {
    if (!mounted) return;
    loadAll();
  }, [mounted, loadAll]);

  const openOrderEditor = useCallback(() => {
    if (!deliveryISO) return;
    router.push(`/suppliers/${SUPPLIER_KEY}/order?date=${encodeURIComponent(deliveryISO)}`);
  }, [router, deliveryISO]);

  const goProductsManager = useCallback(() => {
    const back = `/suppliers/${SUPPLIER_KEY}`;
    router.push(`/products?supplier=${SUPPLIER_KEY}&back=${encodeURIComponent(back)}`);
  }, [router]);

  useEffect(() => {
    if (!mounted) return;
    setPhoneDraft((whats?.phone || "").toString());
  }, [mounted, whats?.phone]);

  const savePhoneLocal = useCallback(() => {
    try {
      localStorage.setItem("whatsapp_override_becus", (phoneDraft || "").trim());
      setWhats({ phone: (phoneDraft || "").trim(), source: "local" });
      setShowPhoneEditor(false);
    } catch {}
  }, [phoneDraft]);

  const cutoffText = useMemo(() => {
    if (!cutoff) return "";
    return `${pad2(cutoff.getDate())}/${pad2(cutoff.getMonth() + 1)}/${cutoff.getFullYear()} ${pad2(
      cutoff.getHours()
    )}:${pad2(cutoff.getMinutes())}`;
  }, [cutoff]);

  // --- Compute deltas: only show changes vs last snapshot (or initial snapshot)
  const computeDelta = useCallback(() => {
    const cur = mapFromItems(items);

    // Base priority: DB last -> DB initial -> local initial -> empty
    const baseDbLast = dbSnap?.last && Object.keys(dbSnap.last).length ? dbSnap.last : null;
    const baseDbIni = dbSnap?.initial && Object.keys(dbSnap.initial).length ? dbSnap.initial : null;

    const base = baseDbLast || baseDbIni || initialSnapLocal || {};

    const allIds = new Set([...Object.keys(base || {}), ...Object.keys(cur)]);
    const add = [];
    const down = [];

    // For WhatsApp text we also keep old/new
    const downForMsg = [];
    const addForMsg = [];

    for (const id of allIds) {
      const oldQty = Number(base?.[id] || 0);
      const newQty = Number(cur?.[id] || 0);
      const diff = newQty - oldQty;

      if (diff > 0) {
        add.push({ product_id: id, diff });
        addForMsg.push({ product_id: id, addQty: diff });
      }
      if (diff < 0) {
        down.push({ product_id: id, diff });
        downForMsg.push({ product_id: id, oldQty, newQty });
      }
    }

    return {
      add,
      down,
      cur,
      addForMsg,
      downForMsg,
      baseSource: baseDbLast ? "db:last" : baseDbIni ? "db:initial" : initialSnapLocal ? "local:initial" : "none",
    };
  }, [items, dbSnap, initialSnapLocal]);

  const pendingDelta = useMemo(
    () => (isSent ? computeDelta() : { add: [], down: [], cur: {}, addForMsg: [], downForMsg: [], baseSource: "none" }),
    [isSent, computeDelta]
  );

  const hasPendingChanges = useMemo(() => !!(pendingDelta?.add?.length || pendingDelta?.down?.length), [
    pendingDelta?.add?.length,
    pendingDelta?.down?.length,
  ]);

  const whatsDisabledReason = useMemo(() => {
    if (!whats?.phone) return "Numéro WhatsApp manquant (appareil)";
    if (!canEdit) return "Fermé (cutoff dépassé)";
    if (!isSent && !items.length) return "Aucun produit";
    if (isSent && !hasPendingChanges) return "Aucune modification";
    return "";
  }, [whats?.phone, canEdit, isSent, items.length, hasPendingChanges]);

  const sendInitial = useCallback(async () => {
  if (!order?.id) return;
  if (!canEdit) return;
  if (!whats?.phone) return;
  if (!items.length) return;
  if (isSent) return;
  if (waConfirm) return;

  const text = buildFullOrderText({ deliveryISO, items, productById });
  window.open(waLink(whats.phone, text), "_blank");

  // IMPORTANT: on ne "valide" rien tant que l’utilisateur n’a pas confirmé que le message WhatsApp est parti.
  const map = mapFromItems(items);
  setWaConfirm({ kind: "initial", map, createdAt: Date.now() });
}, [order?.id, canEdit, whats?.phone, items, deliveryISO, productById, isSent, waConfirm]);

  const sendDelta = useCallback(async () => {
  if (!order?.id) return;
  if (!canEdit) return;
  if (!whats?.phone) return;
  if (!isSent) return;
  if (waConfirm) return;

  const { addForMsg, downForMsg, cur } = pendingDelta || {};
  if (!addForMsg?.length && !downForMsg?.length) return;

  const text = buildDeltaText({ deliveryISO, deltaAdd: addForMsg, deltaDown: downForMsg, productById });
  window.open(waLink(whats.phone, text), "_blank");

  // IMPORTANT: on ne met pas à jour la référence tant que l’utilisateur n’a pas confirmé l’envoi WhatsApp.
  setWaConfirm({ kind: "delta", map: cur || {}, createdAt: Date.now() });
}, [order?.id, canEdit, whats?.phone, isSent, pendingDelta, deliveryISO, productById, waConfirm]);

const cancelWaConfirm = useCallback(() => {
  setWaConfirm(null);
}, []);

const confirmWaSent = useCallback(async () => {
  if (!waConfirm || !order?.id) return;

  const kind = waConfirm.kind;
  const map = waConfirm.map || {};

  try {
    if (kind === "initial") {
      // Marquer "envoyée" seulement après confirmation
      try {
        await supabase.from("orders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", order.id);
      } catch {}

      // Snapshots: initial + last = état confirmé
      saveSnap("initial", deliveryISO, map);
      saveSnap("last", deliveryISO, map);

      await writeSnapshot(order.id, "initial", map);
      await writeSnapshot(order.id, "last", map);

      try {
        const r = await supabase.from("orders").select("*").eq("id", order.id).maybeSingle();
        if (!r.error && r.data) setOrder(r.data);
      } catch {}

      setDbSnap({ initial: map, last: map, ready: true, source: "db" });
    }

    if (kind === "delta") {
      // Snapshots: last = nouvel état confirmé
      saveSnap("last", deliveryISO, map);
      await writeSnapshot(order.id, "last", map);
      setDbSnap((prev) => ({ ...(prev || {}), last: map, ready: true, source: "db" }));
    }
  } finally {
    setWaConfirm(null);
  }
}, [waConfirm, order?.id, deliveryISO]);

  const resetBaselineToCurrent = useCallback(async () => {
    if (!deliveryISO || !order?.id) return;
    const cur = mapFromItems(items);

    // Local
    saveSnap("last", deliveryISO, cur);

    // DB: always set last; set initial too only if missing
    await writeSnapshot(order.id, "last", cur);

    const ini = dbSnap?.initial && Object.keys(dbSnap.initial).length ? dbSnap.initial : null;
    if (!ini) {
      saveSnap("initial", deliveryISO, cur);
      await writeSnapshot(order.id, "initial", cur);
      setDbSnap({ initial: cur, last: cur, ready: true, source: "seeded" });
    } else {
      setDbSnap((prev) => ({ ...(prev || {}), last: cur, ready: true }));
    }

    alert("Référence (Ajout/Modification) synchronisée ✅");
  }, [deliveryISO, order?.id, items, dbSnap?.initial]);

  const validateMissing = useCallback(async () => {
    if (!prevOrder?.id) return;
    if (!order?.id) return;
    if (!canEdit) {
      alert("Cutoff dépassé: impossible de reporter des manquants.");
      return;
    }
    const ids = Object.keys(missing).filter((k) => missing[k]);
    if (!ids.length) {
      alert("Aucun produit manquant sélectionné.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const prevMap = mapFromItems(prevItems);
      const curMap = mapFromItems(items);

      for (const pid of ids) {
        const addQty = Number(prevMap[pid] || 0);
        if (!addQty) continue;
        const nextQty = Number(curMap[pid] || 0) + addQty;
        await upsertItem(order.id, pid, nextQty);
      }

      try {
        await supabase.from("orders").update({ status: "archived" }).eq("id", prevOrder.id);
      } catch {}

      setMissing({});
      await loadAll();
      alert("Produits manquants reportés sur la semaine prochaine ✅");
    } catch (e) {
      setErr((e?.message || "Erreur").toString());
    } finally {
      setBusy(false);
    }
  }, [prevOrder?.id, order?.id, canEdit, missing, prevItems, items, loadAll]);

  const whatsEnabledInitial = !!whats?.phone && items.length > 0 && canEdit && !isSent;
  const whatsEnabledDelta = !!whats?.phone && canEdit && isSent && hasPendingChanges;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Link href="/" style={styles.pillLink}>
              ← Accueil
            </Link>
            <div style={{ minWidth: 0 }}>
              <div style={styles.h1}>Bécus</div>
              <div style={styles.h2}>
                Livraison : <strong>{deliveryISO ? isoToFR(deliveryISO) : "—"}</strong>
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <button onClick={goProductsManager} style={{ ...styles.pillBtn, ...styles.pillBtnPrimary }}>
            📦 Produits Bécus
          </button>
          <Link href="/admin/suppliers" style={styles.pillLink}>
            🛠️ Admin
          </Link>
        </div>

        <div style={styles.banner}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={styles.badgeOk}>✅ Ouvert jusqu'au mercredi 12:00</span>
            {!canEdit ? <span style={styles.badgeNo}>⛔ Fermé (cutoff dépassé)</span> : null}
            {isSent ? <span style={styles.badgeInfo}>📨 Commande initiale envoyée</span> : null}
            <span style={styles.smallMeta}>Cutoff : {cutoffText}</span>
            {loading ? <span style={styles.smallMeta}>Chargement…</span> : null}
            {err ? <span style={{ ...styles.smallMeta, color: "#b91c1c" }}>{err}</span> : null}
          </div>

          <div style={{ marginTop: 8 }}>
            {!whats?.phone ? (
              <span style={{ ...styles.smallMeta, color: "#b45309" }}>Numéro WhatsApp manquant sur cet appareil.</span>
            ) : (
              <span style={styles.smallMeta}>
                WhatsApp : <strong>{whats.phone}</strong> ({whats.source})
              </span>
            )}
            <button onClick={() => setShowPhoneEditor((v) => !v)} style={styles.linkBtn}>
              {whats?.phone ? "Modifier" : "Configurer"}
            </button>
          </div>

          {showPhoneEditor ? (
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="+33..."
                style={styles.input}
              />
              <button onClick={savePhoneLocal} style={{ ...styles.pillBtn, background: "#16a34a", color: "#fff" }}>
                Enregistrer (appareil)
              </button>
              <button onClick={() => setShowPhoneEditor(false)} style={styles.pillBtn}>
                Annuler
              </button>
            </div>
          ) : null}
        </div>

        {/* ---------- Commande initiale ---------- */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <button
              onClick={() => setShowInitialDetails((v) => !v)}
              style={{ ...styles.pillBtn, background: "rgba(15,23,42,0.06)" }}
            >
              {showInitialDetails ? "Réduire" : "Afficher"}
            </button>

            <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
              <div style={styles.cardTitleCenter}>
                {isSent ? "Commande confirmée" : "Commande en cours"}
                <span style={styles.datePill}> {deliveryISO ? isoToDDMMYYYY(deliveryISO) : ""}</span>
              </div>
              <div style={styles.smallMeta}>
                {isSent
                  ? "Commande confirmée (elle ne change qu’après WhatsApp). Pour modifier, utilise le bloc Ajout / Modification."
                  : "Prépare la commande, puis envoie sur WhatsApp."}
              </div>
              {showInitialWarning ? (
                <div style={{ ...styles.smallMeta, color: "#b45309" }}>
                  Référence confirmée introuvable (snapshots). La carte affiche l’état actuel. Si besoin, clique sur “↺ Référence = actuel”.
                </div>
              ) : null}
            </div>

            <button
              onClick={sendInitial}
              disabled={!whatsEnabledInitial}
              style={{
                ...styles.whatsBtn,
                background: whatsEnabledInitial ? "#16a34a" : "#e5e7eb",
                color: whatsEnabledInitial ? "#fff" : "#6b7280",
                cursor: whatsEnabledInitial ? "pointer" : "not-allowed",
              }}
              title={whatsDisabledReason}
            >
              💬 WhatsApp
            </button>
          </div>

          {waConfirm?.kind === "initial" ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                background: "rgba(22,163,74,0.08)",
                border: "1px solid rgba(22,163,74,0.25)",
              }}
            >
              <div style={{ fontSize: 13, color: "#065f46" }}>
                WhatsApp a été ouvert. Une fois le message <strong>envoyé</strong> au fournisseur, clique sur{" "}
                <strong>Confirmer envoyé</strong>.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={confirmWaSent} style={{ ...styles.pillBtn, background: "#16a34a", color: "#fff" }}>
                  ✅ Confirmer envoyé
                </button>
                <button onClick={cancelWaConfirm} style={{ ...styles.pillBtn }}>
                  Pas encore
                </button>
              </div>
            </div>
          ) : null}

          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={styles.smallMeta}>
              Total articles : <strong>{displayCount}</strong>
            </span>
            {displayTotal != null ? (
              <span style={styles.smallMeta}>
                Total : <strong>{formatEUR(displayTotal)}</strong>
              </span>
            ) : (
              <span style={styles.smallMeta}>Total : (prix non renseignés)</span>
            )}
          </div>

          {showInitialDetails ? (
            <>
              <div style={styles.summaryRow}>
                <div style={styles.summaryBox}>
                  <div style={styles.summaryTitle}>Vente</div>
                  <SummaryList items={initialDisplayItems} resolveProduct={resolveProduct} dept="vente" />
                </div>
                <div style={styles.summaryBox}>
                  <div style={styles.summaryTitle}>Boulanger</div>
                  <SummaryList items={initialDisplayItems} resolveProduct={resolveProduct} dept="boulanger" />
                </div>
                <div style={styles.summaryBox}>
                  <div style={styles.summaryTitle}>Pâtissier</div>
                  <SummaryList items={initialDisplayItems} resolveProduct={resolveProduct} dept="patiss" />
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                <button
                  onClick={openOrderEditor}
                  disabled={isSent}
                  style={{
                    ...styles.pillBtn,
                    background: isSent ? "#e5e7eb" : "#fb923c",
                    color: isSent ? "#6b7280" : "#111827",
                    cursor: isSent ? "not-allowed" : "pointer",
                  }}
                  title={isSent ? "Commande déjà envoyée (utilise Ajout / Modification)" : "Ajouter / modifier des produits"}
                >
                  ➕ Ajouter Produits
                </button>
              </div>
            </>
          ) : null}
        </div>

        {/* ---------- Ajout / Modification (après envoi) ---------- */}
        {isSent ? (
          <div style={{ ...styles.card, borderColor: "rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.05)" }}>
            <div style={styles.cardTopRow}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Ajout / Modification</div>
              <div style={{ flex: 1 }} />

              <button onClick={openOrderEditor} style={{ ...styles.pillBtn, background: "#fb923c", color: "#111827" }}>
                ✏️ Modifier / Ajouter
              </button>

              <button
                onClick={sendDelta}
                disabled={!whatsEnabledDelta}
                style={{
                  ...styles.whatsBtn,
                  background: whatsEnabledDelta ? "#16a34a" : "#e5e7eb",
                  color: whatsEnabledDelta ? "#fff" : "#6b7280",
                  cursor: whatsEnabledDelta ? "pointer" : "not-allowed",
                }}
                title={whatsDisabledReason}
              >
                ✅ Envoyer WhatsApp
              </button>

              <button onClick={resetBaselineToCurrent} style={{ ...styles.pillBtn }}>
                ↺ Référence = actuel
              </button>
            </div>

            {waConfirm?.kind === "delta" ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: "rgba(22,163,74,0.08)",
                  border: "1px solid rgba(22,163,74,0.25)",
                }}
              >
                <div style={{ fontSize: 13, color: "#065f46" }}>
                  WhatsApp a été ouvert. Une fois le message <strong>envoyé</strong>, clique sur <strong>Confirmer envoyé</strong> pour
                  valider la modification.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button onClick={confirmWaSent} style={{ ...styles.pillBtn, background: "#16a34a", color: "#fff" }}>
                    ✅ Confirmer envoyé
                  </button>
                  <button onClick={cancelWaConfirm} style={{ ...styles.pillBtn }}>
                    Pas encore
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {!whatsEnabledDelta ? <div style={{ ...styles.smallMeta, color: "#b45309" }}>{whatsDisabledReason}</div> : null}

              <div style={styles.smallMeta}>
                1) Clique sur <strong>Modifier / Ajouter</strong> 2) Ajuste les quantités 3) Reviens ici 4) Envoie WhatsApp.
              </div>

              {hasPendingChanges ? (
                <div style={styles.deltaGrid}>
                  <div style={styles.deltaBox}>
                    <div style={styles.deltaTitle}>➕ À ajouter</div>
                    {pendingDelta.add.length ? (
                      pendingDelta.add.map((a) => (
                        <div key={`add_${a.product_id}`} style={styles.deltaRow}>
                          <span style={styles.deltaEmoji}><ProductIcon p={resolveProduct(a.product_id)} size={22} /></span>
                          <span style={styles.deltaName} title={productName(productById[a.product_id])}>
                            {productName(productById[a.product_id])}
                          </span>
                          <span style={styles.qtyPill}>{`+${a.diff}`}</span>
                        </div>
                      ))
                    ) : (
                      <div style={styles.deltaEmpty}>—</div>
                    )}
                  </div>

                  <div style={styles.deltaBox}>
                    <div style={styles.deltaTitle}>✍️ À modifier / supprimer</div>
                    {pendingDelta.down.length ? (
                      pendingDelta.down.map((d) => (
                        <div key={`down_${d.product_id}`} style={styles.deltaRow}>
                          <span style={styles.deltaEmoji}><ProductIcon p={resolveProduct(d.product_id)} size={22} /></span>
                          <span style={styles.deltaName} title={productName(productById[d.product_id])}>
                            {productName(productById[d.product_id])}
                          </span>
                          <span style={styles.qtyPill}>{`${d.diff}`}</span>
                        </div>
                      ))
                    ) : (
                      <div style={styles.deltaEmpty}>—</div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={styles.deltaHint}>Aucune modification pour le moment.</div>
              )}

              <div style={styles.tinyNote}>
                Base des modifications: <strong>{pendingDelta.baseSource}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- Semaine dernière ---------- */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>
              Semaine dernière
              {prevDeliveryISO ? <span style={styles.datePill}> {isoToDDMMYYYY(prevDeliveryISO)}</span> : null}
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={validateMissing}
              disabled={!afterThu08 || !prevOrder || busy || !canEdit}
              style={{
                ...styles.pillBtn,
                background: !afterThu08 || !prevOrder || busy || !canEdit ? "#e5e7eb" : "#111827",
                color: !afterThu08 || !prevOrder || busy || !canEdit ? "#6b7280" : "#fff",
                cursor: !afterThu08 || !prevOrder || busy || !canEdit ? "not-allowed" : "pointer",
              }}
              title={!afterThu08 ? "Disponible jeudi 08:00" : !prevOrder ? "Aucune commande S-1" : !canEdit ? "Cutoff dépassé" : ""}
            >
              ✅ Valider manquants
            </button>
          </div>

          {!afterThu08 ? (
            <div style={styles.smallMeta}>Disponible à partir du jeudi 08:00 (commande passée passe en “semaine dernière”).</div>
          ) : !prevOrder ? (
            <div style={styles.smallMeta}>Aucune commande S-1.</div>
          ) : !prevItems.length ? (
            <div style={styles.smallMeta}>Aucune ligne S-1.</div>
          ) : (
            <>
              <div style={styles.smallMeta}>(Coche les produits non reçus: ils seront ajoutés à la semaine prochaine)</div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {prevItems.map((it) => {
                  const p = resolveProduct(it.product_id);
                  const name = productName(p);
                  const checked = !!missing[it.product_id];

                  return (
                    <label key={it.product_id} style={styles.missingRow}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setMissing((prev) => ({ ...prev, [it.product_id]: v }));
                        }}
                      />
                      <ProductIcon p={p} size={22} />
                      <span style={styles.deltaName} title={name}>
                        {name}
                      </span>
                      <span style={styles.qtyPill}>x{it.qty}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ---------- Historique ---------- */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Historique</div>
            <div style={{ flex: 1 }} />
            <Link href={`/suppliers/${SUPPLIER_KEY}/history`} style={styles.pillLink}>
              📚 Ouvrir les archives
            </Link>
          </div>
          <div style={styles.smallMeta}>Lecture seule (pratique pour retrouver une ancienne commande).</div>
        </div>

        <div style={styles.footer}>
          <span style={styles.smallMeta}>UI: {UI_TAG}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryList({ items, resolveProduct, dept }) {
  const rows = (items || [])
    .map((it) => {
      const p = resolveProduct(it.product_id);
      if (normDept(p?.dept) !== dept) return null;
      return { id: it.product_id, qty: it.qty, p };
    })
    .filter(Boolean);

  if (!rows.length) return <div style={{ opacity: 0.6, fontSize: 13 }}>—</div>;

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <ProductIcon p={r.p} size={20} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 750,
            }}
            title={productName(r.p)}
          >
            {productName(r.p)}
          </span>
          <span style={styles.qtyPill}>x{Number(r.qty || 0)}</span>
        </div>
      ))}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f8fafc, #ffffff)",
    padding: 14,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0f172a",
  },
  container: { maxWidth: 1280, margin: "0 auto" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
    position: "sticky",
    top: 10,
    zIndex: 10,
    backdropFilter: "blur(10px)",
  },
  h1: { fontSize: 18, fontWeight: 900, letterSpacing: 0.2 },
  h2: { fontSize: 12, opacity: 0.75, fontWeight: 700 },
  pillLink: {
    textDecoration: "none",
    padding: "9px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 800,
    color: "#0f172a",
  },
  pillBtn: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  pillBtnPrimary: {
    background: "#0ea5e9",
    color: "#fff",
    borderColor: "rgba(14,165,233,0.35)",
  },
  banner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.03)",
  },
  badgeOk: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.25)",
    fontWeight: 800,
    fontSize: 12,
  },
  badgeNo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(239,68,68,0.10)",
    border: "1px solid rgba(239,68,68,0.25)",
    fontWeight: 800,
    fontSize: 12,
  },
  badgeInfo: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(59,130,246,0.10)",
    border: "1px solid rgba(59,130,246,0.25)",
    fontWeight: 800,
    fontSize: 12,
  },
  smallMeta: { fontSize: 12, opacity: 0.75, fontWeight: 700 },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "#fff",
    boxShadow: "0 10px 22px rgba(15,23,42,0.06)",
  },
  cardTopRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  cardTitleCenter: { fontSize: 18, fontWeight: 950, letterSpacing: 0.2 },
  datePill: {
    display: "inline-block",
    marginLeft: 8,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.05)",
    border: "1px solid rgba(15,23,42,0.08)",
    fontSize: 12,
    fontWeight: 800,
    verticalAlign: "middle",
  },
  whatsBtn: {
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    fontWeight: 900,
  },
  summaryRow: {
    marginTop: 12,
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  },
  summaryBox: {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
    minHeight: 90,
    minWidth: 0,
    overflow: "hidden",
  },
  summaryTitle: { fontSize: 13, fontWeight: 950, marginBottom: 8, opacity: 0.8 },
  qtyPill: {
    display: "inline-block",
    minWidth: 44,
    textAlign: "center",
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.10)",
    fontWeight: 950,
    fontSize: 12,
  },
  input: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    minWidth: 240,
    outline: "none",
    fontWeight: 800,
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: "#0ea5e9",
    fontWeight: 900,
    cursor: "pointer",
    padding: 0,
    marginLeft: 8,
    textDecoration: "underline",
  },
  missingRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
    minWidth: 0,
  },
  footer: { marginTop: 18, padding: 12, textAlign: "center", opacity: 0.7 },

  deltaGrid: { display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  deltaBox: {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(255,255,255,0.75)",
    padding: 12,
    minWidth: 0,
    overflow: "hidden",
  },
  deltaTitle: { fontWeight: 950, marginBottom: 8 },
  deltaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
    minWidth: 0,
  },
  deltaEmoji: { width: 22, textAlign: "center" },
  deltaName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 800,
  },
  deltaEmpty: { opacity: 0.6, fontWeight: 700 },
  deltaHint: { opacity: 0.8, fontWeight: 750 },
  tinyNote: { fontSize: 11, opacity: 0.6, fontWeight: 700 },
};
