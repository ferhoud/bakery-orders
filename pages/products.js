// pages/products.js
import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

/* ---------- suppliers ---------- */
const SUPPLIERS = [
  { key: "becus",       label: "Bécus" },
  { key: "coupdepates", label: "Coup de Pâtes" },
  { key: "moulins",     label: "Moulins Bourgeois" },
];
const supplierLabel = (k) => SUPPLIERS.find(s => s.key === k)?.label || k || "—";

/* ---------- design tokens ---------- */
const FONT_STACK = `"Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"`;
const CARD  = { background: "#fff", border: "1px solid #e6e8ee", borderRadius: 16, padding: 14, boxShadow: "0 8px 24px rgba(15,23,42,.04)" };
const INPUT = {
  padding: "12px 14px",
  border: "1px solid #e6e8ee",
  borderRadius: 12,
  width: "100%",
  fontSize: 15,
  fontWeight: 500,
  fontFamily: FONT_STACK,
  WebkitAppearance: "auto",
  MozAppearance: "auto",
  appearance: "auto",
  backgroundColor: "#fff"
};
const LABEL = { fontSize: 12, fontWeight: 600, color: "#566074", marginBottom: 6, letterSpacing: ".2px", fontFamily: FONT_STACK };
const BTN = (primary = false) => ({
  border: "1px solid " + (primary ? "#0ea5e9" : "#e6e8ee"),
  background: primary ? "#0ea5e9" : "#fff",
  color: primary ? "#fff" : "#0f172a",
  borderRadius: 12,
  padding: "10px 14px",
  fontWeight: 600,
  fontSize: 14,
  letterSpacing: ".2px",
  cursor: "pointer",
  boxShadow: primary ? "0 8px 24px rgba(14,165,233,.18)" : "0 2px 6px rgba(15,23,42,.04)",
  fontFamily: FONT_STACK
});
const BTN_DANGER = {
  border: "1px solid #ef4444",
  background: "#ef4444",
  color: "#fff",
  borderRadius: 12,
  padding: "10px 14px",
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: ".2px",
  cursor: "pointer",
  boxShadow: "0 8px 24px rgba(239,68,68,.18)",
  fontFamily: FONT_STACK
};
const CHIP = (active) => ({
  border: "1px solid " + (active ? "#0ea5e9" : "#e6e8ee"),
  background: active ? "#e7f5ff" : "#fff",
  color: active ? "#075985" : "#0f172a",
  borderRadius: 999,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: 14,
  letterSpacing: ".2px",
  cursor: "pointer",
  fontFamily: FONT_STACK
});

/* ---------- utils ---------- */
function canonSupplier(raw) {
  const k = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
  if (!k) return "becus";
  if (k.includes("becus") || k.includes("becos")) return "becus";
  if (k === "cdp" || k.includes("coupdepates") || (k.includes("coup") && k.includes("pate"))) return "coupdepates";
  if (k === "mb" || k.includes("moulin") || k.includes("bourgeois")) return "moulins";
  return "becus";
}

/* Détermine dynamiquement la clé primaire à utiliser (uuid ou id) */
function getPkInfo(obj) {
  if (obj && typeof obj === "object") {
    if (Object.prototype.hasOwnProperty.call(obj, "uuid") && obj.uuid) return { field: "uuid", value: obj.uuid };
    if (Object.prototype.hasOwnProperty.call(obj, "id") && (obj.id ?? null) !== null) return { field: "id", value: obj.id };
  }
  // Fallback neutre
  return { field: "uuid", value: obj?.uuid ?? obj?.id ?? null };
}

/* ============================================================
   Page
   ============================================================ */
