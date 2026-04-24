import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

// All tab routes available in the app
export const ALL_TABS = [
  "/",
  "/mozi-metrics",
  "/sales",
  "/coaching",
  "/onboarding",
  "/ads",
  "/studio",
  "/outreach",
  "/leads",
  "/outreach-runs",
  "/sales-hub",
  "/media-buyer",
  "/intelligence",
  "/log",
  "/settings",
];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;

  const sb = getServiceSupabase();
  const { data } = await sb
    .from("app_users")
    .select("role")
    .eq("email", session.user.email.toLowerCase())
    .eq("is_active", true)
    .single();

  if (!data || data.role !== "admin") return null;
  return session;
}

// GET /api/users — list all users (admin only)
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("app_users")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data, allTabs: ALL_TABS });
}

// POST /api/users — add a new user (admin only)
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, name, role, allowed_tabs } = body;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("app_users")
    .insert({
      email: email.toLowerCase().trim(),
      name: name || null,
      role: role || "client",
      allowed_tabs: allowed_tabs || ["/"],
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data }, { status: 201 });
}

// PATCH /api/users — update a user (admin only)
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  // Sanitize updates
  const allowed: Record<string, unknown> = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.role !== undefined) allowed.role = updates.role;
  if (updates.allowed_tabs !== undefined) allowed.allowed_tabs = updates.allowed_tabs;
  if (updates.is_active !== undefined) allowed.is_active = updates.is_active;
  allowed.updated_at = new Date().toISOString();

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("app_users")
    .update(allowed)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}

// DELETE /api/users — remove a user (admin only)
export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  // Prevent deleting yourself
  const sb = getServiceSupabase();
  const { data: target } = await sb
    .from("app_users")
    .select("email")
    .eq("id", id)
    .single();

  if (target?.email === session.user?.email?.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  const { error } = await sb.from("app_users").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
