// pages/suppliers/moulins/index.js
import Link from "next/link";

export default function MoulinsHome() {
  return (
    <div style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <h1 style={{ margin: 0 }}>Moulins Bourgeois</h1>
      <p style={{ color: "#555", fontWeight: 700 }}>
        Page en maintenance (déploiement en cours).
      </p>
      <Link href="/" style={{ textDecoration: "underline", fontWeight: 800 }}>
        ← Retour Accueil
      </Link>
    </div>
  );
}
