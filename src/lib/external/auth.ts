// Auth for the external content-worker surface (the Jeremy/Utari integration). This is the ONLY
// auth for /api/external/* — never CRON_SECRET, never the service key. The worker sends its key in
// the `X-External-Key` header. If EXTERNAL_CONTENT_API_KEY is unset, the whole surface is cleanly
// disabled (every request 401s) rather than silently open.

import type { NextRequest } from "next/server";
import crypto from "node:crypto";

// Constant-time compare so a mismatched key can't be timed. Returns false if the feature is off.
export function externalKeyOk(req: NextRequest): boolean {
  const configured = process.env.EXTERNAL_CONTENT_API_KEY?.trim();
  if (!configured) return false; // feature disabled until the key is set
  const provided = (req.headers.get("x-external-key") || "").trim();
  if (!provided || provided.length !== configured.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(configured));
}
