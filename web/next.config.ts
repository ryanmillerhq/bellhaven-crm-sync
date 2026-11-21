import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env at the repo root serves both the Python pipeline and this app locally.
// On Vercel there is no .env file; variables come from the project settings instead.
// forceReload: Next has already loaded (and cached) env for web/ itself, so without it this call is a no-op.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error }, true);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pg is a Node-only dependency; keep it out of the bundler.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
