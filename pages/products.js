// pages/products.js
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/* =============== Thème clair (fond blanc) =============== */
const COLORS = {
  pageBg:   "#ffffff",
  ink:      "#0f172a",
  inkSoft:  "#64748b",
  line:     "#e5e7eb",
  cardBg:   "#ffffff",
  cardLine: "#e5e7eb",
  primary:  "#4f46e5",
  accent:   "#7c3aed",
  success:  "#16a34a",
  warn:     "#f59e0b",
  danger:   "#ef4444",
  neutral:  "#334155",
};

const FONT = "'Manrope','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";

const PAGE   = { minHeight:"100vh", background:COLORS.pageBg, color:COLORS.ink, padding:"24px 16px", fontFamily:FONT };
const WRAP   = { maxWidth:1220, margin:"0 auto", display:"flex", flexDirection:"column", gap:18 };
const HEADER = { background:"#f8fafc", border:`1px solid ${COLORS.line}`, borderRadius:18, padding:"14px 16px", display:"flex", alignItems:"center", gap:12 };
const H1     = { fontSize:26, fontWeight:900, letterSpacing:.2 };
const CARD   = { background:COLORS.cardBg, border:`1px solid ${COLORS.cardLine}`, borderRadius:18, padding:16 };
const SUB    = { fontSize:13, color:COLORS.inkSoft };

const BTN = (bg=COLORS.primary) => ({
  background:bg, color:"#fff", border:"1px solid rgba(0,0,0,.06)", borderRadius:12,
  padding:"12px 16px", fontSize:15, fontWeight:900, letterSpacing:.2,
  cursor:"pointer", display:"inline-flex", alignItems:"center", gap:10
});
const BTNO = () => ({ ...BTN("#f1f5f9"), color:COLORS.ink, border:`1px solid ${COLORS.line}` });

const CHIP = (bg,ink) => ({ background:bg, color:ink, border:`1px solid ${COLORS.line}`, borderRadius:999, padding:"6px 10px", fontSize:12, fontWeight:900 });

const INPUT  = { padding:"12px 12px", borderRadius:10, border:`1px solid ${COLORS.line}`, background:"#fff", color:COLORS.ink, fontSize:15, width:"100%" };
const SELECT = { ...INPUT };
const CHECK  = { width:18, height:18 };

/* =============== Métier =============== */
const FALLBACK_SUPPLIERS = [
  { key:"becus",       label:"Bécus" },
  { key:"coupdepates", label:"Coup de Pâtes" }
];
const DEPT_OPTIONS = [
  { key:"patiss",    label:"Pâtisserie" },
  { key:"boulanger", label:"Boulangerie" },
  { key:"vente",     label:"Vente" },
];

function deptKeyLabel(k){ return DEPT_OPTIONS.find(x=>x.key===k)?.label ?? k ?? "—"; }
function deptFromRow(p){ return p?.dept ?? p?.department ?? p?.departement ?? p?.category ?? p?.categorie ?? p?.type ?? p?.section ?? p?.family ?? p?.famille ?? ""; }
function supplierLabel(key, list){ return list.find(s=>s.key===key)?.label || key || "—"; }

/* -------- SELECT tolérant (retire les colonnes absentes) -------- */
async function pickProductsSelect() {
  let cols = [
    "id","name","price",
    "dept","department","departement","category","categorie","type","section","family","famille",
    "supplier_key","supplier",
    "is_active","active",
    "icon","image_url" // optionnelles
  ];
  let sel = cols.join(",");
  let available = new Set(cols);
  for (let i=0;i<10;i++){
    const { error } = await supabase.from("products").select(sel).limit(1);
    if (!error) break;
    const m = /column\s+(?:\w+\.)?([a-zA-Z_]\w*)\s+does not exist/i.exec(error?.message||"");
    if (!m) break;
    available.delete(m[1]);
    cols = cols.filter(c => c !== m[1]);
    sel = cols.join(",");
  }
  if (cols.length === 0) {
    sel = "id,name,price,dept,supplier_key,supplier,is_active,active";
    available = new Set(sel.split(","));
  }
  return { sel, available };
}

