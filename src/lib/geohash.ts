// Geohash encode + neighbor lookup. Server-side; mirrors the encoder in
// infra/scripts/waypoint.mjs and powers the "my cell + 8 neighbors" query.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let idx = 0, bit = 0, even = true, hash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx = idx * 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

// Standard geohash adjacency tables (Davis).
const NEIGHBOR = {
  n: ["p0r21436x8zb9dcf5h7kjnmqesgutwvy", "bc01fg45238967deuvhjyznpkmstqrwx"],
  s: ["14365h7k9dcfesgujnmqp0r2twvyx8zb", "238967debc01fg45kmstqrwxuvhjyznp"],
  e: ["bc01fg45238967deuvhjyznpkmstqrwx", "p0r21436x8zb9dcf5h7kjnmqesgutwvy"],
  w: ["238967debc01fg45kmstqrwxuvhjyznp", "14365h7k9dcfesgujnmqp0r2twvyx8zb"],
} as const;
const BORDER = {
  n: ["prxz", "bcfguvyz"],
  s: ["028b", "0145hjnp"],
  e: ["bcfguvyz", "prxz"],
  w: ["0145hjnp", "028b"],
} as const;

function adjacent(geohash: string, dir: "n" | "s" | "e" | "w"): string {
  geohash = geohash.toLowerCase();
  const last = geohash.charAt(geohash.length - 1);
  let parent = geohash.slice(0, -1);
  const type = geohash.length % 2; // 0 even, 1 odd
  if (BORDER[dir][type].indexOf(last) !== -1 && parent !== "") {
    parent = adjacent(parent, dir);
  }
  return parent + BASE32[NEIGHBOR[dir][type].indexOf(last)];
}

/** The 8 geohash cells surrounding `geohash`, at the same precision. */
export function geohashNeighbors(geohash: string): string[] {
  const n = adjacent(geohash, "n");
  const s = adjacent(geohash, "s");
  const e = adjacent(geohash, "e");
  const w = adjacent(geohash, "w");
  return [n, s, e, w, adjacent(n, "e"), adjacent(n, "w"), adjacent(s, "e"), adjacent(s, "w")];
}

/** The query cell plus its 8 neighbors (deduped). */
export function cellAndNeighbors(lat: number, lng: number, precision = 6): string[] {
  const center = encodeGeohash(lat, lng, precision);
  return [...new Set([center, ...geohashNeighbors(center)])];
}

/** Decode a geohash back to the CENTER lat/lng of its cell. Inverse of
 *  encodeGeohash; used to position a tag zone (keyed by gh6) on the radar. */
export function decodeGeohash(hash: string): { lat: number; lng: number } {
  let even = true;
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  for (const ch of hash.toLowerCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) continue;
    for (let bit = 4; bit >= 0; bit--) {
      const b = (idx >> bit) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (b) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (b) latMin = mid; else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lng: (lonMin + lonMax) / 2 };
}
