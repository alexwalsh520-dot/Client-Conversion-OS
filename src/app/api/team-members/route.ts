/**
 * Team directory API — behind the Settings “Add Team Member” flow and any
 * client component that needs the roster.
 *
 *   GET  /api/team-members            → { members } (any signed-in user)
 *   POST /api/team-members            → create a member (admin only). When an
 *        email + access role is supplied, also creates/updates the matching
 *        app_users row so they can sign in with the right tabs.
 *   DELETE /api/team-members?id=<id>  → deactivate a member (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getTeamMembers, clearRegistryCache } from "@/lib/registry";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const JOB_ROLES = new Set(["closer", "setter", "coach"]);
const ACCESS_ROLES = new Set(["admin", "user", "client"]);

async function sessionRole(): Promise<{ email: string; isAdmin: boolean } | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  // Check the DB (not the JWT) for admin, same as /api/users — role edits
  // take effect without waiting for a re-login.
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("app_users")
    .select("role")
    .eq("email", email)
    .eq("is_active", true)
    .single();
  return { email, isAdmin: data?.role === "admin" };
}

export async function GET(): Promise<NextResponse> {
  if (!(await sessionRole())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const members = await getTeamMembers();
  return NextResponse.json({ members }, { headers: NO_STORE });
}

interface PostBody {
  name?: string;
  jobRole?: string;
  email?: string | null;
  /** app_users access level; omit to skip creating a login. */
  accessRole?: string | null;
  allowedTabs?: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const who = await sessionRole();
  if (!who?.isAdmin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const jobRole = body.jobRole?.trim().toLowerCase();
  const email = body.email?.trim().toLowerCase() || null;
  const accessRole = body.accessRole?.trim().toLowerCase() || null;

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!jobRole || !JOB_ROLES.has(jobRole)) {
    return NextResponse.json({ error: "jobRole must be closer, setter, or coach" }, { status: 400 });
  }
  if (accessRole && !ACCESS_ROLES.has(accessRole)) {
    return NextResponse.json({ error: "accessRole must be admin, user, or client" }, { status: 400 });
  }
  if (accessRole && !email) {
    return NextResponse.json({ error: "email required to create a login" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { data: member, error } = await sb
    .from("team_members")
    .insert({
      name,
      aliases: [name.toLowerCase()],
      job_role: jobRole,
      email,
    })
    .select("id, name, job_role")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `${name} is already on the team as a ${jobRole}` },
        { status: 409 },
      );
    }
    // 42P01 = table missing → migration not applied yet.
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Team registry table missing — apply migration 052 in Supabase first" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  clearRegistryCache();

  // Optionally provision their CCOS login (mirrors POST /api/users).
  let loginCreated = false;
  if (accessRole && email) {
    const { error: userErr } = await sb.from("app_users").upsert(
      {
        email,
        name,
        role: accessRole,
        allowed_tabs: body.allowedTabs?.length ? body.allowedTabs : ["/"],
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    if (userErr) {
      return NextResponse.json(
        {
          member,
          warning: `Team member added, but their login could not be created: ${userErr.message}`,
        },
        { status: 201, headers: NO_STORE },
      );
    }
    loginCreated = true;
  }

  return NextResponse.json({ member, loginCreated }, { status: 201, headers: NO_STORE });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const who = await sessionRole();
  if (!who?.isAdmin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sb = getServiceSupabase();
  const { error } = await sb
    .from("team_members")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearRegistryCache();
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
