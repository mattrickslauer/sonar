import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-postgres relies on dynamic/optional requires that Next's server
  // bundler mangles, which breaks every Aurora DSQL query at runtime on
  // Vercel (while the AWS SDK / DynamoDB path bundles fine). Keep `pg` as a
  // runtime require from node_modules instead of bundling it.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
