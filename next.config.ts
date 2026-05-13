import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  // Force clean build - bust Vercel cache v2
  generateBuildId: async () => `build-${Date.now()}-v2`,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
