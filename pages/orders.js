// pages/orders.js
/* UX (additif après envoi) — v-orders-additive-delta-ui-split-2025-10-21
   - Séparation VISUELLE : "Commande initiale (envoyée)" (baseline) vs "Rajout (delta)"
   - En mode 'sent' : INSERT UNIQUEMENT les deltas (jamais d’UPDATE) — inchangé
   - NE PLUS ABSORBER les deltas dans le "baseline" local : la notion de "Rajout" reste visible
   - Verrouillage minimum = baseline (impossible de baisser en dessous après envoi)
   - Auto-sauvegarde (draft = replace, sent = insert deltas)
   - L’envoi WhatsApp (initial et rajout) se fait depuis l’accueil (index.js)
*/

/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { fmtISODate } from "../lib/date";

const BUILD_TAG = "v-orders-additive-delta-ui-split-2025-10-21";

const ORDER_COLUMNS = "id,status,delivery_date,supplier_key,supplier,sent_at,cutoff_at,created_at";
const SUPPLIERS = [
  { key: "becus",       label: "Bécus",         enabled: true,  allowedWeekdays: [4] },   // jeudi
  { key: "coupdepates", label: "Coup de Pâtes", enabled: false, allowedWeekdays: [3,5] }, // mercredi, vendredi
];
const TABS = [
  { key: "all", label: "Toutes" },
  { key: "vente", label: "Vente" },
  { key: "patiss", label: "Pâtisserie" },
  { key: "boulanger", label: "Boulangerie" },
  { key: "uncat", label: "Sans dept" },
];

/* ------------------ Helpers ------------------ */
const pad2 = (n) => String(n).padStart(2, "0");
const localDateAt = (isoDate, hh = 0, mm = 0) => new Date(`${isoDate}T${pad2(hh)}:${pad2(mm)}:00`);
const dayBefore = (isoDate) => { const d = new Date(`${isoDate}T00:00:00`); d.setDate(d.getDate()-1); return fmtISODate(d); };
const safeDept = (d) => (d ? String(d).toLowerCase() : "uncat");
const withDefaults = (rows=[]) => rows.map(r => ({ ...r, emoji: r.emoji || "🧺", dept: safeDept(r.dept) }));
const supplierLabel = (k) => (SUPPLIERS.find(x => x.key === k)?.label) || k || "—";
const dayNameFR = (n) => ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][n];
const formatHumanDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
const isValidOrderId = (v) => (typeof v === "string" ? v.length>0 : typeof v === "number" ? Number.isFinite(v) : false);
const normalize = (s) => (s ?? "").toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

// Transforme n’importe quel libellé en clé canonique
function deptKey(x = "") {
  const s = String(x).toLowerCase();
  if (/(vent|sale|store|magasin)/.test(s)) return "vente";
  if (/(patis|pâtis|patiss|dessert|sucr)/.test(s)) return "patiss";
  if (/(boul|bread|pain)/.test(s)) return "boulanger";
  return "uncat";
}
// Normalise le département d’un produit à partir de colonnes variées
function deptFrom(p = {}) {
  const raw = String(
    p.dept ??
    p.department ??
    p.departement ??
    p.category ??
    p.categorie ??
    p.type ??
    p.section ??
    p.family ??
    p.famille ??
    ""
  ).toLowerCase();
  return deptKey(raw);
}

function nextAllowedISO(baseISO, days){
  let d = new Date(`${baseISO}T00:00:00`);
  for (let i=0;i<14;i++){ if(days.includes(d.getDay())) return fmtISODate(d); d.setDate(d.getDate()+1); }
  return fmtISODate(d);
}
function explainSupabaseError(e) {
  const msg = e?.message || String(e);
  if (/row-level security/i.test(msg) || /violates row-level/i.test(msg)) return "Écriture bloquée par RLS. Ajoute des policies sur 'orders' et 'order_items'.";
  if (/permission denied/i.test(msg)) return "Permission refusée. Vérifie la clé anonyme et les policies RLS.";
  if (/relation .* does not exist/i.test(msg)) return "Table/vue introuvable (schéma ?). Vérifie que la table existe dans 'public'.";
  if (/column .* does not exist/i.test(msg)) return "Colonne manquante. Vérifie/ajoute les colonnes (voir script SQL).";
  return msg;
}
function suggestNextThursdayISO() { const d = new Date(); const delta = (4 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + delta); return fmtISODate(d); }

