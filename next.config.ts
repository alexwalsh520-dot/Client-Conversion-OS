import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium ships a binary tarball that Next's bundler
  // strips out unless externalized. puppeteer-core is paired with it.
  serverExternalPackages: ["@anthropic-ai/sdk", "@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/studio-2/ai/generations": ["./node_modules/@higgsfield/cli/**"],
    "/api/studio-2/ai/generations/[id]": ["./node_modules/@higgsfield/cli/**"],
    "/api/studio-2/ai/higgsfield-auth/login": ["./node_modules/@higgsfield/cli/**"],
    // Same idea for Chromium — tell the file tracer to bundle the
    // binary tarball in the function's deployment.
    "/api/nutrition/v2/admin/test-pdf-render": ["./node_modules/@sparticuz/chromium/**"],
    "/api/nutrition/v2/admin/test-generate-plan": ["./node_modules/@sparticuz/chromium/**"],
    "/api/nutrition/v2/admin/pipeline-run-status": ["./node_modules/@sparticuz/chromium/**"],
    "/api/cron/nutrition-auto-pipeline": ["./node_modules/@sparticuz/chromium/**", "./node_modules/puppeteer-core/**"],
  },
  // Force clean build - bust Vercel cache v2
  generateBuildId: async () => `build-${Date.now()}-v2`,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
