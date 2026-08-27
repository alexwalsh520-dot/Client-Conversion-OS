import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isCreatorKey } from "@/lib/creators";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { dmInboxGrouped, dmThread, dmThreadsBulk } from "@/lib/ads-v2/dm-inbox";

// DM inbox behind the Messages cells. All modes are authed dashboard only;
// the public share pages never call this.
//   List:    ?client=tyson&keywords=kw1,kw2&from=...&to=...
//   Bulk:    same params + &mode=threads (every thread in scope, one shot)
//   Thread:  ?client=tyson&subscriber=<manychat id> (single verbatim thread)

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_KEYWORDS = 120;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const client = sp.get("client") || "";
  const subscriber = sp.get("subscriber");

  if (!isCreatorKey(client) || !ADSV2_SERVED_CLIENTS.includes(client)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400 });
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

    const keywords = (sp.get("keywords") || sp.get("keyword") || "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!keywords.length || keywords.length > MAX_KEYWORDS || keywords.some((k) => k.length > 80)) {
      return NextResponse.json({ error: "Bad keywords" }, { status: 400 });
    }
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
      return NextResponse.json({ error: "Bad date range" }, { status: 400 });
    }

    if (sp.get("mode") === "threads") {
      return NextResponse.json(await dmThreadsBulk(client, keywords, from, to));
    }
    return NextResponse.json(await dmInboxGrouped(client, keywords, from, to));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load DMs" },
      { status: 500 },
    );
  }
}
