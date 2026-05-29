import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  outputFileTracingIncludes: {
    "/api/studio-2/ai/generations": ["./node_modules/@higgsfield/cli/**"],
    "/api/studio-2/ai/generations/[id]": ["./node_modules/@higgsfield/cli/**"],
    "/api/studio-2/ai/higgsfield-auth/login": ["./node_modules/@higgsfield/cli/**"],
  },
  // Force clean build - bust Vercel cache v2
  generateBuildId: async () => `build-${Date.now()}-v2`,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
