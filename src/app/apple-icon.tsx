import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

// Apple touch icon (home-screen bookmark on iOS). Apple renders on a rounded
// rect with no transparency, so we fill the brand field edge-to-edge.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.background,
        }}
      >
        <div
          style={{
            width: 108,
            height: 108,
            borderRadius: 108,
            border: `12px solid ${BRAND.sonar}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 40,
              background: BRAND.sonar,
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
