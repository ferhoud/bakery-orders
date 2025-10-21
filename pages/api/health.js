export default async function handler(req, res) {
  // Petit timeout applicatif pour montrer qu'on répond toujours
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), 8000);
  try {
    // Ici tu peux ping Supabase vite fait si tu veux
    // await fetch("https://httpbin.org/get", { signal: controller.signal });
    res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    res.status(504).json({ ok: false, error: e?.name || String(e) });
  } finally {
    clearTimeout(t);
  }
}
