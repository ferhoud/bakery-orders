// pages/api/admin/suppliers/create.js
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

function normalizePhone(input) {
  if (!input) return null;
  let t = String(input).trim();
  t = t.replace(/[^\d+]/g, "");
  if (t.startsWith("00")) t = "+" + t.slice(2);
  t = t.replace(/(?!^)\+/g, "");
  return t.length ? t : null;
}

function normalizeKey(input) {
  if (!input) return "";
  let t = String(input).trim().toLowerCase();
  t = t.replace(/\s+/g, "_");
  t = t.replace(/[^a-z0-9_]/g, "");
  t = t.replace(/^_+|_+$/g, "");
  return t;
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

    const key = normalizeKey(req.body?.key);
    const label = (req.body?.label || "").toString().trim();
    const phone = normalizePhone(req.body?.phone_whatsapp);
    const email = (req.body?.email_order || "").toString().trim() || null;
    const isActive = !!req.body?.is_active;

    if (!key) return res.status(400).json({ error: "Clé fournisseur invalide" });
    if (!label) return res.status(400).json({ error: "Nom affiché requis" });

    const { data, error } = await supa
      .from("suppliers")
      .insert({
        key,
        label,
        phone_whatsapp: phone,
        email_order: email,
        is_active: isActive,
      })
      .select("key,label,name,phone_whatsapp,email_order,is_active")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Best effort: supplier_contacts (si la table existe)
    try {
      const payloads = [
        { supplier_key: key, whatsapp_phone: phone, email_order: email, name: label },
        { key, phone_whatsapp: phone, email_order: email, label },
        { supplier_key: key, whatsapp: phone, email_order: email, name: label },
      ];
      for (const p of payloads) {
        // eslint-disable-next-line no-await-in-loop
        await supa.from("supplier_contacts").upsert(p).select("*").limit(1);
      }
    } catch (_) {}

    return res.status(200).json({ ok: true, row: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
