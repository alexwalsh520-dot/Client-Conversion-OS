import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
  },
  // Force clean build - bust Vercel cache v2
  generateBuildId: async () => `build-${Date.now()}-v2`,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
