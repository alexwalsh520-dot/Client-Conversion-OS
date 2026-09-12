import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { listKnownCoaches } from "@/lib/nutrition/coach-resolver";
import { canReadCoach, scopeReport } from "./access";
import type {
  AccessContext,
  ClientSnapshot,
  ReportDetail,
  StoredReport,
} from "./types";
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const CLIENT_FIELDS =
  "id,name,email,coach_name,program,start_date,end_date,status";
export async function requireAccess(): Promise<AccessContext> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!session?.user || !email)
    throw new HttpError("Please sign in to CCOS.", 401);
  if (session.user.role === "admin") return { email, admin: true, coaches: [] };
  if (!session.user.allowedTabs.includes("/coaching"))
    throw new HttpError("Coaching access is required.", 403);
  const { data, error } = await getServiceSupabase()
    .from("everfit_coach_access")
    .select("coach_name")
    .eq("email", email);
  if (error) throw error;
  const coaches = new Set<string>((data ?? []).map((c) => c.coach_name));
  listKnownCoaches()
    .filter((c) => c.email.toLowerCase() === email)
    .forEach((c) => coaches.add(c.internal));
  if (!coaches.size)
    throw new HttpError(
      "Ask an administrator to link your CCOS login to your coach view.",
      403,
    );
  return { email, admin: false, coaches: [...coaches] };
}
export async function loadReport(
  id: string,
  access: AccessContext,
): Promise<ReportDetail> {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new HttpError("Invalid report ID.", 400);
  const db = getServiceSupabase();
  let query = db.from("everfit_reports").select("*").eq("id", id);
  if (!access.admin) query = query.in("coach_name", access.coaches);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || !canReadCoach(access, data.coach_name))
    throw new HttpError("Report not found.", 404);
  const report = data as StoredReport &
    Required<Pick<StoredReport, "document">>;
  const ids = report.document.clients.flatMap((c) =>
    c.linked_client_id ? [c.linked_client_id] : [],
  );
  let currentClients: ClientSnapshot[] = [];
  if (ids.length) {
    const result = await db.from("clients").select(CLIENT_FIELDS).in("id", ids);
    if (result.error) throw result.error;
    currentClients = result.data as ClientSnapshot[];
  }
  const scoped = scopeReport(report.document, access, currentClients);
  const visibleIds = new Set(scoped.clients.map((c) => c.linked_client_id));
  return {
    report: {
      ...report,
      document: scoped,
      client_count: scoped.clients.length,
    },
    currentClients: currentClients.filter((c) => visibleIds.has(c.id)),
  };
}
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  // Never echo database diagnostics or imported private content to the browser.
  return Response.json(
    {
      error:
        "Everfit storage is unavailable. Check the database connection and apply the Everfit migration.",
    },
    { status: 503 },
  );
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError("Invalid request origin.", 403);
}
