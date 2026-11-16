import { describe, expect, it } from "vitest";
import {
  bearerKey,
  generateApiKey,
  hashApiKey,
  hourStamp,
  InputError,
  isTenantMediaKey,
  keyLabel,
  makePostId,
  minuteStamp,
  parseFeedQuery,
  parseNewPost,
  parsePostId,
  ulid,
} from "../core";
import { encodeGeohash } from "@/lib/geohash";
import { blockedLabels } from "../moderation";

const PUQ = { lat: -53.1625, lng: -70.9081 };
const photoKey = "tenants/puq/" + "a".repeat(32) + ".jpg";
const base = { user: { id: "citizen_42", name: "Ana" }, channel: "claims", ...PUQ };

describe("API keys", () => {
  it("are sk_live_ + 32 lowercase alphanumerics, unique, and parse from a bearer header", () => {
    const a = generateApiKey();
    expect(a).toMatch(/^sk_live_[a-z0-9]{32}$/);
    expect(generateApiKey()).not.toBe(a);
    expect(bearerKey(`Bearer ${a}`)).toBe(a);
    expect(bearerKey(`bearer   ${a}`)).toBe(a);
  });

  it("rejects missing, malformed or non-bearer headers", () => {
    expect(bearerKey(null)).toBeNull();
    expect(bearerKey("Bearer sk_live_short")).toBeNull();
    expect(bearerKey(`Basic ${generateApiKey()}`)).toBeNull();
  });

  it("are stored as a stable sha-256 and labelled by their first 12 chars", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(keyLabel(key)).toBe(key.slice(0, 12));
  });
});

describe("post ids", () => {
  it("carry the geohash cell, so the partition is recoverable from the id", () => {
    const gh6 = encodeGeohash(PUQ.lat, PUQ.lng, 6);
    const id = ulid();
    const postId = makePostId(gh6, id);
    expect(parsePostId(postId)).toEqual({ gh6, ulid: id });
  });

  it("reject anything else", () => {
    expect(parsePostId("wp_abc")).toBeNull();
    expect(parsePostId("WP#01ABC")).toBeNull();
    expect(parsePostId(`wp_aaaaaa${"I".repeat(26)}`)).toBeNull(); // I is not Crockford base32
  });
});

describe("parseNewPost", () => {
  it("accepts a photo post on a place and fills the geohash and 24h default", () => {
    const p = parseNewPost("puq", { ...base, kind: "photo", mediaKey: photoKey, place: "shop:cafe-tapiz", meta: { reward: 12 } });
    expect(p).toMatchObject({ kind: "photo", place: "shop:cafe-tapiz", lifespan: 86400, gh6: encodeGeohash(PUQ.lat, PUQ.lng, 6) });
  });

  it("makes a permanent pin only with a sponsor", () => {
    expect(parseNewPost("puq", { ...base, text: "Drop", lifespan: "permanent", sponsor: "Café Tapiz" })).toMatchObject({ lifespan: null, sponsor: "Café Tapiz" });
    expect(() => parseNewPost("puq", { ...base, text: "Drop", lifespan: "permanent" })).toThrow(InputError);
    expect(() => parseNewPost("puq", { ...base, text: "x", sponsor: "Café" })).toThrow(/permanent/);
  });

  it("keeps a tenant to its own media keys", () => {
    expect(isTenantMediaKey("puq", photoKey)).toBe(true);
    expect(isTenantMediaKey("other", photoKey)).toBe(false);
    expect(() => parseNewPost("other", { ...base, kind: "photo", mediaKey: photoKey })).toThrow(/mediaKey/);
    expect(() => parseNewPost("puq", { ...base, kind: "photo", mediaKey: "media/food/" + "a".repeat(32) + ".jpg" })).toThrow(/mediaKey/);
  });

  it("rejects bad input", () => {
    expect(() => parseNewPost("puq", { ...base, text: "" })).toThrow(/needs text/);
    expect(() => parseNewPost("puq", { ...base, text: "x", user: { id: "a" } })).toThrow(/user.name/);
    expect(() => parseNewPost("puq", { ...base, text: "x", channel: "Food!" })).toThrow(/channel/);
    expect(() => parseNewPost("puq", { ...base, text: "x", lat: 91 })).toThrow(/lat/);
    expect(() => parseNewPost("puq", { ...base, text: "x", lifespan: 60 })).toThrow(/lifespan/);
    expect(() => parseNewPost("puq", { ...base, text: "x", meta: { big: "x".repeat(3000) } })).toThrow(/meta/);
    expect(() => parseNewPost("puq", { ...base, text: "x", meta: [1] })).toThrow(/meta/);
  });
});

describe("parseFeedQuery", () => {
  const q = (s: string) => parseFeedQuery(new URLSearchParams(s));

  it("reads a place wall", () => {
    expect(q("place=shop:cafe-tapiz&limit=10&user=citizen_42")).toEqual({ by: "place", place: "shop:cafe-tapiz", channels: undefined, limit: 10, user: "citizen_42" });
  });

  it("reads nearby with a default and capped radius", () => {
    expect(q("lat=-53.16&lng=-70.91&channel=claims,food")).toMatchObject({ by: "near", radius: 1800, channels: ["claims", "food"], limit: 50 });
    expect(() => q("lat=-53.16&lng=-70.91&radius=5000")).toThrow(/radius/);
  });

  it("needs a place or coordinates", () => {
    expect(() => q("")).toThrow(/place, or lat/);
    expect(() => q("lat=x&lng=1")).toThrow(/lat/);
    expect(() => q("place=a&limit=0")).toThrow(/limit/);
  });
});

describe("stamps", () => {
  it("are UTC hour and minute buckets", () => {
    const t = Date.UTC(2026, 10, 16, 14, 5, 59);
    expect(hourStamp(t)).toBe("2026111614");
    expect(minuteStamp(t)).toBe("202611161405");
  });
});

describe("moderation labels", () => {
  it("block on a blocked category by name or parent, and pass the rest", () => {
    expect(blockedLabels([{ Name: "Graphic Violence", ParentName: "Violence" }, { Name: "Alcohol", ParentName: "Drugs & Tobacco" }])).toEqual(["Violence"]);
    expect(blockedLabels([{ Name: "Explicit Nudity" }])).toEqual(["Explicit Nudity"]);
    expect(blockedLabels([{ Name: "Smoking" }])).toEqual([]);
  });
});
