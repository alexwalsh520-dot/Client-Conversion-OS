import type { NextRequest } from "next/server";

// The base URL a cron must use to call sibling API routes.
//
// Vercel runs scheduled crons against the deployment-specific host, so `new URL(req.url).origin`
// resolves to https://<deployment>-<hash>.vercel.app — which Deployment Protection (Vercel
// Authentication) guards. Every child fetch to that origin comes back 401 "Protected deployment"
// in ~10ms, so the cron does nothing while still reporting 200. The public production alias is not
// protected, so siblings must always be reached through it. Manual triggers hide the bug: they
// already come in on the public alias, so the children succeed.
export function cronBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "production") return "https://client-conversion-os.vercel.app";
  return new URL(req.url).origin;
}
