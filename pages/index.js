// pages/index.js
import Link from "next/link";
import Head from "next/head";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { fmtISODate } from "../lib/date";

/* ======================================================================
   Flags
   ====================================================================== */

// Toujours afficher le bouton Admin (le temps de régler les rôles)
const SHOW_ADMIN_ALWAYS = true;
// Option .env.local possible : NEXT_PUBLIC_FORCE_ADMIN=1
const FORCE_ADMIN = process.env.NEXT_PUBLIC_FORCE_ADMIN === "1";

/* ======================================================================
   Styles
   ====================================================================== */

const GRID  = { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))", gap:16, alignItems:"stretch" };
const CARD  = { background:"#fff", border:"1px solid #e5e7eb", borderRadius:18, padding:16, boxShadow:"0 6px 18px rgba(2,6,23,.06)", minHeight:260 };
const SMALL = { fontSize:13, color:"#64748b" };
const BTN   = (bg="#2563eb") => ({ background:bg, color:"#fff", border:"none", borderRadius:12, padding:"10px 14px", cursor:"pointer", fontWeight:800, boxShadow:"0 6px 14px rgba(2,6,23,.08)" });
const BADGE = { background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:999, padding:"3px 10px", fontSize:12, fontWeight:800 };
const SEG   = (active, disabled) => ({
  padding:"6px 10px", borderRadius:999, border:"1px solid #e5e7eb",
  background: active ? "#0ea5e9" : "#fff", color: disabled ? "#9ca3af" : (active ? "#fff" : "#0f172a"),
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1
});
const linkClearStyle = () => ({ background:"none", border:"none", color:"#0f172a", textDecoration:"underline", cursor:"pointer", padding:0, marginLeft:8 });
const msgStyle = (type) => {
  const map = { success: ["#e6f4ea","#34a853"], error: ["#fdecea","#d93025"], info:["#eef4ff","#1a73e8"] };
  const [bg, bd] = map[type] || ["#f5f5f5","#888"];
  return { background:bg, border:`1px solid ${bd}`, color:"#0f172a", padding:"10px 14px", borderRadius:12, fontSize:14, display:"flex", alignItems:"center", gap:10, boxShadow:"0 8px 30px rgba(0,0,0,.08)" };
};

/* ======================================================================
   Fallback suppliers
   ====================================================================== */

const FALLBACK_SUPPLIERS = [
  { key: "becus",       label: "Bécus",         enabled: true,  allowedWeekdays: [4], whatsapp_phone: "+33765840655", cutoff_hour:12, cutoff_minute:0 },
  { key: "coupdepates", label: "Coup de Pâtes", enabled: true,  allowedWeekdays: [3,5], whatsapp_phone: "+33765840655", cutoff_hour:12, cutoff_minute:0 }
];
const SUPPLIER_OVERRIDES = { coupdepates: { label: "Coup de Pâtes" } };
const DEPT_LABEL = { patiss:"Pâtisserie", boulanger:"Boulangerie", vente:"Vente", uncat:"Sans dept" };
const SHOW_UNCAT_BADGE = false;

/* ======================================================================
   Helpers
   ====================================================================== */

function normalizeSupplierRow(r) {
  const toBool = (v) => v === true || v === 1 || v === "1" || v === "t" || v === "true";
  const parseWeekdays = (v) => {
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    if (typeof v === "string") {
      try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(Number).filter(Number.isFinite); } catch {}
      return v.split(",").map(s=>Number(s.trim())).filter(Number.isFinite);
    }
    return [4];
  };
  const key   = r.key || (r.name||"").toLowerCase().replace(/\s+/g,"");
  const label = r.label || r.name || r.key || key;
  const hasFlag    = ['enabled','is_active','active','status'].some(k => r[k] !== undefined && r[k] !== null);
  const boolFlag   = [r.enabled, r.is_active, r.active].some(v => toBool(v));
  const statusFlag = String(r.status || '').toLowerCase() === 'active';
  const enabled    = hasFlag ? (boolFlag || statusFlag) : true;
  const allowedWeekdays = parseWeekdays(r.allowed_weekdays ?? r.allowed_days ?? [4]);
  const whatsapp_phone = (r.whatsapp_phone || r.phone || "").trim();
  const cutoff_hour = Number.isFinite(Number(r.cutoff_hour)) ? Number(r.cutoff_hour) : 12;
  const cutoff_minute = Number.isFinite(Number(r.cutoff_minute)) ? Number(r.cutoff_minute) : 0;
  return { key, label, enabled, allowedWeekdays, whatsapp_phone, cutoff_hour, cutoff_minute };
}
function applyOverrides(s) {
  const ov = SUPPLIER_OVERRIDES[s.key];
  if (!ov) return s;
  const merged = { ...s, ...ov };
  if (!Array.isArray(merged.allowedWeekdays) || merged.allowedWeekdays.length === 0) merged.allowedWeekdays = [4];
  return merged;
}

