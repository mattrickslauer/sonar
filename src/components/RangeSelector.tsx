"use client";

import { RANGE_OPTIONS, RangeMode } from "@/lib/range";
import { formatDistance } from "@/lib/geo";

interface Props {
  active: RangeMode;
  onChange: (mode: RangeMode) => void;
}

// Segmented range control: three numbered tiers (1/2/3). Each sets how far
// Sonar fetches waypoints and how large the floor radar reads on the map.
export default function RangeSelector({ active, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Range"
      className="pointer-events-auto flex items-center gap-1 self-center rounded-full border border-white/12 bg-black/55 p-1 backdrop-blur-md"
    >
      {RANGE_OPTIONS.map((opt) => {
        const selected = opt.id === active;
        return (
          <button
            key={opt.id}
            role="radio"
            aria-checked={selected}
            aria-label={`Range ${opt.label} · ${formatDistance(opt.radiusMeters)}`}
            onClick={() => onChange(opt.id)}
            className={`flex h-8 w-9 items-center justify-center rounded-full text-[14px] font-semibold transition-colors ${
              selected
                ? "bg-sonar text-[#04110c]"
                : "text-white/70 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
