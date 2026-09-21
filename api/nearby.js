const SOURCES = [
  {
    name: "adsb.lol",
    url: (lat, lon, radius) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`,
  },
  {
    name: "adsb.fi",
    url: (lat, lon, radius) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radius}`,
  },
  {
    name: "airplanes.live",
    url: (lat, lon, radius) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}`,
  },
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Au-dessus/3.1 (Hocusbookus)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const lat = toNumber(req.query.lat);
  const lon = toNumber(req.query.lon);
  const radiusRaw = toNumber(req.query.radius);
  const radius = Math.max(1, Math.min(radiusRaw ?? 27, 100));

  if (
    lat === null ||
    lon === null ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({ error: "Coordonnées invalides" });
  }

  // Environ 110 m de précision à l'équateur : suffisant pour ce projet
  // et plus respectueux de la vie privée qu'une coordonnée GPS brute.
  const safeLat = Math.round(lat * 1000) / 1000;
  const safeLon = Math.round(lon * 1000) / 1000;

  const attempts = [];

  for (const source of SOURCES) {
    try {
      const data = await fetchJson(source.url(safeLat, safeLon, radius));
      const aircraft = Array.isArray(data?.ac)
        ? data.ac
        : Array.isArray(data?.aircraft)
          ? data.aircraft
          : Array.isArray(data)
            ? data
            : [];

      return res.status(200).json({
        ok: true,
        source: source.name,
        aircraft,
        generatedAt: new Date().toISOString(),
        locationPrecision: "0.001°",
      });
    } catch (error) {
      attempts.push({
        source: source.name,
        error: error?.name === "AbortError" ? "timeout" : String(error?.message || error),
      });
    }
  }

  return res.status(502).json({
    ok: false,
    error: "Aucune source ADS-B disponible",
    attempts,
  });
};