/* Dates */
function nextThursdayISO(){ const d=new Date(); const delta=(4-d.getDay()+7)%7||7; d.setDate(d.getDate()+delta); return fmtISODate(d); }
function mondayOfWeekISO(iso){ const d = new Date(`${iso}T00:00:00`); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); return fmtISODate(d); }
function addDaysISO(iso, n){ const d=new Date(`${iso}T00:00:00`); d.setDate(d.getDate()+n); return fmtISODate(d); }
function isoForWeekdayInWeek(mondayISO, weekday){ const mon = new Date(`${mondayISO}T00:00:00`); const offset = (weekday + 7 - 1) % 7; mon.setDate(mon.getDate() + offset); return fmtISODate(mon); }
function sameWeekDatesForSupplier(weekMondayISO, s){ const days = s.allowedWeekdays || []; return days.map(wd => isoForWeekdayInWeek(weekMondayISO, wd)); }
function formatHumanDate(iso){ const d = new Date(iso); return d.toLocaleDateString("fr-FR",{weekday:"long", day:"2-digit", month:"long"}); }

/* WhatsApp helpers */
const toWaDigits = (phone) => (phone || "").replace(/[^\d]/g, "");
function buildWhatsappText({ supplierLabel, deliveryISO, lines, isAddendum=false, sinceISO=null }) {
  const head = isAddendum
    ? `Rajout pour la commande de ${formatHumanDate(deliveryISO)} (depuis ${sinceISO ? new Date(sinceISO).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : "l’envoi initial"}) — ${supplierLabel}.`
    : `Commande pour BM Boulangerie Rambouillet, pour ${formatHumanDate(deliveryISO)}, envoyée à ${supplierLabel}.`;
  const bullets = (lines||[]).map(l => `• ${l.qty} × ${l.product_name}`);
  const tail = "Merci de confirmer la réception (obligatoire).";
  return [head, ...bullets, tail].filter(Boolean).join("\n");
}

/* Requêtes safe */
async function fetchProductsByIds(ids=[]) {
  const uniq = Array.from(new Set((ids||[]).filter(Boolean).map(String)));
  if (uniq.length === 0) return [];
  const or = uniq.map(id => `id.eq.${id}`).join(",");
  const { data, error } = await supabase.from("products").select("*").or(or);
  if (error) { console.warn("fetchProductsByIds error:", error); return []; }
  return data || [];
}
async function fetchItems(orderId) {
  if (!orderId) return [];
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id,qty,product_name")
    .eq("order_id", orderId);
  if (error) { console.warn("fetchItems error:", error); return []; }
  const items = (data||[]).map(r => ({
    product_id: String(r.product_id),
    qty: Number(r.qty)||0,
    product_name: r.product_name || "",
  }));
  const missing = items.filter(x => !x.product_name).map(x => x.product_id);
  if (missing.length) {
    const prods = await fetchProductsByIds(missing);
    const map = new Map(prods.map(p => [String(p.id), p.name || ""]));
    for (const it of items) if (!it.product_name) it.product_name = map.get(it.product_id) || "";
  }
  return items.filter(x => x.qty > 0);
}