export default function ProductsPage() {
  const router = useRouter();
  const activeSupplier = useMemo(() => canonSupplier(router.query.supplier), [router.query.supplier]);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [uiMsg, setUiMsg] = useState(null);

  // Afficher les archivés
  const [showArchived, setShowArchived] = useState(false);

  // Quick Add
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", dept: "", unit: "u", price: "", image_url: "" });

  // Edition produit (drawer latéral)
  // editing: { pkField, pkValue, name, dept, unit(UI), price, image_url, is_active }
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // fetch strict by supplier_key (+ is_active si non “archivés”)
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setProducts([]);
        let q = supabase
          .from("products")
          .select("*")
          .eq("supplier_key", activeSupplier)
          .order("name", { ascending: true });

        if (!showArchived) {
          q = q.eq("is_active", true);
        }

        const { data, error } = await q.limit(2000);
        if (error) throw error;

        const list = (data || []);
        if (on) setProducts(list);
      } catch (e) {
        if (on) setUiMsg({ type: "error", text: "Lecture produits : " + (e?.message || String(e)) });
      }
    })();
    return () => { on = false; };
  }, [activeSupplier, showArchived]);

  const filtered = useMemo(() => {
    const s = (search || "").trim().toLowerCase();
    return (products || []).filter(p => !s || (p.name || "").toLowerCase().includes(s));
  }, [products, search]);

  async function addProduct() {
    const name = form.name.trim();
    if (!name) { setUiMsg({ type: "error", text: "Nom requis" }); return; }
    const payload = {
      name,
      dept: form.dept || null,
      // unit: form.unit,            // la colonne n'existe pas en DB
      price: form.price !== "" ? Number(form.price) : null,
      image_url: form.image_url || null,
      supplier_key: activeSupplier,
      is_active: true
    };
    const { data, error } = await supabase
.from("products")
.insert(payload).select("*").single();
    if (error) { setUiMsg({ type: "error", text: "Ajout : " + error.message }); return; }
    setProducts(p => [data, ...p].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    setShowAdd(false);
    setForm({ name: "", dept: "", unit: "u", price: "", image_url: "" });
    setUiMsg({ type: "success", text: "Produit ajouté ✅" });
  }

  async function updateProductByPk(pkField, pkValue, patch) {
    if (pkValue == null) { setUiMsg({ type:"error", text:"Clé du produit introuvable." }); return null; }
    const { data, error } = await supabase
      .from("products")
      .update(patch)
      .eq(pkField, pkValue)
      .select("*")
      .single();
    if (error) { setUiMsg({ type: "error", text: "Sauvegarde : " + error.message }); return null; }
    setProducts(list => list.map(x => (x[pkField] === pkValue ? data : x)));
    return data;
  }

  function startEdit(product) {
    if (editing) {
      const { pkField, pkValue } = editing;
      if (!(pkField === getPkInfo(product).field && pkValue === getPkInfo(product).value)) {
        const ok = confirm("Remplacer l'édition en cours ? Les modifications non enregistrées seront perdues.");
        if (!ok) return;
      }
    }
    const { field: pkField, value: pkValue } = getPkInfo(product);
    setEditing({
      pkField,
      pkValue,
      name: product.name || "",
      dept: product.dept || "",
      unit: product.unit || "u", // UI only
      price: product.price ?? 0,
      image_url: product.image_url || product.photo_url || "",
      is_active: product.is_active !== false // défaut: actif
    });
    // plus de scrollTo() ici -> le drawer apparaît où que tu sois
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);

    // Patch (sans unit, qui n'existe pas en DB)
    const patch = {
      name: (editing.name || "").trim(),
      dept: editing.dept || null,
      price: editing.price !== "" ? Number(editing.price) : null,
      image_url: editing.image_url || null
      // is_active : géré à part
    };

    const updated = await updateProductByPk(editing.pkField, editing.pkValue, patch);
    setSavingEdit(false);
    if (updated) {
      setEditing(null);
      setUiMsg({ type: "success", text: "Produit modifié ✅" });
    }
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function toggleArchiveInEdit() {
    if (!editing) return;
    const target = !editing.is_active;
    const ok = target
      ? confirm(`Archiver "${editing.name}" ?`)
      : confirm(`Restaurer "${editing.name}" ?`);
    if (!ok) return;

    const updated = await updateProductByPk(editing.pkField, editing.pkValue, { is_active: !editing.is_active });
    if (updated) {
      setEditing(v => v ? { ...v, is_active: updated.is_active } : v);
      setUiMsg({ type: "success", text: target ? "Archivé ✅" : "Restauré ✅" });
    }
  }

  async function hardDeleteInEdit() {
    if (!editing) return;
    const danger = confirm(`Supprimer DÉFINITIVEMENT "${editing.name}" ? (irréversible)`);
    if (!danger) return;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq(editing.pkField, editing.pkValue);

    if (error) { setUiMsg({ type:"error", text:"Suppression : " + error.message }); return; }

    setProducts(list => list.filter(x => x[editing.pkField] !== editing.pkValue));
    setEditing(null);
    setUiMsg({ type:"success", text:"Supprimé 🗑️" });
  }

  const goSupplier = (k) =>
    router.push(
      { pathname: "/products", query: { supplier: k } },
      undefined,
      { shallow: true }
    );

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <Head>
        {/* Inter (variable) pour un rendu moderne et doux */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/"><button style={{ ...BTN(false) }}>← Accueil</button></Link>
        {typeof router.query.back === "string" && router.query.back ? (
          <Link href={router.query.back}><button style={{ ...BTN(false) }}>↩ Retour</button></Link>
        ) : null}

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".2px", margin: 0, fontFamily: FONT_STACK }}>
          Produits — {supplierLabel(activeSupplier)}
        </h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUPPLIERS.map(s => (
            <button
              key={s.key}
              aria-pressed={activeSupplier === s.key}
              onClick={() => goSupplier(s.key)}
              style={CHIP(activeSupplier === s.key)}
              disabled={!!editing}
              title={editing ? "Termine l'édition en cours" : ""}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="Rechercher un produit…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...INPUT, maxWidth: 520, flex: 1 }}
          disabled={!!editing}
        />
        <button
          onClick={() => setShowAdd(v => !v)}
          style={BTN(true)}
          disabled={!!editing}
          title={editing ? "Termine l'édition en cours" : ""}
        >
          ➕ Ajouter un produit
        </button>

        <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
          />
          Afficher archivés
        </label>
      </div>

      {/* PLUS DE PANNEAU INLINE ICI.
          On n'affiche plus le gros bloc {editing && <div style={...CARD}>...</div>}
          Le drawer arrive plus bas ⤵
      */}

      {/* quick add form */}
      {showAdd && !editing && (
        <div style={{ ...CARD, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontFamily: FONT_STACK }}>Ajouter un produit</div>
          <div className="qa-grid">
            <div className="qa-wide">
              <div style={LABEL}>Nom</div>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={INPUT}
                placeholder="Ex. Beurre 1kg"
              />
            </div>

            <div>
              <div style={LABEL}>Dept</div>
              <select
                value={form.dept}
                onChange={e => setForm(f => ({ ...f, dept: e.target.value }))}
                style={INPUT}
              >
                <option value="">— choisir —</option>
                <option value="vente">vente</option>
                <option value="patiss">patiss</option>
                <option value="boulanger">boulanger</option>
              </select>
            </div>

            <div>
              <div style={LABEL}>Unité (affichage)</div>
              <select
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                style={INPUT}
              >
                <option value="u">u</option>
                <option value="kg">kg</option>
                <option value="carton">carton</option>
                <option value="sac">sac</option>
                <option value="boite">boite</option>
                <option value="barquette">barquette</option>
                <option value="pièce">pièce</option>
              </select>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                (Info : l’unité n’est pas enregistrée en base, seulement affichée ici)
              </div>
            </div>

            <div>
              <div style={LABEL}>Prix (€)</div>
              <input
                type="number"
                step="0.01"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                style={INPUT}
                placeholder="0.00"
              />
            </div>

            <div className="qa-wide">
              <div style={LABEL}>Image (URL)</div>
              <input
                value={form.image_url}
                onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))}
                style={INPUT}
                placeholder="https://…"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={addProduct} style={BTN(true)}>Enregistrer</button>
            <button onClick={() => setShowAdd(false)} style={BTN(false)}>Annuler</button>
          </div>
        </div>
      )}

      {/* list produits */}
      <div className="grid">
        {filtered.map(p => (
          <ProductCard
            key={p.uuid ?? p.id}
            product={p}
            disabled={!!editing}
            onStartEdit={() => startEdit(p)}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ ...CARD, textAlign: "center", color: "#6b7280", fontFamily: FONT_STACK }}>
            Aucun produit trouvé pour ce fournisseur.
          </div>
        )}
      </div>

      {/* msg toast en bas */}
      {uiMsg && (
        <div style={{
          position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: uiMsg.type === "error" ? "#fdecea" : uiMsg.type === "success" ? "#e6f4ea" : "#eef4ff",
          border: "1px solid " + (uiMsg.type === "error" ? "#d93025" : uiMsg.type === "success" ? "#34a853" : "#1a73e8"),
          color: "#0f172a", padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.08)", zIndex: 50,
          fontFamily: FONT_STACK
        }}>
          {uiMsg.text}{" "}
          <button
            onClick={() => setUiMsg(null)}
            style={{
              marginLeft: 8,
              background: "none",
              border: "none",
              textDecoration: "underline",
              cursor: "pointer",
              fontFamily: FONT_STACK
            }}
          >
            Fermer
          </button>
        </div>
      )}

      {/* drawer latéral d'édition */}
      <EditDrawer
        editing={editing}
        setEditing={setEditing}
        savingEdit={savingEdit}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onArchiveToggle={toggleArchiveInEdit}
        onHardDelete={hardDeleteInEdit}
      />

      {/* styles */}
      <style jsx>{`
        .grid {
          display: grid;
          grid-template-columns: repeat(1, minmax(0,1fr));
          gap: 10px;
        }
        @media (min-width: 700px) {
          .grid {
            grid-template-columns: repeat(2, minmax(0,1fr));
          }
        }
        @media (min-width: 1000px) {
          .grid {
            grid-template-columns: repeat(3, minmax(0,1fr));
          }
        }

        .qa-grid {
          display: grid;
          grid-template-columns: repeat(1, minmax(0,1fr));
          gap: 10px;
        }
        .qa-wide {
          grid-column: span 1 / span 1;
        }
        @media (min-width: 860px) {
          .qa-grid {
            grid-template-columns: 1fr 1fr 1fr;
          }
          .qa-wide {
            grid-column: span 3 / span 3;
          }
        }
      `}</style>

      <style jsx global>{`
        html, body {
          font-family: ${FONT_STACK};
          color: #0f172a;
          letter-spacing: .1px;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          background: #f7f8fb;
        }
        button, input, select { font-family: ${FONT_STACK}; }
        h1, h2, h3 { font-weight: 700; }
      `}</style>
    </div>
  );
}

