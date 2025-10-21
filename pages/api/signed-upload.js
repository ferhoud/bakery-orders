// pages/api/signed-upload.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // ⚠️ serveur uniquement
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ error: "Missing path" });

    // Génère une URL de téléversement signée pour ce fichier
    const { data, error } = await supabaseAdmin
      .storage.from("product-icons")
      .createSignedUploadUrl(path);

    if (error) return res.status(500).json({ error: error.message });
    // data: { signedUrl, token, path }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "server error" });
  }
}