/* Baseline locale (état de l’envoi initial) */
const baselineKey = (orderId) => `sentBaseline:${orderId}`;
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
function loadBaseline(orderId) {
  try {
    const raw = localStorage.getItem(baselineKey(orderId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.items)) return obj;
  } catch {}
  return null;
}
function saveBaseline(orderId, items) {
  try {
    const payload = { at: new Date().toISOString(), items: compressByProduct(items || []) };
    localStorage.setItem(baselineKey(orderId), JSON.stringify(payload));
  } catch {}
}
function deltaFromBaseline(baseline, items) {
  const baseMap = new Map((baseline?.items || []).map(x => [String(x.product_id), Math.max(0, Number(x.qty) || 0)]));
  const curMap = new Map();
  for (const it of (items || [])) {
    const id = String(it.product_id || "");
    if (!id) continue;
    const q = Math.max(0, Number(it.qty) || 0);
    curMap.set(id, (curMap.get(id) || 0) + q);
  }
  const out = [];
  for (const [id, curQty] of curMap) {
    const prev = baseMap.get(id) || 0;
    const diff = curQty - prev;
    if (diff > 0) out.push({ product_id: id, qty: diff, product_name: "" });
  }
  return out;
}

/* Dept helpers */
function deptFrom(p = {}) {
  const raw = String(
    p.dept ?? p.department ?? p.departement ?? p.category ?? p.categorie ??
    p.type ?? p.section ?? p.family ?? p.famille ?? ""
  ).toLowerCase();
  return deptKey(raw);
}
function deptKey(x = "") {
  const s = String(x).toLowerCase();
  if (/(vent|sale|store|magasin)/.test(s)) return "vente";
  if (/(patis|pâtis|patiss|dessert|sucr)/.test(s)) return "patiss";
  if (/(boul|bread|pain)/.test(s)) return "boulanger";
  return "uncat";
}

/* Admin simplifié (pas d’appel à 'profiles' → supprime le 404) */
async function resolveIsAdmin(user) {
  if (FORCE_ADMIN || SHOW_ADMIN_ALWAYS) return true;
  try {
    if (!user?.email) return false;
    const email = String(user.email).toLowerCase();
    const ALLOWED = new Set(["farid@bm.local","farid@bmboulangerie.fr","ferhoud@gmail.com","admin@bm.local"]);
    return ALLOWED.has(email);
  } catch {
    return false;
  }
}

/* Choix de dates */
function dateChoices(supplier) {
  const anchor = nextThursdayISO();
  const monday = mondayOfWeekISO(anchor);
  const days = Array.isArray(supplier?.allowedWeekdays) && supplier.allowedWeekdays.length
    ? supplier.allowedWeekdays
    : [4];
  return days.map((wd) => {
    const iso = isoForWeekdayInWeek(monday, wd);
    return { iso, label: formatHumanDate(iso) };
  });
}

/* Clignotement Bécus (optionnel) */
function becusBlinkState(deliveryISO) {
  if (!deliveryISO) return null;
  const D = new Date(`${deliveryISO}T00:00:00`);
  const add = (days,h=0,m=0,s=0)=>{ const x = new Date(D); x.setDate(x.getDate()+days); x.setHours(h,m,s,0); return x; };
  const now = new Date();
  const greenStart = add(-6,0,0,0), greenEnd = add(-4,23,59,59);
  const orangeStart = add(-3,0,0,0), orangeEnd = add(-2,14,0,0);
  const redStart = add(-2,14,0,1), redEnd = add(+0,23,59,59);
  if (now >= greenStart && now <= greenEnd) return "green";
  if (now >= orangeStart && now <= orangeEnd) return "orange";
  if (now >= redStart && now <= redEnd) return "red";
  return null;
}

/* ======================================================================
   Page
   ====================================================================== */

