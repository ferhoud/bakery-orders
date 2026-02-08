// pages/login.js — connexion + "mot de passe oublié" + redirection "next"
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

function safeNextPath(x) {
  const s = (x ?? "").toString().trim();
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return "/";
}

export default function LoginPage() {
  const router = useRouter();
  const { session, user, signOut } = useAuth();

  const nextPath = useMemo(() => safeNextPath(router.query?.next), [router.query]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot password UI
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const onLogin = async (e) => {
    e.preventDefault();
    setMsg("");
    setForgotMsg("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setMsg("Erreur: " + error.message);
      return;
    }

    setMsg("Connecté ✅");
    router.replace(nextPath);
  };

  const onLogout = async () => {
    setMsg("");
    setForgotMsg("");
    await signOut();
    router.replace("/login");
  };

  const onForgot = async (e) => {
    e.preventDefault();
    setForgotMsg("");
    setMsg("");

    const em = (forgotEmail || email || "").trim();
    if (!em) {
      setForgotMsg("Entre ton email (ex: ferhoud@hotmail.com).");
      return;
    }

    setForgotLoading(true);
    try {
      // On envoie un email de récupération.
      // Le lien ramène vers /reset-password et garde le "next".
      const redirectTo = `${window.location.origin}/reset-password?next=${encodeURIComponent(
        nextPath || "/admin/suppliers"
      )}`;

      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo });

      if (error) {
        setForgotMsg("Erreur: " + error.message);
      } else {
        setForgotMsg(
          "Email envoyé ✅ Vérifie ta boîte (et les spams). Ouvre le lien pour définir un nouveau mot de passe."
        );
      }
    } finally {
      setForgotLoading(false);
    }
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
        <Link href="/" style={{ textDecoration: "underline", fontWeight: 800 }}>
          ← Accueil
        </Link>
        <span style={{ color: "rgba(15,23,42,0.55)", fontWeight: 800, fontSize: 13 }}>
          Retour après login: <b>{nextPath}</b>
        </span>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>Connexion</h1>

      {session ? (
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            Connecté en tant que <b>{user?.email}</b>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => router.replace(nextPath)} style={btn}>
              Continuer
            </button>
            <button onClick={onLogout} style={{ ...btn, background: "#fff", color: "#0ea5e9" }}>
              Se déconnecter
            </button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={onLogin} style={card}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 800 }}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              type="email"
              style={inp}
              autoComplete="email"
            />

            <label style={{ display: "block", margin: "10px 0 6px", fontWeight: 800 }}>
              Mot de passe
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mot de passe"
              type="password"
              style={inp}
              autoComplete="current-password"
            />

            <button type="submit" disabled={loading} style={{ ...btn, opacity: loading ? 0.8 : 1 }}>
              {loading ? "Connexion..." : "Se connecter"}
            </button>

            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setShowForgot((v) => !v);
                  setForgotMsg("");
                  setMsg("");
                  setForgotEmail((prev) => prev || email);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontWeight: 900,
                  color: "#0ea5e9",
                  padding: 0,
                }}
              >
                Mot de passe oublié ?
              </button>

              <span style={{ fontSize: 12, color: "rgba(15,23,42,0.55)", fontWeight: 800 }}>
                (admin: email réel recommandé)
              </span>
            </div>

            {msg && <div style={{ marginTop: 10, fontWeight: 800 }}>{msg}</div>}
          </form>

          {showForgot && (
            <form onSubmit={onForgot} style={{ ...card, marginTop: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Réinitialiser le mot de passe</div>
              <div style={{ color: "rgba(15,23,42,0.65)", fontWeight: 800, fontSize: 13, marginBottom: 10 }}>
                Entre l’email admin (ex: <b>ferhoud@hotmail.com</b>) puis clique “Envoyer”.
              </div>

              <label style={{ display: "block", marginBottom: 6, fontWeight: 800 }}>Email</label>
              <input
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="email"
                type="email"
                style={inp}
                autoComplete="email"
              />

              <button
                type="submit"
                disabled={forgotLoading}
                style={{ ...btn, opacity: forgotLoading ? 0.8 : 1, marginTop: 10 }}
              >
                {forgotLoading ? "Envoi..." : "Envoyer le lien"}
              </button>

              {forgotMsg && <div style={{ marginTop: 10, fontWeight: 800 }}>{forgotMsg}</div>}
            </form>
          )}
        </>
      )}
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
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #0ea5e9",
  background: "#0ea5e9",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};
