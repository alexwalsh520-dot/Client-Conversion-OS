/**
 * GET /api/public/team-names — first names only, for public-facing pickers
 * (e.g. the /review setter dropdown). No emails, aliases, or ids; the same
 * names already render on those public pages today.
 */

import { NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/registry";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(): Promise<NextResponse> {
  const members = await getTeamMembers();
  return NextResponse.json(
    {
      setters: members.filter((m) => m.jobRole === "setter").map((m) => m.name),
      closers: members.filter((m) => m.jobRole === "closer").map((m) => m.name),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
