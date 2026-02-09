// components/OrdersCore.jsx
/* OrdersCore — v-orders-2025-10-29-rajout-totals
   - Séparation par fournisseur via prop forcedSupplier ("becus" | "coupdepates" | "moulins")
   - NE PAS mélanger les produits : SELECT * FROM products WHERE supplier_key = forcedSupplier
   - Baseline ignorée tant que la commande n’est PAS envoyée
   - Auto-sauvegarde : localStorage + Supabase (debounce)
   - WA stash pour la bannière d’envoi de l’accueil

   PATCH 2025-10-26:
   - SENT: évite les doublons en base.

   PATCH 2025-10-29:
   - SENT: on **enregistre le total désiré** (baseline + rajout) dans order_items,
     au lieu d’écraser par le delta. Le rajout est calculé en UI (desired - baseline).
   - Bouton ← Retour activable via prop showBackButton (sinon ← Accueil).
*/

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { fmtISODate } from "../lib/date";
import BackToBecusButton from "./BackToBecusButton.jsx";

/* ---------- Constantes ---------- */
const BUILD_TAG = "v-orders-2025-10-29-rajout-totals";

const SUPPLIERS_META = {
  becus:       { key:"becus",       label:"Bécus",             allowedWeekdays:[4] },   // Jeudi
  coupdepates: { key:"coupdepates", label:"Coup de Pâtes",     allowedWeekdays:[3,5] }, // Mer / Ven
  moulins:     { key:"moulins",     label:"Moulins Bourgeois", allowedWeekdays:[4] },   // Jeudi
};

const ORDER_COLUMNS = "id,status,delivery_date,supplier_key,supplier,sent_at,cutoff_at,created_at";

const TABS = [
  { key:"all",       label:"Toutes" },
  { key:"vente",     label:"Vente" },
  { key:"patiss",    label:"Pâtisserie" },
  { key:"boulanger", label:"Boulangerie" },
  { key:"uncat",     label:"Sans dept" },
];

/* ---------- Helpers date / texte ---------- */
const pad2 = (n)=> String(n).padStart(2,"0");
const localDateAt = (isoDate, hh=0, mm=0)=> new Date(`${isoDate}T${pad2(hh)}:${pad2(mm)}:00`);
const dayBefore = (isoDate)=>{ const d=new Date(`${isoDate}T00:00:00`); d.setDate(d.getDate()-1); return fmtISODate(d); };
const formatHumanDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { weekday:"long", day:"2-digit", month:"long" });

function nextAllowedISO(baseISO, days){
  let d = new Date(`${baseISO}T00:00:00`);
  for (let i=0;i<14;i++){ if(days.includes(d.getDay())) return fmtISODate(d); d.setDate(d.getDate()+1); }
  return fmtISODate(d);
}
function suggestNext(allowedWeekdays=[4]){
  const today = new Date();
  const baseISO = fmtISODate(today);
  return nextAllowedISO(baseISO, allowedWeekdays);
}

function explainSupabaseError(e){
  const msg = e?.message || String(e);
  if (/row-level security/i.test(msg) || /violates row-level/i.test(msg)) return "Écriture bloquée par RLS. Ajoute des policies sur 'orders' et 'order_items'.";
  if (/permission denied/i.test(msg)) return "Permission refusée. Vérifie la clé anonyme et les policies RLS.";
  if (/relation .* does not exist/i.test(msg)) return "Table/vue introuvable (schéma ?).";
  if (/column .* does not exist/i.test(msg)) return "Colonne manquante. Vérifie/ajoute les colonnes.";
  if (/duplicate key value/i.test(msg)) return "Déjà inséré pour ce produit (pas grave).";
  return msg;
}

const safeDept = (d)=> d ? String(d).toLowerCase() : "uncat";
const withDefaults = (rows=[])=> rows.map(r=>({ ...r, emoji: r.emoji || "🧺", dept: safeDept(r.dept) }));
const isValidOrderId = (v)=> (typeof v==="string" ? v.length>0 : typeof v==="number" ? Number.isFinite(v) : false);