export default function Home(){
  const anchorThursday = useMemo(() => nextThursdayISO(), []);
  const weekMondayISO  = useMemo(() => mondayOfWeekISO(anchorThursday), [anchorThursday]);

  const [suppliers, setSuppliers] = useState(FALLBACK_SUPPLIERS.map(applyOverrides));
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deliveryPick, setDeliveryPick] = useState({}); // { [supplierKey]: isoDate|null }
  const [current, setCurrent]   = useState({}); // { key:{ order, delivery, counts, pending } }
  const [lastWeek, setLastWeek] = useState({}); // { key:{ order } }
  const [uiMsg, setUiMsg] = useState(null);
  const [sendingKey, setSendingKey] = useState(null);

  // tick pour forcer un refresh quand order_items change (realtime)
  const [tick, setTick] = useState(0);

  // Session + Admin
  useEffect(()=>{
    let sub;
    (async ()=>{
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session ?? null);
      setIsAdmin(await resolveIsAdmin(session?.user || null));
      const res = supabase.auth.onAuthStateChange(async (_evt, sess)=>{
        setSession(sess ?? null);
        setIsAdmin(await resolveIsAdmin(sess?.user || null));
      });
      sub = res?.data?.subscription;
    })();
    return ()=>{ try{ sub?.unsubscribe?.(); }catch{} };
  }, []);

  // Suppliers + realtime
  useEffect(()=>{
    let ch = null;
    (async ()=>{
      const { data, error } = await supabase.from("suppliers").select("*");
      if (!error && Array.isArray(data) && data.length) {
        setSuppliers(data.map(normalizeSupplierRow).map(applyOverrides));
      } else {
        setSuppliers(FALLBACK_SUPPLIERS.map(applyOverrides));
      }
      ch = supabase
        .channel("suppliers_changes")
        .on("postgres_changes", { event:"*", schema:"public", table:"suppliers" }, async ()=>{
          const { data } = await supabase.from("suppliers").select("*");
          if (Array.isArray(data) && data.length) setSuppliers(data.map(normalizeSupplierRow).map(applyOverrides));
        })
        .subscribe();
    })();
    return () => {
      try { ch?.unsubscribe?.(); } catch {}
      try { if (ch) supabase.removeChannel(ch); } catch {}
    };
  }, []);

  // Realtime sur order_items -> tick++
  useEffect(()=>{
    const ch = supabase
      .channel("order_items_changes")
      .on("postgres_changes", { event:"*", schema:"public", table:"order_items" }, () => {
        setTick(t => t + 1);
      })
      .subscribe();
    return () => {
      try { ch?.unsubscribe?.(); } catch {}
      try { if (ch) supabase.removeChannel(ch); } catch {}
    };
  }, []);

  // Pré-sélection dates semaine
  useEffect(()=>{
    setDeliveryPick(prev=>{
      const next = { ...prev };
      for (const s of suppliers){
        const dates = sameWeekDatesForSupplier(weekMondayISO, s);
        if (dates.length===1) next[s.key] = dates[0];
        else if (dates.length>1 && !dates.includes(prev[s.key])) next[s.key] = null;
      }
      return next;
    });
  }, [suppliers, weekMondayISO]);

  // Charge commandes + répartitions + RAJOUT (séparé) — prend en compte 'tick'
  useEffect(()=>{
    (async ()=>{
      for (const s of suppliers){
        const dates = sameWeekDatesForSupplier(weekMondayISO, s);
        const chosen = (deliveryPick[s.key] ?? dates[0] ?? anchorThursday);

        // commande courante
        const { data: cur } = await supabase.from("orders")
          .select("*")
          .eq("supplier_key", s.key)
          .eq("delivery_date", chosen)
          .in("status", ["draft","sent"])
          .order("created_at", {ascending:false})
          .limit(1).maybeSingle();

        let counts = {};          // pastilles "Commande initiale"
        let pendingCounts = {};   // pastilles "Rajout"

        if (cur?.id){
          const itemsAll = await fetchItems(cur.id);

          if (cur.status === "sent") {
            // 1) Baseline : si absente → on la prime maintenant avec l'état courant
            let base = loadBaseline(cur.id);
            if (!base) {
              saveBaseline(cur.id, itemsAll);
              base = loadBaseline(cur.id);
            }

            // 2) Pastilles "Commande" = baseline
            const initialItems = base?.items || [];
            if (initialItems.length) {
              const ids = Array.from(new Set(initialItems.map(x => x.product_id)));
              const prods = await fetchProductsByIds(ids);
              const map = new Map(prods.map(p => [String(p.id), p]));
              for (const x of initialItems){
                const p = map.get(String(x.product_id)) || {};
                const k = deptKey(deptFrom(p));
                counts[k] = (counts[k]||0) + (Number(x.qty)||0);
              }
            }

            // 3) Pastilles "Rajout" = delta (courant - baseline)
            const deltaItems = deltaFromBaseline(base, itemsAll);
            if (deltaItems.length) {
              const idsDelta = Array.from(new Set(deltaItems.map(d => d.product_id)));
              const prodsDelta = await fetchProductsByIds(idsDelta);
              const mapDelta = new Map(prodsDelta.map(p => [String(p.id), p]));
              for (const di of deltaItems) {
                const p = mapDelta.get(String(di.product_id)) || {};
                di.product_name = di.product_name || p.name || "";
                const k = deptKey(deptFrom(p));
                pendingCounts[k] = (pendingCounts[k]||0) + (Number(di.qty)||0);
              }
            }
          } else {
            // DRAFT : pastilles = tout le panier en cours
            if (itemsAll.length) {
              const ids = Array.from(new Set(itemsAll.map(x => x.product_id)));
              const prods = await fetchProductsByIds(ids);
              const map = new Map(prods.map(p => [String(p.id), p]));
              for (const x of itemsAll){
                const p = map.get(String(x.product_id)) || {};
                const k = deptKey(deptFrom(p));
                counts[k] = (counts[k]||0) + (Number(x.qty)||0);
              }
            }
          }
        }

        setCurrent(v=>({ ...v, [s.key]: { order: cur||null, delivery: chosen, counts, pending: pendingCounts } }));

        // semaine dernière (pour la carte dédiée)
        const lwISO = addDaysISO(chosen, -7);
        const { data: lw } = await supabase.from("orders")
          .select("id,status,delivery_date,supplier_key")
          .eq("supplier_key", s.key).eq("delivery_date", lwISO)
          .order("id",{ascending:false}).limit(1).maybeSingle();
        setLastWeek(v=>({ ...v, [s.key]: { order: lw||null } }));
      }
    })();
  }, [suppliers, deliveryPick, weekMondayISO, anchorThursday, tick]);

  /* ---------- Envoi initial (WhatsApp) + baseline ---------- */
  async function sendViaWhatsAppAndValidate(supplierKey, deliveryISO) {
    try {
      if (!deliveryISO) { setUiMsg({ type:"error", text:"Choisis d’abord une date de livraison." }); return; }
      const s = suppliers.find(x=>x.key===supplierKey);
      if (!s) { setUiMsg({ type:"error", text:"Fournisseur introuvable." }); return; }
      const waDigits = toWaDigits(s.whatsapp_phone);
      if (!waDigits) { setUiMsg({ type:"error", text:`Numéro WhatsApp manquant pour ${s.label}.` }); return; }

      setSendingKey(supplierKey);

      // commande existante ou création si besoin
      let { data: order } = await supabase
        .from("orders")
        .select("id,status,delivery_date,supplier_key")
        .eq("supplier_key", supplierKey)
        .eq("delivery_date", deliveryISO)
        .in("status", ["draft","sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!order) {
        const ins = await supabase.from("orders")
          .insert({ supplier_key: supplierKey, delivery_date: deliveryISO, status: "draft" })
          .select("id,status,delivery_date,supplier_key")
          .single();
        if (ins.error) throw ins.error;
        order = ins.data;
      }

      const lines = await fetchItems(order.id);
      const text = buildWhatsappText({ supplierLabel: s.label, deliveryISO, lines });

      // ouvrir WhatsApp
      const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(text)}`;
      if (typeof window !== "undefined") window.open(url, "_blank");

      // passer en 'sent' + cutoff (J-1 hh:mm)
      const dayBefore = addDaysISO(deliveryISO, -1);
      const h = Number.isFinite(s.cutoff_hour) ? s.cutoff_hour : 12;
      const m = Number.isFinite(s.cutoff_minute) ? s.cutoff_minute : 0;
      const cutOffISO = `${dayBefore}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`;

      const up = await supabase
        .from("orders")
        .update({ status: "sent", sent_at: new Date().toISOString(), cutoff_at: cutOffISO })
        .eq("id", order.id)
        .select("*")
        .single();
      if (up.error) throw up.error;

      // baseline locale = état au moment de l'envoi initial
      saveBaseline(order.id, lines);

      // rafraîchir l’état local
      setCurrent(prev => {
        const cur = prev[supplierKey] || {};
        return { ...prev, [supplierKey]: { ...cur, order: up.data, pending: {} } };
      });
      setUiMsg({ type:"success", text:"Commande envoyée ✅ — Ajouts possibles jusqu’à J-1 12:00." });
    } catch (e) {
      setUiMsg({ type:"error", text:"Erreur envoi : " + (e?.message || String(e)) });
      console.error(e);
    } finally {
      setSendingKey(null);
    }
  }

  /* ---------- Envoi d’un RAJOUT (delta depuis baseline) ---------- */
  async function sendAddendumViaWhatsApp(supplierKey, deliveryISO) {
    try {
      const info = current[supplierKey];
      const order = info?.order;
      if (!order || order.status !== "sent") { setUiMsg({ type:"error", text:"Commande non envoyée ou introuvable." }); return; }
      const s = suppliers.find(x=>x.key===supplierKey);
      if (!s) { setUiMsg({ type:"error", text:"Fournisseur introuvable." }); return; }
      const waDigits = toWaDigits(s.whatsapp_phone);
      if (!waDigits) { setUiMsg({ type:"error", text:`Numéro WhatsApp manquant pour ${s.label}.` }); return; }

      setSendingKey(supplierKey);

      const itemsNow = await fetchItems(order.id);
      let base = loadBaseline(order.id);
      if (!base) { saveBaseline(order.id, itemsNow); base = loadBaseline(order.id); }

      let delta = deltaFromBaseline(base, itemsNow);
      if (!delta.length) {
        setUiMsg({ type:"info", text:"Aucun ajout détecté depuis l’envoi initial." });
        return;
      }

      // Compléter les noms
      const ids = Array.from(new Set(delta.map(d => d.product_id)));
      const prods = await fetchProductsByIds(ids);
      const map = new Map(prods.map(p => [String(p.id), p.name || ""]));
      for (const d of delta) d.product_name = d.product_name || map.get(String(d.product_id)) || "";

      const text = buildWhatsappText({ supplierLabel: s.label, deliveryISO, lines: delta, isAddendum:true, sinceISO: base?.at || order.sent_at || null });
      const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(text)}`;
      if (typeof window !== "undefined") window.open(url, "_blank");

      // Après envoi, on absorbe les ajouts dans la baseline
      saveBaseline(order.id, itemsNow);
      setCurrent(prev => {
        const cur = prev[supplierKey] || {};
        return { ...prev, [supplierKey]: { ...cur, pending: {} } };
      });

      setUiMsg({ type:"success", text:"Rajout envoyé via WhatsApp ✅" });
    } catch (e) {
      setUiMsg({ type:"error", text:"Erreur rajout : " + (e?.message || String(e)) });
      console.error(e);
    } finally {
      setSendingKey(null);
    }
  }

  const userEmail = session?.user?.email || null;

  /* ======================================================================
     Render
     ====================================================================== */

  return (
    <div style={{maxWidth:1200, margin:"0 auto", padding:20, display:"flex", flexDirection:"column", gap:18}}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <title>Commandes et livraisons</title>
        {/* Mets un favicon dans /public pour supprimer le 404 */}
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* En-tête */}
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <h1 style={{ fontSize:28, fontWeight:900, letterSpacing:.2, display:"flex", alignItems:"center", gap:10 }}>🧺 Commandes et livraisons</h1>
        <div style={{marginLeft:"auto"}} />
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <span style={{...BADGE, background:"#eef2ff", borderColor:"#c7d2fe"}}>
            {userEmail ? (`👤 ${userEmail}`) : "👤 Non connecté"}
          </span>
          {userEmail ? (
            <Link href="/logout"><button style={BTN("#ef4444")}>Se déconnecter</button></Link>
          ) : (
            <Link href="/login"><button style={BTN("#0d9488")}>Se connecter</button></Link>
          )}
        </div>
        {(SHOW_ADMIN_ALWAYS || isAdmin || FORCE_ADMIN) && (
          <Link href="/admin/suppliers">
            <button style={BTN("#7c3aed")}>🛠️ Admin fournisseur</button>
          </Link>
        )}
      </div>

      {/* Fournisseurs */}
      <div style={GRID}>
        {suppliers.map(s=>{
          const info = current[s.key] || {};
          const cur  = info.order;
          const disabled = !s.enabled;
          const choices = dateChoices(s);
          const picked = deliveryPick[s.key];
          const isFixed = (s.allowedWeekdays||[]).length === 1; // Bécus = jeudi fixe
          const deliveryToUse = (picked || info.delivery);

          // Clignotement Bécus
          const blink = s.key === "becus" ? becusBlinkState(deliveryToUse) : null;
          const blinkClass = blink ? `blink-${blink}` : "";

          // Cutoff (J-1 hh:mm)
          const dayBefore = deliveryToUse ? addDaysISO(deliveryToUse, -1) : null;
          const h = Number.isFinite(s.cutoff_hour) ? s.cutoff_hour : 12;
          const m = Number.isFinite(s.cutoff_minute) ? s.cutoff_minute : 0;
          const cutOff = dayBefore ? new Date(`${dayBefore}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`) : null;
          const closed = cutOff ? (new Date() > cutOff) : false;

          const hasPending = Object.values(info.pending || {}).some(n => (Number(n)||0) > 0);

          // Bouton 1 : Ouvrir / modifier
          const openHref = deliveryToUse
            ? `/orders?supplier=${s.key}&delivery=${deliveryToUse}#${cur?.status === "sent" && closed ? "resume" : "produits"}`
            : "#";
          const openDisabled = disabled || !deliveryToUse;

          // Bouton 2 : Envoyer initial
          const showSend = !disabled && deliveryToUse && (!cur || cur.status !== "sent");

          return (
            <div key={s.key} className={blinkClass} style={{ ...CARD, position:"relative", opacity: disabled ? .6 : 1 }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                <div style={{fontWeight:800, fontSize:18}}>
                  {s.label} {!s.enabled && <span style={{...BADGE, marginLeft:6, background:"#fee2e2", borderColor:"#fecaca", color:"#991b1b"}}>Désactivé</span>}
                </div>
                <div style={{...SMALL, opacity:.9}}>
                  {deliveryToUse
                    ? <>Livraison {formatHumanDate(deliveryToUse)}</>
                    : isFixed
                      ? <>Livraison {formatHumanDate(choices[0]?.iso)}</>
                      : <>Choisir un jour…</>}
                </div>
              </div>

              {/* Choix date pour multi-jours */}
              {!isFixed && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  {choices.map(c => (
                    <button
                      key={c.iso}
                      onClick={()=> !disabled && setDeliveryPick(v=>({ ...v, [s.key]: c.iso }))}
                      style={SEG(picked === c.iso, disabled)}
                      disabled={disabled}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}

              {/* État WhatsApp + badges */}
              <div style={{marginTop:8, display:"flex", gap:8, flexWrap:"wrap"}}>
                {!!s.whatsapp_phone && <span style={{...BADGE, background:"#ecfeff", borderColor:"#a5f3fc"}}>WhatsApp : {s.whatsapp_phone}</span>}
                {cur?.status === "sent" && !closed && (
                  <span style={{...BADGE, background:"#e6f4ea", borderColor:"#34a853"}}>Envoyée ✅ — Ajouts possibles jusqu’à {String(h).padStart(2,"0")}:{String(m).padStart(2,"0")} (J-1)</span>
                )}
                {cur?.status === "sent" && closed && (
                  <span style={{...BADGE, background:"#fee2e2", borderColor:"#fca5a5", color:"#991b1b"}}>Commande validée — rajout impossible</span>
                )}
              </div>

              {/* Pastilles COMMANDE (baseline) */}
              {!disabled && cur ? (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                  {Object.keys(info.counts||{}).length===0 && <span style={SMALL}>Aucun article pour l’instant.</span>}
                  {Object.entries(info.counts||{})
                    .filter(([k]) => SHOW_UNCAT_BADGE ? true : k !== "uncat")
                    .map(([k,n])=>(
                      <span key={k} style={{...BADGE, background:"#f1f5f9"}}>{DEPT_LABEL[k]||k} : {n}</span>
                    ))}
                </div>
              ) : <div style={{height:8}} />}

              {/* --- Section RAJOUT --- */}
              {cur?.status === "sent" && !closed && (
                <div style={{marginTop:12, padding:12, border:"1px dashed #93c5fd", background:"#eff6ff", borderRadius:14}}>
                  <div style={{fontWeight:800, marginBottom:8, color:"#1d4ed8"}}>Rajout</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {hasPending
                      ? Object.entries(info.pending)
                          .filter(([k,n]) => (n||0) > 0 && (SHOW_UNCAT_BADGE ? true : k !== "uncat"))
                          .map(([k,n]) => <span key={k} style={{...BADGE, background:"#dbeafe", borderColor:"#bfdbfe"}}>{DEPT_LABEL[k]||k} : {n}</span>)
                      : <span style={SMALL}>Aucun ajout en attente.</span>
                    }
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{marginTop:12, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
                <Link href={openHref}>
                  <button style={BTN("#0ea5e9")} disabled={openDisabled}>
                    {cur?.status === "sent"
                      ? (closed ? "📄 Ouvrir (lecture)" : "✏️ Rajouter des produits")
                      : "🛒 Ouvrir / modifier la commande"}
                  </button>
                </Link>

                {showSend && (
                  <button
                    style={BTN("#16a34a")}
                    disabled={sendingKey===s.key || closed}
                    onClick={()=> sendViaWhatsAppAndValidate(s.key, deliveryToUse)}
                    title="Ouvre WhatsApp et passe la commande en 'envoyée' (cut-off J-1 12:00)."
                  >
                    {sendingKey===s.key ? "Envoi…" : "✅ Envoyer via WhatsApp"}
                  </button>
                )}

                {cur?.status === "sent" && !closed && (
                  <button
                    style={BTN("#2563eb")}
                    disabled={sendingKey===s.key || !hasPending}
                    onClick={()=> sendAddendumViaWhatsApp(s.key, deliveryToUse)}
                    title="N’envoie que les ajouts depuis l’envoi initial (delta)."
                  >
                    📨 Envoyer le rajout (WhatsApp)
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Carte Produits */}
        <div style={{...CARD}}>
          <div style={{fontWeight:800, fontSize:18}}>Produits</div>
          <div style={SMALL}>Gérer le catalogue (ajouter / modifier / désactiver).</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            <Link href={`/products`}><button style={BTN("#0f172a")}>📦 Gérer les produits</button></Link>
            <Link href={`/products?new=1`}><button style={BTN("#7c3aed")}>➕ Ajouter un produit</button></Link>
          </div>
        </div>
      </div>

      {/* Semaine dernière */}
      <div style={GRID}>
        {suppliers.map(s=>{
          const lw = lastWeek[s.key]?.order;
          return (
            <div key={`lw-${s.key}`} style={{...CARD}}>
              <div style={{fontWeight:800, fontSize:18, marginBottom:6}}>Commande de la semaine dernière — {s.label}</div>
              {lw ? (
                <>
                  <div style={SMALL}>Livraison {new Date(lw.delivery_date).toLocaleDateString("fr-FR",{weekday:"long", day:"2-digit", month:"long"})}</div>
                  <div style={{marginTop:10}}>
                    <Link href={`/orders?supplier=${s.key}&delivery=${lw.delivery_date}#reception`}>
                      <button style={BTN("#b45309")}>✅ Vérifier & cocher les manquants</button>
                    </Link>
                  </div>
                </>
              ) : <div style={SMALL}>Aucune commande trouvée pour la semaine dernière.</div>}
            </div>
          );
        })}
      </div>

      {/* Historique */}
      <div style={GRID}>
        {suppliers.map(s=>(
          <div key={`hist-${s.key}`} style={{...CARD}}>
            <div style={{fontWeight:800, fontSize:18, marginBottom:6}}>Historique — {s.label}</div>
            <div style={SMALL}>Consulter les commandes antérieures.</div>
            <div style={{marginTop:10}}>
              <Link href={`/orders/history?supplier=${s.key}`}>
                <button style={BTN("#334155")}>🗂️ Ouvrir l’historique</button>
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Messages UI */}
      {uiMsg && (
        <div style={{position:"fixed", bottom:16, left:"50%", transform:"translateX(-50%)", ...msgStyle(uiMsg.type)}}>
          <span>{uiMsg.text}</span>
          <button onClick={()=>setUiMsg(null)} style={linkClearStyle()}>Fermer</button>
        </div>
      )}

      {/* CSS clignotements */}
      <style jsx global>{`
        .blink-green { animation: pulse-green 1.4s ease-in-out infinite; }
        .blink-orange { animation: pulse-orange 1.4s ease-in-out infinite; }
        .blink-red { animation: pulse-red 1.1s ease-in-out infinite; }
        @keyframes pulse-green { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.55); } 70% { box-shadow: 0 0 0 12px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
        @keyframes pulse-orange { 0% { box-shadow: 0 0 0 0 rgba(245,158,11,.55); } 70% { box-shadow: 0 0 0 12px rgba(245,158,11,0); } 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); } }
        @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.6); } 70% { box-shadow: 0 0 0 12px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
      `}</style>
    </div>
  );
}
