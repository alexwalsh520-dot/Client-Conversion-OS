import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isCreatorKey } from "@/lib/creators";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { dmInboxList, dmThread } from "@/lib/ads-v2/dm-inbox";

// DM inbox for one keyword (the conversations behind a Messages cell).
// List mode:   ?client=tyson&keyword=mission&from=2026-08-01&to=2026-08-24
// Thread mode: same params + &subscriber=<manychat id> (full verbatim thread)
// Authed dashboard only; the public share pages never call this.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const client = sp.get("client") || "";
  const keyword = (sp.get("keyword") || "").trim();
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const subscriber = sp.get("subscriber");

  if (!isCreatorKey(client) || !ADSV2_SERVED_CLIENTS.includes(client)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  }
  if (!keyword || keyword.length > 80) {
    return NextResponse.json({ error: "Bad keyword" }, { status: 400 });
  }

  try {
    if (subscriber) {
      if (!/^\d{1,30}$/.test(subscriber)) {
        return NextResponse.json({ error: "Bad subscriber" }, { status: 400 });
      }
      const thread = await dmThread(client, subscriber);
      if (!thread) return NextResponse.json({ error: "No thread stored for this person" }, { status: 404 });
      return NextResponse.json(thread);
    }
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
      return NextResponse.json({ error: "Bad date range" }, { status: 400 });
    }
    const list = await dmInboxList(client, keyword, from, to);
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load DMs" },
      { status: 500 },
    );
  }
}
