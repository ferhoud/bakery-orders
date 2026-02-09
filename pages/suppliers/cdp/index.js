// pages/suppliers/cdp/index.js
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { fmtISODate } from "../../../lib/date";

const FONT_STACK = `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial`;
const LAYOUT = { maxWidth: 1180, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 };
const TOPBAR = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap:"wrap" };
const CARD = { background:"#fff", border:"1px solid #e6e8eb", borderRadius:16, padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" };
const BTN = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8, padding:"12px 14px", borderRadius:12, border:"1px solid #e6e8eb", background:"#fff", cursor:"pointer", textDecoration:"none", fontWeight:600 };
const BTN_PRIMARY = { ...BTN, border:"1px solid #c7ddff", background:"#eef5ff" };
const MUTED = { color:"#6b7280" };

function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso, days){
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate()+days);
  return toISODate(d);
}
function nextWeekdayISO(targetDay, fromDate = new Date(), includeToday = true){
  const d = new Date(fromDate);
  d.setHours(0,0,0,0);
  const cur = d.getDay();
  let delta = (targetDay - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  d.setDate(d.getDate()+delta);
  return toISODate(d);
}
function dayBeforeISO(iso){ return addDaysISO(iso, -1); }
function localAt(iso, hh, mm){
  return new Date(`${iso}T${pad2(hh)}:${pad2(mm)}:00`);
}
function endOfDay(iso){
  return new Date(`${iso}T23:59:59`);
}
function normalizeWaPhone(input){
  if (!input) return "";
  const digits = String(input).replace(/[^\d]/g,"");
  return digits;
}
function baselineKey(orderId){ return `sentBaseline:${orderId}`; }
function readBaseline(orderId){
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(baselineKey(orderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const items = parsed?.items || [];
    const m = new Map();
    for (const it of items) m.set(String(it.product_id), Number(it.qty)||0);
    return { map: m, raw: parsed };
  } catch { return null; }
}
function writeBaseline(orderId, items){
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(baselineKey(orderId), JSON.stringify({ items, saved_at: new Date().toISOString() }));
  } catch {}
}
function compressItems(items){
  const sums = new Map(); // pid -> {qty,name,price}
  for (const it of items || []) {
    const pid = String(it.product_id);
    const prev = sums.get(pid) || { qty: 0, product_name: it.product_name || "", unit_price: it.unit_price ?? null };
    prev.qty += Math.max(0, Number(it.qty)||0);
    if (!prev.product_name && it.product_name) prev.product_name = it.product_name;
    if ((prev.unit_price == null) && (it.unit_price != null)) prev.unit_price = it.unit_price;
    sums.set(pid, prev);
  }
  const out = [];
  for (const [product_id, v] of sums.entries()) out.push({ product_id, qty: v.qty, product_name: v.product_name || "", unit_price: v.unit_price });
  out.sort((a,b) => String(a.product_name||"").localeCompare(String(b.product_name||"")));
  return out;
}
function buildMsg({ supplierLabel, deliveryISO, mode, lines }){
  const frDate = deliveryISO.split("-").reverse().join("/");
  const head = `${supplierLabel} — Livraison ${frDate}`;
  const tag = mode === "delta" ? "RAJOUT" : "COMMANDE";
  const body = lines.map(l => `- ${l.qty} x ${l.product_name || "Produit"}`).join("\n");
  return `${head}\n${tag}\n${body}`.trim();
}

const SUPPLIER_KEY = "coupdepates";
const SUPPLIER_LABEL = "Coup de Pâtes";

function pickDefaultDateISO(){
  const now = new Date();
  const w = nextWeekdayISO(3, now, true); // mercredi
  const f = nextWeekdayISO(5, now, true); // vendredi
  return (new Date(w) <= new Date(f)) ? w : f;
}

export default function CdpPage(){
  const router = useRouter();
  const qd = typeof router.query.d === "string" ? router.query.d : "";
  const deliveryISO = useMemo(() => (qd && /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : pickDefaultDateISO()), [qd]);

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supplierPhone, setSupplierPhone] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [currentItems, setCurrentItems] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);

  const wISO = useMemo(() => nextWeekdayISO(3, new Date(), true), []);
  const fISO = useMemo(() => nextWeekdayISO(5, new Date(), true), []);

  const cutoffAt = useMemo(() => localAt(dayBeforeISO(deliveryISO), 12, 0), [deliveryISO]);
  const locked = useMemo(() => new Date() >= new Date(cutoffAt.getTime()+60*1000) && new Date() <= endOfDay(deliveryISO), [cutoffAt, deliveryISO]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setToast(null);

      const s = await supabase.from("suppliers").select("phone_whatsapp").eq("key", SUPPLIER_KEY).maybeSingle();
      if (!s.error) setSupplierPhone(s.data?.phone_whatsapp || "");

      const o = await supabase
        .from("orders")
        .select("id,status,delivery_date,supplier_key,sent_at,cutoff_at,created_at")
        .eq("supplier_key", SUPPLIER_KEY)
        .eq("delivery_date", deliveryISO)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (o.error) {
        setCurrentOrder(null);
        setCurrentItems([]);
      } else {
        setCurrentOrder(o.data || null);
        if (o.data?.id) {
          const it = await supabase
            .from("order_items")
            .select("product_id,product_name,qty,unit_price")
            .eq("order_id", o.data.id);
          const compact = compressItems(it.data || []);
          setCurrentItems(compact);

          if ((o.data.status || "draft") === "sent") {
            const b = readBaseline(o.data.id);
            if (!b) writeBaseline(o.data.id, compact);
          }
        } else {
          setCurrentItems([]);
        }
      }

      const r = await supabase
        .from("orders")
        .select("id,status,delivery_date,sent_at,created_at")
        .eq("supplier_key", SUPPLIER_KEY)
        .order("delivery_date", { ascending: false })
        .limit(10);

      setRecentOrders(r.data || []);
      setLoading(false);
    })();
  }, [deliveryISO]);

  function setD(iso){
    router.replace({ pathname: router.pathname, query: { ...router.query, d: iso } }, undefined, { shallow:true });
  }

  async function onSendWhatsApp(){
    setToast(null);

    if (!currentOrder?.id) {
      setToast({ type:"err", msg:"Aucune commande trouvée pour cette livraison. Ouvre la commande et ajoute des produits." });
      return;
    }
    if (!currentItems.length) {
      setToast({ type:"err", msg:"Commande vide. Ajoute des produits avant d’envoyer." });
      return;
    }
    const phoneDigits = normalizeWaPhone(supplierPhone);
    if (!phoneDigits) {
      setToast({ type:"err", msg:"Numéro WhatsApp manquant. Va dans Admin fournisseur pour le renseigner." });
      return;
    }

    const isSent = (currentOrder.status || "draft") === "sent";
    const baseline = readBaseline(currentOrder.id);
    const baseMap = baseline?.map || new Map();

    const deltas = currentItems
      .map(it => {
        const b = Number(baseMap.get(String(it.product_id))||0);
        const q = Number(it.qty)||0;
        const d = Math.max(0, q - b);
        return { ...it, qty: d };
      })
      .filter(it => (Number(it.qty)||0) > 0);

    const lines = isSent ? deltas : currentItems;

    if (isSent && lines.length === 0) {
      setToast({ type:"ok", msg:"Rien de nouveau à envoyer (aucun rajout)." });
      return;
    }

    const msg = buildMsg({ supplierLabel: SUPPLIER_LABEL, deliveryISO, mode: isSent ? "delta" : "full", lines });
    const waUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;

    if (!isSent) {
      const cutoffISO = cutoffAt.toISOString();
      const u = await supabase.from("orders").update({ status:"sent", sent_at: new Date().toISOString(), cutoff_at: cutoffISO }).eq("id", currentOrder.id);
      if (u.error) {
        setToast({ type:"err", msg:`Envoi WhatsApp ok, mais impossible de marquer 'sent' : ${u.error.message}` });
      }
    }

    writeBaseline(currentOrder.id, currentItems);
    window.open(waUrl, "_blank", "noopener,noreferrer");
    setToast({ type:"ok", msg: isSent ? "Rajout WhatsApp prêt ✓" : "Commande WhatsApp prête ✓" });
  }

  return (
    <>
      <Head>
        <title>Coup de Pâtes — commandes</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ ...LAYOUT, fontFamily: FONT_STACK, color:"#111827", background:"#f6f7f9", minHeight:"100vh" }}>
        <div style={TOPBAR}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button
              onClick={() => !locked && router.push({ pathname:"/orders", query: { supplier: SUPPLIER_KEY, delivery: deliveryISO } })}
              disabled={locked}
              style={{
                ...BTN_PRIMARY,
                cursor: locked ? "not-allowed" : "pointer",
                opacity: locked ? 0.6 : 1
              }}
            >
              Ouvrir commande
            </button>

            <button onClick={onSendWhatsApp} disabled={locked} style={{ ...BTN_PRIMARY, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.6 : 1 }}>
              📲 Envoyer WhatsApp
            </button>
          </div>

          <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ padding:12, borderRadius:12, border:"1px solid #e6e8eb", background:"#fff" }}>
              <div style={{ fontWeight:800, marginBottom:6 }}>Commande du {fmtISODate(deliveryISO)}</div>
              {loading ? (
                <div style={MUTED}>Chargement…</div>
              ) : !currentOrder ? (
                <div style={MUTED}>Aucune commande encore.</div>
              ) : (
                <>
                  <div style={{ ...MUTED, marginBottom:6 }}>
                    Statut : <b style={{ color:"#111827" }}>{(currentOrder.status || "draft") === "sent" ? "Envoyée" : "Brouillon"}</b>
                  </div>
                  {currentItems.length ? (
                    <div style={{ maxHeight:160, overflow:"auto", border:"1px solid #f0f0f0", borderRadius:10, padding:10, background:"#fafafa" }}>
                      {currentItems.map((it) => (
                        <div key={it.product_id} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:"2px 0" }}>
                          <span>{it.product_name || "Produit"}</span>
                          <b>{it.qty}</b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={MUTED}>Commande vide.</div>
                  )}
                </>
              )}
            </div>

            <div style={{ padding:12, borderRadius:12, border:"1px solid #e6e8eb", background:"#fff" }}>
              <div style={{ fontWeight:800, marginBottom:6 }}>Commandes récentes</div>
              {loading ? (
                <div style={MUTED}>Chargement…</div>
              ) : recentOrders.length === 0 ? (
                <div style={MUTED}>Aucune commande.</div>
              ) : (
                <div style={{ display:"grid", gap:8 }}>
                  {recentOrders.map((o) => (
                    <div key={o.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"8px 10px", border:"1px solid #f0f0f0", borderRadius:12, background:"#fafafa" }}>
                      <div>
                        <div style={{ fontWeight:700 }}>{fmtISODate(o.delivery_date)}</div>
                        <div style={{ fontSize:12, color:"#6b7280" }}>
                          {(o.status || "draft") === "sent" ? "Envoyée" : "Brouillon"}
                        </div>
                      </div>
                      <Link href={{ pathname:"/orders", query: { supplier: SUPPLIER_KEY, delivery: o.delivery_date } }} style={{ ...BTN, fontSize:13, textDecoration:"none" }}>
                        Ouvrir
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {toast && (
          <div style={{
            ...CARD,
            borderColor: toast.type === "err" ? "#fecaca" : "#c7f9cc",
            background: toast.type === "err" ? "#fff1f2" : "#f0fff4"
          }}>
            <b>{toast.type === "err" ? "⚠️" : "✅"}</b> {toast.msg}
          </div>
        )}
      </div>
    </>
  );
}
