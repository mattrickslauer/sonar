import { describe, it, expect } from "vitest";
import {
  encodeGeohash,
  geohashNeighbors,
  cellAndNeighbors,
} from "../geohash";

describe("encodeGeohash", () => {
  it("matches the canonical reference encoding", () => {
    // The textbook geohash example: 57.64911, 10.40744 -> "u4pruydqqvj".
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(encodeGeohash(57.64911, 10.40744, 6)).toBe("u4pruy");
  });

  it("defaults to precision 6 and honors the precision argument", () => {
    expect(encodeGeohash(37.7749, -122.4194)).toHaveLength(6);
    expect(encodeGeohash(37.7749, -122.4194, 9)).toHaveLength(9);
  });

  it("is a prefix code: a longer hash extends the shorter one", () => {
    const p6 = encodeGeohash(51.5007, -0.1246, 6);
    const p9 = encodeGeohash(51.5007, -0.1246, 9);
    expect(p9.startsWith(p6)).toBe(true);
  });

  it("puts nearby points in the same gh6 cell and far points in different cells", () => {
    const a = encodeGeohash(40.7128, -74.006, 6);
    const aNudge = encodeGeohash(40.7129, -74.0061, 6); // ~15m away
    const far = encodeGeohash(34.0522, -118.2437, 6); // Los Angeles
    expect(aNudge).toBe(a);
    expect(far).not.toBe(a);
  });
});

describe("geohashNeighbors / cellAndNeighbors", () => {
  const center = encodeGeohash(40.7128, -74.006, 6);

  it("returns 8 distinct neighbors, none equal to the center", () => {
    const neighbors = geohashNeighbors(center);
    expect(neighbors).toHaveLength(8);
    expect(new Set(neighbors).size).toBe(8);
    expect(neighbors).not.toContain(center);
  });

  it("keeps all neighbors at the same precision", () => {
    for (const n of geohashNeighbors(center)) {
      expect(n).toHaveLength(center.length);
    }
  });

  it("adjacency is symmetric: each cardinal neighbor lists the center back", () => {
    // N/S/E/W are the first four entries; the center must be among each one's
    // own neighbor set. This catches edge/border-table bugs.
    const [n, s, e, w] = geohashNeighbors(center);
    for (const adj of [n, s, e, w]) {
      expect(geohashNeighbors(adj)).toContain(center);
    }
  });

  it("cellAndNeighbors yields the center plus 8 unique neighbors (9 total)", () => {
    const cells = cellAndNeighbors(40.7128, -74.006, 6);
    expect(cells).toHaveLength(9);
    expect(new Set(cells).size).toBe(9);
    expect(cells).toContain(center);
  });
});