function deptKey(x=""){
  const s = String(x).toLowerCase();
  if (/(vent|sale|store|magasin)/.test(s)) return "vente";
  if (/(patis|pâtis|patiss|dessert|sucr)/.test(s)) return "patiss";
  if (/(boul|bread|pain)/.test(s)) return "boulanger";
  return "uncat";
}
function deptFrom(p={}){
  const raw = String(
    p.dept ?? p.department ?? p.departement ??
    p.category ?? p.categorie ?? p.type ??
    p.section ?? p.family ?? p.famille ?? ""
  ).toLowerCase();
  return deptKey(raw);
}

/* ---------- Baseline locale (seulement si sent) ---------- */
const baselineKey = (orderId)=> `sentBaseline:${orderId}`;
function loadBaseline(orderId){
  try{
    const raw = localStorage.getItem(baselineKey(orderId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.items)) return obj;
  }catch{}
  return null;
}

/* Nettoie un draft local proprement */
function cleanSelectedMap(obj){
  const out = {};
  if (obj && typeof obj === "object") {
    for (const [pid, v] of Object.entries(obj)) {
      const qty = Math.max(0, Number(v?.qty)||0);
      const checked = !!v?.checked && qty>0;
      out[String(pid)] = { checked, qty };
    }
  }
  return out;
}

