import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // Validate cron secret (Vercel sends this as Authorization header)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
    }

    // Compute last week's date range (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - dayOfWeek - 6); // Go to previous Monday
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);

    const dateFrom = lastMonday.toISOString().split("T")[0];
    const dateTo = lastSunday.toISOString().split("T")[0];

    // Determine the base URL for internal API calls
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // Fire both reports in parallel
    const [marketingRes, salesRes] = await Promise.all([
      fetch(`${baseUrl}/api/sales-hub/weekly-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, sendToSlack: true }),
      }).catch((err) => {
        console.error("[cron/weekly-report] Marketing report failed:", err);
        return null;
      }),
      fetch(`${baseUrl}/api/sales-hub/weekly-sales-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, sendToSlack: true }),
      }).catch((err) => {
        console.error("[cron/weekly-report] Sales report failed:", err);
        return null;
      }),
    ]);

    const marketingResult = marketingRes?.ok ? await marketingRes.json().catch(() => ({})) : null;
    const salesResult = salesRes?.ok ? await salesRes.json().catch(() => ({})) : null;

    return NextResponse.json({
      success: true,
      dateFrom,
      dateTo,
      marketing: { sent: marketingResult?.slackSent || false, ok: !!marketingResult },
      sales: { sent: salesResult?.slackSent || false, ok: !!salesResult },
    });
  } catch (err) {
    console.error("[cron/weekly-report] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to run weekly report cron" },
      { status: 500 }
    );
  }
}
