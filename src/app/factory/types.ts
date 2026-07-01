// Shared types for the Factory funnel workspace (groups + multi-kind assets).

export type AssetKind =
  | "image_ad"
  | "video_ad"
  | "email"
  | "page_copy"
  | "breakout_video"
  | "dm_content"
  | "doc";

export interface WComment {
  id: string;
  author: "alex" | "claude";
  text: string;
  created_at: string;
  resolved?: boolean;
}

export interface WChecklistStep {
  id: string;
  text: string;
  done: boolean;
}

export interface WVersion {
  version: number;
  image_url: string | null;
  body_md: string | null;
  kind: string | null;
  revision_note: string | null;
  created_at: string;
}

export interface WItem {
  id: string;
  project_id: string;
  group_id: string | null;
  kind: AssetKind;
  label: string;
  bucket: string;
  style: string | null;
  copy_text: string | null;
  image_direction: string | null;
  stage: string;
  status: string | null;
  image_url: string | null;
  asset_url: string | null;
  body_md: string | null;
  comments: WComment[] | null;
  checklist: WChecklistStep[] | null;
  revision_note: string | null;
  sort_order: number;
  versions?: WVersion[];
}

export interface WGroup {
  id: string;
  project_id: string;
  name: string;
  kind: AssetKind;
  description: string | null;
  sort_order: number;
  collapsed: boolean;
}

export interface WProject {
  id: string;
  name: string;
  client: string | null;
  context_md?: string | null;
  groups?: WGroup[];
  items: WItem[];
}

// ONE consistent Kanban pipeline for every copy/video kind, so the board reads the
// same everywhere and "done" actually triggers. Approved is the done milestone
// (turns green, counts on the progress bar); Live means actually shipped/running.
// Film/edit for videos is tracked as a checklist on the card, not a board stage
// (producing a video is a task, not a status). Image ads keep their own real
// generate-pipeline stages.
export const WORKFLOW: string[] = ["todo", "in_progress", "review", "approved", "live"];
export const STATUS_LABEL: Record<string, string> = {
  todo: "To do", in_progress: "In progress", review: "Review", approved: "Approved", live: "Live",
  // image_ad generate-pipeline stages:
  copy_written: "Copy written", image_generated: "Image ready", revision: "Revision", completed: "Done",
};

export const KIND_META: Record<
  AssetKind,
  { label: string; icon: string; statuses: string[]; isDoc: boolean }
> = {
  image_ad: { label: "Image Ad", icon: "image", statuses: ["copy_written", "image_generated", "revision", "completed"], isDoc: false },
  video_ad: { label: "Video Ad", icon: "video", statuses: WORKFLOW, isDoc: true },
  email: { label: "Email", icon: "mail", statuses: WORKFLOW, isDoc: true },
  page_copy: { label: "Page Copy", icon: "page", statuses: WORKFLOW, isDoc: true },
  breakout_video: { label: "Breakout Video", icon: "video", statuses: WORKFLOW, isDoc: true },
  dm_content: { label: "DM Content", icon: "film", statuses: WORKFLOW, isDoc: true },
  doc: { label: "Doc", icon: "doc", statuses: WORKFLOW, isDoc: true },
};

export const KIND_ORDER: AssetKind[] = [
  "video_ad",
  "email",
  "page_copy",
  "breakout_video",
  "dm_content",
  "image_ad",
  "doc",
];

export function statusDone(item: WItem): boolean {
  if (item.kind === "image_ad") return item.stage === "completed";
  const st = item.status || "";
  return st === "live" || st === "approved" || st === "done";
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
