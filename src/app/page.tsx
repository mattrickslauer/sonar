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
  PROMOTE_THRESHOLD,
  MediaKind,
  Waypoint,
} from "@/lib/waypoints";
import { openRadarSocket } from "@/lib/realtime";
import TopBar from "@/components/TopBar";
import ChannelDock from "@/components/ChannelDock";
import AskBar from "@/components/AskBar";
import WaypointSheet from "@/components/WaypointSheet";
import DropComposer from "@/components/DropComposer";

// mapbox-gl touches window → load the map client-side only
const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });

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

// Default to Punta Arenas, Chile (where the live cluster is seeded) until
// geolocation resolves.
const DEFAULT_CENTER: LngLat = { lng: -70.9171, lat: -53.1638 };
const PLACE = "Punta Arenas";

export default function Home() {
  const [center, setCenter] = useState<LngLat>(DEFAULT_CENTER);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  // Load live waypoints for the initial center from the DynamoDB-backed API.
  useEffect(() => {
    let active = true;
    fetchWaypoints(DEFAULT_CENTER)
      .then((w) => active && setWaypoints(w))
      .catch((e) => console.error("load waypoints", e));
    return () => {
      active = false;
    };
  }, []);
  const [visible, setVisible] = useState<Set<ChannelId>>(
    () => new Set(CHANNELS.map((c) => c.id))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loved, setLoved] = useState<Set<string>>(() => new Set());
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [userId, setUserId] = useState("you");

  // Resolve the persistent anon id once on the client.
  useEffect(() => setUserId(loadUserId()), []);

  // Keep the latest center available to the (mount-once) socket callback.
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Presence heartbeat → feeds the bot-tick liveness loop for this cell.
  useEffect(() => {
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
      setWaypoints((prev) =>
        prev.some((w) => w.id === raw.id)
          ? prev
          : [rawToWaypoint(raw, centerRef.current), ...prev]
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

  const visibleWaypoints = useMemo(
    () => waypoints.filter((w) => visible.has(w.channel)),
    [waypoints, visible]
  );

  const selected = useMemo(
    () => waypoints.find((w) => w.id === selectedId) ?? null,
    [waypoints, selectedId]
  );

  function handleUserLocation(pos: LngLat) {
    setCenter(pos);
    fetchWaypoints(pos)
      .then(setWaypoints)
      .catch((e) => console.error("load waypoints", e));
  }

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

    // Optimistic: flip loved-state + nudge the display counter immediately.
    setLoved((prev) => {
      const next = new Set(prev);
      if (wasLoved) next.delete(id);
      else next.add(id);
      return next;
    });
    setWaypoints((prev) =>
      prev.map((w) => (w.id === id ? { ...w, love: Math.max(0, w.love + delta) } : w))
    );

    const args = { id, channel: wp.channel, lat: wp.pos.lat, lng: wp.pos.lng, user: userId };
    const call = wasLoved ? postUnlove(args) : postLove(args);
    call
      .then((res) => {
        // Reconcile to the server's authoritative counters.
        setWaypoints((prev) =>
          prev.map((w) =>
            w.id === id
              ? { ...w, love: res.love, promoted: w.promoted || res.realLove >= PROMOTE_THRESHOLD }
              : w
          )
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
      promoted: false,
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

  return (
    <main className="flex min-h-dvh w-full items-stretch justify-center bg-black sm:items-center">
      <div className="relative h-dvh w-full max-w-md overflow-hidden bg-background sm:h-[860px] sm:max-h-[94vh] sm:rounded-[2.5rem] sm:border sm:border-white/10 sm:shadow-2xl">
        <RadarMap
          center={center}
          waypoints={visibleWaypoints}
          visibleChannels={visible}
          selectedId={selectedId}
          onSelect={(wp) => setSelectedId(wp.id)}
          onUserLocation={handleUserLocation}
          onExpire={handleExpire}
          onMapTap={() => setChromeVisible((v) => !v)}
          recenterSignal={recenterSignal}
        />

        {/* Overlay chrome — tap the map to hide/show for a clean "just map" view */}
        <div
          className={`transition-opacity duration-300 ${
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <TopBar place={PLACE} liveCount={visibleWaypoints.length} />

          {/* bottom control stack */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
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
            <AskBar waypoints={visibleWaypoints} place={PLACE} />
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

        {composerOpen && (
          <DropComposer onDrop={drop} onClose={() => setComposerOpen(false)} />
        )}
      </div>
    </main>
  );
}
