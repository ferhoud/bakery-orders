// pages/admin/suppliers.js
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

/* =========================================================================
   Helpers
   ========================================================================= */
function titleCase(s) {
  if (!s) return "";
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

function displayName(row) {
  return row.label || row.name || titleCase(String(row.key || ""));
}

function normalizePhone(input) {
  // -> renvoie string "+..." ou null si vide
  if (input == null) return null;
  let t = String(input).trim();
  // garder chiffres et '+'
  t = t.replace(/[^\d+]/g, "");
  // convertir 00... -> +...
  if (t.startsWith("00")) t = "+" + t.slice(2);
  // un seul '+' au début max
  t = t.replace(/(?!^)\+/g, "");
  // si juste "+" ou vide -> null
  if (t === "+" || !t.length) return null;
  return t;
}

function normalizeKey(input) {
  if (!input) return "";
  let t = String(input).trim().toLowerCase();
  t = t.replace(/\s+/g, "_");
  t = t.replace(/[^a-z0-9_]/g, "");
  t = t.replace(/^_+|_+$/g, "");
  return t;
}

function getAdminEmails() {
  const raw =
    process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isForcedAdmin() {
  return String(process.env.NEXT_PUBLIC_FORCE_ADMIN || "") === "1";
}

/* =========================================================================
   API helper (server routes admin)
   ========================================================================= */
async function adminFetch(path, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || json?.message || `Erreur ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/* =========================================================================
   Page
   ========================================================================= */
export default function AdminSuppliersPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // suppliers + _ui
  const [savingAll, setSavingAll] = useState(false);
  const [toast, setToast] = useState(null); // { type: "ok"|"err", msg: string }

  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const adminEmails = useMemo(() => getAdminEmails(), []);
  const forced = useMemo(() => isForcedAdmin(), []);

  const enhanceRows = useCallback((data) => {
    return (data || []).map((r) => ({
      ...r,
      _ui: {
        label: { value: r.label ?? r.name ?? "", dirty: false },
        phone: { value: (r.phone_whatsapp ?? "").toString(), dirty: false },
        email: { value: (r.email_order ?? "").toString(), dirty: false },
        active: { value: !!r.is_active, dirty: false },
        saving: false,
        savedTickAt: 0,
        error: null,
      },
    }));
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setToast(null);

    // 1) Essai direct (si SELECT autorisé par RLS)
    try {
      const { data, error } = await supabase
        .from("suppliers")
        .select("key,label,name,phone_whatsapp,email_order,is_active")
        .order("key", { ascending: true });

      if (!error) {
        setRows(enhanceRows(data));
        setLoading(false);
        return;
      }
    } catch (_) {}

    // 2) Fallback API list (si SELECT bloqué)
    try {
      const json = await adminFetch("/api/admin/suppliers/list", {});
      setRows(enhanceRows(json.rows || []));
    } catch (e) {
      setRows([]);
      setToast({ type: "err", msg: `Erreur chargement: ${e.message}` });
    } finally {
      setLoading(false);
    }
  }, [enhanceRows]);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const email = (user?.email || "").toString().trim().toLowerCase();
        setUserEmail(email);

        // règle simple: FORCE_ADMIN ou email présent dans liste
        let ok = forced || (email && adminEmails.includes(email));

        // optionnel: essayer un rôle en base (best effort)
        if (!ok && user?.id) {
          try {
            const { data, error } = await supabase
              .from("profiles")
              .select("role")
              .eq("user_id", user.id)
              .maybeSingle();
            if (!error && data?.role && String(data.role).toLowerCase() === "admin") ok = true;
          } catch (_) {}
        }

        setIsAdmin(!!ok);
      } catch (_) {
        setUserEmail("");
        setIsAdmin(false);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [adminEmails, forced]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  function setRow(index, updater) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = updater(next[index]);
      return next;
    });
  }

  const anyDirty = useMemo(
    () =>
      rows.some(
        (r) =>
          r._ui.label.dirty ||
          r._ui.phone.dirty ||
          r._ui.email.dirty ||
          r._ui.active.dirty
      ),
    [rows]
  );

  async function saveOne(index) {
    if (!isAdmin) {
      setToast({ type: "err", msg: "Accès admin requis pour enregistrer." });
      return;
    }

    setRow(index, (r) => ({ ...r, _ui: { ...r._ui, saving: true, error: null } }));
    const row = rows[index];

    const key = row.key;
    const label = row._ui.label.value?.trim() || null;
    const phone = normalizePhone(row._ui.phone.value);
    const email = row._ui.email.value?.trim() || null;
    const isActive = !!row._ui.active.value;

    try {
      const json = await adminFetch("/api/admin/suppliers/update", {
        key,
        label,
        phone_whatsapp: phone,
        email_order: email,
        is_active: isActive,
      });

      const data = json.row;

      setRow(index, (r) => ({
        ...r,
        label: data.label ?? r.label,
        name: data.name ?? r.name,
        phone_whatsapp: data.phone_whatsapp,
        email_order: data.email_order,
        is_active: data.is_active,
        _ui: {
          ...r._ui,
          label: { value: data.label ?? data.name ?? "", dirty: false },
          phone: { value: (data.phone_whatsapp ?? "").toString(), dirty: false },
          email: { value: (data.email_order ?? "").toString(), dirty: false },
          active: { value: !!data.is_active, dirty: false },
          saving: false,
          savedTickAt: Date.now(),
          error: null,
        },
      }));

      setToast({ type: "ok", msg: `Enregistré ✓ — ${displayName(row)}` });
    } catch (e) {
      setRow(index, (r) => ({
        ...r,
        _ui: { ...r._ui, saving: false, error: e.message || "Erreur" },
      }));
      setToast({ type: "err", msg: `Échec « ${displayName(row)} » : ${e.message}` });
    }
  }

  async function saveAll() {
    if (!isAdmin) {
      setToast({ type: "err", msg: "Accès admin requis pour enregistrer." });
      return;
    }

    const dirtyIndexes = rows
      .map((r, i) => ({ i, r }))
      .filter(({ r }) => r._ui.label.dirty || r._ui.phone.dirty || r._ui.email.dirty || r._ui.active.dirty)
      .map(({ i }) => i);

    if (dirtyIndexes.length === 0) {
      setToast({ type: "ok", msg: "Rien à enregistrer." });
      return;
    }

    setSavingAll(true);
    setToast(null);

    for (const i of dirtyIndexes) {
      // eslint-disable-next-line no-await-in-loop
      await saveOne(i);
    }

    setSavingAll(false);
  }

  async function createSupplier() {
    if (!isAdmin) {
      setToast({ type: "err", msg: "Accès admin requis pour créer un fournisseur." });
      return;
    }

    const key = normalizeKey(newKey);
    if (!key) {
      setToast({ type: "err", msg: "Clé invalide. Exemple: becus, cdp, moulins_bourgeois" });
      return;
    }
    const label = newLabel.trim() || titleCase(key);
    const phone = normalizePhone(newPhone);
    const email = newEmail.trim() || null;

    setCreating(true);
    setToast(null);

    try {
      await adminFetch("/api/admin/suppliers/create", {
        key,
        label,
        phone_whatsapp: phone,
        email_order: email,
        is_active: !!newActive,
      });

      setToast({ type: "ok", msg: `Fournisseur créé ✓ — ${label} (${key})` });
      setCreateOpen(false);
      setNewKey("");
      setNewLabel("");
      setNewPhone("");
      setNewEmail("");
      setNewActive(true);

      await loadRows();
    } catch (e) {
      setToast({ type: "err", msg: `Création impossible: ${e.message}` });
    } finally {
      setCreating(false);
    }
  }

  async function deleteSupplier(key, label) {
    if (!isAdmin) {
      setToast({ type: "err", msg: "Accès admin requis pour supprimer." });
      return;
    }

    const ok = confirm(
      `Supprimer le fournisseur « ${label} » (${key}) ?\n\n` +
        `⚠️ Cela supprimera aussi:\n` +
        `- tous les produits liés (products)\n` +
        `- toutes les commandes liées (orders) et leurs lignes (order_items)\n\n` +
        `Cette action est irréversible.`
    );
    if (!ok) return;

    setToast(null);

    try {
      const json = await adminFetch("/api/admin/suppliers/delete", { key });
      const info = json?.deleted || {};
      setToast({
        type: "ok",
        msg: `Supprimé ✓ — ${label} (${key}) • products:${info.products ?? 0} • orders:${info.orders ?? 0} • items:${info.order_items ?? 0}`,
      });
      await loadRows();
    } catch (e) {
      setToast({ type: "err", msg: `Suppression impossible: ${e.message}` });
    }
  }

  const adminHint = useMemo(() => {
    if (forced) return "FORCE_ADMIN=1 (mode test)";
    if (adminEmails.length) return `Admins: ${adminEmails.join(", ")}`;
    return "Astuce: définis NEXT_PUBLIC_ADMIN_EMAILS (ex: farid@bm.local)";
  }, [forced, adminEmails]);

  return (
    <>
      <Head>
        <title>Admin — Fournisseurs</title>
      </Head>

      <div style={{ maxWidth: 1040, margin: "24px auto", padding: "0 16px 60px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <Link href="/" style={{ textDecoration: "none" }}>← Accueil</Link>
          <h1 style={{ margin: 0, fontSize: 22 }}>Gestion des fournisseurs</h1>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: isAdmin ? "#a7f3d0" : "#fecaca",
                background: isAdmin ? "#ecfdf5" : "#fff1f2",
                color: isAdmin ? "#065f46" : "#9f1239",
              }}
              title={adminHint}
            >
              {authChecked ? (isAdmin ? "✅ Admin" : "⛔ Lecture seule") : "…"}
            </span>

            <span style={{ fontSize: 12, color: "#555" }} title="Compte connecté">
              {userEmail ? `👤 ${userEmail}` : "👤 non connecté"}
            </span>

            <button
              onClick={saveAll}
              disabled={savingAll || !anyDirty || !isAdmin}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                cursor: savingAll || !anyDirty || !isAdmin ? "not-allowed" : "pointer",
                background: isAdmin ? "#fff" : "#f6f6f6",
              }}
              title={
                !isAdmin
                  ? "Accès admin requis"
                  : anyDirty
                    ? "Enregistrer toutes les modifications"
                    : "Aucune modification"
              }
            >
              {savingAll ? "Enregistrement..." : "Enregistrer tout"}
            </button>

            <button
              onClick={() => setCreateOpen((v) => !v)}
              disabled={!isAdmin}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                cursor: !isAdmin ? "not-allowed" : "pointer",
                background: "#fff",
              }}
              title={!isAdmin ? "Accès admin requis" : "Créer un fournisseur"}
            >
              + Nouveau fournisseur
            </button>
          </div>
        </header>

        {!isAdmin && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#9f1239",
              fontWeight: 700,
            }}
          >
            Accès réservé admin. Pour activer l&apos;admin:
            <ul style={{ margin: "8px 0 0 18px" }}>
              <li>
                Se connecter avec un compte dont l&apos;email est dans <code>NEXT_PUBLIC_ADMIN_EMAILS</code>
              </li>
              <li>
                Ou (temporaire) mettre <code>NEXT_PUBLIC_FORCE_ADMIN=1</code> en local / Vercel
              </li>
            </ul>
          </div>
        )}

        {toast && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid",
              borderColor: toast.type === "ok" ? "#c8e6c9" : "#ffcdd2",
              background: toast.type === "ok" ? "#e8f5e9" : "#ffebee",
              fontWeight: 700,
            }}
          >
            {toast.msg}
          </div>
        )}

        {createOpen && (
          <div
            style={{
              marginBottom: 14,
              border: "1px solid #eaeaea",
              borderRadius: 16,
              padding: 16,
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Créer un fournisseur</div>

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#555" }}>Clé (unique, minuscule)</label>
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="ex: becus"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
                <small style={{ color: "#888" }}>
                  Autorisé: a-z, 0-9, underscore. Exemple: moulins_bourgeois
                </small>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#555" }}>Nom affiché</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="ex: Bécus"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#555" }}>WhatsApp</label>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Entrer le numéro WhatsApp"
                  inputMode="tel"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
                <small style={{ color: "#888" }}>Exemple : +33 6 12 34 56 78</small>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "#555" }}>Email commandes (optionnel)</label>
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="commande@fournisseur.com"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={(e) => setNewActive(e.target.checked)}
                />
                Actif
              </label>

              <button
                onClick={createSupplier}
                disabled={creating || !isAdmin}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  cursor: creating || !isAdmin ? "not-allowed" : "pointer",
                  fontWeight: 800,
                }}
              >
                {creating ? "Création..." : "Créer"}
              </button>

              <button
                onClick={() => setCreateOpen(false)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#fff",
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p>Chargement…</p>
        ) : rows.length === 0 ? (
          <p>Aucun fournisseur.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map((row, idx) => {
              const ui = row._ui;
              const canSaveOne = ui.label.dirty || ui.phone.dirty || ui.email.dirty || ui.active.dirty;

              return (
                <div
                  key={row.key}
                  style={{
                    border: "1px solid #eaeaea",
                    borderRadius: 16,
                    padding: 16,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    opacity: !isAdmin ? 0.95 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{displayName(row)}</div>
                    <div style={{ color: "#888" }}>({row.key})</div>

                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={ui.active.value}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            setRow(idx, (r) => ({
                              ...r,
                              _ui: {
                                ...r._ui,
                                active: { value: e.target.checked, dirty: true },
                              },
                            }))
                          }
                        />
                        Actif
                      </label>

                      <button
                        onClick={() => saveOne(idx)}
                        disabled={!isAdmin || ui.saving || !canSaveOne}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          cursor: !isAdmin || ui.saving || !canSaveOne ? "not-allowed" : "pointer",
                          background: "#fff",
                        }}
                        title={!isAdmin ? "Accès admin requis" : "Enregistrer uniquement ce fournisseur"}
                      >
                        {ui.saving ? "Enregistrement…" : "Enregistrer"}
                      </button>

                      <button
                        onClick={() => deleteSupplier(row.key, displayName(row))}
                        disabled={!isAdmin}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #f3b4b4",
                          cursor: !isAdmin ? "not-allowed" : "pointer",
                          background: "#fff5f5",
                          color: "#b91c1c",
                          fontWeight: 800,
                        }}
                        title={!isAdmin ? "Accès admin requis" : "Supprimer ce fournisseur (avec données liées)"}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ fontSize: 13, color: "#555" }}>Nom affiché</label>
                      <input
                        type="text"
                        placeholder="Nom fournisseur"
                        value={ui.label.value ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          setRow(idx, (r) => ({
                            ...r,
                            _ui: { ...r._ui, label: { value: e.target.value, dirty: true } },
                          }))
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: !isAdmin ? "#fafafa" : "#fff",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ fontSize: 13, color: "#555" }}>Numéro WhatsApp</label>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="text"
                          inputMode="tel"
                          placeholder="Entrer le numéro WhatsApp"
                          value={ui.phone.value ?? ""}
                          disabled={!isAdmin}
                          onFocus={(e) => {
                            // sélectionne tout pour remplacer facilement
                            try { e.target.select(); } catch (_) {}
                          }}
                          onChange={(e) =>
                            setRow(idx, (r) => ({
                              ...r,
                              _ui: { ...r._ui, phone: { value: e.target.value, dirty: true } },
                            }))
                          }
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: !isAdmin ? "#fafafa" : "#fff",
                          }}
                        />

                        <button
                          type="button"
                          disabled={!isAdmin || !(ui.phone.value ?? "").length}
                          onClick={() =>
                            setRow(idx, (r) => ({
                              ...r,
                              _ui: { ...r._ui, phone: { value: "", dirty: true } },
                            }))
                          }
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "#fff",
                            fontWeight: 800,
                            cursor: !isAdmin ? "not-allowed" : "pointer",
                            opacity: !isAdmin || !(ui.phone.value ?? "").length ? 0.55 : 1,
                          }}
                          title="Vider le champ"
                        >
                          Effacer
                        </button>
                      </div>

                      <small style={{ color: "#888" }}>Exemple : +33 6 12 34 56 78</small>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ fontSize: 13, color: "#555" }}>Email commandes (optionnel)</label>
                      <input
                        type="email"
                        placeholder="commande@fournisseur.com"
                        value={ui.email.value ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          setRow(idx, (r) => ({
                            ...r,
                            _ui: { ...r._ui, email: { value: e.target.value, dirty: true } },
                          }))
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: !isAdmin ? "#fafafa" : "#fff",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label style={{ fontSize: 13, color: "#555" }}>Actions</label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <a
                          href={
                            ui.phone.value
                              ? `https://wa.me/${(normalizePhone(ui.phone.value) || "").replace("+", "")}?text=Bonjour`
                              : undefined
                          }
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            pointerEvents: ui.phone.value ? "auto" : "none",
                            opacity: ui.phone.value ? 1 : 0.5,
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            textDecoration: "none",
                            fontWeight: 800,
                            background: "#fff",
                          }}
                          title={ui.phone.value ? "Tester ouverture WhatsApp" : "Renseigne d'abord le numéro"}
                        >
                          Tester WhatsApp
                        </a>

                        {row._ui.error && (
                          <span style={{ color: "#b00020", fontWeight: 800 }}>
                            Erreur: {row._ui.error}
                          </span>
                        )}
                        {row._ui.savedTickAt > 0 && (
                          <span style={{ color: "#2e7d32", fontWeight: 800 }}>Enregistré ✓</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 18, color: "#666", fontSize: 13 }}>
          Note: chaque fournisseur a bien sa “fiche” dans la table <code>suppliers</code> (nom, WhatsApp, email, actif).
          On ne crée pas de tables séparées par fournisseur: on relie via <code>supplier_key</code> dans <code>products</code>, <code>orders</code>, <code>order_items</code>.
        </div>
      </div>
    </>
  );
}
