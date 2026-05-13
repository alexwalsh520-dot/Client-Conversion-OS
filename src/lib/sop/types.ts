// SOP library types — shared between server (API routes) and client
// (page + components). Matches the schema in migration 030.

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
  file_path: string;
  file_name: string;
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
 *  affordances (Upload button, admin manage links, etc.). */
export interface SopPermissions {
  /** True for users with role='admin' in app_users. Gates Upload + admin UI. */
  canUpload: boolean;
  /** True if the viewer can edit/delete a particular SOP. For MVP: same as canUpload. */
  canManage: boolean;
}

/** File-type categorization for the viewer. PDFs preview inline; other
 *  types just show a Download button. */
export type SopPreviewKind = "pdf" | "image" | "download_only";

export function previewKindForFile(fileType: string | null): SopPreviewKind {
  if (!fileType) return "download_only";
  if (fileType === "application/pdf") return "pdf";
  if (fileType.startsWith("image/")) return "image";
  return "download_only";
}