/* ---------- VUE PRINCIPALE réutilisable ---------- */
export default function OrdersCore({ forcedSupplier, showBackButton }){
  const router = useRouter();

  const meta = SUPPLIERS_META[forcedSupplier] || { key:"", label:"—", allowedWeekdays:[4] };

  // Date de livraison : query ?delivery=YYYY-MM-DD autorisée, sinon prochain jour autorisé
  const deliveryFromQuery = typeof router?.query?.delivery === "string" && router.query.delivery;
  const [delivery, setDelivery] = useState(deliveryFromQuery || suggestNext(meta.allowedWeekdays));
  useEffect(()=>{
    if (!deliveryFromQuery) return;
    setDelivery(deliveryFromQuery);
  }, [deliveryFromQuery]);

  // Clés locales (draft / stash)
  const draftKey = useMemo(()=> `orders_draft_${meta.key}_${delivery}`, [meta.key, delivery]);
  const waStashKey = useMemo(()=> `wa_payload_${meta.key}_${delivery}`, [meta.key, delivery]);

  // Réception (#reception) lecture seule
  const [isReception, setIsReception] = useState(false);
  useEffect(()=>{
    if (typeof window !== "undefined"){
      setIsReception((window.location.hash || "").includes("reception"));
    }
  }, [router.asPath]);

  // Commande
  const [order, setOrder] = useState(null);
  const [uiMsg, setUiMsg] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  // isSent & cut-off
  const isSent = (order?.status || "draft") === "sent";
  const dayBeforeISO = dayBefore(delivery);
  const cutOffDate = useMemo(()=> localDateAt(dayBeforeISO, 12, 0), [dayBeforeISO]);
  const canModify = useMemo(()=> !isSent || new Date() <= cutOffDate, [isSent, cutOffDate]);
  const readOnly = !canModify;

  // Produits
  const [products, setProducts] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Sélection courante
  const [selected, setSelected] = useState({});

  // Baseline (seulement si sent)
  const [baselineMap, setBaselineMap] = useState({});

  // 1) Charger produits du fournisseur (strict)
  useEffect(()=>{
    if (isReception) return;
    setProducts([]);
    (async()=>{
      if (!meta.key) return;
      try{
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("supplier_key", meta.key);
        if (error) throw error;

        const list = (data||[])
          .filter(p => p.is_active !== false && p.active !== false && p.archived !== true)
          .sort((a,b)=> (a.name||"").localeCompare(b.name||""));

        setProducts(withDefaults(list));

        // Favoris
        const favs = await supabase
          .from("supplier_favorites")
          .select("product_id")
          .eq("supplier_key", meta.key)
          .limit(500);
        if (!favs.error) setFavorites(new Set((favs.data || []).map(f => f.product_id)));

        if (!list.length){
          setUiMsg({ type:"info", text:`Aucun produit pour ${meta.label} (normal si rien n’a été créé).` });
        }
      }catch(e){
        setUiMsg({ type:"error", text:"Lecture produits : " + explainSupabaseError(e) });
        setProducts([]);
        setFavorites(new Set());
      }
    })();
  }, [meta.key, isReception]);

  // 2) Charger/Créer la commande (draft ou envoyée) pour (supplier, delivery)
  useEffect(()=>{
    (async()=>{
      if (!meta.key || !delivery) return;
      setOrder(null);

      const res = await supabase
        .from("orders")
        .select(ORDER_COLUMNS)
        .eq("delivery_date", delivery)
        .eq("supplier_key", meta.key)
        .or("status.eq.draft,status.eq.sent")
        .order("created_at", { ascending:false })
        .limit(1)
        .maybeSingle();

      if (res?.data) setOrder(res.data);
      setHydrated(true);
    })();
  }, [meta.key, delivery]);

  // 3) Charger items & baseline (baseline considérée UNIQUEMENT si sent)
  useEffect(()=>{
    (async()=>{
      if (!order?.id){
        setBaselineMap({});
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw){
            const localSel = cleanSelectedMap((JSON.parse(raw)?.selected)||{});
            setSelected(prev => ({ ...prev, ...localSel }));
          }
        } catch {}
        return;
      }

      // Items en base → sélection initiale (toujours totaux désirés)
      const { data: items, error } = await supabase
        .from("order_items")
        .select("product_id, qty")
        .eq("order_id", order.id);
      if (error){
        setUiMsg({ type:"error", text:"Lecture items : " + explainSupabaseError(error) });
        return;
      }

      const sums = {};
      for (const it of (items||[])){
        const pid = String(it.product_id || "");
        if (!pid) continue;
        const q = Math.max(0, Number(it.qty)||0);
        sums[pid] = (sums[pid] || 0) + q;
      }
      const fromServer = Object.fromEntries(
        Object.entries(sums).map(([pid,q]) => [pid, { checked:q>0, qty:Math.max(1,q) }])
      );

      // Merge draft local (max)
      let localSel = {};
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) localSel = cleanSelectedMap((JSON.parse(raw)?.selected)||{});
      } catch {}
      const merged = { ...fromServer };
      for (const [pid, v] of Object.entries(localSel)){
        const cur = merged[pid]?.qty || 0;
        const next = Math.max(cur, Number(v.qty)||0);
        if (v.checked && next>0) merged[pid] = { checked:true, qty:next };
      }
      setSelected(merged);

      // Baseline locale (visible seulement si sent)
      if (order.status === "sent"){
        const base = loadBaseline(order.id);
        const bl = {};
        for (const it of (base?.items||[])) bl[String(it.product_id)] = Number(it.qty)||0;
        setBaselineMap(bl);
      } else {
        setBaselineMap({});
      }
    })();
  }, [order?.id, order?.status, draftKey]);

  // Aides
  const productById = (id)=> products.find(p => String(p.id) === String(id));
  const realBaseQty = (pid)=> Number(baselineMap[String(pid)] || 0);
  const baseQty = (pid)=> (isSent ? realBaseQty(pid) : 0);
  const isLocked = (pid)=> isSent && baseQty(pid) > 0;

  function selectionToItems(orderId){
    const oid = isValidOrderId(orderId) ? orderId : null;
    return Object.entries(selected)
      .filter(([_, v]) => v?.checked && Number(v.qty) > 0)
      .map(([pid, v])=>{
        const pidStr = String(pid);
        const product = productById(pidStr) || {};
        const kdept = deptKey(product ? deptFrom(product) : "");
        const qty = Math.max(1, Number(v.qty)||1); // <-- TOTAL désiré
        return {
          order_id: oid,
          product_id: pidStr,
          product_name: product.name ?? "",
          unit_price: product.price ?? 0,
          qty,
          _dept_ui: kdept,
        };
      });
  }

  // Rajout (calcul UI)
  const rajoutList = useMemo(()=>{
    if (!isSent) return [];
    const out = [];
    for (const [pid, v] of Object.entries(selected)){
      const desired = Number(v?.qty)||0;
      const b = baseQty(pid);
      const delta = desired - b;
      if (v?.checked && delta>0){
        const p = productById(pid) || {};
        out.push({
          product_id:String(pid),
          product_name:p.name||"",
          dept:deptKey(deptFrom(p)),
          delta, base:b, desired
        });
      }
    }
    out.sort((a,b)=>{
      if (a.dept !== b.dept) return a.dept.localeCompare(b.dept);
      return a.product_name.localeCompare(b.product_name);
    });
    return out;
  }, [selected, baselineMap, products, isSent]);

  // Résumé €
  const summary = useMemo(()=>{
    const lines = selectionToItems(order?.id || null);
    const grouped = { vente:[], patiss:[], boulanger:[], uncat:[] };
    for (const l of lines) grouped[l._dept_ui || "uncat"].push(l);
    const total = lines.reduce((acc,l)=> acc + (Number(l.unit_price)||0)*(Number(l.qty)||0), 0);
    return { lines, grouped, total };
  }, [selected, products, order?.id]);

  // WA stash pour l’accueil
  useEffect(()=>{
    if (isReception) return;
    try{
      const supplier_key = meta.key;
      const supplier_label = meta.label;
      const delivery_iso = delivery;

      const baseline_compact = isSent
        ? Object.entries(baselineMap).map(([product_id, qty])=> ({ product_id, qty }))
        : [];

      const full_selection = summary.lines.map(l=>({
        product_id:l.product_id,
        product_name:l.product_name || (productById(l.product_id)?.name ?? ""),
        qty:Number(l.qty)||0
      }));

      const rajout = isSent
        ? (rajoutList.map(r=>({
            product_id:r.product_id,
            product_name:r.product_name || (productById(r.product_id)?.name ?? ""),
            delta:Number(r.delta)||0
          })))
        : [];

      const payload = {
        build_tag: BUILD_TAG,
        order_id: order?.id || null,
        supplier_key,
        supplier_label,
        delivery_iso,
        is_sent: isSent,
        baseline: baseline_compact,
        selection: full_selection,
        rajout,
        ts: Date.now()
      };
      localStorage.setItem(waStashKey, JSON.stringify(payload));
    }catch{}
  }, [waStashKey, meta.key, meta.label, delivery, isSent, baselineMap, rajoutList, summary.lines, order?.id, isReception]);

  // CRUD / autosave
  async function ensureOrderDraft(){
    if (order?.id && isValidOrderId(order.id)) return order;
    const { data, error } = await supabase
      .from("orders")
      .upsert(
        { supplier_key: meta.key, delivery_date: delivery, status:"draft" },
        { onConflict:"supplier_key,delivery_date" }
      )
      .select("id,status,delivery_date,supplier_key,sent_at,cutoff_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    if (!isValidOrderId(data?.id)) throw new Error("id de commande invalide");
    setOrder(data);
    return data;
  }

  const mapAllowed = (arr, orderId)=>
    arr.map(({ product_id, product_name, unit_price, qty }) =>
      ({ order_id:orderId, product_id, product_name, unit_price, qty })
    );

  async function saveOrderItems(orderId){
    const picked = selectionToItems(orderId);
    if (!isValidOrderId(orderId)) return;

    if (!isSent){
      // DRAFT: remplace tout
      const { error: delErr } = await supabase
        .from("order_items")
        .delete()
        .eq("order_id", orderId);
      if (delErr) throw new Error(delErr.message);

      const payload = mapAllowed(picked, orderId); // totaux
      if (payload.length){
        const { error: insErr } = await supabase
          .from("order_items")
          .insert(payload);
        if (insErr) throw new Error(insErr.message);
      }
    } else {
      // SENT: on enregistre les **totaux désirés** (pas le delta)
      // -> upsert (order_id, product_name) avec qty = desired total
      const payloadTotals = mapAllowed(picked, orderId);
      if (payloadTotals.length){
        const { error: upErr } = await supabase
          .from("order_items")
          .upsert(payloadTotals, { onConflict: "order_id,product_name" });
        if (upErr) throw new Error(upErr.message);
      }
    }
  }

  const autosaveTimer = useRef(null);
  const lastSavedKey = useRef("");

  // Auto-sauvegarde (local + Supabase debounce)
  useEffect(()=>{
    if (isReception || !meta.key || !delivery || !hydrated || !canModify) return;

    try { localStorage.setItem(draftKey, JSON.stringify({ selected, ts: Date.now() })); } catch {}

    const oId = isValidOrderId(order?.id) ? order.id : null;
    const lines = selectionToItems(oId);
    const key = JSON.stringify(lines.map(l=>[l.product_id, l.qty]));

    if (lines.length===0 && !oId) return;
    if (lastSavedKey.current === key) return;

    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async ()=>{
      try{
        const o = oId || await ensureOrderDraft();
        await saveOrderItems(o.id);
        lastSavedKey.current = key;
        setUiMsg({ type:"info", text:"Auto-sauvegardé ✅" });
      }catch(e){
        setUiMsg({ type:"error", text:"Auto-sauvegarde : " + explainSupabaseError(e) });
      }
    }, 600);

    return ()=> clearTimeout(autosaveTimer.current);
  }, [meta.key, delivery, isReception, selected, hydrated, canModify, order?.id, draftKey]);

  /* ---------- UI ---------- */
  const filtered = useMemo(()=>{
    const s = (search||"").trim().toLowerCase();
    return (products||[]).filter(p=>{
      const key = deptKey(deptFrom(p));
      const txt = (p.name||"").toLowerCase();
      const deptOk =
        activeTab === "all" ? true :
        activeTab === "uncat" ? !key || key==="uncat" :
        key === activeTab;
      return deptOk && (!s || txt.includes(s));
    });
  }, [products, activeTab, search]);

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:16 }}>
      {/* TOP BAR */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
        {showBackButton ? (
          <BackToBecusButton />
        ) : (
          <Link href="/"><button style={btnStyleMuted()}>← Accueil</button></Link>
        )}

        <div style={{ padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:999, background:"#f9f9f9", fontWeight:800 }}>
          {meta.label}
        </div>

        <div style={{ color:"#222", fontWeight:700 }}>
          Livraison : {formatHumanDate(delivery)}
        </div>

        <div style={{ marginLeft:8, fontSize:11, color:"#666" }}>
          {BUILD_TAG}
        </div>

        <div style={{ flex:1 }} />

        {!isReception && (
          <button
            onClick={async ()=>{
              try{
                const o = isValidOrderId(order?.id) ? order : await ensureOrderDraft();
                await saveOrderItems(o.id);
                setUiMsg({ type:"success", text:"Commande sauvegardée ✅" });
                try { localStorage.setItem(draftKey, JSON.stringify({ selected, ts: Date.now() })); } catch {}
                router.push(`/suppliers/${meta.key}?delivery=${delivery}`);
              }catch(e){
                setUiMsg({ type:"error", text:"Sauvegarde : " + explainSupabaseError(e) });
              }
            }}
            style={btnStyle("#0d6efd")}
            disabled={readOnly && isSent}
          >
            💾 Valider
          </button>
        )}
      </div>

      {uiMsg && (
        <div style={msgStyle(uiMsg.type)}>
          <span>{uiMsg.text}</span>
          <button onClick={()=>setUiMsg(null)} style={linkClearStyle()}>Fermer</button>
        </div>
      )}

      {!isReception && (
        <div style={{ fontSize:13, color:"#666", marginBottom:8 }}>
          {isSent
            ? <>Commande <b>envoyée</b>. Ajouts possibles jusqu’à <b>J-1 12:00</b> (rajout envoyé depuis l’accueil).</>
            : <>Sélections auto-sauvegardées. L’<b>envoi</b> se fait depuis l’accueil (WhatsApp/Email sur la bannière fournisseur).</>}
        </div>
      )}

      {/* BASELINE + RAJOUT */}
      {!isReception && (
        <>
          <div style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
            <div style={{ fontWeight:800, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
              <span>🧾 Commande initiale ({isSent ? "envoyée" : "prévue"})</span>
              <span style={badgeStyle()}>{isSent ? Object.keys(baselineMap).length : 0} ligne(s)</span>
            </div>
            {!isSent || Object.keys(baselineMap).length===0 ? (
              <div style={{ color:"#666" }}>Aucune baseline — la commande n’a pas encore été envoyée.</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10 }}>
                {Object.entries(baselineMap).map(([pid,q])=>{
                  const p = productById(pid);
                  return (
                    <div key={pid} style={{ border:"1px dashed #ddd", borderRadius:10, padding:10 }}>
                      <div style={{ fontWeight:700, display:"flex", justifyContent:"space-between", gap:10 }}>
                        <span>{p?.name || "Produit"}</span>
                        <span style={chipStyle("#eef2ff")}>{deptKey(deptFrom(p))}</span>
                      </div>
                      <div style={{ marginTop:6, fontSize:13 }}>
                        Quantité envoyée : <b>{q}</b>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background:"#fff", border:"1px solid #93c5fd", borderRadius:12, padding:12, margin:"12px 0", backgroundColor:"#eff6ff" }}>
            <div style={{ fontWeight:800, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
              <span>➕ Rajout (en cours — non envoyé)</span>
              <span style={badgeStyle()}>{rajoutList.length} ligne(s)</span>
            </div>
            {rajoutList.length===0 ? (
              <div style={{ color:"#666" }}>{isSent ? "Aucun rajout en cours." : "Le rajout n’est disponible qu’après l’envoi initial."}</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:10 }}>
                {rajoutList.map(l=>{
                  const pid = l.product_id;
                  const p = productById(pid);
                  const minDelta = 1;
                  const maxDelta = 20;
                  const currentDelta = Math.max(minDelta, Math.min(maxDelta, l.delta));
                  return (
                    <div key={pid} style={{ border:"1px dashed #bfdbfe", borderRadius:10, padding:10 }}>
                      <div style={{ fontWeight:700, display:"flex", justifyContent:"space-between", gap:10 }}>
                        <span>{p?.name || "Produit"}</span>
                        <span style={chipStyle("#dbeafe")}>{deptKey(deptFrom(p))}</span>
                      </div>
                      <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:8 }}>
                        <span style={smallBadge()}>Rajout</span>
                        <QtySelect
                          value={currentDelta}
                          min={minDelta}
                          onChange={(qDelta)=>{
                            const nextDesired = baseQty(pid) + Math.max(minDelta, qDelta);
                            setSelected(prev => ({ ...prev, [pid]: { checked:true, qty: nextDesired } }));
                          }}
                        />
                        <button
                          onClick={()=> setSelected(prev => ({ ...prev, [pid]: { checked:true, qty: baseQty(pid) } }))}
                          style={btnSmallDanger(false)}
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

      {/* PRODUITS */}
      {!isReception && (
        <div id="produits" style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
            <div style={{ fontWeight:800 }}>Produits</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginLeft:12 }}>
              {TABS.map(t=>(
                <button key={t.key} onClick={()=>setActiveTab(t.key)} style={tabStyle(activeTab===t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <input
              placeholder="Rechercher…"
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{ ...inputStyle(false), marginLeft:"auto", minWidth:220 }}
            />
          </div>

          <div style={{ color:"#666", fontSize:12, marginBottom:8 }}>
            {isSent
              ? "Commande envoyée : minimum figé par produit à la quantité initiale."
              : "Sélectionne tes produits et quantités, c’est auto-sauvegardé."}
          </div>

          <div className="productsGrid" style={gridStyle()}>
            {filtered.map(p=>{
              const pid = String(p.id);
              const cur = selected[pid] || { checked:false, qty:1 };
              const fav = favorites.has(p.id);
              const b = baseQty(pid);
              const locked = isLocked(pid);
              const isOn = !!cur.checked && Number(cur.qty)>0;
              const minQty = locked ? Math.min(20, Math.max(1, b)) : 1;

              return (
                <div key={pid} style={productStyle(isOn)}>
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={()=>{
                      setSelected(prev=>{
                        const old = prev[pid] || { checked:false, qty: Math.max(1, b || 1) };
                        const nextChecked = !old.checked;
                        if (!nextChecked){
                          if (locked) return { ...prev, [pid]: { checked:true, qty: b || 1 } };
                          return { ...prev, [pid]: { checked:false, qty:0 } };
                        }
                        const qty = Math.max(minQty, Number(old.qty)||minQty);
                        return { ...prev, [pid]: { checked:true, qty } };
                      });
                    }}
                  />

                  <div style={{ width:28, display:"flex", justifyContent:"center" }}>
                    {renderThumb(p)}
                  </div>

                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    <div style={{ fontWeight:700 }}>
                      {p.name} {fav && <span style={{ color:"#e6b800", fontSize:12, marginLeft:4 }}>★</span>}
                    </div>
                    <div style={{ color:"#666", fontSize:12 }}>
                      {(deptFrom(p) || "—")} • {(p.unit || "u")} • {((p.price ?? 0)).toFixed(2)}€ {locked && <em style={{ marginLeft:6, color:"#999" }}>(min {b})</em>}
                    </div>
                  </div>

                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <QtySelect
                      value={cur.qty}
                      min={minQty}
                      onChange={(q)=>{
                        const nextQ = Math.max(minQty, q);
                        setSelected(prev => ({ ...prev, [pid]: { checked: nextQ>0, qty: nextQ } }));
                      }}
                    />
                    {!locked && isOn && (
                      <button
                        onClick={()=> setSelected(prev => ({ ...prev, [pid]: { checked:false, qty:0 } }))}
                        style={btnSmallDanger(false)}
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

          <style jsx>{`
            .productsGrid {
              display: grid;
              grid-template-columns: repeat(1, minmax(0,1fr));
              gap: 8px;
            }
            @media (min-width: 700px) {
              .productsGrid { grid-template-columns: repeat(2, minmax(0,1fr)); }
            }
            @media (min-width: 1000px) {
              .productsGrid { grid-template-columns: repeat(3, minmax(0,1fr)); }
            }
          `}</style>
        </div>
      )}

      {/* RÉSUMÉ */}
      {!isReception && (
        <div id="resume" style={{ background:"#fff", border:"1px solid #eee", borderRadius:12, padding:12, margin:"12px 0" }}>
          <div style={{ fontWeight:800, marginBottom:10 }}>
            Commande {isSent ? "envoyée — ajouts possibles jusqu’à J-1 12:00" : "en préparation (auto-sauvegardée)"} — par département
            {readOnly && <span style={{ marginLeft:10, fontSize:12, color:"#b00020" }}>(lecture seule)</span>}
          </div>
          {summary.lines.length===0 && <div style={{ color:"#666" }}>Aucun article sélectionné.</div>}
          {summary.lines.length>0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:12 }}>
              {[
                ["vente","Vente"],
                ["patiss","Pâtisserie"],
                ["boulanger","Boulangerie"]
              ].map(([k,label])=>(
                <div key={k} style={{ border:"1px dashed #ddd", borderRadius:10, padding:10, minHeight:120 }}>
                  <div style={{ fontWeight:800, marginBottom:8 }}>{label}</div>
                  {(summary.grouped[k]||[]).length===0 && <div style={{ color:"#666", fontSize:13 }}>Aucun article.</div>}
                  {(summary.grouped[k]||[]).map(l=>{
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
                          onChange={(q)=>{
                            const nextQ = Math.max(minQty, q);
                            setSelected(prev => ({ ...prev, [pid]: { checked: nextQ>0, qty: nextQ } }));
                          }}
                        />
                        {!locked && (
                          <button
                            onClick={()=> setSelected(prev => ({ ...prev, [pid]: { checked:false, qty:0 } }))}
                            style={btnSmallDanger(false)}
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
          {summary.lines.length>0 && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
              <div />
              <div style={{ fontWeight:900, fontSize:16 }}>Total: {summary.total.toFixed(2)} €</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- mini UI helpers ---------- */
function pickRawUrl(p){
  const raw =
    p?.image_url || p?.photo_url || p?.image || p?.thumbnail ||
    p?.photo || p?.url_photo || p?.imageUrl || p?.imageURL ||
    p?.picture || p?.pic || p?.url || null;
  if (!raw) return null;
  const s = String(raw);
  if (s.includes("/_next/image") && s.includes("url=")){
    const m = s.match(/[?&]url=([^&]+)/);
    if (m && m[1]){
      try{
        let inner = decodeURIComponent(m[1]);
        if (inner.startsWith("//")) inner = "https:" + inner;
        return inner;
      }catch{}
    }
  }
  if (s.startsWith("//")) return "https:" + s;
  return s;
}
function renderThumb(p){
  const url = pickRawUrl(p);
  const emoji = p?.emoji;
  if (url){
    return <img src={url} alt="" referrerPolicy="no-referrer"
      onError={(e)=>{ e.currentTarget.style.display="none"; }}
      style={{ width:28, height:28, objectFit:"cover", borderRadius:6, border:"1px solid #eee" }} />;
  }
  if (emoji) return <span aria-hidden style={{ fontSize:20, width:24, textAlign:"center" }}>{emoji}</span>;
  return <span aria-hidden style={{ fontSize:18, opacity:0.4 }}>🍞</span>;
}

function QtySelect({ value, min=1, onChange }){
  const vNum = Number(value)||0;
  const minClamped = Math.min(20, Math.max(1, Number(min)||1));
  const val = Math.max(minClamped, Math.min(20, vNum || minClamped));
  const opts = Array.from({ length: 20 - minClamped + 1 }, (_,i)=> i + minClamped);
  return (
    <select value={val} onChange={(e)=> onChange(Number(e.target.value)||minClamped)} style={selectStyle(false)}>
      {opts.map(n=> <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

/* ---------- styles ---------- */
function selectStyle(disabled){ return { padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:8, background: disabled ? "#f5f5f5" : "#fff" }; }
function inputStyle(disabled) { return { padding:"8px 10px", border:"1px solid #e8e8e8", borderRadius:8, background: disabled ? "#f5f5f5" : "#fff" }; }
function btnStyle(bg)        { return { background:bg||"#111", color:"#fff", border:"none", borderRadius:10, padding:"10px 14px", cursor:"pointer", fontWeight:800 }; }
function btnStyleMuted()     { return { background:"#f1f1f1", color:"#111", border:"1px solid #ddd", borderRadius:10, padding:"8px 12px", cursor:"pointer" }; }
function btnSmallDanger()    { return { background:"#fee2e2", color:"#991b1b", border:"1px solid #fca5a5", borderRadius:8, padding:"6px 10px", cursor:"pointer", fontWeight:800, fontSize:12 }; }
function tabStyle(active)    { return { border:"1px solid #e8e8e8", background: active ? "#111" : "#f5f5f5", color: active ? "#fff" : "#111", borderRadius:10, padding:"6px 10px", cursor:"pointer" }; }
function gridStyle()         { return { display:"grid", gridTemplateColumns:"repeat(1, minmax(0,1fr))", gap:8 }; }
function productStyle(on)    { return { display:"grid", gridTemplateColumns:"auto auto 1fr auto", alignItems:"center", gap:10, border:"1px solid #e8e8e8", borderRadius:10, padding:10, background: on ? "#f7fff7" : "#fff" }; }
function linkClearStyle()    { return { background:"none", border:"none", color:"#111", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 }; }
function badgeStyle()        { return { background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:999, padding:"3px 10px", fontSize:12, fontWeight:800 }; }
function chipStyle(bg)       { return { background:bg||"#f1f5f9", border:"1px solid #e5e7eb", borderRadius:999, padding:"2px 8px", fontSize:12, fontWeight:700 }; }
function smallBadge()        { return { background:"#fff", border:"1px solid #c7d2fe", borderRadius:999, padding:"2px 8px", fontSize:12, fontWeight:700, color:"#1d4ed8" }; }
function msgStyle(type) {
  const map = { success:["#e6f4ea","#34a853"], error:["#fdecea","#d93025"], info:["#eef4ff","#1a73e8"] };
  const [bg, bd] = map[type] || ["#f5f5f5","#888"];
  return { background:bg, border:`1px solid ${bd}`, color:"#111", padding:"8px 12px", borderRadius:10, fontSize:14, display:"flex", alignItems:"center", gap:8 };
}
