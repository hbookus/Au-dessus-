(()=>{
  "use strict";

  const MAP_ID = "groundMap";
  const TILE_URL = location.hostname.endsWith("github.io")
    ? "https://au-dessus.vercel.app/api/tile?z={z}&x={x}&y={y}"
    : "/api/tile?z={z}&x={x}&y={y}";
  const PLANE_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 16.2 13.8 13v5.2l2.1 1.5V21L12 20l-3.9 1v-1.3l2.1-1.5V13L3 16.2v-1.8l7.2-5.1V4.8C10.2 3.8 11 3 12 3s1.8.8 1.8 1.8v4.5l7.2 5.1v1.8Z" fill="currentColor"/></svg>';

  let map = null;
  let center = null;
  let centerMode = "geo";
  let centerLabel = "point observé";
  let centerMarker = null;
  let aircraftMarkers = new Map();
  let selectedKey = null;
  let latestAircraft = [];

  const $ = (id) => document.getElementById(id);

  function makeStyle() {
    return {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: [TILE_URL],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors"
        }
      },
      layers: [
        {
          id: "osm",
          type: "raster",
          source: "osm",
          paint: {
            "raster-opacity": document.body.dataset.theme === "night" ? 0.82 : 0.96,
            "raster-saturation": document.body.dataset.theme === "night" ? -0.18 : 0
          }
        }
      ]
    };
  }

  function boundsAround(lat, lon, radiusKm = 50) {
    const latDelta = radiusKm / 111.32;
    const cos = Math.max(Math.cos(lat * Math.PI / 180), 0.2);
    const lonDelta = radiusKm / (111.32 * cos);
    return [
      [lon - lonDelta, lat - latDelta],
      [lon + lonDelta, lat + latDelta]
    ];
  }

  function ensureMap() {
    const node = $(MAP_ID);
    if (!node || map) return map;

    if (!window.maplibregl) {
      node.innerHTML = '<div class="map-fallback">La carte n’a pas pu se charger. Le radar du ciel reste disponible.</div>';
      return null;
    }

    const initial = center || { lat: 48.8566, lon: 2.3522 };

    map = new maplibregl.Map({
      container: MAP_ID,
      style: makeStyle(),
      center: [initial.lon, initial.lat],
      zoom: 7.6,
      attributionControl: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      cooperativeGestures: false
    });

    map.addControl(new maplibregl.NavigationControl({
      showCompass: false,
      visualizePitch: false
    }), "top-left");

    map.on("load", () => {
      requestAnimationFrame(() => {
        map.resize();
        if (center) {
          renderCenterMarker();
          renderAircraft(latestAircraft);
          recenter(false);
        }
      });
    });

    map.on("error", (event) => {
      const warning = $("mapTileWarning");
      const message = String(event?.error?.message || "");
      if (warning && /tile|image|source|raster/i.test(message)) warning.hidden = false;
    });

    $("mapRecenter")?.addEventListener("click", () => recenter(true));
    return map;
  }

  function recenter(animate = true) {
    if (!center) return;
    ensureMap();
    if (!map) return;

    const bounds = boundsAround(center.lat, center.lon, 50);
    map.fitBounds(bounds, {
      padding: { top: 34, right: 28, bottom: 34, left: 28 },
      maxZoom: 9,
      duration: animate ? 450 : 0
    });
  }

  function makeCenterElement() {
    const el = document.createElement("div");
    el.className = "au-map-center-dot";
    el.setAttribute("aria-label", centerMode === "geo" ? "Ma position" : "Point observé");
    return el;
  }

  function renderCenterMarker() {
    if (!center || !map) return;
    if (centerMarker) centerMarker.remove();

    centerMarker = new maplibregl.Marker({
      element: makeCenterElement(),
      anchor: "center"
    })
      .setLngLat([center.lon, center.lat])
      .addTo(map);
  }

  function planeElement(aircraft, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "au-map-plane";
    button.dataset.key = aircraft.key;
    button.setAttribute("aria-label", aircraft.callsign || "Aéronef");

    const hasTrack = Number.isFinite(aircraft.track);
    button.innerHTML = hasTrack
      ? `<span class="au-map-plane-inner" style="--track:${aircraft.track}deg">${PLANE_SVG}</span>`
      : '<span class="au-map-plane-inner no-track">•</span>';

    if (index < 4 && aircraft.callsign) {
      const label = document.createElement("span");
      label.className = "au-map-label";
      label.textContent = aircraft.callsign;
      button.appendChild(label);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("au-dessus:open-aircraft", {
        detail: { key: aircraft.key, source: "map" }
      }));
    });

    return button;
  }

  function applySelected() {
    aircraftMarkers.forEach((marker, key) => {
      const el = marker.getElement();
      if (el) el.classList.toggle("selected", key === selectedKey);
    });
  }

  function renderAircraft(list) {
    latestAircraft = Array.isArray(list) ? list : [];
    ensureMap();
    if (!map || !map.loaded()) return;

    aircraftMarkers.forEach((marker) => marker.remove());
    aircraftMarkers = new Map();

    latestAircraft.forEach((aircraft, index) => {
      if (!Number.isFinite(aircraft.lat) || !Number.isFinite(aircraft.lon)) return;

      const element = planeElement(aircraft, index);
      const marker = new maplibregl.Marker({
        element,
        anchor: "center"
      })
        .setLngLat([aircraft.lon, aircraft.lat])
        .addTo(map);

      aircraftMarkers.set(aircraft.key, marker);
    });

    applySelected();
  }

  function setCenter(detail) {
    center = detail?.center || null;
    centerMode = detail?.mode || "geo";
    centerLabel = detail?.label || (centerMode === "geo" ? "ma position" : "le point choisi");
    if (!center) return;

    const groundLocation = $("groundLocation");
    if (groundLocation) {
      groundLocation.textContent = centerMode === "geo"
        ? "Ta position au sol, avec les mêmes appareils que dans le ciel."
        : `Autour de ${centerLabel}.`;
    }

    const recenterText = $("mapRecenterText");
    if (recenterText) recenterText.textContent = centerMode === "geo" ? "Sur moi" : "Sur ce lieu";

    const recenterButton = $("mapRecenter");
    if (recenterButton) {
      recenterButton.setAttribute(
        "aria-label",
        centerMode === "geo" ? "Recentrer la carte sur ma position" : "Recentrer la carte sur le lieu observé"
      );
    }

    ensureMap();
    if (!map) return;

    if (map.loaded()) {
      renderCenterMarker();
      recenter(false);
      renderAircraft(latestAircraft);
    } else {
      map.jumpTo({ center: [center.lon, center.lat], zoom: 7.6 });
    }
  }

  function setSelected(key) {
    selectedKey = key || null;
    applySelected();
  }

  window.addEventListener("au-dessus:center", (event) => setCenter(event.detail));
  window.addEventListener("au-dessus:aircraft", (event) => {
    if (event.detail?.center && !center) setCenter(event.detail);
    renderAircraft(event.detail?.aircraft || []);
  });
  window.addEventListener("au-dessus:selected", (event) => setSelected(event.detail?.key || null));

  window.addEventListener("resize", () => {
    if (map) map.resize();
  });
})();
