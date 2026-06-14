"use client";

import { useEffect, useState } from "react";
import { CHANNELS, CHANNEL_MAP, ChannelId } from "@/lib/channels";
import { LngLat } from "@/lib/geo";
import { Waypoint } from "@/lib/waypoints";
import {
  fetchPermanentConsole,
  updatePermanentWaypoint,
  deletePermanentWaypoint,
  openBillingPortal,
  type PermanentSubscription,
} from "@/lib/billing";

interface Props {
  /** The user's current location, used by "Move here". */
  here: LngLat | null;
  onClose: () => void;
  /** Called after any change so the map can refresh its waypoints. */
  onChanged?: () => void;
}

function renewLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ManageSheet({ here, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [sub, setSub] = useState<PermanentSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editChannel, setEditChannel] = useState<ChannelId>("social");
  const [editMoved, setEditMoved] = useState(false);

  async function reload() {
    const c = await fetchPermanentConsole();
    setWaypoints(c.waypoints);
    setSub(c.subscription);
    setLoading(false);
  }
  useEffect(() => {
    reload();
  }, []);

  const count = waypoints.length;
  const monthly = sub ? (count * sub.unitAmount) / 100 : count * 5;

  function startEdit(wp: Waypoint) {
    setEditingId(wp.id);
    setEditText(wp.text);
    setEditChannel(wp.channel);
    setEditMoved(false);
    setError(null);
  }

  async function saveEdit(wp: Waypoint) {
    setBusyId(wp.id);
    setError(null);
    try {
      const patch: { text?: string; channel?: ChannelId; lat?: number; lng?: number } = {};
      if (editText.trim() && editText.trim() !== wp.text) patch.text = editText.trim();
      if (editChannel !== wp.channel) patch.channel = editChannel;
      if (editMoved && here) {
        patch.lat = here.lat;
        patch.lng = here.lng;
      }
      if (Object.keys(patch).length > 0) {
        await updatePermanentWaypoint(wp.id, patch);
        await reload();
        onChanged?.();
      }
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "edit failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(wp: Waypoint) {
    if (!confirm("Delete this permanent waypoint? This cancels its $5/mo charge.")) return;
    setBusyId(wp.id);
    setError(null);
    try {
      await deletePermanentWaypoint(wp.id);
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-end bg-black/50 backdrop-blur-sm">
      <div className="animate-sheet flex max-h-[85%] w-full flex-col rounded-t-3xl border-t border-white/12 bg-[#0a0e12] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">Permanent waypoints</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        {/* Subscription summary */}
        <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
            your subscription
          </p>
          <p className="mt-1 text-[15px] font-semibold text-white">
            {count} permanent {count === 1 ? "waypoint" : "waypoints"} · ${monthly}/mo
          </p>
          <p className="mt-0.5 text-[12px] text-white/45">
            $5/mo each{sub?.currentPeriodEnd ? ` · renews ${renewLabel(sub.currentPeriodEnd)}` : ""}
          </p>
          {count > 0 && (
            <button
              onClick={() => openBillingPortal().catch((e) => setError(e.message))}
              className="mt-3 w-full rounded-xl border border-white/12 bg-black/55 py-2.5 text-[13px] font-semibold text-white/85"
            >
              Manage billing
            </button>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            {error}
          </p>
        )}

        {/* Waypoint list */}
        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-white/40">Loading…</p>
          ) : count === 0 ? (
            <p className="py-6 text-center text-[13px] text-white/40">
              No permanent waypoints yet. Drop one and choose “Permanent · $5/mo”.
            </p>
          ) : (
            waypoints.map((wp) => {
              const ch = CHANNEL_MAP[wp.channel];
              const editing = editingId === wp.id;
              const busy = busyId === wp.id;
              return (
                <div
                  key={wp.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-3"
                >
                  {!editing ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: `${ch.color}22`, color: ch.color }}
                        >
                          {ch.emoji} {ch.label}
                        </span>
                        <p className="mt-1 truncate text-[14px] text-white">{wp.text || "—"}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => startEdit(wp)}
                          disabled={busy}
                          className="rounded-full border border-white/12 px-2.5 py-1 text-[11px] text-white/70 disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(wp)}
                          disabled={busy}
                          className="rounded-full border border-red-400/30 px-2.5 py-1 text-[11px] text-red-300 disabled:opacity-40"
                        >
                          {busy ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="mb-2 w-full resize-none rounded-xl border border-white/12 bg-black/40 p-2.5 text-[13px] text-white focus:border-sonar/50 focus:outline-none"
                      />
                      <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
                        {CHANNELS.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setEditChannel(c.id)}
                            className="shrink-0 rounded-full border px-2.5 py-1 text-[12px]"
                            style={{
                              borderColor: editChannel === c.id ? c.color : "rgba(255,255,255,.12)",
                              background: editChannel === c.id ? `${c.color}22` : "transparent",
                              color: editChannel === c.id ? "#fff" : "rgba(255,255,255,.6)",
                            }}
                          >
                            {c.emoji} {c.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setEditMoved((v) => !v)}
                        disabled={!here}
                        className="mb-2 w-full rounded-xl border py-2 text-[12px] disabled:opacity-40"
                        style={{
                          borderColor: editMoved ? "var(--sonar)" : "rgba(255,255,255,.12)",
                          background: editMoved ? "rgba(52,227,160,.12)" : "transparent",
                          color: editMoved ? "#fff" : "rgba(255,255,255,.6)",
                        }}
                      >
                        {editMoved ? "✓ will move to your current location" : "Move here (your location)"}
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 rounded-xl border border-white/12 py-2 text-[13px] text-white/70"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(wp)}
                          disabled={busy}
                          className="flex-1 rounded-xl bg-sonar py-2 text-[13px] font-semibold text-[#04110c] disabled:opacity-40"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
