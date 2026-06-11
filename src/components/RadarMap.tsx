"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CHANNEL_MAP, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import { MEDIA_ICON, Waypoint } from "@/lib/waypoints";
import { attachGroundRadar, GroundRadar } from "@/lib/groundRadar";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface Props {
  center: LngLat;
  waypoints: Waypoint[];
  visibleChannels: Set<ChannelId>;
  selectedId: string | null;
  onSelect: (wp: Waypoint) => void;
  onUserLocation: (pos: LngLat) => void;
  onExpire: (id: string) => void;
  onMapTap: () => void;
  recenterSignal: number;
}

// Countdown ring geometry. The SVG is inset -4px around the 30px button so the
// ring sits just outside the dot. Rotated -90° so depletion starts at 12 o'clock.
const RING_R = 16.5;
const RING_C = 2 * Math.PI * RING_R;
const RING_RED = "#ff4d4d";
const RING_FADE = 0.15; // last 15% of life turns red

type Channel = (typeof CHANNEL_MAP)[ChannelId];

interface MarkerEntry {
  marker: mapboxgl.Marker;
  el: HTMLElement;
  dot: HTMLElement;
  ring: SVGCircleElement;
  ch: Channel;
  ageOpacity: number;
  expiresAt: number;
  promoted: boolean;
  ringAnim?: Animation;
}

function ageOpacityFor(wp: Waypoint): number {
  return Math.max(0.4, 1 - wp.minutesAgo / 1440);
}

// Apply selection + age styling to a marker in place (no DOM teardown), so ring
// animations survive selection changes.
function styleMarker(entry: MarkerEntry, selected: boolean) {
  const { dot, el, ch, ageOpacity } = entry;
  dot.style.transform = `scale(${selected ? 1.25 : 1})`;
  dot.style.boxShadow = `0 0 0 ${selected ? 3 : 2}px rgba(5,7,10,.85),` +
    `0 0 ${selected ? 22 : 12}px ${selected ? 6 : 2}px ${ch.color}`;
  el.style.opacity = `${selected ? 1 : ageOpacity}`;
  el.style.zIndex = selected ? "5" : ""; // below the puck (10), above other pins
}

function buildMarkerEl(wp: Waypoint): { el: HTMLElement; dot: HTMLElement; ring: SVGCircleElement } {
  const ch = CHANNEL_MAP[wp.channel];
  const fresh = wp.minutesAgo < 30;

  // NOTE: Mapbox fully owns this root element's positioning (it adds
  // `.mapboxgl-marker` and rewrites `transform` every frame to pin it to its
  // lng/lat). Do NOT set `position`/`transform` here or the marker drifts on
  // zoom. The button is the containing block for the absolute dot/ring/star.
  const el = document.createElement("button");
  el.className = "sonar-wp";
  el.style.cssText = `
    --wp-color:${ch.color};
    width:30px;height:30px;border:none;cursor:pointer;
    border-radius:9999px;background:transparent;padding:0;
    transition:opacity .2s ease;
  `;

  const dot = document.createElement("span");
  dot.style.cssText = `
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    border-radius:9999px;font-size:13px;line-height:1;color:#04110c;font-weight:700;
    background:${ch.color};
    transition:transform .18s ease, box-shadow .18s ease;
    ${fresh ? "animation:wp-pulse 2.2s ease-in-out infinite;" : ""}
  `;
  dot.textContent = MEDIA_ICON[wp.kind];
  el.appendChild(dot);

  // Countdown ring: a faint static track + an animated progress arc.
  const ringWrap = document.createElement("span");
  ringWrap.style.cssText = "position:absolute;inset:-4px;pointer-events:none;";
  ringWrap.innerHTML = `
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <circle cx="19" cy="19" r="${RING_R}" stroke="${ch.color}" stroke-opacity="0.15" stroke-width="2.5"/>
      <circle class="wp-ring" cx="19" cy="19" r="${RING_R}" stroke="${ch.color}" stroke-width="2.5"
        stroke-linecap="round" transform="rotate(-90 19 19)"
        style="stroke-dasharray:${RING_C};stroke-dashoffset:0;"/>
    </svg>`;
  el.appendChild(ringWrap);
  const ring = ringWrap.querySelector(".wp-ring") as SVGCircleElement;

  if (wp.promoted) el.appendChild(buildStar());
  return { el, dot, ring };
}

function buildStar(): HTMLElement {
  const star = document.createElement("span");
  star.className = "sonar-wp-star";
  star.textContent = "★";
  star.style.cssText = `
    position:absolute;top:-7px;right:-7px;font-size:11px;line-height:1;
    color:#ffd35c;text-shadow:0 0 6px #ffb300;z-index:1;
  `;
  return star;
}

