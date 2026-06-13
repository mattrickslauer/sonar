// A tiny Web Audio chime for "a new waypoint just appeared" — synthesized at
// runtime so there's no audio asset to ship or decode. Browsers start an
// AudioContext suspended until a user gesture, so we lazily create it and prime
// it on the first interaction (see primeAudio).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Unlock audio on the first user gesture (contexts start suspended). */
export function primeAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

/** A soft two-note "ti-ling" chime. Quiet, fast attack, exponential decay. */
export function playChime(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});

  const now = c.currentTime;
  // A rising major third (B5 → E6) reads as a gentle, optimistic "ping".
  const notes = [
    { freq: 987.77, at: 0 },
    { freq: 1318.51, at: 0.085 },
  ];
  for (const n of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const t = now + n.at;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  }
}
