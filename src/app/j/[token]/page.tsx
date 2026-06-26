"use client";

// Join-link landing page (/j/<token>). An anonymous or signed-in visitor confirms
// they want to join a private channel, optionally names themselves (so they don't
// show up as "you"), and on Join is added and dropped onto the map with the channel
// toggled on. The live channel id is never shown — only revealed after joining.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { loadAnonId } from "@/lib/auth";
import {
  fetchJoinPreview,
  joinViaToken,
  loadVisibleChannels,
  saveVisibleChannels,
  type JoinPreview,
} from "@/lib/channels.client";

type Params = Promise<{ token: string }>;

export default function JoinPage({ params }: { params: Params }) {
  const { token } = use(params);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let active = true;
    const anonId = loadAnonId();
    fetchJoinPreview(token, anonId)
      .then((p) => active && setPreview(p))
      .catch((e) => active && setError(e instanceof Error ? e.message : "invalid link"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  // Add the channel id to the saved "toggled on" set, then go to the map. The map
  // hydrates that set on mount, so the channel appears active straight away.
  function goToChannel(channelId: string) {
    const visible = loadVisibleChannels();
    if (!visible.includes(channelId)) saveVisibleChannels([...visible, channelId]);
    window.location.assign("/");
  }

  async function join() {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const channelId = await joinViaToken(token, {
        anonId: loadAnonId(),
        displayName: name.trim() || undefined,
      });
      goToChannel(channelId);
    } catch (e) {
      setJoining(false);
      setError(e instanceof Error ? e.message : "could not join");
    }
  }

  return (
    <main className="flex min-h-dvh w-full items-stretch justify-center bg-black sm:items-center">
      <div className="relative flex h-dvh w-full max-w-md flex-col items-center justify-center overflow-hidden bg-background px-6 sm:h-[860px] sm:max-h-[94vh] sm:rounded-[2.5rem] sm:border sm:border-white/10 sm:shadow-2xl">
        {/* Radar-ring brand mark */}
        <span className="relative mb-8 flex h-14 w-14 items-center justify-center">
          <span className="absolute h-14 w-14 rounded-full border border-sonar/25" />
          <span className="absolute h-9 w-9 rounded-full border border-sonar/45" />
          <span className="absolute inline-flex h-3.5 w-3.5 animate-ping rounded-full bg-sonar/70" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-sonar" />
        </span>

        {loading ? (
          <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-white/40">
            checking link…
          </p>
        ) : error && !preview ? (
          <div className="text-center">
            <p className="mb-2 text-[17px] font-semibold text-white">Link unavailable</p>
            <p className="mb-6 text-[13px] leading-relaxed text-white/55">{error}</p>
            <Link
              href="/"
              className="inline-block rounded-2xl border border-white/12 bg-black/55 px-5 py-3 text-[14px] font-semibold text-white/85"
            >
              Open Sonar
            </Link>
          </div>
        ) : preview ? (
          <div className="w-full">
            <div className="mb-6 flex flex-col items-center text-center">
              <span
                className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl text-[34px]"
                style={{
                  backgroundColor: `${preview.channel.color}1f`,
                  border: `1px solid ${preview.channel.color}55`,
                }}
              >
                {preview.channel.emoji}
              </span>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                {preview.alreadyMember ? "you're in" : "private channel invite"}
              </p>
              <h1 className="mt-1 text-[22px] font-bold text-white">{preview.channel.label}</h1>
            </div>

            {preview.alreadyMember ? (
              <button
                onClick={() => window.location.assign("/")}
                className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c]"
              >
                Open the channel
              </button>
            ) : (
              <>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  your name <span className="text-white/25">(optional)</span>
                </p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  maxLength={48}
                  placeholder="how others see you"
                  className="mb-4 w-full rounded-2xl border border-white/12 bg-black/40 p-3.5 text-[14px] text-white placeholder:text-white/35 focus:border-sonar/50 focus:outline-none"
                />

                {error && (
                  <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                    {error}
                  </p>
                )}

                <button
                  onClick={join}
                  disabled={joining}
                  className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
                >
                  {joining ? "Joining…" : "Join channel"}
                </button>
                <p className="mt-4 text-center text-[12px] leading-relaxed text-white/45">
                  You&apos;ll join anonymously — claim an account later to keep access
                  across devices.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
