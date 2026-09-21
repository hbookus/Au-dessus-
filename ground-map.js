(()=>{
  "use strict";

  const MAP_ID = "groundMap";
  const PLANE_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 16.2 13.8 13v5.2l2.1 1.5V21L12 20l-3.9 1v-1.3l2.1-1.5V13L3 16.2v-1.8l7.2-5.1V4.8C10.2 3.8 11 3 12 3s1.8.8 1.8 1.8v4.5l7.2 5.1v1.8Z" fill="currentColor"/></svg>';

  let map = null;
  let center = null;
  let centerMode = "geo";
  let centerMarker = null;
  let radiusCircle = null;
  let aircraftLayer = null;
  let markers = new Map();
  let selectedKey = null;

  const $ = (id) => document.getElementById(id);

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }

  function ensureMap() {
    const node = $(MAP_ID);
    if (!node || map) return map;

    if (!window.L) {
      node.innerHTML = '<div class="map-fallback">La carte n’a pas pu se charger. Le radar du ciel reste disponible.</div>';
      return null;
    }

    map = L.map(node, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 18,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    aircraftLayer = L.layerGroup().addTo(map);

    map.on("click", () => {
      window.dispatchEvent(new CustomEvent("au-dessus:selected", { detail: { key: null, source: "map" } }));
    });

    $("mapRecenter")?.addEventListener("click", () => recenter(true));
    return map;
  }

  function centerIcon() {
    return L.divIcon({
      className: "au-map-center",
      html: '<div class="au-map-center-dot"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function planeIcon(aircraft) {
    const hasTrack = Number.isFinite(aircraft.track);
    const html = hasTrack
      ? `<div class="au-map-plane-inner" style="--track:${aircraft.track}deg">${PLANE_SVG}</div>`
      : '<div class="au-map-plane-inner">•</div>';

    return L.divIcon({
      className: `au-map-plane${hasTrack ? "" : " no-track"}`,
      html,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function recenter(animate = false) {
    if (!map || !center) return;
    const circle = L.circle([center.lat, center.lon], { radius: 50000 });
    map.fitBounds(circle.getBounds(), {
      padding: [18, 18],
      maxZoom: 9,
      animate,
      duration: .45,
    });
  }

  function setCenter(detail) {
    center = detail?.center || null;
    centerMode = detail?.mode || "geo";
    const label = detail?.label || (centerMode === "geo" ? "ta position" : "le point choisi");
    if (!center) return;

    ensureMap();
    if (!map) return;

    $("groundLocation").textContent = centerMode === "geo"
      ? "Ta position au sol, avec les mêmes appareils que dans le ciel."
      : `Autour de ${label}.`;

    if (centerMarker) centerMarker.remove();
    centerMarker = L.marker([center.lat, center.lon], {
      icon: centerIcon(),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(map);

    if (radiusCircle) radiusCircle.remove();
    radiusCircle = L.circle([center.lat, center.lon], {
      radius: 50000,
      color: cssVar("--accent", "#4777ff"),
      weight: 1.4,
      opacity: .75,
      fillColor: cssVar("--accent", "#4777ff"),
      fillOpacity: .035,
      interactive: false,
    }).addTo(map);

    requestAnimationFrame(() => {
      map.invalidateSize();
      recenter(false);
    });
  }

  function setSelected(key) {
    selectedKey = key || null;
    markers.forEach((marker, markerKey) => {
      const el = marker.getElement();
      if (!el) return;
      el.classList.toggle("selected", markerKey === selectedKey);
      if (markerKey === selectedKey) marker.setZIndexOffset(1200);
      else marker.setZIndexOffset(0);
    });
  }

  function renderAircraft(list) {
    ensureMap();
    if (!map || !aircraftLayer) return;

    aircraftLayer.clearLayers();
    markers = new Map();

    (Array.isArray(list) ? list : []).forEach((aircraft, index) => {
      if (!Number.isFinite(aircraft.lat) || !Number.isFinite(aircraft.lon)) return;

      const marker = L.marker([aircraft.lat, aircraft.lon], {
        icon: planeIcon(aircraft),
        keyboard: true,
        title: aircraft.callsign || "Aéronef",
        riseOnHover: true,
      }).addTo(aircraftLayer);

      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        window.dispatchEvent(new CustomEvent("au-dessus:open-aircraft", {
          detail: { key: aircraft.key, source: "map" },
        }));
      });

      if (index < 4) {
        marker.bindTooltip(aircraft.callsign || "Aéronef", {
          permanent: true,
          direction: "bottom",
          offset: [0, 15],
          className: "au-map-label",
          opacity: 1,
        });
      }

      markers.set(aircraft.key, marker);
    });

    setSelected(selectedKey);
  }

  window.addEventListener("au-dessus:center", (event) => setCenter(event.detail));
  window.addEventListener("au-dessus:aircraft", (event) => {
    if (event.detail?.center && !center) setCenter(event.detail);
    renderAircraft(event.detail?.aircraft || []);
  });
  window.addEventListener("au-dessus:selected", (event) => setSelected(event.detail?.key || null));

  const observer = new MutationObserver(() => {
    if (map && !document.getElementById("app")?.hidden) {
      requestAnimationFrame(() => map.invalidateSize());
    }
  });
  const app = document.getElementById("app");
  if (app) observer.observe(app, { attributes: true, attributeFilter: ["class", "hidden"] });
})();