/* ---------- Baseline (mémorise l'état au moment de l’envoi initial, gérée par index.js) ---------- */
const baselineKey = (orderId) => `sentBaseline:${orderId}`;
function loadBaseline(orderId) {
  try {
    const raw = localStorage.getItem(baselineKey(orderId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.items)) return obj;
  } catch {}
  return null;
}
function compressByProduct(items=[]) {
  const sums = new Map();
  for (const it of items) {
    const id = String(it.product_id || "");
    if (!id) continue;
    const q = Math.max(0, Number(it.qty) || 0);
    sums.set(id, (sums.get(id) || 0) + q);
  }
  return Array.from(sums.entries()).map(([product_id, qty]) => ({ product_id, qty }));
}

/* ------------------ Page ------------------ */
export default function OrdersPage() {
  const router = useRouter();
  const ready = router.isReady;

  // URL -> état
  const [supplier, setSupplier] = useState(SUPPLIERS[0].key);
  const [delivery, setDelivery] = useState(suggestNextThursdayISO());
  useEffect(() => {
    if (!ready) return;
    const s = (router.query.supplier ?? SUPPLIERS[0].key).toString();
    const d = (router.query.delivery ?? "").toString();
    setSupplier(s || SUPPLIERS[0].key);
    setDelivery(d || suggestNextThursdayISO());
  }, [ready, router.query.supplier, router.query.delivery]);

  // Clé de sauvegarde locale
  const draftKey = useMemo(() => `orders_draft_${supplier}_${delivery}`, [supplier, delivery]);

  // Mode Réception (#reception)
  const [isReception, setIsReception] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsReception((window.location.hash || "").includes("reception"));
    }
  }, [router.asPath]);

  // ------------------ Commande ------------------
  const [order, setOrder] = useState(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [uiMsg, setUiMsg] = useState(null);

  // Affichage date
  const displayDateISO = useMemo(() => (isReception ? (order?.delivery_date || delivery) : delivery), [isReception, order?.delivery_date, delivery]);
  const meta = useMemo(() => SUPPLIERS.find(x => x.key === supplier) || SUPPLIERS[0], [supplier]);

  // Produits & favoris
  const [products, setProducts] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Sélection (quantités désirées à l’instant t)
  const [selected, setSelected] = useState({}); // { [productId]: { checked, qty } }

  // Baseline (quantités envoyées à l’envoi initial = figé)
  const [baselineMap, setBaselineMap] = useState({}); // { [productId]: qty }

  const [hydrated, setHydrated] = useState(false);

  // Recadrage date (mode normal uniquement) — Bécus = jeudi (pas d’input)
  useEffect(() => {
    if (!delivery || !meta?.allowedWeekdays?.length) return;
    if (isReception) return;
    const d = new Date(delivery);
    if (!meta.allowedWeekdays.includes(d.getDay())) {
      setDelivery(nextAllowedISO(delivery, meta.allowedWeekdays));
    }
  }, [supplier, delivery, meta?.allowedWeekdays, isReception]);

  /* ---------- Sélecteurs dynamiques (tolèrent colonnes manquantes) ---------- */
  async function pickProductsSelect() { return { sel: "*" }; }

  /* ------------- CHARGE Produits (mode normal) ------------- */
  useEffect(() => {
    if (!ready) return;
    if (isReception) return;
    (async () => {
      if (!supplier) return;
      const { sel } = await pickProductsSelect();
      const label = supplierLabel(supplier);
      let data = [];

      // 1) supplier_key
      let r1 = await supabase.from("products").select(sel).eq("supplier_key", supplier).limit(2000);
      if (!r1.error) data = r1.data || [];

      // 2) supplier label exact
      if ((data || []).length === 0) {
        let r2 = await supabase.from("products").select(sel).eq("supplier", label).limit(2000);
        if (!r2.error) data = r2.data || [];
      }

      // 3) ilike
      if ((data || []).length === 0) {
        let r3 = await supabase.from("products").select(sel).ilike("supplier", `%${supplier}%`).limit(2000);
        if (!r3.error) data = r3.data || [];
        if ((data || []).length === 0 && label !== supplier) {
          let r3b = await supabase.from("products").select(sel).ilike("supplier", `%${label}%`).limit(2000);
          if (!r3b.error) data = r3b.data || [];
        }
      }

      // 4) fallback (tous)
      if ((data || []).length === 0) {
        let r4 = await supabase.from("products").select(sel).limit(2000);
        if (!r4.error && r4.data) {
          const target = new Set([normalize(supplier), normalize(label)]);
          const all = r4.data || [];
          data = all.filter(p => {
            const k = normalize(p?.supplier_key);
            const s = normalize(p?.supplier);
            return target.has(k) || target.has(s) || (s && (s.includes(normalize(supplier)) || s.includes(normalize(label))));
          });
        }
      }

      // 5) dernier filet : tout actif
      if ((data || []).length === 0) {
        let r5 = await supabase.from("products").select(sel).limit(2000);
        if (!r5.error && r5.data) data = r5.data;
      }

      data = (data || []).filter(p => p.is_active !== false && p.active !== false);
      setProducts(withDefaults(data));

      const favs = await supabase
        .from("supplier_favorites")
        .select("product_id")
        .eq('supplier_key', supplier)
        .limit(500);
      if (!favs.error) setFavorites(new Set((favs.data || []).map(f => f.product_id)));
    })();
  }, [ready, supplier, isReception]);

  /* --------- SAUVEGARDE LOCALE + RESTAURATION ---------- */
  const cleanSelectedMap = (obj) => {
    const out = {};
    for (const [k,v] of Object.entries(obj || {})) {
      const ks = String(k); if (!ks || ks==="undefined" || ks==="null") continue;
      const qty = Math.max(0, Number(v?.qty) || 0);
      out[ks] = { checked: !!v?.checked && qty > 0, qty };
    }
    return out;
  };

  useEffect(() => {
    if (!ready || isReception) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object" && obj.selected) {
          setSelected(cleanSelectedMap(obj.selected));
        }
      }
    } catch {}
  }, [ready, draftKey, isReception]);

  useEffect(() => {
    if (!ready || isReception) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ selected, ts: Date.now() }));
    } catch {}
  }, [ready, isReception, draftKey, selected]);

  /* ------------- CHARGE commande + baseline + items ------------- */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      if (!supplier || !delivery) return;

      setLoadingOrder(true);
      setOrder(null);

      const lookupISO = delivery;

      const makeBase = () =>
        supabase.from("orders")
          .select(ORDER_COLUMNS)
          .eq("delivery_date", lookupISO)
          .or("status.eq.draft,status.eq.sent")
          .order("created_at", { ascending: false })
          .limit(1);

      let exact = await makeBase().eq("supplier_key", supplier).maybeSingle();
      if (!exact.data) { exact = await makeBase().eq("supplier", supplier).maybeSingle(); }
      if (!exact.data) { exact = await makeBase().eq("supplier", supplierLabel(supplier)).maybeSingle(); }

      if (exact.data) setOrder(exact.data);
      setLoadingOrder(false);
    })();
  }, [ready, supplier, delivery]);

  // items existants -> somme par produit (état "courant" en base)
  const [serverMap, setServerMap] = useState({});
  useEffect(() => {
    if (!ready) return;
    if (!order?.id) { setServerMap({}); setBaselineMap({}); setSelected({}); setHydrated(true); return; }
    (async () => {
      // 1) CARTOGRAPHIE COURANTE EN BASE
      const { data: items, error } = await supabase
        .from("order_items")
        .select("product_id, qty")
        .eq("order_id", order.id);
      if (error) { setUiMsg({ type:'error', text:'Lecture items : ' + explainSupabaseError(error) }); return; }

      const sums = {};
      for (const it of (items || [])) {
        const pid = String(it.product_id || "");
        if (!pid) continue;
        const q = Math.max(0, Number(it.qty) || 0);
        sums[pid] = (sums[pid] || 0) + q;
      }
      setServerMap(sums);

      // 2) BASELINE (quantités au moment de l’envoi initial)
      const base = loadBaseline(order.id);
      const baseline = {};
      for (const it of (base?.items || [])) baseline[String(it.product_id)] = Number(it.qty)||0;
      setBaselineMap(baseline);

      // 3) SÉLECTION INITIALE = état courant (pour l’édition)
      //    (en 'sent', ça correspond au "baseline + deltas déjà insérés")
      const fromServer = Object.fromEntries(
        Object.entries(sums).map(([pid,q]) => [pid, { checked: q > 0, qty: Math.max(1, q) }])
      );

      // merge avec draft local
      let localSel = {};
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) localSel = cleanSelectedMap((JSON.parse(raw)?.selected) || {});
      } catch {}
      // On prend la quantité la plus haute entre local et server (évite de "baisser" par erreur)
      const merged = { ...fromServer };
      for (const [pid, v] of Object.entries(localSel)) {
        const cur = merged[pid]?.qty || 0;
        const next = Math.max(cur, Number(v.qty)||0);
        if (v.checked && next > 0) merged[pid] = { checked: true, qty: next };
      }
      setSelected(merged);
      setHydrated(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, order?.id]);

  /* ---------- État 'sent' & cut-off ---------- */
  const isSent = (order?.status || "draft") === "sent";
  const dayBeforeISO = dayBefore(delivery);
  const cutOffDate = useMemo(() => localDateAt(dayBeforeISO, 12, 0), [dayBeforeISO]);
  const canModify = useMemo(() => !isSent || new Date() <= cutOffDate, [isSent, cutOffDate]);
  const readOnly = !canModify;

  /* ------------------ Aides ------------------ */
  const productById = (id) => products.find(p => String(p.id) === String(id));
  const baseQty = (pid) => Number(baselineMap[String(pid)] || 0);
  const isLocked = (pid) => isSent && baseQty(pid) > 0;

  function selectionToItems(orderId) {
    const oid = isValidOrderId(orderId) ? orderId : null;
    return Object.entries(selected)
      .filter(([_, v]) => v?.checked && Number(v.qty) > 0)
      .map(([pid, v]) => {
        const pidStr = String(pid);
        const product = productById(pidStr) || {};
        const kdept = deptKey(product ? deptFrom(product) : "");
        const qty = Math.max(1, Number(v.qty) || 1);
        return {
          order_id: oid,
          product_id: pidStr,
          product_name: product.name ?? "",
          unit_price: product.price ?? 0,
          qty,
          _dept_ui: kdept, // local only
        };
      });
  }

  // Deltas (RAJOUT) = sélection - baseline (jamais négatif)
  const rajoutList = useMemo(() => {
    const out = [];
    for (const [pid, v] of Object.entries(selected)) {
      const s = Number(v?.qty) || 0;
      const b = baseQty(pid);
      const delta = s - b;
      if (v?.checked && delta > 0) {
        const p = productById(pid) || {};
        out.push({
          product_id: String(pid),
          product_name: p.name || "",
          dept: deptKey(deptFrom(p)),
          delta,
          base: b,
          desired: s,
        });
      }
    }
    // tri léger par dept puis nom
    out.sort((a,b)=>{
      if (a.dept !== b.dept) return a.dept.localeCompare(b.dept);
      return a.product_name.localeCompare(b.product_name);
    });
    return out;
  }, [selected, baselineMap, products]);

  // Totaux €
  const summary = useMemo(() => {
    const lines = selectionToItems(order?.id || null);
    const grouped = { vente:[], patiss:[], boulanger:[], uncat:[] };
    for (const l of lines) grouped[l._dept_ui || "uncat"].push(l);
    const total = lines.reduce((acc, l) => acc + (Number(l.unit_price)||0) * (Number(l.qty)||0), 0);
    return { lines, grouped, total };
  }, [selected, products, order?.id]);

  /* ------------------ CRUD / Auto-sauvegarde ------------------ */
  async function ensureOrderDraft() {
    if (order?.id && isValidOrderId(order.id)) return order;
    const { data, error } = await supabase
      .from("orders")
      .upsert(
        { supplier_key: supplier, delivery_date: delivery, status: "draft" },
        { onConflict: "supplier_key,delivery_date" }
      )
      .select("id,status,delivery_date,supplier_key,sent_at,cutoff_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    if (!isValidOrderId(data?.id)) throw new Error("id de commande invalide");
    setOrder(data);
    return data;
  }

  const mapAllowed = (arr, orderId) =>
    arr.map(({ product_id, product_name, unit_price, qty }) =>
      ({ order_id: orderId, product_id, product_name, unit_price, qty })
    );

  // ----- SAUVEGARDE (DRAFT = replace ; SENT = insert deltas) -----
  async function saveOrderItems(orderId) {
    const picked = selectionToItems(orderId);
    if (!isValidOrderId(orderId)) return;

    const nowISO = new Date().toISOString();

    if (!isSent) {
      // DRAFT : delete + insert propre (1 ligne par produit)
      const { error: delErr } = await supabase.from("order_items").delete().eq("order_id", orderId);
      if (delErr) throw new Error(delErr.message);

      const payload = mapAllowed(picked, orderId);
      if (payload.length) {
        const { error: insErr } = await supabase.from("order_items").insert(payload);
        if (insErr) throw new Error(insErr.message);
      }
    } else {
      // SENT : ADDITIF STRICT → INSERT UNIQUEMENT LES DELTAS (jamais d'UPDATE)
      const toInsert = [];
      for (const it of picked) {
        const b = baseQty(it.product_id);
        const desired = Number(it.qty || 0);
        if (desired <= b) continue; // pas de baisse
        const delta = desired - b;
        toInsert.push({
          order_id: orderId,
          product_id: it.product_id,
          product_name: it.product_name || "",
          unit_price: it.unit_price || 0,
          qty: delta,
        });
      }

      if (toInsert.length) {
        const ins = await supabase.from("order_items").insert(toInsert);
        if (ins.error) throw new Error(ins.error.message);
        // ⚠️ NE PAS ABSORBER DANS baselineMap ICI !
        // C’est l’accueil (index.js) qui "absorbe" le rajout après envoi WhatsApp
      }
    }

    // Mise à jour last_ordered_at (best-effort)
    const ids = picked.map(i => i.product_id);
    if (ids.length) {
      try { await supabase.from("products").update({ last_ordered_at: nowISO }).in("id", ids); } catch {}
    }
  }

  const autosaveTimer = useRef(null);
  const lastSavedKey = useRef("");

  useEffect(() => {
    if (!ready || isReception || !supplier || !delivery || !hydrated || !canModify) return;

    const oId = isValidOrderId(order?.id) ? order.id : null;
    const lines = selectionToItems(oId);
    const key = JSON.stringify(lines.map(l => [l.product_id, l.qty]));

    if (lines.length === 0 && !oId) return;
    if (lastSavedKey.current === key) return;

    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const o = oId || await ensureOrderDraft();
        await saveOrderItems(o.id);
        lastSavedKey.current = key;
        setUiMsg({ type: "info", text: "Auto-sauvegardé ✅" });

        // ⚠️ IMPORTANT : on NE TOUCHE PLUS à baselineMap ici (sinon on "mange" le rajout visuellement)
        // Le baseline reste celui sauvegardé lors de l’envoi initial (index.js)
      } catch (e) {
        setUiMsg({ type: "error", text: "Auto-sauvegarde : " + explainSupabaseError(e) });
      }
    }, 600);

    return () => clearTimeout(autosaveTimer.current);
  }, [ready, supplier, delivery, isReception, selected, hydrated, canModify, order?.id]);

  async function saveNow(redirectHome = true) {
    try {
      const o = isValidOrderId(order?.id) ? order : await ensureOrderDraft();
      await saveOrderItems(o.id);
      setUiMsg({ type: "success", text: "Commande sauvegardée ✅" });
      try { localStorage.setItem(draftKey, JSON.stringify({ selected, ts: Date.now() })); } catch {}

      // On n’absorbe pas dans baselineMap (voir plus haut)
      if (redirectHome) router.push("/");
    } catch (e) {
      setUiMsg({ type: "error", text: "Sauvegarde : " + explainSupabaseError(e) });
    }
  }

  /* ------------------ Filtrage Produits ------------------ */
  const filtered = useMemo(() => {
    const s = (search || "").trim().toLowerCase();
    return (products || []).filter(p => {
      const key = deptKey(deptFrom(p));
      const txt = (p.name || "").toLowerCase();
      const deptOk =
        activeTab === "all" ? true :
        activeTab === "uncat" ? !key || key==="uncat" :
        key === activeTab;
      return deptOk && (!s || txt.includes(s));
    });
  }, [products, activeTab, search]);

  /* ------------------ Render ------------------ */
  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:16 }}>
      {/* Top bar — 1 ligne */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
        <Link href="/"><button style={btnStyleMuted()}>← Accueil</button></Link>

        <div style={{ padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:999, background:"#f9f9f9", fontWeight:800 }}>
          {supplierLabel(supplier)}
        </div>

        <div style={{ color:"#222", fontWeight:700 }}>
          Livraison : {formatHumanDate(displayDateISO)}
        </div>

        <div style={{ flex:1 }} />

        {!isReception && (
          <button onClick={()=>saveNow(true)} style={btnStyle("#0d6efd")} disabled={readOnly && !isSent}>
            💾 Valider
          </button>
        )}

        {!isReception && (
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontSize:12, padding:"4px 8px", background:"#eef7ee", border:"1px solid #bfe3bf", borderRadius:999, fontWeight:800 }}>
              Auto-sauvegarde
            </div>
            {isSent && (
              <div style={{ fontSize:12, padding:"4px 8px", background:"#e6f4ea", border:"1px solid #34a853", borderRadius:999, fontWeight:800 }}>
                Envoyée ✅ — Ajouts possibles jusqu’à J-1 12:00
              </div>
            )}
          </div>
        )}
      </div>

      {uiMsg && (
        <div style={msgStyle(uiMsg.type)}>
          <span>{uiMsg.text}</span>
          <button onClick={() => setUiMsg(null)} style={linkClearStyle()}>Fermer</button>
        </div>
      )}

      {!isReception && (
        <div style={{ fontSize:13, color:"#666", marginBottom:8 }}>
          {isSent
            ? <>Commande <b>envoyée</b>. Ajouts possibles jusqu’à <b>J-1 12:00</b> (rajout envoyé depuis l’accueil).</>
            : <>Sélections auto-sauvegardées. L’<b>envoi</b> se fait depuis l’accueil (“Bécus → WhatsApp”).</>}
        </div>
      )}

      {/* --------- PANNEAUX INITIAL / RAJOUT --------- */}
      {!isReception && (
        <>
          {/* COMMANDE INITIALE (baseline) */}
          <div style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
            <div style={{ fontWeight:800, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
              <span>🧾 Commande initiale (envoyée)</span>
              <span style={badgeStyle()}>{Object.keys(baselineMap).length} ligne(s)</span>
            </div>
            {Object.keys(baselineMap).length === 0 ? (
              <div style={{ color:"#666" }}>Aucune baseline — la commande n’a pas encore été envoyée.</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10 }}>
                {Object.entries(baselineMap).map(([pid, q]) => {
                  const p = productById(pid);
                  return (
                    <div key={pid} style={{ border:"1px dashed #ddd", borderRadius:10, padding:10 }}>
                      <div style={{ fontWeight:700, display:"flex", justifyContent:"space-between", gap:10 }}>
                        <span>{p?.name || "Produit"}</span>
                        <span style={chipStyle("#eef2ff")}>{deptKey(deptFrom(p))}</span>
                      </div>
                      <div style={{ marginTop:6, fontSize:13 }}>
                        Quantité envoyée&nbsp;: <b>{q}</b>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RAJOUT (delta = sélection - baseline) */}
          <div style={{ background:"#fff", border:"1px solid #93c5fd", borderRadius:12, padding:12, margin:"12px 0", backgroundColor:"#eff6ff" }}>
            <div style={{ fontWeight:800, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
              <span>➕ Rajout (en cours — non envoyé)</span>
              <span style={badgeStyle()}>{rajoutList.length} ligne(s)</span>
            </div>

            {rajoutList.length === 0 ? (
              <div style={{ color:"#666" }}>Aucun rajout en cours.</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10 }}>
                {rajoutList.map(l => {
                  const pid = l.product_id;
                  const p = productById(pid);
                  const minDelta = 1;
                  const maxDelta = 20; // delta UI max
                  const currentDelta = Math.max(minDelta, Math.min(maxDelta, l.delta));

                  return (
                    <div key={pid} style={{ border:"1px dashed #bfdbfe", borderRadius:10, padding:10 }}>
                      <div style={{ fontWeight:700, display:"flex", justifyContent:"space-between", gap:10 }}>
                        <span>{p?.name || "Produit"}</span>
                        <span style={chipStyle("#dbeafe")}>{l.dept}</span>
                      </div>

                      <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:8 }}>
                        <span style={smallBadge()}>Rajout</span>
                        <QtySelect
                          value={currentDelta}
                          min={minDelta}
                          disabled={readOnly}
                          onChange={(qDelta)=>{
                            const nextDesired = baseQty(pid) + Math.max(minDelta, qDelta);
                            setSelected(prev => ({ ...prev, [pid]: { checked:true, qty: nextDesired } }));
                          }}
                        />
                        <button
                          onClick={() => setSelected(prev => ({ ...prev, [pid]: { checked:true, qty: baseQty(pid) } }))}
                          style={btnSmallDanger(readOnly)}
                          disabled={readOnly}
                          title="Retirer ce rajout"
                        >
                          Retirer
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* --------- PRODUITS (édition) --------- */}
      {!isReception && (
        <div id="produits" style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <div style={{ fontWeight:800 }}>Produits</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginLeft:12 }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(activeTab === t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle(false), marginLeft:"auto", minWidth:220 }} />
          </div>

          <div style={{ color:"#666", fontSize:12, marginBottom:8 }}>
            {readOnly ? "Commande verrouillée (cut-off passé)." : "Sélectionne et règle les quantités. En 'envoyée', le minimum par produit est figé à la quantité initiale."}
          </div>

          <div className="productsGrid" style={gridStyle()}>
            {filtered.map(p => {
              const pid = String(p.id);
              const cur = selected[pid] || { checked: false, qty: 1 };
              const fav = favorites.has(p.id);
              const b = baseQty(pid);
              const locked = isLocked(pid);
              const isOn = !!cur.checked && Number(cur.qty)>0;
              const minQty = locked ? Math.min(20, Math.max(1, b)) : 1;

              return (
                <div key={pid} style={productStyle(isOn)}>
                  {/* Checkbox : ne doit pas permettre de descendre en-dessous du baseline */}
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => {
                      setSelected(prev => {
                        const old = prev[pid] || { checked: false, qty: Math.max(1, b || 1) };
                        const nextChecked = !old.checked;
                        if (!nextChecked) {
                          // Si on décoche un produit "locké", on revient au baseline (pas 0)
                          if (locked) return { ...prev, [pid]: { checked:true, qty: b || 1 } };
                          return { ...prev, [pid]: { checked:false, qty:0 } };
                        }
                        const qty = Math.max(minQty, Number(old.qty) || minQty);
                        return { ...prev, [pid]: { checked:true, qty } };
                      });
                    }}
                  />

                  <div style={{ width:28, display:"flex", justifyContent:"center" }}>
                    {renderThumb(p)}
                  </div>

                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    <div style={{ fontWeight:700 }}>{p.name} {fav && <span style={{ color:"#e6b800", fontSize:12, marginLeft:4 }}>★</span>}</div>
                    <div style={{ color:"#666", fontSize:12 }}>{(deptFrom(p) || "—")} • {(p.unit || "u")} • {((p.price ?? 0)).toFixed(2)}€ {locked && <em style={{ marginLeft:6, color:"#999" }}>(min {b})</em>}</div>
                  </div>

                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <QtySelect
                      value={cur.qty}
                      min={minQty}
                      disabled={readOnly}
                      onChange={(q)=> setSelected(prev => {
                        const nextQ = Math.max(minQty, q);
                        return { ...prev, [pid]: { checked: nextQ>0, qty: nextQ } };
                      })}
                    />
                    {!locked && isOn && (
                      <button
                        onClick={() => setSelected(prev => ({ ...prev, [pid]: { checked:false, qty:0 } }))}
                        style={btnSmallDanger(readOnly)}
                        disabled={readOnly}
                        title="Retirer de la commande"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --------- RÉSUMÉ GLOBAL (facultatif, comme avant) --------- */}
      {!isReception && (
        <div id="resume" style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
          <div style={{ fontWeight:800, marginBottom:10 }}>
            Commande {isSent ? "envoyée — ajouts possibles jusqu’à J-1 12:00" : "en préparation (auto-sauvegardée)"} — par département
            {readOnly && <span style={{ marginLeft:10, fontSize:12, color:"#b00020" }}>(lecture seule)</span>}
          </div>
          {summary.lines.length === 0 && <div style={{ color:"#666" }}>Aucun article sélectionné.</div>}
          {summary.lines.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:12 }}>
              {[
                ["vente","Vente"],
                ["patiss","Pâtisserie"],
                ["boulanger","Boulangerie"]
              ].map(([k,label]) => (
                <div key={k} style={{ border:"1px dashed #ddd", borderRadius:10, padding:10, minHeight:120 }}>
                  <div style={{ fontWeight:800, marginBottom:8 }}>{label}</div>
                  {(summary.grouped[k] || []).length === 0 && (
                    <div style={{ color:"#666", fontSize:13 }}>Aucun article.</div>
                  )}
                  {(summary.grouped[k] || []).map(l => {
                    const pid = String(l.product_id);
                    const b = baseQty(pid);
                    const locked = isLocked(pid);
                    const minQty = locked ? Math.min(20, Math.max(1, b)) : 1;
                    return (
                      <div key={pid} style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", alignItems:"center", gap:10, marginBottom:6, opacity: locked ? 0.95 : 1 }}>
                        <div style={{ fontWeight:700 }}>
                          {l.product_name}{locked && <span style={{ marginLeft:6, fontSize:12, color:"#999" }}>— figé (min {b})</span>}
                        </div>
                        <QtySelect
                          value={l.qty}
                          min={minQty}
                          disabled={readOnly}
                          onChange={(q)=> setSelected(prev => {
                            const nextQ = Math.max(minQty, q);
                            return { ...prev, [pid]: { checked: nextQ>0, qty: nextQ } };
                          })}
                        />
                        {!locked && (
                          <button
                            onClick={() => setSelected(prev => ({ ...prev, [pid]: { checked:false, qty:0 } }))}
                            style={btnSmallDanger(readOnly)}
                            disabled={readOnly}
                            title="Retirer de la commande"
                          >
                            Retirer
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {summary.lines.length > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
              <div />
              <div style={{ fontWeight:900, fontSize:16 }}>
                Total: {summary.total.toFixed(2)} €
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .productsGrid {
          display: grid;
          grid-template-columns: repeat(1, minmax(0,1fr));
          gap: 8px;
        }
        @media (min-width: 700px) {
          .productsGrid {
            grid-template-columns: repeat(2, minmax(0,1fr));
          }
        }
        @media (min-width: 1000px) {
          .productsGrid {
            grid-template-columns: repeat(3, minmax(0,1fr));
          }
        }
      `}</style>
    </div>
  );
}

/* ------------------ helpers visuels ------------------ */
function renderThumb(p){
  const url = p?.image_url || p?.photo_url || p?.image || p?.thumbnail || p?.photo || p?.url_photo || p?.imageUrl || p?.imageURL || p?.picture || p?.pic || p?.url || null;
  const emoji = p?.emoji;
  if (url) return <img src={url} alt="" style={{ width:28, height:28, objectFit:"cover", borderRadius:6, border:"1px solid #eee" }} />;
  if (emoji) return <span aria-hidden style={{ fontSize:20, width:24, textAlign:"center" }}>{emoji}</span>;
  return <span aria-hidden style={{ fontSize:18, opacity:0.4 }}>🍞</span>;
}

function QtySelect({ value, min=1, disabled, onChange }){
  const vNum = Number(value) || 0;
  const minClamped = Math.min(20, Math.max(1, Number(min) || 1));
  const val = Math.max(minClamped, Math.min(20, vNum || minClamped));
  const opts = Array.from({length: 20 - minClamped + 1}, (_,i)=> i + minClamped);
  return (
    <select
      value={val}
      disabled={disabled}
      onChange={(e)=> onChange(Number(e.target.value)||minClamped)}
      style={selectStyle(disabled)}
    >
      {opts.map(n => (<option key={n} value={n}>{n}</option>))}
    </select>
  );
}

/* ------------------ styles ------------------ */
function selectStyle(disabled){ return { padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:8, background: disabled ? "#f5f5f5" : "#fff" }; }
function inputStyle(disabled) { return { padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:8, background: disabled ? "#f5f5f5" : "#fff" }; }
function btnStyle(bg) { return { background: bg || "#111", color:"#fff", border:"none", borderRadius:10, padding:"10px 14px", cursor:"pointer", fontWeight:800 }; }
function btnStyleMuted() { return { background:"#f1f1f1", color:"#111", border:"1px solid #ddd", borderRadius:10, padding:"8px 12px", cursor:"pointer" }; }
function btnSmallDanger(disabled){ return { background: disabled ? "#f5f5f5" : "#fee2e2", color: disabled ? "#999" : "#991b1b", border:"1px solid #fca5a5", borderRadius:8, padding:"6px 10px", cursor: disabled ? "not-allowed" : "pointer", fontWeight:800, fontSize:12 }; }
function tabStyle(active) { return { border:"1px solid #e8e8e8", background: active ? "#111" : "#f5f5f5", color: active ? "#fff" : "#111", borderRadius:10, padding:"6px 10px", cursor:"pointer" }; }
function gridStyle() { return { display:"grid", gridTemplateColumns:"repeat(1, minmax(0,1fr))", gap:8 }; }
function productStyle(checked) { return { display:"grid", gridTemplateColumns:"auto auto 1fr auto", alignItems:"center", gap:10, border:"1px solid #e8e8e8", borderRadius:10, padding:10, background: checked ? "#f7fff7" : "#fff" }; }
function linkClearStyle() { return { background:"none", border:"none", color:"#111", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 }; }
function badgeStyle(){ return { background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:999, padding:"3px 10px", fontSize:12, fontWeight:800 }; }
function chipStyle(bg){ return { background:bg||"#f1f5f9", border:"1px solid #e5e7eb", borderRadius:999, padding:"2px 8px", fontSize:12, fontWeight:700 }; }
function smallBadge(){ return { background:"#fff", border:"1px solid #c7d2fe", borderRadius:999, padding:"2px 8px", fontSize:12, fontWeight:700, color:"#1d4ed8" }; }
function msgStyle(type) {
  const map = { success: ["#e6f4ea","#34a853"], error: ["#fdecea","#d93025"], info:["#eef4ff","#1a73e8"] };
  const [bg, bd] = map[type] || ["#f5f5f5","#888"];
  return { background:bg, border:`1px solid ${bd}`, color:"#111", padding:"8px 12px", borderRadius:10, fontSize:14, display:"flex", alignItems:"center", gap:8 };
}
