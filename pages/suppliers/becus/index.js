// pages/suppliers/becus/index.js
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const SUPPLIER_LABEL_FALLBACK = "Bécus";
const COMPANY_LABEL = "BM Boulangerie";

// local fallback (tablet) for WhatsApp phone
const LS_WA_PHONE = "bakery-orders:wa_phone:becus";
// snapshots for WhatsApp delta messages (per delivery date)
const LS_SNAPSHOT_PREFIX = "bakery-orders:becus:snapshot:";

// ---------- Dates ----------
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
function isoDDMMYYYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
function isoDDMMslash(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function getCutoffForDeliveryISO(deliveryISO) {
  // Wednesday 12:00 (day before Thursday delivery)
  const d = new Date(deliveryISO + "T00:00:00");
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}
function getCurrentBecusDeliveryISO(now = new Date()) {
  // Delivery day = Thursday.
  // Switch to next delivery after Thursday 08:00.
  const n = new Date(now);
  const day = n.getDay(); // 0 Sun ... 4 Thu
  const base = new Date(n);
  base.setHours(0, 0, 0, 0);

  const daysUntilThu = (4 - day + 7) % 7;
  base.setDate(base.getDate() + daysUntilThu); // this week's Thu (or today if Thu)

  if (day === 4) {
    // Thursday: before 08:00 => today's delivery, after 08:00 => next week
    if (n.getHours() >= 8) base.setDate(base.getDate() + 7);
  }
  return toISODate(base);
}

// ---------- Product helpers ----------
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
    return `${n.toFixed(2)} €`;
  }
}

// ---------- WhatsApp message builders ----------
function groupItemsByDept(items, productById) {
  const buckets = { vente: [], boulanger: [], patiss: [] };
  for (const it of items || []) {
    const pid = String(it.product_id ?? it.productId ?? it.product_uuid ?? it.product ?? "");
    const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.qte ?? 0);
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    const p = productById?.[pid];
    const dept = normDept(p?.dept);
    buckets[dept] = buckets[dept] || [];
    buckets[dept].push({ p, pid, qty });
  }
  return buckets;
}

function buildInitialWhatsAppText({ deliveryISO, items, productById }) {
  const lines = [];
  lines.push(`Commande Pour ${COMPANY_LABEL} Livraison ${isoDDMMYYYY(deliveryISO)}`);
  lines.push("");

  const buckets = groupItemsByDept(items, productById);
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

function buildDeltaWhatsAppText({ deliveryISO, items, productById, snapshotMap }) {
  // snapshotMap: { [productId]: qtyAtLastSend }
  const cur = {};
  for (const it of items || []) {
    const pid = String(it.product_id ?? it.productId ?? it.product_uuid ?? it.product ?? "");
    const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.qte ?? 0);
    if (pid && Number.isFinite(qty) && qty > 0) cur[pid] = qty;
  }
  const prev = snapshotMap || {};

  const added = [];
  const changed = []; // reductions/removals

  // union of keys
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
  for (const pid of keys) {
    const before = Number(prev[pid] ?? 0);
    const now = Number(cur[pid] ?? 0);

    if (now > before) {
      const addQty = now - before;
      const p = productById?.[pid];
      added.push({ pid, p, qty: addQty });
    } else if (now < before) {
      const p = productById?.[pid];
      changed.push({ pid, p, before, now });
    }
  }

  const hasReduction = changed.length > 0;
  const hasAdded = added.length > 0;

  if (!hasReduction && !hasAdded) {
    return { text: "", hasChanges: false, kind: "none" };
  }

  const lines = [];
  const header = hasReduction ? "Modification commande" : "Ajout commande";
  lines.push(`${header} ${COMPANY_LABEL} Livraison ${isoDDMMYYYY(deliveryISO)}`);
  lines.push("");

  if (hasReduction) {
    lines.push("Merci de modifier sur la même commande les articles suivants :");
    for (const x of changed) {
      const name = productName(x.p);
      if (x.now <= 0) lines.push(`- ${name} : SUPPRIMER`);
      else lines.push(`- ${name} : quantité ${x.now}`);
    }
    lines.push("");
  }

  if (hasAdded) {
    lines.push(`Merci de rajouter sur la même commande les articles suivants (${added.length} article(s)) :`);
    for (const x of added) {
      const name = productName(x.p);
      lines.push(`- ${name} x${x.qty}`);
    }
    lines.push("");
  }

  return { text: lines.join("\n").trim(), hasChanges: true, kind: hasReduction ? "modification" : "ajout" };
}

