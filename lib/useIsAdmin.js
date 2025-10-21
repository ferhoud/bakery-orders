// lib/useIsAdmin.js — v1
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * Retourne true si l'email de l'utilisateur connecté est présent
 * dans la table `admin_emails`.
 */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Récupère la session actuelle
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email?.toLowerCase() || "";
      if (!email) { if (!cancelled) setIsAdmin(false); return; }

      // Vérifie la présence dans admin_emails
      const { data, error } = await supabase
        .from("admin_emails")
        .select("email")
        .eq("email", email)
        .maybeSingle();

      if (!cancelled) setIsAdmin(!!data && !error);
    };

    check();

    // Re-check à chaque changement d'auth
    const { data: sub } = supabase.auth.onAuthStateChange(() => check());

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return isAdmin;
}
