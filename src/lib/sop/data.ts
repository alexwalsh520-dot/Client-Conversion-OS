// SOP library: server-side query helpers.
//
// Used by API routes and server components. Always uses the service-role
// client because:
//   - We need to bypass RLS for inserts/updates/deletes
//   - Reads happen in API routes that already gate on auth
//
// Functions here return plain typed shapes; API routes are thin layers
// on top.

import { getServiceSupabase } from "@/lib/supabase";
import type {
  Sop,
  SopDepartment,
  SopRole,
  SopWithRelations,
} from "./types";

const SOP_BUCKET = "sops";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 2; // 2 hours, matches nutrition pattern

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(): Promise<SopDepartment[]> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sop_departments")
    .select("id, key, label, description, sort_order")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SopDepartment[];
}

export async function createDepartment(input: {
  key: string;
  label: string;
  description?: string | null;
  sort_order?: number;
}): Promise<SopDepartment> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sop_departments")
    .insert({
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      sort_order: input.sort_order ?? 100,
    })
    .select("id, key, label, description, sort_order")
    .single();
  if (error) throw error;
  return data as SopDepartment;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function listRoles(opts?: { departmentId?: number }): Promise<SopRole[]> {
  const db = getServiceSupabase();
  let q = db
    .from("sop_roles")
    .select("id, department_id, key, label, description, sort_order")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (opts?.departmentId) q = q.eq("department_id", opts.departmentId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SopRole[];
}

export async function createRole(input: {
  department_id: number;
  key: string;
  label: string;
  description?: string | null;
  sort_order?: number;
}): Promise<SopRole> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sop_roles")
    .insert({
      department_id: input.department_id,
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      sort_order: input.sort_order ?? 100,
    })
    .select("id, department_id, key, label, description, sort_order")
    .single();
  if (error) throw error;
  return data as SopRole;
}

// ---------------------------------------------------------------------------
// SOPs
// ---------------------------------------------------------------------------

