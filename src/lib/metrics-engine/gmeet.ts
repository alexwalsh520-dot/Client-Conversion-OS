// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — Google Meet join-event source.
//
// Two halves:
//   1. The SYNC (used by /api/cron/gmeet-join-sync): pulls Meet audit
//      activity from the Google Admin Reports API with a domain-wide-
//      delegated service account and lands one row per participant session
//      in warehouse.gmeet_join_events. Silently disabled until the env vars
//      below exist — the closers are being moved onto a company Workspace
//      domain first; personal-gmail hosts are invisible to this API
//      (verified 8/23: 5 of 7 closers hosted from personal gmail).
//   2. The READ helpers build.ts uses to turn sessions into show / no_show.
//
// Env (Vercel, all three required to enable the sync):
//   GMEET_SA_CLIENT_EMAIL  service account's client_email
//   GMEET_SA_PRIVATE_KEY   service account's private_key (PEM, \n-escaped ok)
//   GMEET_ADMIN_SUBJECT    a workspace admin email the SA impersonates
// The service account needs domain-wide delegation for the scope
// https://www.googleapis.com/auth/admin.reports.audit.readonly, granted in
// Admin console → Security → API controls → Domain-wide delegation.
// ─────────────────────────────────────────────────────────────────────────

import { createSign } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { chunk, isMissingRelation, safeFetchAllRows } from "./db";

const REPORTS_SCOPE = "https://www.googleapis.com/auth/admin.reports.audit.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACTIVITY_URL =
  "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/meet";

/** 'https://meet.google.com/fyy-itvh-goa' (or bare 'fyy-itvh-goa') → 'fyyitvhgoa'. */
export function parseMeetCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/meet\.google\.com\/([a-z0-9-]+)/i) ?? text.match(/^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i);
  if (!m) return null;
  const code = m[1].toLowerCase().replace(/-/g, "");
  // Real codes are 10 letters; lobby/lookup slugs ('lookup/...') are not.
  return /^[a-z0-9]{8,12}$/.test(code) ? code : null;
}

export interface GmeetConfig {
  clientEmail: string;
  privateKey: string;
  adminSubject: string;
}

