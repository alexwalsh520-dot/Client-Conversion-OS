import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { computeInvoice, periodFor } from "@/lib/invoicing/compute";

export const dynamic = "force-dynamic";

// Hard owner lock — this endpoint is private to Matthew, independent of the
// admin/allowed_tabs system (admins must NOT see invoicing).
const OWNER = "matthew@clientconversion.io";

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user?.email || "").toLowerCase() !== OWNER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const client = p.get("client") || "tyson";
  const asOf = p.get("date") || todayET();
  const whopRaw = p.get("whop");
  const whop = whopRaw ? Number(whopRaw) : 0;

  // The period that contains the picked date; invoice runs period-start → min(asOf, period-end).
  const period = periodFor(asOf);
  const to = asOf < period.end ? asOf : period.end;

  try {
    const result = await computeInvoice({
      client,
      from: period.start,
      to,
      whop: Number.isFinite(whop) ? whop : 0,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invoice computation failed" },
      { status: 500 }
    );
  }
}
