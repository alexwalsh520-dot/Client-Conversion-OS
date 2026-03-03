import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["apify-client", "@anthropic-ai/sdk"],
};

export default nextConfig;
