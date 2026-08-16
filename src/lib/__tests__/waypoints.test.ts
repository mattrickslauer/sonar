import { describe, it, expect } from "vitest";
import { isLive } from "../waypoints";

const NOW = 1_700_000_000_000;

describe("isLive", () => {
  it("keeps a waypoint whose expiry is still ahead", () => {
    expect(isLive({ expiresAt: NOW + 60_000 }, NOW)).toBe(true);
  });

  it("drops a waypoint whose expiry has passed", () => {
    expect(isLive({ expiresAt: NOW - 1 }, NOW)).toBe(false);
  });

  it("drops a waypoint expiring exactly now", () => {
    expect(isLive({ expiresAt: NOW }, NOW)).toBe(false);
  });

  it("keeps sponsored/permanent waypoints (far-future ttl)", () => {
    const permanent = new Date("2999-01-01T00:00:00Z").getTime();
    expect(isLive({ expiresAt: permanent }, NOW)).toBe(true);
  });

  it("fails open on a corrupt expiry rather than hiding the drop", () => {
    // A bad `ttl` attribute yields NaN. Never silently disappear a real user's
    // content over a malformed number — surface it and let the ring read 0.
    expect(isLive({ expiresAt: Number.NaN }, NOW)).toBe(true);
  });
});
