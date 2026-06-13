// Range modes: how far out Sonar listens. Three numbered tiers (1/2/3) each map
// to a fetch radius (metres) — the distance within which waypoints are pulled
// and shown, and the size of the range ring drawn on the map. Radii stay within
// the gh6 "cell + 8 neighbours" query footprint (~1.8km reach) so every tier
// fetches real data with no extra cells.
export type RangeMode = "1" | "2" | "3";

export interface RangeOption {
  id: RangeMode;
  label: string;
  radiusMeters: number;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { id: "1", label: "1", radiusMeters: 500 },
  { id: "2", label: "2", radiusMeters: 1_000 },
  { id: "3", label: "3", radiusMeters: 1_500 },
];

export const RANGE_MAP: Record<RangeMode, RangeOption> = RANGE_OPTIONS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<RangeMode, RangeOption>,
);

// Tier 2 is the sensible default: wide enough to feel alive, tight enough that
// the range ring reads as a deliberate boundary rather than the whole city.
export const DEFAULT_RANGE: RangeMode = "2";
