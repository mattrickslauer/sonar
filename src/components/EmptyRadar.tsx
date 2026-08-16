"use client";

/**
 * What the radar shows when it shows nothing.
 *
 * Sonar used to paper over quiet areas with bot drops, so this state could not
 * happen. It can now, and it is the honest one: a real place with no signal in
 * it. Two causes, two different things for the reader to do:
 *
 *  - "quiet"    — nothing is in range. The area really is empty; the invitation
 *                 is to be the first drop, or to reach further.
 *  - "filtered" — drops ARE in range, but every one of them sits on a channel
 *                 the reader switched off. Nothing to write; something to undo.
 *
 * Deliberately an overlay, never a takeover: the map is the product, so this
 * floats in the dead space between the top bar and the controls and stays
 * `pointer-events-none` apart from its one button. It also lives inside the
 * chrome wrapper, so tapping the map into "just map" view fades it out too.
 */

interface Props {
  mode: "quiet" | "filtered";
  /** Human range label ("300m", "1.2km") — the reach that came back empty. */
  rangeLabel: string;
  /** Drops in range but hidden by the channel toggles. `filtered` mode only. */
  hiddenCount: number;
  /** Re-enable exactly the channels that are hiding in-range drops. */
  onShowHidden: () => void;
}

export default function EmptyRadar({
  mode,
  rangeLabel,
  hiddenCount,
  onShowHidden,
}: Props) {
  const filtered = mode === "filtered";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] bottom-[14rem] z-20 flex items-center justify-center px-8">
      <div className="flex flex-col items-center gap-5 text-center">
        {/* The LocationGate sweep, at rest. Same rings, no sweep arc and no hard
            glow: a radar that finished looking and found nothing to draw. */}
        <div className="relative flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-sonar/15" />
          <span className="absolute inset-[0.6rem] rounded-full border border-sonar/10" />
          <span className="relative h-2 w-2 rounded-full bg-sonar/50 motion-safe:animate-pulse [animation-duration:2.8s]" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold text-white">
            {filtered ? "Hidden by your channels" : "Nothing on the radar"}
          </h2>
          <p className="mx-auto max-w-[17rem] text-[13px] leading-relaxed text-white/50">
            {filtered
              ? `Every drop within ${rangeLabel} is on a channel you've switched off.`
              : `No one has dropped anything within ${rangeLabel}. Widen your range, or leave the first one.`}
          </p>
        </div>

        {filtered && (
          <button
            onClick={onShowHidden}
            className="pointer-events-auto rounded-full border border-white/12 bg-black/55 px-4 py-2 text-[13px] font-medium text-sonar backdrop-blur-md"
          >
            Show {hiddenCount} hidden {hiddenCount === 1 ? "drop" : "drops"}
          </button>
        )}
      </div>
    </div>
  );
}
