// SOP library types — shared between server (API routes) and client
// (page + components). Matches the schema in migrations 030 + 032.
//
// Every SOP is a native CCOS doc with `body_html` as the source of
// truth. File-related columns are nullable and used only as audit
// reference if the SOP was created via PDF/DOCX import.

export interface SopDepartment {
  id: number;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
}

export interface SopRole {
  id: number;
  department_id: number;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
}

export interface Sop {
  id: number;
  title: string;
  description: string | null;
  department_id: number;
  share_slug: string;
  /** Source of truth for SOP content. Sanitized HTML, rendered inline. */
  body_html: string;
  /** Optional audit reference — original imported source file (PDF/DOCX). */
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  tags: string[];
  uploaded_by: string | null;
  uploaded_at: string;
  updated_at: string;
}

/** SOP enriched with its department + role labels for display in cards. */
export interface SopWithRelations extends Sop {
  department: SopDepartment;
  roles: SopRole[];
}

/** Permissions returned to the client so the UI can render the right
 *  affordances (Create button, edit, delete, etc.). */
export interface SopPermissions {
  /** True for users with role='admin' in app_users. Gates Create + edit + admin UI. */
  canUpload: boolean;
  /** True if the viewer can edit/delete a particular SOP. For MVP: same as canUpload. */
  canManage: boolean;
}
