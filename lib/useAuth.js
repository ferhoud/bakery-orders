// lib/useAuth.js — minimal, robuste (pas de dépendance à "profiles")
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const AuthCtx = createContext({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  signInWithOtp: async (_email) => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session ?? null);
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s ?? null);
      });
      unsub = sub?.subscription?.unsubscribe ?? null;
    })();

    return () => { try { unsub && unsub(); } catch {} };
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
    signInWithOtp: async (email) => supabase.auth.signInWithOtp({ email }),
  }), [session, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
