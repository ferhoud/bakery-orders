// pages/_app.js
import "../styles/orders.css";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

function FullPageLoader({ label = "Chargement..." }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #f3f6ff 0%, #ffffff 30%, #ffffff 100%)",
        color: "#0f172a",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
      <div
        style={{
          padding: 18,
          borderRadius: 16,
          border: "1px solid rgba(15,23,42,0.10)",
          background: "#fff",
          boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
          fontWeight: 800,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState(null);

  const requiresAuth = useMemo(() => {
    const p = router.pathname || "";
    if (p === "/login") return false;
    if (p.startsWith("/suppliers")) return true;
    if (p.startsWith("/admin")) return true;
    return false;
  }, [router.pathname]);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        setSession(data?.session || null);
      } finally {
        if (!alive) return;
        setChecking(false);
      }
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!requiresAuth) return;
    if (checking) return;

    if (!session) {
      const next = router.asPath || "/";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [requiresAuth, checking, session, router]);

  if (requiresAuth && (checking || (!checking && !session))) {
    return <FullPageLoader label="Identification requise…" />;
  }

  return <Component {...pageProps} />;
}
