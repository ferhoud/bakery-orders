// components/SupplierBanner.jsx
/* SupplierBanner — v-2025-10-26c-noghost+modalLastWeek+noDoubleAdd
   - Masque les lignes "fantômes" contenant "Rajout" dans le nom produit
     quand on charge la commande actuelle ET quand on charge la commande de la
     semaine dernière, pour éviter le beurre 25kg / Tartimalin fantôme.
   - "Commande de la semaine dernière" n'affiche plus toute la liste en plein
     milieu de la page. On ouvre maintenant un modal dédié.
   - Dans ce modal :
       * si la commande actuelle est encore DRAFT -> ajout dans la commande initiale
       * si la commande est SENT -> ajout va dans le rajout (deltaLines)
     (techniquement c'était déjà géré mais maintenant c'est 100% cadré)
   - Les produits déjà ajoutés dans la commande actuelle sont affichés
     comme "déjà ajouté" et la checkbox est désactivée, donc pas de doublon.
   - Historique ne montre plus les commandes futures.
   - openHistoryPreview réintégré proprement (plus de crash).
*/

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { fmtISODate } from "../lib/date";

const BAKERY_NAME = "BM Boulangerie";

const SUPPLIERS_META = {
  becus:        { key:"becus",        label:"Bécus",             allowedWeekdays:[4] },   // jeudi
  coupdepates:  { key:"coupdepates",  label:"Coup de Pâtes",      allowedWeekdays:[3,5] }, // mer/ven
  moulins:      { key:"moulins",      label:"Moulins Bourgeois", allowedWeekdays:[4] },
};

const ORDER_COLUMNS = "id,status,delivery_date,supplier_key,supplier,sent_at,cutoff_at,created_at";

/* --- helpers dates / semaines --- */
const pad2 = (n)=> String(n).padStart(2,"0");
const localDateAt = (isoDate, hh=0, mm=0)=> new Date(`${isoDate}T${pad2(hh)}:${pad2(mm)}:00`);

function nextAllowedISO(baseISO, days){
  let d = new Date(`${baseISO}T00:00:00`);
  for (let i=0;i<21;i++){
    if (days.includes(d.getDay())) return fmtISODate(d);
    d.setDate(d.getDate()+1);
  }
  return fmtISODate(d);
}
function previousAllowedISO(baseISO, days){
  let d = new Date(`${baseISO}T00:00:00`);
  for (let i=0;i<21;i++){
    d.setDate(d.getDate()-1);
    if (days.includes(d.getDay())) return fmtISODate(d);
  }
  return fmtISODate(d);
}
function suggestNext(allowedWeekdays=[4]){
  const baseISO = fmtISODate(new Date());
  return nextAllowedISO(baseISO, allowedWeekdays);
}
function formatHumanDate(iso){
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday:"long", day:"2-digit", month:"long"
  });
}

function isValidId(v){
  return typeof v==="string" ? v.length>0 :
         typeof v==="number" ? Number.isFinite(v) : false;
}

/* --- regroupement par département --- */
function deptKey(x=""){
  const s = String(x).toLowerCase();
  if (/(vent|sale|store|magasin)/.test(s)) return "vente";
  if (/(patis|pâtis|patiss|dessert|sucr)/.test(s)) return "patiss";
  if (/(boul|bread|pain)/.test(s)) return "boulanger";
  return "uncat";
}
function groupByDept(lines){
  const g = { vente:[], patiss:[], boulanger:[], uncat:[] };
  for (const l of lines) g[l.dept || "uncat"].push(l);
  return g;
}

/* --- compter les références distinctes --- */
function countDistinctProducts(arr){
  const uniq = new Set();
  for (const it of (arr || [])){
    const key = String(it.product_id || it.product_name || "");
    if (!key) continue;
    uniq.add(key);
  }
  return uniq.size;
}

/* --- baseline locale (pour calculer le "rajout") --- */
const baselineKey = (orderId)=> `sentBaseline:${orderId}`;

function saveBaseline(orderId, items){ // items: [{product_id, qty}]
  try{
    localStorage.setItem(baselineKey(orderId), JSON.stringify({ items }));
  }catch{}
}
function loadBaseline(orderId){
  try{
    const raw = localStorage.getItem(baselineKey(orderId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.items)) return obj;
  }catch{}
  return null;
}

/* --- stash local (brouillon courant) : on ÉCRIT pour compat, on ne LIT plus --- */
function saveStash(stashKey, deliveryISO, lines){
  try{
    const payload = {
      delivery_iso: deliveryISO,
      selection: (lines||[]).map(it=>({
        product_id: it.product_id,
        product_name: it.product_name,
        qty: it.qty
      }))
    };
    localStorage.setItem(stashKey, JSON.stringify(payload));
  }catch{}
}

/* --- textes pour WhatsApp / Email --- */
function composeInitialText({ supplierLabel, deliveryISO, grouped }){
  const dateTxt = formatHumanDate(deliveryISO);
  const out = [
    `${BAKERY_NAME}`,
    `Commande ${supplierLabel} — Livraison ${dateTxt}`,
  ];
  for (const [k,arr] of Object.entries(grouped)){
    if (!arr.length) continue;
    const title =
      k==="vente" ? "Vente" :
      k==="patiss" ? "Pâtisserie" :
      k==="boulanger" ? "Boulangerie" :
      "Divers";
    out.push(`\n${title}:`);
    for (const it of arr){
      out.push(`• ${it.qty} × ${it.product_name}`);
    }
  }
  out.push("\nMerci de confirmer la reception (obligatoire)");
  return out.join("\n");
}

function composeDeltaText({ supplierLabel, deliveryISO, grouped }){
  const dateTxt = formatHumanDate(deliveryISO);
  const out = [
    `${BAKERY_NAME}`,
    `RAJOUT ${supplierLabel} — Livraison ${dateTxt}`,
  ];
  let any=false;
  for (const [k,arr] of Object.entries(grouped)){
    if (!arr.length) continue;
    any=true;
    const title =
      k==="vente" ? "Vente" :
      k==="patiss" ? "Pâtisserie" :
      k==="boulanger" ? "Boulangerie" :
      "Divers";
    out.push(`\n${title}:`);
    for (const it of arr){
      out.push(`• +${it.qty} × ${it.product_name}`);
    }
  }
  if (!any){
    out.push("\n(aucun rajout)");
  }
  out.push("\nMerci de confirmer la reception (obligatoire)");
  return out.join("\n");
}

