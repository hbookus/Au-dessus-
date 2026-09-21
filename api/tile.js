module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });

  const z = Number(req.query.z);
  const x = Number(req.query.x);
  const y = Number(req.query.y);

  if (
    !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
    z < 0 || z > 19 || x < 0 || y < 0
  ) {
    return res.status(400).json({ error: "Tuile invalide" });
  }

  const max = 2 ** z;
  if (x >= max || y >= max) return res.status(400).json({ error: "Tuile hors limites" });

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

  try {
    const upstream = await fetch(url, {
      headers: {
        accept: "image/png,image/*;q=0.8",
        "user-agent": "Au-dessus/3.3 (https://au-dessus.vercel.app)",
        referer: "https://au-dessus.vercel.app/",
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).end();
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    res.setHeader("X-Tile-Source", "OpenStreetMap");
    return res.status(200).send(bytes);
  } catch (error) {
    return res.status(502).json({ error: "Fond de carte temporairement indisponible" });
  }
};
