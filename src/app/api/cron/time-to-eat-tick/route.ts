import { NextRequest, NextResponse } from "next/server";

// Fast Time to Eat tick. The response-time alerts (4-min "about to miss target",
// 15-min "answer lead") only mean something if the check runs close to those
// thresholds — the every-10-min sales-quick-sync is too slow. So this dedicated
// cron pokes the time-to-eat sync every couple of minutes. It's lightweight: the
// endpoint reads a short message window and the ManyChat tag checks are throttled
// by their own cache, so cron frequency doesn't multiply them.

export const maxDuration = 60;

function getBaseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "production") return "https://client-conversion-os.vercel.app";
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const baseUrl = getBaseUrl(req);

  try {
    const res = await fetch(`${baseUrl}/api/sales-hub/time-to-eat?client=all&sync=1`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "x-cron-secret": process.env.CRON_SECRET ?? "",
      },
    });
    const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
    const status =
      body && typeof body === "object" && "status" in body ? (body as { status?: string }).status : null;
    return NextResponse.json({
      ok: res.ok && status !== "error",
      elapsed_ms: Date.now() - startedAt,
      result: body,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Time to Eat tick failed" },
      { status: 500 },
    );
  }
}
