"use client";

/**
 * Decorative sonar HUD: concentric range rings + a rotating sweep, locked to the
 * viewport centre (where the user marker sits on load). Non-interactive — the map
 * pans freely underneath.
 */
export default function RadarSweep() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
      <div className="relative aspect-square w-[min(135vw,135vh)]">
        {/* range rings */}
        {[0.3, 0.55, 0.8, 1].map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full border"
            style={{
              inset: `${(1 - s) * 50}%`,
              borderColor: "var(--grid)",
              boxShadow: i === 3 ? "0 0 40px rgba(52,227,160,.08) inset" : undefined,
            }}
          />
        ))}
        {/* cross hairs */}
        <div
          className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
          style={{ background: "var(--grid)" }}
        />
        <div
          className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2"
          style={{ background: "var(--grid)" }}
        />
        {/* rotating sweep — faint, lets the map read through */}
        <div
          className="animate-sweep absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(52,227,160,0) 0deg, rgba(52,227,160,0) 312deg, rgba(52,227,160,.04) 350deg, rgba(52,227,160,.13) 360deg)",
            maskImage:
              "radial-gradient(circle, #000 0%, rgba(0,0,0,.85) 55%, transparent 72%)",
            WebkitMaskImage:
              "radial-gradient(circle, #000 0%, rgba(0,0,0,.85) 55%, transparent 72%)",
          }}
        />
      </div>
      {/* subtle edge vignette — keeps chrome legible without hiding the map */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 46%, transparent 62%, rgba(5,7,10,.34) 100%)",
        }}
      />
    </div>
  );
}