/* --- logique du cycle hebdo Bécus
   Vert       ven 00:00 -> dim 23:59
   Orange     lun 00:00 -> mar 12:00
   Rouge      mar 12:01 -> mer 12:00
   Verrouillé mer 12:01 -> livraison
*/
function computeStage(deliveryISO){
  const T = new Date(`${deliveryISO}T00:00:00`); // ex: jeudi

  const greenStart  = new Date(T); greenStart.setDate(T.getDate()-6); greenStart.setHours(0,0,0,0);   // ven
  const greenEnd    = new Date(T); greenEnd.setDate(T.getDate()-4); greenEnd.setHours(23,59,59,999); // dim

  const orangeStart = new Date(T); orangeStart.setDate(T.getDate()-3); orangeStart.setHours(0,0,0,0); // lun
  const orangeEnd   = new Date(T); orangeEnd.setDate(T.getDate()-2); orangeEnd.setHours(12,0,0,0);    // mar 12:00

  const redStart    = new Date(T); redStart.setDate(T.getDate()-2); redStart.setHours(12,0,1,0);      // mar 12:01
  const redEnd      = new Date(T); redEnd.setDate(T.getDate()-1); redEnd.setHours(12,0,0,0);          // mer 12:00

  const lockStart   = new Date(T); lockStart.setDate(T.getDate()-1); lockStart.setHours(12,0,1,0);    // mer 12:01

  const now = new Date();
  if (now >= lockStart) return "locked";
  if (now >= redStart   && now <= redEnd)   return "red";
  if (now >= orangeStart&& now <= orangeEnd)return "orange";
  if (now >= greenStart && now <= greenEnd) return "green";
  return "green";
}

function StatusPill({ stage, sent }){
  const map = {
    green : { bg:"#e6f4ea", bd:"#34a853", txt: sent ? "Statut : envoyée" : "Statut : en préparation" },
    orange: { bg:"#fff7ed", bd:"#f59e0b", txt: "Statut : à finaliser" },
    red   : { bg:"#ffe4e6", bd:"#fb7185", txt: "Statut : dernière limite" },
    locked: { bg:"#fee2e2", bd:"#ef4444", txt: sent ? "Statut : envoyée" : "Statut : verrouillée" },
  };
  const s = map[stage] || map.green;
  return (
    <div style={{
      background:s.bg,
      border:`1px solid ${s.bd}`,
      color:"#111",
      borderRadius:999,
      padding:"4px 10px",
      fontWeight:800,
      animation:"pulse 1.6s ease-in-out infinite"
    }}>
      {s.txt}
    </div>
  );
}