export function gmeetConfig(): GmeetConfig | null {
  const clientEmail = process.env.GMEET_SA_CLIENT_EMAIL;
  const privateKey = (process.env.GMEET_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const adminSubject = process.env.GMEET_ADMIN_SUBJECT;
  if (!clientEmail || !privateKey || !adminSubject) return null;
  return { clientEmail, privateKey, adminSubject };
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Service-account JWT → OAuth access token (RS256, no SDK dependency). */
async function accessToken(cfg: GmeetConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      sub: cfg.adminSubject,
      scope: REPORTS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(cfg.privateKey))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`gmeet token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("gmeet token exchange returned no access_token");
  return json.access_token;
}

interface ActivityItem {
  id?: { time?: string; uniqueQualifier?: string };
  actor?: { email?: string };
  events?: Array<{
    name?: string;
    parameters?: Array<{
      name?: string;
      value?: string;
      intValue?: string;
      boolValue?: boolean;
    }>;
  }>;
}

export interface GmeetSyncResult {
  ok: boolean;
  disabled: boolean;
  fetched: number;
  upserted: number;
  windowStart: string | null;
  notes: string[];
}

/**
 * Pull Meet call_ended audit events since the newest stored session (24h
 * overlap; 30 days on first run) and upsert them by uniqueQualifier.
 */
export async function runGmeetJoinSync(): Promise<GmeetSyncResult> {
  const cfg = gmeetConfig();
  if (!cfg) {
    return {
      ok: true,
      disabled: true,
      fetched: 0,
      upserted: 0,
      windowStart: null,
      notes: ["GMEET_* env vars absent; sync is waiting for the workspace domain setup"],
    };
  }

  const db = getServiceSupabase();
  const notes: string[] = [];

  const { data: newest } = await db
    .schema("warehouse")
    .from("gmeet_join_events")
    .select("joined_at")
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const overlapMs = 24 * 3600 * 1000;
  const firstRunMs = 30 * 24 * 3600 * 1000;
  const windowStart = new Date(
    newest?.joined_at ? Date.parse(newest.joined_at) - overlapMs : Date.now() - firstRunMs,
  ).toISOString();

  const token = await accessToken(cfg);

  const items: ActivityItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(ACTIVITY_URL);
    url.searchParams.set("eventName", "call_ended");
    url.searchParams.set("startTime", windowStart);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`gmeet activities fetch failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { items?: ActivityItem[]; nextPageToken?: string };
    items.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  const param = (ev: NonNullable<ActivityItem["events"]>[number], name: string) =>
    ev.parameters?.find((p) => p.name === name);

  interface Row {
    meeting_code: string;
    participant_identifier: string | null;
    participant_display_name: string | null;
    is_external: boolean | null;
    joined_at: string | null;
    left_at: string | null;
    duration_seconds: number | null;
    device_type: string | null;
    organizer_email: string | null;
    source_event_key: string;
    raw: unknown;
  }
  const rows: Row[] = [];
  for (const item of items) {
    for (const ev of item.events ?? []) {
      if (ev.name !== "call_ended") continue;
      const codeRaw = param(ev, "meeting_code")?.value || "";
      const code = parseMeetCode(codeRaw) ?? parseMeetCode(`meet.google.com/${codeRaw}`);
      if (!code) continue;
      const endTime = item.id?.time ?? null;
      const durationS = Number(param(ev, "duration_seconds")?.intValue ?? NaN);
      const joinedAt =
        endTime && Number.isFinite(durationS)
          ? new Date(Date.parse(endTime) - durationS * 1000).toISOString()
          : endTime;
      rows.push({
        meeting_code: code,
        participant_identifier:
          param(ev, "identifier")?.value || item.actor?.email || null,
        participant_display_name: param(ev, "display_name")?.value ?? null,
        is_external: param(ev, "is_external")?.boolValue ?? null,
        joined_at: joinedAt,
        left_at: endTime,
        duration_seconds: Number.isFinite(durationS) ? durationS : null,
        device_type: param(ev, "device_type")?.value ?? null,
        organizer_email: param(ev, "organizer_email")?.value ?? null,
        source_event_key: `${item.id?.uniqueQualifier ?? "noq"}:${code}:${
          param(ev, "identifier")?.value ?? item.actor?.email ?? "anon"
        }:${endTime ?? ""}`,
        raw: item,
      });
    }
  }

  let upserted = 0;
  for (const slice of chunk(rows, 200)) {
    const { error } = await db
      .schema("warehouse")
      .from("gmeet_join_events")
      .upsert(slice, { onConflict: "source_event_key", ignoreDuplicates: true });
    if (error) {
      if (isMissingRelation(error)) {
        notes.push("gmeet_join_events table missing (migration 114 not applied)");
        break;
      }
      throw new Error(`gmeet upsert failed: ${error.message}`);
    }
    upserted += slice.length;
  }

  return { ok: true, disabled: false, fetched: rows.length, upserted, windowStart, notes };
}

// ── Read side (build.ts) ─────────────────────────────────────────────────

export interface GmeetSession {
  meeting_code: string;
  participant_identifier: string | null;
  is_external: boolean | null;
  organizer_email: string | null;
  duration_seconds: number | null;
}

/** All stored sessions for a set of meeting codes, keyed by code. */
export async function gmeetSessionsByCode(
  db: ReturnType<typeof getServiceSupabase>,
  codes: readonly string[],
): Promise<{ byCode: Map<string, GmeetSession[]>; missing: boolean }> {
  const byCode = new Map<string, GmeetSession[]>();
  let missing = false;
  for (const slice of chunk([...new Set(codes)], 150)) {
    const res = await safeFetchAllRows<GmeetSession>((from, to) =>
      db
        .schema("warehouse")
        .from("gmeet_join_events")
        .select("meeting_code, participant_identifier, is_external, organizer_email, duration_seconds")
        .in("meeting_code", slice)
        .order("meeting_code", { ascending: true })
        .range(from, to),
    );
    if (res.missing) missing = true;
    for (const s of res.rows) {
      const list = byCode.get(s.meeting_code) ?? [];
      list.push(s);
      byCode.set(s.meeting_code, list);
    }
  }
  return { byCode, missing };
}

/**
 * Did the prospect enter the room? A session counts as the prospect when the
 * audit log marks it external, or its identifier is neither the host nor
 * empty-host-side. Host-only sessions mean the closer sat alone: no show.
 * Sessions shorter than 30s are ignored as misclicks.
 */
export function prospectJoined(
  sessions: readonly GmeetSession[],
  hostEmails: readonly string[],
): boolean {
  const hosts = new Set(hostEmails.map((e) => e.toLowerCase()).filter(Boolean));
  return sessions.some((s) => {
    if ((s.duration_seconds ?? 0) < 30) return false;
    if (s.is_external === true) return true;
    const id = (s.participant_identifier || "").toLowerCase();
    return Boolean(id) && !hosts.has(id);
  });
}