/* --------- Construit un payload qui respecte les colonnes existantes --------- */
function buildProductPayload(availableCols, {
  name, price, dept, supplier_key, is_active, image_url, icon
}) {
  const p = {};
  p.name  = (name || "").trim();
  p.price = price === "" ? null : Number(price);

  // dept → écrit dans la 1ère colonne existante parmi la liste
  if (availableCols.has("dept"))         p.dept         = dept;
  else if (availableCols.has("department"))   p.department   = dept;
  else if (availableCols.has("departement"))  p.departement  = dept;
  else if (availableCols.has("category"))     p.category     = dept;
  else if (availableCols.has("categorie"))    p.categorie    = dept;
  else if (availableCols.has("type"))         p.type         = dept;
  else if (availableCols.has("section"))      p.section      = dept;
  else if (availableCols.has("family"))       p.family       = dept;
  else if (availableCols.has("famille"))      p.famille      = dept;

  // supplier
  if (availableCols.has("supplier_key")) p.supplier_key = supplier_key;
  if (availableCols.has("supplier"))     p.supplier     = supplier_key; // compat

  // actif
  if (availableCols.has("is_active")) p.is_active = !!is_active;
  if (availableCols.has("active"))    p.active    = !!is_active;

  // médias
  if (availableCols.has("image_url")) p.image_url = (image_url || "").trim() || null;
  if (availableCols.has("icon"))      p.icon      = (icon || "").trim() || null;

  return p;
}

