// pages/login.js — connexion email + mot de passe
import { useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

export default function LoginPage() {
  const { session, user, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const onLogin = async (e) => {
    e.preventDefault();
    setMsg(""); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    setMsg(error ? ("Erreur: " + error.message) : "Connecté ✅");
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/" style={{ textDecoration: "underline" }}>← Accueil</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Connexion</h1>

      {session ? (
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <p>Connecté en tant que <b>{user?.email}</b></p>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/products" style={{ textDecoration: "underline" }}>Aller aux produits</Link>
            <button onClick={signOut} style={btn}>Se déconnecter</button>
          </div>
        </div>
      ) : (
        <form onSubmit={onLogin} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <label style={{ display: "block", marginBottom: 6 }}>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            type="email"
            style={inp}
          />
          <label style={{ display: "block", margin: "8px 0 6px" }}>Mot de passe</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="mot de passe"
            type="password"
            style={inp}
          />
          <button type="submit" disabled={loading} style={btn}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>
          {msg && <div style={{ marginTop: 10 }}>{msg}</div>}
        </form>
      )}
    </div>
  );
}
const inp = { width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8 };
const btn = { padding: "10px 12px", borderRadius: 10, border: "1px solid #0ea5e9", background: "#0ea5e9", color: "#fff", cursor: "pointer", fontWeight: 700 };
