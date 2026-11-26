import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The authenticated workspace renders per request. Avoid partial static shells
  // around its session-dependent Suspense and persistent client workspace.
  cacheComponents: false,
  partialPrefetching: false,
  // Python is provisioned separately on the host, not bundled as a JS asset.
  outputFileTracingExcludes: {
    "/*": ["./.venv/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/extract": ["./python/extract.py", "./python/ocr/**/*.py"],
    "/api/inngest": ["./python/embed.py"],
    "/api/embeddings/demo": ["./python/embed.py"],
    "/api/chat": ["./python/embed.py"],
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
