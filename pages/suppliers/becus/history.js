// pages/suppliers/becus/history.js
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const SUPPLIER_KEY = "becus";
const UI_TAG = "v-becus-ui-2026-02-08-3";

function isoToFR(iso) {
  if (!iso || typeof iso !== "string" || !iso.includes("-")) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function BecusHistory() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await supabase
          .from("orders")
          .select("*")
          .eq("supplier_key", SUPPLIER_KEY)
          .order("delivery_date", { ascending: false })
          .limit(50);
        if (r.error) throw r.error;
        setRows(r.data || []);
      } catch (e) {
        setErr((e?.message || "Erreur").toString());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial' }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link
          href={`/suppliers/${SUPPLIER_KEY}`}
          style={{ textDecoration: "none", border: "1px solid #e5e7eb", padding: "8px 12px", borderRadius: 999 }}
        >
          ← Retour
        </Link>
        <h1 style={{ margin: 0, fontSize: 18 }}>Archives Bécus</h1>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.6, fontSize: 12 }}>UI: {UI_TAG}</span>
      </div>

      {loading ? <p>Chargement…</p> : null}
      {err ? <p style={{ color: "#b91c1c" }}>{err}</p> : null}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {rows.map((o) => (
          <div key={o.id} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>Livraison : {isoToFR(o.delivery_date)}</div>
              <span style={{ opacity: 0.7, fontSize: 12 }}>Statut : {(o.status || "—").toString()}</span>
              <div style={{ flex: 1 }} />
              <Link
                href={`/suppliers/${SUPPLIER_KEY}/order?date=${encodeURIComponent(o.delivery_date)}`}
                style={{ textDecoration: "none", border: "1px solid #e5e7eb", padding: "8px 12px", borderRadius: 999 }}
              >
                Ouvrir
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
