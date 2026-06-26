import { describe, it, expect } from "vitest";
import {
  distance,
  bearing,
  offset,
  formatDistance,
  formatAge,
  type LngLat,
} from "../geo";

const SF: LngLat = { lng: -122.4194, lat: 37.7749 };
const NYC: LngLat = { lng: -74.006, lat: 40.7128 };

describe("distance (haversine)", () => {
  it("is zero between a point and itself", () => {
    expect(distance(SF, SF)).toBe(0);
  });

  it("matches the known SF<->NYC great-circle distance (~4,129 km)", () => {
    const d = distance(SF, NYC);
    expect(d).toBeGreaterThan(4_120_000);
    expect(d).toBeLessThan(4_140_000);
  });

  it("is symmetric", () => {
    expect(distance(SF, NYC)).toBeCloseTo(distance(NYC, SF), 6);
  });
});

describe("offset", () => {
  it("round-trips: offsetting then measuring returns the input distance", () => {
    const moved = offset(SF, 1000, 90);
    expect(distance(SF, moved)).toBeCloseTo(1000, 0); // within ~1m
  });

  it("moving north increases latitude; east increases longitude", () => {
    expect(offset(SF, 500, 0).lat).toBeGreaterThan(SF.lat);
    expect(offset(SF, 500, 90).lng).toBeGreaterThan(SF.lng);
  });
});

describe("bearing", () => {
  const origin: LngLat = { lng: 0, lat: 0 };
  it("reads ~0 due north and ~90 due east", () => {
    expect(bearing(origin, { lng: 0, lat: 1 })).toBeCloseTo(0, 3);
    expect(bearing(origin, { lng: 1, lat: 0 })).toBeCloseTo(90, 3);
  });
  it("always returns a value in [0, 360)", () => {
    const b = bearing(origin, { lng: -1, lat: -1 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe("formatDistance", () => {
  it("uses metres under 1km and rounded kilometres above", () => {
    expect(formatDistance(0)).toBe("0m");
    expect(formatDistance(999.4)).toBe("999m");
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(1500)).toBe("1.5km");
  });
});

describe("formatAge", () => {
  it("buckets ages into just-now / minutes / hours / days", () => {
    expect(formatAge(0.5)).toBe("just now");
    expect(formatAge(5)).toBe("5m ago");
    expect(formatAge(59)).toBe("59m ago");
    expect(formatAge(60)).toBe("1h ago");
    expect(formatAge(120)).toBe("2h ago");
    expect(formatAge(60 * 25)).toBe("1d ago");
  });
});
