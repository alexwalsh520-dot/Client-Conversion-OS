import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  // Force clean build - bust Vercel cache
  generateBuildId: async () => `build-${Date.now()}`,
};

export default nextConfig;