/* ===================== Page ===================== */
export default function ProductsPage(){
  const [suppliers, setSuppliers] = useState(FALLBACK_SUPPLIERS);
  const [rows, setRows] = useState([]);
  const [availableCols, setAvailableCols] = useState(new Set());

  // Filtres
  const [filterSupp, setFilterSupp] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [search, setSearch] = useState("");

  // Form ajout
  const [fName, setFName] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fDept, setFDept] = useState(DEPT_OPTIONS[0].key);
  const [fSupp, setFSupp] = useState(FALLBACK_SUPPLIERS[0].key);
  const [fActive, setFActive] = useState(true);
  const [fImg, setFImg] = useState("");
  const [fIcon, setFIcon] = useState("");

  // Sélection
  const [selected, setSelected] = useState(new Set()); // ids cochés

  // Modale d’édition
  const [editModal, setEditModal] = useState(null); // {id, ...row}
  const [saving, setSaving] = useState(false);

  const [uiMsg, setUiMsg] = useState(null);

  const filtered = useMemo(()=>{
    return rows.filter(r=>{
      const suppKey = r.supplier_key || r.supplier || "";
      const deptKey = deptFromRow(r);
      const okSupp = filterSupp==="all" ? true : String(suppKey)===String(filterSupp);
      const okDept = filterDept==="all" ? true : String(deptKey)===String(filterDept);
      const q = (search||"").trim().toLowerCase();
      const okSearch = !q || (r.name||"").toLowerCase().includes(q);
      return okSupp && okDept && okSearch;
    });
  }, [rows, filterSupp, filterDept, search]);

  useEffect(()=>{
    (async ()=>{
      // fournisseurs
      let s = [];
      const { data: sup } = await supabase.from("suppliers").select("key,label,name").order("label", {ascending:true});
      if (Array.isArray(sup) && sup.length) {
        s = sup.map(r => ({ key: r.key || (r.name||"").toLowerCase().replace(/\s+/g,""), label: r.label || r.name || r.key || "—" }));
      } else {
        s = FALLBACK_SUPPLIERS;
      }
      setSuppliers(s);
      if (s.length) setFSupp(s[0].key);

      await reloadProducts();
    })();
  }, []);

  async function reloadProducts(){
    const { sel, available } = await pickProductsSelect();
    setAvailableCols(available);
    const res = await supabase.from("products").select(sel).order("name", {ascending:true}).limit(3000);
    if (res.error) {
      console.error(res.error);
      setUiMsg({ type:"error", text:"Erreur lecture produits : " + res.error.message });
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setSelected(new Set());
    setEditModal(null);
  }

  /* ---------- Ajout ---------- */
  async function handleAdd(){
    const payload = buildProductPayload(availableCols, {
      name: fName,
      price: fPrice,
      dept: fDept,
      supplier_key: fSupp,
      is_active: fActive,
      image_url: fImg,
      icon: fIcon
    });
    if (!payload.name) return alert("Nom obligatoire.");

    const { error } = await supabase.from("products").insert(payload);
    if (error) return alert("Erreur ajout: " + error.message);

    setFName(""); setFPrice(""); setFDept(DEPT_OPTIONS[0].key);
    setFSupp(suppliers[0]?.key||""); setFActive(true); setFImg(""); setFIcon("");
    await reloadProducts();
  }

  /* ---------- Sélection ---------- */
  function toggleAll(e){
    const checked = e.target.checked;
    if (!checked) return setSelected(new Set());
    setSelected(new Set(filtered.map(r => r.id)));
  }
  function toggleOne(id){
    setSelected(prev=>{
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  /* ---------- Suppression ---------- */
  async function bulkDelete(){
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} produit(s) ?`)) return;
    const { error } = await supabase.from("products").delete().in("id", ids);
    if (error) {
      const msg = /row-level security/i.test(error.message||"")
        ? "Suppression bloquée par RLS : ajoute des policies sur la table products."
        : error.message;
      return alert("Erreur suppression : " + msg);
    }
    await reloadProducts();
  }

  /* ---------- Edition (modale) ---------- */
  function openEditFromSelection(){
    if (selected.size !== 1) return;
    const id = Array.from(selected)[0];
    const r = rows.find(x => String(x.id) === String(id));
    if (!r) return;
    openEdit(r);
  }
  function openEdit(r){
    setEditModal({
      id: r.id,
      name: r.name || "",
      price: r.price ?? "",
      dept: deptFromRow(r) || DEPT_OPTIONS[0].key,
      supplier_key: r.supplier_key || r.supplier || suppliers[0]?.key || "",
      is_active: r.is_active !== false && r.active !== false,
      image_url: r.image_url || "",
      icon: r.icon || ""
    });
  }

  async function saveEdit(){
    if (!editModal) return;
    setSaving(true);
    try{
      const payload = buildProductPayload(availableCols, {
        name: editModal.name,
        price: editModal.price,
        dept: editModal.dept,
        supplier_key: editModal.supplier_key,
        is_active: editModal.is_active,
        image_url: editModal.image_url,
        icon: editModal.icon
      });

      const { error } = await supabase.from("products").update(payload).eq("id", editModal.id);
      if (error) throw error;

      setEditModal(null);
      await reloadProducts();
    }catch(e){
      alert("Erreur modification : " + (e.message || e));
    }finally{
      setSaving(false);
    }
  }

  // Upload optionnel vers Supabase Storage (si bucket existe)
  async function tryUploadToStorage(file){
    try{
      const bucket = "product-images";
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `p_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert:false, cacheControl:"3600" });
      if (upErr) throw upErr;
      const { data: pub } = await supabase.storage.from(bucket).getPublicUrl(path);
      return pub?.publicUrl || "";
    }catch(e){
      console.warn("Upload storage échoué:", e?.message||e);
      setUiMsg({ type:"error", text:"Upload non configuré. Colle l’URL de l’image à la place." });
      return "";
    }
  }

  const showIconCol  = availableCols.has("icon");
  const showImageCol = availableCols.has("image_url");

  return (
    <div style={PAGE}>
      {/* Police */}
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800;900&display=swap" rel="stylesheet" />
        <title>Produits</title>
      </Head>

      <div style={WRAP}>
        {/* Header */}
        <div style={HEADER}>
          <h1 style={H1}>Produits</h1>
          <div style={{ marginLeft:"auto", display:"flex", gap:8, flexWrap:"wrap" }}>
            <Link href="/"><button style={BTNO()}>← Accueil</button></Link>
            <Link href="/admin/suppliers"><button style={{ ...BTNO(), borderColor:COLORS.line }}>🛠️ Admin fournisseurs</button></Link>
          </div>
        </div>

        {/* Bandeau “Ajouter un produit” */}
        <div style={CARD}>
          <div style={{ fontWeight:900, fontSize:18, marginBottom:8 }}>Ajouter un produit</div>
          <div style={{ display:"grid", gap:12 }}>
            <div style={{ display:"grid", gap:12, gridTemplateColumns:`${showIconCol||showImageCol ? "auto " : ""} 2fr 1fr 1fr 1fr 1fr` }}>
              {(showIconCol || showImageCol) && (
                <div>
                  <label style={SUB}>{showIconCol ? "Icône (emoji)" : "Image"}</label>
                  {showIconCol && (
                    <input
                      style={{ ...INPUT, width:90, textAlign:"center", fontSize:24 }}
                      placeholder="🥐"
                      value={fIcon}
                      onChange={e=>setFIcon(e.target.value)}
                      title="Mets un emoji (ex: 🥐)"
                    />
                  )}
                </div>
              )}
              <div>
                <label style={SUB}>Nom du produit</label>
                <input style={INPUT} placeholder="ex. PAIN CHOCOLAT x150" value={fName} onChange={e=>setFName(e.target.value)} />
              </div>
              <div>
                <label style={SUB}>Prix (optionnel)</label>
                <input style={INPUT} type="number" step="0.01" placeholder="ex. 1.80" value={fPrice} onChange={e=>setFPrice(e.target.value)} />
              </div>
              <div>
                <label style={SUB}>Département</label>
                <select style={SELECT} value={fDept} onChange={e=>setFDept(e.target.value)}>
                  {DEPT_OPTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label style={SUB}>Fournisseur</label>
                <select style={SELECT} value={fSupp} onChange={e=>setFSupp(e.target.value)}>
                  {suppliers.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={SUB}>Actif</label>
                <div style={{ display:"flex", alignItems:"center", gap:10, height:46 }}>
                  <input style={CHECK} type="checkbox" checked={fActive} onChange={e=>setFActive(e.target.checked)} />
                  <span style={SUB}>{fActive ? "Oui" : "Non"}</span>
                </div>
              </div>
            </div>

            {showImageCol && (
              <div style={{ display:"grid", gap:12, gridTemplateColumns:"1fr auto" }}>
                <div>
                  <label style={SUB}>URL image (optionnel)</label>
                  <input style={INPUT} placeholder="https://…/image.jpg" value={fImg} onChange={e=>setFImg(e.target.value)} />
                </div>
                <div style={{ display:"flex", alignItems:"end", gap:8 }}>
                  <label style={{ ...BTN("#f1f5f9"), color:COLORS.ink, cursor:"pointer" }}>
                    📤 Upload
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display:"none" }}
                      onChange={async (e)=>{
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const url = await tryUploadToStorage(file);
                        if (url) setFImg(url);
                      }}
                    />
                  </label>
                  <button style={BTN(COLORS.success)} onClick={handleAdd}>➕ Ajouter</button>
                </div>
              </div>
            )}

            {!showImageCol && (
              <div style={{ display:"flex", justifyContent:"flex-end" }}>
                <button style={BTN(COLORS.success)} onClick={handleAdd}>➕ Ajouter</button>
              </div>
            )}
          </div>
        </div>

        {/* Filtres / recherche */}
        <div style={CARD}>
          <div style={{ fontWeight:900, fontSize:18, marginBottom:8 }}>Rechercher / filtrer les produits</div>
          <div style={{ display:"grid", gap:12, gridTemplateColumns:"1fr 1fr 2fr" }}>
            <div>
              <label style={SUB}>Fournisseur</label>
              <select style={SELECT} value={filterSupp} onChange={e=>setFilterSupp(e.target.value)}>
                <option value="all">Tous</option>
                {suppliers.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={SUB}>Département</label>
              <select style={SELECT} value={filterDept} onChange={e=>setFilterDept(e.target.value)}>
                <option value="all">Tous</option>
                {DEPT_OPTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label style={SUB}>Rechercher…</label>
              <input style={INPUT} placeholder="Tape un nom de produit…" value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Liste + barre d’actions */}
        <div style={CARD}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontWeight:900, fontSize:18 }}>Catalogue</div>
            <div style={{ display:"flex", gap:8 }}>
              <button style={BTN(COLORS.accent)} onClick={openEditFromSelection} disabled={selected.size !== 1}>
                ✏️ Modifier {selected.size === 1 ? "(1)" : ""}
              </button>
              <button style={BTN(COLORS.danger)} onClick={bulkDelete} disabled={selected.size === 0}>
                🗑️ Supprimer {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          </div>

          <div style={{ width:"100%", overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:0 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["", "","Nom","Département","Fournisseur","Prix","Actif","Actions"].map((h,i)=>(
                    <th key={i} style={{ textAlign:"left", padding:"10px 10px", fontSize:13, color:COLORS.inkSoft, borderBottom:`1px solid ${COLORS.cardLine}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Ligne “sélectionner tout” */}
                <tr>
                  <td style={{ padding:"10px" }}>
                    <input
                      type="checkbox"
                      style={CHECK}
                      onChange={toggleAll}
                      checked={filtered.length>0 && filtered.every(r=>selected.has(r.id))}
                    />
                  </td>
                  <td colSpan={7} style={{ padding:"10px", color:COLORS.inkSoft, fontSize:13 }}>
                    Sélectionner / désélectionner tout (filtre courant)
                  </td>
                </tr>

                {filtered.map(r=>{
                  const dep = deptFromRow(r);
                  const active = r.is_active !== false && r.active !== false;
                  const isChecked = selected.has(r.id);
                  const thumb = (availableCols.has("icon") && r.icon) ? "emoji"
                                : (availableCols.has("image_url") && r.image_url) ? "img" : null;

                  return (
                    <tr key={r.id} style={{ borderBottom:`1px solid ${COLORS.cardLine}` }}>
                      {/* Checkbox */}
                      <td style={{ padding:"10px" }}>
                        <input type="checkbox" style={CHECK} checked={isChecked} onChange={()=>toggleOne(r.id)} />
                      </td>

                      {/* Icône / image */}
                      <td style={{ padding:"10px", width:50 }}>
                        {thumb === "emoji" && <span style={{ fontSize:22 }}>{r.icon}</span>}
                        {thumb === "img"   && <img src={r.image_url} alt="" style={{ width:28, height:28, objectFit:"cover", borderRadius:6, border:`1px solid ${COLORS.line}` }} />}
                      </td>

                      {/* Nom */}
                      <td style={{ padding:"10px" }}>
                        <div style={{ fontWeight:800 }}>{r.name}</div>
                      </td>

                      {/* Dept */}
                      <td style={{ padding:"10px" }}>
                        <span style={CHIP("#f1f5f9", COLORS.ink)}>{deptKeyLabel(dep)}</span>
                      </td>

                      {/* Supplier */}
                      <td style={{ padding:"10px" }}>
                        {supplierLabel(r.supplier_key || r.supplier, suppliers)}
                      </td>

                      {/* Prix */}
                      <td style={{ padding:"10px" }}>
                        {(r.price==null || r.price==="") ? "—" : Number(r.price).toFixed(2)+" €"}
                      </td>

                      {/* Actif */}
                      <td style={{ padding:"10px" }}>
                        <span style={CHIP(active ? "#eafbea" : "#feecec", active ? COLORS.success : COLORS.danger)}>{active ? "Oui" : "Non"}</span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding:"10px" }}>
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                          <button style={BTN(COLORS.accent)} onClick={()=>openEdit(r)} disabled={!isChecked} title="Coche la ligne pour modifier">✏️ Modifier</button>
                          <button style={BTN(COLORS.danger)} onClick={()=>{ setSelected(new Set([r.id])); bulkDelete(); }} disabled={!isChecked} title="Coche la ligne pour supprimer">🗑️ Supprimer</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length===0 && (
                  <tr>
                    <td colSpan={8} style={{ padding:"14px 10px", color:COLORS.inkSoft }}>Aucun produit trouvé.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== Modale d’édition ===== */}
        {editModal && (
          <div style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50
          }}>
            <div style={{ width:"min(720px, 92vw)", background:"#fff", color:COLORS.ink, borderRadius:16, border:`1px solid ${COLORS.line}`, boxShadow:"0 30px 80px rgba(0,0,0,.35)" }}>
              <div style={{ padding:"14px 16px", borderBottom:`1px solid ${COLORS.line}`, display:"flex", alignItems:"center" }}>
                <div style={{ fontWeight:900, fontSize:18 }}>Modifier le produit</div>
                <div style={{ marginLeft:"auto" }}>
                  <button onClick={()=>setEditModal(null)} style={{ ...BTNO(), padding:"8px 12px" }}>✖ Fermer</button>
                </div>
              </div>

              <div style={{ padding:16, display:"grid", gap:12 }}>
                <div style={{ display:"grid", gap:12, gridTemplateColumns:`${(availableCols.has("icon")||availableCols.has("image_url")) ? "auto " : ""} 2fr 1fr 1fr` }}>
                  {(availableCols.has("icon") || availableCols.has("image_url")) && (
                    <div>
                      <label style={SUB}>{availableCols.has("icon") ? "Icône (emoji)" : "Image"}</label>
                      {availableCols.has("icon") && (
                        <input
                          style={{ ...INPUT, width:90, textAlign:"center", fontSize:26 }}
                          value={editModal.icon || ""}
                          placeholder="🥐"
                          onChange={e=>setEditModal(m=>({ ...m, icon:e.target.value }))}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label style={SUB}>Nom</label>
                    <input style={INPUT} value={editModal.name} onChange={e=>setEditModal(m=>({ ...m, name:e.target.value }))} />
                  </div>
                  <div>
                    <label style={SUB}>Département</label>
                    <select style={SELECT} value={editModal.dept} onChange={e=>setEditModal(m=>({ ...m, dept:e.target.value }))}>
                      {DEPT_OPTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={SUB}>Fournisseur</label>
                    <select style={SELECT} value={editModal.supplier_key} onChange={e=>setEditModal(m=>({ ...m, supplier_key:e.target.value }))}>
                      {suppliers.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display:"grid", gap:12, gridTemplateColumns:"1fr 1fr 1fr" }}>
                  <div>
                    <label style={SUB}>Prix</label>
                    <input style={INPUT} type="number" step="0.01" value={editModal.price ?? ""} onChange={e=>setEditModal(m=>({ ...m, price:e.target.value }))} />
                  </div>
                  <div>
                    <label style={SUB}>Actif</label>
                    <div style={{ display:"flex", alignItems:"center", gap:10, height:46 }}>
                      <input style={CHECK} type="checkbox" checked={!!editModal.is_active} onChange={e=>setEditModal(m=>({ ...m, is_active:e.target.checked }))} />
                      <span style={SUB}>{editModal.is_active ? "Oui" : "Non"}</span>
                    </div>
                  </div>
                  <div />
                </div>

                {availableCols.has("image_url") && (
                  <div style={{ display:"grid", gap:12, gridTemplateColumns:"1fr auto" }}>
                    <div>
                      <label style={SUB}>URL image</label>
                      <input style={INPUT} placeholder="https://…/image.jpg" value={editModal.image_url || ""} onChange={e=>setEditModal(m=>({ ...m, image_url:e.target.value }))} />
                    </div>
                    <div style={{ display:"flex", alignItems:"end", gap:8 }}>
                      <label style={{ ...BTN("#f1f5f9"), color:COLORS.ink, cursor:"pointer" }}>
                        📤 Upload
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display:"none" }}
                          onChange={async (e)=>{
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const url = await tryUploadToStorage(file);
                            if (url) setEditModal(m=>({ ...m, image_url:url }));
                          }}
                        />
                      </label>
                      {editModal.image_url && (
                        <img src={editModal.image_url} alt="" style={{ width:40, height:40, objectFit:"cover", borderRadius:8, border:`1px solid ${COLORS.line}` }} />
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding:"12px 16px", borderTop:`1px solid ${COLORS.line}`, display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button style={BTNO()} onClick={()=>setEditModal(null)}>Annuler</button>
                <button style={BTN(COLORS.success)} onClick={saveEdit} disabled={saving}>{saving ? "Enregistrement…" : "💾 Enregistrer"}</button>
              </div>
            </div>
          </div>
        )}

        {/* Toast simple */}
        {uiMsg && (
          <div style={{
            position:"fixed", bottom:18, left:"50%", transform:"translateX(-50%)",
            background:"#e0f2fe", border:"1px solid #38bdf8", color:COLORS.ink,
            padding:"10px 14px", borderRadius:12, zIndex:60
          }}>
            <span>{uiMsg.text}</span>
            <button onClick={()=>setUiMsg(null)} style={{ background:"none", border:"none", color:COLORS.ink, textDecoration:"underline", marginLeft:10, cursor:"pointer" }}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}
