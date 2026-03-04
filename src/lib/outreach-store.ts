// Outreach run history storage
// MVP: Uses localStorage on the client side.
// Can be upgraded to Vercel KV, Supabase, or another DB later.

export interface OutreachRun {
  id: string;
  timestamp: string;
  leads_imported: number;
  smartlead_added: number;
  dms_queued: number;
  errors: number;
  error_details: string[];
  colddms_file: string;
  colddms_usernames: string[];
  status: "completed" | "failed" | "partial";
}

const STORAGE_KEY = "ccos_outreach_runs";

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

export function getQuickStats() {
  const runs = getRuns();
  const totalImported = runs.reduce((s, r) => s + r.leads_imported, 0);
  const totalEmails = runs.reduce((s, r) => s + r.smartlead_added, 0);
  const totalDMs = runs.reduce((s, r) => s + r.dms_queued, 0);
  const lastRun = runs.length > 0 ? runs[0].timestamp : null;
  return { totalImported, totalEmails, totalDMs, lastRun, totalRuns: runs.length };
}
