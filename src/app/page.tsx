"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CHANNELS, channelMeta, Channel, ChannelId } from "@/lib/channels";
import {
  fetchChannels,
  createOrJoinChannel,
  loadVisibleChannels,
  saveVisibleChannels,
} from "@/lib/channels.client";
import { LngLat, distance, formatDistance } from "@/lib/geo";
import {
  fetchRadar,
  fetchLoves,
  postDrop,
  postLove,
  postUnlove,
  postPresence,
  rawToWaypoint,
  MediaKind,
  Waypoint,
  SHARE_WAYPOINT_PARAM,
  SHARE_REFERRER_PARAM,
  SHARE_POS_PARAM,
  SHARE_CHANNEL_PARAM,
} from "@/lib/waypoints";
import { openRadarSocket } from "@/lib/realtime";
import {
  loadAnonId,
  fetchMe,
  logout,
  saveReferrer,
  loadReferrer,
  type Account,
} from "@/lib/auth";
import { reverseGeocode } from "@/lib/geocode";
import { createPermanentWaypoint, fetchPermanentConsole } from "@/lib/billing";
import { DEFAULT_RANGE, RANGE_MAP, RangeMode } from "@/lib/range";
import TopBar from "@/components/TopBar";
import RangeSelector from "@/components/RangeSelector";
import ChannelDock from "@/components/ChannelDock";
import AskBar from "@/components/AskBar";
import WaypointSheet from "@/components/WaypointSheet";
import ClusterSheet from "@/components/ClusterSheet";
import DropComposer from "@/components/DropComposer";
import LocationGate from "@/components/LocationGate";
import ClaimSheet from "@/components/ClaimSheet";
import ManageSheet from "@/components/ManageSheet";
import MyChannelsSheet from "@/components/MyChannelsSheet";

// mapbox-gl touches window → load the map client-side only
const RadarMap = dynamic(() => import("@/components/RadarMap"), { ssr: false });

