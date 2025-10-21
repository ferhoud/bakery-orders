// scripts/createUsers.mjs
// Crée deux comptes Auth (admin + user) et ajoute l'admin dans admin_emails
// ⚠️ NE PAS exposer la SERVICE_ROLE_KEY côté client !

import { createClient } from "@supabase/supabase-js";

// 🔧 REMPLACE ICI par les valeurs de ton projet (Dashboard > Settings > API)
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";           // ← ton Project URL
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."; // ← ton service_role

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureUser(email, password, makeAdmin = false) {
  // crée l'utilisateur (email confirmé d'office)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { provider: "email" },
    user_metadata: {},
  });

  if (error && !String(error.message || "").toLowerCase().includes("already")) {
    throw error;
  }

  if (makeAdmin) {
    // Ajoute l'email dans admin_emails (pour déverrouiller l’admin UI)
    await admin.from("admin_emails")
      .insert({ email })
      .select()
      .maybeSingle();
  }

  console.log("OK:", email);
}

async function main() {
  await ensureUser("ferhoud@hotmail.com", "Me05112013?", true);   // admin
  await ensureUser("Commande@Bm.local", "78120", false);          // user
  console.log("Terminé ✅");
}
main().catch((e) => {
  console.error("Erreur:", e);
  process.exit(1);
});
