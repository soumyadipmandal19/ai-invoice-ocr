import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Python is provisioned separately on the host, not bundled as a JS asset.
  outputFileTracingExcludes: {
    "/*": ["./.venv/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/extract": ["./python/extract.py", "./python/ocr/**/*.py"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: [{ loader: "@tailwindcss/turbopack", options: { base: process.cwd() } }],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
