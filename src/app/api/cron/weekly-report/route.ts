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

    // Call the weekly-report POST endpoint internally
    const reportRes = await fetch(`${baseUrl}/api/sales-hub/weekly-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateFrom,
        dateTo,
        sendToSlack: true,
      }),
    });

    if (!reportRes.ok) {
      const errorData = await reportRes.json().catch(() => ({}));
      console.error("[cron/weekly-report] Report generation failed:", errorData);
      return NextResponse.json(
        { success: false, error: errorData.error || `Report endpoint returned ${reportRes.status}` },
        { status: 500 }
      );
    }

    const result = await reportRes.json();

    return NextResponse.json({
      success: true,
      dateFrom,
      dateTo,
      slackSent: result.slackSent || false,
    });
  } catch (err) {
    console.error("[cron/weekly-report] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to run weekly report cron" },
      { status: 500 }
    );
  }
}
