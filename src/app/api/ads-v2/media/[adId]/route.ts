import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { resolveAdMediaNow, storeAdVideoInBackground } from "@/lib/ads-v2/media-sync";

// On-demand media resolution for the ad-name hover card. Guarantees a playable
// video URL every time: our stored copy when we have one, otherwise a FRESH
// source URL straight from Meta (their URLs expire, so it is resolved per
// request and never cached). When we serve a fresh Meta URL we also store the
// file in the background so the next play is instant from our own storage.
// `?refresh=1` skips the stored copy — the client sends it when a stored URL
// fails to play, so a broken object heals itself.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AD_ID = /^\d{5,25}$/;
const CLIENT = /^[a-z0-9_-]{1,32}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { adId } = await ctx.params;
  if (!AD_ID.test(adId)) return NextResponse.json({ error: "Bad ad id" }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const clientRaw = sp.get("client") || "";
  const clientKeyHint = CLIENT.test(clientRaw) ? clientRaw : undefined;
  const skipStored = sp.get("refresh") === "1";

  try {
    const media = await resolveAdMediaNow(adId, { clientKeyHint, skipStored });
    if (media.source === "meta") {
      after(async () => {
        await storeAdVideoInBackground(adId, clientKeyHint);
      });
    }
    return NextResponse.json(media, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve media" },
      { status: 500 },
    );
  }
}
