import { describe, it, expect } from "vitest";
import { CHANNELS, CHANNEL_MAP, type ChannelId } from "../channels";

const EXPECTED_IDS: ChannelId[] = ["general", "events", "food", "music", "social", "safety"];

describe("channel config", () => {
  it("defines exactly the expected channel ids", () => {
    expect(CHANNELS.map((c) => c.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("CHANNEL_MAP resolves every channel and only those", () => {
    for (const c of CHANNELS) {
      expect(CHANNEL_MAP[c.id]).toBe(c);
    }
    expect(Object.keys(CHANNEL_MAP)).toHaveLength(CHANNELS.length);
  });

  it("every channel carries a label, emoji, and hex colour", () => {
    for (const c of CHANNELS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("only 'safety' is flagged private (input validation must enforce this)", () => {
    // Documents the contract the /api/waypoints route should honour: safety is
    // the lone private channel.
    expect(CHANNEL_MAP.safety.private).toBe(true);
    for (const c of CHANNELS) {
      if (c.id !== "safety") expect(c.private).toBeFalsy();
    }
  });
});
