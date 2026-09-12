import { getServiceSupabase } from "@/lib/supabase";
import { normalizeEmail, record } from "@/lib/everfit/validation";
import {
  requireAccess,
  requireSameOrigin,
  HttpError,
  errorResponse,
} from "@/lib/everfit/server";
export async function GET() {
  try {
    const access = await requireAccess();
    if (!access.admin)
      throw new HttpError("Administrator access required.", 403);
    const { data, error } = await getServiceSupabase()
      .from("everfit_coach_access")
      .select("email,coach_name")
      .order("coach_name");
    if (error) throw error;
    return Response.json(
      { access: data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const access = await requireAccess();
    if (!access.admin)
      throw new HttpError("Administrator access required.", 403);
    requireSameOrigin(request);
    let email: string | null, coachName: unknown;
    try {
      const body = record(await request.json());
      email = normalizeEmail(body.email);
      coachName = body.coachName;
    } catch {
      throw new HttpError("Invalid coach access request.", 400);
    }
    if (
      !email ||
      typeof coachName !== "string" ||
      !coachName.trim() ||
      coachName.length > 100
    )
      throw new HttpError("Email and CCOS coach name are required.", 400);
    const db = getServiceSupabase();
    const { data: user, error: userError } = await db
      .from("app_users")
      .select("email,allowed_tabs")
      .eq("email", email)
      .eq("is_active", true)
      .maybeSingle();
    if (userError) throw userError;
    if (!user?.allowed_tabs?.includes("/coaching"))
      throw new HttpError(
        "Use an active CCOS login with Coaching access.",
        400,
      );
    const { data: coach, error: coachError } = await db
      .from("clients")
      .select("id")
      .eq("coach_name", coachName)
      .limit(1);
    if (coachError) throw coachError;
    if (!coach?.length) throw new HttpError("Unknown CCOS coach name.", 400);
    const { error } = await db
      .from("everfit_coach_access")
      .upsert(
        { email, coach_name: coachName, created_by: access.email },
        { onConflict: "email,coach_name" },
      );
    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
