(()=>{
  "use strict";

  const RADIUS_NM = 27;
  const RADIUS_KM = 50;
  const REFRESH_MS = 20000;
  const DIRECT_SOURCES = [
    { name: "airplanes.live", url: (lat, lon, radius) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}` },
    { name: "adsb.lol", url: (lat, lon, radius) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}` },
    { name: "adsb.fi", url: (lat, lon, radius) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${radius}` },
  ];

  const $ = (id) => document.getElementById(id);
  const API_BASE = location.hostname.endsWith("github.io") ? "https://au-dessus.vercel.app/api" : "/api";
  const RELAY = `${API_BASE}/nearby`;
  const GEOCODE = `${API_BASE}/geocode`;
  const PLANE_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 16.2 13.8 13v5.2l2.1 1.5V21L12 20l-3.9 1v-1.3l2.1-1.5V13L3 16.2v-1.8l7.2-5.1V4.8C10.2 3.8 11 3 12 3s1.8.8 1.8 1.8v4.5l7.2 5.1v1.8Z" fill="currentColor"/></svg>';

  let center = null;
  let centerMode = "geo";
  let centerLabel = "ma position";
  let timer = null;
  let busy = false;
  let last = [];
  let source = null;
  let selectedKey = null;

  function setTheme() {
    const hour = new Date().getHours();
    document.body.dataset.theme = hour < 6 || hour >= 21 ? "night" : hour < 8 ? "dawn" : hour >= 18 ? "sunset" : "day";
  }
  setTheme();

  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));
  const fmt = (value) => value == null ? "—" : value.toLocaleString("fr-FR");
  const cardinal = (bearing) => ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
  const feetToMeters = (value) => {
    const n = num(value);
    return n == null ? null : Math.round(n * 0.3048);
  };
  const knotsToKmh = (value) => {
    const n = num(value);
    return n == null ? null : Math.round(n * 1.852);
  };
  const fpmToMpm = (value) => {
    const n = num(value);
    return n == null ? null : Math.round(n * 0.3048);
  };

  function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function fetchWithTimeout(url, timeoutMs = 8500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(timeout));
  }

  async function getAircraft() {
    const errors = [];
    const lat = Math.round(center.lat * 1000) / 1000;
    const lon = Math.round(center.lon * 1000) / 1000;
    const query = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(RADIUS_NM) });

    try {
      const response = await fetchWithTimeout(`${RELAY}?${query}`, 9000);
      if (response.ok) {
        const json = await response.json();
        if (json?.ok && Array.isArray(json.aircraft)) {
          source = `relay · ${json.source || "ADS-B"}`;
          return { raw: json.aircraft, errors };
        }
      } else if (response.status !== 404) {
        errors.push(`relay: HTTP ${response.status}`);
      }
    } catch (error) {
      errors.push(`relay: ${error.name === "AbortError" ? "délai dépassé" : error.message}`);
    }

    for (const candidate of DIRECT_SOURCES) {
      try {
        const response = await fetchWithTimeout(candidate.url(center.lat, center.lon, RADIUS_NM));
        if (!response.ok) {
          errors.push(`${candidate.name}: HTTP ${response.status}`);
          continue;
        }
        const json = await response.json();
        const raw = Array.isArray(json?.ac) ? json.ac : Array.isArray(json?.aircraft) ? json.aircraft : Array.isArray(json) ? json : [];
        source = `${candidate.name} · direct`;
        return { raw, errors };
      } catch (error) {
        errors.push(`${candidate.name}: ${error.name === "AbortError" ? "délai dépassé" : error.message}`);
      }
    }

    return { raw: null, errors };
  }

  function normalize(raw) {
    return raw.map((item) => {
      const lat = num(item.lat);
      const lon = num(item.lon);
      if (lat == null || lon == null) return null;

      const altBaroFeet = item.alt_baro === "ground" ? 0 : num(item.alt_baro);
      const altGeomFeet = num(item.alt_geom);
      const track = num(item.track);
      const trueHeading = num(item.true_heading);
      const magHeading = num(item.mag_heading);
      const verticalFpm = num(item.baro_rate ?? item.geom_rate);
      const callsign = String(item.flight || "").trim() || String(item.r || "").trim() || String(item.hex || "").toUpperCase() || "INCONNU";
      const hex = String(item.hex || "").trim().toLowerCase();
      const reg = String(item.r || "").trim();
      const type = String(item.t || "").trim();
      const desc = String(item.desc || "").trim();
      const point = { lat, lon };

      return {
        key: hex || `${callsign}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
        hex,
        callsign,
        reg,
        type,
        desc,
        category: String(item.category || "").trim(),
        positionType: String(item.type || "").trim(),
        emergency: String(item.emergency || "").trim(),
        squawk: String(item.squawk || "").trim(),
        altBaro: feetToMeters(altBaroFeet),
        altGeom: feetToMeters(altGeomFeet),
        altitude: altBaroFeet === 0 ? 0 : feetToMeters(altBaroFeet) ?? feetToMeters(altGeomFeet),
        speed: knotsToKmh(item.gs),
        ias: knotsToKmh(item.ias),
        tas: knotsToKmh(item.tas),
        mach: num(item.mach),
        track,
        trueHeading,
        magHeading,
        vertical: fpmToMpm(verticalFpm),
        qnh: num(item.nav_qnh),
        navAltitude: feetToMeters(item.nav_altitude_mcp ?? item.nav_altitude_fms),
        seen: num(item.seen),
        lat,
        lon,
        dist: distanceKm(center, point),
        brg: bearingDeg(center, point),
      };
    }).filter(Boolean).filter((aircraft) => aircraft.dist <= RADIUS_KM + 2).sort((a, b) => a.dist - b.dist);
  }

  function identityLabel(aircraft) {
    const parts = [];
    if (aircraft.desc) parts.push(aircraft.desc);
    else if (aircraft.type) parts.push(aircraft.type);
    if (aircraft.reg && aircraft.reg !== aircraft.callsign) parts.push(aircraft.reg);
    return parts.join(" · ") || "Aéronef détecté";
  }

  function routeLabel(aircraft) {
    return aircraft.track == null ? "route inconnue" : `${Math.round(aircraft.track)}° ${cardinal(aircraft.track)}`;
  }

  function notice(message, show = true) {
    $("notice").textContent = message;
    $("notice").classList.toggle("show", show);
  }

  function markerGraphic(aircraft) {
    if (aircraft.track == null) return '<span class="unknown-track" aria-hidden="true">•</span>';
    return `<span class="plane-glyph" style="--track:${aircraft.track}deg">${PLANE_SVG}</span>`;
  }

  function renderSky(list) {
    const holder = $("planes");
    holder.innerHTML = "";
    $("quiet").hidden = list.length !== 0;

    list.slice(0, 18).forEach((aircraft, index) => {
      const radius = Math.min(aircraft.dist / RADIUS_KM, 1) * 42;
      const angle = (aircraft.brg - 90) * Math.PI / 180;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `plane${index === 0 ? " closest" : ""}${aircraft.track == null ? " no-track" : ""}`;
      button.style.left = `${50 + radius * Math.cos(angle)}%`;
      button.style.top = `${50 + radius * Math.sin(angle)}%`;
      button.dataset.key = aircraft.key;
      button.setAttribute("aria-label", `${aircraft.callsign}, ${aircraft.dist.toFixed(1)} km, ${routeLabel(aircraft)}`);
      button.innerHTML = markerGraphic(aircraft) + (index < 6 ? `<span class="plane-label">${esc(aircraft.callsign)}</span>` : "");
      button.addEventListener("click", () => openDetails(aircraft.key));
      holder.appendChild(button);
    });
  }

  function renderClosest(aircraft) {
    if (!aircraft) {
      $("flightTitle").textContent = "Ciel libre";
      $("flightSub").textContent = "Rien de détecté dans les 50 km pour le moment.";
      $("distance").textContent = $("altitude").textContent = $("speed").textContent = $("heading").textContent = "—";
      $("direction").textContent = "km";
      return;
    }

    $("flightTitle").textContent = aircraft.callsign;
    $("flightSub").textContent = identityLabel(aircraft) + (aircraft.vertical == null || Math.abs(aircraft.vertical) < 1 ? "" : aircraft.vertical > 0 ? " · en montée" : " · en descente");
    $("distance").textContent = aircraft.dist.toFixed(1);
    $("direction").textContent = `km · vers ${cardinal(aircraft.brg)}`;
    $("altitude").textContent = aircraft.altitude === 0 ? "au sol" : aircraft.altitude == null ? "—" : `${fmt(aircraft.altitude)} m`;
    $("speed").textContent = aircraft.speed == null ? "—" : `${fmt(aircraft.speed)} km/h`;
    $("heading").textContent = aircraft.track == null ? "—" : `${Math.round(aircraft.track)}° ${cardinal(aircraft.track)}`;
  }

  function renderMood(list) {
    const count = list.length;
    let title = "Ciel paisible.";
    let text = "Aucun trafic n’est visible dans le rayon pour l’instant. Une bonne excuse pour lever les yeux quand même.";

    if (count === 1) {
      title = "Un seul visiteur.";
      text = "Un appareil traverse ton morceau de ciel. Il a toute la scène pour lui.";
    } else if (count <= 5 && count > 1) {
      title = "Quelques trajectoires.";
      text = `${count} appareils sont visibles autour du point observé. Juste assez pour suivre leurs chemins sans perdre le nord.`;
    } else if (count <= 12 && count > 5) {
      title = "Le ciel est vivant.";
      text = `${count} appareils dans les 50 km : le paysage là-haut est beaucoup moins vide qu’il n’en a l’air.`;
    } else if (count > 12) {
      title = "Ça circule là-haut.";
      text = `${count} appareils détectés. Ce coin de ciel ressemble aujourd’hui à un joli carrefour invisible.`;
    }

    $("skyMood").textContent = title;
    $("skyMessage").textContent = text;
  }

  function renderList(list) {
    $("listCount").textContent = `${list.length} appareil${list.length > 1 ? "s" : ""}`;
    const holder = $("trafficList");
    holder.innerHTML = "";

    list.slice(1, 9).forEach((aircraft) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "glass traffic-item";
      button.dataset.key = aircraft.key;
      button.innerHTML = `
        <span class="plane-mini">${markerGraphic(aircraft)}</span>
        <span class="traffic-id"><b>${esc(aircraft.callsign)}</b><span>${esc(identityLabel(aircraft))}</span></span>
        <span class="traffic-numbers"><b>${aircraft.dist.toFixed(1)} km · ${cardinal(aircraft.brg)}</b><span>${aircraft.altitude === 0 ? "au sol" : aircraft.altitude == null ? "alt. —" : `${fmt(aircraft.altitude)} m`}${aircraft.speed == null ? "" : ` · ${fmt(aircraft.speed)} km/h`}</span></span>`;
      button.setAttribute("aria-label", `Ouvrir la fiche de ${aircraft.callsign}`);
      button.addEventListener("click", () => openDetails(aircraft.key));
      holder.appendChild(button);
    });
  }

  function detailCell(label, value) {
    return `<div class="detail-cell"><span>${esc(label)}</span><strong>${esc(value ?? "—")}</strong></div>`;
  }

  function renderDetails(aircraft) {
    if (!aircraft) return;

    $("detailCallsign").textContent = aircraft.callsign;
    $("detailIdentity").textContent = identityLabel(aircraft);
    $("detailDistance").textContent = `${aircraft.dist.toFixed(1)} km`;
    $("detailRelative").textContent = `${cardinal(aircraft.brg)} du point observé`;
    $("detailPlane").textContent = aircraft.track == null ? "•" : "✈";
    $("detailPlane").style.transform = aircraft.track == null ? "none" : `rotate(${aircraft.track}deg)`;

    const verticalText = aircraft.vertical == null ? "—" : `${aircraft.vertical > 0 ? "+" : ""}${fmt(aircraft.vertical)} m/min`;
    const cells = [
      ["Route sol", aircraft.track == null ? "—" : `${Math.round(aircraft.track)}° ${cardinal(aircraft.track)}`],
      ["Cap vrai", aircraft.trueHeading == null ? "—" : `${Math.round(aircraft.trueHeading)}° ${cardinal(aircraft.trueHeading)}`],
      ["Cap magnétique", aircraft.magHeading == null ? "—" : `${Math.round(aircraft.magHeading)}° ${cardinal(aircraft.magHeading)}`],
      ["Altitude baro", aircraft.altBaro === 0 ? "au sol" : aircraft.altBaro == null ? "—" : `${fmt(aircraft.altBaro)} m`],
      ["Altitude géom.", aircraft.altGeom == null ? "—" : `${fmt(aircraft.altGeom)} m`],
      ["Vitesse sol", aircraft.speed == null ? "—" : `${fmt(aircraft.speed)} km/h`],
      ["Vitesse indiquée", aircraft.ias == null ? "—" : `${fmt(aircraft.ias)} km/h`],
      ["Vitesse vraie", aircraft.tas == null ? "—" : `${fmt(aircraft.tas)} km/h`],
      ["Mach", aircraft.mach == null ? "—" : aircraft.mach.toFixed(3)],
      ["Vitesse verticale", verticalText],
      ["Squawk", aircraft.squawk || "—"],
      ["QNH nav", aircraft.qnh == null ? "—" : `${aircraft.qnh.toFixed(1)} hPa`],
      ["Altitude cible", aircraft.navAltitude == null ? "—" : `${fmt(aircraft.navAltitude)} m`],
      ["ICAO hex", aircraft.hex ? aircraft.hex.toUpperCase() : "—"],
      ["Position", aircraft.positionType || "—"],
      ["Dernier signal", aircraft.seen == null ? "—" : `${aircraft.seen.toFixed(1)} s`],
    ];

    $("detailGrid").innerHTML = cells.map(([label, value]) => detailCell(label, value)).join("");
    $("detailNote").textContent = "La route sol indique la direction réelle du déplacement au-dessus du sol. Le cap indique où pointe le nez de l’appareil : avec le vent, les deux peuvent différer.";

    const link = $("detailSourceLink");
    if (aircraft.hex) {
      link.hidden = false;
      link.href = `https://adsb.lol/?icao=${encodeURIComponent(aircraft.hex)}`;
    } else {
      link.hidden = true;
    }
  }

  function openDetails(key) {
    const aircraft = last.find((item) => item.key === key);
    if (!aircraft) return;
    selectedKey = key;
    renderDetails(aircraft);
    window.dispatchEvent(new CustomEvent("au-dessus:selected", { detail: { key, source: "app" } }));
    const dialog = $("aircraftDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDetails() {
    selectedKey = null;
    window.dispatchEvent(new CustomEvent("au-dessus:selected", { detail: { key: null, source: "app" } }));
    const dialog = $("aircraftDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function render(list) {
    last = list;
    $("contactCount").textContent = `${list.length} contact${list.length > 1 ? "s" : ""} détecté${list.length > 1 ? "s" : ""}`;
    $("liveText").textContent = list.length ? `${list.length} dans le ciel` : "ciel calme";
    renderSky(list);
    renderClosest(list[0]);
    renderMood(list);
    renderList(list);
    window.dispatchEvent(new CustomEvent("au-dessus:aircraft", {
      detail: { aircraft: list, center, mode: centerMode, label: centerLabel }
    }));

    if (selectedKey) {
      const selected = list.find((item) => item.key === selectedKey);
      if (selected) renderDetails(selected);
      else closeDetails();
    }
  }

  async function tick() {
    if (!center || busy) return;
    busy = true;
    $("liveText").textContent = "mise à jour…";
    $("refresh").disabled = true;

    try {
      const { raw, errors } = await getAircraft();
      if (raw === null) {
        notice("Impossible de joindre les sources aériennes pour le moment. Le ciel est toujours là ; les données, elles, font une petite pause.");
        $("liveText").textContent = "sources indisponibles";
        return;
      }

      const list = normalize(raw);
      render(list);
      $("source").textContent = source || "—";
      $("updated").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      errors.length ? notice(`Source de secours utilisée : ${errors.join(" · ")}`) : notice("", false);
    } catch (error) {
      notice(`Petit trou d’air technique : ${error.message}`);
      $("liveText").textContent = "erreur de données";
    } finally {
      busy = false;
      $("refresh").disabled = false;
    }
  }

  function setCenter(lat, lon, label, mode) {
    center = { lat, lon };
    centerMode = mode;
    centerLabel = label || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    $("pos").textContent = `${lat.toFixed(3)} / ${lon.toFixed(3)}`;
    $("meLabel").textContent = mode === "geo" ? "toi" : "point";
    document.querySelector(".sky-label strong").textContent = mode === "geo" ? "Ton ciel maintenant" : "Le ciel choisi";
    $("startCard").hidden = true;
    $("app").classList.add("active");
    window.dispatchEvent(new CustomEvent("au-dessus:center", {
      detail: { center: { ...center }, mode: centerMode, label: centerLabel }
    }));
    tick();
    clearInterval(timer);
    timer = setInterval(tick, REFRESH_MS);
  }

  function locate({ scroll = true } = {}) {
    if (!navigator.geolocation) {
      $("app").classList.add("active");
      notice("Ton navigateur ne propose pas la géolocalisation. Tu peux quand même explorer un autre lieu.");
      return;
    }

    $("go").disabled = true;
    $("useMyLocation").disabled = true;
    navigator.geolocation.getCurrentPosition((position) => {
      $("go").disabled = false;
      $("useMyLocation").disabled = false;
      setCenter(position.coords.latitude, position.coords.longitude, "ma position", "geo");
      if (scroll) setTimeout(() => $("app").scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }, (error) => {
      $("go").disabled = false;
      $("useMyLocation").disabled = false;
      $("app").classList.add("active");
      $("liveText").textContent = "position nécessaire";
      notice(({ 1: "La localisation a été refusée. Autorise-la pour ce site ou explore un lieu manuellement.", 2: "Ta position n’a pas pu être déterminée. Tu peux saisir un lieu à la place.", 3: "La localisation a pris trop de temps. Tu peux saisir un lieu à la place." })[error.code] || `Géolocalisation indisponible : ${error.message}`);
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30000 });
  }

  function toggleExplorer(force) {
    const panel = $("placePanel");
    const shouldOpen = typeof force === "boolean" ? force : panel.hidden;
    panel.hidden = !shouldOpen;
    $("exploreToggle").setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) setTimeout(() => $("placeInput").focus(), 50);
  }

  function parseCoordinates(query) {
    const match = query.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function usePlace(lat, lon, label) {
    setCenter(lat, lon, label, "manual");
    toggleExplorer(false);
    setTimeout(() => $("app").scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  async function searchPlace(query) {
    const results = $("placeResults");
    const direct = parseCoordinates(query);
    if (direct) {
      $("geoAttrib").hidden = true;
      results.innerHTML = `<button type="button" class="place-result" data-lat="${direct.lat}" data-lon="${direct.lon}" data-name="${esc(query)}"><strong>${direct.lat.toFixed(4)}, ${direct.lon.toFixed(4)}</strong><span>Coordonnées saisies directement</span></button>`;
      bindPlaceResults();
      return;
    }

    results.innerHTML = '<div class="place-loading">Recherche du ciel…</div>';
    $("geoAttrib").hidden = true;

    try {
      const response = await fetchWithTimeout(`${GEOCODE}?${new URLSearchParams({ q: query })}`, 8000);
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Recherche indisponible");

      const places = Array.isArray(json.results) ? json.results : [];
      if (!places.length) {
        results.innerHTML = '<div class="place-loading">Aucun lieu trouvé. Essaie une ville, une adresse ou des coordonnées.</div>';
        return;
      }

      results.innerHTML = places.map((place) => `<button type="button" class="place-result" data-lat="${place.lat}" data-lon="${place.lon}" data-name="${esc(place.name)}"><strong>${esc(place.name.split(",")[0])}</strong><span>${esc(place.name)}</span></button>`).join("");
      $("geoAttrib").hidden = false;
      bindPlaceResults();
    } catch (error) {
      results.innerHTML = `<div class="place-loading">${esc(error.message || "Recherche de lieu indisponible")}</div>`;
    }
  }

  function bindPlaceResults() {
    document.querySelectorAll(".place-result").forEach((button) => {
      button.addEventListener("click", () => {
        const lat = Number(button.dataset.lat);
        const lon = Number(button.dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) usePlace(lat, lon, button.dataset.name || "lieu choisi");
      });
    });
  }

  $("go").addEventListener("click", () => locate());
  $("useMyLocation").addEventListener("click", () => locate());
  $("refresh").addEventListener("click", tick);
  $("exploreToggle").addEventListener("click", () => toggleExplorer());
  $("changeSky").addEventListener("click", () => {
    toggleExplorer(true);
    $("exploreToggle").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("placeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("placeInput").value.trim();
    if (query.length < 2) {
      $("placeResults").innerHTML = '<div class="place-loading">Écris au moins deux caractères, ou des coordonnées.</div>';
      return;
    }
    searchPlace(query);
  });
  window.addEventListener("au-dessus:open-aircraft", (event) => {
    const key = event.detail?.key;
    if (key) openDetails(key);
  });
  $("dialogClose").addEventListener("click", closeDetails);
  $("aircraftDialog").addEventListener("click", (event) => {
    if (event.target === $("aircraftDialog")) closeDetails();
  });
  $("share").addEventListener("click", async () => {
    const nearest = last[0];
    const where = centerMode === "geo" ? "au-dessus de moi" : `autour de ${centerLabel}`;
    const text = nearest ? `Je regarde le ciel ${where} : ${nearest.callsign} passe à ${nearest.dist.toFixed(1)} km. ✈` : `Je regarde le ciel ${where} avec Au-dessus. ✈`;
    try {
      if (navigator.share) await navigator.share({ title: "Au-dessus", text, url: location.href });
      else await navigator.clipboard.writeText(`${text} ${location.href}`);
    } catch (_) {}
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && center) tick();
  });
})();
