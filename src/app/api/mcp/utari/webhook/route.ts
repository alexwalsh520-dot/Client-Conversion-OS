// Proactive trigger for UTARI. Something on our side (a Supabase trigger, or a cron after a
// sync) POSTs here when new attribution/ad data lands; we forward the event to UTARI's inbound
// webhook so the agent can react without being asked. Bearer-gated with the same token.
// To actually kick UTARI, set UTARI_WEBHOOK_URL to the inbound URL UTARI gives you; until then
// this accepts + acknowledges the event so the pipe is ready.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.UTARI_MCP_TOKEN;
const UTARI_WEBHOOK_URL = process.env.UTARI_WEBHOOK_URL;

export async function POST(req: NextRequest) {
  if (!TOKEN || req.headers.get("authorization") !== `Bearer ${TOKEN}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const event = await req.json().catch(() => ({}));
  const payload = { source: "ccos-foundation", at: new Date().toISOString(), event };
  if (UTARI_WEBHOOK_URL) {
    try {
      await fetch(UTARI_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return NextResponse.json({ ok: true, forwarded: true });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "forward failed" }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true, forwarded: false, note: "set UTARI_WEBHOOK_URL to forward to UTARI" });
}
