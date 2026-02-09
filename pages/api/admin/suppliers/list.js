// pages/api/admin/suppliers/list.js
import { createClient } from "@supabase/supabase-js";

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL manquant");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant (requis pour l'admin)");
  return { url, serviceKey };
}

function getAdminEmails() {
  const raw =
    process.env.ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isForcedAdmin() {
  return String(process.env.FORCE_ADMIN || process.env.NEXT_PUBLIC_FORCE_ADMIN || "") === "1";
}

async function requireAdmin(req, supa) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : null;

  if (!token && !isForcedAdmin()) {
    return { ok: false, status: 401, error: "Non connecté (token manquant)" };
  }

  if (isForcedAdmin()) return { ok: true, userEmail: "forced-admin" };

  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Session invalide" };
  }

  const email = (data.user.email || "").toString().trim().toLowerCase();
  const admins = getAdminEmails();
  if (!email || !admins.includes(email)) {
    return { ok: false, status: 403, error: "Accès admin refusé" };
  }

  return { ok: true, userEmail: email };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { url, serviceKey } = getEnv();
    const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

    const gate = await requireAdmin(req, supa);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const { data, error } = await supa
      .from("suppliers")
      .select("key,label,name,phone_whatsapp,email_order,is_active")
      .order("key", { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ ok: true, rows: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