// ---------- Supabase helpers (orders + order_items) ----------
async function getSupplierWhatsAppFromDB() {
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
      if (!row) continue;
      const phone =
        row.whatsapp_phone ||
        row.whatsapp ||
        row.phone_whatsapp ||
        row.phone ||
        row.mobile ||
        "";
      const name = row.name || row.display_name || row.label || SUPPLIER_LABEL_FALLBACK;
      return { phone: phone ? phone.toString() : "", name: name.toString() };
    } catch (_) {}
  }
  return { phone: "", name: SUPPLIER_LABEL_FALLBACK };
}

async function getOrCreateOrder(deliveryISO) {
  // canonical columns: supplier_key + delivery_date + status
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
  if (!ins.error && ins.data) return ins.data;

  // fallback: variants (older schema)
  const variants = [
    { supplierCol: "supplier_key", dateCol: "delivery_date" },
    { supplierCol: "supplier_key", dateCol: "delivery_day" },
    { supplierCol: "supplier", dateCol: "delivery_date" },
    { supplierCol: "supplier", dateCol: "delivery_day" },
  ];
  for (const v of variants) {
    try {
      const rr = await supabase
        .from("orders")
        .select("*")
        .eq(v.supplierCol, SUPPLIER_KEY)
        .eq(v.dateCol, deliveryISO)
        .maybeSingle();
      if (!rr.error && rr.data) return rr.data;
    } catch (_) {}
  }

  throw ins.error || r.error || new Error("Impossible de créer la commande.");
}

async function findOrderByDate(deliveryISO) {
  const r = await supabase
    .from("orders")
    .select("*")
    .eq("supplier_key", SUPPLIER_KEY)
    .eq("delivery_date", deliveryISO)
    .maybeSingle();
  if (!r.error && r.data) return r.data;
  return null;
}

async function listItemsForOrder(orderId) {
  const r = await supabase.from("order_items").select("*").eq("order_id", orderId).limit(5000);
  if (r.error) throw r.error;
  const out = [];
  for (const it of r.data || []) {
    const pid = String(it.product_id ?? it.productId ?? it.product_uuid ?? it.product ?? "");
    const qty = Number(it.qty ?? it.quantity ?? it.count ?? it.qte ?? 0);
    if (pid && Number.isFinite(qty) && qty > 0) out.push({ product_id: pid, qty });
  }
  return out;
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

async function updateOrderStatus(orderId, status) {
  if (!orderId) return;
  // best-effort: status only
  const r = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (!r.error) return;
  // fallback: sometimes column differs
  await supabase.from("orders").update({ state: status }).eq("id", orderId);
}

async function listOrdersForHistory(limit = 80) {
  const sorts = ["delivery_date", "created_at"];
  for (const s of sorts) {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .order(s, { ascending: false })
        .limit(limit);
      if (!error) return data || [];
      if (error && /Could not find/i.test(error.message || "")) continue;
    } catch (_) {}
  }
  return [];
}

