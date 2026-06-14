import { describe, it, expect } from "vitest";
import {
  RANGE_OPTIONS,
  RANGE_MAP,
  DEFAULT_RANGE,
  type RangeMode,
} from "../range";

describe("range options", () => {
  it("defines three tiers with strictly increasing radii", () => {
    expect(RANGE_OPTIONS).toHaveLength(3);
    const radii = RANGE_OPTIONS.map((r) => r.radiusMeters);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
  });

  it("keeps every radius within the gh6 'cell + 8 neighbours' footprint (~1.8km)", () => {
    // The module comment promises radii stay inside the single-query reach so no
    // tier needs to fetch extra cells; lock that invariant.
    for (const r of RANGE_OPTIONS) {
      expect(r.radiusMeters).toBeLessThanOrEqual(1800);
    }
  });

  it("RANGE_MAP has an entry for every option id", () => {
    for (const r of RANGE_OPTIONS) {
      expect(RANGE_MAP[r.id]).toEqual(r);
    }
    expect(Object.keys(RANGE_MAP)).toHaveLength(RANGE_OPTIONS.length);
  });

  it("the default range is a real, mapped tier", () => {
    expect(RANGE_MAP[DEFAULT_RANGE]).toBeDefined();
    const ids: RangeMode[] = RANGE_OPTIONS.map((r) => r.id);
    expect(ids).toContain(DEFAULT_RANGE);
  });
});
