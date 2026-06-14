import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE, BRAND } from "@/lib/site";

// The shared social card rendered when a Sonar link is posted anywhere. Drawn
// entirely with CSS so there are no font/asset files to keep in sync — a dark
// radar field with concentric rings, a center ping, and the wordmark.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  // Concentric radar rings, fading outward from the sonar green.
  const rings = [220, 420, 620, 820, 1020];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "90px",
          background: `radial-gradient(circle at 50% 42%, #0a1410 0%, ${BRAND.background} 60%)`,
          color: BRAND.foreground,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Radar rings centered behind the wordmark */}
        {rings.map((d) => (
          <div
            key={d}
            style={{
              position: "absolute",
              top: 315,
              left: 600,
              width: d,
              height: d,
              marginTop: -d / 2,
              marginLeft: -d / 2,
              borderRadius: d,
              border: `2px solid ${BRAND.sonar}`,
              opacity: 0.10 + (1020 - d) / 1020 / 4,
              display: "flex",
            }}
          />
        ))}
        {/* Center ping */}
        <div
          style={{
            position: "absolute",
            top: 315,
            left: 600,
            width: 26,
            height: 26,
            marginTop: -13,
            marginLeft: -13,
            borderRadius: 26,
            background: BRAND.sonar,
            boxShadow: `0 0 60px 20px ${BRAND.sonar}`,
            display: "flex",
          }}
        />

        {/* Foreground copy */}
        <div
          style={{
            // Painted after the absolutely-positioned rings/ping, so it
            // naturally stacks on top (satori has no z-index support).
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 64,
                border: `4px solid ${BRAND.sonar}`,
                boxShadow: `0 0 40px 4px ${BRAND.sonar}`,
                display: "flex",
              }}
            />
            <div
              style={{
                fontSize: 132,
                fontWeight: 800,
                letterSpacing: -4,
                color: "#ffffff",
                display: "flex",
              }}
            >
              {SITE_NAME}
            </div>
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 46,
              fontWeight: 500,
              color: BRAND.sonar,
              display: "flex",
            }}
          >
            {SITE_TAGLINE}
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 30,
              color: "#9fb4ad",
              maxWidth: 900,
              display: "flex",
            }}
          >
            A live radar of what&apos;s happening around you right now.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
