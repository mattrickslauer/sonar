"use client";

import { useCallback, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CHANNEL_MAP, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import { MEDIA_ICON, Waypoint } from "@/lib/waypoints";
import { attachGroundRadar, GroundRadar } from "@/lib/groundRadar";
import { playChime, primeAudio } from "@/lib/chime";
import { Cluster, clusterRadius, clusterWaypoints } from "@/lib/cluster";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface Props {
  center: LngLat;
  waypoints: Waypoint[];
  visibleChannels: Set<ChannelId>;
  selectedId: string | null;
  onSelect: (wp: Waypoint) => void;
  onSelectCluster: (waypoints: Waypoint[]) => void;
  onExpire: (id: string) => void;
  onMapTap: () => void;
  recenterSignal: number;
  /** Fetch range (metres) of the selected travel mode — sizes the radar + zoom. */
  rangeMeters: number;
}

// Pick a zoom so the range circle (diameter 2·range) fills most of the viewport
// width, so switching walk/bike/car visibly reframes the map to the new reach.
const WORLD_M_PER_PX = 156543.03392; // metres/px at the equator, zoom 0
function zoomForRange(rangeMeters: number, lat: number, viewportPx: number): number {
  const metersPerPixel = (2 * rangeMeters) / (viewportPx * 0.82);
  const z = Math.log2((WORLD_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
  return Math.max(13, Math.min(16.4, z));
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
  sponsored: boolean;
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

  if (wp.sponsored) el.appendChild(buildSponsorBadge());
  return { el, dot, ring };
}

// Sponsored permanent waypoints get a gold ◆ badge (replaces the old
// greatest-hits ★).
function buildSponsorBadge(): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "sonar-wp-sponsor";
  badge.textContent = "◆";
  badge.style.cssText = `
    position:absolute;top:-7px;right:-7px;font-size:11px;line-height:1;
    color:#ffd35c;text-shadow:0 0 6px #ffb300;z-index:1;
  `;
  return badge;
}

interface ClusterMarkerEntry {
  marker: mapboxgl.Marker;
  el: HTMLElement;
}

// The cluster circle takes the color of its most-common channel; a mixed group
// is ringed in white to read as "several channels stacked here".
function clusterColor(cluster: Cluster): { color: string; mixed: boolean } {
  const tally = new Map<ChannelId, number>();
  for (const wp of cluster.waypoints) {
    tally.set(wp.channel, (tally.get(wp.channel) ?? 0) + 1);
  }
  let best: ChannelId = cluster.waypoints[0].channel;
  let bestN = 0;
  for (const [ch, n] of tally) {
    if (n > bestN) {
      best = ch;
      bestN = n;
    }
  }
  return { color: CHANNEL_MAP[best].color, mixed: tally.size > 1 };
}

// One combined circle standing in for every pin underneath it. The radius grows
// linearly with the count (clusterRadius), and the member tally sits in the
// middle so it reads as "tap to expand N".
function buildClusterEl(cluster: Cluster): HTMLElement {
  const count = cluster.waypoints.length;
  const r = clusterRadius(count);
  const size = r * 2;
  const { color, mixed } = clusterColor(cluster);

  const el = document.createElement("button");
  el.className = "sonar-cluster";
  el.style.cssText = `
    width:${size}px;height:${size}px;border:none;cursor:pointer;padding:0;
    border-radius:9999px;background:transparent;
  `;

  const disc = document.createElement("span");
  disc.style.cssText = `
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    border-radius:9999px;font-size:${Math.round(r * 0.7)}px;line-height:1;
    font-weight:700;color:#04110c;
    background:${color};
    box-shadow:0 0 0 2px rgba(5,7,10,.85),
      0 0 16px 3px ${color},
      ${mixed ? "inset 0 0 0 2px rgba(255,255,255,.85)" : "inset 0 0 0 0 transparent"};
  `;
  disc.textContent = String(count);
  el.appendChild(disc);
  return el;
}

export default function RadarMap({
  center,
  waypoints,
  visibleChannels,
  selectedId,
  onSelect,
  onSelectCluster,
  onExpire,
  onMapTap,
  recenterSignal,
  rangeMeters,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const clusterMarkersRef = useRef<Map<string, ClusterMarkerEntry>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const radarRef = useRef<GroundRadar | null>(null);
  const homeRef = useRef<LngLat>(center);
  // Latest range read by the (mount-once) init effect and recenter handler.
  const rangeRef = useRef(rangeMeters);
  rangeRef.current = rangeMeters;

  // Latest callbacks/selection read by the (mount-stable) marker effects.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectClusterRef = useRef(onSelectCluster);
  onSelectClusterRef.current = onSelectCluster;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const onMapTapRef = useRef(onMapTap);
  onMapTapRef.current = onMapTap;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const prevSelectedRef = useRef<string | null>(null);

  // Latest waypoints/visibility read by the reconcile pass (which also runs on
  // map move, outside React's render cycle).
  const waypointsRef = useRef<Waypoint[]>(waypoints);
  waypointsRef.current = waypoints;
  const visibleRef = useRef<Set<ChannelId>>(visibleChannels);
  visibleRef.current = visibleChannels;
  const reconcileRafRef = useRef<number | null>(null);

  // "New waypoint" entrance feedback (pop + chime). seenIds tracks every id we've
  // ever rendered so re-showing a hidden channel doesn't re-trigger; seeded gates
  // out the initial batch (so the whole map doesn't chime+pop at once on load);
  // lastChime throttles bursts of arrivals into a single sound.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const lastChimeRef = useRef(0);

  // Start/refresh a marker's depleting countdown ring. WAAPI drives it (no JS
  // ticking); on completion the marker fades and is removed from state.
  function applyRing(entry: MarkerEntry, wp: Waypoint) {
    entry.ringAnim?.cancel();
    entry.ring.style.strokeDasharray = `${RING_C}`;

    // Sponsored waypoints are permanent — no countdown; show a full static ring.
    if (wp.sponsored) {
      entry.ring.style.strokeDashoffset = "0";
      return;
    }

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
      zoom: zoomForRange(rangeRef.current, center.lat, containerRef.current.clientWidth || 400),
      pitch: 45,
      bearing: -18,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    mapRef.current = map;

    // Tapping empty map (not a marker — those are DOM overlays off-canvas) toggles
    // the overlay chrome, for a clean "just the map" view.
    map.on("click", () => onMapTapRef.current());

    // Re-cluster as the view changes: pixel proximity (and thus what overlaps)
    // shifts with zoom, pitch, and rotation.
    map.on("move", scheduleReconcile);

    // Unlock the chime's AudioContext on the first user gesture anywhere (browsers
    // start it suspended until then).
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true });

    // Floor-projected sonar radar: rings + sweep drawn as ground GeoJSON so they
    // tilt/rotate with the map instead of floating as a flat HUD. Its outer reach
    // tracks the selected travel-mode range.
    radarRef.current = attachGroundRadar(map, rangeRef.current);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // User puck — always on top (high z-index) and never dimmed behind 3D
    // buildings (occludedOpacity:1). Waypoint markers keep the default z-index.
    // pointer-events:none so the puck never swallows clicks on a waypoint sitting
    // directly underneath it — the puck is purely decorative and has no handler.
    const userEl = document.createElement("div");
    userEl.style.cssText = `position:relative;width:18px;height:18px;z-index:10;pointer-events:none;`;
    userEl.innerHTML = `
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        box-shadow:0 0 0 3px rgba(5,7,10,.9),0 0 16px 4px #34e3a0;"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:#34e3a0;
        animation:sonar-ping 2.6s ease-out infinite;"></span>`;
    userMarkerRef.current = new mapboxgl.Marker({ element: userEl, occludedOpacity: 1 })
      .setLngLat([center.lng, center.lat])
      .addTo(map);

    return () => {
      window.removeEventListener("pointerdown", prime);
      ro.disconnect();
      if (reconcileRafRef.current != null) {
        cancelAnimationFrame(reconcileRafRef.current);
        reconcileRafRef.current = null;
      }
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

  // Range change (walk/bike/car): grow/shrink the floor radar and ease the zoom
  // so the new reach fills the viewport — the range is felt, not just computed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    radarRef.current?.setRange(rangeMeters);
    map.easeTo({
      center: [homeRef.current.lng, homeRef.current.lat],
      zoom: zoomForRange(rangeMeters, homeRef.current.lat, map.getContainer().clientWidth || 400),
      duration: 700,
    });
  }, [rangeMeters]);

  // Reconcile both layers — individual pins and cluster circles — against the
  // current waypoints. Runs on data changes AND on every map move, because
  // clustering is decided in screen space (pixel proximity shifts with zoom).
  // Reads everything from refs so it stays stable across renders and can be
  // wired to a raw Mapbox event listener (does NOT depend on selectedId, so
  // picking a pin never tears down markers / restarts ring animations).
  const reconcile = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const waypoints = waypointsRef.current;
    const visibleChannels = visibleRef.current;
    const live = markersRef.current;
    const clusterLive = clusterMarkersRef.current;
    const selectedId = selectedIdRef.current;

    const visible = waypoints.filter((w) => visibleChannels.has(w.channel));

    // Detect genuinely new arrivals across the whole visible set BEFORE the
    // cluster split, so re-clustering on zoom never re-triggers the pop/chime
    // and an arrival folded straight into a cluster still chimes once.
    const newcomers = new Set<string>();
    for (const wp of visible) {
      if (!seenIdsRef.current.has(wp.id)) {
        seenIdsRef.current.add(wp.id);
        newcomers.add(wp.id);
      }
    }

    const { singles, clusters } = clusterWaypoints(visible, (wp) => {
      const p = map.project([wp.pos.lng, wp.pos.lat]);
      return { x: p.x, y: p.y };
    });
    const singleIds = new Set(singles.map((w) => w.id));

    // --- individual pins ---
    // Drop markers whose waypoint is gone, hidden, or now folded into a cluster.
    for (const [id, entry] of live) {
      if (!singleIds.has(id)) {
        entry.ringAnim?.cancel();
        entry.marker.remove();
        live.delete(id);
      }
    }

    for (const wp of singles) {
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
          expiresAt: wp.expiresAt, sponsored: wp.sponsored,
        };
        live.set(wp.id, entry);
        styleMarker(entry, wp.id === selectedId);
        applyRing(entry, wp);

        // Genuinely new arrival rendered as its own pin: pop the dot in. The pop
        // runs alongside any fresh-pulse glow.
        if (newcomers.has(wp.id) && seededRef.current) {
          const fresh = wp.minutesAgo < 30;
          dot.style.animation =
            "wp-pop .45s cubic-bezier(.2,1.5,.45,1)" +
            (fresh ? ", wp-pulse 2.2s ease-in-out infinite" : "");
        }
      } else {
        existing.ch = ch;
        existing.ageOpacity = ageOpacity;
        existing.marker.setLngLat([wp.pos.lng, wp.pos.lat]);
        // newly sponsored → add the ◆ badge without rebuilding the marker
        if (wp.sponsored && !existing.sponsored) {
          existing.el.appendChild(buildSponsorBadge());
          existing.sponsored = true;
        }
        // restart the ring only when the expiry actually changed
        if (existing.expiresAt !== wp.expiresAt) {
          existing.expiresAt = wp.expiresAt;
          applyRing(existing, wp);
        }
        styleMarker(existing, wp.id === selectedId);
      }
    }

    // --- cluster circles ---
    // Cluster ids encode their sorted membership, so an unchanged group keeps its
    // marker (just repositioned); any membership change yields a new id and a
    // fresh circle while the stale one is removed.
    const desired = new Set(clusters.map((c) => c.id));
    for (const [id, entry] of clusterLive) {
      if (!desired.has(id)) {
        entry.marker.remove();
        clusterLive.delete(id);
      }
    }
    for (const cluster of clusters) {
      const existing = clusterLive.get(cluster.id);
      if (existing) {
        existing.marker.setLngLat([cluster.lng, cluster.lat]);
        continue;
      }
      const el = buildClusterEl(cluster);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectClusterRef.current(cluster.waypoints);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([cluster.lng, cluster.lat])
        .addTo(map);
      clusterLive.set(cluster.id, { marker, el });
    }

    // One throttled chime per burst of real arrivals (not the seeding batch).
    if (seededRef.current && newcomers.size > 0) {
      const now = Date.now();
      if (now - lastChimeRef.current > 300) {
        lastChimeRef.current = now;
        playChime();
      }
    }

    // After the first non-empty reconcile, the initial batch is "seeded": from
    // here on, a never-before-seen id is a real new arrival worth a pop + chime.
    if (!seededRef.current && visible.length > 0) seededRef.current = true;
    // Stable across renders: every dependency is read through a ref.
  }, []);

  // Coalesce the move-driven reconciles to one per frame.
  const scheduleReconcile = useCallback(() => {
    if (reconcileRafRef.current != null) return;
    reconcileRafRef.current = requestAnimationFrame(() => {
      reconcileRafRef.current = null;
      reconcile();
    });
  }, [reconcile]);

  // Re-run the reconcile pass whenever the waypoint set or channel visibility
  // changes.
  useEffect(() => {
    reconcile();
  }, [waypoints, visibleChannels, reconcile]);

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
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [homeRef.current.lng, homeRef.current.lat],
      zoom: zoomForRange(rangeRef.current, homeRef.current.lat, map.getContainer().clientWidth || 400),
      pitch: 45,
      bearing: -18,
      duration: 900,
    });
  }, [recenterSignal]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
