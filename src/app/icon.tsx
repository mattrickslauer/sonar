import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

// A crisp, high-resolution app icon (used by the manifest, PWA installs, and as
// the Organization logo in structured data) — a sonar ping on the brand field.
// The existing favicon.ico still covers the legacy small favicon slot.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
            width: 300,
            height: 300,
            borderRadius: 300,
            border: `28px solid ${BRAND.sonar}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: 110,
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
