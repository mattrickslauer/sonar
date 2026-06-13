"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CHANNELS, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import {
  fetchWaypoints,
  fetchLoves,
  postDrop,
  postLove,
  postUnlove,
  postPresence,
  rawToWaypoint,
  MediaKind,
  Waypoint,
} from "@/lib/waypoints";
import { openRadarSocket } from "@/lib/realtime";
import { reverseGeocode } from "@/lib/geocode";
import { DEFAULT_RANGE, RANGE_MAP, RangeMode } from "@/lib/range";
import TopBar from "@/components/TopBar";
import RangeSelector from "@/components/RangeSelector";
import ChannelDock from "@/components/ChannelDock";
import AskBar from "@/components/AskBar";
import WaypointSheet from "@/components/WaypointSheet";
import ClusterSheet from "@/components/ClusterSheet";
import DropComposer from "@/components/DropComposer";
import LocationGate from "@/components/LocationGate";

// mapbox-gl touches window → load the map client-side only
const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });

// Likes buy time: each like adds 5 min to a drop's life (mirror of the server's
// LOVE_EXTENSION_SECONDS) — applied optimistically, then reconciled to the
// server's authoritative expiry.
const LOVE_EXTENSION_MS = 5 * 60 * 1000;

// Stable anonymous id so loves dedup per person and presence is attributable.
// Lives in localStorage; set after mount to avoid an SSR hydration mismatch.
function loadUserId(): string {
  try {
    let id = localStorage.getItem("sonar_uid");
    if (!id) {
      id = "u_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("sonar_uid", id);
    }
    return id;
  } catch {
    return "you";
  }
}

type LocationError = "denied" | "unavailable" | "unsupported" | null;

