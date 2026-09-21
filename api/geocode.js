module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });

  const q = String(req.query.q || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Recherche trop courte" });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "fr");

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Au-dessus/3.2 (https://www.hocusbookus.com)",
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Géocodage indisponible (HTTP ${response.status})` });
    }

    const data = await response.json();
    const results = Array.isArray(data)
      ? data.map((item) => ({
          name: item.display_name,
          lat: Number(item.lat),
          lon: Number(item.lon),
          type: item.type || item.category || "",
        })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon))
      : [];

    // End-user initiated searches only. CDN caching also reduces repeated requests.
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      ok: true,
      results,
      attribution: "© OpenStreetMap contributors",
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.name === "TimeoutError" ? "Le géocodage a pris trop de temps" : "Géocodage indisponible",
    });
  }
};
