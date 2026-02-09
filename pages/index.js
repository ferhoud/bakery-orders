// pages/index.js
import Link from "next/link";
import Head from "next/head";

const FONT_STACK = `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial`;
const LAYOUT = { maxWidth: 1180, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 18 };
const TOPBAR = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const GRID   = { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:16 };
const CARD   = { background:"#fff", border:"1px solid #e6e8eb", borderRadius:16, padding:18, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" };
const BTN    = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8, padding:"16px 18px", borderRadius:12, border:"1px solid #e6e8eb", background:"#fff", cursor:"pointer", textDecoration:"none", fontWeight:600, fontSize:18 };

export default function Home() {
  return (
    <>
      <Head>
        <title>Commandes et livraisons</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ ...LAYOUT, fontFamily: FONT_STACK, color:"#111827", background:"#f6f7f9", minHeight:"100vh" }}>
        <div style={TOPBAR}>
          <h1 style={{ fontSize:28, margin:0 }}>🧺 Commandes et livraisons</h1>
          <div style={{ display:"flex", gap:10 }}>
            <Link href="/products" style={{ ...BTN, fontSize:14 }}>📦 Catalogue produits</Link>
            <Link href="/admin/suppliers" style={{ ...BTN, fontSize:14 }}>🛠️ Admin fournisseur</Link>
            <Link href="/api/version" style={{ ...BTN, fontSize:14 }}>🔎 Version</Link>
          </div>
        </div>

        <div style={CARD}>
          <p style={{ marginTop:0, marginBottom:12, color:"#6b7280" }}>
            Choisis un fournisseur. Chaque page est dédiée (produits, commande en cours, historique).
          </p>
          <div style={GRID}>
            <Link href="/suppliers/becus" style={BTN}>🥖 Bécus</Link>
            <Link href="/suppliers/cdp" style={BTN}>🥐 Coup de Pâtes</Link>
            <Link href="/suppliers/moulins" style={BTN}>🌾 Moulins Bourgeois</Link>
          </div>
        </div>
      </div>
    </>
  );
}
