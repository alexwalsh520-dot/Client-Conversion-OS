import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import {
  MAX_IMPORT_BYTES,
  parseImport,
  record,
} from "@/lib/everfit/validation";
import { matchReport } from "@/lib/everfit/matching";
import {
  requireAccess,
  requireSameOrigin,
  loadReport,
  HttpError,
  errorResponse,
  CLIENT_FIELDS,
} from "@/lib/everfit/server";
import type { ClientSnapshot } from "@/lib/everfit/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const access = await requireAccess(),
      params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id)
      return Response.json(await loadReport(id, access), {
        headers: { "Cache-Control": "private, no-store" },
      });
    let query = getServiceSupabase()
      .from("everfit_reports")
      .select("id,coach_name,review_date,imported_at,preliminary,client_count")
      .order("review_date", { ascending: false })
      .order("imported_at", { ascending: false })
      .limit(200);
    if (!access.admin) query = query.in("coach_name", access.coaches);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json(
      { reports: data, admin: access.admin, coaches: access.coaches },
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
      throw new HttpError("Only administrators can import reports.", 403);
    requireSameOrigin(request);
    if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES)
      throw new HttpError("Report exceeds 2 MB.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_IMPORT_BYTES)
      throw new HttpError("Report exceeds 2 MB.", 413);
    let parsed;
    try {
      const body = record(JSON.parse(raw));
      parsed = parseImport(body.report, body.coachName);
    } catch (error) {
      throw new HttpError(
        error instanceof Error ? error.message : "Invalid report JSON.",
        400,
      );
    }
    const db = getServiceSupabase();
    // Read all roster pages; Supabase's default row cap must not omit a potential duplicate email.
    const roster: ClientSnapshot[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await db
        .from("clients")
        .select(CLIENT_FIELDS)
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw result.error;
      roster.push(...(result.data as ClientSnapshot[]));
      if (result.data.length < 1000) break;
    }
    if (!roster.some((c) => c.coach_name === parsed.coach_name))
      throw new HttpError("Select an existing CCOS coach name.", 400);
    const document = matchReport(parsed, roster);
    const linked = document.clients.flatMap((c) =>
      c.linked_client_id ? [c.linked_client_id] : [],
    );
    if (new Set(linked).size !== linked.length)
      throw new HttpError(
        "Multiple Everfit clients resolve to one CCOS client. Resolve this before importing.",
        409,
      );
    // Hash source-normalized data, not changing live CCOS values. A retry cannot create a new report.
    parsed.clients.sort((a, b) => a.everfit_id.localeCompare(b.everfit_id));
    const hash = createHash("sha256")
      .update(JSON.stringify(parsed))
      .digest("hex");
    const { data, error } = await db.rpc("import_everfit_report", {
      p_document: document,
      p_hash: hash,
      p_actor: access.email,
    });
    if (error) throw error;
    return Response.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
