import { Waypoint } from "./waypoints";

/** A point projected to the map's screen pixel space. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** A group of waypoints that overlap on screen, drawn as one bigger circle. */
export interface Cluster {
  /** Stable id derived from the sorted member ids — same membership ⇒ same id. */
  id: string;
  waypoints: Waypoint[];
  /** Centroid (lng/lat) where the cluster marker is pinned. */
  lng: number;
  lat: number;
}

// Proximity trigger: markers whose centers fall within this many screen pixels
// are treated as overlapping. The dot is 30px wide, so ~24px of center spacing
// means the two circles visibly cover each other and can't be tapped apart.
export const CLUSTER_PX = 24;

// Quantity trigger: a cluster only forms once this many waypoints pile up in the
// proximity radius. Two stacked pins is already untappable, so the floor is 2.
export const MIN_CLUSTER = 2;

/**
 * Group waypoints that overlap in screen space. `project` maps a waypoint to its
 * current pixel position (caller supplies `map.project`, which already accounts
 * for zoom/pitch/bearing). Returns the loners to draw as normal pins plus the
 * clusters to draw as one combined circle.
 *
 * Grouping is transitive (single-link / BFS) so a chain of overlapping pins
 * collapses into one cluster rather than leaving stragglers poking out.
 */
export function clusterWaypoints(
  waypoints: Waypoint[],
  project: (wp: Waypoint) => PixelPoint,
): { singles: Waypoint[]; clusters: Cluster[] } {
  const pts = waypoints.map((wp) => ({ wp, px: project(wp) }));
  const used = new Array(pts.length).fill(false);
  const r2 = CLUSTER_PX * CLUSTER_PX;
  const singles: Waypoint[] = [];
  const clusters: Cluster[] = [];

  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const group = [pts[i]];
    // BFS: absorb any unused point within the radius of any point already in the
    // group, so transitively-overlapping pins merge.
    for (let head = 0; head < group.length; head++) {
      const a = group[head].px;
      for (let j = 0; j < pts.length; j++) {
        if (used[j]) continue;
        const dx = a.x - pts[j].px.x;
        const dy = a.y - pts[j].px.y;
        if (dx * dx + dy * dy <= r2) {
          used[j] = true;
          group.push(pts[j]);
        }
      }
    }

    if (group.length >= MIN_CLUSTER) {
      clusters.push(makeCluster(group.map((g) => g.wp)));
    } else {
      singles.push(group[0].wp);
    }
  }

  return { singles, clusters };
}

function makeCluster(waypoints: Waypoint[]): Cluster {
  const ids = waypoints.map((w) => w.id).sort();
  let lng = 0;
  let lat = 0;
  for (const w of waypoints) {
    lng += w.pos.lng;
    lat += w.pos.lat;
  }
  return {
    id: `cl:${ids.join(",")}`,
    waypoints,
    lng: lng / waypoints.length,
    lat: lat / waypoints.length,
  };
}

// Linear size ramp: the combined circle grows with the number of pins it hides,
// from ~36px (a pair) up to a 68px cap so dense piles stay legible.
export function clusterRadius(count: number): number {
  return Math.min(34, 16 + 3 * (count - 1));
}
