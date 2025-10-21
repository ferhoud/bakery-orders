// pages/admin/suppliers.js — v2025-10-15 (imports relatifs + sans useAuth)
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useIsAdmin } from "../../lib/useIsAdmin";

export default function AdminSuppliers() {
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("suppliers")
      .select("key,name,is_active")
      .order("key");
    if (error) console.error(error);
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggle = async (key, cur) => {
    if (!isAdmin) { alert("Réservé à l'admin"); return; }
    const { error } = await supabase
      .from("suppliers")
      .update({ is_active: !cur })
      .eq("key", key);
    if (error) return alert("Erreur: " + error.message);
    load();
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/" style={{ textDecoration: "underline" }}>← Accueil</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Admin — Fournisseurs</h1>
      {!isAdmin && (
        <p style={{ color: "#b91c1c", marginTop: 8 }}>
          Vous n'avez pas les droits admin (email non listé dans <code>admin_emails</code>).
        </p>
      )}

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: 8 }}>Clé</th>
              <th style={{ padding: 8 }}>Nom</th>
              <th style={{ padding: 8 }}>Actif</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{r.key}</td>
                <td style={{ padding: 8 }}>{r.name}</td>
                <td style={{ padding: 8 }}>{r.is_active ? "Oui" : "Non"}</td>
                <td style={{ padding: 8 }}>
                  <button
                    onClick={() => toggle(r.key, r.is_active)}
                    disabled={!isAdmin}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: r.is_active ? "#fff5f5" : "#e6fffa",
                      cursor: isAdmin ? "pointer" : "not-allowed"
                    }}
                  >
                    {r.is_active ? "Désactiver" : "Activer"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
