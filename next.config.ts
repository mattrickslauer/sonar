import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-postgres relies on dynamic/optional requires that Next's server
  // bundler mangles, which breaks every Aurora DSQL query at runtime on
  // Vercel (while the AWS SDK / DynamoDB path bundles fine). Keep `pg` as a
  // runtime require from node_modules instead of bundling it.
  // `stripe` (like `pg`) does dynamic requires the server bundler mishandles;
  // keep it a runtime node_modules require.
  serverExternalPackages: ["pg", "stripe"],
};

export default nextConfig;
