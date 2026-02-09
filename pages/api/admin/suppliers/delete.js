// pages/api/admin/suppliers/delete.js
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

async function safeDeleteOrdersAndItems(supa, supplierKey) {
  const orderIds = new Set();

  // variants for supplier column
  const variants = ["supplier_key", "supplier"];
  for (const col of variants) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supa
        .from("orders")
        .select("id")
        .eq(col, supplierKey)
        .limit(5000);
      if (!error) {
        for (const r of data || []) if (r?.id) orderIds.add(r.id);
      }
    } catch (_) {}
  }

  const ids = Array.from(orderIds);
  let deletedItems = 0;
  let deletedOrders = 0;

  if (ids.length) {
    // order_items
    try {
      const { data, error } = await supa
        .from("order_items")
        .delete()
        .in("order_id", ids)
        .select("id");
      if (!error) deletedItems = (data || []).length;
    } catch (_) {}

    // orders
    for (const col of variants) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data, error } = await supa
          .from("orders")
          .delete()
          .eq(col, supplierKey)
          .select("id");
        if (!error) deletedOrders += (data || []).length;
      } catch (_) {}
    }
  } else {
    // still delete orders even if we couldn't list ids (best effort)
    for (const col of variants) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data, error } = await supa
          .from("orders")
          .delete()
          .eq(col, supplierKey)
          .select("id");
        if (!error) deletedOrders += (data || []).length;
      } catch (_) {}
    }
  }

  return { deletedOrders, deletedItems };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { url, serviceKey } = getEnv();
    const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

    const gate = await requireAdmin(req, supa);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const key = (req.body?.key || "").toString().trim();
    if (!key) return res.status(400).json({ error: "Clé manquante" });

    // 1) orders + items
    const { deletedOrders, deletedItems } = await safeDeleteOrdersAndItems(supa, key);

    // 2) products
    let deletedProducts = 0;
    try {
      const { data, error } = await supa
        .from("products")
        .delete()
        .eq("supplier_key", key)
        .select("id");
      if (!error) deletedProducts = (data || []).length;
    } catch (_) {}

    // 3) supplier_contacts (optionnel)
    try {
      await supa.from("supplier_contacts").delete().eq("supplier_key", key);
      await supa.from("supplier_contacts").delete().eq("key", key);
    } catch (_) {}

    // 4) suppliers
    let deletedSuppliers = 0;
    try {
      const { data, error } = await supa
        .from("suppliers")
        .delete()
        .eq("key", key)
        .select("key");
      if (!error) deletedSuppliers = (data || []).length;
    } catch (_) {}

    return res.status(200).json({
      ok: true,
      deleted: {
        suppliers: deletedSuppliers,
        products: deletedProducts,
        orders: deletedOrders,
        order_items: deletedItems,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
