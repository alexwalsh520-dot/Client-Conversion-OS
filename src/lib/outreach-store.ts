// Outreach run history storage
// MVP: Uses localStorage on the client side.
// Can be upgraded to Vercel KV, Supabase, or another DB later.

import type {
  SegmentCount,
  SmartleadCampaignSummary,
  SmartleadSegmentRoute,
} from "@/lib/outreach-segments";

export interface OutreachRun {
  id: string;
  timestamp: string;
  leads_imported: number;
  new_contacts: number;
  already_existed: number;
  failed_import: number;
  smartlead_added: number;
  dms_queued: number;
  errors: number;
  error_details: string[];
  colddms_file: string;
  colddms_usernames: string[];
  colddms_csv?: string;
  segment_counts?: SegmentCount[];
  smartlead_campaigns?: SmartleadCampaignSummary[];
  unmapped_segments?: SegmentCount[];
  status: "completed" | "failed" | "partial";
}

const STORAGE_KEY = "ccos_outreach_runs";
const SEGMENT_ROUTES_STORAGE_KEY = "ccos_smartlead_segment_routes";

export function getRuns(): OutreachRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OutreachRun[];
  } catch {
    return [];
  }
}

export function saveRun(run: OutreachRun): void {
  if (typeof window === "undefined") return;
  const runs = getRuns();
  runs.unshift(run); // newest first
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

export function deleteRun(id: string): void {
  if (typeof window === "undefined") return;
  const runs = getRuns().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}

export function generateRunId(): string {
  const date = new Date().toISOString().split("T")[0];
  const runs = getRuns().filter((r) => r.id.startsWith(`run_${date}`));
  const num = String(runs.length + 1).padStart(3, "0");
  return `run_${date}_${num}`;
}

export function getSmartleadSegmentRoutes(): SmartleadSegmentRoute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SEGMENT_ROUTES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SmartleadSegmentRoute[];
  } catch {
    return [];
  }
}

export function saveSmartleadSegmentRoutes(
  routes: SmartleadSegmentRoute[]
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEGMENT_ROUTES_STORAGE_KEY, JSON.stringify(routes));
}

export function getQuickStats() {
  const runs = getRuns();
  const totalImported = runs.reduce((s, r) => s + r.leads_imported, 0);
  const totalEmails = runs.reduce((s, r) => s + r.smartlead_added, 0);
  const totalDMs = runs.reduce((s, r) => s + r.dms_queued, 0);
  const lastRun = runs.length > 0 ? runs[0].timestamp : null;
  return { totalImported, totalEmails, totalDMs, lastRun, totalRuns: runs.length };
}
