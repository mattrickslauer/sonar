// Single source of truth for the site's identity, used across the Metadata API
// (layout), the file-based conventions (sitemap/robots/manifest/OG image) and
// the JSON-LD structured data. Keep copy here so every surface agrees.

// The canonical production origin. `NEXT_PUBLIC_APP_URL` lets preview/staging
// deploys advertise their own origin; we fall back to the prod domain so a
// missing env var never breaks metadataBase or the sitemap/robots URLs.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://mysonar.zone"
).replace(/\/$/, "");

export const SITE_NAME = "Sonar";

// Used as the <title> default and the OG/Twitter title.
export const SITE_TITLE = "Sonar — the layer where places remember";

export const SITE_DESCRIPTION =
  "A live radar of what's happening around you right now. Drop ephemeral waypoints, ask the place, and let the crowd decide what's worth keeping.";

// A short, shareable one-liner for OG cards (kept under ~200 chars).
export const SITE_TAGLINE = "The layer where places remember.";

export const SITE_LOCALE = "en_US";

// Brand palette (mirrors the CSS custom properties in globals.css) so the
// generated OG image and manifest stay in sync with the app chrome.
export const BRAND = {
  background: "#05070a",
  foreground: "#e6f0ee",
  sonar: "#34e3a0",
  sonarDim: "#1b8c63",
} as const;

// Keywords describing what Sonar is — location-based, ephemeral, social radar.
export const SITE_KEYWORDS = [
  "Sonar",
  "live local radar",
  "ephemeral waypoints",
  "location-based social",
  "what's happening near me",
  "drop a pin",
  "real-time map",
  "local discovery",
  "neighborhood feed",
  "geolocation app",
];

// Optional social handle for Twitter/X card attribution. Left blank until a
// real account exists — an empty string is omitted from the tags.
export const TWITTER_HANDLE = "";