export default function RadarMap({
  center,
  waypoints,
  visibleChannels,
  selectedId,
  onSelect,
  onUserLocation,
  onExpire,
  onMapTap,
  recenterSignal,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const radarRef = useRef<GroundRadar | null>(null);
  const homeRef = useRef<LngLat>(center);

  // Latest callbacks/selection read by the (mount-stable) marker effects.
  const onUserLocationRef = useRef(onUserLocation);
  onUserLocationRef.current = onUserLocation;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const onMapTapRef = useRef(onMapTap);
  onMapTapRef.current = onMapTap;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const prevSelectedRef = useRef<string | null>(null);

  // Start/refresh a marker's depleting countdown ring. WAAPI drives it (no JS
  // ticking); on completion the marker fades and is removed from state.
  function applyRing(entry: MarkerEntry, wp: Waypoint) {
    entry.ringAnim?.cancel();
    entry.ring.style.strokeDasharray = `${RING_C}`;

    const remaining = Math.max(0, wp.expiresAt - Date.now());
    if (remaining <= 0) {
      entry.ring.style.strokeDashoffset = `${RING_C}`;
      onExpireRef.current(wp.id);
      return;
    }
    const frac = wp.lifespanMs > 0
      ? Math.max(0, Math.min(1, remaining / wp.lifespanMs))
      : 0;
    const color = entry.ch.color;
    const keyframes = frac > RING_FADE
      ? [
          { strokeDashoffset: RING_C * (1 - frac), stroke: color, offset: 0 },
          { strokeDashoffset: RING_C * (1 - RING_FADE), stroke: color, offset: Math.max(0, 1 - RING_FADE / frac) },
          { strokeDashoffset: RING_C, stroke: RING_RED, offset: 1 },
        ]
      : [
          { strokeDashoffset: RING_C * (1 - frac), stroke: RING_RED, offset: 0 },
          { strokeDashoffset: RING_C, stroke: RING_RED, offset: 1 },
        ];
    const anim = entry.ring.animate(keyframes, {
      duration: remaining,
      easing: "linear",
      fill: "forwards",
    });
    entry.ringAnim = anim;
    anim.onfinish = () => {
      // Graceful fade right at the destruction moment, then drop from state.
      entry.el.style.transition = "opacity .4s ease";
      entry.el.style.opacity = "0";
      setTimeout(() => onExpireRef.current(wp.id), 400);
    };
  }

  // init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [center.lng, center.lat],
      zoom: 15.4,
      pitch: 45,
      bearing: -18,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    mapRef.current = map;

    // Tapping empty map (not a marker — those are DOM overlays off-canvas) toggles
    // the overlay chrome, for a clean "just the map" view.
    map.on("click", () => onMapTapRef.current());

    // Floor-projected sonar radar: rings + sweep drawn as ground GeoJSON so they
    // tilt/rotate with the map instead of floating as a flat HUD.
    radarRef.current = attachGroundRadar(map);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // User puck — always on top (high z-index) and never dimmed behind 3D
    // buildings (occludedOpacity:1). Waypoint markers keep the default z-index.
    const userEl = document.createElement("div");
    userEl.style.cssText = `position:relative;width:18px;height:18px;z-index:10;`;
    userEl.innerHTML = `
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        box-shadow:0 0 0 3px rgba(5,7,10,.9),0 0 16px 4px #34e3a0;"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        animation:sonar-ping 2.6s ease-out infinite;"></span>`;
    userMarkerRef.current = new mapboxgl.Marker({ element: userEl, occludedOpacity: 1 })
      .setLngLat([center.lng, center.lat])
      .addTo(map);

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const pos = { lng: p.coords.longitude, lat: p.coords.latitude };
          homeRef.current = pos;
          userMarkerRef.current?.setLngLat([pos.lng, pos.lat]);
          radarRef.current?.setCenter(pos.lng, pos.lat);
          map.flyTo({ center: [pos.lng, pos.lat], zoom: 15.4, duration: 1200 });
          onUserLocationRef.current(pos);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }

    return () => {
      ro.disconnect();
      radarRef.current?.destroy();
      radarRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep user marker synced to resolved center
  useEffect(() => {
    homeRef.current = center;
    userMarkerRef.current?.setLngLat([center.lng, center.lat]);
    radarRef.current?.setCenter(center.lng, center.lat);
  }, [center]);

  // Reconcile waypoint markers by id (does NOT depend on selectedId, so picking
  // a pin never tears down markers / restarts ring animations).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = markersRef.current;
    const selectedId = selectedIdRef.current;

    // remove markers whose waypoint is gone or now hidden
    for (const [id, entry] of live) {
      const wp = waypoints.find((w) => w.id === id);
      if (!wp || !visibleChannels.has(wp.channel)) {
        entry.ringAnim?.cancel();
        entry.marker.remove();
        live.delete(id);
      }
    }

    for (const wp of waypoints) {
      if (!visibleChannels.has(wp.channel)) continue;
      const ch = CHANNEL_MAP[wp.channel];
      const ageOpacity = ageOpacityFor(wp);
      const existing = live.get(wp.id);

      if (!existing) {
        const { el, dot, ring } = buildMarkerEl(wp);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(wp);
        });
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([wp.pos.lng, wp.pos.lat])
          .addTo(map);
        const entry: MarkerEntry = {
          marker, el, dot, ring, ch, ageOpacity,
          expiresAt: wp.expiresAt, promoted: wp.promoted,
        };
        live.set(wp.id, entry);
        styleMarker(entry, wp.id === selectedId);
        applyRing(entry, wp);
      } else {
        existing.ch = ch;
        existing.ageOpacity = ageOpacity;
        existing.marker.setLngLat([wp.pos.lng, wp.pos.lat]);
        // newly promoted → add the ★ badge without rebuilding the marker
        if (wp.promoted && !existing.promoted) {
          existing.el.appendChild(buildStar());
          existing.promoted = true;
        }
        // restart the ring only when the expiry actually changed
        if (existing.expiresAt !== wp.expiresAt) {
          existing.expiresAt = wp.expiresAt;
          applyRing(existing, wp);
        }
        styleMarker(existing, wp.id === selectedId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, visibleChannels]);

  // Selection: patch only the previously- and newly-selected markers in place.
  useEffect(() => {
    const live = markersRef.current;
    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedId) {
      const e = live.get(prev);
      if (e) styleMarker(e, false);
    }
    if (selectedId) {
      const e = live.get(selectedId);
      if (e) styleMarker(e, true);
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  // recenter on demand
  useEffect(() => {
    if (recenterSignal === 0) return;
    mapRef.current?.flyTo({
      center: [homeRef.current.lng, homeRef.current.lat],
      zoom: 15.4,
      pitch: 45,
      bearing: -18,
      duration: 900,
    });
  }, [recenterSignal]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
