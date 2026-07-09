import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @pdi/shared ships raw TS source (no build step yet) — Next must transpile it.
  transpilePackages: ["@pdi/shared"],
};

export default nextConfig;
