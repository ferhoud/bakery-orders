// pages/reset-password.js — choisir un nouveau mot de passe après le lien email Supabase
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

function safeNextPath(x) {
  const s = (x ?? "").toString().trim();
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return "/admin/suppliers";
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const nextPath = useMemo(() => safeNextPath(router.query?.next), [router.query]);

  const [ready, setReady] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    async function init() {
      // Avec Supabase, après avoir cliqué le lien de recovery, on a généralement une session.
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setReady(!!data?.session);
      if (!data?.session) {
        setMsg("Ouvre le lien reçu par email pour arriver ici avec une session valide.");
      }
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
        setMsg("");
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setMsg("");

    if (!ready) {
      setMsg("Session de récupération absente. Reviens via le lien email.");
      return;
    }
    if (!newPass || newPass.length < 8) {
      setMsg("Choisis un mot de passe d’au moins 8 caractères.");
      return;
    }
    if (newPass !== newPass2) {
      setMsg("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setSaving(false);

    if (error) {
      setMsg("Erreur: " + error.message);
      return;
    }

    setMsg("Mot de passe mis à jour ✅ Redirection…");
    setTimeout(() => router.replace(nextPath), 700);
  };

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
        <Link href="/login" style={{ textDecoration: "underline", fontWeight: 800 }}>
          ← Retour Login
        </Link>
        <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 800, fontSize: 13 }}>
          Après reset → <b>{nextPath}</b>
        </span>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>Nouveau mot de passe</h1>

      <form onSubmit={onSave} style={card}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 800 }}>
          Nouveau mot de passe
        </label>
        <input
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          placeholder="au moins 8 caractères"
          type="password"
          style={inp}
          autoComplete="new-password"
          disabled={!ready}
        />

        <label style={{ display: "block", margin: "10px 0 6px", fontWeight: 800 }}>
          Confirmer
        </label>
        <input
          value={newPass2}
          onChange={(e) => setNewPass2(e.target.value)}
          placeholder="confirmer"
          type="password"
          style={inp}
          autoComplete="new-password"
          disabled={!ready}
        />

        <button type="submit" disabled={saving || !ready} style={{ ...btn, opacity: saving || !ready ? 0.8 : 1 }}>
          {saving ? "Enregistrement..." : "Valider"}
        </button>

        {msg && <div style={{ marginTop: 10, fontWeight: 800 }}>{msg}</div>}
      </form>
    </div>
  );
}

const card = {
  border: "1px solid rgba(15,23,42,0.10)",
  borderRadius: 14,
  padding: 14,
  background: "#fff",
  boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
};
const inp = {
  width: "100%",
  padding: 11,
  border: "1px solid rgba(15,23,42,0.18)",
  borderRadius: 10,
  outline: "none",
  fontWeight: 800,
};
const btn = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #0ea5e9",
  background: "#0ea5e9",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};