// ---------- local snapshot ----------
function readSnapshot(deliveryISO) {
  try {
    const raw = localStorage.getItem(LS_SNAPSHOT_PREFIX + deliveryISO);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (_) {
    return null;
  }
}
function writeSnapshot(deliveryISO, items) {
  try {
    const obj = {};
    for (const it of items || []) {
      const pid = String(it.product_id ?? "");
      const qty = Number(it.qty ?? 0);
      if (pid && Number.isFinite(qty) && qty > 0) obj[pid] = qty;
    }
    localStorage.setItem(LS_SNAPSHOT_PREFIX + deliveryISO, JSON.stringify(obj));
  } catch (_) {}
}

export default function BecusPage() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const deliveryISO = useMemo(() => getCurrentBecusDeliveryISO(now), [now]);
  const lastWeekISO = useMemo(() => addDaysISO(deliveryISO, -7), [deliveryISO]);

  const cutoff = useMemo(() => getCutoffForDeliveryISO(deliveryISO), [deliveryISO]);
  const isBeforeCutoff = useMemo(() => now.getTime() <= cutoff.getTime(), [now, cutoff]);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const [products, setProducts] = useState([]);
  const [productById, setProductById] = useState({});

  const [wa, setWa] = useState({ phone: "", name: SUPPLIER_LABEL_FALLBACK });
  const [waDraft, setWaDraft] = useState("");

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);

  const [lastOrder, setLastOrder] = useState(null);
  const [lastItems, setLastItems] = useState([]);

  const [history, setHistory] = useState([]);

  const [missing, setMissing] = useState({}); // {pid:true}
  const [busyMissing, setBusyMissing] = useState(false);

  const [showInitialDetails, setShowInitialDetails] = useState(false);
  const [showLastDetails, setShowLastDetails] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      // Products
      const { data: prodData, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .eq("supplier_key", SUPPLIER_KEY)
        .order("dept", { ascending: true });
      if (prodErr) throw prodErr;

      const prods = prodData || [];
      const map = {};
      for (const p of prods) map[String(p.id)] = p;
      setProducts(prods);
      setProductById(map);

      // WhatsApp phone (DB then local fallback)
      const db = await getSupplierWhatsAppFromDB();
      let phone = (db.phone || "").toString();
      const local = (typeof window !== "undefined" && localStorage.getItem(LS_WA_PHONE)) || "";
      if (!phone && local) phone = local;
      setWa({ phone, name: db.name || SUPPLIER_LABEL_FALLBACK });
      setWaDraft(phone || "");

      // Current order (always exists)
      const o = await getOrCreateOrder(deliveryISO);
      setOrder(o);
      const its = o?.id ? await listItemsForOrder(o.id) : [];
      setItems(its);

      // Last week order (only if exists)
      const lo = await findOrderByDate(lastWeekISO);
      setLastOrder(lo);
      const lits = lo?.id ? await listItemsForOrder(lo.id) : [];
      setLastItems(lits);

      // History
      const hist = await listOrdersForHistory(120);
      const cleaned = (hist || [])
        .map((r) => {
          const date = r.delivery_date || r.delivery_day || r.date || r.day || r.created_at?.slice?.(0, 10) || "";
          return { ...r, _date: date };
        })
        .filter((r) => r._date);
      setHistory(cleaned);
    } catch (e) {
      setErrorText((e?.message || "Erreur de chargement.").toString());
    } finally {
      setLoading(false);
    }
  }, [deliveryISO, lastWeekISO]);

  useEffect(() => {
    if (!mounted) return;
    loadAll();
  }, [mounted, loadAll]);

  const totalInfo = useMemo(() => {
    let sum = 0;
    let missingPrices = 0;
    for (const it of items || []) {
      const p = productById[it.product_id];
      const pr = productPrice(p);
      if (pr == null) {
        missingPrices++;
        continue;
      }
      sum += pr * (Number(it.qty) || 0);
    }
    return { sum, missingPrices };
  }, [items, productById]);

  const lastTotalInfo = useMemo(() => {
    let sum = 0;
    let missingPrices = 0;
    for (const it of lastItems || []) {
      const p = productById[it.product_id];
      const pr = productPrice(p);
      if (pr == null) {
        missingPrices++;
        continue;
      }
      sum += pr * (Number(it.qty) || 0);
    }
    return { sum, missingPrices };
  }, [lastItems, productById]);

  const itemsByDept = useMemo(() => {
    const buckets = { vente: [], boulanger: [], patiss: [] };
    for (const it of items || []) {
      const p = productById[it.product_id];
      const dept = normDept(p?.dept);
      buckets[dept] = buckets[dept] || [];
      buckets[dept].push({ it, p });
    }
    return buckets;
  }, [items, productById]);

  const lastItemsByDept = useMemo(() => {
    const buckets = { vente: [], boulanger: [], patiss: [] };
    for (const it of lastItems || []) {
      const p = productById[it.product_id];
      const dept = normDept(p?.dept);
      buckets[dept] = buckets[dept] || [];
      buckets[dept].push({ it, p });
    }
    return buckets;
  }, [lastItems, productById]);

  const openOrder = useCallback(() => {
    router.push(`/suppliers/becus/order?date=${encodeURIComponent(deliveryISO)}`);
  }, [router, deliveryISO]);

  const openHistory = useCallback(
    (iso) => {
      router.push(`/suppliers/becus/history?date=${encodeURIComponent(iso)}`);
    },
    [router]
  );

  const saveLocalPhone = useCallback(() => {
    try {
      const cleaned = (waDraft || "").toString().trim();
      localStorage.setItem(LS_WA_PHONE, cleaned);
      setWa((prev) => ({ ...prev, phone: cleaned }));
      setErrorText("");
    } catch (e) {
      setErrorText("Impossible d’enregistrer le numéro sur cet appareil.");
    }
  }, [waDraft]);

  const waReady = useMemo(() => {
    const phone = (wa?.phone || "").toString().replace(/[^\d+]/g, "");
    return phone;
  }, [wa]);

  const canSendInitial = useMemo(() => {
    const hasItems = (items || []).length > 0;
    return isBeforeCutoff && hasItems && !!waReady;
  }, [items, isBeforeCutoff, waReady]);

  const orderStatus = (order?.status || order?.state || "draft").toString();

  const sendInitial = useCallback(async () => {
    setErrorText("");
    try {
      if (!isBeforeCutoff) {
        setErrorText("Fermé : mercredi 12:00 est passé. Impossible d’envoyer/modifier.");
        return;
      }
      if (!items?.length) {
        setErrorText("Commande vide : ajoute des produits avant d’envoyer.");
        return;
      }
      if (!waReady) {
        setErrorText("Numéro WhatsApp manquant (table suppliers / supplier_contacts ou configuration tablette).");
        return;
      }

      const text = buildInitialWhatsAppText({ deliveryISO, items, productById });
      const url = `https://wa.me/${encodeURIComponent(waReady)}?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener,noreferrer");

      // Mark as sent (best-effort)
      if (order?.id) {
        await updateOrderStatus(order.id, "sent");
      }
      // Save snapshot for deltas
      writeSnapshot(deliveryISO, items);

      // Refresh
      await loadAll();
    } catch (e) {
      setErrorText((e?.message || "Envoi WhatsApp impossible.").toString());
    }
  }, [deliveryISO, items, productById, waReady, isBeforeCutoff, order?.id, loadAll]);

  const deltaInfo = useMemo(() => {
    if (!mounted) return { text: "", hasChanges: false, kind: "none" };
    const snap = readSnapshot(deliveryISO) || {};
    return buildDeltaWhatsAppText({ deliveryISO, items, productById, snapshotMap: snap });
  }, [mounted, deliveryISO, items, productById]);

  const canSendDelta = useMemo(() => {
    if (!isBeforeCutoff) return false;
    if (!waReady) return false;
    if (!items?.length) return false;
    if (!deltaInfo?.hasChanges) return false;
    return true;
  }, [isBeforeCutoff, waReady, items, deltaInfo]);

  const sendDelta = useCallback(async () => {
    setErrorText("");
    try {
      if (!isBeforeCutoff) {
        setErrorText("Fermé : mercredi 12:00 est passé. Impossible d’envoyer/modifier.");
        return;
      }
      if (!waReady) {
        setErrorText("Numéro WhatsApp manquant (table suppliers / supplier_contacts ou configuration tablette).");
        return;
      }

      const snap = readSnapshot(deliveryISO) || {};
      const built = buildDeltaWhatsAppText({ deliveryISO, items, productById, snapshotMap: snap });
      if (!built.hasChanges || !built.text) {
        setErrorText("Aucun changement à envoyer.");
        return;
      }

      const url = `https://wa.me/${encodeURIComponent(waReady)}?text=${encodeURIComponent(built.text)}`;
      window.open(url, "_blank", "noopener,noreferrer");

      // Update snapshot baseline after message sent
      writeSnapshot(deliveryISO, items);

      // Keep status sent
      if (order?.id) await updateOrderStatus(order.id, "sent");

      await loadAll();
    } catch (e) {
      setErrorText((e?.message || "Envoi WhatsApp impossible.").toString());
    }
  }, [deliveryISO, items, productById, waReady, isBeforeCutoff, order?.id, loadAll]);

  
  const resetBaseline = useCallback(() => {
    try {
      writeSnapshot(deliveryISO, items);
      setErrorText("");
    } catch (_) {
      setErrorText("Impossible de réinitialiser la baseline sur cet appareil.");
    }
  }, [deliveryISO, items]);
