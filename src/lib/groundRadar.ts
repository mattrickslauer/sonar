import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

/**
 * Ground-projected sonar radar: concentric range rings + a rotating sweep drawn
 * as GeoJSON layers ON the map floor. Because the geometry is real lng/lat,
 * Mapbox renders it flat on the ground — so it inherits the map's pitch/bearing
 * and stays correctly oriented as the camera tilts and rotates.
 */

const SONAR = "#34e3a0";
const EARTH_R = 6371000; // metres
const RADII = [80, 160, 240]; // ring radii in metres (outer = sweep reach)
const SWEEP_WIDTH = 60; // degrees of the trailing wedge
const SWEEP_PERIOD = 5000; // ms per full rotation

const OUTER = RADII[RADII.length - 1];

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

// Rings + two diameter crosshairs as a single line FeatureCollection.
function ringsData(lng: number, lat: number): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = RADII.map((r) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: ringCoords(lng, lat, r) },
  }));
  for (const b of [0, 90]) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [dest(lng, lat, b + 180, OUTER), dest(lng, lat, b, OUTER)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// Trailing wedge that follows the leading beam.
function wedgeData(lng: number, lat: number, angle: number): Feature<Polygon> {
  const coords: [number, number][] = [[lng, lat]];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    coords.push(dest(lng, lat, angle - SWEEP_WIDTH + (i / steps) * SWEEP_WIDTH, OUTER));
  }
  coords.push([lng, lat]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

// Bright leading edge of the sweep.
function beamData(lng: number, lat: number, angle: number): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [[lng, lat], dest(lng, lat, angle, OUTER)] },
  };
}

export interface GroundRadar {
  setCenter(lng: number, lat: number): void;
  destroy(): void;
}

const RINGS = "ground-radar-rings";
const SWEEP = "ground-radar-sweep";
const BEAM = "ground-radar-beam";

export function attachGroundRadar(map: MapboxMap): GroundRadar {
  const c = map.getCenter();
  let clng = c.lng;
  let clat = c.lat;
  let raf = 0;
  let startedAt = 0;
  let destroyed = false;

  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

  function setup() {
    if (destroyed || map.getSource(RINGS)) return;
    map.addSource(RINGS, { type: "geojson", data: ringsData(clng, clat) });
    map.addSource(SWEEP, { type: "geojson", data: wedgeData(clng, clat, 0) });
    map.addSource(BEAM, { type: "geojson", data: beamData(clng, clat, 0) });

    // Keep the radar below map labels (but above the base) so it reads as ground.
    const before = (map.getStyle().layers || []).find((l) => l.type === "symbol")?.id;

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
    src(SWEEP)?.setData(wedgeData(clng, clat, angle));
    src(BEAM)?.setData(beamData(clng, clat, angle));
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
      src(RINGS)?.setData(ringsData(clng, clat));
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const id of [SWEEP, RINGS, BEAM]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    },
  };
}
