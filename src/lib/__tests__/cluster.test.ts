import { describe, it, expect } from "vitest";
import { clusterWaypoints, clusterRadius, CLUSTER_PX } from "../cluster";
import type { Waypoint } from "../waypoints";

// Place a waypoint directly in pixel space via its pos, then use an identity
// projector — clustering only cares about screen distances, so this lets us test
// the grouping geometry without a real Mapbox projection.
function pixelWaypoint(id: string, x: number, y: number): Waypoint {
  return {
    id,
    channel: "social",
    kind: "text",
    author: "t",
    text: "",
    pos: { lng: x, lat: y },
    minutesAgo: 0,
    love: 0,
    sponsored: false,
    bearing: 0,
    meters: 0,
    expiresAt: 0,
    lifespanMs: 1,
  };
}
const project = (wp: Waypoint) => ({ x: wp.pos.lng, y: wp.pos.lat });

describe("clusterWaypoints", () => {
  it("leaves well-separated points as singles", () => {
    const wps = [pixelWaypoint("a", 0, 0), pixelWaypoint("b", 100, 0)];
    const { singles, clusters } = clusterWaypoints(wps, project);
    expect(clusters).toHaveLength(0);
    expect(singles.map((w) => w.id).sort()).toEqual(["a", "b"]);
  });

  it("merges two overlapping points into one cluster with a stable id + centroid", () => {
    const wps = [pixelWaypoint("b", 10, 0), pixelWaypoint("a", 0, 0)];
    const { singles, clusters } = clusterWaypoints(wps, project);
    expect(singles).toHaveLength(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].waypoints).toHaveLength(2);
    // id is derived from sorted member ids -> order-independent / stable.
    expect(clusters[0].id).toBe("cl:a,b");
    expect(clusters[0].lng).toBeCloseTo(5, 6);
    expect(clusters[0].lat).toBeCloseTo(0, 6);
  });

  it("groups transitively (single-link chain) even when the ends don't overlap", () => {
    // A-B and B-C are within CLUSTER_PX, but A-C is not; all three should merge.
    const step = CLUSTER_PX - 1;
    const wps = [
      pixelWaypoint("a", 0, 0),
      pixelWaypoint("b", step, 0),
      pixelWaypoint("c", step * 2, 0),
    ];
    const { singles, clusters } = clusterWaypoints(wps, project);
    expect(singles).toHaveLength(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].waypoints).toHaveLength(3);
  });

  it("treats points just past the threshold as separate", () => {
    const wps = [pixelWaypoint("a", 0, 0), pixelWaypoint("b", CLUSTER_PX + 1, 0)];
    const { singles, clusters } = clusterWaypoints(wps, project);
    expect(clusters).toHaveLength(0);
    expect(singles).toHaveLength(2);
  });
});

describe("clusterRadius", () => {
  it("ramps linearly from the base size and caps at 34", () => {
    expect(clusterRadius(1)).toBe(16);
    expect(clusterRadius(2)).toBe(19);
    expect(clusterRadius(3)).toBe(22);
    expect(clusterRadius(1000)).toBe(34); // capped
  });

  it("is monotonically non-decreasing in count", () => {
    let prev = -Infinity;
    for (let c = 1; c <= 50; c++) {
      const r = clusterRadius(c);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});
