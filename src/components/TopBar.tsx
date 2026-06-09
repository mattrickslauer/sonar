"use client";

interface Props {
  place: string;
  liveCount: number;
}

export default function TopBar({ place, liveCount }: Props) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/45 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold tracking-tight text-sonar">
            sonar
          </span>
          <span className="h-3 w-px bg-white/15" />
          <span className="text-[13px] font-medium text-white/85">{place}</span>
        </div>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
          last 24h · earned permanence
        </p>
      </div>

      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-sonar/30 bg-sonar/10 px-3 py-1.5 backdrop-blur-md">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sonar opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sonar" />
        </span>
        <span className="font-mono text-[12px] font-semibold text-sonar">
          {liveCount} live
        </span>
      </div>
    </header>
  );
}
