"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CHANNEL_MAP, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import { MEDIA_ICON, Waypoint } from "@/lib/waypoints";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface Props {
  center: LngLat;
  waypoints: Waypoint[];
  visibleChannels: Set<ChannelId>;
  selectedId: string | null;
  onSelect: (wp: Waypoint) => void;
  onUserLocation: (pos: LngLat) => void;
  recenterSignal: number;
}

function buildMarkerEl(wp: Waypoint, selected: boolean): HTMLElement {
  const ch = CHANNEL_MAP[wp.channel];
  const fresh = wp.minutesAgo < 30;
  const ageOpacity = Math.max(0.4, 1 - wp.minutesAgo / 1440);

  // NOTE: Mapbox fully owns this root element's positioning. It adds the
  // `.mapboxgl-marker` class (position:absolute; top:0; left:0) and rewrites
  // `transform` every frame to keep the marker pinned to its lng/lat — including
  // during zoom. Do NOT set `position` here (a `position:relative` drops the
  // element into normal flow, so Mapbox's transform offsets it from the wrong
  // base and the marker drifts relative to the map on zoom). Likewise no
  // `transform`/transform transition here, or it animates toward each new pixel
  // position. The button is still the containing block for the absolute dot/star
  // below; the selected-state scale lives on the dot.
  const el = document.createElement("button");
  el.className = "sonar-wp";
  el.style.cssText = `
    --wp-color:${ch.color};
    width:30px;height:30px;border:none;cursor:pointer;
    border-radius:9999px;background:transparent;padding:0;
    opacity:${selected ? 1 : ageOpacity};
    transition:opacity .2s ease;
  `;

  const dot = document.createElement("span");
  dot.style.cssText = `
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    border-radius:9999px;font-size:13px;line-height:1;color:#04110c;font-weight:700;
    background:${ch.color};
    box-shadow:0 0 0 ${selected ? 3 : 2}px rgba(5,7,10,.85),
      0 0 ${selected ? 22 : 12}px ${selected ? 6 : 2}px ${ch.color};
    transform:scale(${selected ? 1.25 : 1});
    transition:transform .18s ease;
    ${fresh ? "animation:wp-pulse 2.2s ease-in-out infinite;" : ""}
  `;
  dot.textContent = MEDIA_ICON[wp.kind];
  el.appendChild(dot);

  if (wp.promoted) {
    const star = document.createElement("span");
    star.textContent = "★";
    star.style.cssText = `
      position:absolute;top:-7px;right:-7px;font-size:11px;line-height:1;
      color:#ffd35c;text-shadow:0 0 6px #ffb300;
    `;
    el.appendChild(star);
  }
  return el;
}

export default function RadarMap({
  center,
  waypoints,
  visibleChannels,
  selectedId,
  onSelect,
  onUserLocation,
  recenterSignal,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const homeRef = useRef<LngLat>(center);
  const onUserLocationRef = useRef(onUserLocation);
  onUserLocationRef.current = onUserLocation;

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

    // Keep the canvas matched to the container on viewport / orientation
    // changes. (The container is sized with h-full w-full because Mapbox adds
    // its own `.mapboxgl-map { position: relative }`, which would otherwise
    // override our absolute positioning and collapse the height.)
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // user marker
    const userEl = document.createElement("div");
    userEl.style.cssText = `position:relative;width:18px;height:18px;`;
    userEl.innerHTML = `
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        box-shadow:0 0 0 3px rgba(5,7,10,.9),0 0 16px 4px #34e3a0;"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        animation:sonar-ping 2.6s ease-out infinite;"></span>`;
    userMarkerRef.current = new mapboxgl.Marker({ element: userEl })
      .setLngLat([center.lng, center.lat])
      .addTo(map);

    // try real geolocation
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const pos = { lng: p.coords.longitude, lat: p.coords.latitude };
          homeRef.current = pos;
          userMarkerRef.current?.setLngLat([pos.lng, pos.lat]);
          map.flyTo({ center: [pos.lng, pos.lat], zoom: 15.4, duration: 1200 });
          onUserLocationRef.current(pos);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep user marker synced to resolved center
  useEffect(() => {
    homeRef.current = center;
    userMarkerRef.current?.setLngLat([center.lng, center.lat]);
  }, [center]);

  // (re)build waypoint markers when data / filter / selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = markersRef.current;

    // remove stale
    for (const [id, m] of live) {
      const wp = waypoints.find((w) => w.id === id);
      if (!wp || !visibleChannels.has(wp.channel)) {
        m.remove();
        live.delete(id);
      }
    }
    // add / refresh
    for (const wp of waypoints) {
      if (!visibleChannels.has(wp.channel)) continue;
      const existing = live.get(wp.id);
      if (existing) existing.remove();
      const el = buildMarkerEl(wp, wp.id === selectedId);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect(wp);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([wp.pos.lng, wp.pos.lat])
        .addTo(map);
      live.set(wp.id, marker);
    }
  }, [waypoints, visibleChannels, selectedId, onSelect]);

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