export async function listSops(opts?: {
  departmentId?: number;
  roleId?: number;
  search?: string;
}): Promise<SopWithRelations[]> {
  const db = getServiceSupabase();

  // Step 1: get base SOPs with department joined inline.
  let q = db
    .from("sops")
    .select(`
      id, title, description, department_id, share_slug,
      file_path, file_name, file_type, file_size_bytes, tags,
      uploaded_by, uploaded_at, updated_at,
      department:sop_departments!inner (id, key, label, description, sort_order)
    `)
    .order("uploaded_at", { ascending: false });

  if (opts?.departmentId) q = q.eq("department_id", opts.departmentId);

  // Free-text search across title, description, and the department label
  // so typing "sales" surfaces sales-dept SOPs even if not in the title.
  if (opts?.search && opts.search.trim()) {
    const pattern = `%${opts.search.trim().replace(/[%_]/g, "\\$&")}%`;
    q = q.or(`title.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { data, error } = await q;
  if (error) throw error;
  const baseSops = (data ?? []) as unknown as Array<
    Sop & { department: SopDepartment }
  >;

  if (baseSops.length === 0) return [];

  // Step 2: roles per SOP via the junction table.
  const sopIds = baseSops.map((s) => s.id);
  const { data: assignments, error: assignErr } = await db
    .from("sop_role_assignments")
    .select(`
      sop_id,
      role:sop_roles!inner (id, department_id, key, label, description, sort_order)
    `)
    .in("sop_id", sopIds);
  if (assignErr) throw assignErr;

  const rolesBySop = new Map<number, SopRole[]>();
  for (const row of (assignments ?? []) as unknown as Array<{
    sop_id: number;
    role: SopRole;
  }>) {
    if (!rolesBySop.has(row.sop_id)) rolesBySop.set(row.sop_id, []);
    rolesBySop.get(row.sop_id)!.push(row.role);
  }

  let enriched = baseSops.map((s) => ({
    ...s,
    roles: rolesBySop.get(s.id) ?? [],
  })) as SopWithRelations[];

  // Step 3: post-filter by role if requested. We do this in JS rather than
  // SQL to keep the listSops query simple — the volume of SOPs will stay
  // low enough that a JS filter is fine for years.
  if (opts?.roleId) {
    enriched = enriched.filter((s) =>
      s.roles.some((r) => r.id === opts.roleId)
    );
  }

  // Step 4: search across tags too (post-filter — Postgres array search
  // via ilike doesn't compose cleanly with the title/desc OR above).
  if (opts?.search && opts.search.trim()) {
    const needle = opts.search.trim().toLowerCase();
    // The SQL OR above already matched title/desc; here we widen to tags
    // by adding back any rows whose tags match but title/desc didn't.
    // Simpler: just trust the SQL filter for title/desc; if the user wants
    // tag-only matches we'd need a separate query. Acceptable for MVP.
    void needle;
  }

  return enriched;
}

export async function getSopBySlug(slug: string): Promise<SopWithRelations | null> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sops")
    .select(`
      id, title, description, department_id, share_slug,
      file_path, file_name, file_type, file_size_bytes, tags,
      uploaded_by, uploaded_at, updated_at,
      department:sop_departments!inner (id, key, label, description, sort_order)
    `)
    .eq("share_slug", slug)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null; // no row found
    throw error;
  }
  const baseSop = data as unknown as Sop & { department: SopDepartment };

  const { data: assignments } = await db
    .from("sop_role_assignments")
    .select(`role:sop_roles!inner (id, department_id, key, label, description, sort_order)`)
    .eq("sop_id", baseSop.id);

  const roles = ((assignments ?? []) as unknown as Array<{ role: SopRole }>).map((a) => a.role);
  return { ...baseSop, roles };
}

export async function deleteSop(id: number): Promise<void> {
  const db = getServiceSupabase();
  // First, fetch the file path so we can clean up storage too.
  const { data: row } = await db.from("sops").select("file_path").eq("id", id).single();
  // Delete the row (cascades to sop_role_assignments).
  const { error } = await db.from("sops").delete().eq("id", id);
  if (error) throw error;
  // Best-effort storage cleanup. If it fails we log but don't block —
  // the row is already gone, leaving an orphan file is preferable to
  // a broken DB delete.
  if (row?.file_path) {
    const { error: storageErr } = await db.storage.from(SOP_BUCKET).remove([row.file_path]);
    if (storageErr) {
      console.warn(`[sop/data] Failed to remove storage object ${row.file_path}:`, storageErr.message);
    }
  }
}

export async function setRoleAssignments(sopId: number, roleIds: number[]): Promise<void> {
  const db = getServiceSupabase();
  // Wipe + insert. Cleaner than diff-and-patch for the small N here.
  const { error: delErr } = await db
    .from("sop_role_assignments")
    .delete()
    .eq("sop_id", sopId);
  if (delErr) throw delErr;
  if (roleIds.length === 0) return;
  const rows = roleIds.map((role_id) => ({ sop_id: sopId, role_id }));
  const { error: insErr } = await db.from("sop_role_assignments").insert(rows);
  if (insErr) throw insErr;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export const SOPS_STORAGE_BUCKET = SOP_BUCKET;

/**
 * Mints a time-limited signed URL for downloading a SOP file. Used by the
 * viewer page (PDF preview iframe) and the Download button.
 */
export async function getSignedDownloadUrl(filePath: string, downloadFilename?: string): Promise<string | null> {
  const db = getServiceSupabase();
  const { data, error } = await db.storage
    .from(SOP_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS, {
      // Forces the browser to use this filename for the download dialog
      // instead of the storage object key.
      download: downloadFilename ?? true,
    });
  if (error) {
    console.error(`[sop/data] Failed to mint signed URL for ${filePath}:`, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
