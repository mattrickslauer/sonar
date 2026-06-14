import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests cover the pure, security- and correctness-critical logic that has
// no AWS/network dependency: geohash, geo math, clustering, channel/range
// config, the OTP crypto contract, session/WS-ticket signing, and the WebSocket
// authorizer. Anything that talks to DynamoDB/DSQL/S3 is left to integration.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,mjs}"],
    // Deterministic secret so the OTP pepper, session signer, and WS authorizer
    // share one key across the suite (mirrors how prod uses a single secret).
    env: {
      SONAR_SESSION_SECRET: "test-secret-at-least-32-chars-long-xx",
    },
  },
  resolve: {
    // Mirror the tsconfig "@/*" -> "src/*" path alias for modules under test.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
