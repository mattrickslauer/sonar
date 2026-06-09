"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CHANNELS, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import { generateWaypoints, MediaKind, Waypoint } from "@/lib/waypoints";
import RadarSweep from "@/components/RadarSweep";
import TopBar from "@/components/TopBar";
import ChannelDock from "@/components/ChannelDock";
import AskBar from "@/components/AskBar";
import WaypointSheet from "@/components/WaypointSheet";
import DropComposer from "@/components/DropComposer";

// mapbox-gl touches window → load the map client-side only
const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });

// Default to downtown Miami (us-east-1 demo region) until geolocation resolves.
const DEFAULT_CENTER: LngLat = { lng: -80.1918, lat: 25.7617 };
const PLACE = "Festival Grounds";

export default function Home() {
  const [center, setCenter] = useState<LngLat>(DEFAULT_CENTER);
  const [waypoints, setWaypoints] = useState<Waypoint[]>(() =>
    generateWaypoints(DEFAULT_CENTER)
  );
  const [visible, setVisible] = useState<Set<ChannelId>>(
    () => new Set(CHANNELS.map((c) => c.id))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loved, setLoved] = useState<Set<string>>(() => new Set());
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);

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
    setWaypoints(generateWaypoints(pos));
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
    setLoved((prev) => new Set(prev).add(id));
  }

  function drop(channel: ChannelId, kind: MediaKind, text: string) {
    const wp: Waypoint = {
      id: `drop_${Date.now()}`,
      channel,
      kind,
      author: "you",
      text,
      pos: center,
      minutesAgo: 0,
      love: 0,
      promoted: false,
      bearing: 0,
      meters: 0,
    };
    setWaypoints((prev) => [wp, ...prev]);
    setVisible((prev) => new Set(prev).add(channel));
    setComposerOpen(false);
    setSelectedId(wp.id);
    setRecenterSignal((s) => s + 1);
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
          recenterSignal={recenterSignal}
        />
        <RadarSweep />

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