const toggleMissing = useCallback(
    async (pid, qty, checked) => {
      if (!pid || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return;

      setMissing((prev) => ({ ...prev, [pid]: !!checked }));

      // when checked => add to next week automatically
      if (!checked) return;
      if (!order?.id) return;

      setBusyMissing(true);
      try {
        // read current qty
        const curQty = Number((items || []).find((x) => x.product_id === pid)?.qty ?? 0);
        const newQty = Math.min(999, curQty + Number(qty));
        await setItemQty(order.id, pid, newQty);
        await loadAll();
      } catch (e) {
        setErrorText((e?.message || "Impossible d’ajouter l’article manquant à la commande suivante.").toString());
      } finally {
        setBusyMissing(false);
      }
    },
    [order?.id, items, loadAll]
  );

  const validateLastWeek = useCallback(async () => {
    setErrorText("");
    if (!lastOrder?.id) return;
    setBusyMissing(true);
    try {
      await updateOrderStatus(lastOrder.id, "archived");
      await loadAll();
    } catch (e) {
      setErrorText((e?.message || "Validation impossible.").toString());
    } finally {
      setBusyMissing(false);
    }
  }, [lastOrder?.id, loadAll]);

  const renderDeptList = (bucket, title) => {
    const arr = bucket || [];
    if (!arr.length) return null;
    return (
      <div style={{ minWidth: 240, flex: 1 }}>
        <div style={styles.subTitle}>{title}</div>
        <div style={styles.list}>
          {arr.map(({ it, p }) => (
            <div key={it.product_id} style={styles.row}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                <span style={styles.emoji}>{productEmoji(p) || "📦"}</span>
                <span style={styles.name}>{productName(p)}</span>
              </div>
              <span style={styles.qty}>x{it.qty}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!mounted) return null;

  const phoneMissing = !waReady;
  const hasItems = (items || []).length > 0;

  const isSent = orderStatus !== "draft" && orderStatus !== "pending";
  const isArchived = orderStatus === "archived";

  const cutoffLabel = useMemo(() => {
    const d = cutoff;
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const yy = d.getFullYear();
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  }, [cutoff]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <Link href="/" style={styles.pillLink}>← Accueil</Link>
          <div style={{ minWidth: 0 }}>
            <div style={styles.h1}>🥖 Bécus</div>
            <div style={styles.h2}>Livraison : {isoDDMMslash(deliveryISO)}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ ...styles.badge, background: isBeforeCutoff ? "#DCFCE7" : "#FEE2E2", color: isBeforeCutoff ? "#166534" : "#991B1B" }}>
              {isBeforeCutoff ? "✅ Ouvert" : "⛔ Fermé"}
            </span>
            <span style={styles.mini}>Cutoff: mercredi 12:00 (avant livraison) • {cutoffLabel}</span>
          </div>
        </div>

        {/* Status / errors */}
        <div style={styles.statusCard}>
          {loading ? <div style={styles.mini}>Chargement…</div> : null}
          {errorText ? <div style={{ ...styles.mini, color: "#b91c1c" }}>{errorText}</div> : null}
          {phoneMissing ? (
            <div style={styles.phoneBox}>
              <div style={{ fontWeight: 900 }}>Numéro WhatsApp manquant</div>
              <div style={styles.mini}>
                Si la base bloque l’accès (RLS) sur tablette, tu peux enregistrer le numéro localement ici.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input
                  value={waDraft}
                  onChange={(e) => setWaDraft(e.target.value)}
                  placeholder="+33..."
                  style={styles.input}
                />
                <button onClick={saveLocalPhone} style={{ ...styles.btn, background: "#0ea5e9" }}>
                  Enregistrer sur cette tablette
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 1) Commande en cours */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <button onClick={openOrder} style={{ ...styles.btn, background: "#f97316" }} disabled={isArchived || (!isBeforeCutoff && isSent)}>
              ➕ Ajouter Produits
            </button>

            <div style={styles.centerTitle}>
              <div style={styles.cardTitle}>Commande en cours</div>
              <div style={styles.cardDate}>{isoDDMMYYYY(deliveryISO)}</div>
            </div>

            {!isSent ? (
              <button
                onClick={sendInitial}
                style={{ ...styles.btn, background: canSendInitial ? "#16a34a" : "#94a3b8" }}
                disabled={!canSendInitial}
                title={!isBeforeCutoff ? "Cutoff dépassé" : phoneMissing ? "Numéro WhatsApp manquant" : !hasItems ? "Commande vide" : ""}
              >
                💬 Envoyer WhatsApp
              </button>
            ) : (
              <button
                onClick={sendDelta}
                style={{ ...styles.btn, background: canSendDelta ? "#16a34a" : "#94a3b8" }}
                disabled={!canSendDelta}
                title={!isBeforeCutoff ? "Cutoff dépassé" : !deltaInfo?.hasChanges ? "Aucun changement" : ""}
              >
                💬 Envoyer ajout/modif
              </button>
            )}
          </div>

          {/* Summary */}
          <div style={styles.summaryRow}>
            <div style={styles.summaryPill}>
              <span style={{ fontWeight: 900 }}>{hasItems ? `${items.length} article(s)` : "Commande vide"}</span>
              {totalInfo.missingPrices < items.length && items.length > 0 ? (
                <span style={{ marginLeft: 10 }}>
                  Total estimé: <b>{fmtEUR(totalInfo.sum)}</b>
                  {totalInfo.missingPrices ? <span style={styles.mini}> • prix manquants: {totalInfo.missingPrices}</span> : null}
                </span>
              ) : null}
            </div>

            {isSent ? (
              <span style={{ ...styles.badge, background: "#E0F2FE", color: "#075985" }}>✅ Commande initiale envoyée</span>
            ) : (
              <span style={{ ...styles.badge, background: "#FEF3C7", color: "#92400E" }}>📝 Brouillon</span>
            )}
          </div>

          {/* Reduced view after send */}
          {isSent ? (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setShowInitialDetails((v) => !v)} style={styles.linkBtn}>
                {showInitialDetails ? "Masquer le détail" : "Voir le détail des produits"}
              </button>

              {showInitialDetails ? (
                <div style={styles.cols}>
                  {renderDeptList(itemsByDept.vente, "Vente")}
                  {renderDeptList(itemsByDept.boulanger, "Boulanger")}
                  {renderDeptList(itemsByDept.patiss, "Pâtissier")}
                </div>
              ) : null}

              {/* Ajout block */}
              <div style={styles.addBox}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>➕ Ajout / Modification</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={sendDelta}
                      style={{ ...styles.btn, background: canSendDelta ? "#16a34a" : "#94a3b8" }}
                      disabled={!canSendDelta}
                    >
                      Envoyer le message d’ajout/modif
                    </button>
                    <button
                      onClick={resetBaseline}
                      style={{ ...styles.btn, background: "#fff" }}
                      title="Remet la baseline (comparaison) sur l’état actuel, sans envoyer de message."
                    >
                      ↺ Baseline
                    </button>
                  </div>
                </div>

                {!isBeforeCutoff ? (
                  <div style={{ ...styles.mini, marginTop: 8, color: "#991B1B" }}>
                    Fermé: mercredi 12:00 est passé. Plus de modifications.
                  </div>
                ) : deltaInfo?.hasChanges ? (
                  <>
                    <div style={{ ...styles.mini, marginTop: 8 }}>
                      Aperçu du message:
                    </div>
                    <pre style={styles.pre}>{deltaInfo.text}</pre>
                  </>
                ) : (
                  <div style={{ ...styles.mini, marginTop: 8 }}>
                    Aucun changement depuis le dernier message envoyé.
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Not sent: show full list (3 columns) so it's visible
            <div style={{ marginTop: 12 }}>
              <div style={styles.cols}>
                {renderDeptList(itemsByDept.vente, "Vente")}
                {renderDeptList(itemsByDept.boulanger, "Boulanger")}
                {renderDeptList(itemsByDept.patiss, "Pâtissier")}
              </div>
            </div>
          )}
        </div>

        {/* 2) Commande de la semaine dernière */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <div style={styles.centerTitle}>
              <div style={styles.cardTitle}>Commande de la semaine dernière</div>
              <div style={styles.cardDate}>{isoDDMMYYYY(lastWeekISO)}</div>
            </div>
            <button onClick={() => openHistory(lastWeekISO)} style={styles.btn}>
              📄 Ouvrir (lecture)
            </button>
          </div>

          {!lastOrder?.id ? (
            <div style={styles.mini}>Aucune commande trouvée pour {isoDDMMslash(lastWeekISO)}.</div>
          ) : (String(lastOrder.status || lastOrder.state || "") === "archived") ? (
            <div style={styles.mini}>
              Cette commande est déjà archivée. (Lecture disponible via “Ouvrir”.)
            </div>
          ) : (
            <>
              <div style={styles.summaryRow}>
                <div style={styles.summaryPill}>
                  <span style={{ fontWeight: 900 }}>{lastItems.length} article(s)</span>
                  {lastTotalInfo.missingPrices < lastItems.length && lastItems.length > 0 ? (
                    <span style={{ marginLeft: 10 }}>
                      Total estimé: <b>{fmtEUR(lastTotalInfo.sum)}</b>
                      {lastTotalInfo.missingPrices ? <span style={styles.mini}> • prix manquants: {lastTotalInfo.missingPrices}</span> : null}
                    </span>
                  ) : null}
                </div>

                <button onClick={() => setShowLastDetails((v) => !v)} style={styles.linkBtn}>
                  {showLastDetails ? "Masquer détail" : "Voir détail + cocher manquants"}
                </button>
              </div>

              {showLastDetails ? (
                <div style={{ marginTop: 10 }}>
                  <div style={styles.mini}>
                    Coche les produits non reçus: ils seront ajoutés automatiquement à la commande suivante.
                  </div>

                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {lastItems.map((it) => {
                      const p = productById[it.product_id];
                      const name = productName(p);
                      const checked = !!missing[it.product_id];
                      return (
                        <label key={it.product_id} style={styles.missingRow}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busyMissing}
                            onChange={(e) => toggleMissing(it.product_id, it.qty, e.target.checked)}
                          />
                          <span style={{ marginLeft: 8, fontWeight: 900 }}>{name}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 900 }}>x{it.qty}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                    <button
                      onClick={validateLastWeek}
                      disabled={busyMissing || !lastOrder?.id}
                      style={{ ...styles.btn, background: "#0f172a" }}
                    >
                      ✅ Valider et archiver
                    </button>
                    {busyMissing ? <span style={styles.mini}>Traitement…</span> : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* 3) Historique */}
        <div style={styles.card}>
          <div style={styles.cardTopRow}>
            <div style={styles.centerTitle}>
              <div style={styles.cardTitle}>Historique</div>
              <div style={styles.mini}>Lecture seule / export</div>
            </div>
          </div>

          {!history?.length ? (
            <div style={styles.mini}>Aucun historique.</div>
          ) : (
            <div style={styles.historyList}>
              {history.map((r) => (
                <div key={r.id || r._date} style={styles.historyRow}>
                  <div style={{ fontWeight: 950 }}>{isoDDMMslash(r._date)}</div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button onClick={() => openHistory(r._date)} style={styles.btn}>Ouvrir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...styles.mini, textAlign: "center", marginTop: 12 }}>
          Astuce: si tu as “Ajouter à l’écran d’accueil” sur iPad, pense à vider le cache Safari après un gros patch.
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(900px 500px at 10% 0%, rgba(250,204,21,0.25), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(59,130,246,0.22), transparent 55%), linear-gradient(180deg, #f8fafc, #ffffff)",
    padding: 14,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0f172a",
  },
  container: { maxWidth: 1120, margin: "0 auto" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.85)",
    boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
    position: "sticky",
    top: 10,
    backdropFilter: "blur(10px)",
    zIndex: 5,
  },
  h1: { fontSize: 22, fontWeight: 950, lineHeight: 1.15 },
  h2: { fontSize: 13, fontWeight: 900, color: "rgba(15,23,42,0.65)" },
  pillLink: {
    textDecoration: "none",
    padding: "9px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 950,
    color: "#0f172a",
  },
  badge: {
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 950,
    border: "1px solid rgba(15,23,42,0.10)",
  },
  mini: { fontSize: 12, fontWeight: 850, color: "rgba(15,23,42,0.55)" },
  statusCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.85)",
    boxShadow: "0 10px 26px rgba(15,23,42,0.06)",
  },
  phoneBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    border: "1px dashed rgba(15,23,42,0.18)",
    background: "rgba(14,165,233,0.06)",
  },
  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.18)",
    fontWeight: 900,
    minWidth: 220,
    outline: "none",
  },
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
  },
  cardTopRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  centerTitle: {
    flex: 1,
    minWidth: 220,
    textAlign: "center",
  },
  cardTitle: { fontSize: 18, fontWeight: 950 },
  cardDate: { fontSize: 12, fontWeight: 950, color: "rgba(15,23,42,0.55)" },
  btn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#fff",
    fontWeight: 950,
    cursor: "pointer",
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    textDecoration: "underline",
    fontWeight: 950,
    color: "#0ea5e9",
  },
  summaryRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10, justifyContent: "space-between" },
  summaryPill: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(15,23,42,0.03)",
    fontWeight: 900,
  },
  cols: { display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 },
  subTitle: { fontSize: 13, fontWeight: 950, marginBottom: 8, color: "rgba(15,23,42,0.7)" },
  list: {
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(15,23,42,0.02)",
  },
  row: { display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid rgba(15,23,42,0.06)" },
  emoji: { width: 20, textAlign: "center" },
  name: { fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 },
  qty: { fontWeight: 950 },
  addBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(34,197,94,0.06)",
  },
  pre: {
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "#fff",
    whiteSpace: "pre-wrap",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  missingRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
  historyList: {
    marginTop: 10,
    display: "grid",
    gap: 8,
  },
  historyRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
};