/* -------- simple card (only Edit; archive/delete dans le drawer) -------- */
function ProductCard({ product, disabled, onStartEdit }) {
  const thumb =
    product.image_url || product.photo_url || product.image || product.thumbnail ||
    product.photo || product.url_photo || product.imageUrl || product.imageURL ||
    product.picture || product.pic || product.url || null;

  return (
    <div style={{ background:"#fff", border:"1px solid #e6e8ee", borderRadius:16, padding:14, boxShadow:"0 8px 24px rgba(15,23,42,.04)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 10, alignItems: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid #e6e8ee", display: "grid", placeItems: "center", overflow: "hidden" }}>
          {thumb ? (
            <img
              src={thumb}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span aria-hidden>🍞</span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {product.name}{" "}
            {!product.is_active && (
              <span
                style={{
                  marginLeft:8,
                  fontSize:11,
                  padding:"2px 8px",
                  borderRadius:999,
                  border:"1px solid #fca5a5",
                  background:"#fee2e2",
                  color:"#991b1b"
                }}
              >
                Archivé
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {(product.dept || "—")} • {(product.unit || "u")} •{" "}
            {Number(product.price || 0).toFixed(2)}€
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={onStartEdit}
            style={BTN(false)}
            disabled={disabled}
            title={disabled ? "Un produit est déjà en édition" : "Éditer"}
          >
            Éditer
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------- drawer latéral pour éditer un produit -------- */
function EditDrawer({
  editing,
  setEditing,
  savingEdit,
  onSave,
  onCancel,
  onArchiveToggle,
  onHardDelete
}) {
  if (!editing) return null;

  return (
    <>
      {/* fond gris semi-transparent derrière le panneau */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.4)",
          zIndex: 999
        }}
        onClick={() => {
          // clic en dehors = même effet que Annuler
          if (!savingEdit) onCancel();
        }}
      />

      {/* panneau latéral à droite */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          borderLeft: "1px solid #e6e8ee",
          borderRadius: "16px 0 0 16px",
          boxShadow: "0 24px 48px rgba(15,23,42,.18)",
          display: "flex",
          flexDirection: "column",
          zIndex: 1000,
          fontFamily: FONT_STACK
        }}
      >
        {/* HEADER */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: "1px solid #e6e8ee",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>
            Modifier le produit
            {!editing.is_active && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid #fca5a5",
                  background: "#fee2e2",
                  color: "#991b1b"
                }}
              >
                Archivé
              </span>
            )}
            <div
              style={{
                color: "#6b7280",
                fontSize: 12,
                fontWeight: 400,
                marginTop: 4
              }}
            >
              Mets à jour le nom, le département, le prix…
            </div>
          </div>

          <button
            onClick={onCancel}
            style={{
              ...BTN(false),
              padding: "8px 10px",
              fontSize: 13,
              lineHeight: 1
            }}
            disabled={savingEdit}
          >
            ✕
          </button>
        </div>

        {/* CONTENU SCROLLABLE */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16
          }}
        >
          {/* Boutons archiver / supprimer */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 16
            }}
          >
            <button
              onClick={onArchiveToggle}
              style={BTN(false)}
              disabled={savingEdit}
            >
              {editing.is_active ? "Archiver" : "Restaurer"}
            </button>

            <button
              onClick={onHardDelete}
              style={BTN_DANGER}
              disabled={savingEdit}
            >
              Supprimer définitivement
            </button>
          </div>

          {/* Formulaire */}
          <div className="drawer-grid">
            {/* Nom */}
            <div className="drawer-wide">
              <div style={LABEL}>Nom</div>
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, name: e.target.value }))
                }
                style={INPUT}
                placeholder="Nom du produit"
              />
            </div>

            {/* Dept */}
            <div>
              <div style={LABEL}>Dept</div>
              <select
                value={editing.dept}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, dept: e.target.value }))
                }
                style={INPUT}
              >
                <option value="">— choisir —</option>
                {/* IMPORTANT : ces valeurs doivent matcher ta contrainte products_dept_check */}
                <option value="vente">vente</option>
                <option value="patiss">patiss</option>
                <option value="boulanger">boulanger</option>
              </select>
            </div>

            {/* Unité (affichage) */}
            <div>
              <div style={LABEL}>Unité (affichage)</div>
              <select
                value={editing.unit}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, unit: e.target.value }))
                }
                style={INPUT}
              >
                <option value="u">u</option>
                <option value="kg">kg</option>
                <option value="carton">carton</option>
                <option value="sac">sac</option>
                <option value="boite">boite</option>
                <option value="barquette">barquette</option>
                <option value="pièce">pièce</option>
              </select>
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginTop: 6
                }}
              >
                (Info : l’unité n’est pas enregistrée en base)
              </div>
            </div>

            {/* Prix */}
            <div>
              <div style={LABEL}>Prix (€)</div>
              <input
                type="number"
                step="0.01"
                value={editing.price}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, price: e.target.value }))
                }
                style={INPUT}
                placeholder="0.00"
              />
            </div>

            {/* Image URL */}
            <div className="drawer-wide">
              <div style={LABEL}>Image (URL)</div>
              <input
                value={editing.image_url}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, image_url: e.target.value }))
                }
                style={INPUT}
                placeholder="https://…"
              />
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div
          style={{
            padding: 16,
            borderTop: "1px solid #e6e8ee",
            display: "flex",
            flexWrap: "wrap",
            gap: 8
          }}
        >
          <button
            onClick={onSave}
            style={BTN(true)}
            disabled={savingEdit}
          >
            {savingEdit ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            onClick={onCancel}
            style={BTN(false)}
            disabled={savingEdit}
          >
            Annuler
          </button>
        </div>

        <style jsx>{`
          .drawer-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .drawer-wide {
            grid-column: span 1 / span 1;
          }
          @media (min-width: 500px) {
            .drawer-grid {
              grid-template-columns: 1fr 1fr;
            }
            .drawer-wide {
              grid-column: span 2 / span 2;
            }
          }
        `}</style>
      </div>
    </>
  );
}
