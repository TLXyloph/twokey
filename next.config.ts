import type { NextConfig } from "next";

// Pin the project root. A stray package-lock.json in the home directory otherwise makes Next.js
// guess the wrong root for module resolution and output file tracing (which OpenNext relies on).
// Builds always run from the project root (npm scripts), so the working directory is the root.
const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
};

export default nextConfig;