/* --- composant principal --- */
export default function SupplierBanner({ supplierKey }){
  const meta = SUPPLIERS_META[supplierKey] || { key:"", label:"—", allowedWeekdays:[4] };
  const router = useRouter();

  // aujourd'hui (sert pour "semaine dernière" et historique)
  const todayISO = fmtISODate(new Date());

  // date sélectionnée (?delivery=YYYY-MM-DD) sinon prochain jour autorisé
  const qDelivery = typeof router?.query?.delivery === "string" && router.query.delivery;
  const [delivery, setDelivery] = useState(qDelivery || suggestNext(meta.allowedWeekdays));
  useEffect(()=>{ if (qDelivery) setDelivery(qDelivery); }, [qDelivery]);

  const stage    = computeStage(delivery);
  const isLocked = stage === "locked";

  // clé pour stash local qu'on va CONTINUER à mettre à jour après modifs
  const waStashKey = useMemo(()=> `wa_payload_${meta.key}_${delivery}`, [meta.key, delivery]);

  /* ---------------- state principal ---------------- */
  const [order, setOrder] = useState(null);           // row orders { id, status, ... }
  const [lines, setLines] = useState([]);             // état actuel visible (sans fantômes)
  const [deltaLines, setDeltaLines] = useState([]);   // rajout par rapport à baseline
  const [loading, setLoading] = useState(true);

  const [uiMsg, setUiMsg] = useState(null);

  const [showConfirmInitial, setShowConfirmInitial] = useState(false);
  const [showConfirmDelta,   setShowConfirmDelta]   = useState(false);

  const [preview, setPreview] = useState(null);       // modale aperçu historique
  const [weekModalOpen, setWeekModalOpen] = useState(false); // modale "commande semaine dernière"

  const [lastWeek, setLastWeek] = useState({          // semaine dernière (livraison passée)
    order:null,
    items:[],
    loaded:false
  });

  const [historyGrouped, setHistoryGrouped] = useState({}); // historique par année/mois (passé uniquement)

  // sélection manquants dans le modal
  const [missingSelect, setMissingSelect] = useState({}); // { product_id: {...}, ... }

  // statut envoyé ?
  const isSent = (order?.status || "draft") === "sent";

  /* helper: recalc deltaLines après ajout d'articles manquants */
  function recomputeDeltaAfterManualChange(newLinesArr){
    if (!isSent || !isValidId(order?.id)){
      setDeltaLines([]);
      return;
    }
    let baseLocal = loadBaseline(order.id);
    if (!baseLocal || !Array.isArray(baseLocal.items)){
      setDeltaLines([]);
      return;
    }
    const baseMap = new Map();
    for (const it of (baseLocal.items||[])){
      const pid = String(it.product_id||"");
      if (!pid) continue;
      baseMap.set(pid, (baseMap.get(pid)||0)+(Number(it.qty)||0));
    }
    const deltas = [];
    for (const it of newLinesArr){
      const pid = String(it.product_id||"");
      if (!pid) continue;
      const nowQty   = Number(it.qty)||0;
      const baseQty  = baseMap.get(pid) || 0;
      const diff     = nowQty - baseQty;
      if (diff > 0){
        deltas.push({
          product_id: it.product_id,
          product_name: it.product_name,
          qty: diff,
          dept: it.dept || "uncat",
        });
      }
    }
    setDeltaLines(deltas);
  }

  /* ---------------- chargement de la COMMANDE ACTUELLE + delta ----------------
     IMPORTANT: on NE LIT PLUS le brouillon localStorage.
     On lit seulement order_items de la base (et on filtre les lignes fantômes "Rajout").
  */
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try{
        // 1. commande la plus récente (draft ou sent) pour ce fournisseur + cette date
        const baseReq = ()=> supabase
          .from("orders")
          .select(ORDER_COLUMNS)
          .eq("delivery_date", delivery)
          .eq("supplier_key", meta.key)
          .or("status.eq.draft,status.eq.sent")
          .order("created_at", { ascending:false })
          .limit(1)
          .maybeSingle();

        const or = await baseReq();
        if (or?.data) setOrder(or.data); else setOrder(null);

        // 2. lignes depuis la base
        let dbList = [];
        if (or?.data?.id){
          const { data: items, error } = await supabase
            .from("order_items")
            .select("product_id, product_name, qty")
            .eq("order_id", or.data.id);
          if (error) throw error;

          // agréger par produit, en ignorant les lignes fantômes
          const sums = new Map(); const names = new Map();
          for (const it of (items||[])){
            const pname = String(it.product_name || "");
            // stop fantômes : si le nom contient "Rajout", on l'ignore
            if (/\brajout\b/i.test(pname)) continue;

            const pid = String(it.product_id||"");
            if (!pid) continue;
            const q = Math.max(0, Number(it.qty)||0);

            sums.set(pid, (sums.get(pid)||0) + q);
            if (pname) names.set(pid, pname);
          }

          dbList = Array.from(sums.entries()).map(([product_id, qty])=>({
            product_id,
            product_name: names.get(product_id) || "",
            qty,
            dept:"uncat",
          })).filter(x=>x.qty>0);

          // compléter dept depuis products
          if (dbList.length){
            const ids = dbList.map(x=>x.product_id);
            const { data: prods } = await supabase
              .from("products")
              .select("id, dept, category")
              .in("id", ids);
            const mapDept = new Map(
              (prods||[]).map(p=>[String(p.id), deptKey(p.dept || p.category || "")])
            );
            for (const it of dbList){
              it.dept = mapDept.get(it.product_id) || "uncat";
            }
          }
        }

        setLines(dbList);

        // 3. calcul du rajout basé sur baseline locale vs état DB filtré
        if (or?.data?.status === "sent" && isValidId(or.data.id)){
          let baseLocal = loadBaseline(or.data.id);

          // si commande est déjà "sent" mais aucune baseline locale :
          // -> baseline = état actuel DB filtré
          if (!baseLocal || !Array.isArray(baseLocal.items) || baseLocal.items.length === 0){
            const sums2 = new Map();
            for (const it of dbList){
              const pid = String(it.product_id||"");
              if (!pid) continue;
              const q = Math.max(0, Number(it.qty)||0);
              sums2.set(pid, (sums2.get(pid)||0)+q);
            }
            const freshBaseline = Array.from(sums2.entries())
              .map(([product_id, qty])=>({ product_id, qty }));
            saveBaseline(or.data.id, freshBaseline);
            baseLocal = { items: freshBaseline };
          }

          const baseMap = new Map();
          for (const it of (baseLocal.items||[])){
            const pid = String(it.product_id||"");
            if (!pid) continue;
            baseMap.set(pid, (baseMap.get(pid)||0)+(Number(it.qty)||0));
          }

          const deltas = [];
          for (const it of dbList){
            const baseQty = baseMap.get(it.product_id) || 0;
            const diff = (Number(it.qty)||0) - baseQty;
            if (diff > 0){
              deltas.push({
                product_id: it.product_id,
                product_name: it.product_name,
                qty: diff,
                dept: it.dept || "uncat",
              });
            }
          }
          setDeltaLines(deltas);
        } else {
          setDeltaLines([]);
        }

      }catch(e){
        setUiMsg({
          type:"error",
          text:"Lecture bannière : " + (e?.message || String(e))
        });
        setLines([]);
        setDeltaLines([]);
        setOrder(null);
      }finally{
        setLoading(false);
      }
    })();
  }, [meta.key, delivery]);

  /* ---------------- charger SEMAINE DERNIÈRE ----------------
     On prend la dernière commande livrée (delivery_date < todayISO).
     On masque aussi les lignes fantômes "Rajout".
  */
  const prevISOGuess = useMemo(
    ()=> previousAllowedISO(todayISO, meta.allowedWeekdays),
    [todayISO, meta.allowedWeekdays]
  );

  useEffect(()=>{
    (async()=>{
      try{
        // dernière commande livrée (passée)
        const prevRes = await supabase
          .from("orders")
          .select(ORDER_COLUMNS)
          .eq("supplier_key", meta.key)
          .lt("delivery_date", todayISO)
          .order("delivery_date", { ascending:false })
          .limit(1)
          .maybeSingle();

        const chosenOrder = prevRes?.data || null;
        const effectiveDate = chosenOrder?.delivery_date || prevISOGuess;

        let list = [];
        if (chosenOrder?.id){
          const { data: items } = await supabase
            .from("order_items")
            .select("product_id, product_name, qty")
            .eq("order_id", chosenOrder.id);

          // agréger par produit, ignorer fantômes
          const sums = new Map(); const names = new Map();
          for (const it of (items||[])){
            const pname = String(it.product_name || "");
            if (/\brajout\b/i.test(pname)) continue;

            const pid = String(it.product_id||"");
            if (!pid) continue;
            const q = Math.max(0, Number(it.qty)||0);
            sums.set(pid, (sums.get(pid)||0) + q);
            if (pname) names.set(pid, pname);
          }
          list = Array.from(sums.entries()).map(([product_id, qty])=>({
            product_id,
            product_name: (names.get(product_id) || ""),
            qty,
            dept:"uncat"
          })).filter(x=>x.qty>0);

          // récupérer dept
          if (list.length){
            const ids = list.map(x=>x.product_id);
            const { data: prods } = await supabase
              .from("products")
              .select("id, dept, category")
              .in("id", ids);
            const mapDept = new Map(
              (prods||[]).map(p=>[String(p.id), deptKey(p.dept || p.category || "")])
            );
            for (const it of list){
              it.dept = mapDept.get(it.product_id) || "uncat";
            }
          }
        }

        setLastWeek({
          order: chosenOrder || { delivery_date: effectiveDate },
          items: list,
          loaded:true
        });
      }catch{
        setLastWeek({
          order:{ delivery_date: prevISOGuess },
          items:[],
          loaded:true
        });
      }
    })();
  }, [meta.key, todayISO, prevISOGuess]);

  /* ---------------- charger HISTORIQUE (passé uniquement) ----------------
     Historique = commandes dont la livraison est < todayISO
     => la commande future (ex 30/10 si on est avant le 30) NE s'affiche pas.
  */
  useEffect(()=>{
    (async()=>{
      try{
        const since = new Date();
        since.setFullYear(since.getFullYear()-1);
        const sinceISO = fmtISODate(since);

        const { data } = await supabase
          .from("orders")
          .select("id, delivery_date, status, created_at")
          .eq("supplier_key", meta.key)
          .gte("delivery_date", sinceISO)
          .lt("delivery_date", todayISO) // seulement passé
          .order("delivery_date", { ascending:false })
          .limit(120);

        const out = [];
        for (const o of (data||[])){
          const { data: items } = await supabase
            .from("order_items")
            .select("product_id, product_name")
            .eq("order_id", o.id);

          const uniq = new Set();
          for (const it of (items||[])){
            const pname = String(it.product_name || "");
            if (/\brajout\b/i.test(pname)) continue; // pas compter les fantômes
            const k = String(it.product_id || pname || "");
            if (!k) continue;
            uniq.add(k);
          }
          const total = uniq.size;

          out.push({ id:o.id, date:o.delivery_date, status:o.status, total });
        }

        const g = {};
        for (const r of out){
          const d = new Date(r.date);
          const y = d.getFullYear();
          const m = d.toLocaleString("fr-FR", { month:"long" });
          g[y] = g[y] || {};
          g[y][m] = g[y][m] || [];
          g[y][m].push(r);
        }
        setHistoryGrouped(g);
      }catch{
        setHistoryGrouped({});
      }
    })();
  }, [meta.key, todayISO]);

  /* ---------------- helpers texte/envoi ---------------- */
  function whatsappTextInitial(){
    return composeInitialText({
      supplierLabel: meta.label,
      deliveryISO: delivery,
      grouped: groupByDept(lines),
    });
  }
  function mailtoSubjectInitial(){
    return `Commande ${meta.label} — ${formatHumanDate(delivery)}`;
  }

  function whatsappTextDelta(){
    return composeDeltaText({
      supplierLabel: meta.label,
      deliveryISO: delivery,
      grouped: groupByDept(deltaLines),
    });
  }
  function mailtoSubjectDelta(){
    return `[RAJOUT] ${meta.label} — ${formatHumanDate(delivery)}`;
  }

  /* ---------------- envoyer / renvoyer commande initiale ---------------- */
  function sendInitialWhatsApp(){
    const url = `https://wa.me/?text=${encodeURIComponent(whatsappTextInitial())}`;
    window.open(url, "_blank", "noopener,noreferrer");
    if (!isSent){
      setShowConfirmInitial(true);
    }
  }
  function sendInitialEmail(){
    const url = `mailto:?subject=${encodeURIComponent(mailtoSubjectInitial())}&body=${encodeURIComponent(whatsappTextInitial())}`;
    window.location.href = url;
    if (!isSent){
      setShowConfirmInitial(true);
    }
  }

  async function markAsSent(){
    try{
      // assure qu'on a une commande en base
      let cur = order;
      if (!isValidId(cur?.id)){
        const up = await supabase
          .from("orders")
          .upsert(
            { supplier_key: meta.key, delivery_date: delivery, status:"draft" },
            { onConflict:"supplier_key,delivery_date" }
          )
          .select(ORDER_COLUMNS)
          .single();
        if (up.error) throw up.error;
        cur = up.data;
      }

      // baseline = lignes actuelles filtrées
      const sums = new Map();
      for (const it of lines){
        const pid = String(it.product_id||"");
        if (!pid) continue;
        sums.set(pid, (sums.get(pid)||0)+(Number(it.qty)||0));
      }
      const baseline = Array.from(sums.entries()).map(([product_id, qty])=>({ product_id, qty }));

      // statut sent en base
      const now = new Date().toISOString();
      const upd = await supabase
        .from("orders")
        .update({ status:"sent", sent_at: now })
        .eq("id", cur.id)
        .select(ORDER_COLUMNS)
        .single();
      if (upd.error) throw upd.error;

      // baseline -> localStorage
      saveBaseline(cur.id, baseline);

      // stash propre pour compat avec /order
      saveStash(waStashKey, delivery, lines);

      // UI
      setOrder(upd.data);
      setShowConfirmInitial(false);
      setUiMsg({ type:"success", text:"Commande marquée comme envoyée ✅" });
      setDeltaLines([]); // au moment initial, pas de rajout
    }catch(e){
      setUiMsg({ type:"error", text:"Marquage envoyé : " + (e?.message || String(e)) });
    }
  }

  /* ---------------- envoyer rajout ---------------- */
  function sendDeltaWhatsApp(){
    const url = `https://wa.me/?text=${encodeURIComponent(whatsappTextDelta())}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setShowConfirmDelta(true);
  }
  function sendDeltaEmail(){
    const url = `mailto:?subject=${encodeURIComponent(mailtoSubjectDelta())}&body=${encodeURIComponent(whatsappTextDelta())}`;
    window.location.href = url;
    setShowConfirmDelta(true);
  }

  // validation du rajout -> fusion dans baseline
  function confirmRajoutSent(){
    try{
      if (!isValidId(order?.id)){
        setShowConfirmDelta(false);
        return;
      }
      // baseline devient l'état actuel affiché (lignes filtrées)
      const sums = new Map();
      for (const it of lines){
        const pid = String(it.product_id||"");
        if (!pid) continue;
        sums.set(pid, (sums.get(pid)||0)+(Number(it.qty)||0));
      }
      const newBaseline = Array.from(sums.entries()).map(([product_id, qty])=>({ product_id, qty }));
      saveBaseline(order.id, newBaseline);

      // stash propre pour compat
      saveStash(waStashKey, delivery, lines);

      setDeltaLines([]);
      setShowConfirmDelta(false);
      setUiMsg({ type:"success", text:"Rajout fusionné dans la commande ✅" });
    }catch(e){
      setUiMsg({ type:"error", text:"Fusion rajout : " + (e?.message || String(e)) });
    }
  }

  /* ---------------- gestion manquants (modal semaine dernière) ---------------- */

  const groupedLastWeek = groupByDept(lastWeek.items || []);

  // empêcher de cocher un article déjà présent
  function itemAlreadyInCurrent(pid){
    const p = String(pid||"");
    return lines.some(l => String(l.product_id) === p);
  }

  function toggleMissing(item){
    const pid = String(item.product_id||"");
    if (!pid) return;
    if (itemAlreadyInCurrent(pid)) {
      // déjà ajouté -> pas cochable
      return;
    }
    setMissingSelect(prev=>{
      const next = { ...prev };
      if (next[pid]){
        delete next[pid];
      } else {
        next[pid] = {
          product_id: item.product_id,
          product_name: item.product_name,
          qty: item.qty,
          dept: item.dept || "uncat",
        };
      }
      return next;
    });
  }

  // Ajoute les sélectionnés à la commande actuelle :
  // - si commande DRAFT => c'est juste dans "commande actuelle"
  // - si commande SENT  => ça apparaîtra comme rajout (deltaLines) grâce à recomputeDeltaAfterManualChange
  function addSelectedMissingToCurrent(){
    const mapExisting = new Map(lines.map(it => [String(it.product_id), { ...it }]));

    for (const pid of Object.keys(missingSelect)){
      const sel = missingSelect[pid];
      if (!sel) continue;

      if (mapExisting.has(pid)){
        // déjà présent -> normalement on ne devrait plus l'avoir coché
        // (checkbox désactivée), donc en pratique ce bloc ne tourne pas.
        const cur = mapExisting.get(pid);
        const newQty = (Number(cur.qty)||0) + (Number(sel.qty)||0);
        mapExisting.set(pid, { ...cur, qty:newQty });
      } else {
        mapExisting.set(pid, {
          product_id: pid,
          product_name: sel.product_name,
          qty: sel.qty,
          dept: sel.dept || "uncat",
        });
      }
    }

    const merged = Array.from(mapExisting.values());
    setLines(merged);

    // met à jour stash pour rendre /order cohérent
    saveStash(waStashKey, delivery, merged);

    // recalc du rajout si la commande est déjà envoyée
    recomputeDeltaAfterManualChange(merged);

    // reset sélection + message vert
    setMissingSelect({});
    setUiMsg({ type:"success", text:"Produits ajoutés ✅" });
  }

  /* ---------------- aperçu historique (modal) ---------------- */
  function openHistoryPreview(orderId){
    (async()=>{
      try{
        const { data: items } = await supabase
          .from("order_items")
          .select("product_id, product_name, qty")
          .eq("order_id", orderId);

        // agréger / ignorer fantômes
        const sums = new Map(); const names = new Map();
        for (const it of (items||[])){
          const pname = String(it.product_name || "");
          if (/\brajout\b/i.test(pname)) continue;
          const pid = String(it.product_id||"");
          if (!pid) continue;
          const q = Math.max(0, Number(it.qty)||0);
          sums.set(pid, (sums.get(pid)||0)+q);
          if (pname) names.set(pid, pname);
        }
        const list = Array.from(sums.entries()).map(([product_id, qty])=>({
          product_id,
          product_name: names.get(product_id) || "",
          qty,
          dept:"uncat"
        })).filter(x=>x.qty>0);

        if (list.length){
          const ids = list.map(x=>x.product_id);
          const { data: prods } = await supabase
            .from("products")
            .select("id, dept, category")
            .in("id", ids);
          const mapDept = new Map(
            (prods||[]).map(p=>[String(p.id), deptKey(p.dept || p.category || "")])
          );
          for (const it of list){
            it.dept = mapDept.get(it.product_id) || "uncat";
          }
        }

        // retrouver date de livraison dans l'historique actuel
        const allHist = Object.values(historyGrouped).flatMap(months => Object.values(months).flat());
        const found = allHist.find(h=>h.id===orderId);

        const text = composeInitialText({
          supplierLabel: meta.label,
          deliveryISO: found?.date || delivery,
          grouped: groupByDept(list)
        });

        setPreview({ title:"Aperçu commande", text });
      }catch(e){
        setPreview({
          title:"Aperçu commande",
          text:"(impossible de charger cette commande)"
        });
      }
    })();
  }

  /* ---------------- dérivés d'affichage ---------------- */

  const groupedLines  = groupByDept(lines);

  const totalArticles = countDistinctProducts(lines);
  const lastWeekCount = countDistinctProducts(lastWeek.items || []);

  const canSendRajout     = !isLocked && deltaLines.length>0;
  const canImportMissing  = Object.keys(missingSelect).length > 0;

  const initialBtnLabelWhats = isSent ? "📤 Renvoyer WhatsApp" : "📤 Envoyer WhatsApp";
  const initialBtnLabelEmail = isSent ? "✉️ Renvoyer par Email" : "✉️ Envoyer par Email";

  /* ---------------- rendu ---------------- */
  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:16 }}>
      {/* Bandeau top */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
        <Link href="/"><button style={btnMuted()}>← Accueil</button></Link>

        <div style={chipLight()}>{meta.label}</div>

        <div style={{ color:"#222", fontWeight:700 }}>
          Livraison : {formatHumanDate(delivery)}
        </div>

        <div style={{ marginLeft:8 }}>
          <StatusPill stage={stage} sent={isSent} />
        </div>

        <div style={{ marginLeft:"auto" }}>
          <Link href={`/suppliers/${meta.key}/order?delivery=${delivery}`}>
            <button style={btnPrimary()}>📘 Voir / modifier la commande</button>
          </Link>
        </div>
      </div>

      {uiMsg && (
        <div style={msgStyle(uiMsg.type)}>
          <span>{uiMsg.text}</span>
          <button onClick={()=>setUiMsg(null)} style={linkClear()}>Fermer</button>
        </div>
      )}

      {/* Carte commande actuelle */}
      <div style={cardMain()}>
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ fontWeight:900, fontSize:18 }}>{meta.label}</div>
          <div style={pill("#eef2ff","#93c5fd")}>Livraison : {formatHumanDate(delivery)}</div>
          <div style={{ color:"#667085", fontSize:13 }}>
            {loading ? "Chargement…" : `${totalArticles} article(s) au total`}
          </div>

          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <button onClick={sendInitialWhatsApp} style={btnWhatsApp()}>
              {initialBtnLabelWhats}
            </button>
            <button onClick={sendInitialEmail} style={btnSecondary()}>
              {initialBtnLabelEmail}
            </button>
          </div>
        </div>

        {!isSent && showConfirmInitial && (
          <div style={bandConfirmInitial()}>
            <span style={{ fontWeight:800 }}>As-tu bien envoyé le message ?</span>
            <button onClick={markAsSent} style={btnConfirm()}>✅ Marquer comme envoyée</button>
            <button onClick={()=>setShowConfirmInitial(false)} style={btnMuted()}>Annuler</button>
          </div>
        )}

        {/* liste commande actuelle */}
        <div style={grid3col()}>
          {[
            ["vente","Vente"],
            ["patiss","Pâtisserie"],
            ["boulanger","Boulangerie"],
          ].map(([k,label])=>{
            const arr = groupedLines[k] || [];
            return (
              <div key={k} style={boxSection()}>
                <div style={sectionTitle()}>{label}</div>
                {arr.length===0
                  ? <div style={emptyLine()}>Aucun article.</div>
                  : arr.map((l,idx)=>(
                      <div key={k+idx} style={lineRow()}>
                        <div style={lineName()}>{l.product_name}</div>
                        <div style={lineQty()}>{l.qty}</div>
                      </div>
                    ))
                }
              </div>
            );
          })}
        </div>

        {/* Bloc Rajout */}
        {isSent && (
          <div style={rajoutWrapper()}>
            <div style={rajoutHeader()}>
              <div style={{ fontWeight:800, display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ color:"#374151" }}>➕ Rajout (non envoyé)</span>
              </div>

              <div style={{ marginLeft:"auto", display:"flex", flexWrap:"wrap", gap:8 }}>
                <Link href={`/suppliers/${meta.key}/order?delivery=${delivery}`}>
                  <button style={btnPrimarySmall()} disabled={isLocked}>
                    📘 Modifier la commande
                  </button>
                </Link>

                <button
                  onClick={sendDeltaWhatsApp}
                  style={btnOutlineBlue()}
                  disabled={!canSendRajout}
                >
                  📤 Envoyer Rajout WhatsApp
                </button>

                <button
                  onClick={sendDeltaEmail}
                  style={btnOutline()}
                  disabled={!canSendRajout}
                >
                  ✉️ Envoyer Rajout Email
                </button>
              </div>
            </div>

            {showConfirmDelta && canSendRajout && (
              <div style={bandConfirmRajout()}>
                <div>Rajout envoyé ?</div>
                <button onClick={confirmRajoutSent} style={btnConfirmSmall()}>
                  ✔ Rajout envoyé (fusionner)
                </button>
                <button onClick={()=>setShowConfirmDelta(false)} style={btnMutedSmall()}>
                  Annuler
                </button>
              </div>
            )}

            {deltaLines.length===0 ? (
              <div style={noRajoutMsg()}>Aucun rajout en cours.</div>
            ) : (
              <div style={grid3col()}>
                {Object.entries(groupByDept(deltaLines)).map(([deptKeyName, arr])=>(
                  <div key={deptKeyName} style={boxRajoutCol()}>
                    <div style={sectionTitle()}>
                      {deptKeyName==="vente"
                        ? "Vente"
                        : deptKeyName==="patiss"
                        ? "Pâtisserie"
                        : deptKeyName==="boulanger"
                        ? "Boulangerie"
                        : "Divers"}
                    </div>
                    {arr.length===0
                      ? <div style={emptyLine()}>Aucun ajout.</div>
                      : arr.map((l,idx)=>(
                          <div key={deptKeyName+idx} style={lineRow()}>
                            <div style={lineName()}>{l.product_name}</div>
                            <div style={lineQty()}>+{l.qty}</div>
                          </div>
                        ))
                    }
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Semaine dernière (résumé + bouton d'ouverture du modal) */}
      <div style={cardLastWeek()}>
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:8 }}>
          <div style={{ fontWeight:900 }}>Commande de la semaine dernière</div>
          <div style={{ color:"#667085" }}>
            ({formatHumanDate(lastWeek?.order?.delivery_date || prevISOGuess)})
          </div>

          <div style={{ marginLeft:"auto", display:"flex", flexWrap:"wrap", gap:8 }}>
            <button
              style={btnOutlineBlue()}
              onClick={()=>setWeekModalOpen(true)}
              disabled={!lastWeek.loaded || lastWeek.items.length===0}
            >
              📋 Produits manquants
            </button>

            <Link href={`/suppliers/${meta.key}/order?delivery=${delivery}`}>
              <button style={btnOutline()}>📘 Ouvrir la commande actuelle</button>
            </Link>
          </div>
        </div>

        <div style={{ marginTop:8, color:"#667085", fontSize:13 }}>
          {!lastWeek.loaded
            ? "Chargement…"
            : `${lastWeekCount} article(s) la semaine dernière`
          }
        </div>
      </div>

      {/* Historique (groupé année/mois, cliquable) - uniquement passé */}
      {Object.keys(historyGrouped).length>0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ fontWeight:900, marginBottom:6 }}>Historique</div>
          {Object.entries(historyGrouped)
            .sort(([y1],[y2])=> Number(y2)-Number(y1))
            .map(([year, months])=>(
              <div key={year} style={{ marginBottom:10 }}>
                <div style={{ fontWeight:800, margin:"8px 0" }}>{year}</div>
                {Object.entries(months).map(([month, rows])=>(
                  <div key={month} style={historyMonthCard()}>
                    <div style={historyMonthHeader()}>{month}</div>
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <tbody>
                        {rows.map(r=>(
                          <tr
                            key={r.id}
                            style={historyRowStyle()}
                            onClick={()=>openHistoryPreview(r.id)}
                          >
                            <td style={historyCellMain()}>
                              {formatHumanDate(r.date)}{" "}
                              <span style={historyDateISO()}>({r.date})</span>
                            </td>
                            <td style={historyCellStatus()}>
                              {r.status}
                            </td>
                            <td style={historyCellQty()}>
                              {r.total}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))
          }
        </div>
      )}

      {/* Modale aperçu historique (copier/coller texte commande passée) */}
      {preview && (
        <div style={modalBackdrop()} onClick={()=>setPreview(null)}>
          <div style={modalBody()} onClick={(e)=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontWeight:900 }}>{preview.title}</div>
              <button onClick={()=>setPreview(null)} style={btnMuted()}>Fermer</button>
            </div>
            <textarea
              readOnly
              value={preview.text}
              style={{
                width:"100%",
                height:260,
                border:"1px solid #e6e8eb",
                borderRadius:8,
                padding:10,
                fontFamily:"monospace"
              }}
            />
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button
                onClick={()=>{navigator.clipboard?.writeText(preview.text);}}
                style={btnPrimary()}
              >
                Copier
              </button>
              <button onClick={()=>setPreview(null)} style={btnSecondary()}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal "Commande de la semaine dernière" (produits manquants) */}
      {weekModalOpen && (
        <div style={modalBackdrop()} onClick={()=>setWeekModalOpen(false)}>
          <div style={modalBody()} onClick={(e)=>e.stopPropagation()}>
            <div style={{
              display:"flex",
              justifyContent:"space-between",
              alignItems:"center",
              marginBottom:8,
              flexWrap:"wrap",
              gap:8
            }}>
              <div style={{ fontWeight:900 }}>
                Produits reçus le {formatHumanDate(lastWeek?.order?.delivery_date || prevISOGuess)}
              </div>
              <button onClick={()=>setWeekModalOpen(false)} style={btnMuted()}>Fermer</button>
            </div>

            <div style={{ fontSize:13, color:"#374151", marginBottom:12 }}>
              Coche les produits manquants pour les ajouter à la commande {isSent ? "en rajout" : "actuelle"}.
            </div>

            <div style={grid3col()}>
              {[
                ["vente","Vente"],
                ["patiss","Pâtisserie"],
                ["boulanger","Boulangerie"],
              ].map(([k,label])=>{
                const arr = groupedLastWeek[k] || [];
                return (
                  <div key={k} style={boxSection()}>
                    <div style={sectionTitle()}>{label}</div>
                    {arr.length===0
                      ? <div style={emptyLine()}>Aucun article.</div>
                      : arr.map((l,idx)=>{
                          const pid = String(l.product_id||"");
                          const checked   = !!missingSelect[pid];
                          const disabled  = itemAlreadyInCurrent(pid);
                          return (
                            <div
                              key={k+idx}
                              style={{
                                display:"flex",
                                alignItems:"center",
                                justifyContent:"space-between",
                                gap:10,
                                marginBottom:4,
                                fontSize:13,
                              }}
                            >
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={()=>toggleMissing(l)}
                                  style={{ cursor: disabled ? "not-allowed":"pointer" }}
                                />
                                <span style={{ color:"#222" }}>{l.product_name}</span>

                                {disabled && (
                                  <span style={alreadyBadge()}>
                                    déjà ajouté
                                  </span>
                                )}
                              </div>
                              <div style={{ fontWeight:800 }}>{l.qty}</div>
                            </div>
                          );
                        })
                    }
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop:16, display:"flex", flexWrap:"wrap", gap:8 }}>
              <button
                onClick={addSelectedMissingToCurrent}
                style={btnPrimarySmall()}
                disabled={!canImportMissing}
              >
                ➕ Ajouter à la commande {isSent ? "(rajout)" : "(initiale)"}
              </button>
              <button
                onClick={()=>{ setMissingSelect({}); }}
                style={btnMutedSmall()}
              >
                Tout décocher
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

/* --- styles --- */

function chipLight(){
  return {
    padding:"8px 10px",
    border:"1px solid #e8e8e8",
    borderRadius:999,
    background:"#f9f9f9",
    fontWeight:800,
  };
}
function btnPrimary(){
  return {
    background:"#0d6efd",
    color:"#fff",
    border:"none",
    borderRadius:10,
    padding:"10px 14px",
    cursor:"pointer",
    fontWeight:800,
  };
}
function btnPrimarySmall(){
  return {
    background:"#0d6efd",
    color:"#fff",
    border:"none",
    borderRadius:8,
    padding:"6px 10px",
    cursor:"pointer",
    fontWeight:800,
    fontSize:12,
  };
}
function btnSecondary(){
  return {
    background:"#111",
    color:"#fff",
    border:"none",
    borderRadius:10,
    padding:"10px 14px",
    cursor:"pointer",
    fontWeight:800,
  };
}
function btnWhatsApp(){
  return {
    background:"#25D366",
    color:"#fff",
    border:"none",
    borderRadius:10,
    padding:"10px 14px",
    cursor:"pointer",
    fontWeight:800,
  };
}
function btnConfirm(){
  return {
    background:"#16a34a",
    color:"#fff",
    border:"none",
    borderRadius:10,
    padding:"8px 12px",
    cursor:"pointer",
    fontWeight:800,
  };
}
function btnOutline(){
  return {
    background:"#fff",
    color:"#111",
    border:"1px solid #e5e7eb",
    borderRadius:10,
    padding:"8px 12px",
    cursor:"pointer",
    fontWeight:800,
    display:"flex",
    alignItems:"center",
    gap:6,
  };
}
function btnOutlineBlue(){
  return {
    background:"#fff",
    color:"#1d4ed8",
    border:"1px solid #93c5fd",
    borderRadius:10,
    padding:"8px 12px",
    cursor:"pointer",
    fontWeight:800,
    display:"flex",
    alignItems:"center",
    gap:6,
  };
}
function btnMuted(){
  return {
    background:"#f1f1f1",
    color:"#111",
    border:"1px solid #ddd",
    borderRadius:10,
    padding:"8px 12px",
    cursor:"pointer",
    fontWeight:600,
  };
}
function btnMutedSmall(){
  return {
    background:"#f1f1f1",
    color:"#111",
    border:"1px solid #ddd",
    borderRadius:8,
    padding:"6px 10px",
    cursor:"pointer",
    fontWeight:600,
    fontSize:12,
  };
}
function btnConfirmSmall(){
  return {
    background:"#16a34a",
    color:"#fff",
    border:"none",
    borderRadius:8,
    padding:"6px 10px",
    cursor:"pointer",
    fontWeight:800,
    fontSize:12,
  };
}

function alreadyBadge(){
  return {
    background:"#e0f2fe",
    color:"#0369a1",
    borderRadius:999,
    padding:"2px 6px",
    fontSize:10,
    fontWeight:700,
    lineHeight:1.2,
    border:"1px solid #7dd3fc",
  };
}

function pill(bg,bd){
  return {
    background:bg,
    border:`1px solid ${bd}`,
    borderRadius:999,
    padding:"3px 10px",
    fontSize:12,
    fontWeight:800,
  };
}
function msgStyle(type){
  const map={
    success:["#e6f4ea","#34a853"],
    error:["#fdecea","#d93025"],
    info:["#eef4ff","#1a73e8"]
  };
  const [bg,bd]=map[type]||["#f5f5f5","#888"];
  return {
    background:bg,
    border:`1px solid ${bd}`,
    color:"#111",
    padding:"8px 12px",
    borderRadius:10,
    fontSize:14,
    display:"flex",
    alignItems:"center",
    gap:8,
    marginBottom:12,
  };
}
function linkClear(){
  return {
    background:"none",
    border:"none",
    color:"#111",
    textDecoration:"underline",
    cursor:"pointer",
    padding:0,
    marginLeft:8,
  };
}

/* cards/layout */
function cardMain(){
  return {
    border:"1px solid #e6e8eb",
    borderRadius:14,
    background:"#fff",
    boxShadow:"0 1px 2px rgba(0,0,0,0.04)",
    padding:14,
  };
}
function cardLastWeek(){
  return {
    border:"1px solid #e6e8eb",
    borderRadius:12,
    background:"#fff",
    marginTop:12,
    padding:12,
  };
}

function grid3col(){
  return {
    display:"grid",
    gridTemplateColumns:"repeat(3, minmax(0,1fr))",
    gap:12,
  };
}
function boxSection(){
  return {
    border:"1px solid #e6e8eb",
    borderRadius:10,
    padding:10,
    background:"#fff",
  };
}
function sectionTitle(){
  return { fontWeight:800, marginBottom:6 };
}
function emptyLine(){
  return { color:"#666", fontSize:13 };
}
function lineRow(){
  return {
    display:"flex",
    justifyContent:"space-between",
    gap:10,
    marginBottom:4,
  };
}
function lineName(){
  return { color:"#222" };
}
function lineQty(){
  return { fontWeight:800 };
}

/* rajout */
function rajoutWrapper(){
  return {
    border:"1px solid #93c5fd",
    background:"#eff6ff",
    borderRadius:12,
    padding:12,
    marginTop:12,
  };
}
function rajoutHeader(){
  return {
    display:"flex",
    flexWrap:"wrap",
    alignItems:"center",
    gap:10,
    marginBottom:10,
  };
}
function bandConfirmRajout(){
  return {
    display:"flex",
    flexWrap:"wrap",
    alignItems:"center",
    gap:8,
    background:"#f0f7ff",
    border:"1px dashed #bfdbfe",
    borderRadius:10,
    padding:"8px 10px",
    marginBottom:10,
    fontSize:13,
  };
}
function noRajoutMsg(){
  return {
    color:"#374151",
    fontSize:13,
    fontStyle:"italic",
  };
}
function boxRajoutCol(){
  return {
    border:"1px dashed #bfdbfe",
    borderRadius:10,
    padding:10,
    background:"#eff6ff",
  };
}

function bandConfirmInitial(){
  return {
    marginBottom:12,
    padding:10,
    border:"1px dashed #cbd5e1",
    borderRadius:10,
    background:"#f8fafc",
    display:"flex",
    flexWrap:"wrap",
    alignItems:"center",
    gap:10,
    fontSize:13,
  };
}

/* historique */
function historyMonthCard(){
  return {
    border:"1px solid #e6e8eb",
    borderRadius:12,
    overflow:"hidden",
    marginBottom:10,
  };
}
function historyMonthHeader(){
  return {
    background:"#f8fafc",
    padding:"6px 12px",
    fontWeight:700,
  };
}
function historyRowStyle(){
  return {
    borderTop:"1px solid #f1f5f9",
    cursor:"pointer",
  };
}
function historyCellMain(){
  return {
    padding:"10px 12px",
  };
}
function historyDateISO(){
  return {
    color:"#667085",
    fontSize:12,
  };
}
function historyCellStatus(){
  return {
    padding:"10px 12px",
    textTransform:"capitalize",
  };
}
function historyCellQty(){
  return {
    padding:"10px 12px",
    textAlign:"right",
    fontWeight:800,
  };
}

/* modale génériques */
function modalBackdrop(){
  return {
    position:"fixed",
    inset:0,
    background:"rgba(0,0,0,0.35)",
    display:"flex",
    alignItems:"center",
    justifyContent:"center",
    zIndex:50,
    padding:"16px",
  };
}
function modalBody(){
  return {
    width:"min(780px, 94vw)",
    maxHeight:"90vh",
    overflowY:"auto",
    background:"#fff",
    borderRadius:12,
    padding:12,
    boxShadow:"0 12px 24px rgba(0,0,0,0.18)",
  };
}
