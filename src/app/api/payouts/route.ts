import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { computePayoutRun, windowsFor } from "@/lib/payouts/compute";
import { loadPriorMonth } from "@/lib/payouts/data";

export const dynamic = "force-dynamic";

// Hard owner lock — private to Matthew, independent of the admin/allowed_tabs
// system, identical to /api/invoicing.
const OWNER = "matthew@clientconversion.io";

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if ((session?.user?.email || "").toLowerCase() !== OWNER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const payDate = p.get("payDate") || "";
  const asOf = p.get("asOf") || todayET();
  if (!ISO.test(payDate)) {
    return NextResponse.json({ error: "payDate required as YYYY-MM-DD" }, { status: 400 });
  }
  if (!ISO.test(asOf)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const w = windowsFor(payDate);
    const { mainRows, mrrRows, warnings } = await loadPriorMonth(w.prior.year, w.prior.month);
    const run = computePayoutRun({ payDate, asOf, mainRows, mrrRows, warnings });
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Payout computation failed" },
      { status: 500 }
    );
  }
}