// Likes buy time: each like adds 5 min to a drop's life (mirror of the server's
// LOVE_EXTENSION_SECONDS) — applied optimistically, then reconciled to the
// server's authoritative expiry.
const LOVE_EXTENSION_MS = 5 * 60 * 1000;

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
  // The open channel set (public + private the user belongs to). Seeded with the
  // static core for first paint, then replaced by the live registry.
  const [channels, setChannels] = useState<Channel[]>(CHANNELS);
  // The channels toggled on in the dock. There is no default set — the bar starts
  // empty and the user opts in to channels (their picks persist in localStorage,
  // hydrated in a mount effect below to keep SSR output deterministic). Channels
  // with live activity in the area surface as off-by-default suggestions.
  const [visible, setVisible] = useState<Set<ChannelId>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ids of the waypoints under a tapped cluster; drives the scroll-through menu.
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [loved, setLoved] = useState<Set<string>>(() => new Set());
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Anonymous account id (UUID = accounts.id) until/unless the user signs in.
  const [userId, setUserId] = useState("");
  // The signed-in account (null = anonymous). The session lives in an httpOnly
  // cookie; this is just the display state.
  const [account, setAccount] = useState<Account | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  // The permanent-waypoint management console (signed-in only).
  const [manageOpen, setManageOpen] = useState(false);
  // The private-channel management sheet (view/own channels, links, members).
  const [channelsOpen, setChannelsOpen] = useState(false);
  // Whether Stripe billing is configured on the server (gates the "Permanent ·
  // $5/mo" option in the composer). Resolved from the billing console endpoint.
  const [billingConfigured, setBillingConfigured] = useState(false);
  // Travel-mode range: how far Sonar fetches waypoints + sizes the floor radar.
  const [range, setRange] = useState<RangeMode>(DEFAULT_RANGE);
  const radiusMeters = RANGE_MAP[range].radiusMeters;
  // A shared waypoint the recipient is being guided to from out of range. While
  // set, the map shows a directional rainbow beacon instead of the pin; once the
  // user physically walks within range it's consumed (the sheet reveals). The
  // referrer is the username from the share link, shown in the guidance banner.
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    pos: LngLat;
    channel: ChannelId;
  } | null>(null);
  const [referrer, setReferrer] = useState<string | null>(null);

  // Resolve the persistent anon id + any existing session once on the client.
  // Also hydrate the user's saved channel picks here (not in the useState
  // initializer) so the server render stays deterministic and matches hydration.
  useEffect(() => {
    setUserId(loadAnonId());
    fetchMe().then(setAccount);
    setVisible(new Set(loadVisibleChannels()));
  }, []);

  // Load the open channel registry (public + private the user belongs to).
  // Re-runs when identity changes (signing in can reveal private channels).
  // Channels never auto-toggle on — the dock surfaces them as suggestions and the
  // user opts in (see toggleChannel), so we only refresh the registry here.
  function loadChannels() {
    if (!userId) return;
    fetchChannels(userId)
      .then((list) => {
        if (list.length) setChannels(list);
      })
      .catch((e) => console.error("fetchChannels", e));
  }
  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, account]);

  const channelsById = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
  // Stable string key so the fetch/socket effects re-run only when the set changes.
  const channelKey = channelIds.join(",");

  // Resolve whether billing is configured (shows the "Permanent · $5/mo" option).
  useEffect(() => {
    fetchPermanentConsole().then((c) => setBillingConfigured(c.configured));
  }, [account]);

  // Returning from Stripe Checkout (`?billing=success`) → the webhook flips the
  // pending pin to permanent asynchronously, so re-poll nearby waypoints a few
  // times to pick it up, and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    params.delete("billing");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
    if (billing !== "success") return;
    let tries = 0;
    const poll = () => {
      const c = centerRef.current;
      if (c) reloadWaypoints();
      if (++tries < 5) setTimeout(poll, 1500);
    };
    setTimeout(poll, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning from a locked-channel Checkout (`?locked=success&channel=…`): the
  // webhook activates the channel + seeds owner membership asynchronously, so
  // re-poll the channel list a few times to pick it up, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locked = params.get("locked");
    if (!locked) return;
    params.delete("locked");
    params.delete("channel");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (locked !== "success") return;
    let tries = 0;
    const poll = () => {
      loadChannels();
      if (++tries < 5) setTimeout(poll, 1500);
    };
    setTimeout(poll, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Honor an inbound share link. The link carries the waypoint id, its location
  // (`ll=lat,lng`) and channel (`c`), plus the referrer (`r`). We set it as the
  // "share target": until the user is in range it shows as a directional beacon
  // (handled below); once in range the waypoint loads and its sheet opens. The
  // referrer is remembered for set-once backend attribution on first drop/love.
  // Params are stripped from the URL so a refresh stays clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wp = params.get(SHARE_WAYPOINT_PARAM);
    const ref = params.get(SHARE_REFERRER_PARAM);
    const ll = params.get(SHARE_POS_PARAM);
    const c = params.get(SHARE_CHANNEL_PARAM);

    if (ref) {
      saveReferrer(ref);
      setReferrer(ref);
    }
    if (wp) {
      const [latS, lngS] = (ll ?? "").split(",");
      const lat = Number(latS);
      const lng = Number(lngS);
      const channel = (c || "social") as ChannelId;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // Located link → guide the user to it (beacon until in range).
        setShareTarget({ id: wp, pos: { lat, lng }, channel });
      } else {
        // Legacy/location-less link → best-effort: open it if it loads nearby.
        setSelectedId(wp);
      }
    }

    if (wp || ref || ll || c) {
      [SHARE_WAYPOINT_PARAM, SHARE_REFERRER_PARAM, SHARE_POS_PARAM, SHARE_CHANNEL_PARAM].forEach(
        (p) => params.delete(p),
      );
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "")
      );
    }
  }, []);

  // Consume the share target once the user is physically within range of it:
  // reveal the waypoint (its sheet opens when the nearby fetch includes it) and
  // drop the beacon. Re-evaluated as the user moves (center) or widens range.
  useEffect(() => {
    if (!shareTarget || !center) return;
    if (distance(center, shareTarget.pos) <= radiusMeters) {
      setSelectedId(shareTarget.id);
      setShareTarget(null);
    }
  }, [shareTarget, center, radiusMeters]);

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
    const ids = channelKey ? channelKey.split(",") : undefined;
    fetchRadar(center, ids, radiusMeters, userId || undefined)
      .then((w) => {
        if (!active) return;
        setWaypoints(w);
      })
      .catch((e) => console.error("load radar", e));
    return () => {
      active = false;
    };
  }, [center, radiusMeters, channelKey, userId]);

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
      postPresence({ lat: center.lat, lng: center.lng, anonId: userId }).catch(() => {});
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [center, userId]);

  // Hydrate loved-state: for any waypoint we haven't checked yet, ask the
  // backend which this user has already loved and seed the heart state. A ref
  // tracks checked ids so WS pushes don't re-query the whole set each time.
  const checkedLovesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return; // wait for the resolved anon id
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
  // Re-subscribes when the channel set changes (e.g. after joining a private one).
  useEffect(() => {
    const ids = channelKey ? channelKey.split(",") : CHANNELS.map((c) => c.id);
    return openRadarSocket(ids, (raw) => {
      const c = centerRef.current;
      if (!c) return; // ignore pushes until we know where the user is
      setWaypoints((prev) =>
        prev.some((w) => w.id === raw.id)
          ? prev
          : [rawToWaypoint(raw, c), ...prev]
      );
    });
  }, [channelKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const ch of channels) c[ch.id] = 0;
    for (const w of waypoints) c[w.channel] = (c[w.channel] ?? 0) + 1;
    return c;
  }, [waypoints, channels]);

  // What the dock renders: the user's toggled-on channels plus any channel with
  // live activity in the area (count > 0) as an off-by-default suggestion. Driven
  // by `counts`, so as new waypoints arrive over the socket the suggestion list
  // updates in realtime. With no picks and no nearby activity the bar is empty —
  // there is deliberately no default set of channels.
  const dockChannels = useMemo(
    () => channels.filter((ch) => visible.has(ch.id) || (counts[ch.id] ?? 0) > 0),
    [channels, visible, counts]
  );

  // Clip to the channel toggles *and* the travel-mode range, so the map agrees
  // with the radar ring no matter the source (fetch, live push, optimistic drop)
  // and reacts instantly when the range narrows — no refetch needed.
  const visibleWaypoints = useMemo(
    () =>
      waypoints.filter(
        (w) => visible.has(w.channel) && w.meters <= radiusMeters,
      ),
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
      saveVisibleChannels([...next]);
      return next;
    });
  }

  // Search-or-create a channel. Public channels join/create instantly; a locked
  // (private) channel redirects to Stripe Checkout and is usable after payment.
  async function createChannel(name: string, isPrivate: boolean) {
    if (isPrivate && !account) {
      handleRequireSignIn();
      return;
    }
    try {
      const res = await createOrJoinChannel({ name, isPrivate, anonId: userId });
      if (res.url) {
        window.location.assign(res.url); // locked channel → Checkout
        return;
      }
      const ch = res.channel;
      setChannels((prev) => (prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]));
      // Searching out a channel and joining it is an explicit opt-in, so toggle it
      // on (and persist) — unlike passive activity-based suggestions.
      setVisible((prev) => {
        const next = new Set(prev).add(ch.id);
        saveVisibleChannels([...next]);
        return next;
      });
    } catch (e) {
      console.error("createChannel", e);
      alert(e instanceof Error ? e.message : "could not create channel");
    }
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

    const args = {
      id,
      channel: wp.channel,
      lat: wp.pos.lat,
      lng: wp.pos.lng,
      anonId: userId,
      ref: loadReferrer() ?? undefined,
    };
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

  // Refetch nearby waypoints (after a checkout return or edit/delete).
  function reloadWaypoints() {
    const c = centerRef.current;
    if (!c) return;
    const ids = channelKey ? channelKey.split(",") : undefined;
    fetchRadar(c, ids, radiusMeters, userId || undefined)
      .then((w) => {
        setWaypoints(w);
      })
      .catch((e) => console.error("reload radar", e));
  }

  function drop(
    channel: ChannelId,
    kind: MediaKind,
    text: string,
    lifespanSeconds: number,
    permanent: boolean,
    mediaKey: string | undefined,
  ) {
    if (!center) return; // can't drop without a location
    if (permanent) {
      void dropPermanent({ channel, kind, text, lat: center.lat, lng: center.lng, mediaKey });
      return;
    }
    // Ephemeral drop: optimistic insert for instant feedback, then persist. The
    // optimistic copy carries no mediaUrl yet — the saved waypoint fills it in.
    const now = Date.now();
    const expiresAt = now + lifespanSeconds * 1000;
    const optimistic: Waypoint = {
      id: `drop_${now}`,
      channel,
      kind,
      author: account?.displayName ?? "you",
      text,
      pos: center,
      minutesAgo: 0,
      love: 0,
      sponsored: false,
      bearing: 0,
      meters: 0,
      expiresAt,
      lifespanMs: Math.max(1, expiresAt - now),
      mediaKey,
    };
    setWaypoints((prev) => [optimistic, ...prev]);
    setVisible((prev) => new Set(prev).add(channel));
    setComposerOpen(false);
    setSelectedId(optimistic.id);
    setRecenterSignal((s) => s + 1);

    postDrop({
      channel,
      kind,
      text,
      center,
      anonId: userId,
      lifespanSeconds,
      mediaKey,
      ref: loadReferrer() ?? undefined,
    })
      .then((saved) => {
        setWaypoints((prev) => prev.map((w) => (w.id === optimistic.id ? saved : w)));
        setSelectedId(saved.id);
      })
      .catch((e) => {
        console.error("drop", e);
        setWaypoints((prev) => prev.filter((w) => w.id !== optimistic.id));
        setSelectedId((cur) => (cur === optimistic.id ? null : cur));
      });
  }

  // A permanent ($5/mo) drop: first one goes through Stripe Checkout (redirect);
  // later ones are added one-click and returned ready to drop on the map.
  async function dropPermanent(draft: {
    channel: ChannelId;
    kind: MediaKind;
    text: string;
    lat: number;
    lng: number;
    mediaKey?: string;
  }) {
    setComposerOpen(false);
    try {
      const res = await createPermanentWaypoint(draft);
      if (res.url) {
        window.location.assign(res.url); // first-time Checkout
        return;
      }
      if (res.waypoint) {
        const wp = res.waypoint;
        setWaypoints((prev) => (prev.some((w) => w.id === wp.id) ? prev : [wp, ...prev]));
        setVisible((prev) => new Set(prev).add(wp.channel));
        setSelectedId(wp.id);
        setRecenterSignal((s) => s + 1);
      }
    } catch (e) {
      console.error("permanent drop", e);
      alert(e instanceof Error ? e.message : "could not create permanent waypoint");
    }
  }

  // A signed-out user tapped "Permanent": permanent waypoints need an account.
  function handleRequireSignIn() {
    setComposerOpen(false);
    setClaimOpen(true);
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
          channels={channels}
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
          beacon={shareTarget ? shareTarget.pos : null}
        />

        {/* Overlay chrome — tap the map to hide/show for a clean "just map" view */}
        <div
          className={`transition-opacity duration-300 ${
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <TopBar
            place={placeLabel}
            liveCount={visibleWaypoints.length}
            account={account}
            onAccountClick={() => setClaimOpen(true)}
          />

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

            <ChannelDock
              channels={dockChannels}
              active={visible}
              counts={counts}
              onToggle={toggleChannel}
              onCreateChannel={createChannel}
            />
            <AskBar waypoints={visibleWaypoints} place={placeLabel} />
          </div>
        </div>

        {/* Out-of-range share guidance — stays visible through the chrome toggle
            because it's how the recipient knows what they're walking toward. */}
        {shareTarget && (
          <div className="pointer-events-none absolute inset-x-0 top-[5.5rem] z-40 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-[20rem] items-center gap-3 rounded-2xl border border-white/12 bg-[#0a0e12]/90 px-4 py-2.5 backdrop-blur-xl">
              <span className="animate-pulse text-[20px]">🌈</span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white/90">
                  {referrer ? `@${referrer} shared a waypoint` : "A waypoint was shared with you"}
                </p>
                <p
                  className="font-mono text-[11px]"
                  style={{ color: channelMeta(shareTarget.channel, channelsById).color }}
                >
                  {formatDistance(distance(center, shareTarget.pos))} away · follow the rainbow to unlock
                </p>
              </div>
            </div>
          </div>
        )}

        {selected && (
          <WaypointSheet
            wp={selected}
            loved={loved.has(selected.id)}
            onLove={love}
            onClose={() => setSelectedId(null)}
            shareUser={account?.displayName}
            currentUserId={account?.id}
            onManage={() => {
              setSelectedId(null);
              setManageOpen(true);
            }}
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
          <DropComposer
            channels={channels}
            onDrop={drop}
            onClose={() => setComposerOpen(false)}
            billingConfigured={billingConfigured}
            signedIn={!!account}
            onRequireSignIn={handleRequireSignIn}
          />
        )}

        {claimOpen && (
          <ClaimSheet
            account={account}
            anonId={userId}
            onClose={() => setClaimOpen(false)}
            onSignedIn={(acc) => {
              setAccount(acc);
              setClaimOpen(false);
            }}
            onSignOut={async () => {
              await logout();
              setAccount(null);
              setClaimOpen(false);
            }}
            onManage={() => {
              setClaimOpen(false);
              setManageOpen(true);
            }}
            onManageChannels={() => {
              setClaimOpen(false);
              setChannelsOpen(true);
            }}
          />
        )}

        {manageOpen && (
          <ManageSheet
            here={center}
            onClose={() => setManageOpen(false)}
            onChanged={reloadWaypoints}
          />
        )}

        {channelsOpen && (
          <MyChannelsSheet
            anonId={userId}
            onClose={() => setChannelsOpen(false)}
            onChanged={loadChannels}
          />
        )}
      </div>
    </main>
  );
}
