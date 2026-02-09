// components/BackToBecusButton.jsx
import Link from "next/link";
import { useRouter } from "next/router";

/*
  Bouton "← Retour"
  - Renvoie vers /suppliers/becus
  - Garde le même ?delivery=YYYY-MM-DD si on est en train
    d'éditer une commande pour une date précise.
  - Garde le même style que ton ancien bouton "Accueil"
    (btn clair, arrondi).
*/
export default function BackToBecusButton() {
  const router = useRouter();
  const { delivery } = router.query || {};

  // Si l'URL actuelle contient ?delivery=2025-10-30
  // on le remet dans l'URL de retour pour rester sur la même commande.
  const hrefTarget = delivery
    ? `/suppliers/becus?delivery=${encodeURIComponent(delivery)}`
    : `/suppliers/becus`;

  return (
    <Link
      href={hrefTarget}
      className="btn btn-light btn-sm"
      style={{
        border: "1px solid #d0d5db",
        borderRadius: "8px",
        fontWeight: 500,
        lineHeight: 1.2,
        padding: "6px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "14px" }}>← Retour</span>
    </Link>
  );
}
