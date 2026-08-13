// Operator-only: get-or-mint the public share link for ONE Factory project.
//
// Auth-gated (NOT on the api/public allow-list in proxy.ts), so only a logged-in
// operator can mint or read a token. The PUBLIC surface that serves data is
// /api/public/factory/<token>; this route just hands the operator the URL to
// send to a client.
//
//   GET ?projectId=<uuid>  -> { token, url }  (reuses a live link if one exists)
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BASE_URL = "https://client-conversion-os.vercel.app";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId") || "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();

    // The link is always for exactly one real project.
    const { data: project } = await sb
      .from("factory_projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Reuse an existing live link for this project.
    const { data: existing } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", "factory")
      .eq("project_id", projectId)
      .eq("revoked", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.token) {
      return NextResponse.json({
        token: existing.token,
        url: `${BASE_URL}/p/factory/${existing.token}`,
      });
    }

    // Mint a fresh, unguessable token. Clients can always comment — the whole
    // point of sharing a board is getting their marks back.
    const token = randomBytes(32).toString("base64url");
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind: "factory",
      project_id: projectId,
      can_comment: true,
      label: project.name,
    });
    if (error) throw error;

    return NextResponse.json({ token, url: `${BASE_URL}/p/factory/${token}` });
  } catch (error) {
    console.error("[factory/share-link] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create share link." },
      { status: 500 }
    );
  }
}
