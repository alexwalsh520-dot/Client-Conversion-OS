import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The commit a deployment is actually serving. Vercel injects VERCEL_GIT_COMMIT_SHA at build time,
// so after a merge you can poll this until `sha` matches the merge commit BEFORE probing, regenerating
// or verifying — the house rule that stops us reading or spending against a half-rolled-out deploy.
export function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    builtAt: process.env.VERCEL_DEPLOYMENT_BUILD_AT || process.env.BUILD_TIME || null,
  });
}
