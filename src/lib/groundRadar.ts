import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

/**
 * Ground-projected sonar radar: concentric range rings + a rotating sweep drawn
 * as GeoJSON layers ON the map floor. Because the geometry is real lng/lat,
 * Mapbox renders it flat on the ground — so it inherits the map's pitch/bearing
 * and stays correctly oriented as the camera tilts and rotates.
 *
 * The radar is range-driven: its outer reach equals the selected travel-mode
 * range (walk/bike/car), so the rings, sweep, and a translucent coverage disc
 * all grow and shrink to visualise exactly how far Sonar is currently listening.
 */

const SONAR = "#34e3a0";
const EARTH_R = 6371000; // metres
const SWEEP_WIDTH = 60; // degrees of the trailing wedge
const SWEEP_PERIOD = 5000; // ms per full rotation
const DEFAULT_RANGE = 800; // metres; overridden via attach/setRange

// Three concentric rings as fractions of the outer range, so the radar reads
// the same at any range while the absolute size tracks the selected mode.
const RING_FRACTIONS = [0.4, 0.7, 1];

// Geodesic destination point: walk `distM` metres from (lng,lat) on `bearing`.
function dest(lng: number, lat: number, bearingDeg: number, distM: number): [number, number] {
  const br = (bearingDeg * Math.PI) / 180;
  const latR = (lat * Math.PI) / 180;
  const lngR = (lng * Math.PI) / 180;
  const dr = distM / EARTH_R;
  const lat2 = Math.asin(
    Math.sin(latR) * Math.cos(dr) + Math.cos(latR) * Math.sin(dr) * Math.cos(br)
  );
  const lng2 =
    lngR +
    Math.atan2(
      Math.sin(br) * Math.sin(dr) * Math.cos(latR),
      Math.cos(dr) - Math.sin(latR) * Math.sin(lat2)
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function ringCoords(lng: number, lat: number, radiusM: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) coords.push(dest(lng, lat, (i / steps) * 360, radiusM));
  return coords;
}

// Rings + two diameter crosshairs as a single line FeatureCollection, sized to
// the current range.
function ringsData(lng: number, lat: number, range: number): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = RING_FRACTIONS.map((f) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: ringCoords(lng, lat, range * f) },
  }));
  for (const b of [0, 90]) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [dest(lng, lat, b + 180, range), dest(lng, lat, b, range)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// Filled disc covering the whole fetch radius — shades the area Sonar listens to.
function discData(lng: number, lat: number, range: number): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ringCoords(lng, lat, range)] },
  };
}

// Trailing wedge that follows the leading beam, out to the current range.
function wedgeData(lng: number, lat: number, angle: number, range: number): Feature<Polygon> {
  const coords: [number, number][] = [[lng, lat]];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    coords.push(dest(lng, lat, angle - SWEEP_WIDTH + (i / steps) * SWEEP_WIDTH, range));
  }
  coords.push([lng, lat]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

// Bright leading edge of the sweep.
function beamData(lng: number, lat: number, angle: number, range: number): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [[lng, lat], dest(lng, lat, angle, range)] },
  };
}

export interface GroundRadar {
  setCenter(lng: number, lat: number): void;
  setRange(meters: number): void;
  destroy(): void;
}

const RINGS = "ground-radar-rings";
const SWEEP = "ground-radar-sweep";
const BEAM = "ground-radar-beam";
const DISC = "ground-radar-disc";

export function attachGroundRadar(map: MapboxMap, initialRange = DEFAULT_RANGE): GroundRadar {
  const c = map.getCenter();
  let clng = c.lng;
  let clat = c.lat;
  let range = initialRange;
  let raf = 0;
  let startedAt = 0;
  let destroyed = false;

  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

  // Redraw the range-dependent geometry (rings + coverage disc) in place.
  function redrawRange() {
    src(RINGS)?.setData(ringsData(clng, clat, range));
    src(DISC)?.setData(discData(clng, clat, range));
  }

  function setup() {
    if (destroyed || map.getSource(RINGS)) return;
    map.addSource(DISC, { type: "geojson", data: discData(clng, clat, range) });
    map.addSource(RINGS, { type: "geojson", data: ringsData(clng, clat, range) });
    map.addSource(SWEEP, { type: "geojson", data: wedgeData(clng, clat, 0, range) });
    map.addSource(BEAM, { type: "geojson", data: beamData(clng, clat, 0, range) });

    // Keep the radar below map labels (but above the base) so it reads as ground.
    const before = (map.getStyle().layers || []).find((l) => l.type === "symbol")?.id;

    // Coverage disc sits underneath everything else.
    map.addLayer(
      { id: DISC, type: "fill", source: DISC, paint: { "fill-color": SONAR, "fill-opacity": 0.06 } },
      before
    );
    map.addLayer(
      { id: SWEEP, type: "fill", source: SWEEP, paint: { "fill-color": SONAR, "fill-opacity": 0.1 } },
      before
    );
    map.addLayer(
      {
        id: RINGS,
        type: "line",
        source: RINGS,
        paint: { "line-color": SONAR, "line-opacity": 0.22, "line-width": 1.4 },
      },
      before
    );
    map.addLayer(
      {
        id: BEAM,
        type: "line",
        source: BEAM,
        paint: { "line-color": SONAR, "line-opacity": 0.55, "line-width": 2, "line-blur": 1 },
      },
      before
    );
  }

  function frame(now: number) {
    if (destroyed) return;
    if (!startedAt) startedAt = now;
    const angle = (((now - startedAt) / SWEEP_PERIOD) * 360) % 360;
    src(SWEEP)?.setData(wedgeData(clng, clat, angle, range));
    src(BEAM)?.setData(beamData(clng, clat, angle, range));
    raf = requestAnimationFrame(frame);
  }

  function begin() {
    setup();
    raf = requestAnimationFrame(frame);
  }

  if (map.isStyleLoaded()) begin();
  else map.once("load", begin);

  return {
    setCenter(nlng, nlat) {
      clng = nlng;
      clat = nlat;
      redrawRange();
    },
    setRange(meters) {
      if (meters <= 0 || meters === range) return;
      range = meters;
      redrawRange();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const id of [SWEEP, RINGS, BEAM, DISC]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    },
  };
}