export default function Home() {
  // Sonar is a map of what's around you — there is no center until the device
  // tells us where the user actually is. Null means "not located yet" and gates
  // the entire app behind the location prompt; we never fall back to a default.
  const [center, setCenter] = useState<LngLat | null>(null);
  const [place, setPlace] = useState<string>("");
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState<LocationError>(null);
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [visible, setVisible] = useState<Set<ChannelId>>(
    () => new Set(CHANNELS.map((c) => c.id))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ids of the waypoints under a tapped cluster; drives the scroll-through menu.
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [loved, setLoved] = useState<Set<string>>(() => new Set());
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [userId, setUserId] = useState("you");
  // Travel-mode range: how far Sonar fetches waypoints + sizes the floor radar.
  const [range, setRange] = useState<RangeMode>(DEFAULT_RANGE);
  const radiusMeters = RANGE_MAP[range].radiusMeters;

  // Resolve the persistent anon id once on the client.
  useEffect(() => setUserId(loadUserId()), []);

  // Acquire the user's real location — required, no default. Re-runs when the
  // user taps "try again" (locateAttempt bumps). watchPosition keeps the radar
  // centered on the user as they move; the first fix unlocks the app.
  const hasFixRef = useRef(false);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocating(false);
      setLocationError("unsupported");
      return;
    }
    let active = true;
    setLocating(true);
    setLocationError(null);
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        if (!active) return;
        hasFixRef.current = true;
        setCenter({ lng: p.coords.longitude, lat: p.coords.latitude });
        setLocating(false);
        setLocationError(null);
      },
      (err) => {
        if (!active) return;
        setLocating(false);
        // Don't surface an error (or block the app) once we already have a fix —
        // transient watch failures shouldn't kick the user back to the gate.
        if (!hasFixRef.current) {
          setLocationError(
            err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"
          );
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [locateAttempt]);

  // Load live waypoints around the user's location once we have it, and refetch
  // if their cell changes meaningfully or the travel-mode range changes (a wider
  // range pulls more distant drops; a tighter one clips back to what's close).
  useEffect(() => {
    if (!center) return;
    let active = true;
    fetchWaypoints(center, undefined, radiusMeters)
      .then((w) => active && setWaypoints(w))
      .catch((e) => console.error("load waypoints", e));
    return () => {
      active = false;
    };
  }, [center, radiusMeters]);

  // Reverse-geocode the user's location for the top-bar label (anywhere on Earth).
  useEffect(() => {
    if (!center) return;
    let active = true;
    reverseGeocode(center)
      .then((name) => active && name && setPlace(name))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [center]);

  // Keep the latest center available to the (mount-once) socket callback.
  const centerRef = useRef<LngLat | null>(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Presence heartbeat → feeds the bot-tick liveness loop for this cell.
  useEffect(() => {
    if (!center) return;
    const beat = () =>
      postPresence({ lat: center.lat, lng: center.lng, user: userId }).catch(() => {});
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [center, userId]);

  // Hydrate loved-state: for any waypoint we haven't checked yet, ask the
  // backend which this user has already loved and seed the heart state. A ref
  // tracks checked ids so WS pushes don't re-query the whole set each time.
  const checkedLovesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (userId === "you") return; // wait for the resolved anon id
    const unchecked = waypoints
      .map((w) => w.id)
      .filter((id) => !checkedLovesRef.current.has(id));
    if (unchecked.length === 0) return;
    unchecked.forEach((id) => checkedLovesRef.current.add(id));
    fetchLoves(unchecked, userId)
      .then((lovedIds) => {
        if (lovedIds.length === 0) return;
        setLoved((prev) => {
          const next = new Set(prev);
          lovedIds.forEach((id) => next.add(id));
          return next;
        });
      })
      .catch((e) => console.error("fetchLoves", e));
  }, [userId, waypoints]);

  // Live feed: merge pushed waypoints (deduped by id, which drops our own echo).
  useEffect(() => {
    const channelIds = CHANNELS.map((c) => c.id);
    return openRadarSocket(channelIds, (raw) => {
      const c = centerRef.current;
      if (!c) return; // ignore pushes until we know where the user is
      setWaypoints((prev) =>
        prev.some((w) => w.id === raw.id)
          ? prev
          : [rawToWaypoint(raw, c), ...prev]
      );
    });
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(CHANNELS.map((ch) => [ch.id, 0])) as Record<
      ChannelId,
      number
    >;
    for (const w of waypoints) c[w.channel]++;
    return c;
  }, [waypoints]);

  // Clip to the channel toggles *and* the travel-mode range, so the map agrees
  // with the radar ring no matter the source (fetch, live push, optimistic drop)
  // and reacts instantly when the range narrows — no refetch needed.
  const visibleWaypoints = useMemo(
    () => waypoints.filter((w) => visible.has(w.channel) && w.meters <= radiusMeters),
    [waypoints, visible, radiusMeters]
  );

  const selected = useMemo(
    () => waypoints.find((w) => w.id === selectedId) ?? null,
    [waypoints, selectedId]
  );

  // Live waypoint objects under the open cluster menu, kept fresh (loves/expiry)
  // and pruned as members expire, get hidden, or fall outside the range clip.
  // The menu render guard hides it once fewer than two members remain (at which
  // point the survivor is an ordinary, individually-tappable pin again).
  const clusterWaypoints = useMemo(() => {
    if (!clusterIds) return null;
    const byId = new Map(visibleWaypoints.map((w) => [w.id, w]));
    return clusterIds
      .map((id) => byId.get(id))
      .filter((w): w is Waypoint => !!w);
  }, [clusterIds, visibleWaypoints]);

  function toggleChannel(id: ChannelId) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function love(id: string) {
    const wp = waypoints.find((w) => w.id === id);
    if (!wp) return;
    const wasLoved = loved.has(id);
    const delta = wasLoved ? -1 : 1;

    // Optimistic: flip loved-state, nudge the display counter, and move the
    // expiry by ±5 min (each like buys time) so the countdown ring reacts now.
    setLoved((prev) => {
      const next = new Set(prev);
      if (wasLoved) next.delete(id);
      else next.add(id);
      return next;
    });
    setWaypoints((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const createdAt = w.expiresAt - w.lifespanMs; // invariant across loves
        const expiresAt = w.expiresAt + delta * LOVE_EXTENSION_MS;
        return {
          ...w,
          love: Math.max(0, w.love + delta),
          expiresAt,
          lifespanMs: Math.max(1, expiresAt - createdAt),
        };
      })
    );

    const args = { id, channel: wp.channel, lat: wp.pos.lat, lng: wp.pos.lng, user: userId };
    const call = wasLoved ? postUnlove(args) : postLove(args);
    call
      .then((res) => {
        // Reconcile to the server's authoritative count + expiry (the latter
        // covers the no-op case where the like didn't actually count).
        setWaypoints((prev) =>
          prev.map((w) => {
            if (w.id !== id) return w;
            const createdAt = w.expiresAt - w.lifespanMs;
            const expiresAt = res.expiresAt || w.expiresAt;
            return {
              ...w,
              love: res.love,
              expiresAt,
              lifespanMs: Math.max(1, expiresAt - createdAt),
            };
          })
        );
      })
      .catch((e) => console.error(wasLoved ? "unlove" : "love", e));
  }

  function handleExpire(id: string) {
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
    setLoved((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  function drop(
    channel: ChannelId,
    kind: MediaKind,
    text: string,
    lifespanSeconds: number,
    mediaKey?: string,
  ) {
    if (!center) return; // can't drop without a location
    // Optimistic insert for instant feedback, then persist to DynamoDB. The
    // optimistic copy carries no mediaUrl yet — the saved waypoint the server
    // returns fills it in (its presigned /api/media/view URL).
    const now = Date.now();
    const optimistic: Waypoint = {
      id: `drop_${now}`,
      channel,
      kind,
      author: userId,
      text,
      pos: center,
      minutesAgo: 0,
      love: 0,
      sponsored: false,
      bearing: 0,
      meters: 0,
      expiresAt: now + lifespanSeconds * 1000,
      lifespanMs: lifespanSeconds * 1000,
      mediaKey,
    };
    setWaypoints((prev) => [optimistic, ...prev]);
    setVisible((prev) => new Set(prev).add(channel));
    setComposerOpen(false);
    setSelectedId(optimistic.id);
    setRecenterSignal((s) => s + 1);

    postDrop({ channel, kind, text, center, author: userId, lifespanSeconds, mediaKey })
      .then((saved) => {
        setWaypoints((prev) =>
          prev.map((w) => (w.id === optimistic.id ? saved : w))
        );
        setSelectedId(saved.id);
      })
      .catch((e) => console.error("drop", e));
  }

  // Location is required: until we have a fix, gate the whole app behind the
  // location prompt — never render the map with a fake center.
  if (!center) {
    return (
      <main className="flex min-h-dvh w-full items-stretch justify-center bg-black sm:items-center">
        <div className="relative h-dvh w-full max-w-md overflow-hidden bg-background sm:h-[860px] sm:max-h-[94vh] sm:rounded-[2.5rem] sm:border sm:border-white/10 sm:shadow-2xl">
          <LocationGate
            locating={locating}
            error={locationError}
            onRetry={() => setLocateAttempt((n) => n + 1)}
          />
        </div>
      </main>
    );
  }

  const placeLabel = place || "Nearby";

  return (
    <main className="flex min-h-dvh w-full items-stretch justify-center bg-black sm:items-center">
      <div className="relative h-dvh w-full max-w-md overflow-hidden bg-background sm:h-[860px] sm:max-h-[94vh] sm:rounded-[2.5rem] sm:border sm:border-white/10 sm:shadow-2xl">
        <RadarMap
          center={center}
          waypoints={visibleWaypoints}
          visibleChannels={visible}
          selectedId={selectedId}
          onSelect={(wp) => {
            setClusterIds(null);
            setSelectedId(wp.id);
          }}
          onSelectCluster={(wps) => {
            setSelectedId(null);
            setClusterIds(wps.map((w) => w.id));
          }}
          onExpire={handleExpire}
          onMapTap={() => setChromeVisible((v) => !v)}
          recenterSignal={recenterSignal}
          rangeMeters={radiusMeters}
        />

        {/* Overlay chrome — tap the map to hide/show for a clean "just map" view */}
        <div
          className={`transition-opacity duration-300 ${
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <TopBar place={placeLabel} liveCount={visibleWaypoints.length} />

          {/* bottom control stack */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <RangeSelector active={range} onChange={setRange} />

          <div className="flex items-center justify-between px-4">
            <button
              onClick={() => setRecenterSignal((s) => s + 1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/55 text-sonar backdrop-blur-md"
              aria-label="Recenter"
            >
              ◎
            </button>
            <button
              onClick={() => setComposerOpen(true)}
              className="flex items-center gap-2 rounded-full bg-sonar px-5 py-3 text-[14px] font-semibold text-[#04110c] shadow-lg shadow-sonar/30"
            >
              <span className="text-[16px]">＋</span> Drop
            </button>
          </div>

            <ChannelDock active={visible} counts={counts} onToggle={toggleChannel} />
            <AskBar waypoints={visibleWaypoints} place={placeLabel} />
          </div>
        </div>

        {selected && (
          <WaypointSheet
            wp={selected}
            loved={loved.has(selected.id)}
            onLove={love}
            onClose={() => setSelectedId(null)}
          />
        )}

        {clusterWaypoints && clusterWaypoints.length > 1 && (
          <ClusterSheet
            waypoints={clusterWaypoints}
            onSelect={(id) => {
              setClusterIds(null);
              setSelectedId(id);
            }}
            onClose={() => setClusterIds(null)}
          />
        )}

        {composerOpen && (
          <DropComposer onDrop={drop} onClose={() => setComposerOpen(false)} />
        )}
      </div>
    </main>
  );
}
